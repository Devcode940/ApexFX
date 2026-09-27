import { fetchTiingoHistory, tiingoConfigured, tiingoCacheScope } from './tiingo';
import { cleanBars as clean, weeklyBars } from './bars';
import type { MarketHistoryResponse } from '../../shared/history';
import { isTimeframe, type Timeframe } from '../../shared/timeframes';
import { fetchJsonWithTimeout, UpstreamError } from '../lib/fetch';
import { warn } from '../lib/logger';
import { TD_SYMBOLS, yahooTickerFor, yahooKindFor, isTdRestCoolingDown, setTdRestCooldown, allowMarketFallbacks } from './market';
import { historyCache } from '../lib/cache';
import { cachedLoad } from '../lib/singleFlight';
import { reserveMarketBudget, type BudgetLease } from '../lib/paidBudget';
import { isSymbol, providerTimestamp } from '../../shared/market';

const TD_INTERVALS: Record<string, string> = { '1m': '1min', '5m': '5min', '15m': '15min', '1H': '1h', '4H': '4h', D: '1day', W: '1day' };

const suppliedVolume = (value: unknown): number | undefined => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : undefined;

export function aggregateCandlesByEpoch(
  candles: Array<{ time: number; open: number; high: number; low: number; close: number; volume?: number }>,
  bucketSeconds: number
): Array<{ time: number; open: number; high: number; low: number; close: number; volume?: number }> {
  if (!Number.isFinite(bucketSeconds) || bucketSeconds <= 0) throw new RangeError('Invalid candle bucket');
  const buckets = new Map<number, typeof candles>();
  for (const c of candles) {
    const key = Math.floor(c.time / bucketSeconds) * bucketSeconds;
    const arr = buckets.get(key);
    if (arr) arr.push(c);
    else buckets.set(key, [c]);
  }
  const out: Array<{ time: number; open: number; high: number; low: number; close: number; volume?: number }> = [];
  for (const [time, chunk] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    if (chunk.length === 0) continue;
    chunk.sort((a, b) => a.time - b.time);
    out.push({
      time,
      open: chunk[0].open,
      high: Math.max(...chunk.map((c) => c.high)),
      low: Math.min(...chunk.map((c) => c.low)),
      close: chunk[chunk.length - 1].close,
      volume: chunk.every(c => c.volume !== undefined) ? chunk.reduce((sum, c) => sum + c.volume!, 0) : undefined,
    });
  }
  return out;
}

export async function fetchTwelveDataHistory(symbol: string, timeframe: Timeframe): Promise<MarketHistoryResponse | null> {
  const key = process.env.TWELVEDATA_API_KEY;
  if (!key || isTdRestCoolingDown() || !TD_INTERVALS[timeframe] || !TD_SYMBOLS[symbol]) return null;
  let lease: BudgetLease | undefined;
  try {
    lease = await reserveMarketBudget('twelvedata');
    const raw = await fetchJsonWithTimeout(`https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(TD_SYMBOLS[symbol])}&interval=${TD_INTERVALS[timeframe]}&outputsize=800&timezone=UTC&order=asc&apikey=${key}`);
    if (raw?.status === 'error' || raw?.code || !Array.isArray(raw?.values)) {
      if (Number(raw?.code) === 429) setTdRestCooldown();
      throw new Error('Twelve Data returned no historical values');
    }
    const candles = clean(raw.values.map((v: Record<string, unknown>) => ({
      time: (providerTimestamp(v.datetime) ?? 0) / 1000, open: Number(v.open), high: Number(v.high), low: Number(v.low), close: Number(v.close),
      volume: suppliedVolume(v.volume),
    })));
    if (!candles.length) return null;
    return { success: true, symbol, timeframe, fetchedAt: Date.now(), data: (timeframe === 'W' ? weeklyBars(candles) : candles).slice(-1000), source: 'twelvedata' as const, providerSymbol: TD_SYMBOLS[symbol], instrumentKind: 'spot' as const };
  } catch (error) {
    if (error instanceof UpstreamError && error.status === 429) setTdRestCooldown();
    warn('[TwelveData] Historical data unavailable; trying Yahoo:', error);
    return null;
  } finally { await lease?.release(); }
}
export async function fetchYahooHistory(symbol: string, timeframe: Timeframe): Promise<MarketHistoryResponse> {
  return cachedLoad<MarketHistoryResponse>(historyCache, `provider:yahoo:history:${symbol}:${timeframe}`, 60_000, async () => {
    const ticker = yahooTickerFor(symbol);
    const config: Record<string, [string, string]> = { '1m': ['1m', '2d'], '5m': ['5m', '5d'], '15m': ['15m', '10d'], '1H': ['1h', '60d'], '4H': ['1h', '120d'], D: ['1d', '365d'], W: ['1d', '5y'] };
    const [interval, range] = config[timeframe] ?? ['1h', '60d'];
    for (const host of ['query1', 'query2']) {
      try {
        const raw = await fetchJsonWithTimeout(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`, { timeoutMs: 7000 });
        const result = raw?.chart?.result?.[0];
        if (!result || raw.chart.error || !Array.isArray(result.timestamp)) continue;
        const q = result.indicators?.quote?.[0];
        if (!q) continue;
        let candles = clean(result.timestamp.map((time: unknown, i: number) => ({
          time: Number(time), open: Number(q.open?.[i]), high: Number(q.high?.[i]), low: Number(q.low?.[i]), close: Number(q.close?.[i]), volume: suppliedVolume(q.volume?.[i]),
        })));
        if (timeframe === '4H') candles = aggregateCandlesByEpoch(candles, 14400);
        if (!candles.length) continue;
        return { success: true, symbol, timeframe, fetchedAt: Date.now(), data: (timeframe === 'W' ? weeklyBars(candles) : candles).slice(-1000), source: 'yahoo' as const, providerSymbol: ticker, instrumentKind: yahooKindFor(symbol) };
      } catch { /* bounded fallback to the second Yahoo host */ }
    }
    throw new Error('No valid historical provider data');
  });
}
export function fetchMarketHistory(symbol: string, timeframe: string) {
  if (!isSymbol(symbol) || !isTimeframe(timeframe)) return Promise.reject(new Error('Unsupported instrument/timeframe'));
  return cachedLoad<MarketHistoryResponse>(historyCache, `history:${tiingoCacheScope()}:${allowMarketFallbacks()}:${symbol}:${timeframe}`, 60_000, async () => {
    if (process.env.MARKET_DATA_MODE === 'offline') throw new Error('Market data is disabled');
    if (tiingoConfigured()) {
      try { const primary = await fetchTiingoHistory(symbol, timeframe); if (primary) return primary; }
      catch { /* explicit fallback below; never call fallback data Tiingo */ }
    }
    if (!allowMarketFallbacks()) throw new Error('Tiingo history unavailable and fallbacks are disabled');
    const secondary = await fetchTwelveDataHistory(symbol, timeframe);
    return secondary ?? await fetchYahooHistory(symbol, timeframe);
  });
}
