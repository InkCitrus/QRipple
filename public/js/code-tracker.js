// Decides which QR code is being shared while the camera sees zero, one or
// several codes. Pure logic with no DOM access, so it is unit-tested in Node.
//
// - One code in view: it is shared automatically.
// - Several codes in view: nothing changes until the user picks one; after
//   that the picked code is followed (also when its content refreshes in
//   place, as with dynamic check-in or payment codes).
// - The first code is shared on its first read. Replacing what is shared needs
//   `confirmReads` reads of the new value without a conflicting read in
//   between, so a stray misread cannot make receivers flicker.

const ROW_TOLERANCE = 0.15; // centers closer than this vertically count as one row

export class CodeTracker {
  constructor({ confirmReads = 2, confirmWindowMs = 1000, seenMs = 700, sameSpot = 0.15 } = {}) {
    this.confirmReads = confirmReads;
    this.confirmWindowMs = confirmWindowMs; // reads further apart than this don't add up
    this.seenMs = seenMs; // a code stays "in view" this long after its last read
    this.sameSpot = sameSpot; // max center distance (fraction of the preview) for "same code, new content"
    this.codes = new Map(); // key -> { key, text, bytes, quad, center, firstSeenAt, seenAt }
    this.selection = null; // { key, center, seenAt }: the code being followed
    this.current = null; // { key, text, bytes, at }: what is being shared
    this.candidate = null; // { key, text, bytes, center, count, lastAt }
    this.lastSeenAt = 0;
  }

  /** Codes currently in view, in the order they appeared. */
  get visible() {
    return [...this.codes.values()];
  }

  /** True when several codes are in view and none of them is being followed. */
  get needsChoice() {
    return this.codes.size >= 2 && !(this.selection && this.codes.has(this.selection.key));
  }

  /**
   * Feed one decoded frame: codes = [{ key, text, bytes, quad, center }].
   * Returns the newly shared code, or null when nothing changed.
   */
  update(codes, now) {
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
      this.codes.set(code.key, { ...code, firstSeenAt: known ? known.firstSeenAt : now, seenAt: now });
    }
    for (const [key, code] of this.codes) {
      if (now - code.seenAt > this.seenMs) this.codes.delete(key);
    }
    if (frame.length > 0) this.lastSeenAt = now;

    const followed = this.selection && frame.find((c) => c.key === this.selection.key);
    if (followed) Object.assign(this.selection, { center: followed.center, seenAt: now });

    const target = this.#target(frame);
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
    } else {
      this.candidate = { key: target.key, text: target.text, bytes: target.bytes, center: target.center, count: 1, lastAt: now };
    }
    if (!this.current || this.candidate.count >= this.confirmReads) return this.#commit(this.candidate, now);
    return null;
  }

  /** The user picked a code (by key) from those in view. Returns it if newly shared. */
  choose(key, now) {
    const code = this.codes.get(key);
    if (!code) return null;
    if (this.current && this.current.key === key) {
      this.selection = { key, center: code.center, seenAt: now };
      return null;
    }
    return this.#commit(code, now);
  }

  #target(frame) {
    if (frame.length === 0) return null;
    // Only one code around: it is the obvious choice.
    if (frame.length === 1 && this.codes.size === 1) return frame[0];
    // Several codes: follow the one picked (or shared last), never guess.
    const sel = this.selection;
    if (!sel) return null;
    const same = frame.find((c) => c.key === sel.key);
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

  #commit(code, now) {
    this.current = { key: code.key, text: code.text, bytes: code.bytes, at: now };
    this.selection = { key: code.key, center: code.center, seenAt: now };
    this.candidate = null;
    return this.current;
  }
}
