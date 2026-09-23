/** Shared wire/domain contracts. A received response is not proof of a fresh quote. */
export const INSTRUMENTS = {
  EURUSD: { name: 'EUR / USD', pipDecimal: 4, spreadPips: 1.2, contractSize: 100000 },
  GBPUSD: { name: 'GBP / USD', pipDecimal: 4, spreadPips: 1.6, contractSize: 100000 },
  USDJPY: { name: 'USD / JPY', pipDecimal: 2, spreadPips: 1.4, contractSize: 100000 },
  AUDUSD: { name: 'AUD / USD', pipDecimal: 4, spreadPips: 1.5, contractSize: 100000 },
  USDCAD: { name: 'USD / CAD', pipDecimal: 4, spreadPips: 1.8, contractSize: 100000 },
  GBPJPY: { name: 'GBP / JPY', pipDecimal: 2, spreadPips: 2.3, contractSize: 100000 },
  XAUUSD: { name: 'Gold / USD', pipDecimal: 2, spreadPips: 2.5, contractSize: 100 },
  XAGUSD: { name: 'Silver / USD', pipDecimal: 4, spreadPips: 2, contractSize: 5000 },
} as const;

export type SymbolCode = keyof typeof INSTRUMENTS;
export type MarketProvider = 'tiingo' | 'twelvedata' | 'yahoo' | 'frankfurter' | 'demo';
export type InstrumentKind = 'spot' | 'futures' | 'reference' | 'unknown';
export type QuoteQuality = 'fresh' | 'stale' | 'reference' | 'unknown' | 'unavailable';
export type FeedSource = MarketProvider | 'mixed' | null;
export const QUOTE_MAX_AGE_MS = 120_000;
export const FUTURE_TOLERANCE_MS = 5_000;

export interface QuoteMetadata {
  provider: MarketProvider | null;
  providerSymbol: string | null;
  instrumentKind: InstrumentKind;
  /** Provider observation time, milliseconds since epoch. Never fabricated from response time. */
  asOf: number | null;
  receivedAt: number | null;
  bid?: number;
  ask?: number;
  priceBasis?: 'mid' | 'last';
  dayStatsAvailable?: boolean;
}
export interface MarketQuote extends QuoteMetadata {
  symbol: string;
  price: number;
  high: number;
  low: number;
  change: number;
}
export const EMPTY_QUOTE_METADATA: QuoteMetadata = {
  provider: null, providerSymbol: null, instrumentKind: 'unknown', asOf: null, receivedAt: null,
};

export function isSymbol(value: string): value is SymbolCode {
  return Object.prototype.hasOwnProperty.call(INSTRUMENTS, value);
}
export function positiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
export function quoteQuality(quote: Partial<MarketQuote> | undefined, now = Date.now()): QuoteQuality {
  if (!quote || !positiveNumber(quote.price)) return 'unavailable';
  if (quote.instrumentKind === 'reference' || quote.provider === 'frankfurter') return 'reference';
  if (!quote.provider || !quote.providerSymbol || !['spot', 'futures'].includes(quote.instrumentKind ?? '') ||
      !positiveNumber(quote.asOf) || !positiveNumber(quote.receivedAt)) return 'unknown';
  if (quote.asOf > now + FUTURE_TOLERANCE_MS || quote.receivedAt > now + FUTURE_TOLERANCE_MS) return 'unknown';
  return now - quote.asOf <= QUOTE_MAX_AGE_MS && now - quote.receivedAt <= QUOTE_MAX_AGE_MS ? 'fresh' : 'stale';
}
export function isExecutableQuote(quote: Partial<MarketQuote> | undefined, now = Date.now()): quote is MarketQuote {
  // This is a spot-FX simulator. Yahoo's continuous silver future is a display-only proxy,
  // not a contract-specific spot instrument, even when its observation timestamp is fresh.
  return quoteQuality(quote, now) === 'fresh' && quote?.instrumentKind === 'spot';
}
export function sourceOf(quotes: readonly Partial<MarketQuote>[]): FeedSource {
  const sources = new Set(quotes.filter(q => positiveNumber(q.price)).map(q => q.provider).filter(Boolean));
  return sources.size > 1 ? 'mixed' : (sources.values().next().value as MarketProvider | undefined) ?? null;
}

/** Validate at the browser/network boundary. The server's quality label is not trusted. */
export function parseQuote(symbol: string, value: unknown): MarketQuote | null {
  if (!isSymbol(symbol) || !value || typeof value !== 'object') return null;
  const q = value as Record<string, unknown>;
  if (!positiveNumber(q.price) || (q.symbol !== undefined && q.symbol !== symbol)) return null;
  if ((positiveNumber(q.asOf) && q.asOf > Date.now() + FUTURE_TOLERANCE_MS) || (positiveNumber(q.receivedAt) && q.receivedAt > Date.now() + FUTURE_TOLERANCE_MS)) return null;
  const provider = ['tiingo', 'twelvedata', 'yahoo', 'frankfurter', 'demo'].includes(String(q.provider)) ? q.provider as MarketProvider : null;
  // Demo is reference-grade by construction: forcing the kind keeps isExecutableQuote false everywhere.
  const instrumentKind = provider === 'frankfurter' || provider === 'demo' ? 'reference' : ['spot', 'futures', 'reference'].includes(String(q.instrumentKind)) ? q.instrumentKind as InstrumentKind : 'unknown';
  return {
    symbol, price: q.price,
    high: positiveNumber(q.high) ? Math.max(q.high, q.price) : q.price,
    low: positiveNumber(q.low) ? Math.min(q.low, q.price) : q.price,
    change: typeof q.change === 'number' && Number.isFinite(q.change) ? q.change : 0,
    provider, instrumentKind,
    bid: positiveNumber(q.bid) ? q.bid : undefined, ask: positiveNumber(q.ask) ? q.ask : undefined,
    priceBasis: q.priceBasis === 'mid' ? 'mid' : 'last', dayStatsAvailable: q.dayStatsAvailable !== false,
    providerSymbol: typeof q.providerSymbol === 'string' && q.providerSymbol.length <= 40 ? q.providerSymbol : null,
    asOf: positiveNumber(q.asOf) ? Math.trunc(q.asOf) : null,
    receivedAt: positiveNumber(q.receivedAt) ? Math.trunc(q.receivedAt) : null,
  };
}

/** Reference/unknown data cannot replace a timed market observation; out-of-order data is ignored. */
export function shouldAcceptQuote(previous: MarketQuote | undefined, next: MarketQuote): boolean {
  if (!previous || previous.price <= 0) return true;
  if (['spot', 'futures'].includes(previous.instrumentKind) && previous.asOf !== null &&
      (!['spot', 'futures'].includes(next.instrumentKind) || !next.provider || next.asOf === null)) return false;
  if (previous.asOf !== null && (next.asOf === null || next.asOf < previous.asOf)) return false;
  if (previous.asOf === next.asOf && (next.receivedAt ?? 0) < (previous.receivedAt ?? 0)) return false;
  return previous.price !== next.price || previous.asOf !== next.asOf || previous.receivedAt !== next.receivedAt ||
    previous.bid !== next.bid || previous.ask !== next.ask || previous.priceBasis !== next.priceBasis || previous.dayStatsAvailable !== next.dayStatsAvailable || previous.provider !== next.provider || previous.providerSymbol !== next.providerSymbol || previous.instrumentKind !== next.instrumentKind ||
    previous.high !== next.high || previous.low !== next.low || previous.change !== next.change;
}

/** Provider timestamps may be epoch seconds, epoch milliseconds, or explicit UTC strings. */
export function providerTimestamp(value: unknown): number | null {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value))) {
    const n = Number(value);
    return positiveNumber(n) ? Math.trunc(n < 1e12 ? n * 1000 : n) : null;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const iso = value.trim().replace(' ', 'T');
  const timestamp = Date.parse(/[zZ]$|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`);
  return positiveNumber(timestamp) ? timestamp : null;
}
