import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchTiingoQuotes, fetchTiingoHistory, parseTiingoQuote, parseTiingoHistory, getTiingoPollMs, getTiingoHistoryCacheMs, tiingoStatus, tiingoRetryDelay } from './tiingo';
import { priceCache, historyCache } from '../lib/cache';
import { isExecutableQuote, quoteQuality } from '../../shared/market';
import { redact } from '../lib/logger';

const NOW = Date.parse('2026-09-23T12:00:00Z');
const top = (extra: Record<string, unknown> = {}) => ({ ticker: 'eurusd', quoteTimestamp: new Date(Date.now()).toISOString(), bidPrice: 1.1, askPrice: 1.1004, midPrice: 999, ...extra });
const daily = (date = '2026-09-21T00:00:00.000Z', extra: Record<string, unknown> = {}) => ({ ticker: 'eurusd', date, open: '1.10', high: '1.13', low: '1.08', close: '1.12', ...extra });
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
let sequence = 0;
let fetch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW); priceCache.clear(); historyCache.clear();
  for (const name of ['VERCEL', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'MARKET_DATA_MODE', 'TIINGO_POLL_MS', 'TIINGO_HISTORY_CACHE_MS']) vi.stubEnv(name, '');
  vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('TIINGO_API_KEY', `fixture-tiingo-only-${++sequence}`);
  fetch = vi.fn(async () => json([top()])); vi.stubGlobal('fetch', fetch);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Tiingo timestamped midpoint normalization', () => {
  it('calculates midpoint from bid/ask, keeps provenance and does not invent day statistics', () => {
    const quote = parseTiingoQuote(top())!;
    expect(quote).toMatchObject({ symbol: 'EURUSD', provider: 'tiingo', providerSymbol: 'eurusd', instrumentKind: 'spot', bid: 1.1, ask: 1.1004, priceBasis: 'mid', dayStatsAvailable: false, asOf: NOW, receivedAt: NOW });
    expect(quote.price).toBeCloseTo(1.1002); expect(isExecutableQuote(quote)).toBe(true);
  });
  it.each([
    { ticker: 'not-a-catalog-symbol' }, { bidPrice: 2, askPrice: 1 }, { bidPrice: 0 }, { askPrice: NaN },
    { bidPrice: '' }, { quoteTimestamp: undefined }, { quoteTimestamp: 'not-a-time' }, { quoteTimestamp: new Date(NOW + 60_000).toISOString() },
  ])('rejects malformed/crossed/untimed/future quotes: %j', extra => { expect(parseTiingoQuote(top(extra))).toBeNull(); });
  it('does not freshen an old observation just because a TOP response was received now', () => {
    const quote = parseTiingoQuote(top({ quoteTimestamp: new Date(NOW - 180_000).toISOString() }))!;
    expect(quoteQuality(quote)).toBe('stale'); expect(isExecutableQuote(quote)).toBe(false);
  });
  it('normalizes sorted/deduplicated OHLC without manufacturing volume or another instrument', () => {
    const bars = parseTiingoHistory([daily('2026-09-22T00:00:00Z'), daily(), daily(undefined, { close: '1.125' })], 'EURUSD');
    expect(bars.map(c => c.time)).toEqual([Date.parse('2026-09-21Z') / 1000, Date.parse('2026-09-22Z') / 1000]);
    expect(bars[0].close).toBe(1.125); expect(bars.every(c => c.volume === undefined)).toBe(true);
    expect(() => parseTiingoHistory([daily(undefined, { ticker: 'gbpusd' })], 'EURUSD')).toThrow('instrument mismatch');
    expect(() => parseTiingoHistory([daily(undefined, { high: '1.0' })], 'EURUSD')).toThrow('OHLC');
    expect(() => parseTiingoHistory([], 'EURUSD')).toThrow();
  });
});

describe('server-only Tiingo REST/cache/budget boundary', () => {
  it('batches eight symbols into one request, coalesces concurrent misses and keeps the key out of URLs/results/logs', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => fetchTiingoQuotes()));
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]; const parsed = new URL(url);
    expect(parsed.pathname).toBe('/tiingo/fx/top'); expect(parsed.searchParams.get('tickers')!.split(',')).toHaveLength(8);
    expect(new Headers(init.headers).get('Authorization')).toBe(`Token ${process.env.TIINGO_API_KEY}`);
    expect(url).not.toContain(process.env.TIINGO_API_KEY); expect(JSON.stringify(results)).not.toContain(process.env.TIINGO_API_KEY);
    expect(redact(JSON.stringify(Object.fromEntries(new Headers(init.headers).entries())))).not.toContain(process.env.TIINGO_API_KEY);
    vi.setSystemTime(NOW + 89_999); const cached = await fetchTiingoQuotes();
    expect(fetch).toHaveBeenCalledTimes(1); expect(cached[0].receivedAt).toBe(NOW);
    vi.setSystemTime(NOW + 90_001); await fetchTiingoQuotes(); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('isolates cached provider results after a server-side token rotation', async () => {
    await fetchTiingoQuotes(); vi.stubEnv('TIINGO_API_KEY', 'different-fixture-token');
    await fetchTiingoQuotes(); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('requests daily OHLC for W and returns Monday buckets with the original cached fetch time', async () => {
    fetch.mockImplementation(async () => json([daily('2026-09-14T00:00:00Z'), daily('2026-09-18T00:00:00Z', { high: '1.16', close: '1.14' }), daily(), daily('2026-09-22T00:00:00Z')]));
    const result = await fetchTiingoHistory('EURUSD', 'W');
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get('resampleFreq')).toBe('1day');
    expect(new Date(`${new URL(fetch.mock.calls[0][0]).searchParams.get('startDate')}T00:00:00Z`).getUTCDay()).toBe(1);
    expect(result).toMatchObject({ source: 'tiingo', timeframe: 'W', fetchedAt: NOW, providerSymbol: 'eurusd', instrumentKind: 'spot' });
    expect(result!.data).toHaveLength(2); expect(result!.data[0]).toMatchObject({ high: 1.16, close: 1.14, provisional: false });
    expect(result!.data[1].provisional).toBe(true); expect(result!.data.every(c => c.volume === undefined && new Date(c.time * 1000).getUTCDay() === 1)).toBe(true);
    vi.setSystemTime(NOW + 120_000); expect((await fetchTiingoHistory('EURUSD', 'W'))!.fetchedAt).toBe(NOW); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([['1m', '1min'], ['5m', '5min'], ['15m', '15min'], ['1H', '1hour'], ['4H', '4hour'], ['D', '1day']] as const)('maps %s to the documented %s resampling frequency', async (timeframe, interval) => {
    fetch.mockImplementation(async () => json([daily()]));
    await fetchTiingoHistory('EURUSD', timeframe);
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get('resampleFreq')).toBe(interval);
  });
  it('honors Retry-After across quote and history requests without sending a second paid request', async () => {
    fetch.mockImplementation(async () => new Response('Rate limited', { status: 429, headers: { 'Retry-After': '300' } }));
    await expect(fetchTiingoQuotes()).rejects.toThrow('429');
    await expect(fetchTiingoHistory('EURUSD', 'W')).rejects.toThrow('cooling down');
    expect(fetch).toHaveBeenCalledTimes(1); expect(tiingoStatus()).toMatchObject({ retryAt: NOW + 300_000, lastFailure: 'http:429' });
    vi.setSystemTime(NOW + 300_001); fetch.mockImplementation(async () => json([top()])); await fetchTiingoQuotes();
    expect(fetch).toHaveBeenCalledTimes(2); expect(tiingoStatus().lastFailure).toBeNull();
  });
  it.each([{ payload: {} }, { payload: [] }, { payload: [{ ticker: 'eurusd', midPrice: 1.1 }] }])('negative-caches invalid payloads, not just network failures: %j', async ({ payload }) => {
    fetch.mockImplementation(async () => json(payload));
    await expect(fetchTiingoQuotes()).rejects.toThrow(); await expect(fetchTiingoQuotes()).rejects.toThrow('cooling down');
    expect(fetch).toHaveBeenCalledTimes(1); expect(tiingoStatus().lastFailure).toBe('payload');
  });
  it('fails closed before contacting Tiingo when shared paid budgets are missing on Vercel', async () => {
    vi.stubEnv('VERCEL', '1'); vi.stubEnv('NODE_ENV', 'production');
    await expect(fetchTiingoQuotes()).rejects.toThrow('budgets are not configured');
    await expect(fetchTiingoQuotes()).rejects.toThrow('cooling down');
    expect(fetch).not.toHaveBeenCalled(); expect(tiingoStatus().lastFailure).toBe('budget');
  });
  it('does not contact Tiingo in offline/keyless mode and bounds poll configuration', async () => {
    vi.stubEnv('TIINGO_API_KEY', ''); expect(await fetchTiingoQuotes()).toEqual([]);
    expect(await fetchTiingoHistory('EURUSD', 'W')).toBeNull(); expect(fetch).not.toHaveBeenCalled();
    expect(getTiingoHistoryCacheMs()).toBe(600_000); vi.stubEnv('TIINGO_HISTORY_CACHE_MS', '1'); expect(getTiingoHistoryCacheMs()).toBe(60_000);
    expect(getTiingoPollMs()).toBe(90_000); vi.stubEnv('TIINGO_POLL_MS', '1'); expect(getTiingoPollMs()).toBe(10_000);
    vi.stubEnv('TIINGO_POLL_MS', '999999999'); expect(getTiingoPollMs()).toBe(120_000);
    expect(tiingoRetryDelay(new Date(NOW + 300_000).toUTCString())).toBe(300_000);
  });
});
