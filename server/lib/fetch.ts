import { redact } from './logger.js';

export interface FetchWithTimeoutOptions extends RequestInit {
  timeoutMs?: number;
  maxBytes?: number;
  /** Diagnostic label must not contain credentials. */
  label?: string;
}
export function safeUrlLabel(url: string): string {
  try { const u = new URL(url); return `${u.host}${u.pathname}`; }
  catch { return redact(String(url).split(/[?#]/)[0]).slice(0, 120); }
}
export class UpstreamError extends Error {
  constructor(message: string, readonly kind: 'timeout' | 'http' | 'network' | 'aborted' | 'size' | 'parse', readonly status?: number) {
    super(message); this.name = 'UpstreamError';
  }
}

/**
 * Entire response (headers AND bounded body) shares one deadline and caller cancellation.
 * Returns a buffered Response so existing .json()/.text() consumers cannot outlive the deadline.
 * Bounded buffering is intentional for these small JSON proxies; this is NOT a streaming helper.
 */
export async function fetchWithTimeout(url: string, options: FetchWithTimeoutOptions = {}): Promise<Response> {
  const { timeoutMs = 8000, maxBytes = 2 * 1024 * 1024, label, signal: caller, ...init } = options;
  const target = label ? safeUrlLabel(label) : safeUrlLabel(url);
  const controller = new AbortController();
  const signal = caller ? AbortSignal.any([caller, controller.signal]) : controller.signal;
  let timedOut = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let abortListener: (() => void) | undefined;
  const abortError = () => new UpstreamError(timedOut ? `Request timed out after ${timeoutMs}ms for ${target}` : `Request cancelled for ${target}`, timedOut ? 'timeout' : 'aborted');
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    if (signal.aborted) throw abortError();
    const aborted = new Promise<never>((_, reject) => {
      abortListener = () => reject(abortError());
      signal.addEventListener('abort', abortListener, { once: true });
    });
    const task = async () => {
      const headers = new Headers(init.headers);
      if (!headers.has('User-Agent')) headers.set('User-Agent', 'ApexFX-Terminal/1.0 (Production)');
      const response = await fetch(url, { ...init, headers, signal });
      if (signal.aborted) throw abortError();
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > maxBytes) {
        void response.body?.cancel().catch(() => {});
        throw new UpstreamError(`Response too large for ${target}`, 'size');
      }
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      reader = response.body?.getReader();
      while (reader) {
        const { done, value } = await reader.read();
        if (signal.aborted) throw abortError();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) throw new UpstreamError(`Response too large for ${target}`, 'size');
        chunks.push(value);
      }
      const body = Buffer.concat(chunks, bytes);
      const bufferedHeaders = new Headers(response.headers);
      bufferedHeaders.delete('content-encoding'); bufferedHeaders.delete('content-length');
      return new Response([204, 205, 304].includes(response.status) ? null : body, {
        status: response.status, statusText: response.statusText, headers: bufferedHeaders,
      });
    };
    return await Promise.race([task(), aborted]);
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    if (signal.aborted) throw abortError();
    // Never interpolate raw provider error messages, URLs, keys, or response bodies.
    throw new UpstreamError(`Network request failed for ${target}`, 'network');
  } finally {
    clearTimeout(timer);
    if (abortListener) signal.removeEventListener('abort', abortListener);
    if (reader) void reader.cancel().catch(() => {});
    controller.abort();
  }
}
export async function fetchJsonWithTimeout<T = any>(url: string, options: FetchWithTimeoutOptions = {}): Promise<T> {
  const response = await fetchWithTimeout(url, options);
  if (!response.ok) throw new UpstreamError(`HTTP ${response.status} for ${safeUrlLabel(url)}`, 'http', response.status);
  try { return await response.json() as T; }
  catch { throw new UpstreamError(`Invalid JSON for ${safeUrlLabel(url)}`, 'parse'); }
}
