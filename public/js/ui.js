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

const LAUNCH_KEY = 'qripple.launch';
let shortcutName = (() => {
  try {
    return localStorage.getItem(LAUNCH_KEY) || '';
  } catch {
    return '';
  }
})();

/**
 * Hand QR content to a saved Shortcuts shortcut on Apple devices, or share
 * the first web link through Android's system share sheet. Hidden elsewhere.
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
    if (!p || !shortcutName) return null;
    const text = payloadText(p.text, p.bytes);
    return shortcutUrl(shortcutName, text);
  }

  function render() {
    const link = payloadLink();
    share.hidden = platform !== 'android';
    shareNote.hidden = share.hidden;
    share.disabled = sharing || !canShareLink(link);
    setText(shareNote, t(typeof navigator.share === 'function' ? 'launch.android.shareNote' : 'launch.android.shareUnsupported'));
    run.hidden = platform !== 'shortcuts';
    note.hidden = run.hidden || !shortcutName;
    if (run.hidden) return;
    setText(label, t(`launch.shortcuts.${shortcutName ? 'run' : 'setup'}`));
    setText(target, shortcutName ? t('launch.shortcuts.target', { name: shortcutName }) : '');
    run.title = target.textContent;
    run.disabled = Boolean(shortcutName) && !launchUrl();
  }

  function editTarget() {
    const input = window.prompt(t('launch.shortcuts.prompt'), shortcutName);
    if (input === null) return;
    const value = input.trim();
    shortcutName = value;
    try {
      if (value) localStorage.setItem(LAUNCH_KEY, value);
      else localStorage.removeItem(LAUNCH_KEY);
    } catch {
      // private mode: the choice lasts until the page is closed
    }
    render();
  }

  function onRun() {
    if (platform !== 'shortcuts') return;
    if (!shortcutName) {
      editTarget();
      return;
    }
    const url = launchUrl();
    if (!url) return;
    window.location.href = url;
  }

  async function onShare() {
    const link = payloadLink();
    if (platform !== 'android' || sharing || !canShareLink(link)) return;
    sharing = true;
    render();
    try {
      // Keep this call in the click handler: Web Share requires a user gesture.
      // Share the URL once; Android supplies it to the selected app as a link.
      // Web Share cannot preselect an Android package or confirm app delivery.
      await navigator.share({ url: link });
    } catch (error) {
      if (mounted && error?.name !== 'AbortError') toast(t('launch.android.shareFailed'));
    } finally {
      sharing = false;
      if (mounted) render();
    }
  }

  run.addEventListener('click', onRun);
  share.addEventListener('click', onShare);
  change.addEventListener('click', editTarget);
  return {
    render,
    unmount() {
      mounted = false;
      run.removeEventListener('click', onRun);
      share.removeEventListener('click', onShare);
      change.removeEventListener('click', editTarget);
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
