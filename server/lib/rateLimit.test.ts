import { describe, it, expect, beforeEach } from 'vitest';
import { policyForPath, policyForRequest, requestPath, isRateLimited, clearAllBuckets, getBucketStats, retryAfterSeconds } from './rateLimit';

/**
 * The limiter used to be one global 30/min bucket keyed on a spoofable IP, which meant the
 * legitimate fallback poll (~24/min) plus a chart load plus a quote cross-check could push a
 * single browser tab over the edge - and the client had no way to know why prices froze.
 * These pin the per-endpoint shape and the Retry-After contract the client now honours.
 */
describe('per-endpoint rate limit policies', () => {
  it('gives the cheap poll endpoint more headroom than the default', () => {
    expect(policyForPath('/api/market/prices').max).toBeGreaterThan(policyForPath('/api/whatever').max);
    expect(policyForPath('/api/market/prices').label).toBe('prices');
  });

  it('throttles the endpoints that spend upstream credits hardest', () => {
    expect(policyForPath('/api/market/quote?symbol=EURUSD').max).toBeLessThanOrEqual(10);
    expect(policyForPath('/api/market/forexrate').max).toBeLessThanOrEqual(10);
    expect(policyForPath('/api/market/quote').max).toBeLessThan(policyForPath('/api/market/prices').max);
  });

  it('does not starve the health endpoint monitors depend on', () => {
    expect(policyForPath('/api/health').max).toBeGreaterThanOrEqual(60);
  });

  it('falls back to the default policy for unknown api paths', () => {
    expect(policyForPath('/api/nope').label).toBe('default');
  });

  it('resolves from originalUrl, because req.path is mount-relative inside app.use("/api")', () => {
    // Regression found by a live probe: policyForPath(req.path) always returned 'default'.
    const mounted = { baseUrl: '/api', path: '/market/prices', originalUrl: '/api/market/prices?x=1' };
    expect(requestPath(mounted)).toBe('/api/market/prices');
    expect(policyForRequest(mounted).label).toBe('prices');
    expect(policyForPath(mounted.path).label).toBe('default'); // what the bug looked like
  });
});

describe('limiter behaviour', () => {
  beforeEach(() => clearAllBuckets());

  it('allows max requests then blocks, per bucket key', async () => {
    const key = 'prices:10.0.0.1';
    for (let i = 0; i < 3; i++) expect(await isRateLimited(key, 3, 60_000)).toBe(false);
    expect(await isRateLimited(key, 3, 60_000)).toBe(true);
    // A different client is unaffected - this is what the X-Forwarded-For bug destroyed.
    expect(await isRateLimited('prices:10.0.0.2', 3, 60_000)).toBe(false);
  });

  it('keeps buckets isolated per policy label', async () => {
    await isRateLimited('quote:1.1.1.1', 1, 60_000);
    expect(await isRateLimited('quote:1.1.1.1', 1, 60_000)).toBe(true);
    expect(await isRateLimited('prices:1.1.1.1', 1, 60_000)).toBe(false);
    expect(getBucketStats().apiBuckets).toBeGreaterThanOrEqual(2);
  });

  it('reports a Retry-After within the window', async () => {
    const key = 'default:2.2.2.2';
    const windowMs = 60_000;
    await isRateLimited(key, 1, windowMs);
    const limited = await isRateLimited(key, 1, windowMs);
    expect(limited).toBe(true);
    const seconds = retryAfterSeconds(key, windowMs);
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(60);
  });
});
