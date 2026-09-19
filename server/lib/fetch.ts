/**
 * fetch with timeout + user-agent + abort controller.
 *
 * HARDENING NOTES (2026-09-13 review, finding S1.3):
 * The previous version threw `Request timed out after ${ms}ms for ${url}`. Because upstream
 * keys are passed as query params (see commit 6ce497e "restore query-param auth"), that message
 * carried a live API key into every log line and, previously, past the logger's message-only
 * redaction. Errors now reference a *safe* descriptor (host + path, query string dropped).
 */
import { redact } from './logger.js';

export interface FetchWithTimeoutOptions extends RequestInit {
  timeoutMs?: number;
  /** Logged name for diagnostics; defaults to "<host><path>". Never include credentials. */
  label?: string;
}

/** host + pathname only — query/hash (where the secrets live) are discarded. */
export function safeUrlLabel(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    // Not an absolute URL (proxy config, relative path) — redact and truncate defensively.
    return redact(String(url)).slice(0, 120);
  }
}

export class UpstreamError extends Error {
  readonly status?: number;
  readonly kind: 'timeout' | 'http' | 'network';
  constructor(message: string, kind: UpstreamError['kind'], status?: number) {
    super(message);
    this.name = 'UpstreamError';
    this.kind = kind;
    this.status = status;
  }
}

export async function fetchWithTimeout(
  url: string,
  options: FetchWithTimeoutOptions = {}
): Promise<Response> {
  const { timeoutMs = 8000, label, ...fetchOpts } = options;
  const target = label || safeUrlLabel(url);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const res = await fetch(url, {
      ...fetchOpts,
      signal: controller.signal,
      headers: {
        // Kept byte-identical to the pre-refactor value: upstreams (Yahoo especially) gate on
        // UA, and I cannot verify egress behaviour from here — so no gratuitous change.
        'User-Agent': 'ApexFX-Terminal/1.0 (Production)',
        ...(fetchOpts.headers || {}),
      },
    });
    return res;
  } catch (e: any) {
    if (timedOut || e?.name === 'AbortError') {
      throw new UpstreamError(`Request timed out after ${timeoutMs}ms for ${target}`, 'timeout');
    }
    // Never interpolate the original error verbatim — it can contain the full URL.
    throw new UpstreamError(
      `Network request failed for ${target}: ${redact(String(e?.message ?? e))}`,
      'network'
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJsonWithTimeout<T = any>(
  url: string,
  options: FetchWithTimeoutOptions = {}
): Promise<T> {
  const res = await fetchWithTimeout(url, options);
  if (!res.ok) {
    throw new UpstreamError(`HTTP ${res.status} for ${safeUrlLabel(url)}`, 'http', res.status);
  }
  return (await res.json()) as T;
}
