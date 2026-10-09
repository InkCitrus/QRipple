import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createApp } from '../server/app.js';

// Opens a socket and queues incoming messages so tests can await them in order.
function client(url) {
  const ws = new WebSocket(url);
  const queue = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    const i = waiters.findIndex((w) => w.match(msg));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
    else queue.push(msg);
  });
  const api = {
    ws,
    opened: new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    }),
    closed: new Promise((resolve) => ws.once('close', (code) => resolve(code))),
    send: (msg) => ws.send(JSON.stringify(msg)),
    next(type, timeout = 2000) {
      const match = (m) => !type || m.t === type;
      const i = queue.findIndex(match);
      if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { match, resolve };
        waiters.push(waiter);
        setTimeout(() => {
          const j = waiters.indexOf(waiter);
          if (j >= 0) {
            waiters.splice(j, 1);
            reject(new Error(`timed out waiting for ${type}`));
          }
        }, timeout);
      });
    },
    /** Resolves true if no message of `type` arrives within `ms`. */
    async silent(type, ms = 200) {
      try {
        await api.next(type, ms);
        return false;
      } catch {
        return true;
      }
    },
    close: () => ws.close(),
  };
  return api;
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

describe('QRipple server', () => {
  let app;
  let url;
  let base;
  const clock = { offset: 0 };
  const now = () => Date.now() + clock.offset;

  before(async () => {
    app = createApp(
      {
        port: 0,
        host: '127.0.0.1',
        joinFailBurst: 5,
        joinFailRefillMs: 60_000,
        sweepMs: 60_000, // sweeps are triggered by hand
        heartbeatMs: 60_000,
      },
      { log: () => {} },
    );
    // Swap in a controllable clock for expiry tests.
    app.hub.now = now;
    app.hub.store.now = now;
    const { port } = await app.listen(0, '127.0.0.1');
    url = `ws://127.0.0.1:${port}/ws`;
    base = `http://127.0.0.1:${port}`;
  });

  after(() => app.close());

  async function host() {
    const h = client(url);
    await h.opened;
    h.send({ t: 'create' });
    const created = await h.next('created');
    return { h, created };
  }

  async function receiver(code, extra = {}) {
    const r = client(url);
    await r.opened;
    r.send({ t: 'join', code, ...extra });
    return r;
  }

  test('serves the app with security headers', async () => {
    for (const path of ['/', '/share', '/join']) {
      const res = await fetch(base + path);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /text\/html/);
      assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    }
    const vendor = await fetch(`${base}/vendor/jsQR.js`);
    assert.equal(vendor.status, 200);
    const qr = await fetch(`${base}/vendor/qrcode.mjs`);
    assert.equal(qr.status, 200);
    const zxing = await fetch(`${base}/vendor/zxing-reader.js`);
    assert.equal(zxing.status, 200);
    assert.match(await zxing.text(), /ZXingWASM/);
    const wasm = await fetch(`${base}/vendor/zxing_reader.wasm`, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(wasm.status, 200);
    assert.equal(wasm.headers.get('content-type'), 'application/wasm');
    const bytes = new Uint8Array(await wasm.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 4)], [0x00, 0x61, 0x73, 0x6d], 'wasm magic number');
    assert.match(wasm.headers.get('content-security-policy'), /script-src 'self' 'wasm-unsafe-eval'/);
    assert.equal((await fetch(`${base}/../package.json`)).status, 404);
    assert.equal((await fetch(`${base}/%2e%2e/package.json`)).status, 404);
    assert.equal((await fetch(`${base}/nope.js`)).status, 404);
  });

  test('create returns a five-digit code and a sharer token', async () => {
    const { h, created } = await host();
    assert.match(created.code, /^\d{5}$/);
    assert.ok(created.token.length >= 32);
    assert.ok(created.remainingMs > 0);
    h.close();
  });

  test('receivers get updates; identical data is not re-broadcast; late joiners get the latest', async () => {
    const { h, created } = await host();
    const r1 = await receiver(created.code);
    const joined = await r1.next('joined');
    assert.equal(joined.payload, null);
    assert.equal(joined.hostOnline, true);
    assert.equal((await h.next('receivers')).count, 1);

    h.send({ t: 'update', text: 'hello', data: b64('hello') });
    assert.equal((await h.next('ack')).rev, 1);
    const p1 = await r1.next('payload');
    assert.equal(p1.payload.text, 'hello');
    assert.equal(p1.payload.data, b64('hello'));

    // Same content again: acked, but receivers see nothing.
    h.send({ t: 'update', text: 'hello', data: b64('hello') });
    assert.equal((await h.next('ack')).rev, 1);
    assert.ok(await r1.silent('payload'));

    h.send({ t: 'update', text: 'world', data: b64('world') });
    await h.next('ack');
    assert.equal((await r1.next('payload')).payload.text, 'world');

    const r2 = await receiver(created.code);
    const late = await r2.next('joined');
    assert.equal(late.payload.text, 'world');
    assert.equal(late.payload.rev, 2);
    assert.equal((await h.next('receivers')).count, 2);

    r2.send({ t: 'leave' });
    await r2.next('left');
    assert.equal((await h.next('receivers')).count, 1);
    h.close();
    r1.close();
    r2.close();
  });

  test('only the sharer can update or end a session', async () => {
    const { h, created } = await host();
    const r = await receiver(created.code);
    await r.next('joined');
    r.send({ t: 'update', text: 'evil', data: b64('evil') });
    assert.equal((await r.next('error')).code, 'forbidden');
    r.send({ t: 'end' });
    assert.equal((await r.next('error')).code, 'forbidden');

    const stranger = client(url);
    await stranger.opened;
    stranger.send({ t: 'update', text: 'x', data: b64('x') });
    assert.equal((await stranger.next('error')).code, 'forbidden');
    stranger.send({ t: 'resume', sid: created.sid, token: 'wrong-token' });
    assert.equal((await stranger.next('error')).code, 'session_ended');
    h.close();
    r.close();
    stranger.close();
  });

  test('rejects oversized or malformed payloads', async () => {
    const { h } = await host();
    const big = Buffer.alloc(app.config.maxDataBytes + 1, 1).toString('base64');
    h.send({ t: 'update', text: '', data: big });
    assert.equal((await h.next('error')).code, 'too_large');
    h.send({ t: 'update', text: 'x', data: 'not base64!' });
    assert.equal((await h.next('error')).code, 'too_large');
    h.send({ t: 'update', text: 'x', data: '' });
    assert.equal((await h.next('error')).code, 'too_large');
    h.ws.send('not json');
    assert.equal((await h.next('error')).code, 'bad_request');
    h.close();
  });

  test('ending a session disconnects everyone and the code stops working', async () => {
    const { h, created } = await host();
    const r = await receiver(created.code);
    await r.next('joined');
    h.send({ t: 'end' });
    assert.equal((await r.next('ended')).reason, 'ended');
    assert.equal((await h.next('ended')).reason, 'ended');
    await r.closed;

    const late = await receiver(created.code);
    assert.equal((await late.next('error')).code, 'not_found');
    late.close();
  });

  test('sharer can resume after a disconnect; receivers see it go offline and back', async () => {
    const { h, created } = await host();
    h.send({ t: 'update', text: 'keep', data: b64('keep') });
    await h.next('ack');
    const r = await receiver(created.code);
    await r.next('joined');
    h.close();
    assert.equal((await r.next('host')).online, false);

    const h2 = client(url);
    await h2.opened;
    h2.send({ t: 'resume', sid: created.sid, token: created.token });
    const resumed = await h2.next('resumed');
    assert.equal(resumed.code, created.code);
    assert.equal(resumed.receivers, 1);
    assert.equal(resumed.rev, 1);
    assert.equal((await r.next('host')).online, true);
    h2.close();
    r.close();
  });

  test('a reconnecting receiver cannot land in a different session with a recycled code', async () => {
    const { h, created } = await host();
    const r = await receiver(created.code, { sid: 'some-other-session' });
    assert.equal((await r.next('error')).code, 'session_ended');
    h.close();
    r.close();
  });

  test('sessions expire, and end when the sharer stays offline too long', async () => {
    const { h, created } = await host();
    const r = await receiver(created.code);
    await r.next('joined');
    clock.offset += app.config.sessionTtlMs + 1;
    app.hub.sweep();
    assert.equal((await r.next('ended')).reason, 'expired');
    assert.equal((await h.next('ended')).reason, 'expired');

    const second = await host();
    const r2 = await receiver(second.created.code);
    await r2.next('joined');
    second.h.close();
    await r2.next('host');
    clock.offset += app.config.hostGraceMs + 1;
    app.hub.sweep();
    assert.equal((await r2.next('ended')).reason, 'host_left');
    clock.offset = 0;
  });

  test('repeated wrong codes are rate limited', async () => {
    const { h, created } = await host();
    const wrong = created.code === '10000' ? '10001' : '10000';
    const guesser = client(url);
    await guesser.opened;
    let limited = false;
    for (let i = 0; i < 8; i++) {
      guesser.send({ t: 'join', code: wrong });
      const err = await guesser.next('error');
      if (err.code === 'rate_limited') {
        limited = true;
        break;
      }
      assert.equal(err.code, 'not_found');
    }
    assert.ok(limited, 'expected rate limiting after repeated failures');
    // Even the right code is refused while limited.
    guesser.send({ t: 'join', code: created.code });
    assert.equal((await guesser.next('error')).code, 'rate_limited');
    h.close();
    guesser.close();
  });

  test('rejects WebSocket upgrades from foreign origins', async () => {
    const ws = new WebSocket(url, { headers: { Origin: 'https://evil.example' } });
    const result = await new Promise((resolve) => {
      ws.once('open', () => resolve('open'));
      ws.once('unexpected-response', (_req, res) => resolve(res.statusCode));
      ws.once('error', () => resolve('error'));
    });
    assert.equal(result, 403);
  });
});
