import { INSTRUMENTS, isExecutableQuote, isSymbol, positiveNumber, type MarketQuote } from '../../shared/market';

export interface ConversionSnapshot {
  /** Quote-currency units per USD (e.g. 151 JPY per USD), not its reciprocal. */
  quotePerUsd: number;
  asOf: number | null;
  source: string;
}
export interface PnlDetails {
  pnlVersion: 2;
  accountCurrency: 'USD';
  quoteCurrency: string;
  pnlQuote: number;
  /** Account-currency value. null means unavailable, NEVER quote currency masquerading as USD. */
  pnl: number | null;
  conversion: ConversionSnapshot | null;
}
export const roundMoney = (value: number): number => Math.round((value + Math.sign(value) * Number.EPSILON) * 100) / 100;

export function valuePnl(
  symbol: string, type: 'BUY' | 'SELL', entry: number, exit: number, lots: number,
  quotes: readonly MarketQuote[] = [], at: number = Date.now(),
): PnlDetails {
  const quoteCurrency = symbol.slice(3, 6);
  const contract = isSymbol(symbol) ? INSTRUMENTS[symbol].contractSize : 0;
  const raw = (type === 'BUY' ? exit - entry : entry - exit) * lots * contract;
  let conversion: ConversionSnapshot | null = null;
  if (quoteCurrency === 'USD') conversion = { quotePerUsd: 1, asOf: at || null, source: 'identity' };
  else if (symbol.startsWith('USD') && positiveNumber(exit)) {
    conversion = { quotePerUsd: exit, asOf: at || null, source: `${symbol} exit/mark price` };
  } else if (quoteCurrency === 'JPY') {
    const fx = quotes.find(q => q.symbol === 'USDJPY');
    if (isExecutableQuote(fx, at)) conversion = { quotePerUsd: fx.price, asOf: fx.asOf, source: `USDJPY:${fx.provider}` };
  }
  return {
    pnlVersion: 2, accountCurrency: 'USD', quoteCurrency,
    pnlQuote: roundMoney(raw), conversion,
    pnl: conversion ? roundMoney(roundMoney(raw) / conversion.quotePerUsd) : null,
  };
}

export function hasAccountPnl<T extends { pnl: number | null; pnlVersion?: number }>(row: T): row is T & { pnl: number } {
  return row.pnlVersion === 2 && typeof row.pnl === 'number' && Number.isFinite(row.pnl);
}
export function formatPnl(row: { pnl: number | null; pnlQuote?: number; quoteCurrency?: string; pnlVersion?: number }): string {
  if (hasAccountPnl(row)) return `${row.pnl >= 0 ? '+' : '-'}$${Math.abs(row.pnl).toFixed(2)}`;
  return Number.isFinite(row.pnlQuote) ? `${row.pnlQuote!.toFixed(2)} ${row.quoteCurrency ?? ''} (USD unavailable)` : 'USD P&L unavailable';
}
