import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { interpretTiingoMessage, tiingoStreamEnabled, tiingoStreamHealthy, startTiingoStream, __tiingoStreamTestHooks } from './tiingoStream';
import { serverWatchlist } from './market';

type Fake = { url: string; readyState: number; sent: string[]; open(): void; frame(data: unknown): void; fire(event: string, ...args: unknown[]): void; terminated: boolean; };
// vi.mock factories are hoisted above module declarations, so the fake lives inside the factory
// and is shared via globalThis rather than a top-level class reference.
vi.mock('ws', () => {
  class FakeWebSocket {
    static OPEN = 1; static CONNECTING = 0; static CLOSED = 3;
    static instances: FakeWebSocket[] = [];
    readyState = 0;
    handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    sent: string[] = [];
    terminated = false;
    constructor(public url: string) { FakeWebSocket.instances.push(this); }
    on(event: string, cb: (...args: unknown[]) => void) { (this.handlers[event] ||= []).push(cb); }
    once(event: string, cb: (...args: unknown[]) => void) { this.on(event, cb); }
    send(payload: string) { this.sent.push(payload); }
    close() { this.readyState = 3; this.fire('close'); }
    terminate() { this.terminated = true; this.readyState = 3; }
    fire(event: string, ...args: unknown[]) { for (const cb of this.handlers[event] ?? []) cb(...args); }
    open() { this.readyState = 1; this.fire('open'); }
    frame(data: unknown) { this.fire('message', typeof data === 'string' ? data : JSON.stringify(data)); }
  }
  (globalThis as Record<string, unknown>).__FakeWebSocket = FakeWebSocket;
  return { WebSocket: FakeWebSocket };
});
const FakeWebSocket = (globalThis as Record<string, any>).__FakeWebSocket;

const NOW = Date.parse('2026-09-27T12:00:00Z');

describe('interpretTiingoMessage', () => {
  const fx = (data: unknown, messageType = 'A') => JSON.stringify({ service: 'fx', messageType, data });
  const q = (overrides: unknown[] = []) => ['Q', 'eurusd', new Date(NOW).toISOString(), ...overrides.length ? overrides : [2, 1.1, 1.1002, 1.1004, 3, 1.1008]];
  it('accepts a documented top-of-book frame and derives the midpoint', () => {
    const event = interpretTiingoMessage(fx(['Q', 'eurusd', new Date(NOW).toISOString(), 2, 1.10, 999, 3, 1.1002]));
    expect(event).toMatchObject({ kind: 'quote', symbol: 'EURUSD', bid: 1.1, ask: 1.1002 });
    expect(event && event.kind === 'quote' && event.mid).toBeCloseTo(1.1 + 0.0002 / 2, 10);
  });
  it('accepts both single-array and batched data shapes', () => {
    expect(interpretTiingoMessage(fx(q([2, 1.1, 1.1002, 3, 1.1004])))).toMatchObject({ kind: 'quote' });
    expect(interpretTiingoMessage(fx([q([2, 1.1, 1.1002, 3, 1.1004])]))).toMatchObject({ kind: 'quote' });
  });
  it('reports heartbeats and ignores everything else', () => {
    expect(interpretTiingoMessage(fx(undefined, 'H'))).toEqual({ kind: 'heartbeat' });
    expect(interpretTiingoMessage('not json')).toBeNull();
    expect(interpretTiingoMessage(fx('scalar'))).toBeNull();
    expect(interpretTiingoMessage(JSON.stringify({ service: 'timeandsales', messageType: 'A', data: q() }))).toBeNull();
    expect(interpretTiingoMessage(fx(['Q', 'zzznotarealsymbol', new Date(NOW).toISOString(), 2, 1, 1.01, 1, 1.02]))).toBeNull();
    expect(interpretTiingoMessage(fx(['T', 'eurusd', new Date(NOW).toISOString(), 5, 1.1002, 'sell']))).toBeNull(); // trades are not quotes
    expect(interpretTiingoMessage(fx(['Q', 'eurusd', new Date(NOW).toISOString(), 2, 1.2, 1.21, 1, 1.19]))).toBeNull(); // crossed book bid>ask
    expect(interpretTiingoMessage(fx(['Q', 'eurusd', 'nonsense-date', 2, 1.1, 1.1002, 1, 1.1004]))).toBeNull();
  });
});

describe('startTiingoStream lifecycle', () => {
  let stop: () => void;
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    FakeWebSocket.instances.length = 0;
    __tiingoStreamTestHooks.reset();
    vi.stubEnv('TIINGO_API_KEY', 'fixture-stream-key');
    vi.stubEnv('TIINGO_WS_ENABLED', 'true');
    vi.stubEnv('VERCEL', ''); vi.stubEnv('MARKET_DATA_MODE', '');
  });
  afterEach(() => { stop?.(); vi.useRealTimers(); vi.unstubAllEnvs(); });

  it('stays disabled without the explicit opt-in, even with a key', () => {
    vi.stubEnv('TIINGO_WS_ENABLED', '');
    expect(tiingoStreamEnabled()).toBe(false);
    const noop = startTiingoStream(vi.fn());
    expect(noop()).toBeUndefined();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('subscribes on open, applies quotes, throttles broadcasts, and tracks health', async () => {
    const broadcast = vi.fn();
    stop = startTiingoStream(broadcast);
    expect(tiingoStreamEnabled()).toBe(true);
    const socket = FakeWebSocket.instances[0]!;
    expect(socket.url).toBe('wss://api.tiingo.com/fx');
    socket.open();
    const subscribe = JSON.parse(socket.sent[0]!);
    expect(subscribe.eventData).toMatchObject({ eventName: 'subscribe', authToken: 'fixture-stream-key', service: 'fx', threshold: 5 });
    expect(subscribe.eventData.symbols).toContain('eurusd');
    const item = serverWatchlist.find(entry => entry.symbol === 'EURUSD')!;
    socket.frame({ service: 'fx', messageType: 'A', data: ['Q', 'eurusd', new Date(NOW).toISOString(), 2, 1.23, 1.2302, 1, 1.2304] });
    expect(item.bid).toBe(1.23); expect(item.ask).toBe(1.2304); expect(item.provider).toBe('tiingo');
    expect(broadcast).not.toHaveBeenCalled(); // coalesced
    await vi.advanceTimersByTimeAsync(600);
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(tiingoStreamHealthy()).toBe(true);
    await vi.advanceTimersByTimeAsync(45_001);
    expect(tiingoStreamHealthy()).toBe(false); // stale stream must not suppress the REST poller
  });
});
