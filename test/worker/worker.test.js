import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Miniflare, Log, LogLevel } from 'miniflare';

const root = fileURLToPath(new URL('../../', import.meta.url));
const b64 = (s) => Buffer.from(s).toString('base64');
const bundle = await readFile(path.join(root, 'dist/worker/index.js'), 'utf8');
// Storage inspection is confined to a test subclass, never the deployed entry.
const inspectedBundle = `${bundle}\n
export class TestHub extends QRippleHub {
  async fetch(request) {
    if (new URL(request.url).pathname === '/__inspect') {
      await this.ready;
      await this.queue;
      return Response.json([...await this.ctx.storage.list()]);
    }
    return super.fetch(request);
  }
}
`;

async function runtime(t, bindings = {}, options = {}, autoDispose = true) {
  const mf = new Miniflare({
    name: 'qripple-test',
    modules: true,
    script: inspectedBundle,
    compatibilityDate: '2026-07-30',
    compatibilityFlags: ['nodejs_compat'],
    log: new Log(LogLevel.ERROR),
    durableObjects: { QRIPPLE_HUB: { className: 'TestHub', useSQLite: true } },
    assets: {
      directory: path.join(root, 'dist/worker-assets'),
      binding: 'ASSETS',
      routerConfig: { invoke_user_worker_ahead_of_assets: true, has_user_worker: true },
      assetConfig: { html_handling: 'none', not_found_handling: 'none' },
    },
    bindings: { CREATE_BURST: '50', ...bindings },
    ...options,
  });
  if (autoDispose) t.after(() => mf.dispose());
  await mf.ready;
  return mf;
}

async function client(t, mf, host = 'qr.example', ip = '198.51.100.1', answerHeartbeat = true) {
  const res = await mf.dispatchFetch(`https://${host}/ws`, {
    headers: { Upgrade: 'websocket', Origin: `https://${host}`, 'CF-Connecting-IP': ip },
  });
  assert.equal(res.status, 101);
  const ws = res.webSocket;
  const queue = [];
  const waiters = [];
  ws.accept();
  const closed = new Promise((resolve) => ws.addEventListener('close', resolve, { once: true }));
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.t === 'ping') {
      if (answerHeartbeat) ws.send(JSON.stringify({ t: 'ping' }));
      return;
    }
    const i = waiters.findIndex((waiter) => waiter.type === message.t && waiter.match(message));
    if (i === -1) queue.push(message);
    else waiters.splice(i, 1)[0].resolve(message);
  });
  t.after(() => { try { ws.close(1000); } catch { /* runtime disposed */ } });
  return {
    ws, closed,
    send: (message) => ws.send(JSON.stringify(message)),
    close: () => ws.close(1000),
    next(type, timeout = 3000, match = () => true) {
      const i = queue.findIndex((message) => message.t === type && match(message));
      if (i !== -1) return Promise.resolve(queue.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { type, match, resolve: (value) => { clearTimeout(timer); resolve(value); } };
        const timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1);
          reject(new Error(`timed out waiting for ${type}`));
        }, timeout);
        waiters.push(waiter);
      });
    },
  };
}

async function host(t, mf, domain) {
  const socket = await client(t, mf, domain);
  socket.send({ t: 'create' });
  return { socket, session: await socket.next('created') };
}

test('Workers serves routes, scanner assets and security headers', async (t) => {
  const mf = await runtime(t);
  for (const route of ['/', '/share', '/join', '/24914']) {
    const res = await mf.dispatchFetch(`https://qr.example${route}`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<meta name="qripple-lines" content="\[\]">/);
    assert.match(res.headers.get('Content-Security-Policy'), /script-src 'self' 'wasm-unsafe-eval'/);
    assert.equal(res.headers.get('Permissions-Policy'), 'camera=(self), microphone=(), geolocation=(), payment=()');
  }
  for (const route of ['/1234', '/123456', '/missing.js', '/package.json']) {
    assert.equal((await mf.dispatchFetch(`https://qr.example${route}`)).status, 404);
  }
  for (const name of ['jsQR.js', 'qrcode.mjs', 'zxing-reader.js']) {
    assert.equal((await mf.dispatchFetch(`https://qr.example/vendor/${name}`)).status, 200);
  }
  const wasm = await mf.dispatchFetch('https://qr.example/vendor/zxing_reader.wasm');
  assert.equal(wasm.headers.get('Content-Type'), 'application/wasm');
  assert.deepEqual([...new Uint8Array(await wasm.arrayBuffer()).slice(0, 4)], [0, 97, 115, 109]);
  const head = await mf.dispatchFetch('https://qr.example/24914', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(await (await mf.dispatchFetch('https://qr.example/healthz')).text(), 'ok');
  assert.equal((await mf.dispatchFetch('https://qr.example/', { method: 'POST' })).status, 405);
});

test('connections through different domains share sessions and preserve the protocol', async (t) => {
  const mf = await runtime(t, { ACCESS_LINES: 'a.qr.example,b.qr.example' });
  const lines = await (await mf.dispatchFetch('https://qr.example/lines.json')).json();
  assert.deepEqual(lines.lines.map((line) => line.url), ['wss://a.qr.example/ws', 'wss://b.qr.example/ws']);
  const html = await (await mf.dispatchFetch('https://qr.example/')).text();
  assert.match(html, /&quot;url&quot;:&quot;wss:\/\/a.qr.example\/ws&quot;/);
  const { socket: h, session } = await host(t, mf, 'a.qr.example');
  assert.match(session.code, /^[1-9]\d{4}$/);
  assert.equal(session.token.length, 32);
  const r = await client(t, mf, 'b.qr.example');
  r.send({ t: 'join', code: session.code });
  assert.equal((await r.next('joined')).hostOnline, true);
  assert.equal((await h.next('receivers')).count, 1);
  h.send({ t: 'update', text: 'hello', data: b64('hello') });
  assert.equal((await h.next('ack')).rev, 1);
  assert.equal((await r.next('payload')).payload.text, 'hello');
  h.send({ t: 'update', text: 'hello', data: b64('hello') });
  assert.equal((await h.next('ack')).rev, 1);
  const late = await client(t, mf);
  late.send({ t: 'join', code: session.code });
  assert.equal((await late.next('joined')).payload.rev, 1);
  r.send({ t: 'ping', id: 42 });
  const pong = await r.next('pong');
  assert.equal(pong.id, 42);
  assert.equal(pong.timing.rev, 1);
  r.send({ t: 'leave' });
  await r.next('left');
  r.send({ t: 'ping', id: 43 });
  assert.deepEqual(await r.next('pong'), { t: 'pong', id: 43 });
  h.send({ t: 'end' });
  assert.equal((await late.next('ended')).reason, 'ended');
});

test('sharer reconnects and replaces stale connections; wrong tokens and session IDs fail', async (t) => {
  const mf = await runtime(t);
  const { socket: h, session } = await host(t, mf);
  h.send({ t: 'update', text: 'latest', data: b64('latest') });
  await h.next('ack');
  const invalid = await client(t, mf);
  invalid.send({ t: 'resume', sid: session.sid, token: 'wrong' });
  assert.equal((await invalid.next('error')).code, 'session_ended');
  invalid.send({ t: 'join', code: session.code, sid: 'old-session' });
  assert.equal((await invalid.next('error')).code, 'session_ended');
  const resumed = await client(t, mf);
  resumed.send({ t: 'resume', sid: session.sid, token: session.token });
  assert.equal((await resumed.next('resumed')).rev, 1);
  assert.equal((await h.next('error')).code, 'replaced');
  await h.closed;
  resumed.close();
  await resumed.closed;
  const again = await client(t, mf);
  again.send({ t: 'resume', sid: session.sid, token: session.token });
  assert.equal((await again.next('resumed')).sid, session.sid);
});

test('Workers rejects foreign origins and enforces message and per-IP connection limits', async (t) => {
  const mf = await runtime(t, { MAX_CONNECTIONS_PER_IP: '2', MAX_MESSAGE_BYTES: '200' });
  const foreign = await mf.dispatchFetch('https://qr.example/ws', {
    headers: { Upgrade: 'websocket', Origin: 'https://evil.example' },
  });
  assert.equal(foreign.status, 403);
  assert.equal((await mf.dispatchFetch('https://qr.example/ws')).status, 426);
  const a = await client(t, mf);
  await client(t, mf);
  const denied = await mf.dispatchFetch('https://qr.example/ws', {
    headers: { Upgrade: 'websocket', 'CF-Connecting-IP': '198.51.100.1', 'X-Forwarded-For': '203.0.113.10' },
  });
  assert.equal(denied.status, 429, 'X-Forwarded-For cannot bypass per-IP limits');
  a.ws.send('x'.repeat(201));
  assert.equal((await a.closed).code, 1009);
  await client(t, mf);
});

test('alarms expire offline sessions without messages', async (t) => {
  const mf = await runtime(t, { HOST_GRACE_MS: '100', SWEEP_MS: '50' });
  const { socket: h, session } = await host(t, mf);
  const r = await client(t, mf);
  r.send({ t: 'join', code: session.code });
  await r.next('joined');
  h.close();
  await h.closed;
  assert.equal((await r.next('host')).online, false);
  assert.equal((await r.next('ended')).reason, 'host_left');
});

test('alarms enforce the hard session lifetime while the sharer stays connected', async (t) => {
  const mf = await runtime(t, { SESSION_TTL_MS: '100', SWEEP_MS: '50' });
  const { socket: h } = await host(t, mf);
  assert.equal((await h.next('ended')).reason, 'expired');
});

test('application heartbeat keeps responsive clients alive and removes silent peers', { timeout: 10000 }, async (t) => {
  const mf = await runtime(t, { HEARTBEAT_MS: '50', SWEEP_MS: '50' });
  const { socket: h } = await host(t, mf);
  const silent = await client(t, mf, 'qr.example', '198.51.100.2', false);
  assert.equal((await silent.closed).code, 1001);
  h.send({ t: 'ping', id: 7 });
  assert.equal((await h.next('pong', 3000, (message) => message.id === 7)).id, 7);
});

test('payload size, canonical encoding and receiver permissions hold on Workers', async (t) => {
  const mf = await runtime(t, { MAX_RECEIVERS: '1' });
  const { socket: h, session } = await host(t, mf);
  const r = await client(t, mf);
  r.send({ t: 'join', code: session.code });
  await r.next('joined');
  r.send({ t: 'update', text: 'forged', data: b64('forged') });
  assert.equal((await r.next('error')).code, 'forbidden');
  h.send({ t: 'update', text: 'bad encoding', data: 'YQ' });
  assert.equal((await h.next('error')).code, 'too_large');
  const data = Buffer.alloc(8192, 255).toString('base64');
  h.send({ t: 'update', text: 'max size', data });
  assert.equal((await h.next('ack')).rev, 1);
  assert.equal((await r.next('payload')).payload.data, data);
  h.send({ t: 'update', text: 'over limit', data: Buffer.alloc(8193, 255).toString('base64') });
  assert.equal((await h.next('error')).code, 'too_large');
  h.ws.send(new Uint8Array([1, 2, 3]));
  assert.equal((await h.next('error')).code, 'bad_request');
  const extra = await client(t, mf);
  extra.send({ t: 'join', code: session.code });
  assert.equal((await extra.next('error')).code, 'full');
});

test('creation and failed-join rate limits are shared across domains', async (t) => {
  const mf = await runtime(t, { CREATE_BURST: '1', JOIN_FAIL_BURST: '2' });
  const { session } = await host(t, mf, 'a.qr.example');
  const other = await client(t, mf, 'b.qr.example');
  other.send({ t: 'create' });
  assert.equal((await other.next('error')).code, 'rate_limited');
  for (let i = 0; i < 2; i++) {
    other.send({ t: 'join', code: '00000' });
    assert.equal((await other.next('error')).code, 'not_found');
  }
  const next = await client(t, mf, 'c.qr.example');
  next.send({ t: 'join', code: session.code });
  assert.equal((await next.next('error')).code, 'rate_limited');
});

test('storage holds only code deadlines; restart loses payloads but preserves cooldown', { timeout: 15000 }, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'qripple-worker-'));
  let mf;
  t.after(async () => {
    try { await mf?.dispose(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
  mf = await runtime(t, { CODE_COOLDOWN_MS: '60000' }, { durableObjectsPersist: directory }, false);
  const { socket: h, session } = await host(t, mf);
  h.send({ t: 'update', text: 'private QR contents', data: b64('private QR contents') });
  await h.next('ack');
  const inspect = async () => {
    const ns = await mf.getDurableObjectNamespace('QRIPPLE_HUB');
    return (await ns.getByName('global').fetch('https://hub/__inspect')).json();
  };
  const before = await inspect();
  assert.equal(before.length, 1);
  assert.equal(before[0][0], `code:${session.code}`);
  assert.equal(typeof before[0][1], 'number');
  assert.ok(before[0][1] > Date.now() + 60000);
  const previous = mf;
  mf = null;
  await previous.dispose();
  mf = await runtime(t, { CODE_COOLDOWN_MS: '60000' }, { durableObjectsPersist: directory }, false);
  const resumed = await client(t, mf);
  resumed.send({ t: 'resume', sid: session.sid, token: session.token });
  assert.equal((await resumed.next('error')).code, 'session_ended');
  const after = await inspect();
  assert.equal(after.length, 1);
  assert.equal(after[0][0], `code:${session.code}`);
  assert.ok(after[0][1] > Date.now());
  assert.ok(after[0][1] <= Date.now() + 60000);
  const next = await host(t, mf);
  assert.notEqual(next.session.code, session.code);
});

test('ended code reservations are deleted after their cooldown', async (t) => {
  const mf = await runtime(t, { CODE_COOLDOWN_MS: '100', SWEEP_MS: '50' });
  const { socket: h, session } = await host(t, mf);
  h.send({ t: 'end' });
  await h.next('ended');
  const ns = await mf.getDurableObjectNamespace('QRIPPLE_HUB');
  let saved;
  const deadline = Date.now() + 3000;
  do {
    saved = await (await ns.getByName('global').fetch('https://hub/__inspect')).json();
    if (!saved.length) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  assert.deepEqual(saved, [], `expired reservation ${session.code} must be removed`);
});
