// Decides which QR code is being shared while the camera sees zero, one or
// several codes. Pure logic with no DOM access, so it is unit-tested in Node.
//
// - One code in view: it is shared automatically.
// - Several separate codes in view: the user picks one to follow.
// - New content at the followed code's spot wins on its first read, even
//   when the decoder or visibility cache still contains its old content.
// - Decoded changes are shared immediately by default. Callers can opt into
//   multiple reads via `confirmReads` if they prefer confirmation over latency.

const ROW_TOLERANCE = 0.15; // centers closer than this vertically count as one row
const REFRESH_OVERLAP = 0.6; // bounding-box intersection / union for a refresh

function bounds(quad) {
  const xs = quad.map(([x]) => x);
  const ys = quad.map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export class CodeTracker {
  constructor({ confirmReads = 1, confirmWindowMs = 1000, seenMs = 700, sameSpot = 0.15 } = {}) {
    this.confirmReads = confirmReads;
    this.confirmWindowMs = confirmWindowMs; // reads further apart than this don't add up
    this.seenMs = seenMs; // a code stays "in view" this long after its last read
    this.sameSpot = sameSpot; // max center distance (fraction of the preview) for "same code, new content"
    this.codes = new Map(); // key -> { key, text, bytes, quad, center, firstSeenAt, seenAt, superseded }
    this.selection = null; // { key, quad, center, firstSeenAt, seenAt }: the code being followed
    this.current = null; // { key, text, bytes, at }: what is being shared
    this.candidate = null; // { key, text, bytes, quad, center, count, lastAt }
    this.lastSeenAt = 0;
  }

  /** Codes currently in view, in the order they appeared. */
  get visible() {
    return [...this.codes.values()].filter((code) => !code.superseded);
  }

  /** True when several codes are in view and none of them is being followed. */
  get needsChoice() {
    return this.visible.length >= 2 && !(this.selection && this.codes.has(this.selection.key));
  }

  /**
   * Feed one decoded frame: codes = [{ key, text, bytes, quad, center }].
   * Returns the newly shared code, or null when nothing changed.
   */
  update(codes, now) {
    for (const [key, code] of this.codes) {
      if (now - code.seenAt > this.seenMs) this.codes.delete(key);
    }
    const frame = [];
    // Codes that show up together are numbered in reading order on screen
    // (top to bottom, then left to right); after that their numbers stay put.
    const ordered = [...codes].sort((a, b) =>
      Math.abs(a.center[1] - b.center[1]) > ROW_TOLERANCE ? a.center[1] - b.center[1] : a.center[0] - b.center[0],
    );
    for (const code of ordered) {
      if (frame.some((c) => c.key === code.key)) continue; // same content twice in view
      frame.push(code);
      const known = this.codes.get(code.key);
      this.codes.set(code.key, {
        ...code,
        firstSeenAt: known ? known.firstSeenAt : now,
        seenAt: now,
        superseded: known?.superseded ?? false,
      });
    }
    const activeFrame = frame.filter((code) => !this.codes.get(code.key).superseded);
    if (activeFrame.length > 0) this.lastSeenAt = now;

    const followed = this.selection && activeFrame.find((c) => c.key === this.selection.key);
    if (followed) Object.assign(this.selection, { center: followed.center, quad: followed.quad, seenAt: now });

    const target = this.#target(activeFrame);
    if (!target) return null;
    if (this.current && this.current.key === target.key) {
      this.candidate = null;
      return null;
    }
    const c = this.candidate;
    if (c && c.key === target.key && now - c.lastAt <= this.confirmWindowMs) {
      c.count += 1;
      c.lastAt = now;
      c.center = target.center;
      c.quad = target.quad;
    } else {
      this.candidate = { ...target, count: 1, lastAt: now };
    }
    if (!this.current || this.candidate.count >= this.confirmReads) return this.#commit(this.candidate, now);
    return null;
  }

  /** The user picked a code (by key) from those in view. Returns it if newly shared. */
  choose(key, now) {
    const code = this.codes.get(key);
    if (!code || code.superseded) return null;
    if (this.current && this.current.key === key) {
      this.selection = { key, center: code.center, quad: code.quad, firstSeenAt: code.firstSeenAt, seenAt: now };
      return null;
    }
    return this.#commit(code, now);
  }

  #target(frame) {
    if (frame.length === 0) return null;
    // Only one code around: it is the obvious choice.
    if (frame.length === 1 && this.visible.length === 1) return frame[0];
    // Prefer newly observed content in the followed code's footprint before
    // falling back to its old value. Decoder order carries no freshness.
    const sel = this.selection;
    if (!sel) return null;
    const same = frame.find((c) => c.key === sel.key);
    const refreshes = frame.filter((code) =>
      code.key !== sel.key && this.codes.get(code.key).firstSeenAt > sel.firstSeenAt && this.#samePlace(sel, code),
    );
    if (refreshes.length) {
      const newestAt = Math.max(...refreshes.map((code) => this.codes.get(code.key).firstSeenAt));
      const newest = refreshes.filter((code) => this.codes.get(code.key).firstSeenAt === newestAt);
      // Two values first seen together have no known order: keep following
      // the current value rather than guessing between them.
      return newest.length === 1 ? newest[0] : same || null;
    }
    if (same) return same;
    // The followed code may have changed content in place: accept a code that
    // appeared after the followed one was last seen, at about the same spot.
    let best = null;
    let bestDistance = this.sameSpot;
    for (const code of frame) {
      if (this.codes.get(code.key).firstSeenAt < sel.seenAt) continue; // was there all along
      const d = Math.hypot(code.center[0] - sel.center[0], code.center[1] - sel.center[1]);
      if (d < bestDistance) {
        best = code;
        bestDistance = d;
      }
    }
    return best;
  }

  #samePlace(a, b) {
    if (!a.quad || !b.quad || Math.hypot(a.center[0] - b.center[0], a.center[1] - b.center[1]) >= this.sameSpot) return false;
    const [ax1, ay1, ax2, ay2] = bounds(a.quad);
    const [bx1, by1, bx2, by2] = bounds(b.quad);
    const intersection = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1))
      * Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
    const union = (ax2 - ax1) * (ay2 - ay1) + (bx2 - bx1) * (by2 - by1) - intersection;
    return union > 0 && intersection / union >= REFRESH_OVERLAP;
  }

  #commit(code, now) {
    const firstSeenAt = this.codes.get(code.key).firstSeenAt;
    if (this.selection && firstSeenAt > this.selection.firstSeenAt && this.#samePlace(this.selection, code)) {
      // Keep stale keys remembered while they are still being decoded, so
      // they cannot bounce back into the UI or become the target again.
      for (const old of this.codes.values()) {
        if (old.firstSeenAt < firstSeenAt && this.#samePlace(old, code)) old.superseded = true;
      }
    }
    this.current = { key: code.key, text: code.text, bytes: code.bytes, at: now };
    this.selection = { key: code.key, center: code.center, quad: code.quad, firstSeenAt, seenAt: now };
    this.candidate = null;
    return this.current;
  }
}
