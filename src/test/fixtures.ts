import type { TradePosition, ClosedTrade } from '../types';
import type { MarketQuote } from '../../shared/market';
import { valuePnl } from '../utils/money';
import { buildClosedTrade } from '../utils/paperTrading';

export const quote = (symbol = 'EURUSD', price = 1.1, extra: Partial<MarketQuote> = {}): MarketQuote => ({
  symbol, price, high: price, low: price, change: 0, provider: 'twelvedata', providerSymbol: `${symbol.slice(0, 3)}/${symbol.slice(3)}`,
  instrumentKind: 'spot', asOf: Date.now(), receivedAt: Date.now(), ...extra,
});
export const position = (id = 'pos_one', extra: Partial<TradePosition> = {}): TradePosition => ({
  id, symbol: 'EURUSD', type: 'BUY', amount: 1, entryPrice: 1.1, currentPrice: 1.1, instrumentKind: 'spot', time: '12:00',
  openedAt: Date.now() - 1000, ...valuePnl('EURUSD', 'BUY', 1.1, 1.1, 1, [], Date.now()), ...extra,
});
export const closed = (id = 'pos_one', extra: Partial<ClosedTrade> = {}) => ({ ...buildClosedTrade({ position: position(id), exitPrice: 1.11 }), ...extra });
