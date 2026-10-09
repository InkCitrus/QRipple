// Minimal static file server for the browser app. Files are cached in memory
// (with a gzip variant) and revalidated by mtime, so edits show up on reload.

import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

const require = createRequire(import.meta.url);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm', // required for WebAssembly.instantiateStreaming
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.svg', '.json', '.webmanifest', '.txt', '.wasm']);

// Client-side routes that all render the single-page app.
const APP_ROUTES = new Set(['/', '/share', '/join']);

function vendorFiles() {
  // qrcode-generator only exports its CommonJS entry to require(); the ES
  // module build sits next to it.
  const qrcodeDir = path.dirname(require.resolve('qrcode-generator'));
  // zxing-wasm/dist/cjs/reader/index.js -> zxing-wasm/dist
  const zxingDist = path.resolve(path.dirname(require.resolve('zxing-wasm/reader')), '..', '..');
  return new Map([
    ['/vendor/jsQR.js', require.resolve('jsqr')],
    ['/vendor/qrcode.mjs', path.join(qrcodeDir, 'qrcode.mjs')],
    ['/vendor/zxing-reader.js', path.join(zxingDist, 'iife', 'reader', 'index.js')],
    ['/vendor/zxing_reader.wasm', path.join(zxingDist, 'reader', 'zxing_reader.wasm')],
  ]);
}

export function securityHeaders(req, connectSrc = []) {
  const host = req.headers.host || '';
  const sources = ["'self'"];
  if (host) sources.push(`wss://${host}`, `ws://${host}`);
  sources.push(...connectSrc); // other access lines
  const connect = [...new Set(sources)].join(' ');
  return {
    'Content-Security-Policy': [
      "default-src 'self'",
      // 'wasm-unsafe-eval' lets the scanner compile the ZXing WebAssembly
      // module; it does not allow JavaScript eval.
      "script-src 'self' 'wasm-unsafe-eval'",
      "style-src 'self'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      `connect-src ${connect}`,
      "worker-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
  };
}

export function createStaticHandler(publicDir, { connectSrc = [], lines = [] } = {}) {
  const root = path.resolve(publicDir);
  const vendor = vendorFiles();
  const cache = new Map(); // file path -> { mtimeMs, body, gz, etag, type }

  async function load(file) {
    const info = await stat(file);
    if (!info.isFile()) return null;
    const hit = cache.get(file);
    if (hit && hit.mtimeMs === info.mtimeMs) return hit;
    let body = await readFile(file);
    const ext = path.extname(file).toLowerCase();
    if (ext === '.html') {
      // Embed the access lines so the page knows them without another request
      // (that request could stall on a bad line before racing even starts).
      const json = JSON.stringify(lines).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      body = Buffer.from(body.toString('utf8').replace('<meta name="qripple-lines" content="">', `<meta name="qripple-lines" content="${json}">`));
    }
    const entry = {
      mtimeMs: info.mtimeMs,
      body,
      gz: COMPRESSIBLE.has(ext) && body.length > 1024 ? gzipSync(body) : null,
      etag: `"${createHash('sha1').update(body).digest('base64url').slice(0, 20)}"`,
      type: TYPES[ext] || 'application/octet-stream',
    };
    cache.set(file, entry);
    return entry;
  }

  function resolve(pathname) {
    if (APP_ROUTES.has(pathname)) return path.join(root, 'index.html');
    if (vendor.has(pathname)) return vendor.get(pathname);
    const file = path.resolve(root, '.' + pathname);
    if (file !== root && !file.startsWith(root + path.sep)) return null;
    return file;
  }

  return async function handle(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const file = resolve(pathname);
    let entry = null;
    if (file && !path.basename(file).startsWith('.')) {
      try {
        entry = await load(file);
      } catch {
        entry = null;
      }
    }
    const headers = securityHeaders(req, connectSrc);
    if (!entry) {
      res.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    headers['Content-Type'] = entry.type;
    headers['Cache-Control'] = 'no-cache';
    headers.ETag = entry.etag;
    headers.Vary = 'Accept-Encoding';
    if (req.headers['if-none-match'] === entry.etag) {
      res.writeHead(304, headers).end();
      return;
    }
    let body = entry.body;
    if (entry.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      body = entry.gz;
      headers['Content-Encoding'] = 'gzip';
    }
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  };
}
