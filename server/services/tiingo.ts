import crypto from 'node:crypto';
import type { MarketHistoryResponse } from '../../shared/history';
import { INSTRUMENTS, isSymbol, parseQuote, providerTimestamp, type MarketQuote } from '../../shared/market';
import { candleBucketStart, type Timeframe } from '../../shared/timeframes';
import { fetchWithTimeout, UpstreamError } from '../lib/fetch';
import { reserveMarketBudget, type BudgetLease } from '../lib/paidBudget';
import { priceCache, historyCache } from '../lib/cache';
import { cachedLoad } from '../lib/singleFlight';
import { cleanBars, usableBar, weeklyBars } from './bars';
import type { Candlestick } from '../../src/types';

export const TIINGO_SYMBOLS: Record<string, string> = Object.fromEntries(Object.keys(INSTRUMENTS).map(symbol => [symbol, symbol.toLowerCase()]));
const INTERVALS: Record<Timeframe, string> = { '1m': '1min', '5m': '5min', '15m': '15min', '1H': '1hour', '4H': '4hour', D: '1day', W: '1day' };
const LOOKBACK_DAYS: Record<Timeframe, number> = { '1m': 3, '5m': 10, '15m': 30, '1H': 120, '4H': 400, D: 1460, W: 7 * 260 };
const number = (v: unknown) => typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
const key = () => process.env.TIINGO_API_KEY?.trim() ?? '';
export const tiingoCacheScope = () => crypto.createHash('sha256').update(key()).digest('hex').slice(0, 16);
export function getTiingoPollMs(): number {
  const value = Number(process.env.TIINGO_POLL_MS);
  return Number.isFinite(value) && value > 0 ? Math.max(10_000, Math.min(120_000, value)) : 90_000;
}
export function getTiingoHistoryCacheMs(): number {
  const value = Number(process.env.TIINGO_HISTORY_CACHE_MS);
  return Number.isFinite(value) && value > 0 ? Math.max(60_000, Math.min(3_600_000, value)) : 600_000;
}
let blockedUntil = 0;
let lastScope = '';
let lastFailure: string | null = null;
function checkScope() { const next = tiingoCacheScope(); if (next !== lastScope) { blockedUntil = 0; lastFailure = null; lastScope = next; } }
export const tiingoConfigured = () => !!key();
export function tiingoStatus() { checkScope(); return { configured: tiingoConfigured(), retryAt: blockedUntil > Date.now() ? blockedUntil : null, lastFailure, pollMs: getTiingoPollMs() }; }
export function tiingoRetryDelay(value: string | null): number {
  if (!value) return 0;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, (Date.parse(value) || Date.now()) - Date.now());
}
async function request<T>(path: string, decode: (value: unknown) => T): Promise<T> {
  checkScope();
  if (!key()) throw new Error('Tiingo is not configured');
  if (Date.now() < blockedUntil) throw new Error('Tiingo is cooling down');
  let lease: BudgetLease;
  try { lease = await reserveMarketBudget('tiingo'); }
  catch (error) { blockedUntil = Date.now() + 60_000; lastFailure = 'budget'; throw error; }
  let completed = false;
  try {
    const response = await fetchWithTimeout(`https://api.tiingo.com/tiingo/fx/${path}`, {
      timeoutMs: 8000, maxBytes: 2 * 1024 * 1024, headers: { Authorization: `Token ${key()}`, Accept: 'application/json' },
    });
    completed = true;
    if (!response.ok) {
      const delay = Math.max(tiingoRetryDelay(response.headers.get('Retry-After')), [401, 403].includes(response.status) ? 300_000 : 60_000);
      blockedUntil = Date.now() + delay;
      throw new UpstreamError(`Tiingo HTTP ${response.status}`, 'http', response.status);
    }
    let raw: unknown;
    try { raw = await response.json(); }
    catch { throw new UpstreamError('Invalid Tiingo JSON', 'parse'); }
    const result = decode(raw); // invalid shapes enter the same negative cache as HTTP/JSON errors
    lastFailure = null;
    return result;
  } catch (error) {
    blockedUntil = Math.max(blockedUntil, Date.now() + 30_000);
    lastFailure = error instanceof UpstreamError ? `${error.kind}${error.status ? `:${error.status}` : ''}` : 'payload';
    throw error;
  } finally { if (completed) await lease.release(); } // retain a lease for unknown provider completion
}

/** FX /top is an actual timestamped bid/ask quote, NOT a history close. The simulator uses midpoint. */
export function parseTiingoQuote(value: unknown, receivedAt = Date.now()): MarketQuote | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const symbol = typeof row.ticker === 'string' ? row.ticker.toUpperCase() : '';
  if (!isSymbol(symbol)) return null;
  const bid = number(row.bidPrice), ask = number(row.askPrice);
  if (![bid, ask].every(n => Number.isFinite(n) && n > 0) || bid > ask) return null;
  const price = bid + (ask - bid) / 2;
  const asOf = providerTimestamp(row.quoteTimestamp);
  if (!asOf) return null;
  return parseQuote(symbol, { symbol, price, bid, ask, priceBasis: 'mid', dayStatsAvailable: false,
    provider: 'tiingo', providerSymbol: TIINGO_SYMBOLS[symbol], instrumentKind: 'spot', asOf, receivedAt });
}
export async function fetchTiingoQuotes(): Promise<MarketQuote[]> {
  if (!tiingoConfigured() || process.env.MARKET_DATA_MODE === 'offline') return [];
  const result = await cachedLoad<MarketQuote[]>(priceCache, `tiingo:top:${tiingoCacheScope()}`, getTiingoPollMs(), async () => {
    return request(`top?tickers=${Object.values(TIINGO_SYMBOLS).join(',')}`, raw => {
      if (!Array.isArray(raw) || !raw.length || raw.length > 500) throw new Error('Tiingo returned no valid quote array');
      const receivedAt = Date.now();
      const quotes = raw.map(row => parseTiingoQuote(row, receivedAt)).filter((q): q is MarketQuote => !!q);
      if (!quotes.length) throw new Error('Tiingo returned no usable timestamped quotes');
      return quotes;
    });
  });
  return result;
}
export function parseTiingoHistory(raw: unknown, symbol: string): Candlestick[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > 5000) throw new Error('Tiingo history is empty or oversized');
  const bars = raw.map(value => {
    if (!value || typeof value !== 'object') throw new Error('Invalid Tiingo history row');
    const row = value as Record<string, unknown>;
    if (row.ticker !== undefined && String(row.ticker).toUpperCase() !== symbol) throw new Error('Tiingo history instrument mismatch');
    const time = providerTimestamp(row.date);
    const bar = { time: time ? Math.floor(time / 1000) : 0, open: number(row.open), high: number(row.high), low: number(row.low), close: number(row.close) };
    if (!usableBar(bar)) throw new Error('Invalid Tiingo OHLC');
    return bar;
  });
  return cleanBars(bars); // no invented volume: the FX history contract does not supply it
}
export async function fetchTiingoHistory(symbol: string, timeframe: Timeframe): Promise<MarketHistoryResponse | null> {
  if (!tiingoConfigured() || !isSymbol(symbol) || process.env.MARKET_DATA_MODE === 'offline') return null;
  const now = Date.now();
  const start = timeframe === 'W' ? candleBucketStart(now / 1000, 'W') * 1000 - LOOKBACK_DAYS.W * 86400000 : now - LOOKBACK_DAYS[timeframe] * 86400000;
  const startDate = new Date(start).toISOString().slice(0, 10);
  const result = await cachedLoad<MarketHistoryResponse>(historyCache, `tiingo:history:${tiingoCacheScope()}:${symbol}:${timeframe}:${startDate}`, getTiingoHistoryCacheMs(), async () => {
    const dailyOrIntraday = await request(`${TIINGO_SYMBOLS[symbol]}/prices?startDate=${startDate}&resampleFreq=${INTERVALS[timeframe]}`, raw => parseTiingoHistory(raw, symbol));
    const data = timeframe === 'W' ? weeklyBars(dailyOrIntraday) : dailyOrIntraday;
    return { success: true, symbol, timeframe, fetchedAt: Date.now(), source: 'tiingo' as const, providerSymbol: TIINGO_SYMBOLS[symbol], instrumentKind: 'spot' as const,
      data: data.slice(-1000), ...(timeframe === 'W' ? { aggregation: 'available daily OHLC; Monday 00:00 UTC weeks' } : {}) };
  });
  return result;
}
