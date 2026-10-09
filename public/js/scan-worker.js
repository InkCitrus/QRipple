// Decodes camera frames off the main thread. Receives RGBA pixels, returns
// the decoded text and raw bytes (or found: false). Frames never leave the
// device; only the decoded result goes back to the page.
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
  maxNumberOfSymbols: 1,
  textMode: 'Plain',
};

let decode = null; // (data, width, height) => Promise<{ text, bytes } | null>

async function loadZXing() {
  importScripts('/vendor/zxing-reader.js');
  const zxing = self.ZXingWASM;
  await zxing.prepareZXingModule({
    // Self-hosted: the library would otherwise fetch the .wasm from a CDN.
    overrides: { locateFile: (path) => (path.endsWith('.wasm') ? `/vendor/${path}` : path) },
    fireImmediately: true,
  });
  return async (data, width, height) => {
    const results = await zxing.readBarcodes(new ImageData(data, width, height), ZXING_OPTIONS);
    const hit = results.find((r) => r.isValid && r.bytes && r.bytes.length > 0);
    return hit ? { text: hit.text || '', bytes: new Uint8Array(hit.bytes) } : null;
  };
}

function loadJsQR() {
  importScripts('/vendor/jsQR.js');
  return async (data, width, height) => {
    const result = self.jsQR(data, width, height, { inversionAttempts: 'attemptBoth' });
    if (!result || !result.binaryData || result.binaryData.length === 0) return null;
    return { text: result.data || '', bytes: Uint8Array.from(result.binaryData) };
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
  let result = null;
  try {
    result = await decode(new Uint8ClampedArray(buffer), width, height);
  } catch {
    result = null;
  }
  if (result) {
    self.postMessage({ type: 'result', id, found: true, text: result.text, bytes: result.bytes }, [result.bytes.buffer]);
  } else {
    self.postMessage({ type: 'result', id, found: false });
  }
};
