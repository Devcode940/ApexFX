import { serverWatchlist } from './market';

export interface CurrencyStrengthItem {
  currency: string;
  strength: number; // 0.0 to 10.0
  bias: 'Bullish' | 'Neutral' | 'Bearish';
}

export function calculateCurrencyStrength(): CurrencyStrengthItem[] {
  const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD'];
  const scores: Record<string, number> = {};
  currencies.forEach((c) => (scores[c] = 0));

  const quoteMap: Record<string, { change: number; price: number }> = {};
  for (const item of serverWatchlist) {
    quoteMap[item.symbol] = {
      change: isFinite(item.change) ? item.change : 0,
      price: item.price,
    };
  }

  const crossPairs = [
    { base: 'EUR', quote: 'USD', change: quoteMap['EURUSD']?.change || 0 },
    { base: 'GBP', quote: 'USD', change: quoteMap['GBPUSD']?.change || 0 },
    { base: 'AUD', quote: 'USD', change: quoteMap['AUDUSD']?.change || 0 },
    { base: 'NZD', quote: 'USD', change: quoteMap['NZDUSD']?.change || 0 },
    { base: 'USD', quote: 'JPY', change: quoteMap['USDJPY']?.change || 0 },
    { base: 'USD', quote: 'CAD', change: quoteMap['USDCAD']?.change || 0 },
    { base: 'USD', quote: 'CHF', change: quoteMap['USDCHF']?.change || 0 },
    { base: 'EUR', quote: 'GBP', change: quoteMap['EURGBP']?.change || 0 },
    { base: 'EUR', quote: 'JPY', change: quoteMap['EURJPY']?.change || 0 },
    { base: 'GBP', quote: 'JPY', change: quoteMap['GBPJPY']?.change || 0 },
  ];

  for (const { base, quote, change } of crossPairs) {
    if (scores[base] !== undefined && scores[quote] !== undefined) {
      scores[base] += change;
      scores[quote] -= change;
    }
  }

  const values = Object.values(scores);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 1;

  return currencies
    .map((c) => {
      const normalized = Number((((scores[c] - min) / spread) * 10).toFixed(1));
      let bias: 'Bullish' | 'Neutral' | 'Bearish' = 'Neutral';
      if (normalized >= 6.5) bias = 'Bullish';
      else if (normalized <= 3.5) bias = 'Bearish';

      return {
        currency: c,
        strength: normalized,
        bias,
      };
    })
    .sort((a, b) => b.strength - a.strength);
}
