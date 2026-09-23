import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { Candlestick, Timeframe } from '../types';
import type { InstrumentKind, MarketProvider } from '../../shared/market';
import { applyQuoteToCandles, parseCandles, reconcileHistory } from '../utils/candles';
import type { QuoteStore } from '../utils/quoteStore';

export interface HistoryMeta { provider: MarketProvider | null; instrumentKind: InstrumentKind; providerSymbol: string | null }
interface HistoryState { status: 'loading' | 'ready' | 'error'; error: string | null; meta: HistoryMeta | null }
export function useChartHistory(selectedSymbol: string, selectedTimeframe: Timeframe, store?: QuoteStore) {
  const [chartData, setChartData] = useState<Record<string, Record<string, Candlestick[]>>>({});
  const [states, setStates] = useState<Record<string, HistoryState>>({});
  const [attempt, setAttempt] = useState(0);
  const lastAttempt = useRef(0);
  const loaded = useRef(new Map<string, { time: number; meta: HistoryMeta }>());
  const key = `${selectedSymbol}:${selectedTimeframe}`;
  const retryHistory = useCallback(() => setAttempt(n => n + 1), []);
  const activeData = useMemo(() => chartData[selectedSymbol]?.[selectedTimeframe] ?? [], [chartData, selectedSymbol, selectedTimeframe]);

  useEffect(() => {
    const forced = lastAttempt.current !== attempt;
    lastAttempt.current = attempt;
    const cached = loaded.current.get(key);
    if (!forced && cached && Date.now() - cached.time < 60_000) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('History deadline exceeded')), 15_000);
    let cancelled = false;
    const requestStartedAt = Date.now();
    setStates(prev => ({ ...prev, [key]: { status: 'loading', error: null, meta: prev[key]?.meta ?? null } }));
    (async () => {
      try {
        const response = await fetch(`/api/market/history?symbol=${encodeURIComponent(selectedSymbol)}&timeframe=${encodeURIComponent(selectedTimeframe)}`, { signal: controller.signal });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error('Historical provider unavailable. Retry when the feed recovers.');
        const data = parseCandles(result.data);
        if (cancelled) return;
        if (controller.signal.aborted) throw new Error('History request timed out');
        const meta: HistoryMeta = {
          provider: result.source === 'tiingo' || result.source === 'twelvedata' || result.source === 'yahoo' || result.source === 'demo' ? result.source : null,
          providerSymbol: typeof result.providerSymbol === 'string' ? result.providerSymbol : null,
          instrumentKind: result.instrumentKind === 'spot' || result.instrumentKind === 'futures' || result.instrumentKind === 'reference' ? result.instrumentKind : 'unknown',
        };
        // Success only: an aborted/failed request NEVER poisons this cache, including StrictMode replay.
        loaded.current.set(key, { time: Date.now(), meta });
        setChartData(prev => {
          const oldMeta = cached?.meta;
          const sameInstrument = !oldMeta || (oldMeta.instrumentKind === meta.instrumentKind && oldMeta.provider === meta.provider && oldMeta.providerSymbol === meta.providerSymbol);
          let merged = reconcileHistory(data, sameInstrument ? prev[selectedSymbol]?.[selectedTimeframe] ?? [] : [], typeof result.fetchedAt === 'number' && Number.isFinite(result.fetchedAt) && result.fetchedAt > 0 ? Math.min(requestStartedAt, result.fetchedAt) : requestStartedAt);
          const quote = store?.get(selectedSymbol);
          if (quote && quote.instrumentKind === meta.instrumentKind && quote.provider === meta.provider && quote.providerSymbol === meta.providerSymbol) merged = applyQuoteToCandles(merged, quote, selectedTimeframe);
          return { ...prev, [selectedSymbol]: { ...prev[selectedSymbol], [selectedTimeframe]: merged } };
        });
        setStates(prev => ({ ...prev, [key]: { status: 'ready', error: null, meta } }));
      } catch (error) {
        if (!cancelled) setStates(prev => ({ ...prev, [key]: { status: 'error', error: controller.signal.aborted ? 'History request timed out. Retry.' : error instanceof Error ? error.message : 'History request failed.', meta: prev[key]?.meta ?? null } }));
      } finally { clearTimeout(timer); }
    })();
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [key, selectedSymbol, selectedTimeframe, attempt, store]);

  useEffect(() => {
    const refresh = setInterval(() => { if (!document.hidden) retryHistory(); }, 60_000);
    return () => clearInterval(refresh);
  }, [retryHistory]);
  useEffect(() => store?.subscribe(({ changed }) => {
    const quote = changed.find(q => q.symbol === selectedSymbol);
    const meta = loaded.current.get(key)?.meta;
    if (!quote || quote.instrumentKind !== meta?.instrumentKind || quote.provider !== meta.provider || quote.providerSymbol !== meta.providerSymbol) return;
    setChartData(prev => {
      const old = prev[selectedSymbol]?.[selectedTimeframe] ?? [];
      const next = applyQuoteToCandles(old, quote, selectedTimeframe);
      return next === old ? prev : { ...prev, [selectedSymbol]: { ...prev[selectedSymbol], [selectedTimeframe]: next } };
    });
  }), [store, key, selectedSymbol, selectedTimeframe]);
  const active = states[key];
  return { chartData, setChartData, activeData, historyStatus: active?.status ?? 'loading', historyError: active?.error ?? null,
    historyMeta: active?.meta ?? null, retryHistory };
}
