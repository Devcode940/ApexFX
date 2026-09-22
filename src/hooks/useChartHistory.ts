import { useState, useEffect, useMemo, useRef } from 'react';
import { Candlestick, Timeframe } from '../types';

export function useChartHistory(selectedSymbol: string, selectedTimeframe: Timeframe) {
  const [chartData, setChartData] = useState<Record<string, Record<string, Candlestick[]>>>({});
  // Every symbol/timeframe attempted, not just the most recent one: a single "last key" ref made
  // EUR/USD -> GBP/USD -> EUR/USD re-fetch data already in state, and it forced chartData out of the
  // dep array (a stale-closure smell the react-hooks rule rightly flags). A Set lets chartData be a
  // dependency without the error path re-firing forever.
  const loadedKeys = useRef<Set<string>>(new Set());

  const activeData = useMemo(() => {
    if (!chartData[selectedSymbol]?.[selectedTimeframe]) {
      return [];
    }
    return chartData[selectedSymbol][selectedTimeframe];
  }, [chartData, selectedSymbol, selectedTimeframe]);

  useEffect(() => {
    const key = `${selectedSymbol}_${selectedTimeframe}`;
    if (loadedKeys.current.has(key)) return;
    loadedKeys.current.add(key); // before any await: an attempt in flight must not re-enter
    let active = true;
    async function fetchHistory() {
      try {
        const response = await fetch(`/api/market/history?symbol=${selectedSymbol}&timeframe=${selectedTimeframe}`);
        const result = await response.json();
        if (!active) return;
        if (result.success && Array.isArray(result.data) && result.data.length > 0) {
          setChartData((prev) => ({
            ...prev,
            [selectedSymbol]: {
              ...(prev[selectedSymbol] || {}),
              [selectedTimeframe]: result.data,
            },
          }));
        } else {
          console.warn('Real history failed or empty.');
          setChartData((prev) => ({
            ...prev,
            [selectedSymbol]: {
              ...(prev[selectedSymbol] || {}),
              [selectedTimeframe]: [],
            },
          }));
        }
      } catch (err) {
        console.error('Failed to fetch historical data:', err);
        if (active) {
          setChartData((prev) => ({
            ...prev,
            [selectedSymbol]: {
              ...(prev[selectedSymbol] || {}),
              [selectedTimeframe]: [],
            },
          }));
        }
      }
    }

    // Load if we don't already have non-empty data for this key
    // Only reached once per key (the Set guard above is the authority on "already attempted"), so this is
    // a "do we already have data from an earlier mount" check and not a race.
    const existing = chartData[selectedSymbol]?.[selectedTimeframe];
    if (!existing || existing.length === 0) {
      fetchHistory();
    }

    return () => {
      active = false;
    };
  }, [selectedSymbol, selectedTimeframe, chartData]);

  return { chartData, setChartData, activeData };
}
