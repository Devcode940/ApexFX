import React, { useEffect, useRef, useState } from 'react';
import { 
  createChart, 
  IChartApi, 
  ISeriesApi, 
  CandlestickSeries, 
  LineSeries, 
  HistogramSeries, 
  ColorType,
  createSeriesMarkers,
  Time
} from 'lightweight-charts';
import { Candlestick, TechnicalIndicatorsState, Pattern, Timeframe } from '../types';
import {
  computeSMA,
  computeEMA,
  computeBollingerBands,
  computeMACD,
  computeRSI,
  computeFibonacci,
  PAIRS_CONFIG
} from '../utils/forexData';
import { 
  MousePointer, 
  TrendingUp, 
  Minus, 
  Type, 
  Trash2, 
  Maximize2, 
  Minimize2, 
  Plus, 
  AlertCircle,
  Expand,
  RefreshCw,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
  AlignJustify,
  Camera
} from 'lucide-react';

import { useTrading } from '../context/TradingContext';

interface TradingChartProps {}

export const TradingChart: React.FC<TradingChartProps> = () => {
  const {
    selectedSymbol: symbol,
    selectedTimeframe: timeframe,
    activeData: data,
    indicators,
    activePatterns: patterns,
    highlightedPattern,
    handleChartSnapshot: onSnapshot,
    theme,
  } = useTrading();

  // Compute consecutive candlestick price streak
  const priceStreak = React.useMemo(() => {
    if (!data || data.length === 0) return { count: 0, type: 'neutral' as const };
    let count = 0;
    let type: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    for (let i = data.length - 1; i >= 0; i--) {
      const candle = data[i];
      const isBullish = candle.close > candle.open;
      const isBearish = candle.close < candle.open;
      if (i === data.length - 1) {
        if (isBullish) {
          type = 'bullish';
          count = 1;
        } else if (isBearish) {
          type = 'bearish';
          count = 1;
        } else {
          break;
        }
      } else {
        if (type === 'bullish' && isBullish) {
          count++;
        } else if (type === 'bearish' && isBearish) {
          count++;
        } else {
          break;
        }
      }
    }
    return { count, type };
  }, [data]);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  // Sub-indicator refs
  const rsiContainerRef = useRef<HTMLDivElement>(null);
  const rsiChartRef = useRef<IChartApi | null>(null);

  const macdContainerRef = useRef<HTMLDivElement>(null);
  const macdChartRef = useRef<IChartApi | null>(null);

  // Expanded View State
  const [isExpandedFullScreen, setIsExpandedFullScreen] = useState<boolean>(false);

  // Custom drawing tools state
  const [drawings, setDrawings] = useState<{
    horizontalLines: (number | { price: number; color?: string })[];
    trendlines: { start: { time: number; price: number }; end: { time: number; price: number }; color?: string }[];
    annotations: { time: number; price: number; text: string; color?: string }[];
    riskRewards: { id: string; type: 'long' | 'short'; entry: { time: number; price: number }; tp: number; sl: number }[];
    fibonacci: { id: string; start: { time: number; price: number }; end: { time: number; price: number }; color?: string }[];
  }>(() => {
    try {
      const cached = localStorage.getItem(`forexinsight_drawings_${symbol}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        return {
          horizontalLines: parsed.horizontalLines || [],
          trendlines: parsed.trendlines || [],
          annotations: parsed.annotations || [],
          riskRewards: parsed.riskRewards || [],
          fibonacci: parsed.fibonacci || [],
        };
      }
    } catch { }
    return { horizontalLines: [], trendlines: [], annotations: [], riskRewards: [], fibonacci: [] };
  });

  const [activeTool, setActiveTool] = useState<'none' | 'horizontal' | 'trendline_start' | 'trendline_end' | 'annotation' | 'rr_long' | 'rr_short' | 'fib_start' | 'fib_end'>('none');
  const [fibStart, setFibStart] = useState<{ time: number; price: number } | null>(null);
  const [trendlineStart, setTrendlineStart] = useState<{ time: number; price: number } | null>(null);
  
  // Custom Color Selection & Drawings Manager Toggle
  const [selectedColor, setSelectedColor] = useState<string>('#eab308'); // default Gold/Yellow
  const [showDrawingsManager, setShowDrawingsManager] = useState<boolean>(false);

  const handleTakeSnapshot = () => {
    if (!chartRef.current) return;
    try {
      const canvas = chartRef.current.takeScreenshot();
      if (canvas) {
        const dataUrl = canvas.toDataURL('image/png');
        if (onSnapshot) {
          onSnapshot(dataUrl);
        }
      }
    } catch (err) {
      console.warn('Error taking chart screenshot:', err);
    }
  };

  // HUD crosshair state
  const [hudData, setHudData] = useState<{
    open: number;
    high: number;
    low: number;
    close: number;
    date: string;
    sma?: number;
    ema?: number;
    rsi?: number;
    bbUpper?: number;
    bbLower?: number;
  } | null>(null);

  // Determine responsive height based on viewport and indicators
  const chartHeight = isExpandedFullScreen 
    ? Math.max(380, window.innerHeight - (indicators.rsi ? 120 : 0) - (indicators.macd ? 120 : 0) - 160) 
    : 380;

  // Refs for tracking drawing states inside persistent lightweight-charts click subscriptions
  const activeToolRef = useRef(activeTool);
  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  const trendlineStartRef = useRef(trendlineStart);
  useEffect(() => {
    trendlineStartRef.current = trendlineStart;
  }, [trendlineStart]);

  const fibStartRef = useRef(fibStart);
  useEffect(() => {
    fibStartRef.current = fibStart;
  }, [fibStart]);

  const selectedColorRef = useRef(selectedColor);
  useEffect(() => {
    selectedColorRef.current = selectedColor;
  }, [selectedColor]);

  // Load drawings when symbol shifts
  useEffect(() => {
    try {
      const cached = localStorage.getItem(`forexinsight_drawings_${symbol}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        setDrawings({
          horizontalLines: parsed.horizontalLines || [],
          trendlines: parsed.trendlines || [],
          annotations: parsed.annotations || [],
          riskRewards: parsed.riskRewards || [],
          fibonacci: parsed.fibonacci || [],
        });
      } else {
        setDrawings({ horizontalLines: [], trendlines: [], annotations: [], riskRewards: [], fibonacci: [] });
      }
    } catch {
      setDrawings({ horizontalLines: [], trendlines: [], annotations: [], riskRewards: [], fibonacci: [] });
    }
    setActiveTool('none');
    setTrendlineStart(null);
  }, [symbol]);

  // Sync to local storage
  useEffect(() => {
    localStorage.setItem(`forexinsight_drawings_${symbol}`, JSON.stringify(drawings));
  }, [drawings, symbol]);

  const handleClearDrawings = () => {
    if (confirm("Clear all custom drawings from this chart?")) {
      setDrawings({ horizontalLines: [], trendlines: [], annotations: [], riskRewards: [], fibonacci: [] });
    }
  };

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

    // Reset previous chart instances
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }
    if (rsiChartRef.current) {
      rsiChartRef.current.remove();
      rsiChartRef.current = null;
    }
    if (macdChartRef.current) {
      macdChartRef.current.remove();
      macdChartRef.current = null;
    }

    const config = PAIRS_CONFIG[symbol] || { pipDecimal: 4 };

    // --- Main Chart ---
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: chartHeight,
      layout: {
        background: { type: ColorType.Solid, color: theme === 'dark' ? '#09090b' : '#ffffff' },
        textColor: theme === 'dark' ? '#a1a1aa' : '#52525b',
      },
      grid: {
        vertLines: { color: theme === 'dark' ? '#18181b' : '#f4f4f5' },
        horzLines: { color: theme === 'dark' ? '#18181b' : '#f4f4f5' },
      },
      rightPriceScale: {
        borderColor: theme === 'dark' ? '#27272a' : '#e4e4e7',
        autoScale: true,
      },
      timeScale: {
        borderColor: theme === 'dark' ? '#27272a' : '#e4e4e7',
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        horzLine: {
          labelBackgroundColor: theme === 'dark' ? '#27272a' : '#18181b',
        },
        vertLine: {
          labelBackgroundColor: theme === 'dark' ? '#27272a' : '#18181b',
        }
      }
    });
    chartRef.current = chart;

    // Candlesticks (using v5 generic addSeries method)
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      priceFormat: {
        type: 'price',
        precision: config.pipDecimal + 1,
        minMove: 1 / Math.pow(10, config.pipDecimal + 1),
      }
    });

    const chartData = data.map(item => ({
      time: item.time as any,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
    }));
    candleSeries.setData(chartData);

    // --- SMA Indicator ---
    let smaSeries: ISeriesApi<'Line'> | null = null;
    if (indicators.sma) {
      smaSeries = chart.addSeries(LineSeries, {
        color: '#3b82f6',
        lineWidth: 2,
        title: 'SMA (20)',
        priceLineVisible: false,
      });
      const smaData = computeSMA(data, 20);
      const values = data.map((item, idx) => ({
        time: item.time as any,
        value: smaData[idx] as number,
      })).filter(item => item.value !== null);
      if (values.length > 0) smaSeries.setData(values);
    }

    // --- EMA Indicator ---
    let emaSeries: ISeriesApi<'Line'> | null = null;
    if (indicators.ema) {
      emaSeries = chart.addSeries(LineSeries, {
        color: '#eab308',
        lineWidth: 2,
        title: 'EMA (50)',
        priceLineVisible: false,
      });
      const emaData = computeEMA(data, 50);
      const values = data.map((item, idx) => ({
        time: item.time as any,
        value: emaData[idx] as number,
      })).filter(item => item.value !== null);
      if (values.length > 0) emaSeries.setData(values);
    }

    // --- Bollinger Bands ---
    let bbUpperSeries: ISeriesApi<'Line'> | null = null;
    let bbLowerSeries: ISeriesApi<'Line'> | null = null;
    let bbBasisSeries: ISeriesApi<'Line'> | null = null;

    if (indicators.bollinger) {
      const bbData = computeBollingerBands(data, 20, 2);

      bbUpperSeries = chart.addSeries(LineSeries, {
        color: 'rgba(168, 85, 247, 0.65)',
        lineWidth: 1,
        lineStyle: 2, // dashed
        title: 'BB Upper',
        priceLineVisible: false,
      });
      const upperVals = data.map((item, idx) => ({
        time: item.time as any,
        value: bbData.upper[idx] as number,
      })).filter(item => item.value !== null);
      bbUpperSeries.setData(upperVals);

      bbLowerSeries = chart.addSeries(LineSeries, {
        color: 'rgba(168, 85, 247, 0.65)',
        lineWidth: 1,
        lineStyle: 2,
        title: 'BB Lower',
        priceLineVisible: false,
      });
      const lowerVals = data.map((item, idx) => ({
        time: item.time as any,
        value: bbData.lower[idx] as number,
      })).filter(item => item.value !== null);
      bbLowerSeries.setData(lowerVals);

      bbBasisSeries = chart.addSeries(LineSeries, {
        color: 'rgba(168, 85, 247, 0.3)',
        lineWidth: 1,
        title: 'BB Basis',
        priceLineVisible: false,
      });
      const basisVals = data.map((item, idx) => ({
        time: item.time as any,
        value: bbData.basis[idx] as number,
      })).filter(item => item.value !== null);
      bbBasisSeries.setData(basisVals);
    }

    // --- Fibonacci Retracement ---
    const fibLines: any[] = [];
    if (indicators.fibonacci) {
      const fib = computeFibonacci(data);
      if (fib) {
        const colors = {
          anchor: '#f43f5e', // rose-500
          r236: '#fda4af',
          r382: '#f0abfc',
          r500: '#c084fc',
          r618: '#818cf8',
        };

        const drawFibLine = (price: number, label: string, color: string) => {
          const priceLine = candleSeries.createPriceLine({
            price,
            color,
            lineWidth: 1,
            lineStyle: 1, // dotted
            axisLabelVisible: true,
            title: label,
          });
          fibLines.push(priceLine);
        };

        drawFibLine(fib.high, `Fib 0% / 100% (High: ${fib.high.toFixed(config.pipDecimal + 1)})`, colors.anchor);
        drawFibLine(fib.r236, `Fib 23.6% (${fib.r236.toFixed(config.pipDecimal + 1)})`, colors.r236);
        drawFibLine(fib.r382, `Fib 38.2% (${fib.r382.toFixed(config.pipDecimal + 1)})`, colors.r382);
        drawFibLine(fib.r500, `Fib 50.0% (${fib.r500.toFixed(config.pipDecimal + 1)})`, colors.r500);
        drawFibLine(fib.r618, `Fib 61.8% (${fib.r618.toFixed(config.pipDecimal + 1)})`, colors.r618);
        drawFibLine(fib.low, `Fib 100% / 0% (Low: ${fib.low.toFixed(config.pipDecimal + 1)})`, colors.anchor);
      }
    }

    // --- Draw Active Custom Drawings ---
    const activePriceLines: any[] = [];
    drawings.horizontalLines.forEach((item) => {
      const price = typeof item === 'number' ? item : item.price;
      const color = typeof item === 'object' && item.color ? item.color : '#22c55e';
      const line = candleSeries.createPriceLine({
        price,
        color,
        lineWidth: 2,
        lineStyle: 1, // dotted
        title: 'SUPPORT/RESISTANCE',
        axisLabelVisible: true,
      });
      activePriceLines.push(line);
    });

    const activeTrendlineSeries: ISeriesApi<'Line'>[] = [];
    drawings.trendlines.forEach((tl, index) => {
      const color = tl.color || '#eab308';
      // Sort start/end chronologically as lightweight-charts requires strictly ascending time values
      const sortedPoints = [tl.start, tl.end].sort((a, b) => a.time - b.time);
      const tlSeries = chart.addSeries(LineSeries, {
        color,
        lineWidth: 2,
        priceLineVisible: false,
        title: `Trendline ${index + 1}`,
      });
      tlSeries.setData([
        { time: sortedPoints[0].time as any, value: sortedPoints[0].price },
        { time: sortedPoints[1].time as any, value: sortedPoints[1].price },
      ]);
      activeTrendlineSeries.push(tlSeries);
    });

    // --- Markers for Pattern Highlighting + Annotations + Active Trendline Start feedback ---
    const markers = [
      ...patterns.map(p => {
        const isHighlighted = highlightedPattern && highlightedPattern.id === p.id;
        return {
          time: p.time as any,
          position: (p.type === 'bullish' ? 'belowBar' : p.type === 'bearish' ? 'aboveBar' : 'inBar') as any,
          color: p.type === 'bullish' ? '#22c55e' : p.type === 'bearish' ? '#ef4444' : '#a1a1aa',
          shape: (p.type === 'bullish' ? 'arrowUp' : p.type === 'bearish' ? 'arrowDown' : 'circle') as any,
          text: p.name,
          size: isHighlighted ? 2.5 : 1.2,
        };
      }),
      ...drawings.annotations.map(ann => ({
        time: ann.time as any,
        position: 'aboveBar' as any,
        color: ann.color || '#a855f7', // purple-500
        shape: 'pin' as any,
        text: ann.text,
        size: 1.5,
      })),
      ...(trendlineStart ? [{
        time: trendlineStart.time as any,
        position: 'inBar' as any,
        color: selectedColorRef.current,
        shape: 'circle' as any,
        text: 'TL START 🔍',
        size: 1.2,
      }] : [])
    ];

    // Write all combined markers to chart series
    createSeriesMarkers(candleSeries, markers);

    // --- RSI Sub-chart ---
    let rsiChart: IChartApi | null = null;
    if (indicators.rsi && rsiContainerRef.current) {
      rsiChart = createChart(rsiContainerRef.current, {
        width: rsiContainerRef.current.clientWidth,
        height: isExpandedFullScreen ? 110 : 100,
        layout: {
          background: { type: ColorType.Solid, color: theme === 'dark' ? '#09090b' : '#ffffff' },
          textColor: theme === 'dark' ? '#a1a1aa' : '#52525b',
        },
        grid: {
          vertLines: { color: theme === 'dark' ? '#18181b' : '#f4f4f5' },
          horzLines: { color: theme === 'dark' ? '#18181b' : '#f4f4f5' },
        },
        rightPriceScale: {
          borderColor: theme === 'dark' ? '#27272a' : '#e4e4e7',
          autoScale: false,
          scaleMargins: { top: 0.1, bottom: 0.1 },
        },
        timeScale: {
          visible: false, // hidden since linked to main
        },
        crosshair: {
          horzLine: { labelBackgroundColor: theme === 'dark' ? '#27272a' : '#18181b' },
          vertLine: { labelBackgroundColor: theme === 'dark' ? '#27272a' : '#18181b' }
        }
      });
      rsiChartRef.current = rsiChart;

      const rsiSeries = rsiChart.addSeries(LineSeries, {
        color: '#f43f5e',
        lineWidth: 2,
        title: 'RSI (14)',
        priceLineVisible: false,
      });

      // Horizontal oversold (30) / overbought (70) lines
      rsiSeries.createPriceLine({
        price: 70,
        color: 'rgba(239, 68, 68, 0.4)',
        lineWidth: 1,
        lineStyle: 2,
        title: 'Overbought (70)',
        axisLabelVisible: true,
      });
      rsiSeries.createPriceLine({
        price: 30,
        color: 'rgba(34, 197, 94, 0.4)',
        lineWidth: 1,
        lineStyle: 2,
        title: 'Oversold (30)',
        axisLabelVisible: true,
      });

      const rsiData = computeRSI(data, 14);
      const rsiVals = data.map((item, idx) => ({
        time: item.time as any,
        value: rsiData[idx] as number,
      })).filter(item => item.value !== null);
      rsiSeries.setData(rsiVals);
    }

    // --- MACD Sub-chart ---
    let macdChart: IChartApi | null = null;
    if (indicators.macd && macdContainerRef.current) {
      macdChart = createChart(macdContainerRef.current, {
        width: macdContainerRef.current.clientWidth,
        height: isExpandedFullScreen ? 110 : 100,
        layout: {
          background: { type: ColorType.Solid, color: theme === 'dark' ? '#09090b' : '#ffffff' },
          textColor: theme === 'dark' ? '#a1a1aa' : '#52525b',
        },
        grid: {
          vertLines: { color: theme === 'dark' ? '#18181b' : '#f4f4f5' },
          horzLines: { color: theme === 'dark' ? '#18181b' : '#f4f4f5' },
        },
        rightPriceScale: {
          borderColor: theme === 'dark' ? '#27272a' : '#e4e4e7',
        },
        timeScale: {
          visible: false, // hidden since linked
        },
        crosshair: {
          horzLine: { labelBackgroundColor: theme === 'dark' ? '#27272a' : '#18181b' },
          vertLine: { labelBackgroundColor: theme === 'dark' ? '#27272a' : '#18181b' }
        }
      });
      macdChartRef.current = macdChart;

      const macdData = computeMACD(data);

      const mLineSeries = macdChart.addSeries(LineSeries, {
        color: '#3b82f6',
        lineWidth: 2,
        title: 'MACD',
        priceLineVisible: false,
      });
      const mVals = data.map((item, idx) => ({
        time: item.time as any,
        value: macdData.macd[idx] as number,
      })).filter(item => item.value !== null);
      mLineSeries.setData(mVals);

      const sLineSeries = macdChart.addSeries(LineSeries, {
        color: '#eab308',
        lineWidth: 2,
        title: 'Signal',
        priceLineVisible: false,
      });
      const sVals = data.map((item, idx) => ({
        time: item.time as any,
        value: macdData.signal[idx] as number,
      })).filter(item => item.value !== null);
      sLineSeries.setData(sVals);

      const histSeries = macdChart.addSeries(HistogramSeries, {
        priceLineVisible: false,
        title: 'Histogram',
      });
      const histVals = data.map((item, idx) => {
        const val = macdData.histogram[idx];
        return {
          time: item.time as any,
          value: val as number,
          color: val !== null && val >= 0 ? 'rgba(34, 197, 94, 0.45)' : 'rgba(239, 68, 68, 0.45)',
        };
      }).filter(item => item.value !== null);
      histSeries.setData(histVals);
    }

    // --- Synchronize Tooltips and Time Scales ---
    const primaryTimeScale = chart.timeScale();
    const handlers: (() => void)[] = [];

    const syncTimeScale = (targetChart: IChartApi) => {
      const targetTimeScale = targetChart.timeScale();
      
      const handler1 = (range: any) => {
        if (range) targetTimeScale.setVisibleLogicalRange(range);
      };
      const handler2 = (range: any) => {
        if (range) primaryTimeScale.setVisibleLogicalRange(range);
      };

      primaryTimeScale.subscribeVisibleLogicalRangeChange(handler1);
      targetTimeScale.subscribeVisibleLogicalRangeChange(handler2);
      
      handlers.push(() => {
        primaryTimeScale.unsubscribeVisibleLogicalRangeChange(handler1);
        targetTimeScale.unsubscribeVisibleLogicalRangeChange(handler2);
      });
    };

    if (rsiChart) syncTimeScale(rsiChart);
    if (macdChart) syncTimeScale(macdChart);

    // Zoom to last 55 candles initially for tight focal layout
    primaryTimeScale.setVisibleRange({
      from: data[Math.max(0, data.length - 60)].time as any,
      to: data[data.length - 1].time as any
    });

    // Resize Handler Ref
    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.length === 0 || !containerRef.current) return;
      const { width } = entries[0].contentRect;
      chart.resize(width, chartHeight);
      if (rsiChartRef.current && rsiContainerRef.current) {
        rsiChartRef.current.resize(width, isExpandedFullScreen ? 110 : 100);
      }
      if (macdChartRef.current && macdContainerRef.current) {
        macdChartRef.current.resize(width, isExpandedFullScreen ? 110 : 100);
      }
    });

    resizeObserver.observe(containerRef.current);

    // Double-click to auto fit chart timescale
    const handleDblClick = () => {
      chart.timeScale().fitContent();
    };
    const chartContainerEl = containerRef.current;
    if (chartContainerEl) {
      chartContainerEl.addEventListener('dblclick', handleDblClick);
    }

    // Chart click listener to place drawings
    const handleChartClick = (param: any) => {
      if (!param.point || !param.time) return;
      const price = candleSeries.coordinateToPrice(param.point.y);
      if (price === null) return;
      const clickedTime = param.time as number;

      if (activeToolRef.current === 'horizontal') {
        setDrawings(prev => ({
          ...prev,
          horizontalLines: [...prev.horizontalLines, { price: parseFloat(price.toFixed(config.pipDecimal + 1)), color: selectedColorRef.current }]
        }));
        setActiveTool('none');
      } else if (activeToolRef.current === 'trendline_start') {
        setTrendlineStart({ time: clickedTime, price });
        setActiveTool('trendline_end');
      } else if (activeToolRef.current === 'trendline_end' && trendlineStartRef.current) {
        const start = trendlineStartRef.current;
        setDrawings(prev => ({
          ...prev,
          trendlines: [...prev.trendlines, { start, end: { time: clickedTime, price }, color: selectedColorRef.current }]
        }));
        setTrendlineStart(null);
        setActiveTool('none');
      } else if (activeToolRef.current === 'rr_long' || activeToolRef.current === 'rr_short') {
        const isLong = activeToolRef.current === 'rr_long';
        const config = PAIRS_CONFIG[symbol] || { pipDecimal: 4 };
        const pip = Math.pow(10, -config.pipDecimal);
        const slPips = 20;
        const tpPips = 40;
        
        const sl = isLong ? price - (slPips * pip) : price + (slPips * pip);
        const tp = isLong ? price + (tpPips * pip) : price - (tpPips * pip);
        
        setDrawings(prev => ({
          ...prev,
          riskRewards: [
            ...(prev.riskRewards || []),
            {
              id: Date.now().toString(),
              type: isLong ? 'long' : 'short',
              entry: { time: clickedTime, price },
              tp,
              sl
            }
          ]
        }));
        setActiveTool('none');
      } else if (activeToolRef.current === 'fib_start') {
        setFibStart({ time: clickedTime, price });
        setActiveTool('fib_end');
      } else if (activeToolRef.current === 'fib_end' && fibStartRef.current) {
        const start = fibStartRef.current;
        setDrawings(prev => ({
          ...prev,
          fibonacci: [
            ...(prev.fibonacci || []),
            { id: Date.now().toString(), start, end: { time: clickedTime, price }, color: selectedColorRef.current }
          ]
        }));
        setFibStart(null);
        setActiveTool('none');
      } else if (activeToolRef.current === 'annotation') {
        const text = prompt("Enter text for label annotation:");
        if (text && text.trim()) {
          setDrawings(prev => ({
            ...prev,
            annotations: [...prev.annotations, { time: clickedTime, price, text: text.trim(), color: selectedColorRef.current }]
          }));
        }
        setActiveTool('none');
      }
    };

    chart.subscribeClick(handleChartClick);

    // Crosshair move listener for HUD
    const handleCrosshairMove = (param: any) => {
      // update rr overlays on crosshair move as a hacky way to sync on price update too
      updateCustomOverlays();
      
      if (
        param.point === undefined ||
        !param.time ||
        param.point.x < 0 ||
        param.point.x > (chartContainerEl?.clientWidth || 0) ||
        param.point.y < 0 ||
        param.point.y > (chartContainerEl?.clientHeight || 0)
      ) {
        setHudData(null);
      } else {
        const dataPoint = param.seriesData.get(candleSeries);
        if (dataPoint) {
          // Convert lightweight-charts time to string format
          let dateStr = '';
          if (typeof param.time === 'number') {
            const dateObj = new Date(param.time * 1000);
            dateStr = dateObj.toISOString().replace('T', ' ').substring(0, 16);
          } else if (typeof param.time === 'string') {
            dateStr = param.time;
          } else if (param.time.year) {
            dateStr = `${param.time.year}-${String(param.time.month).padStart(2, '0')}-${String(param.time.day).padStart(2, '0')}`;
          }

          // Extract indicator data if available
          const smaPoint = smaSeries ? param.seriesData.get(smaSeries) : undefined;
          const emaPoint = emaSeries ? param.seriesData.get(emaSeries) : undefined;
          const bbUpperPoint = bbUpperSeries ? param.seriesData.get(bbUpperSeries) : undefined;
          const bbLowerPoint = bbLowerSeries ? param.seriesData.get(bbLowerSeries) : undefined;

          // RSI requires matching by time since it's on a different chart
          // But to be precise, lightweight-charts crosshair sync handles crosshair move on the same chart.
          // For RSI, we can find the exact data point by matching `param.time` against `data`.
          let rsiVal: number | undefined;
          if (indicators.rsi) {
            const rsiData = computeRSI(data, 14);
            const idx = data.findIndex(d => d.time === param.time);
            if (idx >= 0 && rsiData[idx] !== null) rsiVal = rsiData[idx] as number;
          }

          setHudData({
            open: dataPoint.open,
            high: dataPoint.high,
            low: dataPoint.low,
            close: dataPoint.close,
            date: dateStr,
            sma: smaPoint?.value,
            ema: emaPoint?.value,
            bbUpper: bbUpperPoint?.value,
            bbLower: bbLowerPoint?.value,
            rsi: rsiVal
          });
        } else {
          setHudData(null);
        }
      }
    };
    chart.subscribeCrosshairMove(handleCrosshairMove);

    // Sync Custom Overlays
    const updateCustomOverlays = () => {
      if (!candleSeries || !chart) return;
      
      // Risk/Reward
      (drawings.riskRewards || []).forEach(tool => {
        const el = document.getElementById(`rr-tool-${tool.id}`);
        if (!el) return;

        const startX = chart.timeScale().timeToCoordinate(tool.entry.time as Time);
        if (startX === null) {
          el.style.display = 'none';
          return;
        }

        const entryY = candleSeries.priceToCoordinate(tool.entry.price);
        const tpY = candleSeries.priceToCoordinate(tool.tp);
        const slY = candleSeries.priceToCoordinate(tool.sl);

        if (entryY === null || tpY === null || slY === null) {
          el.style.display = 'none';
          return;
        }

        el.style.display = 'block';
        el.style.left = `${startX}px`;
        
        const profitTop = Math.min(entryY, tpY);
        const profitHeight = Math.abs(entryY - tpY);
        const lossTop = Math.min(entryY, slY);
        const lossHeight = Math.abs(entryY - slY);

        el.style.setProperty('--profit-top', `${profitTop}px`);
        el.style.setProperty('--profit-height', `${profitHeight}px`);
        el.style.setProperty('--loss-top', `${lossTop}px`);
        el.style.setProperty('--loss-height', `${lossHeight}px`);
        el.style.setProperty('--entry-y', `${entryY}px`);
      });

      // Fibonacci Retracement
      (drawings.fibonacci || []).forEach(tool => {
        const el = document.getElementById(`fib-tool-${tool.id}`);
        if (!el) return;

        // Sort times so x1 is earlier than x2
        const times = [tool.start.time, tool.end.time].sort((a, b) => a - b);
        const startX = chart.timeScale().timeToCoordinate(times[0] as Time);
        const endX = chart.timeScale().timeToCoordinate(times[1] as Time);
        
        if (startX === null) {
          el.style.display = 'none';
          return;
        }

        const width = endX !== null ? Math.max(endX - startX, 100) : 100;
        
        el.style.display = 'block';
        el.style.left = `${startX}px`;
        el.style.width = `${width}px`;

        const p1 = tool.start.price;
        const p2 = tool.end.price;
        const range = p2 - p1;
        
        const y1 = candleSeries.priceToCoordinate(p1);
        const y2 = candleSeries.priceToCoordinate(p2);
        if (y1 !== null && y2 !== null) {
           el.style.setProperty('--fib-top', `${Math.min(y1, y2)}px`);
           el.style.setProperty('--fib-height', `${Math.abs(y1 - y2)}px`);
        }

        [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].forEach(ratio => {
          const levelPrice = p1 + (range * ratio);
          const y = candleSeries.priceToCoordinate(levelPrice);
          if (y !== null) {
            el.style.setProperty(`--fib-y-${ratio.toString().replace('.', '_')}`, `${y}px`);
          }
        });
      });
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(updateCustomOverlays);
    chart.timeScale().subscribeSizeChange(updateCustomOverlays);
    setTimeout(updateCustomOverlays, 50);

    // Cleanup
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(updateCustomOverlays);
      chart.timeScale().unsubscribeSizeChange(updateCustomOverlays);
      resizeObserver.disconnect();
      if (chartContainerEl) {
        chartContainerEl.removeEventListener('dblclick', handleDblClick);
      }
      handlers.forEach(h => h());
      chart.unsubscribeClick(handleChartClick);
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      if (candleSeries) {
        activePriceLines.forEach(line => candleSeries.removePriceLine(line));
        if (indicators.fibonacci) {
          fibLines.forEach(line => candleSeries.removePriceLine(line));
        }
      }
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
      if (rsiChartRef.current) {
        rsiChartRef.current.remove();
        rsiChartRef.current = null;
      }
      if (macdChartRef.current) {
        macdChartRef.current.remove();
        macdChartRef.current = null;
      }
    };
  }, [symbol, timeframe, data, indicators, patterns, highlightedPattern, drawings, isExpandedFullScreen]);

  return (
    <div 
      className={`flex flex-col gap-2 w-full select-none ${
        isExpandedFullScreen 
          ? 'fixed inset-0 z-50 ' + (theme === 'dark' ? 'bg-zinc-950' : 'bg-zinc-100') + ' p-6 flex flex-col overflow-y-auto' 
          : 'relative'
      }`} 
      id="trading_canvas_wrapper"
    >
      {/* Header element (shown in full-screen or regular format) */}
      <div className={`flex items-center justify-between ${theme === 'dark' ? 'bg-zinc-900 border-zinc-800 text-zinc-100' : 'bg-white border-zinc-200 text-zinc-900'} border rounded-lg py-2 px-3.5 shadow-md`}>
        <div className="flex items-center gap-3">
          <span className={`font-display font-black text-sm ${theme === 'dark' ? 'text-zinc-100' : 'text-zinc-900'} flex items-center gap-1.5 leading-none`}>
            {symbol.slice(0, 3)}/{symbol.slice(3)}
            <span className="text-emerald-400 text-[10px] px-1 py-0.5 rounded bg-emerald-950/40 border border-emerald-900/30 uppercase font-mono">{timeframe}</span>
          </span>
          <div className={`text-[10px] ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500'} font-mono hidden sm:flex items-center gap-2`}>
            <span>O: <strong className={theme === 'dark' ? 'text-zinc-200' : 'text-zinc-700'}>{data[data.length - 1]?.open}</strong></span>
            <span>H: <strong className={theme === 'dark' ? 'text-zinc-200' : 'text-zinc-700'}>{data[data.length - 1]?.high}</strong></span>
            <span>L: <strong className={theme === 'dark' ? 'text-zinc-200' : 'text-zinc-700'}>{data[data.length - 1]?.low}</strong></span>
            <span>C: <strong className={data[data.length - 1]?.close >= data[data.length - 1]?.open ? 'text-green-500' : 'text-rose-500'}>{data[data.length - 1]?.close}</strong></span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {activeTool !== 'none' && (
            <div className="text-[10px] font-mono text-amber-400 flex items-center gap-1 animate-pulse bg-amber-950/20 px-2 py-0.5 rounded border border-amber-900/30">
              <AlertCircle className="w-3 h-3" />
              <span>
                {activeTool === 'horizontal' && 'Click chart to place Support/Resistance'}
                {activeTool === 'trendline_start' && 'Click chart for Trendline START point'}
                {activeTool === 'trendline_end' && 'Click chart for Trendline END point'}
                {activeTool === 'annotation' && 'Click chart to add Custom Text label'}
                {activeTool === 'rr_long' && 'Click chart to place Long Position entry'}
                {activeTool === 'rr_short' && 'Click chart to place Short Position entry'}
                {activeTool === 'fib_start' && 'Click chart for Fibonacci START point'}
                {activeTool === 'fib_end' && 'Click chart for Fibonacci END point'}
              </span>
            </div>
          )}

          <button
            onClick={handleTakeSnapshot}
            className={`p-1.5 ${theme === 'dark' ? 'bg-emerald-950/30 hover:bg-emerald-900/40 text-emerald-400 hover:text-emerald-200 border-emerald-900/60 hover:border-emerald-700' : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-600 hover:text-emerald-750 border-emerald-200 hover:border-emerald-300'} rounded border transition-colors cursor-pointer flex items-center gap-1.5 text-xs font-mono font-bold`}
            title="Take a snapshot of this chart and analyze with Co-Pilot"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Snapshot for AI</span>
          </button>

          <button
            onClick={() => setIsExpandedFullScreen(!isExpandedFullScreen)}
            className={`p-1.5 ${theme === 'dark' ? 'text-zinc-400 hover:text-white hover:bg-zinc-800 border-zinc-800 hover:border-zinc-700' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 border-zinc-200 hover:border-zinc-300'} rounded border transition-colors cursor-pointer flex items-center gap-1 text-xs font-mono font-bold`}
            title={isExpandedFullScreen ? "Exit Fullscreen Screen" : "Maximize Full Chart Screen"}
          >
            {isExpandedFullScreen ? (
              <>
                <Minimize2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Normal Mode</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Full Chart Screen</span>
              </>
            )}
          </button>
        </div>
      </div>

      <div className="flex items-stretch gap-3 w-full h-full min-h-0">
        
        {/* Drawing Toolbar (vertical layout on the left side) */}
        <div className={`flex flex-col gap-2 p-1.5 ${theme === 'dark' ? 'bg-zinc-900 border-zinc-800/80 text-zinc-100 shadow-xl' : 'bg-white border-zinc-200 text-zinc-900 shadow-lg'} border rounded-lg w-11 shrink-0 items-center justify-start py-4`}>
          <button
            onClick={() => { setActiveTool('none'); setTrendlineStart(null); }}
            className={`p-2 rounded-lg transition-all cursor-pointer flex items-center justify-center ${
              activeTool === 'none' ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/40' : `${theme === 'dark' ? 'text-zinc-400 hover:text-white hover:bg-zinc-800' : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'}`
            }`}
            title="Normal Selection / Cursor"
          >
            <MousePointer className="w-4 h-4" />
          </button>

          <button
            onClick={() => {
              if (chartRef.current) {
                chartRef.current.timeScale().fitContent();
              }
            }}
            className={`p-2 rounded-lg ${theme === 'dark' ? 'text-zinc-400 hover:text-white hover:bg-zinc-800' : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'} transition-all cursor-pointer flex items-center justify-center relative group`}
            title="Auto Fit Chart (Fit all candles on screen)"
          >
            <Expand className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
            <span className="absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-400" />
          </button>

          <button
            onClick={() => setActiveTool('horizontal')}
            className={`p-2 rounded-lg transition-all cursor-pointer flex items-center justify-center relative ${
              activeTool === 'horizontal' ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/40' : `${theme === 'dark' ? 'text-zinc-400 hover:text-white hover:bg-zinc-800' : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'}`
            }`}
            title="Horizontal Line (Support & Resistance Level)"
          >
            <Minus className="w-4 h-4" />
            <span className="absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full bg-indigo-400" />
          </button>

          <button
            onClick={() => setActiveTool('trendline_start')}
            className={`p-2 rounded-lg transition-all cursor-pointer flex items-center justify-center relative ${
              activeTool === 'trendline_start' || activeTool === 'trendline_end' ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/40' : `${theme === 'dark' ? 'text-zinc-400 hover:text-white hover:bg-zinc-800' : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'}`
            }`}
            title="Trendline Tool (Click Start & End points)"
          >
            <TrendingUp className="w-4 h-4" />
            <span className="absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-400" />
          </button>

          <button
            onClick={() => setActiveTool('annotation')}
            className={`p-2 rounded-lg transition-all cursor-pointer flex items-center justify-center relative ${
              activeTool === 'annotation' ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/40' : `${theme === 'dark' ? 'text-zinc-400 hover:text-white hover:bg-zinc-800' : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'}`
            }`}
            title="Text Label / Custom Note"
          >
            <Type className="w-4 h-4" />
            <span className="absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-400" />
          </button>

          <div className={`h-px ${theme === 'dark' ? 'bg-zinc-800' : 'bg-zinc-200'} w-6 my-1`} />

          {/* Long / Short Risk/Reward Tool */}
          <button
            onClick={() => setActiveTool('rr_long')}
            className={`p-2 rounded-lg transition-all cursor-pointer flex items-center justify-center relative ${
              activeTool === 'rr_long' ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/40' : `${theme === 'dark' ? 'text-zinc-400 hover:text-white hover:bg-zinc-800' : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'}`
            }`}
            title="Long Position (Risk/Reward)"
          >
            <ArrowUpRight className="w-4 h-4 text-emerald-400" />
          </button>
          <button
            onClick={() => setActiveTool('rr_short')}
            className={`p-2 rounded-lg transition-all cursor-pointer flex items-center justify-center relative ${
              activeTool === 'rr_short' ? 'bg-red-600 text-white shadow-md shadow-red-950/40' : `${theme === 'dark' ? 'text-zinc-400 hover:text-white hover:bg-zinc-800' : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'}`
            }`}
            title="Short Position (Risk/Reward)"
          >
            <ArrowDownRight className="w-4 h-4 text-red-400" />
          </button>

          <button
            onClick={() => setActiveTool('fib_start')}
            className={`p-2 rounded-lg transition-all cursor-pointer flex items-center justify-center relative ${
              activeTool === 'fib_start' || activeTool === 'fib_end' ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/40' : `${theme === 'dark' ? 'text-zinc-400 hover:text-white hover:bg-zinc-800' : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'}`
            }`}
            title="Fibonacci Retracement"
          >
            <AlignJustify className="w-4 h-4" />
            <span className="absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full bg-blue-400" />
          </button>

          <div className={`h-px ${theme === 'dark' ? 'bg-zinc-800' : 'bg-zinc-200'} w-6 my-1`} />
          <div className="flex flex-col gap-1.5 py-1 items-center">
            {[
              { name: 'gold', value: '#eab308' },
              { name: 'emerald', value: '#22c55e' },
              { name: 'rose', value: '#f43f5e' },
              { name: 'blue', value: '#3b82f6' },
              { name: 'purple', value: '#a855f7' },
            ].map((col) => (
              <button
                key={col.value}
                onClick={() => setSelectedColor(col.value)}
                className={`w-3.5 h-3.5 rounded-full border transition-all cursor-pointer ${
                  selectedColor === col.value 
                    ? 'border-white scale-110 shadow-md shadow-black' 
                    : 'border-transparent hover:scale-110'
                }`}
                style={{ backgroundColor: col.value }}
                title={`Use ${col.name} drawing color`}
              />
            ))}
          </div>

          <div className={`h-px ${theme === 'dark' ? 'bg-zinc-800' : 'bg-zinc-200'} w-6 my-1`} />

          {/* Layers Manager Button */}
          <button
            onClick={() => setShowDrawingsManager(!showDrawingsManager)}
            className={`p-2 rounded-lg transition-all cursor-pointer flex items-center justify-center ${
              showDrawingsManager ? (theme === 'dark' ? 'bg-zinc-800 text-emerald-400 border border-zinc-700' : 'bg-zinc-100 text-emerald-600 border border-zinc-300') : `${theme === 'dark' ? 'text-zinc-400 hover:text-white hover:bg-zinc-800' : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'}`
            }`}
            title="Manage Active Drawing Layers"
          >
            <Layers className="w-4 h-4" />
          </button>

          <div className={`h-px ${theme === 'dark' ? 'bg-zinc-800' : 'bg-zinc-200'} w-6 my-1`} />

          <button
            onClick={handleClearDrawings}
            className={`p-2 rounded-lg text-rose-400 hover:text-rose-200 ${theme === 'dark' ? 'hover:bg-rose-950/40' : 'hover:bg-rose-50'} transition-all cursor-pointer flex items-center justify-center`}
            title="Delete All Custom Drawings"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        {/* Dynamic Drawings List Side Drawer */}
        {showDrawingsManager && (
          <div className={`w-60 ${theme === 'dark' ? 'bg-zinc-900 border-zinc-800/80 text-zinc-100' : 'bg-white border-zinc-200 text-zinc-900'} border rounded-lg p-3 flex flex-col gap-3 shrink-0 h-full overflow-y-auto shadow-2xl animate-fade-in`}>
            <div className={`flex items-center justify-between border-b ${theme === 'dark' ? 'border-zinc-800' : 'border-zinc-100'} pb-2`}>
              <span className={`text-[11px] font-mono font-bold ${theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700'} uppercase tracking-wider flex items-center gap-1.5`}>
                <Layers className="w-3.5 h-3.5 text-emerald-400" />
                Drawing Layers
              </span>
              <button 
                onClick={() => setShowDrawingsManager(false)}
                className="text-zinc-500 hover:text-zinc-300 text-xs font-bold px-1"
              >
                ✕
              </button>
            </div>
            
            {/* Horizontal Lines List */}
            <div className="space-y-1.5">
              <div className="text-[10px] font-mono uppercase text-zinc-500 font-bold tracking-wider">
                Support &amp; Resistance ({drawings.horizontalLines.length})
              </div>
              {drawings.horizontalLines.length === 0 ? (
                <div className="text-[10px] text-zinc-600 italic px-1">No horizontal lines</div>
              ) : (
                <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                  {drawings.horizontalLines.map((item, idx) => {
                    const price = typeof item === 'number' ? item : item.price;
                    const color = typeof item === 'object' && item.color ? item.color : '#22c55e';
                    const config = PAIRS_CONFIG[symbol] || { pipDecimal: 4 };
                    return (
                      <div key={idx} className={`flex items-center justify-between ${theme === 'dark' ? 'bg-zinc-950/40 border-zinc-800/40 text-zinc-300' : 'bg-zinc-50 border-zinc-200 text-zinc-700'} border rounded px-2 py-1 text-[10px] font-mono`}>
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                          <span className={theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700'}>{price.toFixed(config.pipDecimal + 1)}</span>
                        </div>
                        <button 
                          onClick={() => {
                            setDrawings(prev => ({
                              ...prev,
                              horizontalLines: prev.horizontalLines.filter((_, i) => i !== idx)
                            }));
                          }}
                          className="text-zinc-500 hover:text-red-400 p-0.5"
                          title="Delete line"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Trendlines List */}
            <div className="space-y-1.5 mt-2">
              <div className="text-[10px] font-mono uppercase text-zinc-500 font-bold tracking-wider">
                Trendlines ({drawings.trendlines.length})
              </div>
              {drawings.trendlines.length === 0 ? (
                <div className="text-[10px] text-zinc-600 italic px-1">No trendlines</div>
              ) : (
                <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                  {drawings.trendlines.map((tl, idx) => {
                    const color = tl.color || '#eab308';
                    const config = PAIRS_CONFIG[symbol] || { pipDecimal: 4 };
                    return (
                      <div key={idx} className={`flex items-center justify-between ${theme === 'dark' ? 'bg-zinc-950/40 border-zinc-800/40 text-zinc-300' : 'bg-zinc-50 border-zinc-200 text-zinc-700'} border rounded px-2 py-1 text-[10px] font-mono`}>
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                          <span className={theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700'}>TL #{idx + 1} ({Math.abs(tl.end.price - tl.start.price).toFixed(config.pipDecimal + 1)})</span>
                        </div>
                        <button 
                          onClick={() => {
                            setDrawings(prev => ({
                              ...prev,
                              trendlines: prev.trendlines.filter((_, i) => i !== idx)
                            }));
                          }}
                          className="text-zinc-500 hover:text-red-400 p-0.5"
                          title="Delete trendline"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Annotations List */}
            <div className="space-y-1.5 mt-2">
              <div className="text-[10px] font-mono uppercase text-zinc-500 font-bold tracking-wider">
                Labels &amp; Notes ({drawings.annotations.length})
              </div>
              {drawings.annotations.length === 0 ? (
                <div className="text-[10px] text-zinc-600 italic px-1">No custom notes</div>
              ) : (
                <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                  {drawings.annotations.map((ann, idx) => {
                    const color = ann.color || '#a855f7';
                    return (
                      <div key={idx} className={`flex items-center justify-between ${theme === 'dark' ? 'bg-zinc-950/40 border-zinc-800/40 text-zinc-300' : 'bg-zinc-50 border-zinc-200 text-zinc-700'} border rounded px-2 py-1 text-[10px] font-mono`}>
                        <div className="flex items-center gap-1.5 min-w-0 max-w-[80%]">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                          <span className={`${theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700'} truncate`} title={ann.text}>{ann.text}</span>
                        </div>
                        <button 
                          onClick={() => {
                            setDrawings(prev => ({
                              ...prev,
                              annotations: prev.annotations.filter((_, i) => i !== idx)
                            }));
                          }}
                          className="text-zinc-500 hover:text-red-400 p-0.5"
                          title="Delete label"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Risk/Reward Tools List */}
            <div className="space-y-1.5 mt-2">
              <div className="text-[10px] font-mono uppercase text-zinc-500 font-bold tracking-wider">
                Long/Short Tools ({(drawings.riskRewards || []).length})
              </div>
              {(drawings.riskRewards || []).length === 0 ? (
                <div className="text-[10px] text-zinc-600 italic px-1">No setups</div>
              ) : (
                <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                  {drawings.riskRewards.map((tool) => {
                    return (
                      <div key={tool.id} className={`flex items-center justify-between ${theme === 'dark' ? 'bg-zinc-950/40 border-zinc-800/40 text-zinc-300' : 'bg-zinc-50 border-zinc-200 text-zinc-700'} border rounded px-2 py-1 text-[10px] font-mono`}>
                        <div className="flex items-center gap-1.5">
                          {tool.type === 'long' ? <ArrowUpRight className="w-3 h-3 text-emerald-400" /> : <ArrowDownRight className="w-3 h-3 text-red-400" />}
                          <span className={`${theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700'} capitalize`}>{tool.type} @ {tool.entry.price.toFixed((PAIRS_CONFIG[symbol] || {pipDecimal: 4}).pipDecimal + 1)}</span>
                        </div>
                        <button 
                          onClick={() => {
                            setDrawings(prev => ({
                              ...prev,
                              riskRewards: prev.riskRewards.filter(t => t.id !== tool.id)
                            }));
                          }}
                          className="text-zinc-500 hover:text-red-400 p-0.5"
                          title="Delete tool"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Fibonacci List */}
            <div className="space-y-1.5 mt-2">
              <div className="text-[10px] font-mono uppercase text-zinc-500 font-bold tracking-wider">
                Fibonacci ({(drawings.fibonacci || []).length})
              </div>
              {(drawings.fibonacci || []).length === 0 ? (
                <div className="text-[10px] text-zinc-600 italic px-1">No fibs</div>
              ) : (
                <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                  {drawings.fibonacci.map((tool) => {
                    return (
                      <div key={tool.id} className={`flex items-center justify-between ${theme === 'dark' ? 'bg-zinc-950/40 border-zinc-800/40 text-zinc-300' : 'bg-zinc-50 border-zinc-200 text-zinc-700'} border rounded px-2 py-1 text-[10px] font-mono`}>
                        <div className="flex items-center gap-1.5">
                          <AlignJustify className="w-3 h-3 text-blue-400" />
                          <span className={`${theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700'} capitalize`}>Fib @ {tool.start.price.toFixed((PAIRS_CONFIG[symbol] || {pipDecimal: 4}).pipDecimal + 1)}</span>
                        </div>
                        <button 
                          onClick={() => {
                            setDrawings(prev => ({
                              ...prev,
                              fibonacci: prev.fibonacci.filter(t => t.id !== tool.id)
                            }));
                          }}
                          className="text-zinc-500 hover:text-red-400 p-0.5"
                          title="Delete tool"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Primary Chart Canvas and sub-charts wrapper */}
        <div className="flex-1 flex flex-col gap-2 min-w-0">
          <div 
            className={`w-full rounded-lg border ${theme === 'dark' ? 'border-zinc-800 bg-zinc-950' : 'border-zinc-200 bg-white'} overflow-hidden relative`}
            style={{ height: `${chartHeight}px` }}
          >
            <div 
              ref={containerRef} 
              className="absolute inset-0"
              id="tv_main_price_chart"
            />

            {/* Price Streak Indicator Overlay */}
            {priceStreak.count > 0 && (
              <div 
                className={`absolute top-3 right-3 z-20 backdrop-blur-sm border px-3 py-1.5 rounded-md flex items-center gap-1.5 text-xs font-mono select-none pointer-events-auto shadow-lg transition-all ${
                  priceStreak.type === 'bullish'
                    ? (theme === 'dark' ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-400' : 'bg-emerald-50/90 border-emerald-300 text-emerald-700')
                    : (theme === 'dark' ? 'bg-rose-950/80 border-rose-500/50 text-rose-400' : 'bg-rose-50/90 border-rose-300 text-rose-700')
                }`}
                title={`Market has formed ${priceStreak.count} consecutive ${priceStreak.type} candles in the current ${timeframe} timeframe.`}
              >
                <span className="flex h-2 w-2 relative">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                    priceStreak.type === 'bullish' ? 'bg-emerald-400' : 'bg-rose-400'
                  }`}></span>
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${
                    priceStreak.type === 'bullish' ? 'bg-emerald-500' : 'bg-rose-500'
                  }`}></span>
                </span>
                <span className="font-bold tracking-tight">
                  STREAK: {priceStreak.count} {priceStreak.type.toUpperCase()}
                </span>
              </div>
            )}
            {/* Risk/Reward Custom Overlays */}
            <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden">
              {(drawings.riskRewards || []).map(tool => (
                <div
                  key={tool.id}
                  id={`rr-tool-${tool.id}`}
                  className="absolute pointer-events-none"
                  style={{ width: '120px', display: 'none' }}
                >
                  {/* Profit Zone */}
                  <div 
                     className={`absolute w-full ${tool.type === 'long' ? 'bg-emerald-500/20' : 'bg-emerald-500/20'}`}
                     style={{
                        top: 'var(--profit-top)',
                        height: 'var(--profit-height)',
                        borderTop: tool.type === 'long' ? '1px solid rgba(16, 185, 129, 0.6)' : 'none',
                        borderBottom: tool.type === 'short' ? '1px solid rgba(16, 185, 129, 0.6)' : 'none',
                     }}
                  >
                    <div className={`text-[10px] text-emerald-400 px-1 font-mono font-medium leading-none absolute ${tool.type === 'long' ? 'top-0.5' : 'bottom-0.5'}`}>
                      TP {tool.tp.toFixed((PAIRS_CONFIG[symbol] || {pipDecimal: 4}).pipDecimal + 1)}
                    </div>
                  </div>
                  
                  {/* Loss Zone */}
                  <div 
                     className={`absolute w-full ${tool.type === 'long' ? 'bg-red-500/20' : 'bg-red-500/20'}`}
                     style={{
                        top: 'var(--loss-top)',
                        height: 'var(--loss-height)',
                        borderBottom: tool.type === 'long' ? '1px solid rgba(239, 68, 68, 0.6)' : 'none',
                        borderTop: tool.type === 'short' ? '1px solid rgba(239, 68, 68, 0.6)' : 'none',
                     }}
                  >
                    <div className={`text-[10px] text-red-400 px-1 font-mono font-medium leading-none absolute ${tool.type === 'long' ? 'bottom-0.5' : 'top-0.5'}`}>
                      SL {tool.sl.toFixed((PAIRS_CONFIG[symbol] || {pipDecimal: 4}).pipDecimal + 1)}
                    </div>
                  </div>
                  
                  {/* Entry Line */}
                  <div className="absolute w-full border-t border-zinc-400/80 z-20" style={{ top: 'var(--entry-y)' }}>
                    <div className="text-[10px] text-zinc-300 font-mono pl-1 -mt-3 drop-shadow-md">Entry</div>
                  </div>
                </div>
              ))}

              {(drawings.fibonacci || []).map(tool => {
                const color = tool.color || '#3b82f6'; // default blue
                return (
                  <div
                    key={tool.id}
                    id={`fib-tool-${tool.id}`}
                    className="absolute pointer-events-none"
                    style={{ display: 'none' }}
                  >
                    {/* Background shaded area */}
                    <div className="absolute w-full bg-blue-500/5" style={{ top: 'var(--fib-top)', height: 'var(--fib-height)' }} />
                    
                    {[0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].map(ratio => {
                      const ratioStr = ratio.toString().replace('.', '_');
                      // use standard fib colors if no specific color is set
                      let levelColor = color;
                      if (!tool.color) {
                         if (ratio === 0.618 || ratio === 0.382) levelColor = '#eab308';
                         else if (ratio === 0.5) levelColor = '#10b981';
                         else if (ratio === 1 || ratio === 0) levelColor = '#94a3b8';
                      }
                      return (
                        <div 
                          key={ratio}
                          className="absolute w-full border-t border-dashed z-20 flex items-center justify-end"
                          style={{ 
                            top: `var(--fib-y-${ratioStr})`, 
                            borderColor: levelColor,
                            opacity: 0.8
                          }}
                        >
                          <div 
                            className="text-[9px] font-mono font-medium px-1 mt-0.5 rounded-bl shadow-sm"
                            style={{ color: levelColor, backgroundColor: 'rgba(0,0,0,0.4)' }}
                          >
                            {ratio}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {/* HUD Overlay */}
            {hudData && (
              <div className={`absolute top-3 left-3 z-20 ${theme === 'dark' ? 'bg-zinc-950/80 border-zinc-800/80 text-zinc-100' : 'bg-white/90 border-zinc-200 text-zinc-800'} backdrop-blur-sm border rounded-md py-2 px-3 flex flex-col gap-1 text-[11px] font-mono select-none pointer-events-none shadow-lg animate-in fade-in duration-200`}>
                <div className={`text-zinc-400 font-bold mb-1 border-b ${theme === 'dark' ? 'border-zinc-800/50' : 'border-zinc-200'} pb-1 flex justify-between items-center gap-4`}>
                  <span>{hudData.date}</span>
                  <span className="text-[9px] text-zinc-500 font-normal">HUD</span>
                </div>
                <div className="flex gap-3 mb-0.5">
                  <span className="flex gap-1.5"><span className="text-zinc-500">O</span><span className={`font-semibold ${hudData.open > hudData.close ? 'text-red-500' : 'text-emerald-500'}`}>{hudData.open.toFixed((PAIRS_CONFIG[symbol] || {pipDecimal: 4}).pipDecimal + 1)}</span></span>
                  <span className="flex gap-1.5"><span className="text-zinc-500">H</span><span className={`font-semibold ${theme === 'dark' ? 'text-zinc-350' : 'text-zinc-700'}`}>{hudData.high.toFixed((PAIRS_CONFIG[symbol] || {pipDecimal: 4}).pipDecimal + 1)}</span></span>
                  <span className="flex gap-1.5"><span className="text-zinc-500">L</span><span className={`font-semibold ${theme === 'dark' ? 'text-zinc-350' : 'text-zinc-700'}`}>{hudData.low.toFixed((PAIRS_CONFIG[symbol] || {pipDecimal: 4}).pipDecimal + 1)}</span></span>
                  <span className="flex gap-1.5"><span className="text-zinc-500">C</span><span className={`font-semibold ${hudData.close >= hudData.open ? 'text-emerald-500' : 'text-red-500'}`}>{hudData.close.toFixed((PAIRS_CONFIG[symbol] || {pipDecimal: 4}).pipDecimal + 1)}</span></span>
                </div>
                
                {/* Indicator Values */}
                {(hudData.sma !== undefined || hudData.ema !== undefined || hudData.bbUpper !== undefined || hudData.rsi !== undefined) && (
                  <div className={`flex flex-col gap-0.5 mt-1 pt-1 border-t ${theme === 'dark' ? 'border-zinc-800/50' : 'border-zinc-200'}`}>
                    {hudData.sma !== undefined && (
                      <div className="flex justify-between gap-4">
                        <span className="text-zinc-500">SMA(20)</span>
                        <span className="text-blue-400 font-semibold">{hudData.sma.toFixed((PAIRS_CONFIG[symbol] || {pipDecimal: 4}).pipDecimal + 1)}</span>
                      </div>
                    )}
                    {hudData.ema !== undefined && (
                      <div className="flex justify-between gap-4">
                        <span className="text-zinc-500">EMA(50)</span>
                        <span className="text-yellow-400 font-semibold">{hudData.ema.toFixed((PAIRS_CONFIG[symbol] || {pipDecimal: 4}).pipDecimal + 1)}</span>
                      </div>
                    )}
                    {hudData.bbUpper !== undefined && hudData.bbLower !== undefined && (
                      <div className="flex justify-between gap-4">
                        <span className="text-zinc-500">BB(20,2)</span>
                        <span className="text-purple-400 font-semibold">{hudData.bbUpper.toFixed((PAIRS_CONFIG[symbol] || {pipDecimal: 4}).pipDecimal + 1)} / {hudData.bbLower.toFixed((PAIRS_CONFIG[symbol] || {pipDecimal: 4}).pipDecimal + 1)}</span>
                      </div>
                    )}
                    {hudData.rsi !== undefined && (
                      <div className="flex justify-between gap-4">
                        <span className="text-zinc-500">RSI(14)</span>
                        <span className={`font-semibold ${hudData.rsi > 70 ? 'text-red-400' : hudData.rsi < 30 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {hudData.rsi.toFixed(2)}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* RSI Panel */}
          {indicators.rsi && (
            <div className="flex flex-col w-full gap-1 animate-fade-in">
              <div className={`flex items-center justify-between text-[11px] font-mono px-3 py-1 ${theme === 'dark' ? 'text-zinc-400 bg-zinc-900 border-zinc-800' : 'text-zinc-500 bg-zinc-50 border-zinc-200'} rounded border`}>
                <span>Relative Strength Index (RSI 14)</span>
                <span className="text-rose-400">Oversold: &lt;30 | Overbought: &gt;70</span>
              </div>
              <div 
                ref={rsiContainerRef} 
                className={`w-full rounded-lg border ${theme === 'dark' ? 'border-zinc-800 bg-zinc-950' : 'border-zinc-200 bg-white'} overflow-hidden ${
                  isExpandedFullScreen ? 'h-[110px]' : 'h-[100px]'
                }`}
                id="tv_rsi_indicator_chart"
              />
            </div>
          )}

          {/* MACD Panel */}
          {indicators.macd && (
            <div className="flex flex-col w-full gap-1 animate-fade-in">
              <div className={`flex items-center justify-between text-[11px] font-mono px-3 py-1 ${theme === 'dark' ? 'text-zinc-400 bg-zinc-900 border-zinc-800' : 'text-zinc-500 bg-zinc-50 border-zinc-200'} rounded border`}>
                <span>MACD (12, 26, 9)</span>
                <span className="text-blue-400">Momentum Histogram &amp; Signal Convergence</span>
              </div>
              <div 
                ref={macdContainerRef} 
                className={`w-full rounded-lg border ${theme === 'dark' ? 'border-zinc-800 bg-zinc-950' : 'border-zinc-200 bg-white'} overflow-hidden ${
                  isExpandedFullScreen ? 'h-[110px]' : 'h-[100px]'
                }`}
                id="tv_macd_indicator_chart"
              />
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
