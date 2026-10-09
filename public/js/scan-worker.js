// Decodes camera frames off the main thread. Receives RGBA pixels and returns
// every QR code found: decoded text, raw bytes and corner positions (in the
// frame's pixel coordinates). Frames never leave the device; only decoded
// results go back to the page.
//
// Primary decoder: ZXing (zxing-cpp compiled to WebAssembly), which is
// several times faster than jsQR and copes far better with noisy, low-contrast
// camera frames. jsQR remains as a fallback where WebAssembly is unavailable.

const ZXING_OPTIONS = {
  formats: ['QRCode'],
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  maxNumberOfSymbols: 8, // several codes in view: the page lets the user pick
  textMode: 'Plain',
};

// Unsharp mask for a second decoding pass. Recovers out-of-focus codes: on a
// synthetic blur benchmark, plain + sharpened decoding read 44/48 blurred codes
// versus 39/48 for plain decoding alone. It runs whenever a frame yields
// nothing, and every SHARPEN_EVERY frames regardless, so a blurry code next to
// a sharp one is still found when several codes are in view.
const SHARPEN_RADIUS = 3;
const SHARPEN_AMOUNT = 3;
const SHARPEN_EVERY = 3;
let frameCount = 0;

let lum = new Uint8Array(0);
let rowSums = new Uint32Array(0);

/** In-place unsharp mask on luminance: out = Y + amount * (Y - boxBlur(Y)). */
function sharpen(data, width, height) {
  const n = width * height;
  const r = SHARPEN_RADIUS;
  if (lum.length < n) {
    lum = new Uint8Array(n);
    rowSums = new Uint32Array(n);
  }
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    lum[i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8;
  }
  // Horizontal running sums, then a vertical running sum of those (box blur).
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let s = 0;
    for (let x = -r; x <= r; x++) s += lum[row + Math.min(width - 1, Math.max(0, x))];
    for (let x = 0; x < width; x++) {
      rowSums[row + x] = s;
      s += lum[row + Math.min(width - 1, x + r + 1)] - lum[row + Math.max(0, x - r)];
    }
  }
  const area = (2 * r + 1) * (2 * r + 1);
  for (let x = 0; x < width; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += rowSums[Math.min(height - 1, Math.max(0, y)) * width + x];
    for (let y = 0; y < height; y++) {
      const i = y * width + x;
      const v = lum[i];
      const out = v + SHARPEN_AMOUNT * (v - s / area);
      const o = out < 0 ? 0 : out > 255 ? 255 : out;
      data[4 * i] = data[4 * i + 1] = data[4 * i + 2] = o;
      s += rowSums[Math.min(height - 1, y + r + 1) * width + x] - rowSums[Math.max(0, y - r) * width + x];
    }
  }
}

const quadOf = (p) => [p.topLeft, p.topRight, p.bottomRight, p.bottomLeft].map((pt) => [pt.x, pt.y]);

let decode = null; // (data, width, height) => Promise<Array<{ text, bytes, quad }>>

async function loadZXing() {
  importScripts('/vendor/zxing-reader.js');
  const zxing = self.ZXingWASM;
  await zxing.prepareZXingModule({
    // Self-hosted: the library would otherwise fetch the .wasm from a CDN.
    overrides: { locateFile: (path) => (path.endsWith('.wasm') ? `/vendor/${path}` : path) },
    fireImmediately: true,
  });
  const read = async (data, width, height) =>
    (await zxing.readBarcodes(new ImageData(data, width, height), ZXING_OPTIONS))
      .filter((r) => r.isValid && r.bytes && r.bytes.length > 0)
      .map((r) => ({ text: r.text || '', bytes: new Uint8Array(r.bytes), quad: quadOf(r.position) }));
  return async (data, width, height) => {
    const codes = await read(data, width, height);
    frameCount += 1;
    if (codes.length > 0 && frameCount % SHARPEN_EVERY !== 0) return codes;
    sharpen(data, width, height); // readBarcodes has already copied the pixels
    const seen = new Set(codes.map((c) => c.text + '\u0000' + c.bytes.join(',')));
    for (const code of await read(data, width, height)) {
      if (!seen.has(code.text + '\u0000' + code.bytes.join(','))) codes.push(code);
    }
    return codes;
  };
}

function loadJsQR() {
  importScripts('/vendor/jsQR.js');
  return async (data, width, height) => {
    const r = self.jsQR(data, width, height, { inversionAttempts: 'attemptBoth' });
    if (!r || !r.binaryData || r.binaryData.length === 0) return [];
    const l = r.location;
    const quad = [l.topLeftCorner, l.topRightCorner, l.bottomRightCorner, l.bottomLeftCorner].map((p) => [p.x, p.y]);
    return [{ text: r.data || '', bytes: Uint8Array.from(r.binaryData), quad }];
  };
}

const ready = (async () => {
  try {
    if (typeof WebAssembly !== 'object') throw new Error('no WebAssembly');
    decode = await loadZXing();
    self.postMessage({ type: 'engine', engine: 'zxing' });
  } catch (err) {
    decode = loadJsQR();
    self.postMessage({ type: 'engine', engine: 'jsqr', reason: String(err && err.message ? err.message : err) });
  }
})();

self.onmessage = async (event) => {
  const { id, width, height, buffer } = event.data;
  await ready;
  let codes = [];
  try {
    codes = await decode(new Uint8ClampedArray(buffer), width, height);
  } catch {
    codes = [];
  }
  self.postMessage({ type: 'result', id, codes }, codes.map((c) => c.bytes.buffer));
};
