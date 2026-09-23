// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWeeklyCalendar } from './useWeeklyCalendar';
import { deferred, renderHook } from '../test/harness';
import { calendarFixture, CALENDAR_NOW as NOW } from '../test/calendarFixtures';

const response = (body: unknown = calendarFixture(), status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
const cleanups: (() => Promise<void>)[] = [];
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); vi.spyOn(document, 'hidden', 'get').mockReturnValue(false); });
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function mount(strict = false) {
  const hook = await renderHook(() => useWeeklyCalendar(), undefined, strict); cleanups.push(hook.unmount); return hook;
}

describe('weekly calendar lifecycle, body deadline and revalidation', () => {
  it('survives StrictMode replay, aborts the superseded fetch and ignores its late completion', async () => {
    const requests: { result: ReturnType<typeof deferred<Response>>; signal: AbortSignal }[] = [];
    vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => {
      const result = deferred<Response>(); requests.push({ result, signal: init.signal! }); return result.promise;
    }));
    const hook = await mount(true); expect(requests).toHaveLength(2); expect(requests[0].signal.aborted).toBe(true);
    await act(async () => requests[1].result.resolve(response()));
    expect(hook.result.data?.source).toBe('forexfactory'); expect(hook.result.loading).toBe(false);
    await act(async () => requests[0].result.resolve(response({ source: 'not-the-calendar' })));
    expect(hook.result.error).toBeNull(); expect(hook.result.data?.events).toHaveLength(1);
  });
  it('revalidates hourly rather than on a short price polling cadence and cleans up timers on unmount', async () => {
    const fetch = vi.fn(async () => response(calendarFixture(undefined, Date.now()))); vi.stubGlobal('fetch', fetch);
    const hook = await mount(); expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(3_599_999)); expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1)); expect(fetch).toHaveBeenCalledTimes(2);
    await hook.unmount(); cleanups.pop(); await vi.advanceTimersByTimeAsync(7_200_000); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('waits while hidden and revalidates when a stale tab becomes visible', async () => {
    const visibility = vi.spyOn(document, 'hidden', 'get'); visibility.mockReturnValue(false);
    const fetch = vi.fn(async () => response(calendarFixture(undefined, Date.now()))); vi.stubGlobal('fetch', fetch);
    await mount(); visibility.mockReturnValue(true);
    await act(async () => vi.advanceTimersByTimeAsync(3_600_000)); expect(fetch).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue(false); await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('preserves last-known-good data when an update returns malformed events', async () => {
    const fetch = vi.fn(async () => response()); vi.stubGlobal('fetch', fetch); const hook = await mount();
    const previous = hook.result.data;
    fetch.mockImplementation(async () => response({ ...calendarFixture(), events: [{ title: 'not-a-valid-event' }] }));
    await act(async () => hook.result.retry());
    expect(hook.result.data).toBe(previous); expect(hook.result.error).toContain('Invalid weekly calendar');
  });
  it('respects server Retry-After for automatic, manual and visibility retries, including non-JSON error bodies', async () => {
    const fetch = vi.fn(async () => new Response('<html>Unavailable</html>', { status: 429, headers: { 'Retry-After': '3600' } })); vi.stubGlobal('fetch', fetch);
    const hook = await mount(); expect(hook.result.retryAt).toBe(NOW + 3600_000); expect(hook.result.error).toBeTruthy();
    await act(async () => { hook.result.retry(); document.dispatchEvent(new Event('visibilitychange')); });
    await act(async () => vi.advanceTimersByTimeAsync(3599_999)); expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockImplementation(async () => response(calendarFixture(undefined, Date.now())));
    await act(async () => vi.advanceTimersByTimeAsync(1)); expect(fetch).toHaveBeenCalledTimes(2); expect(hook.result.error).toBeNull();
  });
  it('keeps a 15-second abort deadline through a stalled response body, not just the headers', async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url, init: RequestInit) => {
      signal = init.signal!;
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode('{"success":'));
        signal!.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
      } }));
    }));
    const hook = await mount(); expect(hook.result.loading).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(15_001));
    expect(signal?.aborted).toBe(true); expect(hook.result.loading).toBe(false); expect(hook.result.error).toContain('timed out');
  });
  it('aborts on unmount without letting an old request update another panel', async () => {
    const pending = deferred<Response>(); let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => { signal = init.signal!; return pending.promise; }));
    const hook = await mount(); await hook.unmount(); cleanups.pop(); expect(signal?.aborted).toBe(true);
    await act(async () => pending.resolve(response())); expect(hook.result.data).toBeNull();
  });
});
