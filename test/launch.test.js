import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appIntentUrl, firstLink, isPackageName, launchPlatform, shortcutUrl } from '../public/js/launch.js';

// How Android's Intent.parseUri reads an intent URL: the intent part starts at the last "#".
function parseIntent(uri) {
  const i = uri.lastIndexOf('#');
  const fields = Object.fromEntries(
    uri
      .slice(i + '#Intent;'.length)
      .split(';')
      .filter((f) => f && f !== 'end')
      .map((f) => f.split('=')),
  );
  return { data: `${fields.scheme}:${uri.slice('intent:'.length, i)}`, ...fields };
}

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

test('intent URL opens the link in the given package', () => {
  const uri = appIntentUrl('https://example.com/a/b?q=1&r=2', 'org.mozilla.firefox');
  assert.equal(uri, 'intent://example.com/a/b?q=1&r=2#Intent;scheme=https;package=org.mozilla.firefox;end');
  assert.deepEqual(parseIntent(uri), {
    data: 'https://example.com/a/b?q=1&r=2',
    scheme: 'https',
    package: 'org.mozilla.firefox',
  });
  assert.equal(parseIntent(appIntentUrl('http://x.cn:8080/p', 'com.a.b')).data, 'http://x.cn:8080/p');
});

test('a fragment, even a fake intent, stays inside the link', () => {
  const uri = appIntentUrl('https://evil.example/#Intent;action=android.intent.action.CALL;end', 'com.a.b');
  const intent = parseIntent(uri);
  assert.equal(intent.data, 'https://evil.example/#Intent;action=android.intent.action.CALL;end');
  assert.equal(intent.package, 'com.a.b');
  assert.equal(intent.action, undefined);
});

test('intent URLs need an http(s) link and a valid package name', () => {
  assert.throws(() => appIntentUrl('javascript:alert(1)', 'com.a.b'));
  assert.throws(() => appIntentUrl('https://a.com/', 'com.a.b;end'));
  assert.throws(() => appIntentUrl('https://a.com/', 'firefox'));
});

test('package names', () => {
  for (const ok of ['com.tencent.mm', 'org.mozilla.firefox', 'com.example_app.v2']) assert.ok(isPackageName(ok), ok);
  for (const bad of ['', 'firefox', 'com..a', '.com.a', 'com.a.', '1com.a', 'com.a;x', 'com.a b', 'com.a/b']) {
    assert.ok(!isPackageName(bad), bad);
  }
});

test('first link in the content', () => {
  assert.equal(firstLink('看这个 https://a.cn/x，还有 https://b.cn/y'), 'https://a.cn/x');
  assert.equal(firstLink('no links, just text'), null);
});

test('platform from the user agent', () => {
  assert.equal(launchPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15'), 'shortcuts');
  assert.equal(launchPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'), 'shortcuts');
  assert.equal(launchPlatform('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130'), 'android');
  assert.equal(launchPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'), null);
});
