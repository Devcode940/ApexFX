import React, { useEffect, useRef } from 'react';
import { type IChartApi, type ISeriesApi, type IPriceLine, type ISeriesMarkersPluginApi, type Time, createSeriesMarkers, type MouseEventParams, type UTCTimestamp, type BarData, type LineData, CandlestickSeries } from 'lightweight-charts';
import type { Candlestick, Pattern, TechnicalIndicatorsState, Timeframe } from '../types';
import type { SessionBlock } from '../utils/forexSessions';
import type { AnimatedTrade, ChartPoint, ChartTheme, DrawingsState, DrawingTool, HudData } from '../types/chart';
import { buildChartMarkers, createBollingerSeries, createEmaSeries, createFibonacciPriceLines, createMacdSubChart, createMainChart, createRsiSubChart, createSmaSeries, formatChartTime, syncTimeScales, toCandlestickData, toEpochSeconds, toLineValues } from '../utils/chart/indicatorOverlays';
import { createHorizontalPriceLines, createTrendlineSeries, newRiskRewardTool } from '../utils/chart/drawingTools';
import { computeRSI, computeSMA, computeEMA, computeBollingerBands, computeMACD, PAIRS_CONFIG } from '../utils/forexData';

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

type Handles = {
  candle: ISeriesApi<'Candlestick'> | null;
  sma: ISeriesApi<'Line'> | null; ema: ISeriesApi<'Line'> | null;
  bb: ReturnType<typeof createBollingerSeries>;
  rsi: ReturnType<typeof createRsiSubChart>; macd: ReturnType<typeof createMacdSubChart>;
  markers: ISeriesMarkersPluginApi<Time> | null;
  fib: IPriceLine[]; priceLines: IPriceLine[]; trendlines: ISeriesApi<'Line'>[];
  rsiValues: (number | null)[];
  syncCleanup: (() => void) | null; data: Candlestick[]; fitted: boolean; redraw: (() => void) | null;
};

export function useChartCore(params: UseChartCoreParams): void {
  const { containerRef, chartRef, symbol, timeframe, theme, data, indicators, drawings, chartHeight,
    isExpandedFullScreen, isRsiMinimized, isMacdMinimized, rsiContainerRef, macdContainerRef,
    rsiChartRef, macdChartRef, visibleChartPatterns, highlightedPattern, trendlineStart, selectedColor } = params;
  const latest = useRef(params);
  useEffect(() => { latest.current = params; }, [params]);
  const refs = useRef<Handles>({ candle: null, sma: null, ema: null, bb: null, rsi: null, macd: null, markers: null,
    fib: [], priceLines: [], trendlines: [], rsiValues: [], syncCleanup: null, data: [], fitted: false, redraw: null });

  // Chart identity only. An appended bar, indicator toggle, drawing, or resize is NOT a new chart.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handle = refs.current;
    const chart = createMainChart(container, latest.current.chartHeight, theme);
    chartRef.current = chart;
    const config = PAIRS_CONFIG[symbol] || { pipDecimal: 4 };
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e', downColor: '#ef4444', borderVisible: false, wickUpColor: '#22c55e', wickDownColor: '#ef4444',
      priceFormat: { type: 'price', precision: config.pipDecimal + 1, minMove: 1 / 10 ** (config.pipDecimal + 1) },
    });
    handle.candle = candleSeries; handle.data = []; handle.fitted = false;
    const markers = createSeriesMarkers(candleSeries, []);
    handle.markers = markers;
    const handleChartClick = (param: MouseEventParams) => {
      const { setDrawings, setActiveTool, setTrendlineStart, setFibStart } = latest.current;
      if (!param.point || !param.time) return;
      const price = candleSeries.coordinateToPrice(param.point.y);
      if (price === null) return;
      const clickedTime = toEpochSeconds(param.time);
      if (clickedTime === undefined) return;

      if (latest.current.activeTool === 'horizontal') {
        setDrawings((prev) => ({
          ...prev,
          horizontalLines: [...prev.horizontalLines, { price: parseFloat(price.toFixed(config.pipDecimal + 1)), color: latest.current.selectedColor }],
        }));
        setActiveTool('none');
      } else if (latest.current.activeTool === 'trendline_start') {
        setTrendlineStart({ time: clickedTime, price });
        setActiveTool('trendline_end');
      } else if (latest.current.activeTool === 'trendline_end' && latest.current.trendlineStart) {
        const start = latest.current.trendlineStart;
        setDrawings((prev) => ({
          ...prev,
          trendlines: [...prev.trendlines, { start, end: { time: clickedTime, price }, color: latest.current.selectedColor }],
        }));
        setTrendlineStart(null);
        setActiveTool('none');
      } else if (latest.current.activeTool === 'rr_long' || latest.current.activeTool === 'rr_short') {
        const rrType = latest.current.activeTool === 'rr_long' ? 'long' : 'short';
        const tool = newRiskRewardTool(rrType, { time: clickedTime, price }, symbol);
        setDrawings((prev) => ({ ...prev, riskRewards: [...(prev.riskRewards || []), tool] }));
        setActiveTool('none');
      } else if (latest.current.activeTool === 'fib_start') {
        setFibStart({ time: clickedTime, price });
        setActiveTool('fib_end');
      } else if (latest.current.activeTool === 'fib_end' && latest.current.fibStart) {
        const start = latest.current.fibStart;
        setDrawings((prev) => ({
          ...prev,
          fibonacci: [...(prev.fibonacci || []), { id: Date.now().toString(), start, end: { time: clickedTime, price }, color: latest.current.selectedColor }],
        }));
        setFibStart(null);
        setActiveTool('none');
      } else if (latest.current.activeTool === 'annotation') {
        const text = window.prompt('Enter text for label annotation:');
        if (text && text.trim()) {
          setDrawings((prev) => ({
            ...prev,
            annotations: [...prev.annotations, { time: clickedTime, price, text: text.trim(), color: latest.current.selectedColor }],
          }));
        }
        setActiveTool('none');
      }
    };
    const updateCustomOverlays = () => {
      const { data } = latest.current;
      const cs = refs.current.candle;
      if (!cs || !chart) return;

      (latest.current.drawings.riskRewards || []).forEach((tool) => {
        const el = document.getElementById(`rr-tool-${tool.id}`);
        if (!el) return;
        const startX = chart.timeScale().timeToCoordinate(tool.entry.time as UTCTimestamp);
        if (startX === null) { el.style.display = 'none'; return; }
        const entryY = cs.priceToCoordinate(tool.entry.price);
        const tpY = cs.priceToCoordinate(tool.tp);
        const slY = cs.priceToCoordinate(tool.sl);
        if (entryY === null || tpY === null || slY === null) { el.style.display = 'none'; return; }
        el.style.display = 'block';
        el.style.left = `${startX}px`;
        el.style.setProperty('--profit-top', `${Math.min(entryY, tpY)}px`);
        el.style.setProperty('--profit-height', `${Math.abs(entryY - tpY)}px`);
        el.style.setProperty('--loss-top', `${Math.min(entryY, slY)}px`);
        el.style.setProperty('--loss-height', `${Math.abs(entryY - slY)}px`);
        el.style.setProperty('--entry-y', `${entryY}px`);
      });

      (latest.current.drawings.fibonacci || []).forEach((tool) => {
        const el = document.getElementById(`fib-tool-${tool.id}`);
        if (!el) return;
        const times = [tool.start.time, tool.end.time].sort((a, b) => a - b);
        const startX = chart.timeScale().timeToCoordinate(times[0] as UTCTimestamp);
        const endX = chart.timeScale().timeToCoordinate(times[1] as UTCTimestamp);
        if (startX === null) { el.style.display = 'none'; return; }
        const width = endX !== null ? Math.max(endX - startX, 100) : 100;
        el.style.display = 'block';
        el.style.left = `${startX}px`;
        el.style.width = `${width}px`;
        const p1 = tool.start.price;
        const p2 = tool.end.price;
        const range = p2 - p1;
        const y1 = cs.priceToCoordinate(p1);
        const y2 = cs.priceToCoordinate(p2);
        if (y1 !== null && y2 !== null) {
          el.style.setProperty('--fib-top', `${Math.min(y1, y2)}px`);
          el.style.setProperty('--fib-height', `${Math.abs(y1 - y2)}px`);
        }
        [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].forEach((ratio) => {
          const levelPrice = p1 + range * ratio;
          const y = cs.priceToCoordinate(levelPrice);
          if (y !== null) el.style.setProperty(`--fib-y-${ratio.toString().replace('.', '_')}`, `${y}px`);
        });
      });

      if (latest.current.showSessionShading && latest.current.sessionBlocks.length > 0) {
        latest.current.sessionBlocks.forEach((block) => {
          const el = document.getElementById(`session-band-${block.id}`);
          if (!el) return;
          const startX = chart.timeScale().timeToCoordinate(block.startTime as UTCTimestamp);
          const endX = chart.timeScale().timeToCoordinate(block.endTime as UTCTimestamp);
          if (startX === null || endX === null) { el.style.display = 'none'; return; }
          const chartWidth = container.clientWidth || 1000;
          const left = Math.max(0, Math.min(startX, endX));
          const right = Math.min(chartWidth, Math.max(startX, endX));
          const width = right - left;
          if (width > 0 && left < chartWidth && right > 0) {
            el.style.display = 'block';
            el.style.left = `${left}px`;
            el.style.width = `${width}px`;
          } else el.style.display = 'none';
        });
      }

      if (latest.current.showTradeAnimations && latest.current.symbolTradesToAnimate.length > 0) {
        const latestCandle = data.length > 0 ? data[data.length - 1] : null;
        latest.current.symbolTradesToAnimate.forEach((trade) => {
          const el = document.getElementById(`trade-anim-overlay-${trade.id}`);
          if (!el || !latestCandle) return;
          let entryCandle = latestCandle;
          if (data.length > 0) {
            const match = data.slice().reverse().find((c) => {
              const cDateStr = new Date(c.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              return trade.time?.includes(cDateStr) || Math.abs(c.time * 1000 - new Date(trade.time).getTime()) < 3600000;
            });
            if (match) entryCandle = match;
          }
          const entryX = chart.timeScale().timeToCoordinate(entryCandle.time as UTCTimestamp);
          const entryY = cs.priceToCoordinate(trade.entryPrice);
          if (entryX === null || entryY === null) { el.style.display = 'none'; return; }
          el.style.display = 'block';
          el.style.left = `${entryX}px`;
          el.style.top = `${entryY}px`;
          const pattern = latest.current.patterns?.find((p) => p.time <= entryCandle.time);
          if (pattern && latest.current.showPatternBeams) {
            const patX = chart.timeScale().timeToCoordinate(pattern.time as UTCTimestamp);
            const patY = cs.priceToCoordinate(entryCandle.close);
            if (patX !== null && patY !== null) {
              el.style.setProperty('--pat-dx', `${patX - entryX}px`);
              el.style.setProperty('--pat-dy', `${patY - entryY}px`);
            }
          }
          if (trade.isClosed) {
            const exitPrice = trade.exitPrice || trade.entryPrice;
            const exitX = chart.timeScale().timeToCoordinate(latestCandle.time as UTCTimestamp);
            const exitY = cs.priceToCoordinate(exitPrice);
            if (exitX !== null && exitY !== null) {
              el.style.setProperty('--exit-dx', `${exitX - entryX}px`);
              el.style.setProperty('--exit-dy', `${exitY - entryY}px`);
            }
          }
        });
      }
    };


    handle.redraw = updateCustomOverlays;
    const crosshair = (event: MouseEventParams) => {
      updateCustomOverlays();
      const p = latest.current;
      if (!event.point || event.time === undefined || event.point.x < 0 || event.point.y < 0) { p.setHudData(null); return; }
      const bar = event.seriesData.get(candleSeries) as BarData | undefined;
      if (!bar) { p.setHudData(null); return; }
      const h = refs.current;
      const read = (s: ISeriesApi<'Line'> | null) => s ? (event.seriesData.get(s) as LineData | undefined)?.value : undefined;
      const i = p.data.findIndex(c => c.time === toEpochSeconds(event.time));
      p.setHudData({ open: bar.open, high: bar.high, low: bar.low, close: bar.close, date: formatChartTime(event.time),
        sma: read(h.sma), ema: read(h.ema), bbUpper: read(h.bb?.upper ?? null), bbLower: read(h.bb?.lower ?? null), rsi: h.rsiValues[i] ?? undefined });
    };
    const resize = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width;
      if (!width) return;
      const p = latest.current;
      chart.resize(width, p.chartHeight);
      refs.current.rsi?.chart.resize(width, p.isExpandedFullScreen ? 110 : 100);
      refs.current.macd?.chart.resize(width, p.isExpandedFullScreen ? 110 : 100);
      updateCustomOverlays();
    });
    resize.observe(container);
    const fit = () => chart.timeScale().fitContent();
    container.addEventListener('dblclick', fit);
    chart.subscribeClick(handleChartClick);
    chart.subscribeCrosshairMove(crosshair);
    chart.timeScale().subscribeVisibleLogicalRangeChange(updateCustomOverlays);
    chart.timeScale().subscribeSizeChange(updateCustomOverlays);
    return () => {
      resize.disconnect(); container.removeEventListener('dblclick', fit);
      chart.unsubscribeClick(handleChartClick); chart.unsubscribeCrosshairMove(crosshair);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(updateCustomOverlays);
      chart.timeScale().unsubscribeSizeChange(updateCustomOverlays);
      handle.syncCleanup?.(); handle.syncCleanup = null;
      markers.detach(); chart.remove();
      chartRef.current = null;
      handle.candle = null; handle.markers = null; handle.redraw = null;
      handle.priceLines = []; handle.trendlines = []; handle.fib = [];
    };
  }, [containerRef, chartRef, symbol, timeframe, theme]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const h = refs.current;
    const data = latest.current.data;
    h.sma = indicators.sma ? createSmaSeries(chart, data) : null;
    h.ema = indicators.ema ? createEmaSeries(chart, data) : null;
    h.bb = indicators.bollinger ? createBollingerSeries(chart, data) : null;
    const created = [h.sma, h.ema, h.bb?.upper, h.bb?.lower, h.bb?.basis].filter(Boolean) as ISeriesApi<'Line'>[];
    return () => {
      if (chartRef.current === chart) created.forEach(series => chart.removeSeries(series));
      h.sma = null; h.ema = null; h.bb = null;
    };
  }, [chartRef, symbol, timeframe, theme, indicators.sma, indicators.ema, indicators.bollinger]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const h = refs.current;
    const data = latest.current.data;
    const rsi = indicators.rsi && !isRsiMinimized ? createRsiSubChart(rsiContainerRef.current, data, theme, isExpandedFullScreen ? 110 : 100) : null;
    const macd = indicators.macd && !isMacdMinimized ? createMacdSubChart(macdContainerRef.current, data, theme, isExpandedFullScreen ? 110 : 100) : null;
    h.rsi = rsi; h.macd = macd;
    rsiChartRef.current = rsi?.chart ?? null; macdChartRef.current = macd?.chart ?? null;
    const children = [rsi?.chart, macd?.chart].filter(Boolean) as IChartApi[];
    const unsubscribe = syncTimeScales(chart, children);
    h.syncCleanup = unsubscribe;
    const range = chart.timeScale().getVisibleLogicalRange();
    if (range) children.forEach(child => child.timeScale().setVisibleLogicalRange(range));
    return () => {
      unsubscribe(); rsi?.chart.remove(); macd?.chart.remove();
      rsiChartRef.current = null; macdChartRef.current = null; h.rsi = null; h.macd = null;
    };
  }, [chartRef, symbol, timeframe, theme, indicators.rsi, indicators.macd, isRsiMinimized, isMacdMinimized, isExpandedFullScreen, rsiContainerRef, macdContainerRef, rsiChartRef, macdChartRef]);

  useEffect(() => {
    const width = containerRef.current?.clientWidth;
    if (!width) return;
    chartRef.current?.resize(width, chartHeight);
    refs.current.rsi?.chart.resize(width, isExpandedFullScreen ? 110 : 100);
    refs.current.macd?.chart.resize(width, isExpandedFullScreen ? 110 : 100);
  }, [containerRef, chartRef, chartHeight, isExpandedFullScreen]);

  useEffect(() => {
    const h = refs.current;
    const cs = h.candle;
    const chart = chartRef.current;
    if (!cs || !chart) return;
    const prev = h.data;
    const incremental = prev.length > 0 && data.length >= prev.length && prev.slice(0, -1).every((bar, i) => bar === data[i]) && prev.at(-1)?.time === data[prev.length - 1]?.time;
    if (incremental) toCandlestickData(data.slice(prev.length - 1)).forEach(bar => cs.update(bar));
    else {
      const range = chart.timeScale().getVisibleRange();
      cs.setData(toCandlestickData(data));
      if (h.fitted && range && data.length > 1) chart.timeScale().setVisibleRange(range);
    }
    h.data = data;
    h.sma?.setData(toLineValues(data, computeSMA(data, 20)));
    h.ema?.setData(toLineValues(data, computeEMA(data, 50)));
    if (h.bb) {
      const bb = computeBollingerBands(data, 20, 2);
      h.bb.upper.setData(toLineValues(data, bb.upper)); h.bb.lower.setData(toLineValues(data, bb.lower)); h.bb.basis.setData(toLineValues(data, bb.basis));
    }
    h.rsiValues = computeRSI(data, 14);
    h.rsi?.series.setData(toLineValues(data, h.rsiValues));
    if (h.macd) {
      const macd = computeMACD(data);
      h.macd.macd.setData(toLineValues(data, macd.macd)); h.macd.signal.setData(toLineValues(data, macd.signal));
      h.macd.histogram.setData(toLineValues(data, macd.histogram).map(point => ({ ...point, color: point.value >= 0 ? 'rgba(34,197,94,.45)' : 'rgba(239,68,68,.45)' })));
    }
    h.fib.forEach(line => cs.removePriceLine(line));
    h.fib = indicators.fibonacci ? createFibonacciPriceLines(cs, data, symbol) : [];
    if (!h.fitted && data.length) {
      if (data.length > 1) chart.timeScale().setVisibleRange({ from: data[Math.max(0, data.length - 60)].time as UTCTimestamp, to: data[data.length - 1].time as UTCTimestamp });
      else chart.timeScale().fitContent();
      h.fitted = true;
    }
    h.redraw?.();
  }, [data, chartRef, symbol, timeframe, theme, indicators.sma, indicators.ema, indicators.bollinger, indicators.fibonacci, indicators.rsi, indicators.macd, isRsiMinimized, isMacdMinimized, isExpandedFullScreen]);

  useEffect(() => {
    refs.current.markers?.setMarkers(buildChartMarkers({ patterns: visibleChartPatterns,
      highlightedPatternId: highlightedPattern?.id ?? null, annotations: drawings.annotations,
      trendlineStart, trendlineStartColor: selectedColor }));
  }, [visibleChartPatterns, highlightedPattern, drawings.annotations, trendlineStart, selectedColor, symbol, timeframe, theme]);

  useEffect(() => {
    const h = refs.current;
    const cs = h.candle;
    const chart = chartRef.current;
    if (!cs || !chart) return;
    h.priceLines.forEach(line => cs.removePriceLine(line)); h.trendlines.forEach(series => chart.removeSeries(series));
    h.priceLines = createHorizontalPriceLines(cs, drawings.horizontalLines);
    h.trendlines = createTrendlineSeries(chart, drawings.trendlines);
  }, [chartRef, drawings.horizontalLines, drawings.trendlines, symbol, timeframe, theme]);
  useEffect(() => { refs.current.redraw?.(); }, [params]);
}
