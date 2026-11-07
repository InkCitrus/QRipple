import { Buffer } from 'node:buffer';
import { loadConfig } from '../server/config.js';
import { Hub } from '../server/hub.js';

// This object intentionally uses the standard WebSocket API, not hibernation:
// QR payloads and session tokens stay exclusively in memory, as on Node.js.
// Only pairing-code reservation deadlines enter Durable Object storage.
export class QRippleHub {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.config = loadConfig(env);
    this.hub = new Hub(this.config, { scheduleTimers: false });
    this.connectionsPerIp = new Map();
    this.reservations = new Map();
    this.outbox = [];
    this.lastHeartbeat = Date.now();
    this.nextAlarm = null;
    this.failed = false;
    this.queue = Promise.resolve();
    this.ready = ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.list({ prefix: 'code:' });
      const now = Date.now();
      for (const [key, until] of saved) {
        this.reservations.set(key, until);
        // A cold start has lost all old sessions. Keep their codes reserved
        // for the cooldown from now, without extending an existing cooldown.
        const expires = Math.min(until, now + this.config.codeCooldownMs);
        if (expires > now) this.hub.store.cooldown.set(key.slice(5), expires - this.config.codeCooldownMs);
      }
      this.nextAlarm = await ctx.storage.getAlarm();
    });
  }

  fetch(request) {
    return this.run(() => {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('WebSocket upgrade required', { status: 426 });
      }
      const ip = request.headers.get('X-QRipple-IP') || 'unknown';
      const count = this.connectionsPerIp.get(ip) || 0;
      if (count >= this.config.maxConnectionsPerIp) return new Response('Too Many Requests', { status: 429 });
      const [client, server] = Object.values(new WebSocketPair());
      server.binaryType = 'arraybuffer';
      server.accept();
      const socket = new WorkerSocket(server, this.outbox);
      this.connectionsPerIp.set(ip, count + 1);
      this.hub.attach(socket, ip);
      const finish = () => {
        if (socket.finished) return;
        socket.finished = true;
        socket.emit('close');
        const n = (this.connectionsPerIp.get(ip) || 1) - 1;
        if (n) this.connectionsPerIp.set(ip, n);
        else this.connectionsPerIp.delete(ip);
      };
      socket.finish = finish;
      server.addEventListener('message', (event) => this.ctx.waitUntil(this.run(() => {
        if (socket.finished || socket.readyState !== 1) return;
        const raw = event.data;
        const size = typeof raw === 'string' ? Buffer.byteLength(raw) : raw.byteLength;
        if (size > this.config.maxMessageBytes) {
          socket.close(1009, 'message too large');
          finish();
          return;
        }
        socket.emit('message', raw, typeof raw !== 'string');
      })));
      server.addEventListener('close', () => this.ctx.waitUntil(this.run(() => {
        finish();
        socket.close(1000);
      })));
      server.addEventListener('error', () => this.ctx.waitUntil(this.run(() => {
        socket.terminate();
        finish();
      })));
      return new Response(null, { status: 101, webSocket: client });
    });
  }

  alarm() {
    this.nextAlarm = null;
    return this.run(() => {
      const now = Date.now();
      if (now - this.lastHeartbeat >= Math.max(50, this.config.heartbeatMs)) {
        this.hub.heartbeat();
        this.lastHeartbeat = now;
      }
    });
  }

  run(action) {
    const pending = this.queue.then(async () => {
      await this.ready;
      if (this.failed) throw new Error('QRipple hub storage is unavailable');
      this.hub.sweep();
      const result = action();
      // Reserve newly allocated codes before acknowledging them. This also
      // makes code release and cooldown updates precede outgoing end frames.
      await this.persistReservations();
      await this.scheduleAlarm();
      for (const deliver of this.outbox.splice(0)) deliver();
      return result;
    }).catch((error) => {
      // No acknowledgements may escape after a failed reservation write.
      this.failed = true;
      this.outbox.length = 0;
      for (const socket of this.hub.sockets) {
        try { socket.native.close(1011, 'hub unavailable'); } catch { /* already closed */ }
      }
      throw error;
    });
    this.queue = pending.catch(() => {});
    return pending;
  }

  async persistReservations() {
    const now = Date.now();
    const desired = new Map();
    for (const session of this.hub.store.byCode.values()) {
      desired.set(`code:${session.code}`, session.expiresAt + this.config.codeCooldownMs);
    }
    for (const [code, released] of this.hub.store.cooldown) {
      if (released + this.config.codeCooldownMs > now) desired.set(`code:${code}`, released + this.config.codeCooldownMs);
    }
    const put = Object.fromEntries([...desired].filter(([key, value]) => this.reservations.get(key) !== value));
    const remove = [...this.reservations.keys()].filter((key) => !desired.has(key));
    if (Object.keys(put).length || remove.length) {
      await this.ctx.storage.transaction(async (tx) => {
        // Durable Object KV operations accept at most 128 keys per call.
        const entries = Object.entries(put);
        for (let i = 0; i < entries.length; i += 128) await tx.put(Object.fromEntries(entries.slice(i, i + 128)));
        for (let i = 0; i < remove.length; i += 128) await tx.delete(remove.slice(i, i + 128));
      });
      this.reservations = desired;
    }
  }

  async scheduleAlarm() {
    const now = Date.now();
    const active = this.hub.sockets.size || this.hub.store.size ||
      this.hub.createLimiter.buckets.size || this.hub.joinFailLimiter.buckets.size;
    // Frequent alarms keep offline sessions in memory throughout their grace
    // period. Once only code cooldowns remain, the object can go idle.
    let next = null;
    if (active) next = now + Math.max(50, Math.min(this.config.sweepMs, this.config.heartbeatMs, 5000));
    else for (const until of this.reservations.values()) next = Math.min(next ?? until, until);
    if (next === null) {
      if (this.nextAlarm !== null) await this.ctx.storage.deleteAlarm();
      this.nextAlarm = null;
    } else if (this.nextAlarm === null || this.nextAlarm <= now || next < this.nextAlarm) {
      await this.ctx.storage.setAlarm(next);
      this.nextAlarm = next;
    }
  }
}

// Small adapter for the shared Hub's ws-style event and heartbeat interface.
class WorkerSocket {
  constructor(native, outbox) {
    this.native = native;
    this.outbox = outbox;
    this.listeners = new Map();
    this.closing = false;
    this.finished = false;
  }

  get readyState() { return this.closing ? 2 : this.native.readyState; }
  get bufferedAmount() { return this.native.bufferedAmount || 0; }
  on(type, listener) { this.listeners.set(type, listener); }
  emit(type, ...args) { this.listeners.get(type)?.(...args); }

  send(message) {
    this.outbox.push(() => {
      try { this.native.send(message); } catch { /* close event removes the socket */ }
    });
  }

  ping() { this.send(JSON.stringify({ t: 'ping' })); }

  close(code = 1000, reason = '') {
    if (this.closing) return;
    this.closing = true;
    this.outbox.push(() => {
      try { this.native.close(code, reason); } catch { /* already closed */ }
    });
  }

  terminate() {
    this.close(1001, 'connection closed');
    this.finish();
  }
}
