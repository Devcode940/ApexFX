import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { AddressInfo } from 'net';
import {
  applyTrustProxy,
  createTrustProxySetting,
  isIgnoredForwardedHeader,
  sanitizeClientIp,
  timingSafeCompare,
  validateSymbolFormat,
  TRUSTED_PROXY_RANGES,
} from './security';

/**
 * Regression tests for finding S1.4: the rate limiter used to key on an attacker-controlled
 * `x-forwarded-for` header. Verified live: 35 requests with 35 forged XFF values all bypassed
 * the 30 req/min limit, while the same flood without the header got 429'd.
 */
describe('client IP resolution', () => {
  let server: Server | null = null;
  afterEach(() => { server?.close(); server = null; });

  async function ipAsSeenByApp(env: Record<string, string | undefined>, xff?: string): Promise<string> {
    const prev = { ...process.env };
    Object.assign(process.env, env);
    try {
      const app = express();
      applyTrustProxy(app);
      let seen = '';
      app.get('/whoami', (req, res) => { seen = sanitizeClientIp(req); res.end('ok'); });
      server = app.listen(0, '127.0.0.1');
      await new Promise((r) => server!.once('listening', r as () => void));
      const port = (server!.address() as AddressInfo).port;
      await fetch(`http://127.0.0.1:${port}/whoami`, { headers: xff ? { 'x-forwarded-for': xff } : {} });
      return seen;
    } finally { process.env = prev; }
  }

  it('TRUST_PROXY=0 ignores x-forwarded-for even from loopback (escape hatch)', async () => {
    const seen = await ipAsSeenByApp({ TRUST_PROXY: '0', VERCEL: '' }, '9.9.9.9');
    expect(seen).not.toBe('9.9.9.9');
    expect(seen).toContain('127.0.0.1');
  });

  it('honours x-forwarded-for when explicitly opted in', async () => {
    const seen = await ipAsSeenByApp({ TRUST_PROXY: '1' }, '9.9.9.9');
    expect(seen).toBe('9.9.9.9');
  });

  it('AUTO mode trusts x-forwarded-for from a private peer (works behind nginx/ALB with no config)', async () => {
    // The 2026-09-13 decision: the safe-but-broken default (off unless set) made every user share
    // one bucket for anyone deploying behind a proxy that didn't read the docs. Auto mode keeps the
    // spoofing path closed by conditioning on the *socket peer*, not the header.
    const seen = await ipAsSeenByApp({ TRUST_PROXY: '', VERCEL: '' }, '9.9.9.9');
    expect(seen).toBe('9.9.9.9');
  });

  it('normalizes IPv6-mapped IPv4 so one client is one bucket', () => {
    const req = { ip: '::ffff:203.0.113.7', socket: { remoteAddress: '::ffff:203.0.113.7' } } as never;
    expect(sanitizeClientIp(req)).toBe('203.0.113.7');
  });
});

describe('trust-proxy setting', () => {
  it('AUTO mode is the proxy-range list, not a predicate', () => {
    // Express 4 hands a function-trust `trust(ip, index)`, not the request, so a predicate that
    // looks at req.socket never fires. Ranges are the supported shape (found by experiment).
    const { setting } = createTrustProxySetting({});
    expect(setting).toEqual([...TRUSTED_PROXY_RANGES]);
    expect(typeof setting).not.toBe('function');
  });

  it('explicit values win over auto', () => {
    expect(createTrustProxySetting({ TRUST_PROXY: '2' }).setting).toBe(2);
    expect(createTrustProxySetting({ TRUST_PROXY: 'true' }).setting).toBe(true);
    expect(createTrustProxySetting({ TRUST_PROXY: 'false' }).setting).toBe(false);
    expect(createTrustProxySetting({ TRUST_PROXY: '0' }).setting).toBe(false);
    expect(createTrustProxySetting({ TRUST_PROXY: '10.0.0.0/8, 1.2.3.4' }).setting).toEqual(['10.0.0.0/8', '1.2.3.4']);
    expect(createTrustProxySetting({ VERCEL: '1' }).setting).toBe(true);
  });

  it('flags a forwarded header the framework did not act on, in every mode', () => {
    // TRUST_PROXY=0 or an untrusted peer: req.ip stays the socket address -> report it.
    expect(isIgnoredForwardedHeader({ headers: { 'x-forwarded-for': '9.9.9.9' }, ip: '203.0.113.5', socket: { remoteAddress: '203.0.113.5' } })).toBe(true);
    expect(isIgnoredForwardedHeader({ headers: { 'x-forwarded-for': '9.9.9.9' }, ip: '127.0.0.1', socket: { remoteAddress: '::ffff:127.0.0.1' } })).toBe(true);
    // Header honoured -> req.ip differs from the peer: nothing to report.
    expect(isIgnoredForwardedHeader({ headers: { 'x-forwarded-for': '9.9.9.9' }, ip: '9.9.9.9', socket: { remoteAddress: '127.0.0.1' } })).toBe(false);
    // No header at all: nothing to report.
    expect(isIgnoredForwardedHeader({ headers: {}, ip: '203.0.113.5', socket: { remoteAddress: '203.0.113.5' } })).toBe(false);
  });

  it('the trusted ranges are the ones the comment claims', () => {
    expect(TRUSTED_PROXY_RANGES).toContain('loopback');
    expect(TRUSTED_PROXY_RANGES).toContain('uniquelocal');
    expect(TRUSTED_PROXY_RANGES).toContain('100.64.0.0/10'); // CGNAT edge hops on some platforms
  });
});

describe('timingSafeCompare', () => {
  it('accepts equal secrets and rejects everything else', () => {
    expect(timingSafeCompare('s3cr3t', 's3cr3t')).toBe(true);
    expect(timingSafeCompare('s3cr3t', 's3cr3u')).toBe(false);
    expect(timingSafeCompare('short', 'muchlongervalue')).toBe(false);
    expect(timingSafeCompare(undefined, 'anything')).toBe(false);
    expect(timingSafeCompare('', 'anything')).toBe(false);
    // The old `provided !== requiredSecret` also accepted an empty required secret path; guard it.
    expect(timingSafeCompare('', '')).toBe(false);
  });
});

describe('validateSymbolFormat', () => {
  it('accepts the instrument set and rejects injection attempts', () => {
    expect(validateSymbolFormat('EUR/USD', true)).toBe(true);
    expect(validateSymbolFormat('EURUSD', false)).toBe(true);
    expect(validateSymbolFormat('EURUSD;rm -rf', false)).toBe(false);
    expect(validateSymbolFormat('../../etc/passwd', true)).toBe(false);
    expect(validateSymbolFormat('A'.repeat(21), false)).toBe(false);
  });
});
