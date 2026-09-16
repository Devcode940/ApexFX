import { useState, useEffect, useMemo, useRef } from 'react';
import { Candlestick, Timeframe } from '../types';

export function useChartHistory(selectedSymbol: string, selectedTimeframe: Timeframe) {
  const [chartData, setChartData] = useState<Record<string, Record<string, Candlestick[]>>>({});
  // Track fetched pairs so we don't refire the effect due to chartData changes
  const loadedKey = useRef<string>('');

  const activeData = useMemo(() => {
    if (!chartData[selectedSymbol]?.[selectedTimeframe]) {
      return [];
    }
    return chartData[selectedSymbol][selectedTimeframe];
  }, [chartData, selectedSymbol, selectedTimeframe]);

  useEffect(() => {
    const key = `${selectedSymbol}_${selectedTimeframe}`;
    if (loadedKey.current === key) return;
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
        loadedKey.current = key;
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
          loadedKey.current = key;
        }
      }
    }

    // Load if we don't already have non-empty data for this key
    const existing = chartData[selectedSymbol]?.[selectedTimeframe];
    if (!existing || existing.length === 0) {
      fetchHistory();
    } else {
      loadedKey.current = key;
    }

    return () => {
      active = false;
    };
  }, [selectedSymbol, selectedTimeframe]);

  return { chartData, setChartData, activeData };
}
