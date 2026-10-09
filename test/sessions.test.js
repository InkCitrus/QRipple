import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from '../server/sessions.js';
import { KeyedLimiter } from '../server/ratelimit.js';
import { clientIp } from '../server/app.js';

function store(overrides = {}) {
  let t = 1_000_000;
  const clock = { advance: (ms) => (t += ms) };
  const s = new SessionStore({
    sessionTtlMs: 1000,
    hostGraceMs: 100,
    codeCooldownMs: 500,
    maxSessions: 10,
    now: () => t,
    ...overrides,
  });
  return { s, clock };
}

test('codes are unique five-digit strings', () => {
  const { s } = store({ maxSessions: 500 });
  const codes = new Set();
  for (let i = 0; i < 500; i++) {
    const session = s.create();
    assert.match(session.code, /^[1-9]\d{4}$/);
    codes.add(session.code);
  }
  assert.equal(codes.size, 500);
  assert.equal(s.create(), null, 'capacity reached');
});

test('ended codes are not reused during the cooldown', () => {
  const { s, clock } = store({ maxSessions: 1 });
  const first = s.create();
  s.end(first);
  for (let i = 0; i < 200; i++) {
    const next = s.create();
    assert.notEqual(next.code, first.code);
    s.end(next);
  }
  clock.advance(500);
  s.pruneCooldown();
  assert.ok(!s.cooldown.has(first.code));
});

test('payload dedupe and token check', () => {
  const { s } = store();
  const session = s.create();
  assert.ok(session.setPayload({ text: 'a', data: 'YQ==' }, 1));
  assert.equal(session.setPayload({ text: 'a', data: 'YQ==' }, 2), null);
  assert.equal(session.rev, 1);
  assert.ok(session.checkToken(session.token));
  assert.ok(!session.checkToken('nope'));
  assert.ok(!session.checkToken(undefined));
});

test('due() reports expiry and host timeout', () => {
  const { s, clock } = store();
  const a = s.create();
  a.host = {}; // connected sharer
  const b = s.create(); // sharer never connected
  clock.advance(100);
  assert.deepEqual(s.due().map(([x, r]) => [x.code, r]), [[b.code, 'host_left']]);
  clock.advance(900);
  assert.deepEqual(new Set(s.due().map(([, r]) => r)), new Set(['expired']));
});

test('keyed limiter refills over time', () => {
  let t = 0;
  const limiter = new KeyedLimiter({ capacity: 2, refillMs: 100, now: () => t });
  assert.ok(limiter.take('ip'));
  assert.ok(limiter.take('ip'));
  assert.ok(!limiter.take('ip'));
  assert.ok(!limiter.allowed('ip'));
  t += 100;
  assert.ok(limiter.allowed('ip'));
  assert.ok(limiter.take('ip'));
  t += 1000;
  limiter.prune();
  assert.equal(limiter.buckets.size, 0);
});

test('client IP honours only the trusted proxy hops', () => {
  const req = (xff) => ({ socket: { remoteAddress: '10.0.0.1' }, headers: { 'x-forwarded-for': xff } });
  assert.equal(clientIp(req('1.1.1.1'), 0), '10.0.0.1');
  assert.equal(clientIp(req('6.6.6.6, 2.2.2.2'), 1), '2.2.2.2');
  assert.equal(clientIp(req('6.6.6.6, 2.2.2.2, 3.3.3.3'), 2), '2.2.2.2');
  assert.equal(clientIp(req(''), 1), '10.0.0.1');
});
