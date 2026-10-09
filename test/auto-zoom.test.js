import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AutoZoom } from '../public/js/auto-zoom.js';

const box = (cx, cy, half) => ({
  center: [cx, cy],
  quad: [
    [cx - half, cy - half],
    [cx + half, cy - half],
    [cx + half, cy + half],
    [cx - half, cy + half],
  ],
});

test('a code that keeps failing to read near the center triggers one zoom step', () => {
  const z = new AutoZoom();
  const small = box(0.52, 0.48, 0.05);
  assert.equal(z.update({ failed: [small] }, 0), null);
  assert.equal(z.update({ failed: [small] }, 100), null);
  assert.equal(z.update({ failed: [small] }, 200), 1.4);
  // Settling: no further change straight away even if it still fails.
  assert.equal(z.update({ failed: [box(0.53, 0.47, 0.07)] }, 300), null);
});

test('zoom steps up while failures persist, capped at max', () => {
  const z = new AutoZoom({ max: 2 });
  let t = 0;
  const levels = [];
  for (let i = 0; i < 40; i++) {
    t += 100;
    const level = z.update({ failed: [box(0.5, 0.5, 0.04)] }, t);
    if (level) levels.push(level);
  }
  assert.deepEqual(levels, [1.4, 2]);
  assert.ok(z.wantsCloser, 'at max zoom it asks the user to move closer');
});

test('does not zoom in if another code would leave the frame', () => {
  const z = new AutoZoom();
  const failing = box(0.5, 0.5, 0.04);
  const nearEdge = box(0.85, 0.5, 0.1); // would be pushed past the right edge at 1.4x
  for (let t = 0; t <= 400; t += 100) assert.equal(z.update({ codes: [nearEdge], failed: [failing] }, t), null);
});

test('random one-off failures in different spots do not zoom', () => {
  const z = new AutoZoom();
  assert.equal(z.update({ failed: [box(0.2, 0.2, 0.03)] }, 0), null);
  assert.equal(z.update({ failed: [box(0.7, 0.3, 0.03)] }, 100), null);
  assert.equal(z.update({ failed: [box(0.4, 0.8, 0.03)] }, 200), null);
});

test('zooms out when a code overflows, and resets after nothing is seen', () => {
  const z = new AutoZoom();
  for (let t = 0; t <= 200; t += 100) z.update({ failed: [box(0.5, 0.5, 0.05)] }, t);
  assert.equal(z.zoom, 1.4);
  // Code now fills the frame: still settling right after the change...
  assert.equal(z.update({ codes: [box(0.5, 0.5, 0.46)] }, 600), null);
  // ...then step back out.
  assert.equal(z.update({ codes: [box(0.5, 0.5, 0.46)] }, 1100), 1);
  z.zoom = 2;
  z.lastChange = 0;
  assert.equal(z.update({ codes: [box(0.5, 0.5, 0.46)] }, 2000), 2 / 1.4);
  // Nothing in view for longer than idleResetMs: back to 1x.
  assert.equal(z.update({}, 4000), null);
  assert.equal(z.update({}, 5100), 1);
});

test('a manual reset pauses auto-zoom', () => {
  const z = new AutoZoom();
  z.pause(5000);
  for (let t = 0; t < 5000; t += 100) assert.equal(z.update({ failed: [box(0.5, 0.5, 0.04)] }, t), null);
});

test('asks the user to move closer only when nothing could be read', () => {
  const z = new AutoZoom({ max: 1 }); // camera without zoom
  for (let t = 0; t <= 200; t += 100) z.update({ failed: [box(0.5, 0.5, 0.04)] }, t);
  assert.ok(z.wantsCloser);
  z.update({ codes: [box(0.3, 0.3, 0.1)], failed: [box(0.5, 0.5, 0.04)] }, 300);
  assert.ok(!z.wantsCloser, 'another code is readable: no nagging');
});
