// Server-provided payload age anchored to a monotonic clock, so wall-clock
// differences between devices and local clock adjustments do not affect it.
export class PayloadAge {
  constructor(now = () => performance.now()) {
    this.now = now;
    this.rev = null;
    this.ageMs = 0;
    this.at = now();
  }

  set({ rev, ageMs = 0 }, transitMs = 0) {
    this.rev = rev;
    this.ageMs = Math.max(0, Number.isFinite(ageMs) ? ageMs : 0)
      + Math.max(0, Number.isFinite(transitMs) ? transitMs : 0);
    this.at = this.now();
  }

  sync(sample, transitMs) {
    // A delayed timing reply must not change the age of a newer QR code.
    if (!sample || sample.rev !== this.rev || !Number.isFinite(sample.ageMs)) return;
    this.set(sample, transitMs);
  }

  get elapsedMs() {
    return Math.max(0, this.ageMs + this.now() - this.at);
  }
}

export function elapsedParts(ms) {
  // Nearest second keeps rounding error <= 0.5 s (plus display refresh delay).
  const total = Math.max(0, Math.round(ms / 1000));
  return { h: Math.floor(total / 3600), m: Math.floor(total / 60) % 60, s: total % 60 };
}
