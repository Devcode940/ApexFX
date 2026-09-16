import { fetchWithTimeout } from '../lib/fetch';
import { error, warn } from '../lib/logger';
import { fetchTiingoQuotes } from './tiingo';

export const PAIRS_CONFIG_WS: Record<string, { name: string; pipDecimal: number }> = {
  'EURUSD': { name: 'EUR / USD', pipDecimal: 4 },
  'GBPUSD': { name: 'GBP / USD', pipDecimal: 4 },
  'USDJPY': { name: 'USD / JPY', pipDecimal: 2 },
  'AUDUSD': { name: 'AUD / USD', pipDecimal: 4 },
  'USDCAD': { name: 'USD / CAD', pipDecimal: 4 },
  'GBPJPY': { name: 'GBP / JPY', pipDecimal: 2 },
  'EURGBP': { name: 'EUR / GBP', pipDecimal: 4 },
  'USDCHF': { name: 'USD / CHF', pipDecimal: 4 },
  'NZDUSD': { name: 'NZD / USD', pipDecimal: 4 },
  'EURJPY': { name: 'EUR / JPY', pipDecimal: 2 },
  'XAUUSD': { name: 'Gold / USD', pipDecimal: 2 },
  'XAGUSD': { name: 'Silver / USD', pipDecimal: 4 },
  'BTCUSD': { name: 'Bitcoin / USD', pipDecimal: 1 },
  'ETHUSD': { name: 'Ethereum / USD', pipDecimal: 2 },
};

export const TD_SYMBOLS: Record<string, string> = {
  'EURUSD': 'EUR/USD',
  'GBPUSD': 'GBP/USD',
  'USDJPY': 'USD/JPY',
  'AUDUSD': 'AUD/USD',
  'USDCAD': 'USD/CAD',
  'GBPJPY': 'GBP/JPY',
  'EURGBP': 'EUR/GBP',
  'USDCHF': 'USD/CHF',
  'NZDUSD': 'NZD/USD',
  'EURJPY': 'EUR/JPY',
  'XAUUSD': 'XAU/USD',
  'XAGUSD': 'XAG/USD',
  'BTCUSD': 'BTC/USD',
  'ETHUSD': 'ETH/USD',
};

export type WatchlistItem = {
  symbol: string;
  name: string;
  price: number;
  change: number;
  high: number;
  low: number;
};

const BASELINE_PRICES: Record<string, { price: number; high: number; low: number; change: number }> = {
  'EURUSD': { price: 1.0850, high: 1.0872, low: 1.0838, change: 0.12 },
  'GBPUSD': { price: 1.2850, high: 1.2885, low: 1.2820, change: -0.18 },
  'USDJPY': { price: 154.50, high: 154.95, low: 154.10, change: 0.25 },
  'AUDUSD': { price: 0.6550, high: 0.6578, low: 0.6530, change: 0.05 },
  'USDCAD': { price: 1.3650, high: 1.3680, low: 1.3625, change: -0.08 },
  'GBPJPY': { price: 198.50, high: 199.10, low: 197.80, change: 0.32 },
  'EURGBP': { price: 0.8540, high: 0.8565, low: 0.8520, change: 0.08 },
  'USDCHF': { price: 0.8920, high: 0.8945, low: 0.8895, change: -0.14 },
  'NZDUSD': { price: 0.6120, high: 0.6150, low: 0.6095, change: 0.15 },
  'EURJPY': { price: 167.60, high: 168.10, low: 167.15, change: 0.28 },
  'XAUUSD': { price: 2650.00, high: 2662.50, low: 2641.00, change: 0.45 },
  'XAGUSD': { price: 31.50, high: 31.85, low: 31.20, change: 0.60 },
  'BTCUSD': { price: 64250.0, high: 65100.0, low: 63800.0, change: 1.85 },
  'ETHUSD': { price: 2640.0, high: 2685.0, low: 2610.0, change: 1.40 },
};

export function createInitialWatchlist(): WatchlistItem[] {
  return Object.keys(PAIRS_CONFIG_WS).map((symbol) => {
    const config = PAIRS_CONFIG_WS[symbol];
    const base = BASELINE_PRICES[symbol] || { price: 1.0, high: 1.01, low: 0.99, change: 0 };
    return {
      symbol,
      name: config.name,
      price: base.price,
      change: base.change,
      high: base.high,
      low: base.low,
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

const YAHOO_TICKERS: Record<string, string> = {
  'EURUSD': 'EURUSD=X',
  'GBPUSD': 'GBPUSD=X',
  'USDJPY': 'USDJPY=X',
  'AUDUSD': 'AUDUSD=X',
  'USDCAD': 'USDCAD=X',
  'GBPJPY': 'GBPJPY=X',
  'XAUUSD': 'XAUUSD=X',
  'XAGUSD': 'SI=F',
};

let lastYahooWarnTime = 0;
function warnYahooFailure(msg: string, err: any) {
  const now = Date.now();
  if (now - lastYahooWarnTime > 60_000) {
    warn(msg, err);
    lastYahooWarnTime = now;
  }
}

async function fetchYahooBatch(symbols: string[]): Promise<Record<string, any> | null> {
  const tickers = symbols.map((s) => YAHOO_TICKERS[s] || `${s}=X`).join(',');
  const urls = [
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(tickers)}&fields=regularMarketPrice,regularMarketDayHigh,regularMarketDayLow,regularMarketPreviousClose`,
    `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(tickers)}&fields=regularMarketPrice,regularMarketDayHigh,regularMarketDayLow,regularMarketPreviousClose`,
  ];
  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url, { timeoutMs: 7000 });
      if (!res.ok) continue;
      const data = (await res.json()) as any;
      const results = data?.quoteResponse?.result;
      if (Array.isArray(results) && results.length > 0) {
        const bySymbol: Record<string, any> = {};
        for (const r of results) {
          if (r?.symbol) bySymbol[r.symbol.toUpperCase()] = r;
        }
        return bySymbol;
      }
    } catch (e) {
      warnYahooFailure('[Yahoo] batch quote fetch failed:', (e as Error).message);
    }
  }
  return null;
}

async function fetchYahooChartFallback(item: typeof serverWatchlist[number]) {
  try {
    const ticker = YAHOO_TICKERS[item.symbol] || `${item.symbol}=X`;
    const res = await fetchWithTimeout(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1m&range=1d`,
      { timeoutMs: 6000 }
    );
    if (!res.ok) return;
    const data = (await res.json()) as any;
    const result = data?.chart?.result?.[0];
    const meta = result?.meta;
    const currentPrice = meta?.regularMarketPrice || result?.indicators?.quote?.[0]?.close?.filter((c: any) => c !== null).pop();
    if (currentPrice) applyYahooQuote(item, currentPrice, meta?.regularMarketDayHigh, meta?.regularMarketDayLow, meta?.chartPreviousClose || meta?.previousClose);
  } catch (e) {
    // Yahoo may fail on cloud hosts
  }
}

function applyYahooQuote(
  item: typeof serverWatchlist[number],
  price: number,
  dayHigh?: number,
  dayLow?: number,
  prevClose?: number
) {
  const config = PAIRS_CONFIG_WS[item.symbol];
  item.price = parseFloat(price.toFixed(config.pipDecimal + 1));
  const h = dayHigh ?? Math.max(item.high || 0, price);
  const l = dayLow ?? (item.low > 0 ? Math.min(item.low, price) : price);
  item.high = parseFloat(h.toFixed(config.pipDecimal + 1));
  item.low = parseFloat(l.toFixed(config.pipDecimal + 1));
  const pc = prevClose && prevClose > 0 ? prevClose : price;
  item.change = parseFloat((((price - pc) / pc) * 100).toFixed(2));
}

export async function fetchYahooPricesFor(items: typeof serverWatchlist) {
  if (items.length === 0) return;
  const batch = await fetchYahooBatch(items.map((i) => i.symbol));
  if (batch) {
    for (const item of items) {
      const ticker = (YAHOO_TICKERS[item.symbol] || `${item.symbol}=X`).toUpperCase();
      const r = batch[ticker];
      if (r?.regularMarketPrice) {
        applyYahooQuote(item, r.regularMarketPrice, r.regularMarketDayHigh, r.regularMarketDayLow, r.regularMarketPreviousClose);
      } else {
        await fetchYahooChartFallback(item);
      }
    }
    return;
  }
  await Promise.all(items.map((item) => fetchYahooChartFallback(item)));
}

export async function fetchRealLatestPrices() {
  const applied = new Set<string>();

  // 1. Try Tiingo REST quotes (if configured)
  if (process.env.TIINGO_API_KEY) {
    try {
      const tiingoApplied = await fetchTiingoQuotes();
      tiingoApplied.forEach((s) => applied.add(s));
    } catch {
      // ignore
    }
  }

  // 2. Try Twelve Data REST quotes (if configured)
  const tdApiKey = getTdApiKey();
  if (tdApiKey && !isTdRestCoolingDown()) {
    try {
      const tdApplied = await fetchTwelveDataQuotes();
      tdApplied.forEach((s) => applied.add(s));
    } catch {
      // ignore
    }
  }

  // 3. For any remaining symbols, try Yahoo
  const remaining = serverWatchlist.filter((i) => !applied.has(i.symbol));
  if (remaining.length > 0) {
    try {
      await fetchYahooPricesFor(remaining);
    } catch {
      // ignore
    }
  }
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
