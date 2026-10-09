// Re-encode payload bytes as a QR code and draw it as an SVG. The symbol does
// not need to look like the original, but it must carry the same data.

import { qrcode } from '/vendor/qrcode.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const QUIET_ZONE = 4;
const ALPHANUMERIC = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

function pickMode(bytes) {
  let numeric = true;
  let alphanumeric = true;
  for (const b of bytes) {
    const c = String.fromCharCode(b);
    if (b < 0x30 || b > 0x39) numeric = false;
    if (!ALPHANUMERIC.includes(c) || b > 0x7f) alphanumeric = false;
    if (!numeric && !alphanumeric) break;
  }
  if (numeric) return 'Numeric';
  if (alphanumeric) return 'Alphanumeric';
  return 'Byte';
}

function buildQr(bytes) {
  const mode = pickMode(bytes);
  // In Byte mode qrcode-generator maps each char code to one byte (& 0xff),
  // so a "binary string" reproduces the original bytes exactly.
  let data = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    data += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  let lastError;
  for (const level of ['M', 'L']) {
    try {
      const qr = qrcode(0, level);
      qr.addData(data, mode);
      qr.make();
      return qr;
    } catch (err) {
      lastError = err; // too much data for this error-correction level
    }
  }
  throw new Error(`QR encode failed: ${lastError}`);
}

export function renderQrSvg(bytes) {
  const qr = buildQr(bytes);
  const count = qr.getModuleCount();
  const size = count + QUIET_ZONE * 2;

  // One subpath per horizontal run of dark modules keeps the path small.
  let d = '';
  for (let row = 0; row < count; row++) {
    let col = 0;
    while (col < count) {
      if (!qr.isDark(row, col)) {
        col++;
        continue;
      }
      const start = col;
      while (col < count && qr.isDark(row, col)) col++;
      const run = col - start;
      d += `M${start + QUIET_ZONE} ${row + QUIET_ZONE}h${run}v1h-${run}z`;
    }
  }

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'QR code');
  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('width', size);
  bg.setAttribute('height', size);
  bg.setAttribute('fill', '#fff');
  bg.setAttribute('stroke', 'none');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', '#000');
  path.setAttribute('stroke', 'none');
  svg.append(bg, path);
  return svg;
}
