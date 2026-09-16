import { fetchWithTimeout } from '../lib/fetch';
import { warn } from '../lib/logger';

export interface CentralBankRate {
  currency: string;
  centralBank: string;
  rate: number; // percentage, e.g. 5.25
  lastUpdated: string;
}

export const CENTRAL_BANK_RATES: Record<string, CentralBankRate> = {
  USD: { currency: 'USD', centralBank: 'Federal Reserve', rate: 5.25, lastUpdated: '2026-09' },
  EUR: { currency: 'EUR', centralBank: 'European Central Bank', rate: 3.50, lastUpdated: '2026-09' },
  GBP: { currency: 'GBP', centralBank: 'Bank of England', rate: 5.00, lastUpdated: '2026-09' },
  JPY: { currency: 'JPY', centralBank: 'Bank of Japan', rate: 0.25, lastUpdated: '2026-09' },
  AUD: { currency: 'AUD', centralBank: 'Reserve Bank of Australia', rate: 4.35, lastUpdated: '2026-09' },
  CAD: { currency: 'CAD', centralBank: 'Bank of Canada', rate: 4.25, lastUpdated: '2026-09' },
  CHF: { currency: 'CHF', centralBank: 'Swiss National Bank', rate: 1.25, lastUpdated: '2026-09' },
  NZD: { currency: 'NZD', centralBank: 'Reserve Bank of New Zealand', rate: 4.75, lastUpdated: '2026-09' },
};

export interface MacroData {
  rates: Record<string, CentralBankRate>;
  sentiment: {
    score: number; // 0 - 100
    classification: 'Extreme Fear' | 'Fear' | 'Neutral' | 'Greed' | 'Extreme Greed';
    marketBias: 'Risk-Off (Safe Haven)' | 'Neutral' | 'Risk-On (High Yield)';
  };
  differentials: Record<string, number>;
}

let cachedSentiment: MacroData['sentiment'] = {
  score: 54,
  classification: 'Neutral',
  marketBias: 'Neutral',
};
let lastSentimentFetch = 0;
const SENTIMENT_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export async function fetchMacroSentiment(): Promise<MacroData['sentiment']> {
  const now = Date.now();
  if (now - lastSentimentFetch < SENTIMENT_CACHE_TTL) {
    return cachedSentiment;
  }

  try {
    const res = await fetchWithTimeout('https://api.alternative.me/fng/?limit=1', { timeoutMs: 5000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as any;
    const entry = data?.data?.[0];
    if (entry) {
      const score = parseInt(entry.value, 10);
      let classification = entry.value_classification as MacroData['sentiment']['classification'];
      if (!classification) {
        if (score <= 25) classification = 'Extreme Fear';
        else if (score <= 45) classification = 'Fear';
        else if (score <= 55) classification = 'Neutral';
        else if (score <= 75) classification = 'Greed';
        else classification = 'Extreme Greed';
      }

      let marketBias: MacroData['sentiment']['marketBias'] = 'Neutral';
      if (score < 45) marketBias = 'Risk-Off (Safe Haven)';
      else if (score > 55) marketBias = 'Risk-On (High Yield)';

      cachedSentiment = { score, classification, marketBias };
      lastSentimentFetch = now;
    }
  } catch (err: any) {
    warn('[Macro] Failed to fetch external sentiment index, using baseline:', err.message);
  }

  return cachedSentiment;
}

export function computeRateDifferential(symbol: string): { baseRate: number; quoteRate: number; spread: number } {
  const clean = symbol.replace(/[^A-Z]/g, '');
  const base = clean.slice(0, 3);
  const quote = clean.slice(3, 6);

  const baseRate = CENTRAL_BANK_RATES[base]?.rate ?? 0;
  const quoteRate = CENTRAL_BANK_RATES[quote]?.rate ?? 0;
  const spread = parseFloat((baseRate - quoteRate).toFixed(2));

  return { baseRate, quoteRate, spread };
}

export async function getMacroOverview(activeSymbol = 'EURUSD'): Promise<MacroData & { activePairDifferential: ReturnType<typeof computeRateDifferential> }> {
  const sentiment = await fetchMacroSentiment();

  const differentials: Record<string, number> = {
    EURUSD: computeRateDifferential('EURUSD').spread,
    GBPUSD: computeRateDifferential('GBPUSD').spread,
    USDJPY: computeRateDifferential('USDJPY').spread,
    AUDUSD: computeRateDifferential('AUDUSD').spread,
    USDCAD: computeRateDifferential('USDCAD').spread,
    GBPJPY: computeRateDifferential('GBPJPY').spread,
    EURGBP: computeRateDifferential('EURGBP').spread,
    USDCHF: computeRateDifferential('USDCHF').spread,
    NZDUSD: computeRateDifferential('NZDUSD').spread,
    EURJPY: computeRateDifferential('EURJPY').spread,
  };

  return {
    rates: CENTRAL_BANK_RATES,
    sentiment,
    differentials,
    activePairDifferential: computeRateDifferential(activeSymbol),
  };
}
