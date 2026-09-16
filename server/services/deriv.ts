import WebSocket from 'ws';
import { log, warn, error as logError } from '../lib/logger';
import { PAIRS_CONFIG_WS, serverWatchlist, WatchlistItem } from './market';

export const DERIV_SYMBOLS: Record<string, string> = {
  'EURUSD': 'frxEURUSD',
  'GBPUSD': 'frxGBPUSD',
  'USDJPY': 'frxUSDJPY',
  'AUDUSD': 'frxAUDUSD',
  'USDCAD': 'frxUSDCAD',
  'GBPJPY': 'frxGBPJPY',
  'EURGBP': 'frxEURGBP',
  'USDCHF': 'frxUSDCHF',
  'NZDUSD': 'frxNZDUSD',
  'EURJPY': 'frxEURJPY',
  'XAUUSD': 'frxXAUUSD',
  'XAGUSD': 'frxXAGUSD',
  'BTCUSD': 'cryBTCUSD',
  'ETHUSD': 'cryETHUSD',
};

export const REVERSE_DERIV_SYMBOLS: Record<string, string> = Object.fromEntries(
  Object.entries(DERIV_SYMBOLS).map(([key, val]) => [val, key])
);

export const DERIV_GRANULARITY_MAP: Record<string, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1H': 3600,
  '4H': 14400,
  'D': 86400,
};

const DERIV_WS_ENDPOINTS = [
  'wss://ws.derivws.com/websockets/v3?app_id=1089',
  'wss://ws.binaryws.com/websockets/v3?app_id=1089',
];

let derivWs: WebSocket | null = null;
let derivPingTimer: NodeJS.Timeout | null = null;
let derivReconnectTimer: NodeJS.Timeout | null = null;
let derivReconnectAttempts = 0;
let isExplicitlyStopped = false;
let onPriceUpdateCallback: (() => void) | null = null;

export function setDerivPriceUpdateCallback(cb: () => void) {
  onPriceUpdateCallback = cb;
}

export function isDerivConnected(): boolean {
  return derivWs !== null && derivWs.readyState === WebSocket.OPEN;
}

/**
 * Connect to Deriv WebSocket feed for 100% free, real-time ticks
 */
export function startDerivStream() {
  if (isExplicitlyStopped || process.env.VERCEL) return;
  if (derivWs && (derivWs.readyState === WebSocket.OPEN || derivWs.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const endpointIndex = derivReconnectAttempts % DERIV_WS_ENDPOINTS.length;
  const endpoint = DERIV_WS_ENDPOINTS[endpointIndex];

  try {
    derivWs = new WebSocket(endpoint, {
      handshakeTimeout: 7000,
      headers: {
        'User-Agent': 'ApexFX-Terminal/1.0',
      },
    });

    derivWs.on('open', () => {
      log(`[Deriv] Connected to public market stream (${endpoint})`);
      derivReconnectAttempts = 0;

      // Subscribe to all symbols
      for (const derivSymbol of Object.values(DERIV_SYMBOLS)) {
        if (derivWs && derivWs.readyState === WebSocket.OPEN) {
          derivWs.send(JSON.stringify({
            ticks: derivSymbol,
            subscribe: 1,
          }));
        }
      }

      // Heartbeat ping every 30s
      if (derivPingTimer) clearInterval(derivPingTimer);
      derivPingTimer = setInterval(() => {
        if (derivWs && derivWs.readyState === WebSocket.OPEN) {
          try {
            derivWs.send(JSON.stringify({ ping: 1 }));
          } catch {
            // ignore ping errors
          }
        }
      }, 30_000);
      if (derivPingTimer.unref) derivPingTimer.unref();
    });

    derivWs.on('message', (raw: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.msg_type === 'tick' && msg.tick) {
          handleDerivTick(msg.tick);
        } else if (msg.msg_type === 'error' || msg.error) {
          warn('[Deriv] Message notice:', msg.error?.message || msg.msg_type);
        }
      } catch {
        // ignore parse errors
      }
    });

    derivWs.on('error', (err: Error) => {
      warn('[Deriv] WebSocket stream warning:', err.message);
    });

    derivWs.on('close', () => {
      cleanupDerivWs();
      scheduleDerivReconnect();
    });
  } catch (err: any) {
    warn('[Deriv] Failed to initiate WebSocket stream:', err.message);
    cleanupDerivWs();
    scheduleDerivReconnect();
  }
}

function handleDerivTick(tick: { symbol: string; quote: number; ask?: number; bid?: number; epoch: number }) {
  const symbol = REVERSE_DERIV_SYMBOLS[tick.symbol];
  if (!symbol) return;

  const item = serverWatchlist.find((i) => i.symbol === symbol);
  if (!item) return;

  const config = PAIRS_CONFIG_WS[symbol];
  const price = typeof tick.quote === 'number' ? tick.quote : parseFloat(String(tick.quote));
  if (!isFinite(price) || price <= 0) return;

  const prevPrice = item.price;
  item.price = parseFloat(price.toFixed(config.pipDecimal + 1));
  item.high = item.high > 0 ? Math.max(item.high, item.price) : item.price;
  item.low = item.low > 0 ? Math.min(item.low, item.price) : item.price;

  // Calculate change relative to initial / previous baseline
  if (prevPrice > 0 && item.change === 0) {
    const diff = item.price - prevPrice;
    item.change = parseFloat(((diff / prevPrice) * 100).toFixed(2));
  }

  if (onPriceUpdateCallback) {
    onPriceUpdateCallback();
  }
}

function cleanupDerivWs() {
  if (derivPingTimer) {
    clearInterval(derivPingTimer);
    derivPingTimer = null;
  }
  if (derivWs) {
    try {
      derivWs.removeAllListeners();
      derivWs.close();
    } catch {
      // ignore
    }
    derivWs = null;
  }
}

function scheduleDerivReconnect() {
  if (isExplicitlyStopped || derivReconnectTimer) return;
  derivReconnectAttempts++;
  const delay = Math.min(30_000, 5000 * Math.pow(1.5, Math.min(derivReconnectAttempts, 5)));
  derivReconnectTimer = setTimeout(() => {
    derivReconnectTimer = null;
    startDerivStream();
  }, delay);
}

export function stopDerivStream() {
  isExplicitlyStopped = true;
  if (derivReconnectTimer) {
    clearTimeout(derivReconnectTimer);
    derivReconnectTimer = null;
  }
  cleanupDerivWs();
}

/**
 * Fetch historical candles via Deriv's public ticks_history API (Zero-auth)
 */
export async function fetchDerivHistory(
  symbol: string,
  timeframe: string,
  count = 300
): Promise<{ success: boolean; symbol: string; timeframe: string; data: any[]; source: string } | null> {
  const derivSymbol = DERIV_SYMBOLS[symbol];
  const granularity = DERIV_GRANULARITY_MAP[timeframe];
  if (!derivSymbol || !granularity) return null;

  return new Promise((resolve) => {
    let completed = false;
    let wsClient: WebSocket | null = null;

    const timer = setTimeout(() => {
      if (!completed) {
        completed = true;
        try {
          if (wsClient) wsClient.close();
        } catch {
          // ignore
        }
        resolve(null);
      }
    }, 6000);

    try {
      const endpoint = DERIV_WS_ENDPOINTS[0];
      wsClient = new WebSocket(endpoint, {
        handshakeTimeout: 5000,
        headers: { 'User-Agent': 'ApexFX-Terminal/1.0' },
      });

      wsClient.on('open', () => {
        if (!wsClient || wsClient.readyState !== WebSocket.OPEN) return;
        wsClient.send(JSON.stringify({
          ticks_history: derivSymbol,
          adjust_start_time: 1,
          count: Math.min(count, 1000),
          end: 'latest',
          granularity,
          style: 'candles',
        }));
      });

      wsClient.on('message', (raw: WebSocket.RawData) => {
        if (completed) return;
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.msg_type === 'candles' && Array.isArray(msg.candles)) {
            completed = true;
            clearTimeout(timer);
            try { wsClient?.close(); } catch {}

            const candles = msg.candles
              .map((c: any) => {
                const epoch = Number(c.epoch);
                const open = parseFloat(c.open);
                const high = parseFloat(c.high);
                const low = parseFloat(c.low);
                const close = parseFloat(c.close);
                if (!isFinite(epoch) || !isFinite(open) || !isFinite(high) || !isFinite(low) || !isFinite(close)) {
                  return null;
                }
                return {
                  time: epoch,
                  open,
                  high,
                  low,
                  close,
                  volume: 0,
                };
              })
              .filter((c: any) => c !== null);

            if (candles.length > 0) {
              resolve({
                success: true,
                symbol,
                timeframe,
                data: candles,
                source: 'deriv',
              });
              return;
            }
          }
          if (msg.msg_type === 'error' || msg.error) {
            completed = true;
            clearTimeout(timer);
            try { wsClient?.close(); } catch {}
            resolve(null);
          }
        } catch {
          completed = true;
          clearTimeout(timer);
          try { wsClient?.close(); } catch {}
          resolve(null);
        }
      });

      wsClient.on('error', () => {
        if (!completed) {
          completed = true;
          clearTimeout(timer);
          try { wsClient?.close(); } catch {}
          resolve(null);
        }
      });
    } catch {
      if (!completed) {
        completed = true;
        clearTimeout(timer);
        resolve(null);
      }
    }
  });
}
