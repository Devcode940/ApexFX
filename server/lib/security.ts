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

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else if (process.env.NODE_ENV !== 'production') {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-ws-secret');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  // Security headers (helmet-like)
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    // Basic CSP for API + SPA — allow self, inline styles (Tailwind), and images/data
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' ws: wss: https:; frame-ancestors 'none';"
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

export function sanitizeClientIp(req: Request): string {
  const forwarded = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}
