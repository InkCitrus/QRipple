// Helpers for handing QR content to a Shortcuts shortcut on Apple devices,
// or sharing the first web link through Android's system share sheet.

import { linkSegments } from './linkify.js';

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

/** The first http(s) link in the text, or null. */
export function firstLink(text) {
  return linkSegments(text).find((segment) => segment.href)?.href ?? null;
}
