import type { Candlestick } from '../src/types';
import type { Timeframe } from './timeframes';

export interface MarketHistoryResponse {
  success: true;
  symbol: string;
  timeframe: Timeframe;
  /** Original provider-response receipt, retained when serving an instance-cached snapshot. */
  fetchedAt: number;
  source: 'tiingo' | 'twelvedata' | 'yahoo';
  providerSymbol: string;
  instrumentKind: 'spot' | 'futures';
  data: Candlestick[];
  aggregation?: string;
}
