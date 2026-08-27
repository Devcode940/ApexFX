import { useState, useEffect, useMemo } from 'react';
import { Candlestick, Timeframe } from '../types';

export function useChartHistory(selectedSymbol: string, selectedTimeframe: Timeframe) {
  const [chartData, setChartData] = useState<Record<string, Record<string, Candlestick[]>>>({});

  const activeData = useMemo(() => {
    if (!chartData[selectedSymbol]?.[selectedTimeframe]) {
      return [];
    }
    return chartData[selectedSymbol][selectedTimeframe];
  }, [chartData, selectedSymbol, selectedTimeframe]);

  useEffect(() => {
    let active = true;
    async function fetchHistory() {
      try {
        const response = await fetch(`/api/market/history?symbol=${selectedSymbol}&timeframe=${selectedTimeframe}`);
        const result = await response.json();
        if (active) {
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

    if (!chartData[selectedSymbol]?.[selectedTimeframe]) {
      fetchHistory();
    }

    return () => {
      active = false;
    };
  }, [selectedSymbol, selectedTimeframe, chartData]);

  return { chartData, setChartData, activeData };
}
