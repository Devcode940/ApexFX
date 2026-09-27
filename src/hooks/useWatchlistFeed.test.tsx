// @vitest-environment jsdom
import { act } from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useWatchlistFeed, retryAfterMs } from './useWatchlistFeed';
import { QuoteStore } from '../utils/quoteStore';
import { quote } from '../test/fixtures';
import { deferred, renderHook } from '../test/harness';

class Socket {
  static instances: Socket[] = [];
  onopen?: () => void; onclose?: () => void; onerror?: () => void; onmessage?: (e: { data: string }) => void;
  closed = false;
  constructor(readonly url: string) { Socket.instances.push(this); }
  open() { this.onopen?.(); }
  frame(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
  close() { if (!this.closed) { this.closed = true; this.onclose?.(); } }
}
const json = (value: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(value), { status, headers });
const cleanups: (() => Promise<void>)[] = [];
let websocket = false;
let prices: () => Promise<Response>;
let token: () => Promise<Response>;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(Date.UTC(2026, 8, 23, 12)); Socket.instances = []; websocket = false;
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  vi.stubGlobal('WebSocket', Socket);
  prices = async () => json({ success: true, rates: { EURUSD: quote() } }); token = async () => json({ token: 'opaque-token' });
  fetchMock = vi.fn((url: string) => url === '/api/market/prices' ? prices() : url === '/api/capabilities' ? Promise.resolve(json({ websocket })) : url === '/api/ws/token' ? token() : Promise.reject(new Error(`Unexpected URL ${url}`)));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function mount(accessToken?: string) {
  const store = new QuoteStore(); const hook = await renderHook((token?: string) => useWatchlistFeed(store, token), accessToken); cleanups.push(hook.unmount);
  await act(async () => vi.advanceTimersByTimeAsync(0)); return { hook, store };
}
const calls = (path: string) => fetchMock.mock.calls.filter(call => call[0] === path);
describe('transport capability, auth and freshness state machine', () => {
  it('polls independently and never attempts a socket when capabilities say polling-only', async () => {
    const { hook } = await mount();
    expect(hook.result.feedStatus).toBe('polling'); expect(Socket.instances).toHaveLength(0);
    await act(async () => vi.advanceTimersByTimeAsync(2501)); expect(calls('/api/market/prices')).toHaveLength(2);
    expect(calls('/api/ws/token')).toHaveLength(0);
  });
  it('uses POST + Bearer, never opens tokenless sockets, and stops auth retry storms', async () => {
    websocket = true; token = async () => json({ error: 'Sign in' }, 401);
    const { hook } = await mount('selected-account-token');
    expect(calls('/api/ws/token')[0][1]).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer selected-account-token' } });
    expect(Socket.instances).toHaveLength(0);
    await act(async () => vi.advanceTimersByTimeAsync(65_000));
    expect(calls('/api/ws/token')).toHaveLength(1); expect(hook.result.feedStatus).toBe('polling');
  });
  it('ignores a late token after unmount rather than creating an orphan connection', async () => {
    websocket = true; const wait = deferred<Response>(); token = () => wait.promise;
    const { hook } = await mount();
    const signal = calls('/api/ws/token')[0][1].signal as AbortSignal;
    await hook.unmount(); cleanups.pop(); expect(signal.aborted).toBe(true);
    await act(async () => wait.resolve(json({ token: 'too-late' })));
    expect(Socket.instances).toHaveLength(0);
  });
  it('does not equate OPEN with live; validated fresh data promotes it and a watchdog restores polling', async () => {
    websocket = true; const { hook } = await mount(); const ws = Socket.instances[0];
    act(() => ws.open()); expect(hook.result.wsConnected).toBe(true); expect(hook.result.feedStatus).not.toBe('live');
    act(() => ws.frame({ type: 'PRICE_UPDATE', rates: { EURUSD: { price: 1.1 } } }));
    expect(hook.result.feedStatus).toBe('degraded');
    act(() => ws.frame({ type: 'PRICE_UPDATE', rates: { EURUSD: quote('EURUSD', 1.12) } }));
    expect(hook.result.feedStatus).toBe('live'); expect(hook.result.feedSource).toBe('twelvedata');
    await act(async () => vi.advanceTimersByTimeAsync(55_000));
    expect(ws.closed).toBe(true); expect(calls('/api/market/prices').length).toBeGreaterThan(1);
  });
  it('honors Retry-After larger than normal backoff, including across visibility changes', async () => {
    prices = async () => json({ error: 'throttled' }, 429, { 'Retry-After': '90' });
    await mount();
    await act(async () => vi.advanceTimersByTimeAsync(35_000));
    act(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    act(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
    await act(async () => vi.advanceTimersByTimeAsync(54_999)); expect(calls('/api/market/prices')).toHaveLength(1);
    await act(async () => vi.advanceTimersByTimeAsync(1)); expect(calls('/api/market/prices')).toHaveLength(2);
    expect(retryAfterMs('90')).toBe(90_000);
    expect(retryAfterMs(new Date(Date.now() + 90_000).toUTCString())).toBe(90_000);
  });
  it('marks cached positive prices stale as they age and cleans all timers', async () => {
    const staleAfter = quote(); prices = async () => json({ success: true, rates: { EURUSD: staleAfter } });
    const { hook } = await mount();
    await act(async () => vi.advanceTimersByTimeAsync(125_000));
    expect(hook.result.watchlistItems[0].price).toBe(1.1); expect(hook.result.feedStatus).toBe('degraded');
    await hook.unmount(); cleanups.pop(); expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps directional flashes as presentation only', async () => {
    const { hook, store } = await mount();
    act(() => store.apply({ EURUSD: quote('EURUSD', 1.11) })); expect(hook.result.tickStates.EURUSD).toBe('up');
    act(() => store.apply({ EURUSD: quote('EURUSD', 1.09) })); expect(hook.result.tickStates.EURUSD).toBe('down');
    await act(async () => vi.advanceTimersByTimeAsync(901)); expect(hook.result.tickStates.EURUSD).toBeUndefined();
  });
});
