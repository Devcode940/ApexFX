import type { Request } from 'express';
import { fetchWithTimeout } from './fetch';
import { sanitizeClientIp } from './security';

export class AccessError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message); }
}
/** Verify with Supabase Auth. A decoded JWT payload, Origin, or a browser-supplied user id is not identity. */
export async function requireAccount(req: Request, signal?: AbortSignal): Promise<string> {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !/^Bearer \S{16,4096}$/i.test(header)) throw new AccessError('Sign in to use this service.', 401, 'AUTH_REQUIRED');
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new AccessError('Account verification is not configured.', 503, 'AUTH_NOT_CONFIGURED');
  let response: Response;
  try {
    response = await fetchWithTimeout(`${url.replace(/\/$/, '')}/auth/v1/user`, {
      headers: { apikey: key, Authorization: header }, timeoutMs: 5000, maxBytes: 64_000, signal,
    });
  } catch { throw new AccessError('Account verification is unavailable. Please retry.', 503, 'AUTH_UNAVAILABLE'); }
  if (response.status === 401 || response.status === 403) throw new AccessError('Session expired or invalid. Sign in again.', 401, 'AUTH_INVALID');
  if (!response.ok) throw new AccessError('Account verification is unavailable.', 503, 'AUTH_UNAVAILABLE');
  const user = await response.json().catch(() => null);
  if (typeof user?.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id)) throw new AccessError('Invalid account verification response.', 503, 'AUTH_UNAVAILABLE');
  return user.id;
}
export async function aiPrincipal(req: Request, signal?: AbortSignal): Promise<string> {
  if (req.headers.authorization) return `account:${await requireAccount(req, signal)}`;
  if (process.env.AI_ALLOW_GUESTS === 'true') return `guest:${sanitizeClientIp(req)}`;
  throw new AccessError('Sign in to use the AI assistant.', 401, 'AUTH_REQUIRED');
}
