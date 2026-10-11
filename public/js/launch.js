// Hand the QR content to an app the user picks once: a Shortcuts shortcut on
// iPhone, iPad and Mac (it gets the whole content as input), or an Android app
// by package name (it opens the first web link). Pure logic, unit-tested in Node.

import { linkSegments } from './linkify.js';

const PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

/** 'android', 'shortcuts' (Apple devices; an iPad may report itself as a Mac) or null. */
export function launchPlatform(userAgent) {
  if (/Android/.test(userAgent)) return 'android';
  if (/iPhone|iPad|iPod|Macintosh/.test(userAgent)) return 'shortcuts';
  return null;
}

/** URL that runs the shortcut called `name` with `text` as its input. */
export function shortcutUrl(name, text) {
  return `shortcuts://run-shortcut?name=${encodeURIComponent(name)}&input=text&text=${encodeURIComponent(text)}`;
}

export function isPackageName(value) {
  return PACKAGE_RE.test(value);
}

/** The first http(s) link in the text, or null. */
export function firstLink(text) {
  return linkSegments(text).find((segment) => segment.href)?.href ?? null;
}

/**
 * Android intent URL that opens the http(s) `link` in the app `pkg`. When the
 * app is missing or can't open that link, Chrome shows its Play Store page.
 * Android reads the intent from the last "#", so a "#Intent;…" inside the
 * (untrusted) link stays part of the link.
 */
export function appIntentUrl(link, pkg) {
  const url = new URL(link);
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !isPackageName(pkg)) {
    throw new TypeError('need an http(s) link and a package name');
  }
  const rest = url.href.slice(url.protocol.length + 2); // drop "https://"
  return `intent://${rest}#Intent;scheme=${url.protocol.slice(0, -1)};package=${pkg};end`;
}
