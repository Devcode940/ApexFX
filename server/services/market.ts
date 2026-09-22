import { fetchWithTimeout } from '../lib/fetch';
import { log, warn, error } from '../lib/logger';

export const PAIRS_CONFIG_WS: Record<string, { name: string; pipDecimal: number }> = {
  'EURUSD': { name: 'EUR / USD', pipDecimal: 4 },
  'GBPUSD': { name: 'GBP / USD', pipDecimal: 4 },
  'USDJPY': { name: 'USD / JPY', pipDecimal: 2 },
  'AUDUSD': { name: 'AUD / USD', pipDecimal: 4 },
  'USDCAD': { name: 'USD / CAD', pipDecimal: 4 },
  'GBPJPY': { name: 'GBP / JPY', pipDecimal: 2 },
  'XAUUSD': { name: 'Gold / USD', pipDecimal: 2 },
  'XAGUSD': { name: 'Silver / USD', pipDecimal: 4 },
};

export const TD_SYMBOLS: Record<string, string> = {
  'EURUSD': 'EUR/USD',
  'GBPUSD': 'GBP/USD',
  'USDJPY': 'USD/JPY',
  'AUDUSD': 'AUD/USD',
  'USDCAD': 'USD/CAD',
  'GBPJPY': 'GBP/JPY',
  'XAUUSD': 'XAU/USD',
  'XAGUSD': 'XAG/USD',
};

export type WatchlistItem = {
  symbol: string;
  name: string;
  price: number;
  change: number;
  high: number;
  low: number;
};

export function createInitialWatchlist(): WatchlistItem[] {
  return Object.keys(PAIRS_CONFIG_WS).map((symbol) => {
    const config = PAIRS_CONFIG_WS[symbol];
    return {
      symbol,
      name: config.name,
      price: 0,
      change: 0,
      high: 0,
      low: 0,
    };
  });
}

export const serverWatchlist: WatchlistItem[] = createInitialWatchlist();

let tdRESTCooldownUntil = 0;

function getTdApiKey(): string | undefined {
  return process.env.TWELVEDATA_API_KEY;
}

export async function fetchTwelveDataQuotes(): Promise<Set<string>> {
  const applied = new Set<string>();
  const tdApiKey = getTdApiKey();
  if (!tdApiKey) return applied;
  try {
    const symbols = Object.values(TD_SYMBOLS).join(',');
    const res = await fetchWithTimeout(
      `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbols)}&apikey=${tdApiKey}`,
      { timeoutMs: 8000 }
    );
    const raw = await res.json();
    if ((raw as any)?.code) {
      error('[TwelveData] quote error:', (raw as any)?.message || `code ${(raw as any)?.code}`);
      if ((raw as any).code === 429) tdRESTCooldownUntil = Date.now() + 60_000;
      return applied;
    }
    const data: Record<string, any> = {};
    if ((raw as any)?.symbol && typeof (raw as any).close !== 'undefined') {
      data[(raw as any).symbol] = raw;
    } else {
      for (const s of Object.values(TD_SYMBOLS)) {
        if ((raw as any)?.[s] && typeof (raw as any)[s] === 'object' && typeof (raw as any)[s].close !== 'undefined')
          data[s] = (raw as any)[s];
      }
    }
    if (Object.keys(data).length === 0) return applied;

    for (const item of serverWatchlist) {
      const tdSymbol = TD_SYMBOLS[item.symbol];
      const q = tdSymbol ? data[tdSymbol] : null;
      if (!q) continue;
      const close = parseFloat(q.close);
      if (!isFinite(close) || close <= 0) continue;
      const high = parseFloat(q.high);
      const low = parseFloat(q.low);
      const pct = parseFloat(q.percent_change);
      const config = PAIRS_CONFIG_WS[item.symbol];
      item.price = parseFloat(close.toFixed(config.pipDecimal + 1));
      if (isFinite(high) && high > 0) item.high = parseFloat(high.toFixed(config.pipDecimal + 1));
      else item.high = Math.max(item.high, item.price);
      if (isFinite(low) && low > 0) item.low = parseFloat(low.toFixed(config.pipDecimal + 1));
      else item.low = item.low > 0 ? Math.min(item.low, item.price) : item.price;
      if (isFinite(pct)) item.change = parseFloat(pct.toFixed(2));
      applied.add(item.symbol);
    }
  } catch (e) {
    error('[TwelveData] quote fetch failed:', (e as Error).message);
  }
  return applied;
}

/**
 * Single source of truth for Yahoo Finance tickers, shared by the quote path AND the history
 * path. Previously yahoo.ts kept its own copy that mapped XAGUSD to 'XAGUSD=X' while this one
 * used 'SI=F' — the divergence meant silver *prices* came from COMEX futures while silver *candles*
 * came from a spot symbol Yahoo does not publish (the README itself says so), so the chart and the
 * paper-trade entry price were derived from two different instruments.
 */
export const YAHOO_SYMBOLS: Record<string, string> = {
  'EURUSD': 'EURUSD=X',
  'GBPUSD': 'GBPUSD=X',
  'USDJPY': 'USDJPY=X',
  'AUDUSD': 'AUDUSD=X',
  'USDCAD': 'USDCAD=X',
  'GBPJPY': 'GBPJPY=X',
  'XAUUSD': 'XAUUSD=X',
  'XAGUSD': 'SI=F',
};

export function yahooTickerFor(symbol: string): string {
  return YAHOO_SYMBOLS[symbol] || `${symbol}=X`;
}

/** Consecutive upstream failure cycles, used to throttle logs and back the caller off. */
let yahooConsecutiveFailures = 0;
let yahooFailureLogCount = 0;
export function getYahooFailureStreak(): number { return yahooConsecutiveFailures; }

export interface YahooPriceSyncResult {
  attempted: number;
  applied: number;
  failed: number;
}

export async function fetchYahooPricesFor(items: typeof serverWatchlist): Promise<YahooPriceSyncResult> {

  let failures = 0;
  let applied = 0;
  await Promise.all(
    items.map(async (item) => {
      try {
        const ticker = yahooTickerFor(item.symbol);
        const res = await fetchWithTimeout(
          `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1m&range=1d`,
          { timeoutMs: 6000 }
        );
        if (res.ok) {
          const data = (await res.json()) as any;
          const result = data?.chart?.result?.[0];
          const meta = result?.meta;
          const currentPrice =
            meta?.regularMarketPrice || result?.indicators?.quote?.[0]?.close?.filter((c: any) => c !== null).pop();
          if (currentPrice) {
            const config = PAIRS_CONFIG_WS[item.symbol];
            item.price = parseFloat(currentPrice.toFixed(config.pipDecimal + 1));
            item.high = parseFloat(
              (meta?.high || Math.max(item.high, currentPrice)).toFixed(config.pipDecimal + 1)
            );
            item.low = parseFloat(
              (meta?.low || (item.low > 0 ? Math.min(item.low, currentPrice) : currentPrice)).toFixed(
                config.pipDecimal + 1
              )
            );
            const prevClose = meta?.chartPreviousClose || currentPrice;
            item.change = parseFloat((((currentPrice - prevClose) / prevClose) * 100).toFixed(2));
            applied += 1;
          }
        }
      } catch (e) {
        failures += 1;
        // A dead upstream used to emit one full stack trace per symbol per tick (8 lines every
        // 5s => ~28k lines during a 30-minute outage). Report the first failure of a streak,
        // then sample so the operator sees it is still broken without drowning in it.
        yahooFailureLogCount += 1;
        if (yahooFailureLogCount === 1) {
          error(`[Yahoo] price feed down; first failure (${item.symbol}):`, e);
        } else if (yahooFailureLogCount % 12 === 0) {
          warn(`[Yahoo] price feed still failing (${yahooFailureLogCount} consecutive symbol errors, streak #${yahooConsecutiveFailures + 1})`);
        }
      }
    })
  );

  if (failures === 0) {
    if (yahooConsecutiveFailures > 0) log(`[Yahoo] price feed recovered after ${yahooConsecutiveFailures} failed cycle(s).`);
    yahooConsecutiveFailures = 0;
    yahooFailureLogCount = 0;
  } else {
    yahooConsecutiveFailures += 1;
  }

  return { attempted: items.length, applied: applied, failed: failures };
}

export interface FeedSyncSummary {
  source: 'twelvedata' | 'yahoo';
  attempted: number;
  applied: number;
  failed: number;
}

export async function fetchRealLatestPrices(): Promise<FeedSyncSummary> {
  const tdApiKey = getTdApiKey();
  if (tdApiKey) {
    const applied = await fetchTwelveDataQuotes();
    const remaining = serverWatchlist.filter((i) => !applied.has(i.symbol));
    let yahoo = { attempted: 0, applied: 0, failed: 0 };
    if (remaining.length > 0) {
      yahoo = await fetchYahooPricesFor(remaining);
    }
    return {
      source: 'twelvedata',
      attempted: serverWatchlist.length,
      applied: applied.size + yahoo.applied,
      failed: yahoo.failed,
    };
  }
  const yahoo = await fetchYahooPricesFor(serverWatchlist);
  return { source: 'yahoo', attempted: yahoo.attempted, applied: yahoo.applied, failed: yahoo.failed };
}

/** Which primary feed the server is using — the client needs this to label its HUD honestly. */
export function marketSource(): 'twelvedata' | 'yahoo' {
  return getTdApiKey() ? 'twelvedata' : 'yahoo';
}

export function getQuoteSyncMs() {
  const val = Number(process.env.TWELVEDATA_QUOTE_SYNC_MS) || 900_000;
  if (val < 10_000) return 10_000;
  if (val > 3_600_000) return 3_600_000;
  return val;
}

export function getPollMs() {
  const val = Number(process.env.TWELVEDATA_POLL_MS) || 15_000;
  if (val < 5_000) return 5_000;
  if (val > 120_000) return 120_000;
  return val;
}

export function isTdRestCoolingDown(): boolean {
  return Date.now() < tdRESTCooldownUntil;
}

export function setTdRestCooldown(ms = 60_000) {
  tdRESTCooldownUntil = Date.now() + ms;
}

export function getTdRestCooldownUntil() {
  return tdRESTCooldownUntil;
}
