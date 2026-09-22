/**
 * Path normalisation for the Vercel serverless entry point.
 *
 * Why this exists: on Vercel the whole Express app is reached through ONE function (`api/index`),
 * and depending on how the rewrite is configured the handler receives the original path
 * (`/api/market/prices`), the destination (`/api/index`), or the path with the mount stripped
 * (`/market/prices`). Our routes are declared under `/api/...`, so two of those three shapes 404
 * inside an app that is otherwise working perfectly.
 *
 * Rather than betting on one documented behaviour and failing silently on a deploy, the entry point
 * canonicalises all three. It is a pure function so it can be tested without a platform.
 */
export function normalizeVercelUrl(req: { url?: string; headers?: Record<string, unknown> } | { url?: string; headers?: any }): string {
  const headers: Record<string, unknown> = (req.headers as Record<string, unknown>) || {};
  const invokePath = typeof headers['x-invoke-path'] === 'string' ? (headers['x-invoke-path'] as string) : '';
  const raw = invokePath && invokePath.startsWith('/api') ? invokePath : req.url || '/';

  const qIndex = raw.indexOf('?');
  const path = qIndex === -1 ? raw : raw.slice(0, qIndex);
  const search = qIndex === -1 ? '' : raw.slice(qIndex);

  let p = path || '/';
  // destination form: /api/index, /api/index.ts, /index  ->  /api
  p = p.replace(/^\/api\/index(\.ts|\.js)?$/, '/api');
  p = p.replace(/^\/index(\.ts|\.js)?$/, '/api');
  // rewritten-but-unmounted form: /market/prices -> /api/market/prices
  if (p !== '/api' && !p.startsWith('/api/')) {
    p = `/api${p === '/' ? '' : p}`;
  }
  // healthz is served at both /api/health and /healthz; keep the bare one working
  if (p === '/api/healthz') p = '/healthz';
  return p + search;
}
