import { WebSocket } from 'ws';
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
const TD_QUOTE_SYNC_MS = Number(process.env.TWELVEDATA_QUOTE_SYNC_MS) || 900_000;
const TD_POLL_MS = Number(process.env.TWELVEDATA_POLL_MS) || 15_000;

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
      `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbols)}`,
      {
        headers: {
          Authorization: `Bearer ${tdApiKey}`,
        },
        timeoutMs: 8000,
      }
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

export async function fetchYahooPricesFor(items: typeof serverWatchlist) {
  const symbolsMap: Record<string, string> = {
    'EURUSD': 'EURUSD=X',
    'GBPUSD': 'GBPUSD=X',
    'USDJPY': 'USDJPY=X',
    'AUDUSD': 'AUDUSD=X',
    'USDCAD': 'USDCAD=X',
    'GBPJPY': 'GBPJPY=X',
    'XAUUSD': 'XAUUSD=X',
    'XAGUSD': 'SI=F',
  };

  await Promise.all(
    items.map(async (item) => {
      try {
        const ticker = symbolsMap[item.symbol] || `${item.symbol}=X`;
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
          }
        }
      } catch (e) {
        error(`Failed to fetch real price for ${item.symbol}:`, e);
      }
    })
  );
}

export async function fetchRealLatestPrices() {
  const tdApiKey = getTdApiKey();
  if (tdApiKey) {
    const applied = await fetchTwelveDataQuotes();
    const remaining = serverWatchlist.filter((i) => !applied.has(i.symbol));
    if (remaining.length > 0) {
      await fetchYahooPricesFor(remaining);
    }
    return;
  }
  await fetchYahooPricesFor(serverWatchlist);
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
