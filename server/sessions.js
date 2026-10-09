// In-memory session store. Nothing here is persisted: a session lives only
// as long as it is active, and only the latest decoded payload is kept.

import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

const CODE_MIN = 10000; // five digits, no leading zero
const CODE_MAX = 99999;

export const EndReason = Object.freeze({
  ENDED: 'ended', // sharer ended the session
  EXPIRED: 'expired', // hard lifetime reached
  HOST_LEFT: 'host_left', // sharer stayed offline past the grace period
});

function randomId(bytes) {
  return randomBytes(bytes).toString('base64url');
}

export class Session {
  constructor({ code, createdAt, expiresAt }) {
    this.id = randomId(12);
    this.code = code;
    this.token = randomId(24);
    this.createdAt = createdAt;
    this.expiresAt = expiresAt;
    this.host = null; // the sharer's socket, when connected
    this.hostOfflineSince = createdAt;
    this.receivers = new Set();
    this.payload = null; // { rev, text, data, at }
    this.rev = 0;
    this.ended = false;
  }

  checkToken(token) {
    if (typeof token !== 'string') return false;
    const a = Buffer.from(token);
    const b = Buffer.from(this.token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /**
   * Store a new payload. Returns the stored payload, or null when the data
   * is identical to what is already shared (nothing to broadcast).
   */
  setPayload({ text, data }, now) {
    if (this.payload && this.payload.data === data && this.payload.text === text) return null;
    this.rev += 1;
    this.payload = { rev: this.rev, text, data, at: now };
    return this.payload;
  }
}

export class SessionStore {
  constructor({ sessionTtlMs, hostGraceMs, codeCooldownMs, maxSessions, now = Date.now }) {
    this.ttlMs = sessionTtlMs;
    this.graceMs = hostGraceMs;
    this.cooldownMs = codeCooldownMs;
    this.maxSessions = maxSessions;
    this.now = now;
    this.byCode = new Map();
    this.byId = new Map();
    this.cooldown = new Map(); // code -> time it was released
  }

  get size() {
    return this.byCode.size;
  }

  #codeAvailable(code, t) {
    if (this.byCode.has(code)) return false;
    const released = this.cooldown.get(code);
    if (released === undefined) return true;
    if (t - released >= this.cooldownMs) {
      this.cooldown.delete(code);
      return true;
    }
    return false;
  }

  #allocateCode(t) {
    // The code space (90k) is far larger than maxSessions, so random probing
    // finds a free code almost immediately. Fall back to a scan just in case.
    for (let i = 0; i < 64; i++) {
      const code = String(randomInt(CODE_MIN, CODE_MAX + 1));
      if (this.#codeAvailable(code, t)) return code;
    }
    const start = randomInt(CODE_MIN, CODE_MAX + 1);
    const span = CODE_MAX - CODE_MIN + 1;
    for (let i = 0; i < span; i++) {
      const code = String(CODE_MIN + ((start - CODE_MIN + i) % span));
      if (this.#codeAvailable(code, t)) return code;
    }
    return null;
  }

  /** Create a session, or return null when the server is at capacity. */
  create() {
    if (this.byCode.size >= this.maxSessions) return null;
    const t = this.now();
    const code = this.#allocateCode(t);
    if (!code) return null;
    const session = new Session({ code, createdAt: t, expiresAt: t + this.ttlMs });
    this.byCode.set(code, session);
    this.byId.set(session.id, session);
    return session;
  }

  getByCode(code) {
    return this.byCode.get(code) ?? null;
  }

  getById(id) {
    return this.byId.get(id) ?? null;
  }

  remainingMs(session) {
    return Math.max(0, session.expiresAt - this.now());
  }

  /** Remove a session. Its code stays reserved for the cooldown period. */
  end(session) {
    if (session.ended) return false;
    session.ended = true;
    session.payload = null;
    this.byCode.delete(session.code);
    this.byId.delete(session.id);
    this.cooldown.set(session.code, this.now());
    return true;
  }

  /** Sessions that should end now, with the reason. Does not end them. */
  due() {
    const t = this.now();
    const out = [];
    for (const session of this.byCode.values()) {
      if (t >= session.expiresAt) {
        out.push([session, EndReason.EXPIRED]);
      } else if (!session.host && session.hostOfflineSince !== null && t - session.hostOfflineSince >= this.graceMs) {
        out.push([session, EndReason.HOST_LEFT]);
      }
    }
    return out;
  }

  pruneCooldown() {
    const t = this.now();
    for (const [code, released] of this.cooldown) {
      if (t - released >= this.cooldownMs) this.cooldown.delete(code);
    }
  }
}
