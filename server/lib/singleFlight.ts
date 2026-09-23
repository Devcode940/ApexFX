import type { LRUCache } from './cache';

export class SingleFlight<K, V> {
  private pending = new Map<K, Promise<V>>();
  constructor(private readonly limit = 128) {}
  run(key: K, factory: () => Promise<V>): Promise<V> {
    const existing = this.pending.get(key);
    if (existing) return existing;
    if (this.pending.size >= this.limit) return Promise.reject(new Error('Upstream concurrency limit reached'));
    const result = Promise.resolve().then(factory).finally(() => this.pending.delete(key));
    this.pending.set(key, result);
    return result;
  }
  get size() { return this.pending.size; }
}
const flights = new SingleFlight<string, unknown>();
export function singleFlight<T>(key: string, factory: () => Promise<T>): Promise<T> {
  return flights.run(key, factory) as Promise<T>;
}
export function cachedLoad<T>(cache: LRUCache<string, T>, key: string, ttl: number, factory: () => Promise<T>): Promise<T> {
  const existing = cache.get(key);
  if (existing !== undefined) return Promise.resolve(existing);
  return singleFlight(key, async () => {
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const result = await factory();
    cache.set(key, result, ttl);
    return result;
  });
}
