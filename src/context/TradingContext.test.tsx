// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { TradingProvider, useTrading } from './TradingContext';
import '../test/harness';
vi.mock('../lib/supabase', () => ({ requireSupabaseClient: () => null, isSupabaseConfigured: false }));
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
it('positive historical display fallback cannot enable execution, and timeframe events are validated', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/history?') ? {
    success: true, source: 'yahoo', instrumentKind: 'spot', providerSymbol: 'EURUSD=X',
    data: [{ time: 1700000000, open: 1.1, high: 1.2, low: 1, close: 1.15 }],
  } : url === '/api/capabilities' ? { websocket: false } : { success: false, rates: {} }))));
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  let current!: ReturnType<typeof useTrading>;
  function Probe() { current = useTrading(); return null; }
  try {
    await act(async () => root.render(<TradingProvider><Probe /></TradingProvider>));
    expect(current.currentPrice).toBe(1.15); expect(current.canTrade).toBe(false);
    expect(current.handleOpenPosition('BUY', 1)).toEqual({ ok: false, reason: 'NO_PRICE' });
    await act(async () => window.dispatchEvent(new CustomEvent('apexfx:timeframe', { detail: { timeframe: '5m' } })));
    expect(current.selectedTimeframe).toBe('5m');
    await act(async () => window.dispatchEvent(new CustomEvent('apexfx:timeframe', { detail: { timeframe: 'unsupported' } })));
    expect(current.selectedTimeframe).toBe('5m');
    await act(async () => window.dispatchEvent(new CustomEvent('apexfx:timeframe', { detail: { timeframe: 'W' } })));
    expect(current.selectedTimeframe).toBe('W');
    for (const invalid of ['constructor', '__proto__', 'toString', 'M']) {
      await act(async () => window.dispatchEvent(new CustomEvent('apexfx:timeframe', { detail: { timeframe: invalid } })));
      expect(current.selectedTimeframe).toBe('W');
    }
  } finally { await act(async () => root.unmount()); host.remove(); }
});
