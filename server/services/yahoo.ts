import { fetchWithTimeout } from '../lib/fetch';
import { error, warn } from '../lib/logger';
import { TD_SYMBOLS } from './market';
import { historyCache } from '../lib/cache';

const TD_INTERVALS: Record<string, string> = {
  '1m': '1min',
  '5m': '5min',
  '15m': '15min',
  '1H': '1h',
  '4H': '4h',
  'D': '1day',
};

export async function fetchTwelveDataHistory(symbol: string, timeframe: string) {
  const tdApiKey = process.env.TWELVEDATA_API_KEY;
  if (!tdApiKey) return null;
  const tdInterval = TD_INTERVALS[timeframe];
  const tdSymbol = TD_SYMBOLS[symbol];
  if (!tdInterval || !tdSymbol) return null;
  try {
    const res = await fetchWithTimeout(
      `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(tdSymbol)}&interval=${tdInterval}&outputsize=800&timezone=UTC&order=asc&apikey=${tdApiKey}`,
      { timeoutMs: 8000 }
    );
    const raw = await res.json();
    if ((raw as any)?.status === 'error' || (raw as any)?.code || !Array.isArray((raw as any).values)) {
      warn('[TwelveData] time_series error:', (raw as any)?.message || (raw as any)?.code || 'no values');
      if ((raw as any)?.code === 429) {
        const { setTdRestCooldown } = await import('./market');
        setTdRestCooldown(60_000);
      }
      return null;
    }
    const candles = (raw as any).values
      .map((v: any) => {
        const time = Date.parse(`${String(v.datetime).replace(' ', 'T')}Z`) / 1000;
        const open = parseFloat(v.open);
        const high = parseFloat(v.high);
        const low = parseFloat(v.low);
        const close = parseFloat(v.close);
        if (!isFinite(time) || !isFinite(open) || !isFinite(high) || !isFinite(low) || !isFinite(close) || open <= 0)
          return null;
        return { time, open, high, low, close, volume: Math.floor(parseFloat(v.volume) || 0) };
      })
      .filter((c: any) => c !== null);
    if (candles.length === 0) {
      warn('[TwelveData] time_series returned no valid candles');
      return null;
    }
    return { success: true, symbol, timeframe, data: candles };
  } catch (e) {
    warn('[TwelveData] time_series fetch failed:', (e as Error).message);
    return null;
  }
}

export async function fetchYahooHistory(symbol: string, timeframe: string) {
  const cacheKey = `yahoo:${symbol}:${timeframe}`;
  const cached = historyCache.get(cacheKey);
  if (cached) return cached;

  const symbolsMap: Record<string, string> = {
    'EURUSD': 'EURUSD=X',
    'GBPUSD': 'GBPUSD=X',
    'USDJPY': 'USDJPY=X',
    'AUDUSD': 'AUDUSD=X',
    'USDCAD': 'USDCAD=X',
    'GBPJPY': 'GBPJPY=X',
    'XAUUSD': 'XAUUSD=X',
    'XAGUSD': 'XAGUSD=X',
  };

  const ticker = symbolsMap[symbol] || `${symbol}=X`;

  let interval = '1h';
  let range = '30d';

  switch (timeframe) {
    case '1m':
      interval = '1m';
      range = '2d';
      break;
    case '5m':
      interval = '5m';
      range = '5d';
      break;
    case '15m':
      interval = '15m';
      range = '10d';
      break;
    case '1H':
      interval = '1h';
      range = '60d';
      break;
    case '4H':
      interval = '1h';
      range = '120d';
      break;
    case 'D':
      interval = '1d';
      range = '365d';
      break;
    default:
      interval = '1h';
      range = '60d';
  }

  // Try query1 then query2
  const urls = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}`,
  ];

  let lastError: any = null;
  for (const url of urls) {
    try {
      const response = await fetchWithTimeout(url, { timeoutMs: 7000 });
      if (!response.ok) {
        lastError = new Error(`Yahoo Finance returned status ${response.status}`);
        continue;
      }
      const data = (await response.json()) as any;
      const result = data?.chart?.result?.[0];
      if (!result) {
        lastError = new Error('Invalid response structure from Yahoo Finance');
        continue;
      }

      const timestamps = result.timestamp || [];
      const quote = result.indicators?.quote?.[0] || {};
      const opens = quote.open || [];
      const highs = quote.high || [];
      const lows = quote.low || [];
      const closes = quote.close || [];
      const volumes = quote.volume || [];

      let candlesticks: any[] = [];
      for (let i = 0; i < timestamps.length; i++) {
        const t = timestamps[i];
        const o = opens[i];
        const h = highs[i];
        const l = lows[i];
        const c = closes[i];
        const v = volumes[i] || 0;

        if (
          t !== undefined &&
          o !== null &&
          h !== null &&
          l !== null &&
          c !== null &&
          o !== undefined &&
          h !== undefined &&
          l !== undefined &&
          c !== undefined
        ) {
          candlesticks.push({
            time: t,
            open: parseFloat(o.toFixed(5)),
            high: parseFloat(h.toFixed(5)),
            low: parseFloat(l.toFixed(5)),
            close: parseFloat(c.toFixed(5)),
            volume: Math.floor(v),
          });
        }
      }

      if (timeframe === '4H') {
        const aggregated: any[] = [];
        for (let i = 0; i < candlesticks.length; i += 4) {
          const chunk = candlesticks.slice(i, i + 4);
          if (chunk.length === 0) continue;
          const open = chunk[0].open;
          const close = chunk[chunk.length - 1].close;
          const high = Math.max(...chunk.map((c: any) => c.high));
          const low = Math.min(...chunk.map((c: any) => c.low));
          const volume = chunk.reduce((sum: number, c: any) => sum + (c.volume || 0), 0);
          const time = chunk[0].time;
          aggregated.push({ time, open, high, low, close, volume });
        }
        candlesticks = aggregated;
      }

      const resultObj = {
        success: true,
        symbol,
        timeframe,
        data: candlesticks,
      };

      historyCache.set(cacheKey, resultObj, 60_000); // 60s cache
      return resultObj;
    } catch (e) {
      lastError = e;
      continue;
    }
  }

  throw lastError || new Error('Failed to fetch Yahoo history');
}

export async function fetchMarketHistory(symbol: string, timeframe: string) {
  // Try Twelve Data first if configured
  if (process.env.TWELVEDATA_API_KEY) {
    const tdResult = await fetchTwelveDataHistory(symbol, timeframe);
    if (tdResult) return tdResult;
  }
  return await fetchYahooHistory(symbol, timeframe);
}
