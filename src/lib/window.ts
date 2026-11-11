/**
 * Rolling event counter in fixed time buckets: O(1) per event and fixed memory per key, however hard it is hammered.
 * Per process only (a restart starts fresh), which suits alert thresholds that only need a rough rate.
 */
export class RollingCounter {
  private buckets = new Map<string, { slot: number; n: number }[]>();
  private slotMs: number;
  private slots: number;
  constructor(windowMs: number, slots = 60) {
    this.slots = slots;
    this.slotMs = Math.max(1, Math.floor(windowMs / slots));
  }

  /** Records one event and returns the count inside the window (including this one). */
  hit(key: string, now = Date.now()): number {
    const slot = Math.floor(now / this.slotMs);
    const list = this.buckets.get(key) ?? [];
    const last = list[list.length - 1];
    if (last && last.slot === slot) last.n++;
    else list.push({ slot, n: 1 });
    this.buckets.set(key, list);
    return this.count(key, now);
  }

  count(key: string, now = Date.now()): number {
    const list = this.buckets.get(key);
    if (!list) return 0;
    const oldest = Math.floor(now / this.slotMs) - this.slots + 1;
    while (list.length && list[0].slot < oldest) list.shift();
    return list.reduce((n, b) => n + b.n, 0);
  }
}
