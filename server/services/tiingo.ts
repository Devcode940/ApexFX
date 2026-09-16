import WebSocket from 'ws';
import { fetchWithTimeout } from '../lib/fetch';
import { log, warn, error as logError } from '../lib/logger';
import { PAIRS_CONFIG_WS, serverWatchlist } from './market';

export const TIINGO_TICKERS: Record<string, string> = {
  'EURUSD': 'eurusd',
  'GBPUSD': 'gbpusd',
  'USDJPY': 'usdjpy',
  'AUDUSD': 'audusd',
  'USDCAD': 'usdcad',
  'GBPJPY': 'gbpjpy',
  'EURGBP': 'eurgbp',
  'USDCHF': 'usdchf',
  'NZDUSD': 'nzdusd',
  'EURJPY': 'eurjpy',
  'XAUUSD': 'xauusd',
  'XAGUSD': 'xagusd',
  'BTCUSD': 'btcusd',
  'ETHUSD': 'ethusd',
};

export const REVERSE_TIINGO_TICKERS: Record<string, string> = Object.fromEntries(
  Object.entries(TIINGO_TICKERS).map(([key, val]) => [val.toLowerCase(), key])
);

export const TIINGO_RESAMPLE_MAP: Record<string, { freq: string; lookbackDays: number }> = {
  '1m': { freq: '1min', lookbackDays: 3 },
  '5m': { freq: '5min', lookbackDays: 7 },
  '15m': { freq: '15min', lookbackDays: 20 },
  '1H': { freq: '1hour', lookbackDays: 60 },
  '4H': { freq: '4hour', lookbackDays: 150 },
  'D': { freq: '1day', lookbackDays: 365 },
};

export function getTiingoApiKey(): string | undefined {
  return process.env.TIINGO_API_KEY;
}

let tiingoWs: WebSocket | null = null;
let tiingoPingTimer: NodeJS.Timeout | null = null;
let tiingoReconnectTimer: NodeJS.Timeout | null = null;
let onTiingoPriceUpdate: (() => void) | null = null;

export function setTiingoPriceUpdateCallback(cb: () => void) {
  onTiingoPriceUpdate = cb;
}

/**
 * Fetch top-of-book quotes for all FX pairs from Tiingo REST API
 */
export async function fetchTiingoQuotes(): Promise<Set<string>> {
  const applied = new Set<string>();
  const apiKey = getTiingoApiKey();
  if (!apiKey) return applied;

  const tickers = Object.values(TIINGO_TICKERS).join(',');
  try {
    const res = await fetchWithTimeout(
      `https://api.tiingo.com/tiingo/fx/top?tickers=${encodeURIComponent(tickers)}`,
      {
        headers: {
          'Authorization': `Token ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeoutMs: 8000,
      }
    );

    if (!res.ok) {
      warn(`[Tiingo] top quotes HTTP ${res.status}`);
      return applied;
    }

    const data = (await res.json()) as any[];
    if (!Array.isArray(data)) return applied;

    for (const q of data) {
      const ticker = String(q.ticker || '').toLowerCase();
      const symbol = REVERSE_TIINGO_TICKERS[ticker];
      if (!symbol) continue;

      const item = serverWatchlist.find((i) => i.symbol === symbol);
      if (!item) continue;

      const price = q.midPrice || (q.bidPrice && q.askPrice ? (q.bidPrice + q.askPrice) / 2 : q.bidPrice || q.askPrice);
      if (!price || !isFinite(price) || price <= 0) continue;

      const config = PAIRS_CONFIG_WS[symbol];
      item.price = parseFloat(price.toFixed(config.pipDecimal + 1));
      item.high = item.high > 0 ? Math.max(item.high, item.price) : item.price;
      item.low = item.low > 0 ? Math.min(item.low, item.price) : item.price;

      applied.add(symbol);
    }
  } catch (err: any) {
    warn('[Tiingo] Quote fetch error:', err.message);
  }

  return applied;
}

/**
 * Fetch historical OHLCV candlesticks from Tiingo
 */
export async function fetchTiingoHistory(
  symbol: string,
  timeframe: string
): Promise<{ success: boolean; symbol: string; timeframe: string; data: any[]; source: string } | null> {
  const apiKey = getTiingoApiKey();
  if (!apiKey) return null;

  const ticker = TIINGO_TICKERS[symbol];
  const config = TIINGO_RESAMPLE_MAP[timeframe];
  if (!ticker || !config) return null;

  const startDate = new Date(Date.now() - config.lookbackDays * 86400 * 1000).toISOString().split('T')[0];

  try {
    const url = `https://api.tiingo.com/tiingo/fx/${ticker}/prices?resampleFreq=${config.freq}&startDate=${startDate}&columns=date,open,high,low,close,volume`;
    const res = await fetchWithTimeout(url, {
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeoutMs: 8000,
    });

    if (!res.ok) {
      warn(`[Tiingo] History HTTP ${res.status} for ${symbol}`);
      return null;
    }

    const raw = (await res.json()) as any[];
    if (!Array.isArray(raw) || raw.length === 0) return null;

    const candles = raw
      .map((c: any) => {
        const time = Math.floor(Date.parse(c.date) / 1000);
        const open = parseFloat(c.open);
        const high = parseFloat(c.high);
        const low = parseFloat(c.low);
        const close = parseFloat(c.close);
        const volume = Math.floor(parseFloat(c.volume) || 0);

        if (!isFinite(time) || !isFinite(open) || !isFinite(high) || !isFinite(low) || !isFinite(close) || open <= 0) {
          return null;
        }

        return { time, open, high, low, close, volume };
      })
      .filter((c: any) => c !== null);

    if (candles.length === 0) return null;

    return {
      success: true,
      symbol,
      timeframe,
      data: candles,
      source: 'tiingo',
    };
  } catch (err: any) {
    warn(`[Tiingo] Failed to fetch history for ${symbol}:`, err.message);
    return null;
  }
}

/**
 * Connect to Tiingo WebSocket Firehose (when TIINGO_API_KEY configured)
 */
export function startTiingoStream() {
  const apiKey = getTiingoApiKey();
  if (!apiKey || tiingoWs || process.env.VERCEL) return;

  try {
    tiingoWs = new WebSocket('wss://api.tiingo.com/fx', {
      handshakeTimeout: 7000,
      headers: { 'User-Agent': 'ApexFX-Terminal/1.0' },
    });

    tiingoWs.on('open', () => {
      log('[Tiingo] WebSocket stream connected');
      if (tiingoWs && tiingoWs.readyState === WebSocket.OPEN) {
        tiingoWs.send(JSON.stringify({
          eventName: 'subscribe',
          authorization: apiKey,
          eventData: {
            thresholdLevel: 5,
            tickers: Object.values(TIINGO_TICKERS),
          },
        }));
      }

      // Heartbeat ping
      if (tiingoPingTimer) clearInterval(tiingoPingTimer);
      tiingoPingTimer = setInterval(() => {
        if (tiingoWs && tiingoWs.readyState === WebSocket.OPEN) {
          try {
            tiingoWs.ping();
          } catch {
            // ignore
          }
        }
      }, 25_000);
      if (tiingoPingTimer.unref) tiingoPingTimer.unref();
    });

    tiingoWs.on('message', (raw: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(raw.toString());
        // Tiingo FX stream format: messageType: 'A' (data)
        if (msg.messageType === 'A' && Array.isArray(msg.data)) {
          // data format: [ticker, date, bidSize, bidPrice, midPrice, askSize, askPrice]
          for (const item of msg.data) {
            const ticker = String(item[0] || '').toLowerCase();
            const symbol = REVERSE_TIINGO_TICKERS[ticker];
            if (!symbol) continue;

            const target = serverWatchlist.find((i) => i.symbol === symbol);
            if (!target) continue;

            const mid = item[4] || (item[3] && item[6] ? (item[3] + item[6]) / 2 : item[3] || item[6]);
            const price = parseFloat(mid);
            if (!isFinite(price) || price <= 0) continue;

            const config = PAIRS_CONFIG_WS[symbol];
            target.price = parseFloat(price.toFixed(config.pipDecimal + 1));
            target.high = target.high > 0 ? Math.max(target.high, target.price) : target.price;
            target.low = target.low > 0 ? Math.min(target.low, target.price) : target.price;

            if (onTiingoPriceUpdate) {
              onTiingoPriceUpdate();
            }
          }
        }
      } catch {
        // ignore
      }
    });

    tiingoWs.on('error', (err: Error) => {
      warn('[Tiingo] WebSocket warning:', err.message);
    });

    tiingoWs.on('close', () => {
      cleanupTiingoWs();
      scheduleTiingoReconnect();
    });
  } catch (err: any) {
    warn('[Tiingo] WebSocket setup failed:', err.message);
    cleanupTiingoWs();
    scheduleTiingoReconnect();
  }
}

function cleanupTiingoWs() {
  if (tiingoPingTimer) {
    clearInterval(tiingoPingTimer);
    tiingoPingTimer = null;
  }
  if (tiingoWs) {
    try {
      tiingoWs.removeAllListeners();
      tiingoWs.close();
    } catch {
      // ignore
    }
    tiingoWs = null;
  }
}

function scheduleTiingoReconnect() {
  if (tiingoReconnectTimer) return;
  tiingoReconnectTimer = setTimeout(() => {
    tiingoReconnectTimer = null;
    startTiingoStream();
  }, 15_000);
}

export function stopTiingoStream() {
  if (tiingoReconnectTimer) {
    clearTimeout(tiingoReconnectTimer);
    tiingoReconnectTimer = null;
  }
  cleanupTiingoWs();
}
