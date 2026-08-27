import { useState, useEffect, useRef } from 'react';
import { WatchlistItem } from '../types';
import { createWatchlistFromConfig } from '../utils/forexData';

export function useWatchlistFeed() {
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>(() => createWatchlistFromConfig());
  const [tickStates, setTickStates] = useState<Record<string, 'up' | 'down' | 'none'>>({});
  const [wsConnected, setWsConnected] = useState<boolean>(false);

  const watchlistRef = useRef(watchlistItems);
  useEffect(() => {
    watchlistRef.current = watchlistItems;
  }, [watchlistItems]);

  // Initial rates from Frankfurter/ForexRate
  useEffect(() => {
    const fetchRealRates = async () => {
      try {
        const frResponse = await fetch('/api/market/forexrate');
        const frData = await frResponse.json();
        let rates = null;

        if (frResponse.ok && frData.rates) {
          rates = frData.rates;
        } else {
          const response = await fetch('/api/forex');
          const data = await response.json();
          if (data.success && data.rates) rates = data.rates;
        }

        if (rates) {
          setWatchlistItems((prevItems) => {
            return prevItems.map((item) => {
              const realPrice = rates[item.symbol];
              if (realPrice) {
                return { ...item, price: realPrice };
              }
              return item;
            });
          });
        }
      } catch (err) {
        console.warn('Live forex rates API unavailable; prices will come from real-time feed.', err);
      }
    };
    fetchRealRates();
  }, []);

  // WebSocket + polling fallback
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: any = null;
    let pollingInterval: any = null;
    let tokenFetchAttempts = 0;

    const handlePricesUpdate = (rates: Record<string, any>) => {
      const prevItems = watchlistRef.current;
      const nextTickStates: Record<string, 'up' | 'down' | 'none'> = {};
      const updated = prevItems.map((item) => {
        const update = rates[item.symbol];
        if (update) {
          const priceDiff = update.price - item.price;
          if (item.price === 0) {
            nextTickStates[item.symbol] = 'none';
          } else {
            nextTickStates[item.symbol] = priceDiff > 0 ? 'up' : priceDiff < 0 ? 'down' : 'none';
          }
          return {
            ...item,
            price: update.price,
            high: update.high,
            low: update.low,
            change: update.change,
          };
        }
        return item;
      });

      setWatchlistItems(updated);
      setTickStates((prevFlashes) => {
        const nextFlashes = { ...prevFlashes };
        Object.keys(nextTickStates).forEach((sym) => {
          if (nextTickStates[sym] !== 'none') {
            nextFlashes[sym] = nextTickStates[sym];
          }
        });
        return nextFlashes;
      });
    };

    const startPolling = () => {
      if (pollingInterval) return;
      console.log('[Fallback Polling] Starting background HTTP polling for market rates...');
      pollingInterval = setInterval(async () => {
        try {
          const response = await fetch('/api/market/prices');
          const data = await response.json();
          if (response.ok && data.success && data.rates) {
            handlePricesUpdate(data.rates);
          }
        } catch {
          // Silent catch to prevent console spam
        }
      }, 2500);
    };

    const stopPolling = () => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
        console.log('[Fallback Polling] Stopped background HTTP polling (WebSocket active)');
      }
    };

    const connect = async () => {
      if (cancelled) return;
      try {
        // Try to get WS token (secured endpoint)
        let wsUrl: string;
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const baseWsUrl = `${protocol}//${window.location.host}`;

        try {
          const tokenRes = await fetch('/api/ws/token');
          if (tokenRes.ok) {
            const { token } = await tokenRes.json();
            wsUrl = `${baseWsUrl}?token=${encodeURIComponent(token)}`;
            tokenFetchAttempts = 0;
          } else {
            // If token endpoint fails (e.g., 403), fallback to direct WS without token in dev
            wsUrl = baseWsUrl;
            if (tokenRes.status === 403) {
              console.warn('[WebSocket] Token endpoint requires secret, falling back to polling in production');
              startPolling();
              return;
            }
          }
        } catch {
          wsUrl = baseWsUrl;
          tokenFetchAttempts++;
          if (tokenFetchAttempts > 3) {
            console.warn('[WebSocket] Token fetch failed repeatedly, using polling');
            startPolling();
            return;
          }
        }

        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          setWsConnected(true);
          stopPolling();
          console.log('[WebSocket] Real-time rates stream connected');
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'INITIAL_RATES' || data.type === 'PRICE_UPDATE') {
              handlePricesUpdate(data.rates);
            }
          } catch (e) {
            console.warn('[WebSocket] Message parsing error:', e);
          }
        };

        ws.onclose = () => {
          setWsConnected(false);
          startPolling();
          if (!cancelled) {
            reconnectTimeout = setTimeout(connect, 5000);
          }
        };

        ws.onerror = (err) => {
          console.warn('[WebSocket] Connection failed. Fallback polling is keeping prices live.', err);
          ws?.close();
        };
      } catch (err) {
        console.warn('[WebSocket] Setup failed:', err);
        startPolling();
        if (!cancelled) {
          reconnectTimeout = setTimeout(connect, 5000);
        }
      }
    };

    let cancelled = false;
    connect();
    startPolling();

    return () => {
      cancelled = true;
      if (ws) ws.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (pollingInterval) clearInterval(pollingInterval);
    };
  }, []);

  // Clear tick flashes after 900ms
  useEffect(() => {
    const hasActiveFlash = Object.values(tickStates).some((s) => s !== 'none');
    if (!hasActiveFlash) return;

    const timer = setTimeout(() => {
      setTickStates((s) => {
        const cleared = { ...s };
        Object.keys(cleared).forEach((k) => {
          if (cleared[k] !== 'none') cleared[k] = 'none';
        });
        return cleared;
      });
    }, 900);

    return () => clearTimeout(timer);
  }, [tickStates]);

  return {
    watchlistItems,
    setWatchlistItems,
    tickStates,
    setTickStates,
    wsConnected,
    watchlistRef,
  };
}
