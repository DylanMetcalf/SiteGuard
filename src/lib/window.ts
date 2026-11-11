/**
 * Small in-memory sliding-window counter. Used for per-email sign-in limits and for the alert thresholds.
 * Per process only (a restart or a second instance starts fresh), which is fine for both: the sign-in limit is a
 * second layer behind the per-address limit and the 10-failure lockout, and alerts only need a rough rate.
 */
export class SlidingWindow {
  private hits = new Map<string, number[]>();
  constructor(private windowMs: number, private maxKeys = 50_000) {}

  /** Records one event and returns how many fall inside the window (including this one). */
  hit(key: string, now = Date.now()): number {
    const cutoff = now - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > this.maxKeys) this.prune(now);
    return list.length;
  }

  count(key: string, now = Date.now()): number {
    const cutoff = now - this.windowMs;
    return (this.hits.get(key) ?? []).filter((t) => t > cutoff).length;
  }

  private prune(now: number) {
    const cutoff = now - this.windowMs;
    for (const [k, v] of this.hits) if (!v.some((t) => t > cutoff)) this.hits.delete(k);
    // Still too many live keys (an attack with endless distinct emails): drop the oldest half rather than grow without bound.
    if (this.hits.size > this.maxKeys) {
      const keys = [...this.hits.keys()];
      for (const k of keys.slice(0, Math.floor(keys.length / 2))) this.hits.delete(k);
    }
  }
}
