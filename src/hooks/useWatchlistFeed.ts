import { useState, useEffect, useMemo } from 'react';
import type { WatchlistItem } from '../types';
import { createWatchlistFromConfig } from '../utils/forexData';
import { isExecutableQuote, parseQuote, sourceOf, QUOTE_MAX_AGE_MS } from '../../shared/market';
import type { QuoteStore } from '../utils/quoteStore';

export type FeedStatus = 'connecting' | 'live' | 'polling' | 'degraded';
export function retryAfterMs(value: string | null, now = Date.now()): number {
  if (!value) return 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric * 1000) : Math.max(0, (Date.parse(value) || now) - now);
}

/** One validated ordered event boundary; rendering is downstream of execution, not its clock. */
export function useWatchlistFeed(store: QuoteStore, accessToken?: string) {
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>(createWatchlistFromConfig);
  const [tickStates, setTickStates] = useState<Record<string, 'up' | 'down' | 'none'>>({});
  const [wsConnected, setWsConnected] = useState(false);
  const [transport, setTransport] = useState<FeedStatus>('connecting');
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let previous = new Map(store.snapshot().map(q => [q.symbol, q.price]));
    let flashTimer: ReturnType<typeof setTimeout>;
    const unsubscribe = store.subscribe(({ quotes, changed }) => {
      const map = new Map(quotes.map(q => [q.symbol, q]));
      const flashes = Object.fromEntries(changed.map(q => [q.symbol, !previous.has(q.symbol) || previous.get(q.symbol) === q.price ? 'none' : q.price > previous.get(q.symbol)! ? 'up' : 'down'])) as Record<string, 'up' | 'down' | 'none'>;
      previous = new Map(quotes.map(q => [q.symbol, q.price]));
      setWatchlistItems(prev => prev.map(item => ({ ...item, ...map.get(item.symbol) })));
      setTickStates(flashes); setNow(Date.now());
      clearTimeout(flashTimer); flashTimer = setTimeout(() => setTickStates({}), 900);
    });
    return () => { unsubscribe(); clearTimeout(flashTimer); };
  }, [store]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setWsConnected(false); setTransport('connecting');
    let socket: WebSocket | null = null;
    let visible = !document.hidden;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let pollInFlight = false;
    let connectInFlight = false;
    let socketFresh = false;
    let wsAllowed = false;
    let wsDisabled = false;
    let attempts = 0;
    let pollDelay = 2500;
    let notBefore = 0;
    let reconnectNotBefore = 0;
    let lastFrame = 0;
    const requests = new Set<AbortController>();
    const request = async (url: string, init: RequestInit = {}) => {
      const controller = new AbortController();
      requests.add(controller);
      const timer = setTimeout(() => controller.abort(), 12_000);
      try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        const body = await response.json();
        if (cancelled || controller.signal.aborted) throw new Error('Request cancelled');
        return { response, body };
      } finally { clearTimeout(timer); requests.delete(controller); }
    };
    const schedulePoll = () => {
      clearTimeout(pollTimer);
      if (cancelled || !visible || socketFresh) return;
      pollTimer = setTimeout(poll, Math.min(2_147_000_000, Math.max(pollDelay, notBefore - Date.now())));
    };
    async function poll() {
      if (cancelled || !visible || pollInFlight || socketFresh) return;
      if (Date.now() < notBefore) { schedulePoll(); return; }
      pollInFlight = true;
      try {
        const { response, body } = await request('/api/market/prices');
        if (cancelled) return;
        if (response.status === 429) {
          // A server minimum is never clamped DOWN by the ordinary exponential-backoff cap.
          notBefore = Date.now() + Math.max(retryAfterMs(response.headers.get('Retry-After')), Number(body?.retryAfterSeconds) * 1000 || 0, 2500);
        }
        store.apply(body?.rates);
        // A demo-labelled response can drive display/polling but never executable freshness.
        const demoMode = body?.dataMode === 'demo';
        const fresh = response.ok && body?.success !== false && body?.rates && Object.entries(body.rates).some(([symbol, raw]) => {
          const parsed = parseQuote(symbol, raw);
          return !!parsed && (demoMode ? parsed.provider === 'demo' && parsed.price > 0 : isExecutableQuote(parsed));
        });
        setTransport(fresh ? 'polling' : 'degraded');
        pollDelay = fresh ? 2500 : Math.min(15_000, pollDelay * 2);
      } catch {
        if (!cancelled) { ('degraded'); pollDelay = Math.min(15_000, pollDelay * 2); }
      } finally { pollInFlight = false; schedulePoll(); }
    }
    const reconnect = (minimum = 0) => {
      if (cancelled || !visible || !wsAllowed || wsDisabled || reconnectTimer) return;
      reconnectNotBefore = Math.max(reconnectNotBefore, Date.now() + minimum);
      const delay = Math.max(reconnectNotBefore - Date.now(), Math.min(60_000, 5000 * 2 ** Math.min(attempts++, 4)));
      reconnectTimer = setTimeout(() => { reconnectTimer = undefined; void connect(); }, Math.min(2_147_000_000, delay));
    };
    async function connect() {
      if (cancelled || !visible || !wsAllowed || wsDisabled || connectInFlight || socket) return;
      if (Date.now() < reconnectNotBefore) { reconnect(); return; }
      connectInFlight = true;
      try {
        const { response, body } = await request('/api/ws/token', {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) }, body: '{}',
        });
        if (cancelled || !visible) return; // critical post-await lifetime check
        if (!response.ok || typeof body?.token !== 'string') {
          if ([401, 403, 404].includes(response.status)) wsDisabled = true;
          else reconnect(retryAfterMs(response.headers.get('Retry-After')));
          return; // NEVER attempt a tokenless socket
        }
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${protocol}//${location.host}/ws?token=${encodeURIComponent(body.token)}`);
        socket = ws;
        lastFrame = Date.now();
        ws.onopen = () => {
          if (cancelled) { ws.close(); return; }
          setWsConnected(true); // transport only; authenticated fresh DATA determines live status
        };
        ws.onmessage = event => {
          if (cancelled) return;
          try {
            const message = JSON.parse(event.data);
            if (!['INITIAL_RATES', 'PRICE_UPDATE'].includes(message.type) || !message.rates) return;
            store.apply(message.rates);
            const validFrame = Object.entries(message.rates).some(([symbol, raw]) => {
              const parsed = parseQuote(symbol, raw);
              if (!parsed) return false;
              // The server's own labelled demo frames keep display moving; they never qualify as executable quotes.
              if (parsed.provider === 'demo') return true;
              // Executable provider quotes are what prove true liveness.
              return isExecutableQuote(parsed);
            });
            if (validFrame) {
              lastFrame = Date.now(); attempts = 0; socketFresh = true;
              setTransport('live'); clearTimeout(pollTimer);
            } else {
              socketFresh = false; setTransport('degraded'); schedulePoll();
            }
          } catch { /* malformed data is ignored, never promoted to a live quote */ }
        };
        ws.onclose = () => {
          if (socket === ws) socket = null;
          socketFresh = false;
          if (cancelled) return;
          setWsConnected(false); setTransport('polling'); schedulePoll(); reconnect();
        };
        ws.onerror = () => ws.close();
      } catch { if (!cancelled) reconnect(); }
      finally { connectInFlight = false; }
    }
    const onVisibility = () => {
      visible = !document.hidden;
      if (visible) { schedulePoll(); void connect(); }
      else { clearTimeout(pollTimer); clearTimeout(reconnectTimer); reconnectTimer = undefined; }
    };
    const watchdog = setInterval(() => {
      if (socket && Date.now() - lastFrame > 45_000) {
        socketFresh = false; socket.close(); schedulePoll();
      }
    }, 5000);
    document.addEventListener('visibilitychange', onVisibility);
    void poll(); // polling starts independently: a failed handshake must not leave the feed idle
    void request('/api/capabilities').then(({ response, body }) => {
      if (cancelled) return;
      wsAllowed = response.ok && body?.websocket === true;
      if (wsAllowed) void connect();
    }).catch(() => { /* keep HTTP fallback */ });
    return () => {
      cancelled = true;
      requests.forEach(c => c.abort());
      clearTimeout(pollTimer); clearTimeout(reconnectTimer); clearInterval(watchdog);
      document.removeEventListener('visibilitychange', onVisibility);
      socket?.close();
    };
  }, [store, accessToken]);
  const feedSource = useMemo(() => sourceOf(watchlistItems), [watchlistItems]);
  // Demo quotes may hold the DISPLAY status up (with the same age window) but never execution;
  // isExecutableQuote below stays the only trading gate.
  const hasFreshQuote = watchlistItems.some(q => isExecutableQuote(q, now) ||
    (q.provider === 'demo' && q.price > 0 && typeof q.asOf === 'number' && now - q.asOf <= QUOTE_MAX_AGE_MS));
  const feedStatus: FeedStatus = hasFreshQuote ? transport : transport === 'connecting' ? 'connecting' : 'degraded';
  return { watchlistItems, tickStates, wsConnected, feedStatus, feedSource };
}
