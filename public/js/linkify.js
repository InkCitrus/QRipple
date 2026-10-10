// Find web links in decoded QR text. Pure logic (no DOM), unit-tested in Node.
//
// QR content is untrusted, so only http(s) URLs become links: never
// javascript:, data:, file: or app schemes.

// Full-width (CJK) punctuation ends a URL: Chinese text often follows one
// without a space ("https://a.cn/x，或者…").
const URL_RE = /https?:\/\/[^\s<>"'`，。；：！？、「」『』【】《》（）]+/gi;
// Punctuation that usually ends the sentence around a URL rather than the URL.
const TRAILING = new Set([...'.,;:!?\'"]}>。，；：！？、」』】》）']);

function trimUrl(raw) {
  let url = raw;
  for (;;) {
    const last = url[url.length - 1];
    if (TRAILING.has(last)) {
      url = url.slice(0, -1);
    } else if (last === ')' && (url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length) {
      url = url.slice(0, -1); // unbalanced ")" closes a parenthesis around the URL
    } else {
      return url;
    }
  }
}

/**
 * Split text into segments: { text } for plain text, { text, href } for a link.
 * Joining every segment's text gives back the original string.
 */
export function linkSegments(text) {
  const segments = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const raw = trimUrl(match[0]);
    let href = null;
    try {
      const url = new URL(raw);
      if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname) href = url.href;
    } catch {
      href = null;
    }
    if (!href) continue;
    if (match.index > last) segments.push({ text: text.slice(last, match.index) });
    segments.push({ text: raw, href });
    last = match.index + raw.length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments;
}
