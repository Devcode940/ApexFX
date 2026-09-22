import { useState, useEffect, useRef, useCallback } from 'react';
import { WatchlistItem } from '../types';
import { createWatchlistFromConfig } from '../utils/forexData';

export type FeedStatus = 'connecting' | 'live' | 'polling' | 'degraded';

const POLL_BASE_MS = 2500;
const POLL_MAX_MS = 15_000;
const RECONNECT_BASE_MS = 5_000;
const RECONNECT_MAX_MS = 60_000;

/**
 * Live price feed: WebSocket first, HTTP polling as the reliable fallback.
 *
 * Rewritten in the 2026-09-13 pass. The previous version polled unconditionally every 2.5s and
 * swallowed every error (`catch { /* silent catch to prevent console spam *\/ }`), so a 429 or an
 * upstream outage looked identical to a working feed — prices simply froze with no signal. It also
 * retried the WebSocket every 5s forever, and each retry requested a fresh `/api/ws/token`, which
 * turned a server-side limit into a self-inflicted storm.
 *
 * Now: exponential backoff driven by the server's Retry-After, paused while the tab is hidden,
 * and a `feedStatus` the UI can tell the truth with.
 */
export function useWatchlistFeed() {
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>(() => createWatchlistFromConfig());
  const [tickStates, setTickStates] = useState<Record<string, 'up' | 'down' | 'none'>>({});
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [feedStatus, setFeedStatus] = useState<FeedStatus>('connecting');
  const [feedSource, setFeedSource] = useState<'twelvedata' | 'yahoo' | null>(null);

  const watchlistRef = useRef(watchlistItems);
  useEffect(() => {
    watchlistRef.current = watchlistItems;
  }, [watchlistItems]);

  // --- Initial pre-population from the ECB/Frankfurter (or ForexRate) snapshot ---
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/forex');
        const data = await response.json();
        if (cancelled || !data?.success || !data?.rates) return;
        setWatchlistItems((prev) =>
          prev.map((item) => {
            const realPrice = data.rates[item.symbol];
            return realPrice ? { ...item, price: realPrice } : item;
          })
        );
      } catch (err) {
        // Non-fatal: the live feed is authoritative. Surfaced (not swallowed) so a broken
        // snapshot endpoint is visible in the console instead of looking like slow prices.
        console.warn('[ApexFX] initial rate snapshot unavailable; waiting for the live feed.', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // --- apply an incoming rates map ---
  const applyRates = useCallback((rates: Record<string, any>, source?: string) => {
    if (!rates || typeof rates !== 'object') return;
    if (source === 'twelvedata' || source === 'yahoo') setFeedSource(source);

    const prevItems = watchlistRef.current;
    const flashes: Record<string, 'up' | 'down' | 'none'> = {};
    let anyChange = false;

    const updated = prevItems.map((item) => {
      const update = rates[item.symbol];
      if (!update) return item;
      const price = typeof update.price === 'number' ? update.price : parseFloat(update.price);
      if (!Number.isFinite(price) || price <= 0) return item; // never mark a symbol with a bogus 0
      const priceDiff = price - item.price;
      if (item.price === 0) flashes[item.symbol] = 'none';
      else flashes[item.symbol] = priceDiff > 0 ? 'up' : priceDiff < 0 ? 'down' : 'none';
      if (price !== item.price || update.high !== item.high || update.low !== item.low || update.change !== item.change) {
        anyChange = true;
      }
      return {
        ...item,
        price,
        high: Number.isFinite(update.high) ? update.high : item.high,
        low: Number.isFinite(update.low) ? update.low : item.low,
        change: Number.isFinite(update.change) ? update.change : item.change,
      };
    });

    if (!anyChange) return; // identical payload -> skip the render entirely
    setWatchlistItems(updated);
    setTickStates((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const sym of Object.keys(flashes)) {
        if (flashes[sym] !== 'none') {
          next[sym] = flashes[sym];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  // --- WS + polling state machine ---
  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempts = 0;
    let socketOpen = false;
    let pollFailures = 0;
    let pollIntervalMs = POLL_BASE_MS;
    /** Do not poll while the tab is hidden, and do not reconnect a socket nobody can see. */
    let visible = typeof document === 'undefined' ? true : !document.hidden;

    const backoffPoll = (retryAfterSec?: number) => {
      pollFailures += 1;
      const fromServer = Number.isFinite(retryAfterSec) && (retryAfterSec as number) > 0 ? (retryAfterSec as number) * 1000 : 0;
      pollIntervalMs = Math.min(POLL_MAX_MS, Math.max(POLL_BASE_MS, fromServer || pollIntervalMs * 2));
      if (pollFailures === 1 || pollFailures % 10 === 0) {
        console.warn(`[ApexFX] price poll degraded (${pollFailures} consecutive); retrying in ${Math.round(pollIntervalMs / 1000)}s`);
      }
      setFeedStatus('degraded');
    };

    const schedulePoll = () => {
      if (pollTimer) clearTimeout(pollTimer);
      if (cancelled || !visible) return;
      pollTimer = setTimeout(poll, pollIntervalMs);
    };

    async function poll() {
      pollTimer = null;
      if (cancelled || !visible) return;
      try {
        const response = await fetch('/api/market/prices');
        if (response.status === 429) {
          const body = await response.json().catch(() => null);
          backoffPoll(Number(body?.retryAfterSeconds) || Number(response.headers.get('Retry-After')));
          schedulePoll();
          return;
        }
        const data = await response.json();
        if (response.ok && data?.success && data?.rates) {
          applyRates(data.rates, data.source);
          if (pollFailures > 0) {
            console.info('[ApexFX] price poll recovered');
            pollFailures = 0;
            pollIntervalMs = POLL_BASE_MS;
          }
          // Polling is the fallback path: only claim 'polling' when the socket is not live.
          setFeedStatus((prev) => (prev === 'degraded' ? 'polling' : prev === 'connecting' ? 'polling' : prev));
        } else {
          backoffPoll();
        }
      } catch {
        backoffPoll();
      }
      schedulePoll();
    }

    const stopPolling = () => {
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
    };

    const scheduleReconnect = () => {
      if (reconnectTimer || cancelled || !visible) return;
      const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.min(reconnectAttempts, 4));
      reconnectAttempts += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    async function connect() {
      if (cancelled) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const baseWsUrl = `${protocol}//${window.location.host}`;

      let wsUrl = baseWsUrl;
      try {
        const tokenRes = await fetch('/api/ws/token');
        if (tokenRes.ok) {
          const { token } = await tokenRes.json();
          if (token) wsUrl = `${baseWsUrl}?token=${encodeURIComponent(token)}`;
        } else if (tokenRes.status === 429) {
          // Token issuance is rate limited: waiting out the advertised window beats the old
          // behaviour of retrying every 5s and deepening the hole.
          const retry = Number(tokenRes.headers.get('Retry-After'));
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
          }, Math.max(5_000, Number.isFinite(retry) && retry > 0 ? retry * 1000 : 15_000));
          return;
        }
        // Any other failure (403 when WS_SHARED_SECRET is set, 5xx): fall through to polling.
      } catch {
        /* token endpoint unreachable -> connect will be refused; polling carries the feed */
      }

      try {
        ws = new WebSocket(wsUrl);
      } catch {
        ws = null;
        setFeedStatus('polling');
        schedulePoll();
        return;
      }

      ws.onopen = () => {
        if (cancelled) return;
        reconnectAttempts = 0;
        socketOpen = true;
        setWsConnected(true);
        setFeedStatus('live');
        stopPolling(); // socket is authoritative; the poll was only insurance
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'INITIAL_RATES' || data.type === 'PRICE_UPDATE') applyRates(data.rates, data.source);
        } catch (e) {
          console.warn('[ApexFX] malformed WebSocket frame ignored:', e);
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        socketOpen = false;
        setWsConnected(false);
        setFeedStatus('polling');
        schedulePoll();
        scheduleReconnect();
      };

      ws.onerror = () => {
        try {
          ws?.close();
        } catch {
          /* already closing */
        }
      };
    }

    const onVisibility = () => {
      visible = !document.hidden;
      if (visible) {
        // Coming back to the foreground: refresh immediately rather than waiting out a stale
        // backoff, and re-establish the socket if it was torn down while hidden.
        pollIntervalMs = POLL_BASE_MS;
        schedulePoll();
        if (!socketOpen && !reconnectTimer) connect();
      } else {
        stopPolling();
      }
    };

    if (visible) connect();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      stopPolling();
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      ws = null;
    };
    // Deliberately keyed on the stable applyRates callback only: re-running on wsConnected
    // would tear down the socket every time it flips.
  }, [applyRates]);

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
    feedStatus,
    feedSource,
    watchlistRef,
  };
}
