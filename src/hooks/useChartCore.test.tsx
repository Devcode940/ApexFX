// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChartCore, type UseChartCoreParams } from './useChartCore';
import { EMPTY_DRAWINGS } from '../types/chart';
import { renderHook } from '../test/harness';

const adapter = vi.hoisted(() => {
  const charts: any[] = [];
  const plugins: any[] = [];
  const createChart = vi.fn(() => {
    let removed = false; let range: any = null;
    const series: any[] = [];
    const scale = {
      setVisibleRange: vi.fn(r => { range = r; }), getVisibleRange: () => range, fitContent: vi.fn(),
      getVisibleLogicalRange: () => ({ from: 10, to: 50 }), setVisibleLogicalRange: vi.fn(),
      subscribeVisibleLogicalRangeChange: vi.fn(), unsubscribeVisibleLogicalRangeChange: vi.fn(() => { if (removed) throw new Error('Unsubscribe after remove'); }),
      subscribeSizeChange: vi.fn(), unsubscribeSizeChange: vi.fn(), timeToCoordinate: () => 10,
    };
    const chart: any = {
      series, scale, addSeries: vi.fn((_definition, options = {}) => {
        const s = { options, setData: vi.fn(), update: vi.fn(), removePriceLine: vi.fn(),
          createPriceLine: vi.fn(p => ({ ...p })), coordinateToPrice: () => 1.1, priceToCoordinate: () => 10 };
        series.push(s); return s;
      }),
      remove: vi.fn(() => { removed = true; }), resize: vi.fn(), removeSeries: vi.fn(), timeScale: () => scale,
      subscribeClick: vi.fn(), unsubscribeClick: vi.fn(), subscribeCrosshairMove: vi.fn(), unsubscribeCrosshairMove: vi.fn(),
    };
    charts.push(chart); return chart;
  });
  const createSeriesMarkers = vi.fn(() => { const api = { setMarkers: vi.fn(), detach: vi.fn() }; plugins.push(api); return api; });
  return { charts, plugins, createChart, createSeriesMarkers };
});
vi.mock('lightweight-charts', async original => ({ ...await original<object>(), createChart: adapter.createChart, createSeriesMarkers: adapter.createSeriesMarkers }));
const cleanups: (() => Promise<void>)[] = [];
beforeEach(() => {
  adapter.charts.length = 0; adapter.plugins.length = 0; vi.clearAllMocks();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.unstubAllGlobals(); });
function params(): UseChartCoreParams {
  const container = document.createElement('div'); Object.defineProperty(container, 'clientWidth', { value: 900 });
  return {
    containerRef: { current: container }, rsiContainerRef: { current: document.createElement('div') }, macdContainerRef: { current: document.createElement('div') },
    chartRef: { current: null }, rsiChartRef: { current: null }, macdChartRef: { current: null }, symbol: 'EURUSD', timeframe: '1H',
    data: Array.from({ length: 60 }, (_, i) => ({ time: 1_700_000_000 + i * 3600, open: 1.1, high: 1.12, low: 1.09, close: 1.1 })),
    indicators: { sma: true, ema: true, rsi: true, macd: true, bollinger: true, fibonacci: true }, theme: 'dark', chartHeight: 460,
    isExpandedFullScreen: false, isRsiMinimized: false, isMacdMinimized: false, drawings: EMPTY_DRAWINGS, setDrawings: vi.fn(),
    activeTool: 'none', setActiveTool: vi.fn(), trendlineStart: null, setTrendlineStart: vi.fn(), fibStart: null, setFibStart: vi.fn(),
    selectedColor: '#ffffff', setHudData: vi.fn(), patterns: [], visibleChartPatterns: [], highlightedPattern: null,
    sessionBlocks: [], showSessionShading: false, symbolTradesToAnimate: [], showTradeAnimations: false, showPatternBeams: false,
  };
}
describe('real indicator adapters, mocked chart SDK boundary', () => {
  it('updates candles AND retained SMA/EMA/BB/RSI/MACD series and keeps zoom across append', async () => {
    const p = params(); const hook = await renderHook((p: UseChartCoreParams) => useChartCore(p), p); cleanups.push(hook.unmount);
    expect(adapter.charts).toHaveLength(3); const main = adapter.charts[0];
    const overlays = adapter.charts.flatMap(c => c.series).filter(s => s.options.title);
    const values = overlays.map(s => s.setData.mock.calls.at(-1)[0].at(-1)?.value);
    const counts = overlays.map(s => s.setData.mock.calls.length);
    main.scale.setVisibleRange({ from: p.data[10].time, to: p.data[40].time });
    const view = main.scale.getVisibleRange();
    const updated = [...p.data.slice(0, -1), { ...p.data[59], close: 1.115 }];
    await hook.rerender({ ...p, data: updated, visibleChartPatterns: [] });
    expect(main.series[0].update).toHaveBeenCalledTimes(1);
    overlays.forEach((series, i) => {
      expect(series.setData.mock.calls.length, series.options.title).toBeGreaterThan(counts[i]);
      expect(series.setData.mock.calls.at(-1)[0].at(-1)?.value, series.options.title).not.toBe(values[i]);
    });
    const appended = [...updated, { ...updated[59], time: updated[59].time + 3600 }];
    await hook.rerender({ ...p, data: appended, chartHeight: 600 });
    expect(adapter.charts).toHaveLength(3); expect(main.remove).not.toHaveBeenCalled(); expect(main.scale.getVisibleRange()).toEqual(view);
    const crosshair = main.subscribeCrosshairMove.mock.calls[0][0];
    crosshair({ point: { x: 50, y: 50 }, time: appended[60].time, seriesData: new Map([[main.series[0], appended[60]]]) });
    expect(vi.mocked(p.setHudData).mock.calls.at(-1)?.[0]?.rsi).toBe(100);
  });
  it('attaches one marker primitive, updates it repeatedly, and detaches it on teardown', async () => {
    const p = params(); const hook = await renderHook((p: UseChartCoreParams) => useChartCore(p), p);
    expect(adapter.createSeriesMarkers).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 10; i++) await hook.rerender({ ...p, visibleChartPatterns: [] });
    expect(adapter.createSeriesMarkers).toHaveBeenCalledTimes(1); expect(adapter.plugins[0].setMarkers).toHaveBeenCalledTimes(11);
    await hook.unmount(); expect(adapter.plugins[0].detach).toHaveBeenCalledTimes(1);
  });
  it('applies corrections to older bars rather than only updating the last candle', async () => {
    const p = params(); const hook = await renderHook((p: UseChartCoreParams) => useChartCore(p), p); cleanups.push(hook.unmount);
    const candles = adapter.charts[0].series[0]; const calls = candles.setData.mock.calls.length;
    await hook.rerender({ ...p, data: p.data.map((bar, i) => i === 4 ? { ...bar, close: 1.11 } : bar) });
    expect(candles.setData.mock.calls.length).toBe(calls + 1); expect(candles.setData.mock.calls.at(-1)[0][4].close).toBe(1.11);
    expect(adapter.charts).toHaveLength(3);
  });
  it('toggles indicators without recreating the main chart; StrictMode cleanup releases every resource', async () => {
    const p = params(); const hook = await renderHook((p: UseChartCoreParams) => useChartCore(p), p, true);
    const main = p.chartRef.current;
    await hook.rerender({ ...p, indicators: { ...p.indicators, sma: false, rsi: false } });
    expect(p.chartRef.current).toBe(main);
    await hook.unmount();
    expect(adapter.plugins.every(plugin => plugin.detach.mock.calls.length === 1)).toBe(true);
    expect(adapter.charts.every(chart => chart.remove.mock.calls.length === 1)).toBe(true);
  });
});
