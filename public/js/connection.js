// WebSocket wrapper with multi-line racing, automatic reconnection and a
// liveness check. Status values: 'connecting' | 'online' | 'reconnecting' |
// 'offline' | 'closed'.
//
// Multi-line access: the server lists several hostnames ("lines") that reach
// the same backend over different networks (/lines.json). Each connection
// attempt starts with the line that worked last; if it hasn't connected
// within HEDGE_MS the next line is tried in parallel, and the first socket to
// open wins. A line that just dropped is tried last on the next attempt.

const BACKOFF_MS = [250, 1000, 2000, 4000, 8000, 15000];
const HEDGE_MS = 600; // start the next line if the current one hasn't opened yet
const ATTEMPT_TIMEOUT_MS = 8000; // give up on a round of attempts after this
const PING_AFTER_MS = 10000; // also calibrate payload age while QR traffic is active
const DEAD_AFTER_MS = 25000; // no traffic at all for this long: assume the socket is dead
const PREFERRED_KEY = 'qripple.line';

const sameOrigin = { id: null, url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws` };

const validLines = (list) => (Array.isArray(list) ? list.filter((l) => l && typeof l.url === 'string') : []);

// The server embeds the lines in the page, so they are known immediately.
// /lines.json is only a fallback for pages served without them.
let lines = [];
let linesReady = Promise.resolve();
const embedded = document.querySelector('meta[name="qripple-lines"]')?.content;
if (embedded) {
  try {
    lines = validLines(JSON.parse(embedded));
  } catch {
    lines = [];
  }
} else {
  linesReady = Promise.race([
    fetch('/lines.json', { cache: 'no-cache' })
      .then((res) => (res.ok ? res.json() : { lines: [] }))
      .then((data) => {
        lines = validLines(data.lines);
      })
      .catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
}

function readPreferred() {
  try {
    return localStorage.getItem(PREFERRED_KEY);
  } catch {
    return null;
  }
}

function writePreferred(id) {
  try {
    if (id) localStorage.setItem(PREFERRED_KEY, id);
  } catch {
    // storage unavailable: just no preference next time
  }
}

function silence(ws) {
  ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
  try {
    ws.close();
  } catch {
    // already closing
  }
}

export class Connection {
  constructor({ onOpen, onMessage, onStatus, onTiming }) {
    this.onOpen = onOpen;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.onTiming = onTiming;
    this.latencyMs = 0;
    this.pingId = 0;
    this.pendingPing = null;
    this.lastPing = -Infinity;
    this.ws = null;
    this.line = null; // the line the open socket uses ({ id, url })
    this.suspect = null; // id of a line that just failed; tried last next time
    this.round = null; // the attempt in progress
    this.status = 'connecting';
    this.attempts = 0; // consecutive failed attempts
    this.everOpened = false;
    this.stopped = false;
    this.retryTimer = null;
    this.lastTraffic = 0;

    this.handleOnline = () => this.reconnectNow();
    this.handleOffline = () => this.#setStatus('offline');
    this.handleVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (this.open) this.#ping();
      else this.reconnectNow();
    };
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
    document.addEventListener('visibilitychange', this.handleVisible);
    this.heartbeat = setInterval(() => this.#checkAlive(), 2500);
  }

  start() {
    linesReady.then(() => this.#connect());
    return this;
  }

  get open() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(msg) {
    if (!this.open) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  /** Close for good. Messages already passed to send() are still delivered. */
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.heartbeat);
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
    document.removeEventListener('visibilitychange', this.handleVisible);
    this.#abortRound();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = ws.onerror = ws.onmessage = ws.onopen = null;
      try {
        ws.close(1000);
      } catch {
        // already closing
      }
    }
    this.#setStatus('closed');
  }

  reconnectNow() {
    if (this.stopped || this.open || this.round) return;
    clearTimeout(this.retryTimer);
    this.#connect();
  }

  /** Lines to try, best first. */
  #candidates() {
    const list = lines.length ? [...lines] : [];
    // Same-origin last: a safety net if the line hostnames don't resolve.
    if (!list.some((l) => new URL(l.url).host === location.host)) list.push(sameOrigin);
    const preferred = readPreferred();
    const rank = (l) => (l.id && l.id === this.suspect ? 2 : l.id && l.id === preferred ? 0 : 1);
    return list.map((l, i) => ({ l, i })).sort((a, b) => rank(a.l) - rank(b.l) || a.i - b.i).map(({ l }) => l);
  }

  #connect() {
    if (this.stopped || this.open || this.round) return;
    this.#setStatus(this.everOpened || this.attempts > 0 ? 'reconnecting' : 'connecting');
    const list = this.#candidates();
    const round = { done: false, sockets: new Set(), started: 0, failed: 0, hedge: null, timeout: null };
    this.round = round;

    const end = () => {
      round.done = true;
      clearTimeout(round.hedge);
      clearTimeout(round.timeout);
      if (this.round === round) this.round = null;
    };
    const fail = () => {
      if (round.done) return;
      round.failed += 1;
      if (round.started < list.length) startNext();
      else if (round.failed >= list.length) {
        end();
        this.#scheduleRetry();
      }
    };
    const startNext = () => {
      if (round.done || round.started >= list.length) return;
      const line = list[round.started++];
      clearTimeout(round.hedge);
      if (round.started < list.length) round.hedge = setTimeout(startNext, HEDGE_MS);
      let ws;
      try {
        ws = new WebSocket(line.url);
      } catch {
        fail();
        return;
      }
      round.sockets.add(ws);
      ws.onopen = () => {
        if (round.done || this.stopped) return silence(ws);
        round.sockets.delete(ws);
        for (const other of round.sockets) silence(other);
        end();
        this.#adopt(ws, line);
      };
      ws.onerror = () => {
        // onclose follows
      };
      ws.onclose = () => {
        round.sockets.delete(ws);
        fail();
      };
    };

    round.timeout = setTimeout(() => {
      if (round.done) return;
      for (const ws of round.sockets) silence(ws);
      end();
      this.#scheduleRetry();
    }, ATTEMPT_TIMEOUT_MS);
    startNext();
  }

  #adopt(ws, line) {
    this.ws = ws;
    this.line = line;
    this.suspect = null;
    writePreferred(line.id);
    this.attempts = 0;
    this.everOpened = true;
    this.lastTraffic = Date.now();
    this.latencyMs = 0;
    this.pendingPing = null;
    this.lastPing = -Infinity;
    ws.onmessage = (event) => {
      this.lastTraffic = Date.now();
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg?.t === 'pong') {
        if (this.pendingPing && msg.id === this.pendingPing.id) {
          // Age is sampled at the server immediately before the response.
          // Half the round trip estimates its transit time without comparing clocks.
          this.latencyMs = Math.max(0, performance.now() - this.pendingPing.at) / 2;
          this.pendingPing = null;
          this.onTiming?.(msg.timing, this.latencyMs);
        }
        return;
      }
      this.onMessage?.(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.#dropped();
    };
    ws.onerror = () => {};
    this.#setStatus('online');
    this.onOpen?.();
    this.#ping();
  }

  #ping() {
    if (!this.open) return;
    const at = performance.now();
    const id = ++this.pingId;
    this.pendingPing = { id, at };
    this.lastPing = at;
    this.send({ t: 'ping', id });
  }

  /** The open connection was lost: retry soon, trying the other lines first. */
  #dropped() {
    this.suspect = this.line?.id ?? null;
    this.ws = null;
    this.#scheduleRetry();
  }

  #abortRound() {
    const round = this.round;
    if (!round) return;
    for (const ws of round.sockets) silence(ws);
    round.done = true;
    clearTimeout(round.hedge);
    clearTimeout(round.timeout);
    this.round = null;
  }

  #scheduleRetry() {
    if (this.stopped) return;
    this.attempts += 1;
    this.#setStatus(navigator.onLine === false ? 'offline' : 'reconnecting');
    const base = BACKOFF_MS[Math.min(this.attempts - 1, BACKOFF_MS.length - 1)];
    const delay = base * (0.75 + Math.random() * 0.5);
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.#connect(), delay);
  }

  #checkAlive() {
    if (!this.open) return;
    const quiet = Date.now() - this.lastTraffic;
    if (quiet > DEAD_AFTER_MS) {
      // Half-open connection (common after a network switch or on a lossy
      // line): drop it and reconnect, preferring another line.
      const ws = this.ws;
      silence(ws);
      this.#dropped();
    } else if (performance.now() - this.lastPing >= PING_AFTER_MS) {
      this.#ping();
    }
  }

  #setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.onStatus?.(status, this);
  }
}
