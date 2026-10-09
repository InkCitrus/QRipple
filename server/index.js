import { createApp } from './app.js';

const app = createApp();
await app.listen();
console.log(`QRipple listening on ${app.config.hosts.map((h) => `${h}:${app.config.port}`).join(', ')}`);
if (app.config.lines.length) console.log(`Access lines: ${app.config.lines.join(', ')}`);

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} received, shutting down`);
  await app.close();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
