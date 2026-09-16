import type { Request, Response, NextFunction } from 'express';

export function getAllowedOrigins(): string[] {
  if (process.env.ALLOWED_ORIGINS) {
    return process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return ['http://localhost:5173', 'http://localhost:3000'];
}

export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction) {
  const allowedOrigins = getAllowedOrigins();
  const origin = req.headers.origin;

  // Always Vary on Origin so CDNs/browsers cache correctly
  res.setHeader('Vary', 'Origin');

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (process.env.NODE_ENV !== 'production') {
    // In dev we accept any origin so sandboxed/preview hosts work.
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    else res.setHeader('Access-Control-Allow-Origin', '*');
  }
  // NOTE: in production, origins NOT in the allowlist receive no
  // Access-Control-Allow-Origin header → browser blocks them.

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-ws-secret');
  res.setHeader('Access-Control-Max-Age', '86400');
  // Do not set Allow-Credentials: true — we use bearer tokens, not cookies,
  // and setting it alongside wildcard origins is forbidden by the Fetch spec.

  // Security headers (helmet-like)
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('X-Frame-Options', 'DENY');
  }
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');

  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    // CSP allows only hashed/bundled scripts. Vite production output contains no
    // inline scripts, so we can drop unsafe-inline/unsafe-eval for scripts.
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' ws: wss: https:; frame-ancestors 'none'; object-src 'none'; base-uri 'self';"
    );
  } else {
    // Dev: Vite HMR uses inline scripts + eval source maps. Allow framing in sandbox/preview environments.
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' ws: wss: http: https:; frame-ancestors *;"
    );
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
}

export function validateSymbolFormat(symbol: string, allowSlash = false): boolean {
  const pattern = allowSlash ? /^[A-Z0-9\/]{1,20}$/ : /^[A-Z0-9]{1,20}$/;
  return pattern.test(symbol);
}

const TRUSTED_PROXIES = new Set<string>([
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
]);

type RequestLike = { socket: { remoteAddress?: string }; headers: Record<string, unknown> };

export function sanitizeClientIp(req: Request | RequestLike): string {
  const socketAddr = req.socket.remoteAddress || '';
  // Only trust x-forwarded-for when the direct peer is a known loopback/proxy.
  // Additional trusted proxies can be configured via TRUST_PROXY_IPS (comma-separated).
  if (process.env.TRUST_PROXY_IPS) {
    process.env.TRUST_PROXY_IPS.split(',').forEach((ip) => {
      const t = ip.trim();
      if (t) TRUSTED_PROXIES.add(t);
    });
  }
  if (TRUSTED_PROXIES.has(socketAddr)) {
    const xff = (req.headers['x-forwarded-for'] as string | undefined) ||
                (req.headers['X-Forwarded-For'] as string | undefined);
    const forwarded = xff?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
  }
  return socketAddr || 'unknown';
}
