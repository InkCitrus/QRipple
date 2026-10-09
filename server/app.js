// Wires the HTTP server, static files and the WebSocket hub together.

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { loadConfig } from './config.js';
import { Hub } from './hub.js';
import { createStaticHandler } from './static.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function clientIp(req, trustProxy) {
  const direct = req.socket.remoteAddress || 'unknown';
  if (!trustProxy) return direct;
  const forwarded = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // Each trusted proxy appends the address it saw, so the client is
  // `trustProxy` entries from the end. Anything further left is spoofable.
  return forwarded[forwarded.length - trustProxy] || forwarded[0] || direct;
}

function originAllowed(req, allowedOrigins) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser client; nothing to protect against
  if (allowedOrigins.includes(origin)) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/**
 * An access line from config: a hostname ("tk.example.com" -> wss://tk.example.com/ws)
 * or a full WebSocket URL (handy for local testing).
 */
export function parseLine(entry) {
  const url = new URL(entry.includes('://') ? entry : `wss://${entry}/ws`);
  return {
    id: url.hostname.split('.')[0],
    url: url.href,
    origin: `${url.protocol === 'ws:' ? 'http:' : 'https:'}//${url.host}`,
    connectSrc: `${url.protocol}//${url.host}`,
  };
}

function rejectUpgrade(socket, status, text) {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

export function createApp(overrides = {}, { log = console.log } = {}) {
  const config = { ...loadConfig(), ...overrides };
  const hub = new Hub(config, { log });
  const lines = config.lines.map(parseLine);
  const publicLines = lines.map(({ id, url }) => ({ id, url }));
  const serveStatic = createStaticHandler(PUBLIC_DIR, { connectSrc: lines.map((l) => l.connectSrc), lines: publicLines });
  // Pages served from any access line may open a WebSocket on any other line.
  const allowedOrigins = [...config.allowedOrigins, ...lines.map((l) => l.origin)];
  const linesBody = JSON.stringify({ lines: publicLines });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: config.maxMessageBytes,
    perMessageDeflate: false,
  });
  const connectionsPerIp = new Map();

  function onRequest(req, res) {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }).end('ok');
      return;
    }
    if (pathname === '/lines.json') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }).end(linesBody);
      return;
    }
    serveStatic(req, res, pathname).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  }

  function onUpgrade(req, socket, head) {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname !== '/ws') return rejectUpgrade(socket, 404, 'Not Found');
    if (!originAllowed(req, allowedOrigins)) return rejectUpgrade(socket, 403, 'Forbidden');
    const ip = clientIp(req, config.trustProxy);
    const count = connectionsPerIp.get(ip) || 0;
    if (count >= config.maxConnectionsPerIp) return rejectUpgrade(socket, 429, 'Too Many Requests');

    wss.handleUpgrade(req, socket, head, (ws) => {
      connectionsPerIp.set(ip, (connectionsPerIp.get(ip) || 0) + 1);
      ws.on('close', () => {
        const n = (connectionsPerIp.get(ip) || 1) - 1;
        if (n <= 0) connectionsPerIp.delete(ip);
        else connectionsPerIp.set(ip, n);
      });
      hub.attach(ws, ip);
    });
  }

  // One HTTP server per listen address, all sharing the same hub.
  const servers = [];
  const addresses = [];

  return {
    config,
    hub,
    addresses,
    /** Listen on one or more addresses; resolves with the first bound address. */
    async listen(port = config.port, hosts = config.hosts) {
      for (const host of [hosts].flat()) {
        const server = http.createServer(onRequest);
        server.on('upgrade', onUpgrade);
        servers.push(server);
        addresses.push(await new Promise((resolve) => server.listen(port, host, () => resolve(server.address()))));
      }
      return addresses[0];
    },
    close() {
      hub.close();
      wss.close();
      return Promise.all(
        servers.map((server) => {
          server.closeAllConnections?.();
          return new Promise((resolve) => server.close(() => resolve()));
        }),
      );
    },
  };
}
