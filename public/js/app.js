// Entry point: client-side routing between the home, share and join views.

import { applyI18n, getLang, setLang } from './i18n.js';
import { mountShare } from './share.js';
import { mountJoin } from './join.js';
import { mountSettings } from './ui.js';

const routes = {
  '/': { view: 'home' },
  '/share': { view: 'share', mount: mountShare },
  '/join': { view: 'join', mount: mountJoin },
};
// An invite link (/24914) opens the join view and joins that session.
const INVITE_RE = /^\/(\d{5})$/;

let current = null; // { path, controller }

function routeFor(pathname) {
  return routes[pathname] || INVITE_RE.test(pathname) ? pathname : '/';
}

function render(force = false) {
  const path = routeFor(location.pathname);
  if (!force && current?.path === path) return;
  current?.controller?.unmount();
  const code = INVITE_RE.exec(path)?.[1];
  const route = code ? routes['/join'] : routes[path];
  for (const section of document.querySelectorAll('[data-view]')) {
    section.hidden = section.dataset.view !== route.view;
  }
  const root = document.querySelector(`[data-view="${route.view}"]`);
  const controller = route.mount ? route.mount(root, { navigate, code }) : null;
  current = { path, controller };
  window.scrollTo(0, 0);
}

export function navigate(path, { force = false } = {}) {
  const target = routeFor(path);
  const sameView = current?.path === target;
  if (current?.controller?.canLeave && (!sameView || force) && !current.controller.canLeave()) return;
  if (location.pathname !== path) history.pushState(null, '', path);
  render(force);
}

document.addEventListener('click', (event) => {
  const link = event.target.closest('a[data-link]');
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
  event.preventDefault();
  navigate(new URL(link.href).pathname, { force: link.hasAttribute('data-reset') });
});

window.addEventListener('popstate', () => {
  const target = routeFor(location.pathname);
  if (current && current.path !== target && current.controller?.canLeave && !current.controller.canLeave()) {
    // Stay: put the current page back on top of the history stack.
    history.pushState(null, '', current.path);
    return;
  }
  render();
});

const langToggle = document.getElementById('lang-toggle');
function syncLangToggle() {
  const zh = getLang() === 'zh';
  langToggle.textContent = zh ? 'EN' : '中文';
  // Named in the language it switches to, so readers of either can find it.
  langToggle.setAttribute('aria-label', zh ? 'Switch to English' : '切换到中文');
  langToggle.lang = zh ? 'en' : 'zh-CN';
}
langToggle.addEventListener('click', () => {
  setLang(getLang() === 'zh' ? 'en' : 'zh');
  syncLangToggle();
});

applyI18n();
syncLangToggle();
mountSettings();
render(true);
