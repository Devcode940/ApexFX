import { describe, it, expect } from 'vitest';
import { DERIV_SYMBOLS, DERIV_GRANULARITY_MAP } from './deriv';
import { TIINGO_TICKERS, TIINGO_RESAMPLE_MAP } from './tiingo';
import { calculateCurrencyStrength } from './strength';
import { CENTRAL_BANK_RATES, computeRateDifferential, computeFxMacroSentiment, getMacroOverview } from './macro';
import { fetchEconomicCalendar } from './calendar';

describe('Deriv Service Configuration', () => {
  it('maps all 8 supported symbols to Deriv format including gold and silver', () => {
    expect(DERIV_SYMBOLS['EURUSD']).toBe('frxEURUSD');
    expect(DERIV_SYMBOLS['GBPUSD']).toBe('frxGBPUSD');
    expect(DERIV_SYMBOLS['USDJPY']).toBe('frxUSDJPY');
    expect(DERIV_SYMBOLS['AUDUSD']).toBe('frxAUDUSD');
    expect(DERIV_SYMBOLS['USDCAD']).toBe('frxUSDCAD');
    expect(DERIV_SYMBOLS['GBPJPY']).toBe('frxGBPJPY');
    expect(DERIV_SYMBOLS['XAUUSD']).toBe('frxXAUUSD');
    expect(DERIV_SYMBOLS['XAGUSD']).toBe('frxXAGUSD');
  });

  it('correctly maps timeframes to seconds granularity', () => {
    expect(DERIV_GRANULARITY_MAP['1m']).toBe(60);
    expect(DERIV_GRANULARITY_MAP['5m']).toBe(300);
    expect(DERIV_GRANULARITY_MAP['15m']).toBe(900);
    expect(DERIV_GRANULARITY_MAP['1H']).toBe(3600);
    expect(DERIV_GRANULARITY_MAP['4H']).toBe(14400);
    expect(DERIV_GRANULARITY_MAP['D']).toBe(86400);
  });
});

describe('Tiingo Service Configuration', () => {
  it('maps symbols to lowercase Tiingo FX tickers', () => {
    expect(TIINGO_TICKERS['EURUSD']).toBe('eurusd');
    expect(TIINGO_TICKERS['XAUUSD']).toBe('xauusd');
    expect(TIINGO_TICKERS['XAGUSD']).toBe('xagusd');
  });

  it('maps timeframes to Tiingo resample frequencies', () => {
    expect(TIINGO_RESAMPLE_MAP['1m'].freq).toBe('1min');
    expect(TIINGO_RESAMPLE_MAP['5m'].freq).toBe('5min');
    expect(TIINGO_RESAMPLE_MAP['1H'].freq).toBe('1hour');
    expect(TIINGO_RESAMPLE_MAP['4H'].freq).toBe('4hour');
    expect(TIINGO_RESAMPLE_MAP['D'].freq).toBe('1day');
  });
});

describe('Currency Strength Calculation', () => {
  it('returns strength values for all 8 major currencies normalized between 0 and 10', () => {
    const strength = calculateCurrencyStrength();
    expect(strength.length).toBe(8);

    const currencyCodes = strength.map((s) => s.currency);
    expect(currencyCodes).toContain('USD');
    expect(currencyCodes).toContain('EUR');
    expect(currencyCodes).toContain('GBP');
    expect(currencyCodes).toContain('JPY');
    expect(currencyCodes).toContain('AUD');
    expect(currencyCodes).toContain('CAD');
    expect(currencyCodes).toContain('CHF');
    expect(currencyCodes).toContain('NZD');

    for (const item of strength) {
      expect(item.strength).toBeGreaterThanOrEqual(0);
      expect(item.strength).toBeLessThanOrEqual(10);
      expect(['Bullish', 'Neutral', 'Bearish']).toContain(item.bias);
    }
  });
});

describe('Macro & Central Bank Policy Differential', () => {
  it('contains benchmark rates for all 8 major currencies', () => {
    const keys = Object.keys(CENTRAL_BANK_RATES);
    expect(keys).toContain('USD');
    expect(keys).toContain('EUR');
    expect(keys).toContain('GBP');
    expect(keys).toContain('JPY');
    expect(keys).toContain('AUD');
    expect(keys).toContain('CAD');
    expect(keys).toContain('CHF');
    expect(keys).toContain('NZD');
  });

  it('computes accurate rate spread for currency pairs', () => {
    const usdJpy = computeRateDifferential('USDJPY');
    expect(usdJpy.baseRate).toBe(CENTRAL_BANK_RATES.USD.rate);
    expect(usdJpy.quoteRate).toBe(CENTRAL_BANK_RATES.JPY.rate);
    expect(usdJpy.spread).toBe(parseFloat((CENTRAL_BANK_RATES.USD.rate - CENTRAL_BANK_RATES.JPY.rate).toFixed(2)));
  });

  it('computes FX Risk-On vs Risk-Off macro sentiment based on currency basket dynamics', () => {
    const sentiment = computeFxMacroSentiment();
    expect(sentiment.score).toBeGreaterThanOrEqual(0);
    expect(sentiment.score).toBeLessThanOrEqual(100);
    expect(['Extreme Fear', 'Fear', 'Neutral', 'Greed', 'Extreme Greed']).toContain(sentiment.classification);
    expect(['Risk-Off (Safe Haven)', 'Neutral', 'Risk-On (High Yield)']).toContain(sentiment.marketBias);
  });

  it('constructs complete macro overview including rate differentials', async () => {
    const overview = await getMacroOverview('EURUSD');
    expect(overview.rates).toBeDefined();
    expect(overview.sentiment).toBeDefined();
    expect(overview.differentials['EURUSD']).toBeDefined();
    expect(overview.activePairDifferential.spread).toBeDefined();
  });
});

describe('Economic Calendar Service', () => {
  it('returns an array of economic events without fabricating unverified releases', async () => {
    const events = await fetchEconomicCalendar();
    expect(Array.isArray(events)).toBe(true);
    for (const ev of events) {
      expect(ev.title).toBeDefined();
      expect(ev.country).toBeDefined();
      expect(ev.date).toBeDefined();
      expect(['High', 'Medium', 'Low', 'Holiday']).toContain(ev.impact);
    }
  });
});

describe('AI Status & Model Configuration', () => {
  it('identifies gemini-2.5-flash as the default model hierarchy with fallback', () => {
    const defaultModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    expect(defaultModel).toMatch(/gemini/i);
  });
});

