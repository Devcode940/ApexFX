// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useScopedDrawings } from './useScopedDrawings';
import { drawingStorageKey } from '../utils/chart/drawingTools';
import { EMPTY_DRAWINGS } from '../types/chart';
import { renderHook } from '../test/harness';
const cleanups: (() => Promise<void>)[] = [];
beforeEach(() => localStorage.clear());
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); localStorage.clear(); });
describe('drawing ownership/key transitions', () => {
  it('loads the new symbol before any save and restores both symbols across switches', async () => {
    const eur = { ...EMPTY_DRAWINGS, horizontalLines: [1.1] }; const gbp = { ...EMPTY_DRAWINGS, horizontalLines: [1.3] };
    localStorage.setItem(drawingStorageKey('EURUSD'), JSON.stringify(eur)); localStorage.setItem(drawingStorageKey('GBPUSD'), JSON.stringify(gbp));
    const hook = await renderHook((symbol: string) => useScopedDrawings(symbol, 'guest'), 'EURUSD', true); cleanups.push(hook.unmount);
    await hook.rerender('GBPUSD'); expect(hook.result.drawings.horizontalLines).toEqual([1.3]);
    expect(JSON.parse(localStorage.getItem(drawingStorageKey('GBPUSD'))!).horizontalLines).toEqual([1.3]);
    await hook.rerender('EURUSD'); expect(hook.result.drawings.horizontalLines).toEqual([1.1]);
  });
  it('partitions drawings by account, and an old setter cannot save under a new identity', async () => {
    const hook = await renderHook((owner: string) => useScopedDrawings('EURUSD', owner), 'user:A', true); cleanups.push(hook.unmount);
    act(() => hook.result.setDrawings({ ...EMPTY_DRAWINGS, horizontalLines: [1.1] })); const staleSetter = hook.result.setDrawings;
    await hook.rerender('user:B'); expect(hook.result.drawings.horizontalLines).toEqual([]);
    act(() => staleSetter({ ...EMPTY_DRAWINGS, horizontalLines: [9] }));
    expect(hook.result.drawings.horizontalLines).toEqual([]);
    expect(JSON.parse(localStorage.getItem(drawingStorageKey('EURUSD', 'user:B'))!).horizontalLines).toEqual([]);
    await hook.rerender('user:A'); expect(hook.result.drawings.horizontalLines).toEqual([1.1]);
  });
  it('preserves malformed drawing storage instead of overwriting it with []', async () => {
    const key = drawingStorageKey('EURUSD'); localStorage.setItem(key, '{broken');
    const hook = await renderHook(() => useScopedDrawings('EURUSD', 'guest'), undefined, true); cleanups.push(hook.unmount);
    expect(hook.result.drawingError).toBeTruthy(); expect(localStorage.getItem(key)).toBe('{broken');
  });
});
