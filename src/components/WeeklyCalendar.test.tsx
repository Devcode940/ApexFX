// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WeeklyCalendar } from './WeeklyCalendar';
import { calendarEvent, calendarFixture, CALENDAR_NOW as NOW } from '../test/calendarFixtures';
import type { CalendarEvent } from '../../shared/calendar';
import '../test/harness';

const context = vi.hoisted(() => ({ instance: undefined as import('react').Context<{ selectedSymbol: string }> | undefined }));
vi.mock('../context/TradingContext', async () => {
  const React = await import('react');
  context.instance = React.createContext({ selectedSymbol: 'EURUSD' });
  return { useTrading: () => React.useContext(context.instance!) };
});
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let events: CalendarEvent[];
let fetch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW); vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  events = [
    calendarEvent(),
    calendarEvent({ id: 'b'.repeat(24), title: 'EUR past fixture', currency: 'EUR', impact: 'LOW', actual: '0', scheduledAt: NOW - 3600_000 }),
    calendarEvent({ id: 'c'.repeat(24), title: 'GBP future fixture', currency: 'GBP', impact: 'MEDIUM' }),
    calendarEvent({ id: 'd'.repeat(24), title: 'JPY holiday fixture', currency: 'JPY', impact: 'HOLIDAY', timing: 'all-day', scheduledAt: null, sourceDate: '2026-09-23T00:00:00-04:00' }),
  ];
  fetch = vi.fn(async () => new Response(JSON.stringify(calendarFixture(events)))); vi.stubGlobal('fetch', fetch);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function render(symbol = 'EURUSD') {
  const Provider = context.instance!.Provider;
  await act(async () => root.render(<Provider value={{ selectedSymbol: symbol }}><WeeklyCalendar /></Provider>));
}
function viewerZone(zone: string) {
  const NativeFormatter = Intl.DateTimeFormat;
  vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
    return new NativeFormatter(locales, { ...options, timeZone: options?.timeZone ?? zone });
  } as typeof Intl.DateTimeFormat);
}
function checkbox(label: string) { return [...host.querySelectorAll('label')].find(node => node.textContent?.includes(label))!.querySelector('input')!; }

describe('default Forex Factory fundamentals panel', () => {
  it('shows source, timezone, null-aware values and no invented sentiment/release status', async () => {
    await render();
    expect(host.textContent).toContain('Weekly Economic Calendar'); expect(host.textContent).toContain('Forex Factory'); expect(host.textContent).toContain('not a live release feed');
    expect(host.textContent).toContain('USD event fixture'); expect(host.textContent).toContain('EUR past fixture'); expect(host.textContent).not.toContain('GBP future fixture');
    expect(host.querySelector('article dl')!.textContent).toContain('Actual—'); expect(host.textContent).toContain('3.2%');
    expect(host.textContent).toContain('Scheduled time passed'); expect(host.textContent).not.toMatch(/Bullish|Bearish|Released/);
    expect(host.querySelector('a')!.href).toBe('https://www.forexfactory.com/calendar');
  });
  it('filters currencies/impact/upcoming and switches the viewer zone without fetching per filter or symbol', async () => {
    await render();
    await act(async () => checkbox('High impact').click()); expect(host.querySelectorAll('article')).toHaveLength(1);
    await act(async () => checkbox('High impact').click());
    await act(async () => checkbox('Upcoming').click()); expect(host.textContent).not.toContain('EUR past fixture');
    await act(async () => checkbox('UTC').click()); expect(host.textContent).toContain('Times: UTC');
    await render('GBPJPY'); expect(host.textContent).toContain('GBP future fixture'); expect(host.textContent).toContain('JPY holiday fixture'); expect(host.textContent).toContain('All day');
    expect(host.textContent).not.toContain('USD event fixture'); expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => { const select = host.querySelector('select')!; select.value = 'all'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(host.textContent).toContain('USD event fixture'); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('converts scheduled instants to the viewer’s Nairobi timezone without changing source timestamps', async () => {
    viewerZone('Africa/Nairobi');
    await render(); expect(host.textContent).toContain('Times: Africa/Nairobi');
    const expected = new Intl.DateTimeFormat(undefined, { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit' }).format(NOW + 3600_000);
    expect(host.querySelector('article')!.textContent).toContain(expected);
    await act(async () => checkbox('UTC').click());
    expect(host.textContent).toContain('Times: UTC'); expect(events[0].scheduledAt).toBe(NOW + 3600_000); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not shift an all-day holiday to the previous day for a western viewer', async () => {
    viewerZone('America/Los_Angeles');
    await render('GBPJPY');
    const holiday = [...host.querySelectorAll('article')].find(a => a.textContent?.includes('JPY holiday fixture'))!;
    const expected = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(Date.parse('2026-09-23T00:00:00Z'));
    expect(holiday.textContent).toContain(expected); expect(holiday.textContent).toContain('All day');
  });
  it('keeps valid date-only TBA dates but does not normalize an invalid February date into March', async () => {
    events = [calendarEvent({ timing: 'unknown', scheduledAt: null, sourceDate: '2026-09-23' }), calendarEvent({ id: 'f'.repeat(24), title: 'Invalid source date fixture', timing: 'unknown', scheduledAt: null, sourceDate: '2026-02-30T09:00:00Z' })];
    await render(); const articles = host.querySelectorAll('article');
    const expected = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(Date.parse('2026-09-23T00:00:00Z'));
    expect(articles[0].textContent).toContain(expected); expect(articles[0].textContent).toContain('Time TBA');
    expect(articles[1].textContent).toContain('Date unavailable'); expect(articles[1].textContent).not.toContain('Mar');
  });
  it('paginates locally and resets the page on a currency-filter change', async () => {
    events = Array.from({ length: 8 }, (_, i) => calendarEvent({ id: i.toString(16).padStart(24, '0'), title: `Page event ${i}` }));
    await render(); expect(host.querySelectorAll('article')).toHaveLength(6);
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Next')!.click());
    expect(host.querySelectorAll('article')).toHaveLength(2); expect(host.textContent).toContain('2/2');
    await render('GBPJPY'); expect(host.textContent).toContain('No events match these filters.'); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('keeps the previous events but clearly marks an expired/failed refresh and disables cooldown retries', async () => {
    await render(); fetch.mockImplementation(async () => new Response(JSON.stringify({ error: 'Export rate-limited.' }), { status: 503, headers: { 'Retry-After': '3600' } }));
    await act(async () => vi.advanceTimersByTimeAsync(3600_000));
    expect(host.textContent).toContain('USD event fixture'); expect(host.textContent).toContain('Update failed'); expect(host.textContent).toContain('Export rate-limited.');
    expect((host.querySelector('[aria-label="Refresh weekly calendar"]') as HTMLButtonElement).disabled).toBe(true);
    expect(host.querySelector('[role="status"]')).not.toBeNull();
  });
});
