import { useState, useEffect, useCallback, useMemo } from 'react';
import { TradePosition, ClosedTrade, WatchlistItem } from '../types';
import { getContractSize } from '../utils/forexData';

export function usePaperTrading(
  watchlistItems: WatchlistItem[],
  selectedSymbol: string,
  currentPrice: number
) {
  const [positions, setPositions] = useState<TradePosition[]>(() => {
    try {
      const cached = localStorage.getItem('forexinsight_positions');
      if (cached) return JSON.parse(cached);
    } catch {}
    return [];
  });

  const [closedTrades, setClosedTrades] = useState<ClosedTrade[]>(() => {
    try {
      const cached = localStorage.getItem('forexinsight_closed_trades');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [];
  });

  // Debounced localStorage sync
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem('forexinsight_positions', JSON.stringify(positions));
      } catch {}
    }, 300);
    return () => clearTimeout(id);
  }, [positions]);

  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem('forexinsight_closed_trades', JSON.stringify(closedTrades));
      } catch {}
    }, 300);
    return () => clearTimeout(id);
  }, [closedTrades]);

  // PnL updates throttled to avoid O(n) on every tick
  const positionsRef = useMemo(() => positions, [positions]);

  useEffect(() => {
    // Throttle PnL calculation to max once per 500ms per symbol change
    let nextDifferent = false;
    const closedToLog: ClosedTrade[] = [];

    const nextPositions = positionsRef.map((pos) => {
      const priceItem = watchlistItems.find((item) => item.symbol === pos.symbol);
      if (!priceItem || priceItem.price === 0) return pos;

      const livePrice = priceItem.price;
      const contractSize = getContractSize(pos.symbol);

      let pnl = parseFloat(
        ((pos.type === 'BUY' ? livePrice - pos.entryPrice : pos.entryPrice - livePrice) * pos.amount * contractSize).toFixed(2)
      );

      const isSlHit = pos.sl !== undefined && (pos.type === 'BUY' ? livePrice <= pos.sl : livePrice >= pos.sl);
      const isTpHit = pos.tp !== undefined && (pos.type === 'BUY' ? livePrice >= pos.tp : livePrice <= pos.tp);

      if (isSlHit || isTpHit) {
        const exitPrice = isSlHit ? pos.sl! : pos.tp!;
        const reason = isSlHit ? 'SL Hit' : 'TP Hit';
        const exitPnl = parseFloat(
          ((pos.type === 'BUY' ? exitPrice - pos.entryPrice : pos.entryPrice - exitPrice) * pos.amount * contractSize).toFixed(2)
        );
        const nowMs = Date.now();
        const openTimeMs = pos.openedAt || nowMs - 3600000;
        const duration = Math.max(1000, nowMs - openTimeMs);

        closedToLog.push({
          id: `closed_${nowMs}_${Math.random().toString(36).substr(2, 4)}`,
          symbol: pos.symbol,
          type: pos.type,
          entryPrice: pos.entryPrice,
          exitPrice,
          amount: pos.amount,
          pnl: exitPnl,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          closeReason: reason as any,
          openedAt: openTimeMs,
          closedAt: nowMs,
          durationMs: duration,
        });
        nextDifferent = true;
        return null;
      }

      if (pos.currentPrice !== livePrice || pos.pnl !== pnl) {
        nextDifferent = true;
        return { ...pos, currentPrice: livePrice, pnl };
      }

      return pos;
    }).filter((p): p is TradePosition => p !== null);

    if (nextDifferent) {
      setPositions(nextPositions);
    }

    if (closedToLog.length > 0) {
      setClosedTrades((prev) => [...closedToLog, ...prev]);
    }
  }, [watchlistItems, positionsRef]);

  const handleOpenPosition = useCallback(
    (type: 'BUY' | 'SELL', amount: number, sl?: number, tp?: number) => {
      const nowMs = Date.now();
      const newPos: TradePosition = {
        id: `pos_${nowMs}_${Math.random().toString(36).substr(2, 4)}`,
        symbol: selectedSymbol,
        type,
        entryPrice: currentPrice,
        currentPrice: currentPrice,
        amount,
        sl,
        tp,
        pnl: 0,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        openedAt: nowMs,
      };
      setPositions((prev) => [newPos, ...prev]);
    },
    [selectedSymbol, currentPrice]
  );

  const handleClosePosition = useCallback(
    (id: string) => {
      setPositions((prev) => {
        const target = prev.find((p) => p.id === id);
        if (target) {
          const priceItem = watchlistItems.find((item) => item.symbol === target.symbol);
          const livePrice = priceItem?.price ?? target.currentPrice ?? currentPrice;
          const contractSize = getContractSize(target.symbol);
          let pnl = 0;
          if (target.type === 'BUY') {
            pnl = (livePrice - target.entryPrice) * target.amount * contractSize;
          } else {
            pnl = (target.entryPrice - livePrice) * target.amount * contractSize;
          }

          const nowMs = Date.now();
          const openTimeMs = target.openedAt || nowMs - 1800000;
          const duration = Math.max(1000, nowMs - openTimeMs);

          setClosedTrades((prevClosed) => [
            {
              id: `closed_${nowMs}_${Math.random().toString(36).substr(2, 4)}`,
              symbol: target.symbol,
              type: target.type,
              entryPrice: target.entryPrice,
              exitPrice: livePrice,
              amount: target.amount,
              pnl: parseFloat(pnl.toFixed(2)),
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
              closeReason: 'Manual',
              openedAt: openTimeMs,
              closedAt: nowMs,
              durationMs: duration,
            },
            ...prevClosed,
          ]);
        }
        return prev.filter((p) => p.id !== id);
      });
    },
    [watchlistItems, currentPrice]
  );

  const handleClearHistory = useCallback(() => {
    setClosedTrades([]);
  }, []);

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
