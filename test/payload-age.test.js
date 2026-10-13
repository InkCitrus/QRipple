import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PayloadAge, elapsedParts } from '../public/js/payload-age.js';

test('a late join includes server age and estimated transit, then advances without timer ticks', () => {
  let now = 100;
  const age = new PayloadAge(() => now);
  age.set({ rev: 1, ageMs: 12000 }, 180);
  assert.equal(age.elapsedMs, 12180);
  now += 65789; // a throttled/background tab misses every display callback
  assert.equal(age.elapsedMs, 77969);
});

test('clock adjustments cannot change the elapsed time', (t) => {
  let now = 0;
  const age = new PayloadAge(() => now);
  age.set({ rev: 1, ageMs: 2000 });
  t.mock.method(Date, 'now', () => 0);
  now = 3000;
  assert.equal(age.elapsedMs, 5000);
  Date.now.mock.mockImplementation(() => 1e15);
  assert.equal(age.elapsedMs, 5000);
});

test('reconnect preserves payload age; a new revision restarts it and ignores stale calibration', () => {
  const age = new PayloadAge(() => 0);
  age.set({ rev: 7, ageMs: 4000 });
  age.set({ rev: 7, ageMs: 12000 }, 100);
  assert.equal(age.elapsedMs, 12100);
  age.set({ rev: 8, ageMs: 0 }, 100);
  age.sync({ rev: 7, ageMs: 15000 }, 100);
  assert.equal(age.elapsedMs, 100);
  age.sync({ rev: 8, ageMs: 500 }, 100);
  assert.equal(age.elapsedMs, 600);
});

test('missing or invalid timing samples cannot spoil a valid age', () => {
  const age = new PayloadAge(() => 0);
  age.set({ rev: 1, ageMs: 1000 });
  for (const sample of [undefined, { rev: 1 }, { rev: 1, ageMs: NaN }]) age.sync(sample, 50);
  assert.equal(age.elapsedMs, 1000);
  age.set({ rev: 2, ageMs: -50 }, -100);
  assert.equal(age.elapsedMs, 0);
});

test('elapsed display retains seconds across minute and hour boundaries', () => {
  assert.deepEqual(elapsedParts(0), { h: 0, m: 0, s: 0 });
  assert.deepEqual(elapsedParts(59499), { h: 0, m: 0, s: 59 });
  assert.deepEqual(elapsedParts(59500), { h: 0, m: 1, s: 0 });
  assert.deepEqual(elapsedParts(3663000), { h: 1, m: 1, s: 3 });
  // 250 ms display refresh + nearest-second rounding stays within 0.75 s.
  for (let ms = 0; ms < 10000; ms += 10) {
    const displayedMs = elapsedParts(Math.floor(ms / 250) * 250).s * 1000;
    assert.ok(Math.abs(displayedMs - ms) <= 750);
  }
});
