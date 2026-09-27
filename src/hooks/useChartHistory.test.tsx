// @vitest-environment jsdom
import { act } from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useChartHistory } from './useChartHistory';
import { deferred, renderHook } from '../test/harness';
import { QuoteStore } from '../utils/quoteStore';
import { quote } from '../test/fixtures';

const bar = { time: 1_700_000_000, open: 1.1, high: 1.11, low: 1.09, close: 1.1 };
const response = (data: unknown = [bar], status = 200) => new Response(JSON.stringify({ success: status === 200, data, source: 'yahoo', providerSymbol: 'EURUSD=X', instrumentKind: 'spot' }), { status });
const requests: { result: ReturnType<typeof deferred<Response>>; signal?: AbortSignal | null }[] = [];
const cleanups: (() => Promise<void>)[] = [];
beforeEach(() => {
  requests.length = 0;
  vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
    const result = deferred<Response>(); requests.push({ result, signal: init?.signal }); return result.promise;
  }));
});
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function mount(strict = false, store?: QuoteStore) {
  const hook = await renderHook((symbol: string) => useChartHistory(symbol, '1H', store), 'EURUSD', strict);
  cleanups.push(hook.unmount); return hook;
}

describe('history request lifecycle with real React effects', () => {
  it('loads under root StrictMode replay and aborts the superseded first request', async () => {
    const hook = await mount(true);
    expect(requests).toHaveLength(2); expect(requests[0].signal?.aborted).toBe(true);
    await act(async () => { requests[0].result.resolve(response()); requests[1].result.resolve(response()); });
    expect(hook.result.historyStatus).toBe('ready'); expect(hook.result.activeData).toHaveLength(1);
  });
  it('A → B → A can refetch an aborted key; late completions cannot overwrite it', async () => {
    const hook = await mount();
    await hook.rerender('GBPUSD'); await hook.rerender('EURUSD');
    expect(requests).toHaveLength(3); expect(requests[0].signal?.aborted).toBe(true); expect(requests[1].signal?.aborted).toBe(true);
    await act(async () => requests[2].result.resolve(response([{ ...bar, close: 1.105 }])));
    await act(async () => { requests[0].result.resolve(response()); requests[1].result.resolve(response()); });
    expect(hook.result.activeData[0].close).toBe(1.105);
    expect(hook.result.chartData.GBPUSD).toBeUndefined();
  });
  it('retries a failed request instead of permanently marking it loaded', async () => {
    const hook = await mount(); await act(async () => requests[0].result.resolve(response([], 503)));
    expect(hook.result.historyStatus).toBe('error'); expect(hook.result.historyError).toBeTruthy();
    act(() => hook.result.retryHistory()); expect(requests).toHaveLength(2);
    await act(async () => requests[1].result.resolve(response()));
    expect(hook.result.historyStatus).toBe('ready'); expect(hook.result.activeData).toHaveLength(1);
  });
  it('uses a successful recent cache, but a forced refresh really retries', async () => {
    const hook = await mount(); await act(async () => requests[0].result.resolve(response()));
    await hook.rerender('GBPUSD'); await hook.rerender('EURUSD');
    expect(requests).toHaveLength(2); expect(hook.result.activeData).toHaveLength(1);
    act(() => hook.result.retryHistory()); expect(requests).toHaveLength(3);
  });
  it('does not abort/restart history because candle data changed', async () => {
    const hook = await mount();
    act(() => hook.result.setChartData({ EURUSD: { '1H': [bar] } }));
    expect(requests).toHaveLength(1); expect(requests[0].signal?.aborted).toBe(false);
    await act(async () => requests[0].result.resolve(response()));
    expect(hook.result.historyStatus).toBe('ready');
  });
  it('does not blend a spot quote into futures history', async () => {
    const store = new QuoteStore(); const hook = await mount(false, store);
    await act(async () => requests[0].result.resolve(new Response(JSON.stringify({ success: true, source: 'yahoo', instrumentKind: 'futures', providerSymbol: 'SI=F', data: [bar] }))));
    act(() => store.apply({ EURUSD: quote('EURUSD', 1.3) }));
    expect(hook.result.activeData).toHaveLength(1); expect(hook.result.activeData[0].close).toBe(1.1);
  });
  it('keeps a request deadline through the response body', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => new Promise<Response>((_yes, no) => {
      init.signal?.addEventListener('abort', () => no(new DOMException('Abort', 'AbortError')));
    })));
    const hook = await mount();
    await act(async () => vi.advanceTimersByTimeAsync(15_001));
    expect(hook.result.historyStatus).toBe('error'); expect(hook.result.historyError).toContain('timed out');
  });
});

describe('provider-consistent chart reconciliation', () => {
  const currentBar = () => ({ ...bar, time: Math.floor(Date.now() / 3600_000) * 3600 });
  const history = (source: 'tiingo' | 'yahoo', fetchedAt = Date.now(), data = [currentBar()]) => new Response(JSON.stringify({
    success: true, data, source, providerSymbol: source === 'tiingo' ? 'eurusd' : 'EURUSD=X', instrumentKind: 'spot', fetchedAt,
  }));
  it('does not mix same-kind quotes from a different provider or provider symbol into Tiingo OHLC', async () => {
    const store = new QuoteStore(); const hook = await mount(false, store);
    store.apply({ EURUSD: quote('EURUSD', 1.3) });
    await act(async () => requests[0].result.resolve(history('tiingo')));
    expect(hook.result.activeData[0].close).toBe(1.1);
    act(() => store.apply({ EURUSD: quote('EURUSD', 1.4, { provider: 'yahoo', providerSymbol: 'EURUSD=X' }) }));
    expect(hook.result.activeData[0].close).toBe(1.1);
    act(() => store.apply({ EURUSD: quote('EURUSD', 1.5, { provider: 'tiingo', providerSymbol: 'different-feed-symbol' }) }));
    expect(hook.result.activeData[0].close).toBe(1.1);
    act(() => store.apply({ EURUSD: quote('EURUSD', 1.12, { provider: 'tiingo', providerSymbol: 'eurusd' }) }));
    expect(hook.result.activeData[0].close).toBe(1.12);
  });
  it('discards local extrema from a different provider when a fallback chart recovers to Tiingo', async () => {
    const store = new QuoteStore(); const hook = await mount(false, store);
    await act(async () => requests[0].result.resolve(history('yahoo')));
    act(() => store.apply({ EURUSD: quote('EURUSD', 1.5, { provider: 'yahoo', providerSymbol: 'EURUSD=X' }) }));
    expect(hook.result.activeData[0].high).toBe(1.5);
    act(() => hook.result.retryHistory());
    await act(async () => requests[1].result.resolve(history('tiingo')));
    expect(hook.result.historyMeta?.provider).toBe('tiingo'); expect(hook.result.activeData[0].high).toBe(1.11);
  });
  it('preserves a touch/rebound observed after the original server snapshot when cached history is revalidated', async () => {
    vi.useFakeTimers(); const now = Math.floor(Date.now() / 3600_000) * 3600_000 + 30_000; vi.setSystemTime(now);
    const snapshotAt = now - 20_000;
    const store = new QuoteStore(); const hook = await mount(false, store);
    await act(async () => requests[0].result.resolve(history('tiingo', snapshotAt)));
    act(() => store.apply({ EURUSD: quote('EURUSD', 1.3, { provider: 'tiingo', providerSymbol: 'eurusd' }) }));
    vi.setSystemTime(now + 1000);
    act(() => store.apply({ EURUSD: quote('EURUSD', 1.12, { provider: 'tiingo', providerSymbol: 'eurusd' }) }));
    vi.setSystemTime(now + 2000); act(() => hook.result.retryHistory());
    await act(async () => requests[1].result.resolve(history('tiingo', snapshotAt)));
    expect(hook.result.activeData[0]).toMatchObject({ high: 1.3, close: 1.12, provisional: true });
  });
});
