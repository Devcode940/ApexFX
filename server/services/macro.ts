import { serverWatchlist } from './market';

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

/**
 * Compute institutional FX Risk-On vs Risk-Off macro sentiment based on
 * live performance of high-beta commodity currencies (AUD, NZD, CAD) versus
 * traditional safe-haven anchors (JPY, CHF, USD), combined with central bank carry differentials.
 */
export function computeFxMacroSentiment(): MacroData['sentiment'] {
  const quoteMap: Record<string, number> = {};
  for (const item of serverWatchlist) {
    quoteMap[item.symbol] = isFinite(item.change) ? item.change : 0;
  }

  // High-beta risk currencies
  const audChange = quoteMap['AUDUSD'] || 0;
  const nzdChange = quoteMap['NZDUSD'] || 0;
  const cadChange = -(quoteMap['USDCAD'] || 0); // CAD strength is negative USDCAD
  const riskBasket = (audChange + nzdChange + cadChange) / 3;

  // Safe-haven currencies
  const jpyChange = -(quoteMap['USDJPY'] || 0); // JPY strength is negative USDJPY
  const chfChange = -(quoteMap['USDCHF'] || 0); // CHF strength is negative USDCHF
  const safeHavenBasket = (jpyChange + chfChange) / 2;

  // Carry yield baseline: spread between high-yield and low-yield central banks
  const highYieldAvg = (CENTRAL_BANK_RATES.USD.rate + CENTRAL_BANK_RATES.AUD.rate + CENTRAL_BANK_RATES.NZD.rate) / 3;
  const lowYieldAvg = (CENTRAL_BANK_RATES.JPY.rate + CENTRAL_BANK_RATES.CHF.rate) / 2;
  const carryAdvantage = highYieldAvg - lowYieldAvg;

  // Baseline score around 50; adjusted by relative flow difference
  const rawScore = 50 + (riskBasket - safeHavenBasket) * 15 + (carryAdvantage > 3 ? 3 : 0);
  const score = Math.max(5, Math.min(95, Math.round(rawScore)));

  let classification: MacroData['sentiment']['classification'] = 'Neutral';
  let marketBias: MacroData['sentiment']['marketBias'] = 'Neutral';

  if (score >= 75) {
    classification = 'Extreme Greed';
    marketBias = 'Risk-On (High Yield)';
  } else if (score >= 58) {
    classification = 'Greed';
    marketBias = 'Risk-On (High Yield)';
  } else if (score <= 25) {
    classification = 'Extreme Fear';
    marketBias = 'Risk-Off (Safe Haven)';
  } else if (score <= 42) {
    classification = 'Fear';
    marketBias = 'Risk-Off (Safe Haven)';
  }

  return { score, classification, marketBias };
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
  const sentiment = computeFxMacroSentiment();

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
