import { cp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist', 'worker-assets');
await rm(out, { recursive: true, force: true });
await cp(path.join(root, 'public'), out, { recursive: true });
await mkdir(path.join(out, 'vendor'), { recursive: true });

const qrcodeDir = path.dirname(require.resolve('qrcode-generator'));
const zxingDist = path.resolve(path.dirname(require.resolve('zxing-wasm/reader')), '..', '..');
for (const [name, source] of [
  ['jsQR.js', require.resolve('jsqr')],
  ['qrcode.mjs', path.join(qrcodeDir, 'qrcode.mjs')],
  ['zxing-reader.js', path.join(zxingDist, 'iife', 'reader', 'index.js')],
  ['zxing_reader.wasm', path.join(zxingDist, 'reader', 'zxing_reader.wasm')],
]) await cp(source, path.join(out, 'vendor', name));
