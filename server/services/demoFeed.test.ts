import { describe, expect, it } from 'vitest';
import { INSTRUMENTS, isExecutableQuote, parseQuote, quoteQuality, type SymbolCode } from '../../shared/market';
import { TIMEFRAMES } from '../../shared/timeframes';
import { isCalendarEvent } from '../../shared/calendar';
import { usableBar } from './bars';
import { demoCalendar, demoFeedEnabled, demoHistory, demoQuoteFor, demoValue } from './demoFeed';

const NOW = Date.UTC(2026, 8, 23, 12, 1, 2, 345);
const SYMBOLS = Object.keys(INSTRUMENTS) as SymbolCode[];

describe('APEX_DEMO_FEED gate', () => {
  it('is dev-only: unset, off, or production never enable it', () => {
    expect(demoFeedEnabled({})).toBe(false);
    expect(demoFeedEnabled({ APEX_DEMO_FEED: 'false' })).toBe(false);
    expect(demoFeedEnabled({ APEX_DEMO_FEED: '1' })).toBe(false);
    expect(demoFeedEnabled({ APEX_DEMO_FEED: 'true', NODE_ENV: 'test' })).toBe(true);
    expect(demoFeedEnabled({ APEX_DEMO_FEED: 'true', NODE_ENV: 'production' })).toBe(false);
  });
});

describe('deterministic synthetic quotes', () => {
  it('produces labelled, uncrossed, reference-quality quotes that can never execute', () => {
    const now = Date.now(); // parseQuote's future-timestamp guard runs against the real clock
    for (const symbol of SYMBOLS) {
      const raw = demoQuoteFor(symbol, now);
      expect(raw.price).toBeGreaterThan(0); expect(raw.bid).toBeLessThan(raw.price); expect(raw.ask).toBeGreaterThan(raw.price);
      expect(raw.high).toBeGreaterThanOrEqual(raw.price); expect(raw.low).toBeLessThanOrEqual(raw.price); expect(raw.low).toBeGreaterThan(0);
      const quote = parseQuote(symbol, raw)!;
      expect(quote.provider).toBe('demo'); expect(quote.instrumentKind).toBe('reference'); expect(quote.providerSymbol).toBe(`DEMO:${symbol}`);
      expect(quoteQuality(quote, now)).toBe('reference');
      expect(isExecutableQuote(quote, now)).toBe(false);
    }
  });
  it('is a pure deterministic function of (symbol, time) and still moves with the clock', () => {
    const first = SYMBOLS.map(s => demoValue(s, NOW));
    expect(SYMBOLS.map(s => demoValue(s, NOW))).toEqual(first);
    expect(new Set(first.map(v => v.toFixed(12))).size).toBe(SYMBOLS.length);
    expect(SYMBOLS.some(s => demoValue(s, NOW + 60_000) !== demoValue(s, NOW))).toBe(true);
  });
});

describe('demo history contract', () => {
  it('serves usable, ordered, aligned candles per timeframe with only the open bar provisional', () => {
    for (const timeframe of TIMEFRAMES) {
      const history = demoHistory('EURUSD', timeframe, NOW);
      expect(history.source).toBe('demo'); expect(history.instrumentKind).toBe('reference'); expect(history.fetchedAt).toBe(NOW);
      expect(history.data.length).toBeGreaterThan(50); expect(history.data.length).toBeLessThanOrEqual(1000);
      let previous = -1;
      for (const bar of history.data) {
        expect(usableBar(bar)).toBe(true);
        expect(bar.time).toBeGreaterThan(previous); previous = bar.time;
        expect(bar.time * 1000).toBeLessThanOrEqual(NOW);
        if (timeframe === 'W') expect((bar.time - 345_600) % 604_800).toBe(0); // Monday UTC grid, not epoch Thursday
        if (timeframe === 'D') expect(bar.time % 86_400).toBe(0);
        expect(bar.volume).toBeUndefined(); // synthetic series fabricates no traded volume
      }
      expect(history.data.filter(bar => bar.provisional).length).toBe(1);
      expect(history.data.at(-1)!.provisional).toBe(true);
    }
    expect(demoHistory('EURUSD', 'W', NOW)).toEqual(demoHistory('EURUSD', 'W', NOW));
  });
});

describe('demo calendar contract', () => {
  it('builds a Monday-UTC week of events that passes the browser boundary validator', () => {
    const week = demoCalendar(NOW);
    expect(week).toMatchObject({ success: true, source: 'demo', sourceUrl: '', fetchedAt: NOW, stale: false, currentWeek: true, weekStart: '2026-09-21' });
    expect(week.expiresAt).toBe(NOW + 3_600_000);
    expect(week.events.length).toBeGreaterThanOrEqual(14);
    for (const event of week.events) {
      expect(isCalendarEvent(event)).toBe(true);
      if (event.scheduledAt !== null) {
        expect(event.scheduledAt).toBeGreaterThanOrEqual(Date.parse('2026-09-21T00:00:00Z'));
        expect(event.scheduledAt).toBeLessThan(Date.parse('2026-09-28T00:00:00Z'));
      }
      if (event.timing !== 'scheduled') expect(event.scheduledAt).toBeNull();
    }
    expect(week.events.every(event => event.scheduledAt === null || event.scheduledAt > NOW ? event.actual === null : true)).toBe(true); // nothing is "released" before its scheduled time
    expect(week.events.some(event => event.timing === 'all-day')).toBe(true);
    expect(week.warning).toContain('demo');
    expect(demoCalendar(NOW)).toEqual(demoCalendar(NOW));
  });
});
