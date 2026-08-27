/**
 * Simple LRU cache with TTL for history and price endpoints
 */
type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

export class LRUCache<K, V> {
  private map = new Map<K, CacheEntry<V>>();
  private maxSize: number;

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh LRU order
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V, ttlMs: number): void {
    if (this.map.size >= this.maxSize) {
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) this.map.delete(firstKey);
    }
    this.map.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  clear() {
    this.map.clear();
  }

  size() {
    return this.map.size;
  }
}

// Global caches
export const historyCache = new LRUCache<string, any>(200);
export const priceCache = new LRUCache<string, any>(50);
