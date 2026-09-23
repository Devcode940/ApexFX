/**
 * Dev-only deterministic synthetic feed so the preview is usable without network access or
 * provider keys. Everything it produces is labelled `provider: 'demo'` with reference kind,
 * which `isExecutableQuote` can never accept — paper trading stays disabled by construction.
 * A production runtime ignores the flag entirely.
 */
import { INSTRUMENTS, isSymbol, type SymbolCode } from '../../shared/market';
import type { Candlestick } from '../../src/types';
import type { MarketHistoryResponse } from '../../shared/history';
import { TIME_CONFIG, candleBucketStart, type Timeframe } from '../../shared/timeframes';
import { calendarResponse, type CalendarEvent, type WeeklyCalendarResponse } from '../../shared/calendar';
import { warn } from '../lib/logger';

let warnedProduction = false;
export function demoFeedEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.APEX_DEMO_FEED !== 'true') return false;
  if (env.NODE_ENV === 'production') {
    if (!warnedProduction) { warnedProduction = true; warn('[DemoFeed] APEX_DEMO_FEED is ignored in production; refusing to serve synthetic market data.'); }
    return false;
  }
  return true;
}

const BASE: Record<SymbolCode, number> = { EURUSD: 1.172, GBPUSD: 1.348, USDJPY: 147.8, AUDUSD: 0.665, USDCAD: 1.374, GBPJPY: 199.1, XAUUSD: 2650, XAGUSD: 31.4 };
const VOL: Record<SymbolCode, number> = { EURUSD: 0.009, GBPUSD: 0.010, USDJPY: 0.011, AUDUSD: 0.011, USDCAD: 0.009, GBPJPY: 0.013, XAUUSD: 0.014, XAGUSD: 0.020 };
const BAR_COUNTS: Record<Timeframe, number> = { '1m': 500, '5m': 400, '15m': 300, '1H': 250, '4H': 200, D: 180, W: 104 };

function fnv(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0) / 4294967295;
}
/** Continuous smoothstep-interpolated lattice noise: deterministic per (symbol, time), and bar closes meet the next open. */
function wave(symbol: string, t: number, periodMs: number, salt: string): number {
  const x = t / periodMs; const i = Math.floor(x); const f = x - i;
  const a = fnv(`${salt}|${symbol}|${i}`) * 2 - 1; const b = fnv(`${salt}|${symbol}|${i + 1}`) * 2 - 1;
  return a + (b - a) * (f * f * (3 - 2 * f));
}
export function demoValue(symbol: SymbolCode, t: number): number {
  const vol = VOL[symbol];
  const swing = Math.sin(t / 86_400_000 * Math.PI * 2 / 9) * 0.55 + wave(symbol, t, 6 * 3_600_000, 'swing') * 0.45;
  const day = Math.sin(t / 3_600_000 * Math.PI * 2 / 12 + fnv(`phase|${symbol}`) * 6) * 0.18;
  const micro = wave(symbol, t, 900_000, 'micro') * 0.35 + wave(symbol, t, 120_000, 'tick') * 0.07;
  return BASE[symbol] * (1 + (swing + day + micro) * vol);
}
const tickDigits = (base: number) => base < 10 ? 5 : base < 20 ? 4 : base < 100 ? 3 : 2;
const round = (value: number, digits: number) => Number(value.toFixed(digits));

export interface DemoQuoteRaw { symbol: string; price: number; high: number; low: number; change: number; bid: number; ask: number; priceBasis: 'mid'; dayStatsAvailable: true; provider: 'demo'; providerSymbol: string; instrumentKind: 'reference'; asOf: number; receivedAt: number }
export function demoQuoteFor(symbol: SymbolCode, now = Date.now()): DemoQuoteRaw {
  const config = INSTRUMENTS[symbol];
  const digits = tickDigits(BASE[symbol]);
  const price = round(demoValue(symbol, now), digits);
  const pip = config.pipDecimal === 2 ? 0.01 : 0.0001;
  let bid = round(price - (config.spreadPips * pip) / 2, digits);
  let ask = round(price + (config.spreadPips * pip) / 2, digits);
  if (bid >= price) bid = round(price - Math.pow(10, -digits), digits);
  if (ask <= price) ask = round(price + Math.pow(10, -digits), digits);
  const dayStart = Math.floor(now / 86_400_000) * 86_400_000;
  let high = price; let low = price;
  for (let t = dayStart; t < now; t += 900_000) { const v = demoValue(symbol, t); if (v > high) high = v; if (v < low) low = v; }
  const open = demoValue(symbol, dayStart);
  return { symbol, price, high: round(Math.max(high, price), digits), low: round(Math.min(low, price), digits),
    change: round((price - open) / open * 100, 3), bid, ask, priceBasis: 'mid', dayStatsAvailable: true,
    provider: 'demo', providerSymbol: `DEMO:${symbol}`, instrumentKind: 'reference', asOf: now, receivedAt: now };
}

export function demoHistory(symbol: SymbolCode, timeframe: Timeframe, now = Date.now()): MarketHistoryResponse {
  const periodMs = TIME_CONFIG[timeframe].offsetSec * 1000;
  const digits = tickDigits(BASE[symbol]);
  // candleBucketStart works in epoch seconds; convert once and keep buckets in ms internally.
  const lastBucket = candleBucketStart(Math.floor(now / 1000), timeframe) * 1000;
  const data: Candlestick[] = [];
  for (let i = BAR_COUNTS[timeframe] - 1; i >= 0; i--) {
    const bucket = lastBucket - i * periodMs;
    const closeAt = Math.min(bucket + periodMs, now);
    if (closeAt <= bucket) continue; // a bucket that has not opened yet is not a bar
    const open = demoValue(symbol, bucket); const close = demoValue(symbol, closeAt);
    let high = Math.max(open, close); let low = Math.min(open, close);
    for (let s = 1; s < 12; s++) {
      const t = bucket + (closeAt - bucket) * (s / 12);
      const v = demoValue(symbol, t); if (v > high) high = v; if (v < low) low = v;
    }
    data.push({ time: Math.trunc(bucket / 1000), open: round(open, digits), high: round(high, digits), low: round(low, digits), close: round(close, digits),
      provisional: bucket + periodMs > now });
  }
  return { success: true, symbol, timeframe, fetchedAt: now, data, source: 'demo', providerSymbol: `DEMO:${symbol}`, instrumentKind: 'reference' };
}

const CAL_TITLES = ['Demo CPI y/y', 'Demo Rate Decision', 'Demo Employment change', 'Demo PMI manufacturing', 'Demo Unemployment Rate', 'Demo Retail Sales m/m', 'Demo GDP q/q', 'Demo Trade Balance'];
const CAL_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'NZD'];
/** 24 lowercase hex chars, matching the event-id contract the browser boundary enforces. */
function demoEventId(seed: string): string {
  let out = '';
  for (let part = 0; part < 3; part++) out += fnv(`${seed}|${part}`).toString(16).slice(2, 10);
  return out.slice(0, 24).replace(/[^a-f0-9]/g, '0').padEnd(24, '0');
}
export function demoCalendar(now = Date.now()): WeeklyCalendarResponse {
  const weekStartSec = candleBucketStart(Math.floor(now / 1000), 'W');
  const events: CalendarEvent[] = [];
  for (let day = 0; day < 7; day++) {
    const daySeed = `demo-cal|${weekStartSec}|${day}`;
    const count = 2 + Math.floor(fnv(`${daySeed}|n`) * 4); // 2..5 scheduled items per day
    for (let k = 0; k < count; k++) {
      const hour = 8 + Math.floor(fnv(`${daySeed}|${k}|h`) * 10);
      const scheduled = (weekStartSec + day * 86_400 + hour * 3_600 + (fnv(`${daySeed}|${k}|m`) < 0.5 ? 0 : 30) * 60) * 1000;
      const released = scheduled <= now && fnv(`${daySeed}|${k}|r`) < 0.8;
      const magnitude = 1 + fnv(`${daySeed}|${k}|v`) * 4;
      const num = (offset: number) => (magnitude + offset).toFixed(1);
      const impactSeed = fnv(`${daySeed}|${k}|i`);
      events.push({ id: demoEventId(`${daySeed}|${k}`), title: CAL_TITLES[Math.floor(fnv(`${daySeed}|${k}|t`) * CAL_TITLES.length)],
        currency: CAL_CURRENCIES[Math.floor(fnv(`${daySeed}|${k}|c`) * CAL_CURRENCIES.length)],
        impact: impactSeed < 0.2 ? 'HIGH' : impactSeed < 0.55 ? 'MEDIUM' : 'LOW',
        scheduledAt: scheduled, sourceDate: new Date(scheduled).toISOString(), timing: 'scheduled',
        forecast: fnv(`${daySeed}|${k}|f`) < 0.75 ? num(fnv(`${daySeed}|${k}|f`) * 1.6 - 0.8) : null,
        previous: num(fnv(`${daySeed}|${k}|p`) * 1.6 - 0.8), actual: released ? num(fnv(`${daySeed}|${k}|a`) * 2 - 1) : null });
    }
    if (day === 4 && fnv(`${daySeed}|holiday`) < 0.6) {
      const midnight = (weekStartSec + day * 86_400) * 1000;
      events.push({ id: demoEventId(`${daySeed}|holiday`), title: 'Demo market holiday', currency: 'JPY', impact: 'HOLIDAY', scheduledAt: null,
        sourceDate: new Date(midnight).toISOString().slice(0, 10), timing: 'all-day', forecast: null, previous: null, actual: null });
    }
  }
  return calendarResponse({ version: 1, fetchedAt: now, events }, now,
    'Synthetic demo calendar for offline preview — generated events, not Forex Factory releases, and never trading signals.', 'demo');
}

/** Shared by the Express app and the background poller; never touches a provider or paid budget. */
export function isDemoSymbol(symbol: string): symbol is SymbolCode { return isSymbol(symbol) && symbol in BASE; }
