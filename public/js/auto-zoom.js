// Camera auto-zoom decisions. Pure logic with no DOM or camera access, so it
// is unit-tested in Node; scanner.js applies the result to the camera track.
//
// Zooming in only helps when the camera can see a code but not read it (too
// few pixels per module). The decoder reports such codes ("failed", with a
// position); when one keeps showing up at the same spot, zoom in a step - but
// only if every code in view stays inside the frame afterwards. Zoom back out
// when a code fills or overflows the frame, and reset after a while with
// nothing in view. Zoom is centered, so positions scale around (0.5, 0.5).

export class AutoZoom {
  constructor({
    min = 1,
    max = 3,
    step = 1.4,
    settleMs = 800, // let the camera refocus between changes
    idleResetMs = 3000, // nothing in view this long: back to min
    needHits = 3, // failed reads at one spot before zooming in
    hitWindowMs = 1200,
    margin = 0.06, // codes must stay this far inside the frame
    tooBig = 0.85, // a code wider than this: zoom out
  } = {}) {
    Object.assign(this, { min, max, step, settleMs, idleResetMs, needHits, hitWindowMs, margin, tooBig });
    this.zoom = min;
    this.lastChange = -Infinity;
    this.lastSeen = -Infinity;
    this.pausedUntil = -Infinity;
    this.hits = []; // recent failed reads: { center, at }
    this.wantsCloser = false; // a code needs more pixels than zoom can provide
  }

  /** Stop deciding until `until` (e.g. after the user resets zoom by hand). */
  pause(until) {
    this.pausedUntil = until;
    this.hits = [];
  }

  /**
   * Feed one decoded frame. codes / failed: [{ quad: [[x, y] x4], center: [x, y] }]
   * in fractions of the visible frame at the current zoom. Returns the new
   * zoom level to apply, or null to keep the current one.
   */
  update({ codes = [], failed = [] }, now) {
    const all = [...codes, ...failed];
    if (all.length > 0) this.lastSeen = now;
    for (const f of failed) this.hits.push({ center: f.center, at: now });
    this.hits = this.hits.filter((h) => now - h.at <= this.hitWindowMs);
    const stuck = this.#stuckSpot();
    // Nothing readable, a code keeps failing, and zoom can't help any further.
    this.wantsCloser = Boolean(stuck) && codes.length === 0 && this.zoom >= this.max;

    if (now < this.pausedUntil || now - this.lastChange < this.settleMs) return null;

    if (this.zoom > this.min && now - this.lastSeen > this.idleResetMs) return this.#set(this.min, now);

    const overflowing = all.some((c) => {
      const xs = c.quad.map((p) => p[0]);
      const ys = c.quad.map((p) => p[1]);
      return Math.max(...xs) - Math.min(...xs) > this.tooBig || xs.some((x) => x < 0 || x > 1) || ys.some((y) => y < 0 || y > 1);
    });
    if (overflowing && this.zoom > this.min) return this.#set(Math.max(this.min, this.zoom / this.step), now);

    if (stuck && this.zoom < this.max) {
      let next = this.zoom * this.step;
      if (next >= this.max / 1.1) next = this.max; // no pointless tiny last step
      const f = next / this.zoom;
      const lo = this.margin;
      const hi = 1 - this.margin;
      const fits = all.every((c) => c.quad.every(([x, y]) => {
        const zx = 0.5 + (x - 0.5) * f;
        const zy = 0.5 + (y - 0.5) * f;
        return zx >= lo && zx <= hi && zy >= lo && zy <= hi;
      }));
      if (fits) return this.#set(next, now);
    }
    return null;
  }

  /** The spot of the latest failed read, if failed reads keep landing there. */
  #stuckSpot() {
    const last = this.hits[this.hits.length - 1];
    if (!last) return null;
    const near = this.hits.filter((h) => Math.hypot(h.center[0] - last.center[0], h.center[1] - last.center[1]) < 0.1);
    return near.length >= this.needHits ? last.center : null;
  }

  #set(zoom, now) {
    if (Math.abs(zoom - this.zoom) < 1e-6) return null;
    this.zoom = zoom;
    this.lastChange = now;
    this.hits = []; // positions change with zoom
    return zoom;
  }
}
