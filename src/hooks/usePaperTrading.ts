import { useState, useEffect, useCallback, useRef } from 'react';
import { createLeadingThrottle } from '../utils/throttle';
import { TradePosition, ClosedTrade, WatchlistItem } from '../types';
import { buildClosedTrade, markToMarket, validateOrder, makeId, MAX_LOTS, type OrderRejectionReason } from '../utils/paperTrading';

// A discriminated union. This was an `interface { ok: boolean; id?; reason? }` for one reason only:
// with `strictNullChecks: false` the compiler rejects narrowing a union (`result.reason` after
// `if (!result.ok)`), so the loose shape was the workaround. Now that `strict` is on, the honest
// shape compiles and a success can no longer carry a reason - or a failure an id.
export type OpenPositionResult =
  | { ok: true; id: string }
  | { ok: false; reason: OrderRejectionReason };

export interface UsePaperTradingApi {
  positions: TradePosition[];
  setPositions: React.Dispatch<React.SetStateAction<TradePosition[]>>;
  closedTrades: ClosedTrade[];
  setClosedTrades: React.Dispatch<React.SetStateAction<ClosedTrade[]>>;
  /** Returns a result so the caller can explain a rejection instead of silently no-oping. */
  handleOpenPosition: (type: 'BUY' | 'SELL', amount: number, sl?: number, tp?: number) => OpenPositionResult;
  handleClosePosition: (id: string) => void;
  handleClearHistory: () => void;
}

/**
 * Paper-trading state. Rules that move money live in `utils/paperTrading` (pure, unit-tested);
 * this hook owns state and persistence only.
 *
 * Fixed here in the 2026-09-13 pass:
 *  - S3.1 `handleClosePosition` called `setClosedTrades` *inside* the `setPositions` updater.
 *    Updaters must be pure; React 19 + StrictMode double-invokes them in development, so every
 *    manual close appended TWO closed trades — skewing win rate / profit factor and duplicating
 *    rows sent to Supabase and CSV export.
 *  - S3.2 positions could be opened at `currentPrice === 0` (cold feed), producing entries of
 *    0.00 and P&L around +$108k per EUR/USD lot.
 *  - ids were `Date.now() + 4 random chars` (collisions across users on a shared PRIMARY KEY,
 *    and unstable React keys under double invocation).
 */
export function usePaperTrading(
  watchlistItems: WatchlistItem[],
  selectedSymbol: string,
  currentPrice: number
): UsePaperTradingApi {
  const [positions, setPositions] = useState<TradePosition[]>(() => {
    try {
      const cached = localStorage.getItem('forexinsight_positions');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          // A corrupt/partial row used to crash every downstream reduce over `pnl`; drop what
          // is not shaped like a position instead of poisoning the whole panel.
          return parsed.filter(
            (p: TradePosition) => p && typeof p.id === 'string' && Number.isFinite(p.entryPrice) && Number.isFinite(p.amount)
          );
        }
      }
    } catch {
      /* corrupt cache -> start clean rather than crash the terminal */
    }
    return [];
  });

  const [closedTrades, setClosedTrades] = useState<ClosedTrade[]>(() => {
    try {
      const cached = localStorage.getItem('forexinsight_closed_trades');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      /* ignore */
    }
    return [];
  });

  // Debounced localStorage sync
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem('forexinsight_positions', JSON.stringify(positions));
      } catch {
        /* quota exceeded / private mode */
      }
    }, 300);
    return () => clearTimeout(id);
  }, [positions]);

  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem('forexinsight_closed_trades', JSON.stringify(closedTrades));
      } catch {
        /* ignore */
      }
    }, 300);
    return () => clearTimeout(id);
  }, [closedTrades]);

  // Handlers read through refs so a click never uses a stale price/symbol captured at render.
  const positionsRef = useRef(positions);
  const watchlistRef = useRef(watchlistItems);
  const priceRef = useRef(currentPrice);
  const symbolRef = useRef(selectedSymbol);
  useEffect(() => { positionsRef.current = positions; }, [positions]);
  useEffect(() => { watchlistRef.current = watchlistItems; }, [watchlistItems]);
  useEffect(() => { priceRef.current = currentPrice; }, [currentPrice]);
  useEffect(() => { symbolRef.current = selectedSymbol; }, [selectedSymbol]);

  // --- mark to market + SL/TP execution ---
  // Coalesced through a leading-edge throttle: a burst of feed updates re-derives the book once, and
  // the LAST update in the burst still gets applied (that trailing run is the whole point - a plain
  // dropping throttle would silently leave the newest price unprocessed, which for stops is the one
  // tick that matters). The window is anchored to the leading run so a sustained burst cannot postpone
  // execution indefinitely.
  // Reading through refs (not the render's arrays) is what makes deferring safe: the work always runs
  // against the newest positions and prices, whenever it happens to fire.
  const recompute = useCallback(() => {
    const result = markToMarket(positionsRef.current, watchlistRef.current);
    if (!result.changed) return;
    // Both setters called from here, each exactly once - never from inside an updater (see S3.1).
    setPositions(result.positions);
    if (result.closed.length > 0) setClosedTrades((prev) => [...result.closed, ...prev]);
  }, []);
  const markThrottle = useRef(createLeadingThrottle(() => recompute(), 500));
  useEffect(() => {
    // Captured locally on purpose: by cleanup time the ref may already point at another throttle.
    const throttle = markThrottle.current;
    throttle.schedule();
    return () => throttle.cancel();
  }, [watchlistItems, positions]);

  const handleOpenPosition = useCallback<UsePaperTradingApi['handleOpenPosition']>(
    (type, amount, sl, tp) => {
      const price = priceRef.current;
      // maxLots is enforced HERE, not only in the panel: this is the function that mutates the book,
      // so any future caller (keyboard shortcut, Supabase pull replay, test harness) inherits the ceiling.
      const valid = validateOrder({ type, price, amount, sl, tp, maxLots: MAX_LOTS });
      if (!valid.ok) return { ok: false, reason: valid.reason };

      const nowMs = Date.now();
      const newPos: TradePosition = {
        id: makeId('pos'),
        symbol: symbolRef.current,
        type,
        entryPrice: price,
        currentPrice: price,
        amount,
        sl,
        tp,
        pnl: 0,
        time: new Date(nowMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        openedAt: nowMs,
      };
      setPositions((prev) => [newPos, ...prev]);
      return { ok: true, id: newPos.id };
    },
    []
  );

  const handleClosePosition = useCallback((id: string) => {
    const target = positionsRef.current.find((p) => p.id === id);
    if (!target) return;

    const priceItem = watchlistRef.current.find((item) => item.symbol === target.symbol);
    // Never mark a manual close at a 0 price; fall back to the last marked price, then the
    // context price.
    const livePrice =
      priceItem && Number.isFinite(priceItem.price) && priceItem.price > 0
        ? priceItem.price
        : target.currentPrice > 0
          ? target.currentPrice
          : priceRef.current;

    const record = buildClosedTrade({ position: target, exitPrice: livePrice });

    setPositions((prev) => prev.filter((p) => p.id !== id));
    setClosedTrades((prev) => [record, ...prev]);
  }, []);

  const handleClearHistory = useCallback(() => setClosedTrades([]), []);

  return {
    positions,
    setPositions,
    closedTrades,
    setClosedTrades,
    handleOpenPosition,
    handleClosePosition,
    handleClearHistory,
  };
}
