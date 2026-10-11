// Helpers for sharing the first web link through the system share sheet, or
// (on Apple devices, when turned on in settings) handing QR content to a
// Shortcuts shortcut.

import { linkSegments } from './linkify.js';

/** 'android', 'apple' (an iPad may report itself as a Mac) or null. */
export function launchPlatform(userAgent) {
  if (/Android/.test(userAgent)) return 'android';
  if (/iPhone|iPad|iPod|Macintosh/.test(userAgent)) return 'apple';
  return null;
}

/** URL that runs the shortcut called `name` with `text` as its input. */
export function shortcutUrl(name, text) {
  return `shortcuts://run-shortcut?name=${encodeURIComponent(name)}&input=text&text=${encodeURIComponent(text)}`;
}

/** The first http(s) link in the text, or null. */
export function firstLink(text) {
  return linkSegments(text).find((segment) => segment.href)?.href ?? null;
}
