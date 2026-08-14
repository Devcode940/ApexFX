import React, { useEffect, useRef } from 'react';
import { IChartApi, createSeriesMarkers, MouseEventParams, UTCTimestamp, BarData, LineData, CandlestickSeries } from 'lightweight-charts';
import type { Candlestick, Pattern, TechnicalIndicatorsState, Timeframe } from '../types';
import type { SessionBlock } from '../utils/forexSessions';
import type {
  AnimatedTrade,
  ChartPoint,
  ChartTheme,
  DrawingsState,
  DrawingTool,
  HudData,
} from '../types/chart';
import {
  buildChartMarkers,
  createBollingerSeries,
  createEmaSeries,
  createFibonacciPriceLines,
  createMacdSubChart,
  createMainChart,
  createRsiSubChart,
  createSmaSeries,
  formatChartTime,
  syncTimeScales,
  toCandlestickData,
  toEpochSeconds,
} from '../utils/chart/indicatorOverlays';
import {
  createHorizontalPriceLines,
  createTrendlineSeries,
  newRiskRewardTool,
} from '../utils/chart/drawingTools';
import { computeRSI, PAIRS_CONFIG } from '../utils/forexData';

export interface UseChartCoreParams {
  containerRef: React.RefObject<HTMLDivElement | null>;
  rsiContainerRef: React.RefObject<HTMLDivElement | null>;
  macdContainerRef: React.RefObject<HTMLDivElement | null>;
  chartRef: React.RefObject<IChartApi | null>;
  rsiChartRef: React.RefObject<IChartApi | null>;
  macdChartRef: React.RefObject<IChartApi | null>;
  symbol: string;
  timeframe: Timeframe;
  data: Candlestick[];
  indicators: TechnicalIndicatorsState;
  theme: ChartTheme;
  chartHeight: number;
  isExpandedFullScreen: boolean;
  isRsiMinimized: boolean;
  isMacdMinimized: boolean;
  drawings: DrawingsState;
  setDrawings: React.Dispatch<React.SetStateAction<DrawingsState>>;
  activeTool: DrawingTool;
  setActiveTool: (tool: DrawingTool) => void;
  trendlineStart: ChartPoint | null;
  setTrendlineStart: (point: ChartPoint | null) => void;
  fibStart: ChartPoint | null;
  setFibStart: (point: ChartPoint | null) => void;
  selectedColor: string;
  setHudData: (hud: HudData | null) => void;
  patterns: Pattern[];
  visibleChartPatterns: Pattern[];
  highlightedPattern: Pattern | null;
  sessionBlocks: SessionBlock[];
  showSessionShading: boolean;
  symbolTradesToAnimate: AnimatedTrade[];
  showTradeAnimations: boolean;
  showPatternBeams: boolean;
}

/**
 * Chart core: owns the entire lightweight-charts lifecycle (main chart,
 * indicator overlays, drawing interaction, sub-charts, crosshair HUD and
 * DOM overlay syncing) for the current symbol/timeframe/data snapshot.
 */
export function useChartCore(params: UseChartCoreParams): void {
  const {
    containerRef,
    rsiContainerRef,
    macdContainerRef,
    chartRef,
    rsiChartRef,
    macdChartRef,
    symbol,
    timeframe,
    data,
    indicators,
    theme,
    chartHeight,
    isExpandedFullScreen,
    isRsiMinimized,
    isMacdMinimized,
    drawings,
    setDrawings,
    activeTool,
    setActiveTool,
    trendlineStart,
    setTrendlineStart,
    fibStart,
    setFibStart,
    selectedColor,
    setHudData,
    patterns,
    visibleChartPatterns,
    highlightedPattern,
    sessionBlocks,
    showSessionShading,
    symbolTradesToAnimate,
    showTradeAnimations,
    showPatternBeams,
  } = params;

  // Refs for tracking drawing state inside persistent lightweight-charts click subscriptions
  const activeToolRef = useRef<DrawingTool>(activeTool);
  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  const trendlineStartRef = useRef<ChartPoint | null>(trendlineStart);
  useEffect(() => {
    trendlineStartRef.current = trendlineStart;
  }, [trendlineStart]);

  const fibStartRef = useRef<ChartPoint | null>(fibStart);
  useEffect(() => {
    fibStartRef.current = fibStart;
  }, [fibStart]);

  const selectedColorRef = useRef<string>(selectedColor);
  useEffect(() => {
    selectedColorRef.current = selectedColor;
  }, [selectedColor]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || data.length === 0) return;

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
    const chart = createMainChart(container, chartHeight, theme);
    chartRef.current = chart;

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
      },
    });
    candleSeries.setData(toCandlestickData(data));

    // --- Indicator Overlays ---
    const smaSeries = indicators.sma ? createSmaSeries(chart, data) : null;
    const emaSeries = indicators.ema ? createEmaSeries(chart, data) : null;
    const bbSeries = indicators.bollinger ? createBollingerSeries(chart, data) : null;

    const fibLines = indicators.fibonacci ? createFibonacciPriceLines(candleSeries, data, symbol) : [];

    // --- Custom Drawings ---
    const activePriceLines = createHorizontalPriceLines(candleSeries, drawings.horizontalLines);
    const activeTrendlineSeries = createTrendlineSeries(chart, drawings.trendlines);

    // --- Markers (patterns + annotations + in-progress trendline) ---
    createSeriesMarkers(
      candleSeries,
      buildChartMarkers({
        patterns: visibleChartPatterns,
        highlightedPatternId: highlightedPattern ? highlightedPattern.id : null,
        annotations: drawings.annotations,
        trendlineStart: trendlineStart,
        trendlineStartColor: selectedColorRef.current,
      })
    );

    // --- RSI Sub-chart ---
    let rsiChart: IChartApi | null = null;
    if (indicators.rsi && !isRsiMinimized) {
      rsiChart = createRsiSubChart(rsiContainerRef.current, data, theme, isExpandedFullScreen ? 110 : 100);
      rsiChartRef.current = rsiChart;
    }

    // --- MACD Sub-chart ---
    let macdChart: IChartApi | null = null;
    if (indicators.macd && !isMacdMinimized) {
      const macdResult = createMacdSubChart(macdContainerRef.current, data, theme, isExpandedFullScreen ? 110 : 100);
      if (macdResult) {
        macdChart = macdResult.chart;
        macdChartRef.current = macdChart;
      }
    }

    // --- Synchronize Tooltips and Time Scales ---
    const subCharts: IChartApi[] = [];
    if (rsiChart) subCharts.push(rsiChart);
    if (macdChart) subCharts.push(macdChart);
    const unsubscribeSync = syncTimeScales(chart, subCharts);

    // RSI values are fixed per data snapshot — compute once, reuse on crosshair moves
    const rsiValues = indicators.rsi ? computeRSI(data, 14) : null;

    // Zoom to last 55 candles initially for tight focal layout
    chart.timeScale().setVisibleRange({
      from: data[Math.max(0, data.length - 60)].time as UTCTimestamp,
      to: data[data.length - 1].time as UTCTimestamp,
    });

    // Resize Handler
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
    resizeObserver.observe(container);

    // Double-click to auto fit chart timescale
    const handleDblClick = () => {
      chart.timeScale().fitContent();
    };
    container.addEventListener('dblclick', handleDblClick);

    // Chart click listener to place drawings
    const handleChartClick = (param: MouseEventParams) => {
      if (!param.point || !param.time) return;
      const price = candleSeries.coordinateToPrice(param.point.y);
      if (price === null) return;
      const clickedTime = toEpochSeconds(param.time);
      if (clickedTime === undefined) return;

      if (activeToolRef.current === 'horizontal') {
        setDrawings((prev) => ({
          ...prev,
          horizontalLines: [
            ...prev.horizontalLines,
            { price: parseFloat(price.toFixed(config.pipDecimal + 1)), color: selectedColorRef.current },
          ],
        }));
        setActiveTool('none');
      } else if (activeToolRef.current === 'trendline_start') {
        setTrendlineStart({ time: clickedTime, price });
        setActiveTool('trendline_end');
      } else if (activeToolRef.current === 'trendline_end' && trendlineStartRef.current) {
        const start = trendlineStartRef.current;
        setDrawings((prev) => ({
          ...prev,
          trendlines: [...prev.trendlines, { start, end: { time: clickedTime, price }, color: selectedColorRef.current }],
        }));
        setTrendlineStart(null);
        setActiveTool('none');
      } else if (activeToolRef.current === 'rr_long' || activeToolRef.current === 'rr_short') {
        const rrType = activeToolRef.current === 'rr_long' ? 'long' : 'short';
        const tool = newRiskRewardTool(rrType, { time: clickedTime, price }, symbol);
        setDrawings((prev) => ({
          ...prev,
          riskRewards: [...(prev.riskRewards || []), tool],
        }));
        setActiveTool('none');
      } else if (activeToolRef.current === 'fib_start') {
        setFibStart({ time: clickedTime, price });
        setActiveTool('fib_end');
      } else if (activeToolRef.current === 'fib_end' && fibStartRef.current) {
        const start = fibStartRef.current;
        setDrawings((prev) => ({
          ...prev,
          fibonacci: [
            ...(prev.fibonacci || []),
            { id: Date.now().toString(), start, end: { time: clickedTime, price }, color: selectedColorRef.current },
          ],
        }));
        setFibStart(null);
        setActiveTool('none');
      } else if (activeToolRef.current === 'annotation') {
        const text = window.prompt('Enter text for label annotation:');
        if (text && text.trim()) {
          setDrawings((prev) => ({
            ...prev,
            annotations: [...prev.annotations, { time: clickedTime, price, text: text.trim(), color: selectedColorRef.current }],
          }));
        }
        setActiveTool('none');
      }
    };
    chart.subscribeClick(handleChartClick);

    // Crosshair move listener for HUD
    const handleCrosshairMove = (param: MouseEventParams) => {
      // update rr overlays on crosshair move as a hacky way to sync on price update too
      updateCustomOverlays();

      if (
        !param.point ||
        param.time === undefined ||
        param.point.x < 0 ||
        param.point.x > (container.clientWidth || 0) ||
        param.point.y < 0 ||
        param.point.y > (container.clientHeight || 0)
      ) {
        setHudData(null);
        return;
      }

      const dataPoint = param.seriesData.get(candleSeries) as BarData | undefined;
      if (!dataPoint) {
        setHudData(null);
        return;
      }

      let rsiVal: number | undefined;
      if (rsiValues) {
        const idx = data.findIndex((d) => d.time === toEpochSeconds(param.time));
        const raw = idx >= 0 ? rsiValues[idx] : null;
        if (raw !== null && raw !== undefined) rsiVal = raw;
      }

      const smaPoint = smaSeries ? (param.seriesData.get(smaSeries) as LineData | undefined) : undefined;
      const emaPoint = emaSeries ? (param.seriesData.get(emaSeries) as LineData | undefined) : undefined;
      const bbUpperPoint = bbSeries ? (param.seriesData.get(bbSeries.upper) as LineData | undefined) : undefined;
      const bbLowerPoint = bbSeries ? (param.seriesData.get(bbSeries.lower) as LineData | undefined) : undefined;

      setHudData({
        open: dataPoint.open,
        high: dataPoint.high,
        low: dataPoint.low,
        close: dataPoint.close,
        date: formatChartTime(param.time),
        sma: smaPoint?.value,
        ema: emaPoint?.value,
        bbUpper: bbUpperPoint?.value,
        bbLower: bbLowerPoint?.value,
        rsi: rsiVal,
      });
    };
    chart.subscribeCrosshairMove(handleCrosshairMove);

    // Sync Custom Overlays
    const updateCustomOverlays = () => {
      if (!candleSeries || !chart) return;

      // Risk/Reward
      (drawings.riskRewards || []).forEach((tool) => {
        const el = document.getElementById(`rr-tool-${tool.id}`);
        if (!el) return;

        const startX = chart.timeScale().timeToCoordinate(tool.entry.time as UTCTimestamp);
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
      (drawings.fibonacci || []).forEach((tool) => {
        const el = document.getElementById(`fib-tool-${tool.id}`);
        if (!el) return;

        // Sort times so x1 is earlier than x2
        const times = [tool.start.time, tool.end.time].sort((a, b) => a - b);
        const startX = chart.timeScale().timeToCoordinate(times[0] as UTCTimestamp);
        const endX = chart.timeScale().timeToCoordinate(times[1] as UTCTimestamp);

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

        [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].forEach((ratio) => {
          const levelPrice = p1 + range * ratio;
          const y = candleSeries.priceToCoordinate(levelPrice);
          if (y !== null) {
            el.style.setProperty(`--fib-y-${ratio.toString().replace('.', '_')}`, `${y}px`);
          }
        });
      });

      // Forex Session Shading Overlay Bands Position Sync
      if (showSessionShading && sessionBlocks.length > 0) {
        sessionBlocks.forEach((block) => {
          const el = document.getElementById(`session-band-${block.id}`);
          if (!el) return;

          const startX = chart.timeScale().timeToCoordinate(block.startTime as UTCTimestamp);
          const endX = chart.timeScale().timeToCoordinate(block.endTime as UTCTimestamp);

          if (startX === null || endX === null) {
            el.style.display = 'none';
            return;
          }

          const chartWidth = container.clientWidth || 1000;
          const left = Math.max(0, Math.min(startX, endX));
          const right = Math.min(chartWidth, Math.max(startX, endX));
          const width = right - left;

          if (width > 0 && left < chartWidth && right > 0) {
            el.style.display = 'block';
            el.style.left = `${left}px`;
            el.style.width = `${width}px`;
          } else {
            el.style.display = 'none';
          }
        });
      }

      // Trade Entry/Exit Animated Overlays Position Sync
      if (showTradeAnimations && symbolTradesToAnimate.length > 0) {
        const latestCandle = data.length > 0 ? data[data.length - 1] : null;

        symbolTradesToAnimate.forEach((trade) => {
          const el = document.getElementById(`trade-anim-overlay-${trade.id}`);
          if (!el || !latestCandle) return;

          let entryCandle = latestCandle;
          if (data.length > 0) {
            const match = data
              .slice()
              .reverse()
              .find((c) => {
                const cDateStr = new Date(c.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                return trade.time?.includes(cDateStr) || Math.abs(c.time * 1000 - new Date(trade.time).getTime()) < 3600000;
              });
            if (match) entryCandle = match;
          }

          const entryX = chart.timeScale().timeToCoordinate(entryCandle.time as UTCTimestamp);
          const entryY = candleSeries.priceToCoordinate(trade.entryPrice);

          if (entryX === null || entryY === null) {
            el.style.display = 'none';
            return;
          }

          el.style.display = 'block';
          el.style.left = `${entryX}px`;
          el.style.top = `${entryY}px`;

          // Match closest candlestick pattern prior to entry
          const pattern = patterns?.find((p) => p.time <= entryCandle.time);
          if (pattern && showPatternBeams) {
            const patX = chart.timeScale().timeToCoordinate(pattern.time as UTCTimestamp);
            const patY = candleSeries.priceToCoordinate(entryCandle.close);
            if (patX !== null && patY !== null) {
              el.style.setProperty('--pat-dx', `${patX - entryX}px`);
              el.style.setProperty('--pat-dy', `${patY - entryY}px`);
            }
          }

          if (trade.isClosed) {
            const exitPrice = trade.exitPrice || trade.entryPrice;
            const exitX = chart.timeScale().timeToCoordinate(latestCandle.time as UTCTimestamp);
            const exitY = candleSeries.priceToCoordinate(exitPrice);

            if (exitX !== null && exitY !== null) {
              el.style.setProperty('--exit-dx', `${exitX - entryX}px`);
              el.style.setProperty('--exit-dy', `${exitY - entryY}px`);
            }
          }
        });
      }
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(updateCustomOverlays);
    chart.timeScale().subscribeSizeChange(updateCustomOverlays);
    const initialOverlayTimer = setTimeout(updateCustomOverlays, 50);

    // Cleanup
    return () => {
      clearTimeout(initialOverlayTimer);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(updateCustomOverlays);
      chart.timeScale().unsubscribeSizeChange(updateCustomOverlays);
      resizeObserver.disconnect();
      container.removeEventListener('dblclick', handleDblClick);
      unsubscribeSync();
      chart.unsubscribeClick(handleChartClick);
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      activePriceLines.forEach((line) => candleSeries.removePriceLine(line));
      if (indicators.fibonacci) {
        fibLines.forEach((line) => candleSeries.removePriceLine(line));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    symbol,
    timeframe,
    data,
    indicators,
    patterns,
    visibleChartPatterns,
    highlightedPattern,
    drawings,
    isExpandedFullScreen,
    chartHeight,
    sessionBlocks,
    showSessionShading,
    symbolTradesToAnimate,
    showTradeAnimations,
    showPatternBeams,
    isRsiMinimized,
    isMacdMinimized,
    // state setters and refs are stable
  ]);
}
