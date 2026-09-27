import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { fetchWithTimeout } from '../lib/fetch';
import { ForexFactoryCalendar, parseForexFactoryEvents, redisCalendarStore, FOREX_FACTORY_FEED, type CalendarStore } from './forexFactory';
import { calendarResponse, calendarEventAffects, isCalendarEvent, forexFactoryWeekStart, CALENDAR_REFRESH_MS, CALENDAR_MAX_AGE_MS, type CalendarSnapshot } from '../../shared/calendar';
import { CALENDAR_NOW as NOW, rawCalendarEvents as rows } from '../../src/test/calendarFixtures';

const json = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', ...headers } });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Forex Factory public export normalization, not a live release/price feed', () => {
  it('keeps source currency, explicit UTC offset, impact and only actually supplied values', () => {
    const events = parseForexFactoryEvents(rows); expect(events.every(isCalendarEvent)).toBe(true);
    const survey = events.find(e => e.currency === 'USD')!;
    expect(survey).toMatchObject({ currency: 'USD', impact: 'HIGH', scheduledAt: Date.parse('2026-09-23T13:45:00Z'), forecast: '51.7', previous: '52.0', actual: null, timing: 'scheduled' });
    const holiday = events.find(e => e.currency === 'JPY')!;
    expect(holiday).toMatchObject({ impact: 'HOLIDAY', timing: 'all-day', scheduledAt: null, sourceDate: rows[2].date, actual: null });
    expect(events.every(e => !('sentiment' in e) && !('price' in e) && !('released' in e))).toBe(true);
  });
  it('preserves zero and text releases without inferring results from passed scheduled times', () => {
    const [event] = parseForexFactoryEvents([{ ...rows[0], date: '2026-09-21T09:00:00-04:00', actual: 0, forecast: 'Unchanged', previous: null }]);
    expect(event.actual).toBe('0'); expect(event.forecast).toBe('Unchanged'); expect(event.previous).toBeNull();
    expect(parseForexFactoryEvents([{ ...rows[0], date: '2026-09-21T09:00:00-04:00' }])[0].actual).toBeNull();
  });
  it.each(['Tentative', 'Time TBA', 'To Be Announced'])('does not turn an explicit %s time into an exact scheduled timestamp', time => {
    const [event] = parseForexFactoryEvents([{ ...rows[0], time }]);
    expect(event.scheduledAt).toBeNull(); expect(event.timing).not.toBe('scheduled'); expect(event.sourceDate).toBe(rows[0].date);
  });
  it.each(['2026-09-23T09:00:00', '2026-02-30T09:00:00Z', 'Not scheduled'])('does not invent a timestamp for %s', date => {
    expect(parseForexFactoryEvents([{ ...rows[0], date }])[0].scheduledAt).toBeNull();
  });
  it('deduplicates stable event IDs while allowing a revised forecast/actual to replace the old values', () => {
    const one = parseForexFactoryEvents([rows[0]])[0];
    const revised = parseForexFactoryEvents([rows[0], { ...rows[0], actual: '53.0' }]);
    expect(revised).toHaveLength(1); expect(revised[0].id).toBe(one.id); expect(revised[0].actual).toBe('53.0');
    expect(calendarEventAffects(one, 'XAUUSD')).toBe(true); expect(calendarEventAffects(one, 'GBPJPY')).toBe(false);
  });
  it('rejects broken/oversized exports rather than caching malformed rows', () => {
    for (const bad of ['<html>Denied</html>', {}, [{ ...rows[0], title: null }], [{ ...rows[0], country: 'US dollar' }], Array(2001).fill(rows[0])]) expect(() => parseForexFactoryEvents(bad)).toThrow();
  });
  it('uses the New York Sunday source week through UTC, DST and year boundaries', () => {
    expect(forexFactoryWeekStart(Date.parse('2026-09-27T03:59:59Z'))).toBe('2026-09-20');
    expect(forexFactoryWeekStart(Date.parse('2026-09-27T04:00:00Z'))).toBe('2026-09-27');
    expect(forexFactoryWeekStart(Date.parse('2026-01-04T04:59:59Z'))).toBe('2025-12-28');
    expect(forexFactoryWeekStart(Date.parse('2026-01-04T05:00:00Z'))).toBe('2026-01-04');
  });
  it('marks a just-fetched previous-week export stale and leaves an empty week unknown, not fabricated', () => {
    const old = calendarResponse({ version: 1, fetchedAt: NOW, events: parseForexFactoryEvents([{ ...rows[0], date: '2026-09-16T09:45:00-04:00' }]) }, NOW);
    expect(old.currentWeek).toBe(false); expect(old.stale).toBe(true); expect(old.warning).toContain('not for the current');
    const empty = calendarResponse({ version: 1, fetchedAt: NOW, events: [] }, NOW);
    expect(empty.currentWeek).toBeNull(); expect(empty.coverageStart).toBeNull(); expect(empty.events).toEqual([]);
  });
});

describe('hourly export refresh, failure cooldowns and shared lease', () => {
  it('coalesces concurrent requests and never refetches within an hour', async () => {
    const fetch = vi.fn<typeof fetchWithTimeout>(async () => json(rows)); const calendar = new ForexFactoryCalendar(fetch);
    const values = await Promise.all(Array.from({ length: 8 }, () => calendar.get(null)));
    expect(fetch).toHaveBeenCalledTimes(1); expect(values.every(r => r.fetchedAt === NOW && !r.stale)).toBe(true);
    expect(fetch.mock.calls[0][0]).toBe(FOREX_FACTORY_FEED);
    vi.setSystemTime(NOW + CALENDAR_REFRESH_MS - 1); await calendar.get(null); expect(fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(NOW + CALENDAR_REFRESH_MS); await calendar.get(null); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('keeps last-known-good events visibly stale on HTML failure; retries only after the source cooldown', async () => {
    const fetch = vi.fn<typeof fetchWithTimeout>(async () => json(rows)); const calendar = new ForexFactoryCalendar(fetch);
    const initial = await calendar.get(null);
    vi.setSystemTime(NOW + CALENDAR_REFRESH_MS); fetch.mockImplementation(async () => new Response('<html>Request denied</html>', { headers: { 'Content-Type': 'text/html' } }));
    const stale = await calendar.get(null); expect(stale.events).toEqual(initial.events); expect(stale.fetchedAt).toBe(NOW); expect(stale.stale).toBe(true); expect(stale.warning).toContain('HTML');
    vi.setSystemTime(NOW + CALENDAR_REFRESH_MS * 2 - 1); await calendar.get(null); expect(fetch).toHaveBeenCalledTimes(2);
    vi.setSystemTime(NOW + CALENDAR_REFRESH_MS * 2); fetch.mockImplementation(async () => json(rows)); await calendar.get(null); expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('negative-caches an initial failed attempt, including Retry-After, without extending cooldown on every reader', async () => {
    const fetch = vi.fn<typeof fetchWithTimeout>(async () => new Response('Request denied', { status: 429, headers: { 'Retry-After': '7200' } }));
    const calendar = new ForexFactoryCalendar(fetch);
    await expect(calendar.get(null)).rejects.toMatchObject({ retryAfterSeconds: 7200 });
    for (const offset of [60_000, 3600_000, 7199_999]) {
      vi.setSystemTime(NOW + offset); await expect(calendar.get(null)).rejects.toThrow();
    }
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(NOW + 7200_000); fetch.mockImplementation(async () => json(rows)); await calendar.get(null); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('supports conditional export validation, not repeated full source downloads', async () => {
    const fetch = vi.fn<typeof fetchWithTimeout>(async () => json(rows, { ETag: 'fixture-etag' })); const calendar = new ForexFactoryCalendar(fetch);
    const first = await calendar.get(null); vi.setSystemTime(NOW + CALENDAR_REFRESH_MS);
    fetch.mockImplementation(async () => new Response(null, { status: 304 })); const next = await calendar.get(null);
    expect(next.events).toEqual(first.events); expect(next.fetchedAt).toBe(Date.now());
    expect(fetch.mock.calls[1][1]?.headers).toMatchObject({ 'If-None-Match': 'fixture-etag' });
  });
  it('expires an unusably old snapshot instead of silently serving it forever', async () => {
    const fetch = vi.fn<typeof fetchWithTimeout>(async () => json(rows)); const calendar = new ForexFactoryCalendar(fetch); await calendar.get(null);
    vi.setSystemTime(NOW + CALENDAR_MAX_AGE_MS); fetch.mockRejectedValue(new Error('Unavailable'));
    await expect(calendar.get(null)).rejects.toThrow('failed');
  });
  it('requires the shared cache when requested and never bypasses that requirement', async () => {
    const fetch = vi.fn<typeof fetchWithTimeout>(async () => json(rows)); const calendar = new ForexFactoryCalendar(fetch);
    await expect(calendar.get(null, true)).rejects.toMatchObject({ code: 'CALENDAR_CACHE_NOT_CONFIGURED', retryAfterSeconds: 3600 }); expect(fetch).not.toHaveBeenCalled();
  });
  it('uses one atomic source-refresh lease across two instances, then reads the shared snapshot', async () => {
    let saved: CalendarSnapshot | null = null; let until = 0;
    const store: CalendarStore = {
      read: vi.fn(async () => saved),
      claimRefresh: vi.fn(async (next: number) => { if (until > Date.now()) return false; until = next; return true; }),
      save: vi.fn(async (value: CalendarSnapshot) => { saved = value; }), postponeRefresh: vi.fn(async (next: number) => { until = Math.max(until, next); }),
    };
    const fetch = vi.fn<typeof fetchWithTimeout>(async () => json(rows)); const a = new ForexFactoryCalendar(fetch); const b = new ForexFactoryCalendar(fetch);
    const results = await Promise.allSettled([a.get(store, true), b.get(store, true)]);
    expect(results.some(r => r.status === 'fulfilled')).toBe(true); expect(fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(NOW + 30_000); expect((await b.get(store, true)).events).toEqual(saved!.events); expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.claimRefresh).toHaveBeenCalledTimes(2);
  });
  it('throttles failing shared-cache reads too, and never treats failure as permission to hit the source', async () => {
    const fetch = vi.fn<typeof fetchWithTimeout>(async () => json(rows)); const store: CalendarStore = { read: vi.fn(async () => { throw new Error('Redis down'); }), claimRefresh: vi.fn(), save: vi.fn(), postponeRefresh: vi.fn() };
    const calendar = new ForexFactoryCalendar(fetch);
    for (let i = 0; i < 5; i++) await expect(calendar.get(store, true)).rejects.toThrow();
    expect(store.read).toHaveBeenCalledTimes(1); expect(store.claimRefresh).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    vi.setSystemTime(NOW + 30_000); await expect(calendar.get(store, true)).rejects.toThrow(); expect(store.read).toHaveBeenCalledTimes(2);
  });
  it('uses NX/PX shared leases, bounded snapshot TTL and a max-only Retry-After extension protocol', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://calendar-cache.fixture'); vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'fixture-not-a-credential');
    const commands: (string | number)[][] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init: RequestInit) => {
      const command = JSON.parse(String(init.body)); commands.push(command);
      return json({ result: command[0] === 'GET' ? null : command[0] === 'EVAL' ? 1 : 'OK' });
    }));
    const store = redisCalendarStore()!;
    expect(await store.read()).toBeNull(); expect(await store.claimRefresh(NOW + CALENDAR_REFRESH_MS)).toBe(true);
    await store.save({ version: 1, fetchedAt: NOW, events: parseForexFactoryEvents(rows) }); await store.postponeRefresh(NOW + 7200_000);
    expect(commands[1].slice(3)).toEqual(['NX', 'PX', CALENDAR_REFRESH_MS]);
    expect(commands[2].slice(-2)).toEqual(['PX', CALENDAR_MAX_AGE_MS]);
    expect(commands[3][0]).toBe('EVAL'); expect(commands[3][1]).toContain('tonumber(ARGV[1]) > old');
    expect(commands.every(c => String(c[1]).includes('apexfx:forexfactory') || c[0] === 'EVAL')).toBe(true);
  });
});
