import { describe, expect, it, vi } from 'vitest';
import { LRUCache } from './cache';
import { cachedLoad, SingleFlight } from './singleFlight';
describe('bounded LRU and single-flight misses', () => {
  it('overwriting at capacity does not evict an unrelated key', () => {
    const cache = new LRUCache<string, number>(2); cache.set('a', 1, 1000); cache.set('b', 2, 1000); cache.set('b', 3, 1000);
    expect(cache.get('a')).toBe(1); expect(cache.get('b')).toBe(3); expect(cache.size()).toBe(2);
  });
  it('coalesces five misses and retries failures instead of caching a rejected promise', async () => {
    const cache = new LRUCache<string, number>(); const factory = vi.fn(async () => 42);
    expect(await Promise.all(Array.from({ length: 5 }, () => cachedLoad(cache, 'same', 1000, factory)))).toEqual([42, 42, 42, 42, 42]);
    expect(factory).toHaveBeenCalledTimes(1);
    const failed = vi.fn(async () => { throw new Error('down'); });
    await expect(cachedLoad(cache, 'failed', 1000, failed)).rejects.toThrow('down');
    expect(await cachedLoad(cache, 'failed', 1000, factory)).toBe(42);
  });
  it('caps distinct concurrent keys without evicting active work', async () => {
    const flight = new SingleFlight<string, number>(1); let resolve!: (n: number) => void;
    const wait = new Promise<number>(r => { resolve = r; }); const one = flight.run('a', () => wait);
    expect(flight.run('a', () => Promise.resolve(2))).toBe(one);
    await expect(flight.run('b', () => Promise.resolve(3))).rejects.toThrow('concurrency');
    resolve(1); await one; expect(flight.size).toBe(0);
  });
});
