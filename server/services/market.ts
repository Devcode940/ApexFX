import { fetchTiingoQuotes, tiingoConfigured } from './tiingo';
import { fetchJsonWithTimeout, UpstreamError } from '../lib/fetch';
import { log, warn } from '../lib/logger';
import { reserveMarketBudget, BudgetError } from '../lib/paidBudget';
import { priceCache } from '../lib/cache';
import { singleFlight, cachedLoad } from '../lib/singleFlight';
import { INSTRUMENTS, EMPTY_QUOTE_METADATA, isExecutableQuote, parseQuote, providerTimestamp, shouldAcceptQuote, sourceOf, type MarketQuote, type FeedSource } from '../../shared/market';

export const PAIRS_CONFIG_WS = INSTRUMENTS;
export const TD_SYMBOLS: Record<string, string> = Object.fromEntries(Object.keys(INSTRUMENTS).map(s => [s, `${s.slice(0, 3)}/${s.slice(3)}`]));
export const YAHOO_SYMBOLS: Record<string, string> = {
  EURUSD: 'EURUSD=X', GBPUSD: 'GBPUSD=X', USDJPY: 'USDJPY=X', AUDUSD: 'AUDUSD=X',
  USDCAD: 'USDCAD=X', GBPJPY: 'GBPJPY=X', XAUUSD: 'XAUUSD=X', XAGUSD: 'SI=F',
};
export const yahooTickerFor = (symbol: string): string => YAHOO_SYMBOLS[symbol] || `${symbol}=X`;
export const yahooKindFor = (symbol: string) => yahooTickerFor(symbol).endsWith('=F') ? 'futures' as const : 'spot' as const;
export type WatchlistItem = MarketQuote & { name: string };
export function createInitialWatchlist(): WatchlistItem[] {
  return Object.entries(INSTRUMENTS).map(([symbol, config]) => ({ symbol, name: config.name, price: 0, change: 0, high: 0, low: 0, ...EMPTY_QUOTE_METADATA }));
}
export const serverWatchlist = createInitialWatchlist();
let tdRESTCooldownUntil = 0;
let yahooConsecutiveFailures = 0;
export const getYahooFailureStreak = () => yahooConsecutiveFailures;
export const isTdRestCoolingDown = () => Date.now() < tdRESTCooldownUntil;
export const getTdRestCooldownUntil = () => tdRESTCooldownUntil;
export function setTdRestCooldown(ms = 60_000) { tdRESTCooldownUntil = Date.now() + ms; }
export function applyMarketQuote(item: WatchlistItem, raw: unknown): boolean {
  const quote = parseQuote(item.symbol, raw);
  if (!quote || !shouldAcceptQuote(item, quote)) return false;
  Object.assign(item, quote);
  return true;
}
const num = (value: unknown) => typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;

export function fetchTwelveDataQuotes(items = serverWatchlist): Promise<Set<string>> {
  const symbols = items.map(item => TD_SYMBOLS[item.symbol]).join(',');
  return singleFlight(`provider:twelvedata:watchlist:${symbols}`, async () => {
    const applied = new Set<string>();
    const apiKey = process.env.TWELVEDATA_API_KEY;
    if (!items.length || !apiKey || isTdRestCoolingDown()) return applied;
    try {
      const { raw, receivedAt } = await cachedLoad(priceCache, `td:quotes:payload:${symbols}`, getPollMs(), async () => {
        const lease = await reserveMarketBudget('twelvedata', items.length);
        let complete = false;
        try {
          const raw = await fetchJsonWithTimeout(`https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbols)}&timezone=UTC&apikey=${apiKey}`);
          complete = true;
          if (raw?.code || raw?.status === 'error') {
            if (Number(raw.code) === 429) setTdRestCooldown();
            throw new Error('Twelve Data declined the quote request');
          }
          return { raw, receivedAt: Date.now() };
        } finally { if (complete) await lease.release(); } // unknown in-flight work keeps its expiring lease
      });
      for (const item of items) {
        const providerSymbol = TD_SYMBOLS[item.symbol];
        const q = raw?.symbol === providerSymbol ? raw : raw?.[providerSymbol];
        if (!q || (typeof q.symbol === 'string' && q.symbol.replace('/', '') !== item.symbol)) continue;
        const price = num(q.close);
        const asOf = providerTimestamp(q.timestamp) ?? providerTimestamp(q.datetime);
        const appliedNow = applyMarketQuote(item, { price, high: num(q.high), low: num(q.low), change: num(q.percent_change),
          provider: 'twelvedata', providerSymbol, instrumentKind: 'spot', asOf, receivedAt });
        if ((appliedNow || item.provider === 'twelvedata') && isExecutableQuote(item)) applied.add(item.symbol);
      }
    } catch (error) {
      if (error instanceof BudgetError || (error instanceof UpstreamError && error.status === 429)) setTdRestCooldown();
      warn('[TwelveData] Quote request unavailable; eligible symbols use Yahoo fallback:', error);
    }
    return applied;
  });
}
export interface YahooPriceSyncResult { attempted: number; applied: number; failed: number }
export async function fetchYahooPricesFor(items: WatchlistItem[]): Promise<YahooPriceSyncResult> {
  const results = await Promise.all(items.map(item => singleFlight(`provider:yahoo:quote:${item.symbol}`, async () => {
    try {
      const ticker = yahooTickerFor(item.symbol);
      const data = await fetchJsonWithTimeout(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&range=1d`, { timeoutMs: 6000 });
      const result = data?.chart?.result?.[0];
      if (data?.chart?.error || !result) throw new Error('Invalid Yahoo quote response');
      const meta = result.meta ?? {};
      const price = num(meta.regularMarketPrice);
      const asOf = providerTimestamp(meta.regularMarketTime);
      // A minute-bar close is history, not a independently timed quote. Never borrow its
      // timestamp to make missing regularMarketTime look executable.
      if (!Number.isFinite(price) || price <= 0) throw new Error('Yahoo returned no usable positive quote');
      const previousClose = num(meta.chartPreviousClose ?? meta.previousClose);
      const changed = applyMarketQuote(item, { price, high: num(meta.regularMarketDayHigh ?? meta.dayHigh ?? meta.high),
        low: num(meta.regularMarketDayLow ?? meta.dayLow ?? meta.low),
        change: previousClose > 0 ? (price - previousClose) / previousClose * 100 : 0,
        provider: 'yahoo', providerSymbol: ticker, instrumentKind: yahooKindFor(item.symbol), asOf, receivedAt: Date.now() });
      return { applied: Number(changed), failed: 0 };
    } catch { return { applied: 0, failed: 1 }; }
  })));
  const failed = results.reduce((sum, r) => sum + r.failed, 0);
  if (items.length) {
    if (failed) {
      yahooConsecutiveFailures++;
      if (yahooConsecutiveFailures === 1 || yahooConsecutiveFailures % 12 === 0) warn(`[Yahoo] ${failed}/${items.length} HTTP, network, or payload failures; cycle ${yahooConsecutiveFailures}`);
    } else {
      if (yahooConsecutiveFailures) log('[Yahoo] Quote requests recovered. Freshness is evaluated independently.');
      yahooConsecutiveFailures = 0;
    }
  }
  return { attempted: items.length, applied: results.reduce((sum, r) => sum + r.applied, 0), failed };
}
export interface FeedSyncSummary extends YahooPriceSyncResult { source: FeedSource }
/** The SAME provider/fallback policy is used by persistent Node and request-driven Vercel. */
export const allowMarketFallbacks = () => process.env.MARKET_ALLOW_FALLBACKS !== 'false';
export function fetchRealLatestPrices(): Promise<FeedSyncSummary> {
  return singleFlight('market:refresh', async () => {
    if (process.env.MARKET_DATA_MODE === 'offline') return { source: marketSource(), attempted: 0, applied: 0, failed: 0 };
    let tiingoApplied = 0;
    if (tiingoConfigured()) {
      try {
        const quotes = await fetchTiingoQuotes();
        for (const quote of quotes) {
          const item = serverWatchlist.find(item => item.symbol === quote.symbol);
          if (item && applyMarketQuote(item, quote)) tiingoApplied++;
        }
      } catch { /* existing timestamps age naturally; only uncovered/stale symbols may fall back */ }
    }
    const missing = serverWatchlist.filter(item => !(item.provider === 'tiingo' && isExecutableQuote(item)));
    if (!allowMarketFallbacks()) return { source: marketSource(), attempted: serverWatchlist.length, applied: tiingoApplied, failed: missing.length };
    const td = process.env.TWELVEDATA_API_KEY ? await fetchTwelveDataQuotes(missing) : new Set<string>();
    const remaining = missing.filter(item => !td.has(item.symbol) && !(item.provider === 'twelvedata' && isExecutableQuote(item)));
    const yahoo = await fetchYahooPricesFor(remaining);
    return { source: marketSource(), attempted: serverWatchlist.length, applied: tiingoApplied + td.size + yahoo.applied, failed: yahoo.failed };
  });
}
export const marketSource = (): FeedSource => sourceOf(serverWatchlist);
export const marketRates = () => Object.fromEntries(serverWatchlist.map(item => [item.symbol, { ...item }]));
function interval(name: string, fallback: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number(process.env[name]) || fallback));
}
export const getQuoteSyncMs = () => interval('TWELVEDATA_QUOTE_SYNC_MS', 900_000, 10_000, 3_600_000);
export const getPollMs = () => interval('TWELVEDATA_POLL_MS', 15_000, 5000, 120_000);
