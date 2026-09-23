import crypto from 'crypto';
import type { Application, Request, Response, NextFunction } from 'express';

/**
 * Origins allowed to call the API cross-origin.
 * In production an explicit ALLOWED_ORIGINS is required — the localhost defaults are
 * dev-only and are NOT used as an allowlist once NODE_ENV=production.
 */
export function getAllowedOrigins(): string[] {
  const configured = (process.env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (process.env.APP_URL) { try { configured.push(new URL(process.env.APP_URL).origin); } catch { /* invalid config does not grant an origin */ } }
  return [...new Set(configured.length ? configured : process.env.NODE_ENV === 'production' ? [] : ['http://localhost:5173', 'http://localhost:3000'])];
}
/** CSRF/browser boundary only, NEVER account identity. Dev accepts the exact proxied preview host. */
export function isAllowedBrowserOrigin(origin: string, host?: string): boolean {
  if (getAllowedOrigins().includes(origin)) return true;
  if (process.env.NODE_ENV !== 'production') {
    try { const url = new URL(origin); return ['http:', 'https:'].includes(url.protocol) && url.origin === origin && url.host === host; }
    catch { return false; }
  }
  return false;
}

/**
 * How many proxies sit in front of us.
 *
 * HARDENING NOTE (2026-09-13 review, finding S1.4): the limiter used to key on
 * `x-forwarded-for` unconditionally, which any client can forge — 35 requests with 35
 * distinct forged values all bypassed the 30/min limit (verified). Express only honours
 * XFF when `trust proxy` is configured, so we now derive the client IP from `req.ip`.
 *
 *  - TRUST_PROXY unset  -> trust nothing, EXCEPT on Vercel (which always fronts requests
 *    and would otherwise collapse every user onto one shared edge IP).
 *  - TRUST_PROXY=1..n   -> trust n proxy hops (typical for a single nginx/ALB hop).
 *  - TRUST_PROXY=true    -> trust all hops (documented as unsafe: clients can prepend hops).
 */
/**
 * Is this address one that a remote end-user cannot arrive from directly - i.e. loopback, RFC1918,
 * link-local, CGNAT, or an IPv6 ULA? Used to decide whether an `X-Forwarded-For` header is worth
 * believing at all.
 *
 * Deliberately coarse. Note it treats a *pod/service mesh* peer as private, so on a flat
 * container network where a co-tenant can reach this port directly, that peer could still forge XFF.
 * The alternative (never auto-trust) is what made every user share one bucket behind a plain nginx
 * proxy; `TRUST_PROXY=0` still forces this off if your topology is hostile.
 */
/**
 * Did this request carry a forwarding header that the framework did NOT act on?
 *
 * Expressed as a comparison of outcomes rather than a re-implementation of the trust rules: when
 * `trust proxy` believes the header, `req.ip` differs from the socket peer; when it does not,
 * `req.ip` is exactly the socket peer. That keeps this honest across every TRUST_PROXY mode
 * (off, hop count, range list) without a second, drift-prone copy of the CIDR logic - and it is how
 * an operator learns that someone is forging headers, or that a proxy was never configured.
 */
export function isIgnoredForwardedHeader(req: {
  headers?: Record<string, unknown>;
  ip?: string;
  socket?: { remoteAddress?: string };
}): boolean {
  const h = req.headers || {};
  if (!h['x-forwarded-for'] && !h['x-real-ip'] && !h['forwarded']) return false;
  const norm = (v: unknown) => String(v ?? '').replace(/^::ffff:/, '').trim();
  const socketIp = norm(req.socket?.remoteAddress);
  const resolved = norm(req.ip);
  if (!resolved) return true;
  return resolved === socketIp;
}
/**
 * Trusted proxy ranges, resolved by proxy-addr (ipaddr.js CIDR math, not string prefixes):
 * loopback (127/8, ::1), link-local (169.254/16, fe80::/10), unique-local (10/8, 172.16/12,
 * 192.168/16, fc00::/7) and CGNAT (100.64/10, which some managed platforms use for the edge hop).
 *
 * Why a range list and not a predicate: Express 4 compiles `trust proxy` through proxy-addr, which
 * calls a function trust as `trust(ip, hopIndex)` - NOT `trust(req)`. A predicate that inspects
 * `req.socket` is therefore silently consulted with the wrong argument shape and quietly trusts
 * nothing (verified: `req.ip` stayed 127.0.0.1 with a correct-looking predicate). The range list is
 * the supported API and it also handles multi-hop chains: walking stops at the first untrusted hop,
 * so a client on a public address cannot forge `X-Forwarded-For: 1.2.3.4` or smuggle a fake private
 * intermediate hop - both collapse to the socket address.
 */
export const TRUSTED_PROXY_RANGES = ['loopback', 'linklocal', 'uniquelocal', '100.64.0.0/10'] as const;

/**
 * Decide the `trust proxy` setting.
 *
 *  - explicit `TRUST_PROXY=<n>`  -> trust n hops (n=1 is the classic single nginx/ALB setup)
 *  - explicit `TRUST_PROXY=true` -> trust everything (only correct if the port is never exposed)
 *  - explicit `TRUST_PROXY=0|false` -> force off: every user behind the proxy then shares one
 *    rate-limit bucket, which is fail-safe (annoying) rather than spoofable
 *  - otherwise AUTO: trust the ranges above, which is "on when a proxy is actually in front,
 *    off when it isn't" without any configuration at all.
 *
 * Residual exposure to be honest about: a co-tenant that can reach this port *directly* over a
 * private network (pod CIDR, docker bridge, VPC) is inside the trusted ranges, so on a flat
 * container network it can still choose its own apparent client IP. That is the accepted trade for
 * not breaking every proxy deployment; `TRUST_PROXY=0` closes it.
 */
export function createTrustProxySetting(
  env: Record<string, string | undefined> = process.env
): { setting: boolean | number | string[]; mode: string } {
  const raw = (env.TRUST_PROXY ?? '').trim();
  const lower = raw.toLowerCase();
  if (lower === '0' || lower === 'false' || lower === 'off' || lower === 'none') {
    return { setting: false, mode: 'disabled (explicit TRUST_PROXY=' + raw + ')' };
  }
  if (raw) {
    if (/^\d+$/.test(raw)) return { setting: Number(raw), mode: `explicit (${raw} hop${raw === '1' ? '' : 's'})` };
    if (lower === 'true' || lower === 'all' || lower === 'trust') return { setting: true, mode: 'explicit (trust all proxies)' };
    // Anything else is treated as a comma-separated range list, e.g. "10.0.0.0/8, 1.2.3.4".
    return { setting: raw.split(',').map((v) => v.trim()).filter(Boolean), mode: `explicit (ranges: ${raw})` };
  }
  // Vercel/managed platforms always forward and their edge is not a client; blanket trust is correct.
  if (env.VERCEL) return { setting: true, mode: 'auto (Vercel edge always forwards)' };
  return { setting: [...TRUSTED_PROXY_RANGES], mode: 'auto (private/loopback proxy ranges)' };
}

export function applyTrustProxy(app: Application): string {
  const { setting, mode } = createTrustProxySetting();
  app.set('trust proxy', setting as never);
  return mode;
}

/** Client identity used as a rate-limit key. Never trusts a header the app hasn't opted into. */
export function sanitizeClientIp(req: { ip?: string; socket?: { remoteAddress?: string } }): string {
  // Express computes req.ip from XFF only when `trust proxy` is enabled; otherwise it is the
  // socket address. That single source of truth removes the spoofing path.
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  // Normalize IPv6-mapped IPv4 so limits aren't split across "::ffff:1.2.3.4" and "1.2.3.4".
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction) {
  // Fingerprinting: Express advertises itself by default.
  res.removeHeader('X-Powered-By');

  const allowedOrigins = getAllowedOrigins();
  const origin = req.headers.origin;
  const originAllowed = typeof origin === 'string' && allowedOrigins.includes(origin);

  if (originAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin as string);
    res.setHeader('Vary', 'Origin');
    // Credentials are only ever paired with an explicit origin. `*` + credentials is an
    // invalid combination that browsers reject, and reflecting credentials to any origin
    // is what makes CSRF-style reads possible.
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else if (process.env.NODE_ENV !== 'production') {
    // Dev only. Deliberately NO credentials here, so dev can't accidentally ship a
    // credentialed wildcard.
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-ws-secret');

  // Security headers (helmet-like)
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (process.env.NODE_ENV === 'production') res.setHeader('X-Frame-Options', 'DENY');
  else res.removeHeader('X-Frame-Options'); // dev previews are intentionally embedded; production stays frame-denied
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()');

  if (process.env.NODE_ENV === 'production') {
    // `preload` intentionally omitted: submitting to the HSTS preload list is a separate,
    // hard-to-undo decision that also requires the whole domain to be https-only.
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

    // CSP notes:
    //  - no 'unsafe-eval': the production bundle is static and does not need it (dev HMR is
    //    exempt because CSP is only emitted in production). If a future dependency starts
    //    needing eval, opt out via CSP_SCRIPT_SRC rather than editing this string.
    //  - 'unsafe-inline' for styles is required by Tailwind/React inline styles.
    //  - connect-src no longer includes a blanket `https:`: the SPA only talks to same-origin
    //    /api/* plus the market WebSocket, and a wildcard https connect-src would make the CSP
    //    useless as an exfiltration control.
    const scriptSrc = process.env.CSP_SCRIPT_SRC || "'self'";

    // connect-src review note: the SPA talks to (a) same-origin /api/*, (b) the market WebSocket,
    // and (c) Supabase DIRECTLY from the browser (src/lib/supabase.ts), bypassing our server.
    // A blanket `https:` would have neutered the policy as an exfiltration control, and plain
    // 'self' would silently break cloud sync. So: derive the Supabase host from config, and let
    // operators append anything else explicitly.
    const connectSrc = new Set<string>(["'self'", 'ws:', 'wss:']);
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    if (supabaseUrl) {
      try { connectSrc.add(new URL(supabaseUrl).origin); } catch { /* malformed -> ignore */ }
    }
    if (process.env.CSP_CONNECT_EXTRA) {
      for (const src of process.env.CSP_CONNECT_EXTRA.split(/\s+/)) if (src) connectSrc.add(src);
    }
    const connectSrcStr = [...connectSrc].join(' ');

    res.setHeader(
      'Content-Security-Policy',
      `default-src 'self'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; ` +
        `img-src 'self' data:; font-src 'self' data: https://fonts.gstatic.com; ` +
        `connect-src ${connectSrcStr}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none';`
    );
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
}

export function validateSymbolFormat(symbol: string, allowSlash = false): boolean {
  const pattern = allowSlash ? /^[A-Z0-9/]{1,20}$/ : /^[A-Z0-9]{1,20}$/;
  return pattern.test(symbol);
}

/**
 * Constant-time secret comparison. `a !== b` leaks the match position through timing; the WS
 * shared secret is a long-lived static value, which is exactly what timing attacks target.
 */
export function timingSafeCompare(a: string | undefined, b: string): boolean {
  if (typeof a !== 'string' || a.length === 0 || b.length === 0) return false;
  // Hash to a fixed length first: timingSafeEqual requires equal-length buffers, and hashing
  // keeps the total cost independent of the secret's length and contents.
  const bufA = crypto.createHash('sha256').update(a, 'utf8').digest();
  const bufB = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(bufA, bufB);
}
