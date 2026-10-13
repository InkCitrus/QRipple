import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const originals = Object.fromEntries(['window', 'document', 'navigator', 'location', 'localStorage', 'WebSocket']
  .map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const document = Object.assign(new EventTarget(), {
  visibilityState: 'visible', querySelector: () => ({ content: '[]' }),
});
class Socket {
  static OPEN = 1;
  static all = [];
  readyState = 0;
  sent = [];
  constructor() {
    Socket.all.push(this);
    queueMicrotask(() => { this.readyState = 1; this.onopen?.(); });
  }
  send(raw) { this.sent.push(JSON.parse(raw)); }
  receive(msg) { this.onmessage?.({ data: JSON.stringify(msg) }); }
  close() { this.readyState = 3; this.onclose?.(); }
}
for (const [name, value] of Object.entries({
  window: new EventTarget(), document, navigator: { onLine: true },
  location: { protocol: 'https:', host: 'qr.example' },
  localStorage: { getItem: () => null, setItem() {} }, WebSocket: Socket,
})) Object.defineProperty(globalThis, name, { value, configurable: true });
after(() => {
  for (const [name, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
});
const { Connection } = await import('../public/js/connection.js');

test('timing probes estimate transit, ignore old replies, refresh on visibility, and stop on unmount', async (t) => {
  let now = 100;
  t.mock.method(performance, 'now', () => now);
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const samples = [];
  const conn = new Connection({
    onOpen: () => conn.send({ t: 'join', code: '12345' }),
    onTiming: (sample, transit) => samples.push({ sample, transit }),
  }).start();
  t.after(() => conn.stop());
  await new Promise(setImmediate);
  const ws = Socket.all.at(-1);
  assert.equal(ws.sent[0].t, 'join', 'probe follows session binding');
  const probe = ws.sent[1];
  assert.equal(probe.t, 'ping');
  now = 1300; // 1.2 s RTT
  const sample = { rev: 3, ageMs: 10000 };
  ws.receive({ t: 'pong', id: probe.id, timing: sample });
  assert.equal(conn.latencyMs, 600);
  assert.deepEqual(samples, [{ sample, transit: 600 }]);
  ws.receive({ t: 'pong', id: probe.id, timing: sample });
  assert.equal(samples.length, 1, 'duplicate replies do not recalibrate');

  now = 10100;
  ws.receive({ t: 'payload', payload: { rev: 4 } }); // busy traffic still needs calibration
  t.mock.timers.tick(10000);
  assert.equal(ws.sent.at(-1).t, 'ping');
  assert.notEqual(ws.sent.at(-1).id, probe.id);
  const count = ws.sent.length;
  document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(ws.sent.length, count + 1);
  conn.stop();
  t.mock.timers.tick(20000);
  document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(ws.sent.length, count + 1, 'stop removes timers and visibility listener');
});
