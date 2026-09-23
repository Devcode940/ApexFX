import type { ClosedTrade } from '../types';
import { hasAccountPnl } from './money';

/** RFC-style quoted cells plus spreadsheet-formula neutralization for untrusted text. */
export function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  if (typeof value === 'string' && /^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export function toCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
const iso = (time?: number | null) => time && Number.isFinite(time) ? new Date(time).toISOString() : '';
export function tradesCsv(trades: readonly ClosedTrade[]): string {
  return toCsv([
    ['Trade ID', 'Position ID', 'Symbol', 'Instrument kind', 'Type', 'Lots', 'Entry', 'Exit', 'PnL USD', 'PnL quote', 'Quote currency', 'PnL version', 'FX quote per USD', 'FX source', 'FX observation UTC', 'Opened UTC', 'Closed UTC', 'Close reason'],
    ...trades.map(t => [t.id, t.positionId, t.symbol, t.instrumentKind, t.type, t.amount, t.entryPrice, t.exitPrice,
      hasAccountPnl(t) ? t.pnl : null, t.pnlQuote, t.quoteCurrency, t.pnlVersion, t.conversion?.quotePerUsd,
      t.conversion?.source, iso(t.conversion?.asOf), iso(t.openedAt), iso(t.closedAt), t.closeReason]),
  ]);
}
export function downloadTradesCsv(trades: readonly ClosedTrade[], filename: string) {
  const url = URL.createObjectURL(new Blob(['\uFEFF', tradesCsv(trades)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
