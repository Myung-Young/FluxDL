/**
 * Tiny LRU cache with TTL (M2.3 analyze cache). Capacity + expiry bounded;
 * clock injectable for deterministic tests.
 */

export interface CacheClock {
  now(): number;
}

const systemClock: CacheClock = {
  now: () => Date.now(),
};

export class LruCache<V> {
  private readonly max: number;
  private readonly ttlMs: number;
  private readonly clock: CacheClock;
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  constructor(maxEntries: number, ttlMs: number, clock: CacheClock = systemClock) {
    this.max = Math.max(1, Math.floor(maxEntries));
    this.ttlMs = Math.max(0, ttlMs);
    this.clock = clock;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): V | null {
    const found = this.entries.get(key);
    if (found === undefined) return null;
    if (found.expiresAt <= this.clock.now()) {
      this.entries.delete(key);
      return null;
    }
    // Refresh recency.
    this.entries.delete(key);
    this.entries.set(key, found);
    return found.value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.clock.now() + this.ttlMs });
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}
