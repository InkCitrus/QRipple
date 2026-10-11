import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstLink, launchPlatform, shortcutUrl } from '../public/js/launch.js';

test('shortcut URL carries the name and the text as input', () => {
  assert.equal(shortcutUrl('Send', 'hello'), 'shortcuts://run-shortcut?name=Send&input=text&text=hello');
});

test('shortcut names and text are fully encoded', () => {
  const url = new URL(shortcutUrl('发到 微信 & 备忘', '第一行\nhttps://a.cn/x?y=1&z=2#frag +%'));
  assert.equal(url.searchParams.get('name'), '发到 微信 & 备忘');
  assert.equal(url.searchParams.get('input'), 'text');
  assert.equal(url.searchParams.get('text'), '第一行\nhttps://a.cn/x?y=1&z=2#frag +%');
  assert.equal(url.hash, '');
  assert.ok(!url.search.includes('+'), 'spaces are %20, not +');
});

test('first link in the content', () => {
  assert.equal(firstLink('看这个 https://a.cn/x，还有 https://b.cn/y'), 'https://a.cn/x');
  assert.equal(firstLink('no links, just text'), null);
});

test('platform from the user agent', () => {
  assert.equal(launchPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15'), 'apple');
  assert.equal(launchPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'), 'apple');
  assert.equal(launchPlatform('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130'), 'android');
  assert.equal(launchPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'), null);
});
