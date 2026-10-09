// WebSocket protocol: one socket is either the sharer ("host") of a session
// or a receiver. All messages are JSON objects with a `t` (type) field.
// See docs/PROTOCOL.md for the full message reference.

import { WebSocket } from 'ws';
import { EndReason, SessionStore } from './sessions.js';
import { KeyedLimiter, TokenBucket } from './ratelimit.js';

const CODE_RE = /^\d{5}$/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_BUFFERED = 1024 * 1024; // drop receivers that stop reading
const ROLELESS_IDLE_MS = 60 * 1000;

export class Hub {
  constructor(config, { now = Date.now, log = () => {} } = {}) {
    this.config = config;
    this.now = now;
    this.log = log;
    this.store = new SessionStore({ ...config, now });
    this.createLimiter = new KeyedLimiter({ capacity: config.createBurst, refillMs: config.createRefillMs, now });
    this.joinFailLimiter = new KeyedLimiter({ capacity: config.joinFailBurst, refillMs: config.joinFailRefillMs, now });
    this.sockets = new Set();
    this.timers = [
      setInterval(() => this.sweep(), config.sweepMs),
      setInterval(() => this.heartbeat(), config.heartbeatMs),
    ];
    for (const timer of this.timers) timer.unref?.();
  }

  close() {
    for (const timer of this.timers) clearInterval(timer);
    for (const ws of this.sockets) ws.terminate();
  }

  // ---------------------------------------------------------------- sockets

  attach(ws, ip) {
    ws.ip = ip;
    ws.role = null;
    ws.session = null;
    ws.isAlive = true;
    ws.connectedAt = this.now();
    ws.bucket = new TokenBucket({
      capacity: this.config.messageBurst,
      refillMs: this.config.messageRefillMs,
      now: this.now,
    });
    this.sockets.add(ws);

    ws.on('pong', () => {
      ws.isAlive = true;
    });
    ws.on('message', (raw, isBinary) => this.#onMessage(ws, raw, isBinary));
    ws.on('close', () => this.#onClose(ws));
    ws.on('error', () => {});
  }

  #onMessage(ws, raw, isBinary) {
    ws.isAlive = true;
    if (!ws.bucket.take()) {
      send(ws, { t: 'error', code: 'rate_limited' });
      ws.close(1008, 'rate limited');
      return;
    }
    let msg;
    try {
      msg = isBinary ? null : JSON.parse(raw.toString('utf8'));
    } catch {
      msg = null;
    }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') {
      send(ws, { t: 'error', code: 'bad_request' });
      return;
    }

    switch (msg.t) {
      case 'ping':
        return send(ws, { t: 'pong' });
      case 'create':
        return this.#create(ws);
      case 'resume':
        return this.#resume(ws, msg);
      case 'update':
        return this.#update(ws, msg);
      case 'end':
        return this.#end(ws);
      case 'join':
        return this.#join(ws, msg);
      case 'leave':
        return this.#leave(ws);
      default:
        return send(ws, { t: 'error', code: 'bad_request' });
    }
  }

  #onClose(ws) {
    this.sockets.delete(ws);
    const session = ws.session;
    if (!session || session.ended) return;
    if (ws.role === 'host' && session.host === ws) {
      session.host = null;
      session.hostOfflineSince = this.now();
      this.#broadcast(session, { t: 'host', online: false });
    } else if (ws.role === 'receiver' && session.receivers.delete(ws)) {
      this.#sendReceiverCount(session);
    }
  }

  // ---------------------------------------------------------------- sharer

  #create(ws) {
    if (ws.role) return send(ws, { t: 'error', code: 'bad_request' });
    if (!this.createLimiter.take(ws.ip)) return send(ws, { t: 'error', code: 'rate_limited' });
    const session = this.store.create();
    if (!session) return send(ws, { t: 'error', code: 'busy' });
    this.#bindHost(ws, session);
    send(ws, {
      t: 'created',
      code: session.code,
      sid: session.id,
      token: session.token,
      remainingMs: this.store.remainingMs(session),
    });
  }

  #resume(ws, msg) {
    if (ws.role) return send(ws, { t: 'error', code: 'bad_request' });
    const session = typeof msg.sid === 'string' ? this.store.getById(msg.sid) : null;
    if (!session || !session.checkToken(msg.token)) {
      return send(ws, { t: 'error', code: 'session_ended' });
    }
    const previous = session.host;
    if (previous && previous !== ws) {
      // A stale connection from the same sharer (e.g. a half-open socket
      // after a network switch). The newest connection wins.
      previous.session = null;
      previous.role = null;
      send(previous, { t: 'error', code: 'replaced' });
      previous.close(1000, 'replaced');
    }
    this.#bindHost(ws, session);
    send(ws, {
      t: 'resumed',
      code: session.code,
      sid: session.id,
      remainingMs: this.store.remainingMs(session),
      receivers: session.receivers.size,
      rev: session.rev,
    });
    if (!previous) this.#broadcast(session, { t: 'host', online: true });
  }

  #bindHost(ws, session) {
    ws.role = 'host';
    ws.session = session;
    session.host = ws;
    session.hostOfflineSince = null;
  }

  #update(ws, msg) {
    const session = ws.session;
    if (ws.role !== 'host' || !session || session.host !== ws) {
      return send(ws, { t: 'error', code: 'forbidden' });
    }
    const payload = this.#validatePayload(msg);
    if (!payload) return send(ws, { t: 'error', code: 'too_large' });
    const stored = session.setPayload(payload, this.now());
    if (stored) {
      this.#broadcast(session, { t: 'payload', payload: this.#publicPayload(stored) });
    }
    send(ws, { t: 'ack', rev: session.rev });
  }

  #validatePayload(msg) {
    const { text, data } = msg;
    const max = this.config.maxDataBytes;
    if (typeof text !== 'string' || typeof data !== 'string') return null;
    if (text.length > max) return null;
    if (data.length === 0 || data.length > Math.ceil(max / 3) * 4 || !BASE64_RE.test(data)) return null;
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length === 0 || bytes.length > max) return null;
    // Only canonical base64, so identical payloads compare equal as strings.
    if (bytes.toString('base64') !== data) return null;
    return { text, data };
  }

  #end(ws) {
    const session = ws.session;
    if (ws.role !== 'host' || !session || session.host !== ws) {
      return send(ws, { t: 'error', code: 'forbidden' });
    }
    this.endSession(session, EndReason.ENDED);
  }

  // ---------------------------------------------------------------- receiver

  #join(ws, msg) {
    if (ws.role) return send(ws, { t: 'error', code: 'bad_request' });
    const code = msg.code;
    if (typeof code !== 'string' || !CODE_RE.test(code)) {
      return send(ws, { t: 'error', code: 'bad_request' });
    }
    if (!this.joinFailLimiter.allowed(ws.ip)) {
      return send(ws, { t: 'error', code: 'rate_limited' });
    }

    const session = this.store.getByCode(code);
    // A reconnecting receiver passes the session id it joined before, so a
    // recycled code can never silently attach it to someone else's session.
    if (msg.sid !== undefined && (!session || session.id !== msg.sid)) {
      return send(ws, { t: 'error', code: 'session_ended' });
    }
    if (!session) {
      this.joinFailLimiter.take(ws.ip);
      return send(ws, { t: 'error', code: 'not_found' });
    }
    if (session.receivers.size >= this.config.maxReceivers) {
      return send(ws, { t: 'error', code: 'full' });
    }

    ws.role = 'receiver';
    ws.session = session;
    session.receivers.add(ws);
    send(ws, {
      t: 'joined',
      code: session.code,
      sid: session.id,
      remainingMs: this.store.remainingMs(session),
      hostOnline: Boolean(session.host),
      payload: session.payload ? this.#publicPayload(session.payload) : null,
    });
    this.#sendReceiverCount(session);
  }

  #leave(ws) {
    const session = ws.session;
    if (ws.role !== 'receiver' || !session) return;
    session.receivers.delete(ws);
    ws.role = null;
    ws.session = null;
    this.#sendReceiverCount(session);
    send(ws, { t: 'left' });
  }

  // ---------------------------------------------------------------- shared

  #publicPayload(p) {
    return { rev: p.rev, text: p.text, data: p.data, ageMs: Math.max(0, this.now() - p.at) };
  }

  #sendReceiverCount(session) {
    if (session.host) send(session.host, { t: 'receivers', count: session.receivers.size });
  }

  #broadcast(session, msg) {
    const frame = JSON.stringify(msg);
    for (const ws of session.receivers) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (ws.bufferedAmount > MAX_BUFFERED) {
        ws.terminate();
        continue;
      }
      ws.send(frame);
    }
  }

  endSession(session, reason) {
    if (!this.store.end(session)) return;
    const frame = JSON.stringify({ t: 'ended', reason });
    const sockets = [...session.receivers];
    if (session.host) sockets.push(session.host);
    session.receivers.clear();
    session.host = null;
    for (const ws of sockets) {
      ws.role = null;
      ws.session = null;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(frame);
        ws.close(1000, 'session ended');
      }
    }
  }

  sweep() {
    for (const [session, reason] of this.store.due()) this.endSession(session, reason);
    this.store.pruneCooldown();
    this.createLimiter.prune();
    this.joinFailLimiter.prune();
  }

  heartbeat() {
    const t = this.now();
    for (const ws of this.sockets) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      if (!ws.role && t - ws.connectedAt > ROLELESS_IDLE_MS) {
        ws.close(1000, 'idle');
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }
}

function send(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
