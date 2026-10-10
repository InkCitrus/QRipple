import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkSegments } from '../public/js/linkify.js';

const links = (text) => linkSegments(text).filter((s) => s.href).map((s) => s.href);
const roundTrips = (text) => assert.equal(linkSegments(text).map((s) => s.text).join(''), text);

test('a bare URL becomes one link', () => {
  assert.deepEqual(linkSegments('https://example.com/a?b=1#c'), [
    { text: 'https://example.com/a?b=1#c', href: 'https://example.com/a?b=1#c' },
  ]);
});

test('URLs inside text, with trailing punctuation left out', () => {
  const text = '访问 https://example.cn/路径，或 http://ex.com/x. Done (see https://w.org/page).';
  assert.deepEqual(links(text), [
    'https://example.cn/%E8%B7%AF%E5%BE%84',
    'http://ex.com/x',
    'https://w.org/page',
  ]);
  roundTrips(text);
});

test('balanced parentheses stay part of the URL', () => {
  assert.deepEqual(links('https://en.wikipedia.org/wiki/QR_(code)'), ['https://en.wikipedia.org/wiki/QR_(code)']);
});

test('non-web schemes and plain text are never linked', () => {
  for (const text of [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'WIFI:S:Office;T:WPA;P:secret;;',
    'file:///etc/passwd',
    'hello world',
    'https://',
  ]) {
    assert.deepEqual(links(text), [], text);
    roundTrips(text);
  }
});

test('scheme matching is case-insensitive', () => {
  assert.deepEqual(links('HTTPS://EXAMPLE.COM/A'), ['https://example.com/A']);
});
