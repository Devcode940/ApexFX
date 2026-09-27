// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { PerformanceDashboard } from './PerformanceDashboard';
import { PositionsPanel } from './PositionsPanel';
import { AiAssistant } from './AiAssistant';
import { position, closed } from '../test/fixtures';
import { valuePnl } from '../utils/money';
import { deferred } from '../test/harness';

const context = vi.hoisted(() => ({ value: {} as any }));
vi.mock('../context/TradingContext', () => ({ useTrading: () => context.value }));
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>, AreaChart: ({ children }: any) => <svg>{children}</svg>,
  Area: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null, CartesianGrid: () => null, ReferenceLine: () => null,
}));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  context.value = { positions: [], closedTrades: [], theme: 'dark', account: { owner: 'user:A', session: { access_token: 'account-A-token' } },
    selectedSymbol: 'EURUSD', selectedTimeframe: '1H', currentPrice: 1.1, canTrade: false, watchlistItems: [], activeSignal: null,
    aiSnapshot: null, onClearAttachedImage: vi.fn(), handleOpenPosition: vi.fn(), handleClosePosition: vi.fn(), handleClearHistory: vi.fn() };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); localStorage.clear(); });
const render = async (node: React.ReactNode) => { await act(async () => root.render(node)); };

describe('currency/eligibility presentation consumes the real invariants', () => {
  it('shows USD totals and excludes unknown currency rows from statistical denominators', async () => {
    const jpy = { ...closed('jpy'), symbol: 'USDJPY', entryPrice: 150, exitPrice: 151, ...valuePnl('USDJPY', 'BUY', 150, 151, 1, [], Date.now()) };
    context.value.closedTrades = [closed('eur'), jpy, { ...closed('unknown'), symbol: 'GBPJPY', pnl: null, pnlQuote: 100000, quoteCurrency: 'JPY' }];
    await render(<PerformanceDashboard />);
    expect(host.textContent).toContain('Partial USD analytics'); expect(host.textContent).toContain('1662.25');
    expect(host.textContent).toContain('2 Wins / 2 Total Trades'); expect(host.textContent).toContain('∞ (no losses)');
    expect(host.textContent).not.toContain('99.90');
  });
  it('does not enable BUY/SELL from a positive historical display price, and labels unknown marks', async () => {
    context.value.positions = [{ ...position('unknown'), pnl: null, pnlQuote: 100000, quoteCurrency: 'JPY' }];
    await render(<PositionsPanel />);
    const orders = [...host.querySelectorAll('button')].filter(b => /Buy \/ Long|Sell \/ Short/.test(b.textContent ?? ''));
    expect(orders.length).toBeGreaterThanOrEqual(2); expect(orders.every(b => b.disabled)).toBe(true);
    expect(host.textContent).toContain('JPY (USD unavailable)'); expect(host.textContent).toContain('fresh, timestamped spot quote');
  });
});

describe('AI reset/account change cancels and discards late responses', () => {
  const template = () => [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Indicator Confluence'));
  it('a reset cannot let an old answer append or clear the next request’s typing state', async () => {
    const one = deferred<Response>(); const two = deferred<Response>();
    const fetch = vi.fn().mockReturnValueOnce(one.promise).mockReturnValueOnce(two.promise); vi.stubGlobal('fetch', fetch);
    await render(<AiAssistant />);
    const ask = template(); expect(ask).toBeTruthy();
    act(() => ask!.click()); expect(fetch).toHaveBeenCalledTimes(1);
    const signal = fetch.mock.calls[0][1].signal as AbortSignal;
    act(() => (host.querySelector('[title="Start new chat"]') as HTMLButtonElement).click()); expect(signal.aborted).toBe(true);
    act(() => template()!.click()); expect(fetch).toHaveBeenCalledTimes(2);
    await act(async () => one.resolve(new Response(JSON.stringify({ text: 'OLD_PRIVATE_ANSWER' }))));
    expect(host.textContent).not.toContain('OLD_PRIVATE_ANSWER');
    expect((host.querySelector('[aria-label="Send message"]') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => two.resolve(new Response(JSON.stringify({ text: 'CURRENT_ANSWER' }))));
    expect(host.textContent).toContain('CURRENT_ANSWER');
    expect((host.querySelector('[aria-label="Send message"]') as HTMLButtonElement).disabled).toBe(false);
  });
  it('sends the session Bearer and clears another account’s local conversation', async () => {
    const wait = deferred<Response>(); const fetch = vi.fn((_url: string, _init: RequestInit) => wait.promise); vi.stubGlobal('fetch', fetch);
    await render(<AiAssistant />); act(() => template()!.click());
    expect((fetch.mock.calls[0][1].headers as Record<string, string>).Authorization).toBe('Bearer account-A-token');
    const signal = fetch.mock.calls[0][1].signal as AbortSignal;
    context.value = { ...context.value, account: { owner: 'user:B', session: { access_token: 'account-B-token' } } };
    await render(<AiAssistant />); expect(signal.aborted).toBe(true);
    await act(async () => wait.resolve(new Response(JSON.stringify({ text: 'A_ONLY_RESPONSE' }))));
    expect(host.textContent).not.toContain('A_ONLY_RESPONSE');
  });
});
