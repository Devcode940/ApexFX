import { PAIRS_CONFIG, getContractSize } from './forexData';

/**
 * One source of truth for "how big is a pip, and what is it worth".
 *
 * Before this module the answer existed in three places that had already drifted:
 *  - `PAIRS_CONFIG[symbol].pipDecimal` (the actual price precision),
 *  - `PositionsPanel.getPipMultiplier()` (a hand-written table),
 *  - `SupabaseSync`'s inline `symbol.includes('JPY') ? 100 : 10000`.
 *
 * The last one is why closed trades in the database are wrong for metals: gold has pipDecimal 2
 * (pip = 0.01), but the inline table only special-cased "JPY", so a 2.50 USD move on XAU/USD was
 * recorded as 25,000 pips instead of 250 — a 100x error. Anything derived from that number inherits
 * it, and the risk calculator does (`suggestedLots = risk / (pips * pipValue)`).
 *
 * Everything here derives from PAIRS_CONFIG + CONTRACT_SIZE. If you disagree with the convention
 * encoded there (e.g. you treat silver as 3-decimal with a $5 pip), change `pipDecimal` in
 * forexData.ts and every number below follows, instead of one of three call sites following.
 */

/** Price precision of one pip, e.g. 0.0001 for EUR/USD, 0.01 for USD/JPY and XAU/USD. */
export function pipSize(symbol: string): number {
  const decimals = PAIRS_CONFIG[symbol]?.pipDecimal ?? (symbol.includes('JPY') ? 2 : 4);
  // `1 / 10 ** n`, not `10 ** -n`: the latter evaluates to 0.00009999999999999999, so any caller
  // comparing pip sizes (or formatting off them) trips on a pure artefact of the exponent form.
  return 1 / 10 ** decimals;
}

/** A price distance in pips (signed; round away the sub-pip float noise). */
export function priceDeltaToPips(symbol: string, delta: number): number {
  if (!Number.isFinite(delta)) return 0;
  return Math.round(delta / pipSize(symbol));
}

/**
 * Distance from entry to a stop/target, in pips. Returns 0 when the level is absent or not a
 * usable price, which callers treat as "no protective level" rather than "risk zero".
 */
export function levelToPips(symbol: string, entryPrice: number, level: number | undefined | null): number {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return 0;
  if (level === undefined || level === null || !Number.isFinite(level) || level <= 0) return 0;
  return priceDeltaToPips(symbol, Math.abs(entryPrice - level));
}

/**
 * USD value of one pip for `lots` lots.
 *
 * `fx.usdPerQuote` is how many units of the *quote* currency buy one USD (USD/JPY: ~155, USD/CAD:
 * ~1.37). For a pair quoted as USD/XXX the pair's own price IS that rate, so callers can always supply
 * it from the feed; for a cross like GBP/JPY it has to come from USD/JPY.
 *
 * Both matter: the old per-symbol table returned $10.00 for a USD/CAD pip, which is 10 CAD, i.e. about
 * $7.30 — and the risk calculator divides by that number, so it over-sized CAD positions by ~37%.
 */
export function pipValueUsd(
  symbol: string,
  lots = 1,
  fx: { usdPerQuote?: number } = {}
): number {
  const size = pipSize(symbol);
  const contract = getContractSize(symbol);
  const valueInQuote = size * contract * lots;   // e.g. EUR/USD: 0.0001 * 100000 = $10 per standard lot

  const quote = symbol.slice(3, 6);
  if (quote === 'USD' || quote.length !== 3) return round2(valueInQuote);

  const rate = fx.usdPerQuote;
  if (Number.isFinite(rate) && (rate as number) > 0) return round2(valueInQuote / (rate as number));

  // No rate available: return the quote-currency amount rather than inventing a USD figure. Callers
  // that show this next to a lot-size suggestion should treat it as approximate (the panel only
  // reaches here while the feed is cold, when orders are disabled anyway).
  return round2(valueInQuote);
}

/**
 * The USD->quote rate for a symbol, from whatever prices the caller has.
 * USD/JPY and USD/CAD carry it themselves; JPY/other crosses need the USD/JPY price.
 */
export function usdPerQuoteRate(
  symbol: string,
  pairPrice: number | undefined,
  usdJpy: number | undefined
): number | undefined {
  const quote = symbol.slice(3, 6);
  if (quote === 'USD' || quote.length !== 3) return undefined; // already USD-quoted, no conversion
  const ok = (n: number | undefined) => (Number.isFinite(n) && (n as number) > 0 ? (n as number) : undefined);
  // Watchlist symbols are undelimited ('USDJPY'), so a base of USD means the pair price is the rate.
  if (symbol.startsWith('USD')) return ok(pairPrice);
  return ok(usdJpy);
}

/** USD/JPY out of the watchlist feed — the rate crosses like GBP/JPY need. */
export function usdJpyFrom(items: readonly { symbol: string; price: number }[] | undefined): number | undefined {
  return priceOf('USDJPY', items);
}

/** Look a symbol's own price up in the watchlist feed (feeds `pairPrice` above). */
export function priceOf(
  symbol: string,
  items: readonly { symbol: string; price: number }[] | undefined
): number | undefined {
  const price = items?.find((i) => i.symbol === symbol)?.price;
  return Number.isFinite(price) && (price as number) > 0 ? price : undefined;
}

function round2(n: number): number {
  return parseFloat(n.toFixed(2));
}
