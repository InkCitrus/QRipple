// Small DOM and formatting helpers shared by the views.

import { getLang, t } from './i18n.js';
import { linkSegments } from './linkify.js';
import { payloadText } from './payload.js';
import { firstLink, launchPlatform, shortcutUrl } from './launch.js';

export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

const linkified = new WeakMap(); // element -> text it currently shows with links

/**
 * Show text with its http(s) URLs as links (opened in a new tab). Built from
 * text nodes and <a> elements only, never HTML, since QR content is untrusted.
 */
export function setLinkedText(el, text) {
  if (linkified.get(el) === text && el.textContent === text) return;
  el.replaceChildren(
    ...linkSegments(text).map((segment) => {
      if (!segment.href) return document.createTextNode(segment.text);
      const a = document.createElement('a');
      a.href = segment.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer nofollow';
      a.textContent = segment.text;
      return a;
    }),
  );
  linkified.set(el, text);
}

let toastTimer = null;
export function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 2200);
}

export function formatClock(timestamp) {
  return new Date(timestamp).toLocaleTimeString(getLang() === 'zh' ? 'zh-CN' : 'en', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Connection status (and the access line in use) -> chip text and tone. */
export function connectionChip(el, status, line = null) {
  const tone = { online: 'ok', connecting: 'warn', reconnecting: 'warn', offline: 'bad', closed: 'bad' }[status] || 'warn';
  if (status === 'online' && line) setText(el, t('conn.onlineVia', { line: line.toUpperCase() }));
  else setText(el, t(status === 'closed' ? 'conn.offline' : `conn.${status}`));
  el.dataset.tone = tone;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for browsers without the async clipboard API.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

/** Copy a QR payload as text (full hex for binary data) and report the result. */
export async function copyPayload(text, bytes) {
  const ok = await copyText(payloadText(text, bytes));
  toast(t(ok ? 'common.copied' : 'common.copyFailed'));
}

// Apple devices can swap "Share link" for a Shortcuts shortcut in settings.
// The name keeps its original key so names saved before the switch existed
// are still filled in when it is turned on.
const SHORTCUT_NAME_KEY = 'qripple.launch';
const SHORTCUT_ON_KEY = 'qripple.shortcut';

function readPref(key) {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function writePref(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // private mode: the choice lasts until the page is closed
  }
}

const shortcut = { enabled: readPref(SHORTCUT_ON_KEY) === '1', name: readPref(SHORTCUT_NAME_KEY) };

function setShortcut(changes) {
  Object.assign(shortcut, changes);
  writePref(SHORTCUT_ON_KEY, shortcut.enabled ? '1' : '');
  writePref(SHORTCUT_NAME_KEY, shortcut.name);
  window.dispatchEvent(new Event('launchchange'));
}

let openSettings = () => {}; // set by mountSettings() where settings exist

/**
 * The settings dialog behind the header's gear button. Its only setting is
 * the shortcut switch, so the button only shows on Apple devices. Changes
 * apply as they are made.
 */
export function mountSettings() {
  const button = $('#settings-open');
  const dialog = $('#settings');
  const toggle = $('#settings-shortcut');
  const field = $('#settings-shortcut-field');
  const name = $('#settings-shortcut-name');
  if (launchPlatform(navigator.userAgent) !== 'apple' || typeof dialog.showModal !== 'function') return;

  openSettings = ({ focusName = false } = {}) => {
    toggle.checked = shortcut.enabled;
    name.value = shortcut.name;
    field.hidden = !shortcut.enabled;
    dialog.showModal();
    if (focusName && shortcut.enabled) name.focus();
  };
  button.hidden = false;
  button.addEventListener('click', () => openSettings());
  toggle.addEventListener('change', () => {
    field.hidden = !toggle.checked;
    setShortcut({ enabled: toggle.checked });
  });
  name.addEventListener('input', () => setShortcut({ name: name.value.trim() }));
  // A click on the backdrop lands on the dialog element itself.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

/**
 * Share the first web link through the system share sheet on Android and
 * Apple devices, or, when turned on in settings on Apple devices, hand the
 * whole QR content to a Shortcuts shortcut. Hidden elsewhere.
 * `getPayload()` returns the current { text, bytes } or null.
 */
export function mountLaunch(root, getPayload) {
  const run = $('.launch-run', root);
  const share = $('.launch-share', root);
  const shareNote = $('.launch-share-note', root);
  const label = $('.launch-label', root);
  const note = $('.launch-note', root);
  const target = $('.launch-target', root);
  const change = $('.launch-change', root);
  const platform = launchPlatform(navigator.userAgent);
  let sharing = false;
  let mounted = true;

  const useShortcut = () => platform === 'apple' && shortcut.enabled;

  function payloadLink() {
    const p = getPayload();
    return p ? firstLink(payloadText(p.text, p.bytes)) : null;
  }

  function canShareLink(link) {
    if (!link || typeof navigator.share !== 'function') return false;
    try {
      return !navigator.canShare || navigator.canShare({ url: link });
    } catch {
      return false;
    }
  }

  function launchUrl() {
    const p = getPayload();
    if (!p || !shortcut.name) return null;
    const text = payloadText(p.text, p.bytes);
    return shortcutUrl(shortcut.name, text);
  }

  function render() {
    const link = payloadLink();
    share.hidden = !platform || useShortcut();
    shareNote.hidden = share.hidden;
    share.disabled = sharing || !canShareLink(link);
    setText(shareNote, t(typeof navigator.share === 'function' ? 'launch.shareNote' : 'launch.shareUnsupported'));
    run.hidden = !useShortcut();
    note.hidden = run.hidden || !shortcut.name;
    if (run.hidden) return;
    setText(label, t(`launch.shortcuts.${shortcut.name ? 'run' : 'setup'}`));
    setText(target, shortcut.name ? t('launch.shortcuts.target', { name: shortcut.name }) : '');
    run.title = target.textContent;
    run.disabled = Boolean(shortcut.name) && !launchUrl();
  }

  function editTarget() {
    openSettings({ focusName: true });
  }

  function onRun() {
    if (!useShortcut()) return;
    if (!shortcut.name) {
      editTarget();
      return;
    }
    const url = launchUrl();
    if (!url) return;
    window.location.href = url;
  }

  async function onShare() {
    const link = payloadLink();
    if (!platform || useShortcut() || sharing || !canShareLink(link)) return;
    sharing = true;
    render();
    try {
      // Keep this call in the click handler: Web Share requires a user gesture.
      // Share the URL once; the system hands it to the chosen app as a link.
      // Web Share cannot preselect an app or confirm delivery.
      await navigator.share({ url: link });
    } catch (error) {
      if (mounted && error?.name !== 'AbortError') toast(t('launch.shareFailed'));
    } finally {
      sharing = false;
      if (mounted) render();
    }
  }

  run.addEventListener('click', onRun);
  share.addEventListener('click', onShare);
  change.addEventListener('click', editTarget);
  window.addEventListener('launchchange', render);
  return {
    render,
    unmount() {
      mounted = false;
      run.removeEventListener('click', onRun);
      share.removeEventListener('click', onShare);
      change.removeEventListener('click', editTarget);
      window.removeEventListener('launchchange', render);
    },
  };
}

/** Keep the screen on while a session is active (where supported). */
export function createWakeLock() {
  let sentinel = null;
  let wanted = false;

  async function acquire() {
    if (!wanted || sentinel || document.visibilityState !== 'visible' || !navigator.wakeLock) return;
    try {
      sentinel = await navigator.wakeLock.request('screen');
      sentinel.addEventListener('release', () => {
        sentinel = null;
      });
    } catch {
      sentinel = null;
    }
  }
  const onVisible = () => acquire();

  return {
    enable() {
      wanted = true;
      document.addEventListener('visibilitychange', onVisible);
      acquire();
    },
    disable() {
      wanted = false;
      document.removeEventListener('visibilitychange', onVisible);
      sentinel?.release().catch(() => {});
      sentinel = null;
    },
  };
}

export const storage = {
  get(key) {
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // storage unavailable; resume-after-reload just won't work
    }
  },
  remove(key) {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // ignore
    }
  },
};
