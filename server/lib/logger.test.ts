import { describe, it, expect } from 'vitest';
import { redact } from './logger';

/**
 * Regression tests for finding S1.3 of the 2026-09-13 audit.
 *
 * The old `error()` sanitized ONLY its first argument, while every service call site passes the
 * upstream error text as a variadic arg — and because upstream keys travel in query strings
 * (commit 6ce497e), a timeout logged a live API key. These tests pin both directions: the secret
 * must go, ordinary diagnostics must not.
 */
describe('logger.redact', () => {
  it('redacts query-string credentials for every upstream we call', () => {
    expect(redact('https://api.twelvedata.com/quote?symbol=EUR/USD&apikey=TD_SECRET_1')).toBe(
      'https://api.twelvedata.com/quote?symbol=EUR/USD&apikey=[REDACTED]'
    );
    expect(redact('https://finnhub.io/api/v1/news?category=forex&token=FH_SECRET_2')).toContain('token=[REDACTED]');
    expect(redact('https://api.forexrateapi.com/v1/latest?base=USD&api_key=FR_SECRET_3')).toContain('api_key=[REDACTED]');
  });

  it('redacts Authorization: Bearer material', () => {
    expect(redact('Authorization: Bearer sk-or-v1-abc123')).toBe('Authorization: Bearer [REDACTED]');
  });

  it('redacts JSON-ish bodies', () => {
    expect(redact('{"apikey":"LEAK","symbol":"EURUSD"}')).toContain('"apikey":"[REDACTED]"');
    expect(redact('secret: longlivedvalue')).toContain('secret: [REDACTED]');
  });

  it('does NOT mangle ordinary diagnostics (over-redaction is its own bug)', () => {
    const benign = 'cache key=history:EURUSD:1H ttl=60000';
    expect(redact(benign)).toBe(benign);
    const prices = 'watchlist synced {"EURUSD":{"price":1.08523,"high":1.09}}';
    expect(redact(prices)).toBe(prices);
    expect(redact('interval=1m&range=2d')).toBe('interval=1m&range=2d');
    // A bare `key=` is intentionally NOT treated as a credential — see logger.ts comment.
  });
});

describe('config-line redaction', () => {
  it('does not swallow the WS auth state it is meant to report', () => {
    // `wsSecret=UNSET` used to be redacted whole, because the pattern keys on the substring "secret="
    // - so the one line telling an operator why WS handshakes fail read as `wsSecret=[REDACTED]`.
    // Renaming the label to wsTokenAuth keeps it out of the credential shape while staying readable.
    const line =
      '[Server] config: trustProxy=auto ai=gemini(gemini-3.5-flash) wsTokenAuth=origin-only (dev/browser clients)';
    expect(redact(line)).toBe(line);
    // The invariant is that the config line only ever interpolates fixed enum strings. Redaction is
    // pattern-based, so "the label looks safe" is not a security control - `wsSecret=<value>` (the
    // previous spelling) IS matched, which is exactly why the value must never be logged.
    expect(redact('wsSecret=sk-live-abc123')).not.toContain('sk-live-abc123');
    expect(redact('wsTokenAuth=origin-only (dev/browser clients)')).toContain('origin-only');
  });
});
