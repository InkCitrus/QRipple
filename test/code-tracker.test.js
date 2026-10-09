import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CodeTracker } from '../public/js/code-tracker.js';

const code = (key, x = 0.5, y = 0.5) => ({
  key,
  text: key,
  bytes: new Uint8Array([1]),
  center: [x, y],
  quad: [
    [x - 0.1, y - 0.1],
    [x + 0.1, y - 0.1],
    [x + 0.1, y + 0.1],
    [x - 0.1, y + 0.1],
  ],
});

test('a single code is shared on its first read', () => {
  const t = new CodeTracker();
  assert.equal(t.update([code('A')], 0)?.key, 'A');
  assert.equal(t.update([code('A')], 60), null, 'unchanged code is not re-shared');
  assert.equal(t.current.key, 'A');
});

test('a changed code needs two reads, tolerating missed frames but not conflicting reads', () => {
  const t = new CodeTracker();
  t.update([code('A')], 0);
  assert.equal(t.update([code('B')], 1000), null);
  assert.equal(t.update([], 1060), null); // missed frame
  assert.equal(t.update([code('B')], 1120)?.key, 'B');

  assert.equal(t.update([code('C')], 2000), null);
  assert.equal(t.update([code('D')], 2060), null, 'a conflicting read restarts the count');
  assert.equal(t.current.key, 'B');
  assert.equal(t.update([code('D')], 2120)?.key, 'D');
});

test('reads too far apart do not confirm a change', () => {
  const t = new CodeTracker({ confirmWindowMs: 500 });
  t.update([code('A')], 0);
  t.update([code('B')], 1000);
  assert.equal(t.update([code('B')], 1600), null);
  assert.equal(t.update([code('B')], 1700)?.key, 'B');
});

test('several codes: nothing is shared until the user picks one', () => {
  const t = new CodeTracker();
  assert.equal(t.update([code('A', 0.3), code('B', 0.7)], 0), null);
  assert.equal(t.current, null);
  assert.ok(t.needsChoice);
  assert.deepEqual(t.visible.map((c) => c.key), ['A', 'B']);

  assert.equal(t.choose('B', 10)?.key, 'B');
  assert.ok(!t.needsChoice);
  for (let i = 1; i <= 10; i++) assert.equal(t.update([code('A', 0.3), code('B', 0.7)], 10 + i * 60), null);
  // A frame that only catches the other code must not switch away.
  assert.equal(t.update([code('A', 0.3)], 700), null);
  assert.equal(t.update([code('A', 0.3)], 760), null);
  assert.equal(t.current.key, 'B');
});

test('a followed code that refreshes in place is followed; its neighbour is not', () => {
  const t = new CodeTracker();
  t.update([code('A', 0.3), code('B', 0.7)], 0);
  t.choose('B', 10);
  t.update([code('A', 0.3), code('B', 0.7)], 60);
  // B refreshes to B2 at the same spot.
  assert.equal(t.update([code('A', 0.3), code('B2', 0.71)], 120), null);
  assert.equal(t.update([code('A', 0.3), code('B2', 0.71)], 180)?.key, 'B2');
  assert.equal(t.selection.key, 'B2');
});

test('a long-visible neighbour is not mistaken for the followed code', () => {
  const t = new CodeTracker({ sameSpot: 0.5 });
  t.update([code('A', 0.4), code('B', 0.6)], 0);
  t.choose('B', 10);
  t.update([code('A', 0.4), code('B', 0.6)], 60);
  // B is missed for a few frames; A is close by but was there all along.
  for (let i = 0; i < 5; i++) assert.equal(t.update([code('A', 0.4)], 120 + i * 60), null);
  assert.equal(t.current.key, 'B');
});

test('when the other codes leave, the remaining one is shared again automatically', () => {
  const t = new CodeTracker({ seenMs: 300 });
  t.update([code('A', 0.3), code('B', 0.7)], 0);
  t.choose('A', 10);
  // Only B stays in view; A is forgotten after seenMs and B becomes the only code.
  let shared = null;
  for (let now = 100; now <= 1000 && !shared; now += 60) shared = t.update([code('B', 0.7)], now);
  assert.equal(shared?.key, 'B');
});

test('choosing the code already shared just follows it', () => {
  const t = new CodeTracker();
  t.update([code('A', 0.3)], 0);
  t.update([code('A', 0.3), code('B', 0.7)], 60);
  assert.equal(t.choose('A', 70), null);
  assert.equal(t.choose('missing', 80), null);
  assert.equal(t.current.key, 'A');
});

test('codes that appear together are numbered in on-screen reading order, then keep their numbers', () => {
  const t = new CodeTracker();
  t.update([code('R', 0.7, 0.5), code('L', 0.3, 0.52), code('TOP', 0.6, 0.1)], 0);
  assert.deepEqual(t.visible.map((c) => c.key), ['TOP', 'L', 'R']);
  // Moving the camera does not renumber codes already in view.
  t.update([code('R', 0.2, 0.5), code('L', 0.8, 0.5), code('TOP', 0.6, 0.1)], 60);
  assert.deepEqual(t.visible.map((c) => c.key), ['TOP', 'L', 'R']);
});
