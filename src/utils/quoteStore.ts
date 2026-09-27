import { parseQuote, shouldAcceptQuote, type MarketQuote } from '../../shared/market';

export interface QuoteEvent { quotes: readonly MarketQuote[]; changed: readonly MarketQuote[] }
/**
 * Ordered event boundary, independent of React renders. Execution subscribers see EVERY accepted
 * message synchronously, including a touch and rebound that React would otherwise batch together.
 * One store belongs to one TradingProvider; it is not a process/global account singleton.
 */
export class QuoteStore {
  private quotes = new Map<string, MarketQuote>();
  private listeners = new Set<(event: QuoteEvent) => void>();
  get(symbol: string): MarketQuote | undefined { return this.quotes.get(symbol); }
  snapshot(): MarketQuote[] { return [...this.quotes.values()]; }
  subscribe(listener: (event: QuoteEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  apply(rates: unknown): number {
    if (!rates || typeof rates !== 'object' || Array.isArray(rates)) return 0;
    const changed: MarketQuote[] = [];
    for (const [symbol, raw] of Object.entries(rates)) {
      const quote = parseQuote(symbol, raw);
      if (!quote || !shouldAcceptQuote(this.quotes.get(symbol), quote)) continue;
      this.quotes.set(symbol, quote);
      changed.push(quote);
    }
    if (changed.length) {
      const event = { quotes: this.snapshot(), changed };
      for (const listener of this.listeners) listener(event);
    }
    return changed.length;
  }
}
