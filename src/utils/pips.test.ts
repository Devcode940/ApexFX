import { describe, it, expect } from 'vitest';
import { pipSize, priceDeltaToPips, levelToPips, pipValueUsd, priceOf, usdJpyFrom, usdPerQuoteRate } from './pips';

/**
 * These numbers end up in the database, in the position panel, and in the risk calculator's
 * "suggested lot size", so they are pinned here rather than eyeballed in a component.
 */
describe('pipSize', () => {
  it('follows PAIRS_CONFIG precision per instrument class', () => {
    expect(pipSize('EURUSD')).toBe(0.0001);
    expect(pipSize('USDJPY')).toBe(0.01);
    expect(pipSize('XAUUSD')).toBe(0.01);   // gold is a 2-decimal instrument here
    expect(pipSize('XAGUSD')).toBe(0.0001);
  });

  it('falls back by JY-suffix for unlisted symbols instead of defaulting everything to 4', () => {
    expect(pipSize('NZDJPY')).toBe(0.01);
    expect(pipSize('NZDUSD')).toBe(0.0001);
  });
});

describe('priceDeltaToPips', () => {
  it('counts majors at 0.0001', () => {
    expect(priceDeltaToPips('EURUSD', 0.011)).toBe(110);
    expect(priceDeltaToPips('EURUSD', -0.011)).toBe(-110);
  });

  it('counts JPY pairs at 0.01', () => {
    expect(priceDeltaToPips('USDJPY', 1.55)).toBe(155);
  });

  it('does NOT reuse the JPY-or-10000 rule for metals (the 100x bug)', () => {
    // The Supabase writer used `symbol.includes('JPY') ? 100 : 10000`, so a $2.50 gold move
    // became 25,000 pips. Gold here is 2-decimal, so it is 250.
    expect(priceDeltaToPips('XAUUSD', 2.5)).toBe(250);
    expect(priceDeltaToPips('XAUUSD', 2.5)).not.toBe(25000);
    // Silver is 4-decimal in PAIRS_CONFIG, which is the single source of truth for that choice.
    expect(priceDeltaToPips('XAGUSD', 0.0125)).toBe(125);
  });

  it('is zero for unusable input rather than NaN', () => {
    expect(priceDeltaToPips('EURUSD', NaN)).toBe(0);
    expect(priceDeltaToPips('EURUSD', Infinity)).toBe(0);
  });
});

describe('levelToPips', () => {
  it('measures entry-to-stop distance', () => {
    expect(levelToPips('EURUSD', 1.1, 1.089)).toBe(110);
    expect(levelToPips('EURUSD', 1.1, 1.121)).toBe(210); // sign is distance, not direction
  });

  it('treats a missing or non-positive level as "no protective level"', () => {
    expect(levelToPips('EURUSD', 1.1, undefined)).toBe(0);
    expect(levelToPips('EURUSD', 1.1, null)).toBe(0);
    expect(levelToPips('EURUSD', 1.1, 0)).toBe(0);
    expect(levelToPips('EURUSD', 0, 1.09)).toBe(0); // no entry price yet (cold feed)
  });
});

describe('pipValueUsd', () => {
  it('is $10 per standard lot for USD-quoted majors', () => {
    expect(pipValueUsd('EURUSD')).toBe(10);
    expect(pipValueUsd('GBPUSD')).toBe(10);
  });

  it('derives gold/silver from contract size instead of a hand-typed table', () => {
    // XAU: 0.01 pip x 100 oz = $1.00 ; XAG: 0.0001 pip x 5000 oz = $0.50
    expect(pipValueUsd('XAUUSD')).toBe(1);
    expect(pipValueUsd('XAGUSD')).toBe(0.5);
  });

  it('converts JPY pip value with the live rate instead of a hardcoded 6.5', () => {
    // 0.01 x 100,000 = ¥1,000 per pip per lot; /155 = $6.45
    expect(pipValueUsd('USDJPY', 1, { usdPerQuote: 155 })).toBe(6.45);
    expect(pipValueUsd('GBPJPY', 1, { usdPerQuote: 125 })).toBe(8);
    // scale with size
    expect(pipValueUsd('USDJPY', 2, { usdPerQuote: 155 })).toBe(12.9);
  });

  it('does not invent a USD figure when the rate is unavailable', () => {
    // Returns the quote-currency amount and lets the caller decide, instead of keeping a stale 6.5.
    expect(pipValueUsd('USDJPY', 1)).toBe(1000);
  });

  it('prices a CAD pip in dollars, not in 10 CAD (the old table returned 10.00)', () => {
    expect(pipValueUsd('USDCAD', 1, { usdPerQuote: 1.37 })).toBe(7.3);
  });
});

describe('usdPerQuoteRate', () => {
  it('uses the pair price for USD-quoted pairs and the JPY cross otherwise', () => {
    expect(usdPerQuoteRate('USDJPY', 155.2, undefined)).toBe(155.2);
    expect(usdPerQuoteRate('USDCAD', 1.37, 155)).toBe(1.37);
    expect(usdPerQuoteRate('GBPJPY', 195.1, 155)).toBe(155);
    // USD-quoted pairs need no conversion at all
    expect(usdPerQuoteRate('EURUSD', 1.1, 155)).toBeUndefined();
    // bad prices are rejected rather than propagated as a rate
    expect(usdPerQuoteRate('USDJPY', 0, undefined)).toBeUndefined();
    expect(usdPerQuoteRate('GBPJPY', 195, 0)).toBeUndefined();
  });

  it('finds a symbol price in the watchlist map', () => {
    const feed = [{ symbol: 'USDJPY', price: 155.4 }, { symbol: 'XAUUSD', price: 2650.2 }];
    expect(priceOf('XAUUSD', feed)).toBe(2650.2);
    expect(priceOf('EURUSD', feed)).toBeUndefined();
    expect(priceOf('USDJPY', undefined)).toBeUndefined();
  });
});

describe('usdJpyFrom', () => {
  it('reads the rate out of the watchlist map, guarding bad values', () => {
    const feed = [{ symbol: 'EURUSD', price: 1.1 }, { symbol: 'USDJPY', price: 155.4 }];
    expect(usdJpyFrom(feed)).toBe(155.4);
    expect(usdJpyFrom([{ symbol: 'USDJPY', price: 0 }])).toBeUndefined();
    expect(usdJpyFrom([{ symbol: 'EURUSD', price: 1.1 }])).toBeUndefined();
    expect(usdJpyFrom([])).toBeUndefined();
    expect(usdJpyFrom(undefined)).toBeUndefined();
  });
});
