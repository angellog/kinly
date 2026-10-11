/** A per-key token bucket (R8): `capacity` requests, refilled at `perMinute`. */
export class TokenBucket {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  constructor(
    private readonly capacity = 60,
    private readonly perMinute = 60,
    private readonly now: () => number = Date.now,
  ) {}

  take(key: string): boolean {
    const t = this.now();
    const b = this.buckets.get(key) ?? { tokens: this.capacity, at: t };
    b.tokens = Math.min(this.capacity, b.tokens + ((t - b.at) / 60_000) * this.perMinute);
    b.at = t;
    const ok = b.tokens >= 1;
    if (ok) b.tokens -= 1;
    this.buckets.set(key, b);
    if (this.buckets.size > 10_000) this.prune(t);
    return ok;
  }

  private prune(t: number): void {
    for (const [k, b] of this.buckets) if (t - b.at > 10 * 60_000) this.buckets.delete(k);
  }
}
