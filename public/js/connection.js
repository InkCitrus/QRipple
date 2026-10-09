// WebSocket wrapper with automatic reconnection and a liveness check.
// Status values: 'connecting' | 'online' | 'reconnecting' | 'offline' | 'closed'.

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15000];
const PING_AFTER_MS = 15000; // send a ping when the line has been quiet this long
const DEAD_AFTER_MS = 35000; // no traffic at all for this long: assume the socket is dead

export class Connection {
  constructor({ onOpen, onMessage, onStatus }) {
    this.onOpen = onOpen;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.ws = null;
    this.status = 'connecting';
    this.attempts = 0; // consecutive failed attempts
    this.everOpened = false;
    this.stopped = false;
    this.retryTimer = null;
    this.lastTraffic = 0;

    this.url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    this.handleOnline = () => this.reconnectNow();
    this.handleOffline = () => this.#setStatus('offline');
    this.handleVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (this.ws?.readyState === WebSocket.OPEN) this.send({ t: 'ping' });
      else this.reconnectNow();
    };
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
    document.addEventListener('visibilitychange', this.handleVisible);
    this.heartbeat = setInterval(() => this.#checkAlive(), 5000);
  }

  start() {
    this.#connect();
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
    if (this.stopped || this.open || this.ws?.readyState === WebSocket.CONNECTING) return;
    clearTimeout(this.retryTimer);
    this.#connect();
  }

  #connect() {
    if (this.stopped) return;
    this.#setStatus(this.everOpened || this.attempts > 0 ? 'reconnecting' : 'connecting');
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.#scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.attempts = 0;
      this.everOpened = true;
      this.lastTraffic = Date.now();
      this.#setStatus('online');
      this.onOpen?.();
    };
    ws.onmessage = (event) => {
      this.lastTraffic = Date.now();
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg?.t === 'pong') return;
      this.onMessage?.(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.#scheduleRetry();
    };
    ws.onerror = () => {
      // onclose follows and handles the retry
    };
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
      // Half-open connection (common after a network switch): drop it.
      const ws = this.ws;
      this.ws = null;
      ws.onclose = ws.onerror = ws.onmessage = ws.onopen = null;
      try {
        ws.close();
      } catch {
        // ignore
      }
      this.#scheduleRetry();
    } else if (quiet > PING_AFTER_MS) {
      this.send({ t: 'ping' });
    }
  }

  #setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.onStatus?.(status, this);
  }
}
