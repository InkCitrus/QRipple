// Small DOM and formatting helpers shared by the views.

import { getLang, t } from './i18n.js';
import { linkSegments } from './linkify.js';
import { payloadText } from './payload.js';
import { appIntentUrl, firstLink, isPackageName, launchPlatform, shortcutUrl } from './launch.js';

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
// On Android, still being on the page this long after the jump means it didn't
// happen: the browser blocked it (common in phone makers' own browsers and
// in-app browsers) or no app took the link. Opening an app hides the page.
const LAUNCH_TIMEOUT_MS = 2000;
let launchTarget = (() => {
  try {
    return localStorage.getItem(LAUNCH_KEY) || '';
  } catch {
    return '';
  }
})();

/**
 * "Open in app": hands the QR content to the app the user named once (kept in
 * this browser, shared by both views): a Shortcuts shortcut on Apple devices,
 * or an Android app (by package name) for the first web link. Hidden
 * elsewhere. `getPayload()` returns the current { text, bytes } or null.
 */
export function mountLaunch(root, getPayload) {
  const run = $('.launch-run', root);
  const label = $('.launch-label', root);
  const note = $('.launch-note', root);
  const target = $('.launch-target', root);
  const change = $('.launch-change', root);
  const hint = $('.launch-hint', root);
  const platform = launchPlatform(navigator.userAgent);
  let hintTimer = null;

  function launchUrl() {
    const p = getPayload();
    if (!p || !launchTarget) return null;
    const text = payloadText(p.text, p.bytes);
    if (platform === 'shortcuts') return shortcutUrl(launchTarget, text);
    const link = firstLink(text);
    return link && isPackageName(launchTarget) ? appIntentUrl(link, launchTarget) : null;
  }

  function render() {
    run.hidden = !platform;
    note.hidden = !platform || !launchTarget;
    if (!platform) return;
    setText(label, t(`launch.${platform}.${launchTarget ? 'run' : 'setup'}`));
    setText(target, launchTarget ? t(`launch.${platform}.target`, { name: launchTarget }) : '');
    run.title = target.textContent;
    run.disabled = Boolean(launchTarget) && !launchUrl();
    setText(hint, platform === 'android' ? t('launch.android.failed') : '');
  }

  function hideHint() {
    clearTimeout(hintTimer);
    hint.hidden = true;
  }

  function onVisibility() {
    if (document.visibilityState === 'hidden') hideHint(); // the app opened
  }

  function editTarget() {
    const input = window.prompt(t(`launch.${platform}.prompt`), launchTarget);
    if (input === null) return;
    const value = input.trim();
    if (value && platform === 'android' && !isPackageName(value)) {
      toast(t('launch.android.invalid'));
      return;
    }
    launchTarget = value;
    hideHint();
    try {
      if (value) localStorage.setItem(LAUNCH_KEY, value);
      else localStorage.removeItem(LAUNCH_KEY);
    } catch {
      // private mode: the choice lasts until the page is closed
    }
    render();
  }

  function onRun() {
    hideHint();
    if (!launchTarget) {
      editTarget();
      return;
    }
    const url = launchUrl();
    if (!url) return;
    window.location.href = url;
    if (platform === 'android') {
      hintTimer = setTimeout(() => {
        hint.hidden = false;
      }, LAUNCH_TIMEOUT_MS);
    }
  }

  run.addEventListener('click', onRun);
  change.addEventListener('click', editTarget);
  document.addEventListener('visibilitychange', onVisibility);
  return {
    render,
    unmount() {
      hideHint();
      run.removeEventListener('click', onRun);
      change.removeEventListener('click', editTarget);
      document.removeEventListener('visibilitychange', onVisibility);
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
