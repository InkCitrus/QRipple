// Small DOM and formatting helpers shared by the views.

import { getLang, t } from './i18n.js';
import { linkSegments } from './linkify.js';

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
