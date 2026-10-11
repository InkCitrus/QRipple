import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

// Exercise the UI's event handlers and browser API boundary without adding a
// DOM dependency to the Node test suite. Real-browser checks cover the markup.
class Element extends EventTarget {
  textContent = '';
  hidden = true;
  disabled = false;
}

const originalGlobals = Object.fromEntries(
  ['navigator', 'localStorage', 'document', 'window'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
);
const stored = new Map([['qripple.launch', 'com.chaoxing.mobile.xuezaixidian']]);
const navigator = { userAgent: 'Mozilla/5.0 (Linux; Android 15) EdgA/130', language: 'zh-CN' };
let toast;
let shared;
const window = { location: { href: 'https://qripple.example/join' }, prompt: () => assert.fail('Android must not prompt for a package') };
for (const [name, value] of Object.entries({
  navigator,
  window,
  localStorage: {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
    removeItem: (key) => stored.delete(key),
  },
  document: { querySelector: () => toast },
})) Object.defineProperty(globalThis, name, { value, configurable: true });

const { mountLaunch } = await import('../public/js/ui.js');
const link = 'https://mobilelearn.chaoxing.com/widget/sign/e?id=example&c=example&enc=EXAMPLE&DB_STRATEGY=PRIMARY_KEY&STRATEGY_PARA=id';
const payload = (text) => ({ text, bytes: new TextEncoder().encode(text) });
const settle = () => new Promise(setImmediate);

function mount(text = link) {
  const elements = Object.fromEntries(
    ['run', 'share', 'share-note', 'label', 'note', 'target', 'change'].map((name) => [`.launch-${name}`, new Element()]),
  );
  let current = text === null ? null : payload(text);
  const controller = mountLaunch({ querySelector: (selector) => elements[selector] }, () => current);
  controller.render();
  return {
    ...controller,
    share: elements['.launch-share'],
    run: elements['.launch-run'],
    note: elements['.launch-note'],
    shareNote: elements['.launch-share-note'],
    update(next) { current = next; controller.render(); },
  };
}

beforeEach(() => {
  toast = new Element();
  shared = [];
  navigator.userAgent = 'Mozilla/5.0 (Linux; Android 15) EdgA/130';
  navigator.share = async (data) => { shared.push(data); };
  delete navigator.canShare;
});
after(() => {
  for (const [name, descriptor] of Object.entries(originalGlobals)) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
});

test('Android shares the first link exactly once and ignores a previously saved package', async () => {
  const ui = mount(`签到 ${link} 另一个 https://example.com/`);
  assert.equal(ui.share.hidden, false);
  assert.equal(ui.share.disabled, false);
  assert.equal(ui.run.hidden, true);
  assert.equal(ui.note.hidden, true);
  ui.share.dispatchEvent(new Event('click'));
  assert.deepEqual(shared, [{ url: link }], 'share runs synchronously in the user click, with no duplicated text');
  await settle();
  assert.equal(ui.share.disabled, false);
  ui.unmount();
});

test('a pending share keeps its original link, prevents reentry, and the next click uses the latest payload', async () => {
  let finish;
  navigator.share = (data) => {
    shared.push(data);
    return new Promise((resolve) => { finish = resolve; });
  };
  const ui = mount();
  ui.share.dispatchEvent(new Event('click'));
  const next = 'https://example.com/new?value=2#section';
  ui.update(payload(next));
  assert.equal(ui.share.disabled, true);
  ui.share.dispatchEvent(new Event('click'));
  assert.deepEqual(shared, [{ url: link }]);
  finish();
  await settle();
  ui.share.dispatchEvent(new Event('click'));
  assert.deepEqual(shared, [{ url: link }, { url: next }]);
  finish();
  await settle();
  ui.unmount();
});

test('canceling the system share sheet is silent and allows retry', async () => {
  navigator.share = async () => { throw new DOMException('Canceled', 'AbortError'); };
  const ui = mount();
  ui.share.dispatchEvent(new Event('click'));
  await settle();
  assert.equal(toast.hidden, true);
  assert.equal(ui.share.disabled, false);
  navigator.share = async (data) => { shared.push(data); };
  ui.share.dispatchEvent(new Event('click'));
  await settle();
  assert.deepEqual(shared, [{ url: link }]);
  ui.unmount();
});

test('a share error gives feedback and restores the button', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  navigator.share = async () => { throw new DOMException('Blocked', 'NotAllowedError'); };
  const ui = mount();
  ui.share.dispatchEvent(new Event('click'));
  await settle();
  assert.equal(toast.hidden, false);
  assert.match(toast.textContent, /分享失败/);
  assert.equal(ui.share.disabled, false);
  ui.unmount();
});

test('missing APIs, rejected data, and non-web payloads cannot start a share', () => {
  const ui = mount();
  navigator.canShare = () => false;
  ui.render();
  assert.equal(ui.share.disabled, true);
  navigator.canShare = () => { throw new Error('Unsupported'); };
  ui.render();
  assert.equal(ui.share.disabled, true);
  delete navigator.canShare;
  for (const text of [null, 'plain text', 'javascript:alert(1)', 'intent://example.com/']) {
    ui.update(text === null ? null : payload(text));
    assert.equal(ui.share.disabled, true);
    ui.share.dispatchEvent(new Event('click'));
  }
  ui.update({ text: '', bytes: new TextEncoder().encode(link) });
  assert.equal(ui.share.disabled, false, 'UTF-8 bytes work when the decoder provided no text');
  delete navigator.share;
  ui.render();
  assert.equal(ui.share.disabled, true);
  assert.match(ui.shareNote.textContent, /HTTPS/);
  assert.deepEqual(shared, []);
  ui.unmount();
});

test('unmounting detaches sharing and suppresses feedback from a pending request', async () => {
  let reject;
  navigator.share = () => new Promise((_, fail) => { reject = fail; });
  const ui = mount();
  ui.share.dispatchEvent(new Event('click'));
  ui.unmount();
  reject(new Error('View closed'));
  await settle();
  assert.equal(toast.hidden, true);
  navigator.share = async (data) => { shared.push(data); };
  ui.share.dispatchEvent(new Event('click'));
  assert.deepEqual(shared, []);
});

test('Apple devices keep shortcut configuration and pass the full content; desktop hides both actions', () => {
  navigator.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)';
  const text = `备注\n${link}`;
  const ui = mount(text);
  assert.equal(ui.share.hidden, true);
  assert.equal(ui.run.hidden, false);
  window.prompt = () => '分享给学在西电';
  // Change the shortcut name through the existing UI action.
  ui.unmount();
  const elements = Object.fromEntries(
    ['run', 'share', 'share-note', 'label', 'note', 'target', 'change'].map((name) => [`.launch-${name}`, new Element()]),
  );
  const apple = mountLaunch({ querySelector: (selector) => elements[selector] }, () => payload(text));
  elements['.launch-change'].dispatchEvent(new Event('click'));
  elements['.launch-run'].dispatchEvent(new Event('click'));
  const url = new URL(window.location.href);
  assert.equal(url.protocol, 'shortcuts:');
  assert.equal(url.searchParams.get('name'), '分享给学在西电');
  assert.equal(url.searchParams.get('text'), text);
  apple.unmount();
  navigator.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
  const desktop = mount();
  assert.equal(desktop.share.hidden, true);
  assert.equal(desktop.shareNote.hidden, true);
  assert.equal(desktop.run.hidden, true);
  desktop.unmount();
});
