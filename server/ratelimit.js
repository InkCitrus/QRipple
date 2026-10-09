// Token-bucket rate limiting, keyed (per IP) or standalone (per socket).

export class TokenBucket {
  constructor({ capacity, refillMs, now = Date.now }) {
    this.capacity = capacity;
    this.refillMs = refillMs;
    this.now = now;
    this.tokens = capacity;
    this.updated = now();
  }

  #refill() {
    const t = this.now();
    if (this.refillMs > 0) {
      const gained = (t - this.updated) / this.refillMs;
      this.tokens = Math.min(this.capacity, this.tokens + gained);
    }
    this.updated = t;
  }

  take(n = 1) {
    this.#refill();
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }

  peek() {
    this.#refill();
    return this.tokens;
  }

  get full() {
    return this.peek() >= this.capacity;
  }
}

export class KeyedLimiter {
  constructor({ capacity, refillMs, now = Date.now, maxKeys = 100_000 }) {
    this.opts = { capacity, refillMs, now };
    this.maxKeys = maxKeys;
    this.buckets = new Map();
  }

  #bucket(key) {
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= this.maxKeys) this.prune();
      b = new TokenBucket(this.opts);
      this.buckets.set(key, b);
    }
    return b;
  }

  take(key, n = 1) {
    return this.#bucket(key).take(n);
  }

  /** True when the key still has at least one token, without consuming it. */
  allowed(key) {
    const b = this.buckets.get(key);
    return !b || b.peek() >= 1;
  }

  /** Drop buckets that have fully refilled; they carry no state worth keeping. */
  prune() {
    for (const [key, b] of this.buckets) {
      if (b.full) this.buckets.delete(key);
    }
  }
}
