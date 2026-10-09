import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createApp, parseLine } from '../server/app.js';

// Two access lines in front of one server, plus a main page origin.
const app = createApp(
  {
    lines: ['tk.example.test', 'az.example.test'],
    allowedOrigins: ['https://main.example.test'],
    sweepMs: 60_000,
    heartbeatMs: 60_000,
  },
  { log: () => {} },
);
// Two listen addresses (like 127.0.0.1 + a Tailscale IP) sharing one hub.
await app.listen(0, ['127.0.0.1', '127.0.0.1']);
const [a, b] = app.addresses;
after(() => app.close());

function open(port, origin) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, origin ? { origin } : {});
  const queue = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    const w = waiters.shift();
    if (w) w(msg);
    else queue.push(msg);
  });
  return {
    ws,
    result: new Promise((resolve) => {
      ws.once('open', () => resolve('open'));
      ws.once('unexpected-response', (_req, res) => resolve(res.statusCode));
    }),
    send: (msg) => ws.send(JSON.stringify(msg)),
    next: () => (queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve) => waiters.push(resolve))),
  };
}

test('lines.json lists the access lines as WebSocket URLs', async () => {
  const res = await fetch(`http://127.0.0.1:${a.port}/lines.json`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    lines: [
      { id: 'tk', url: 'wss://tk.example.test/ws' },
      { id: 'az', url: 'wss://az.example.test/ws' },
    ],
  });
});

test('pages may connect to every line (CSP connect-src)', async () => {
  const res = await fetch(`http://127.0.0.1:${a.port}/`);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /connect-src [^;]*wss:\/\/tk\.example\.test/);
  assert.match(csp, /connect-src [^;]*wss:\/\/az\.example\.test/);
});

test('WebSocket origins: main page and every line are allowed, others are not', async () => {
  for (const origin of ['https://main.example.test', 'https://tk.example.test', 'https://az.example.test']) {
    const c = open(a.port, origin);
    assert.equal(await c.result, 'open', origin);
    c.ws.close();
  }
  assert.equal(await open(a.port, 'https://evil.example').result, 403);
});

test('a sharer on one listener and a receiver on another share the session', async () => {
  const host = open(a.port, 'https://main.example.test');
  await host.result;
  host.send({ t: 'create' });
  const created = await host.next();
  assert.equal(created.t, 'created');

  const receiver = open(b.port, 'https://main.example.test');
  await receiver.result;
  receiver.send({ t: 'join', code: created.code });
  assert.equal((await receiver.next()).t, 'joined');

  host.send({ t: 'update', text: 'hi', data: Buffer.from('hi').toString('base64') });
  const msg = await receiver.next();
  assert.equal(msg.t, 'payload');
  assert.equal(msg.payload.text, 'hi');
  host.ws.close();
  receiver.ws.close();
});

test('line entries may be hostnames or full WebSocket URLs', () => {
  assert.deepEqual(parseLine('tk.example.test'), {
    id: 'tk',
    url: 'wss://tk.example.test/ws',
    origin: 'https://tk.example.test',
    connectSrc: 'wss://tk.example.test',
  });
  assert.deepEqual(parseLine('ws://az.localhost:3000/ws'), {
    id: 'az',
    url: 'ws://az.localhost:3000/ws',
    origin: 'http://az.localhost:3000',
    connectSrc: 'ws://az.localhost:3000',
  });
});

test('the page embeds the access lines, so clients need no extra request', async () => {
  const html = await (await fetch(`http://127.0.0.1:${a.port}/share`)).text();
  const meta = html.match(/<meta name="qripple-lines" content="([^"]*)">/);
  assert.ok(meta, 'meta tag present');
  const lines = JSON.parse(meta[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&amp;/g, '&'));
  assert.deepEqual(lines, [
    { id: 'tk', url: 'wss://tk.example.test/ws' },
    { id: 'az', url: 'wss://az.example.test/ws' },
  ]);
});
