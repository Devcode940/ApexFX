/**
 * Safe fetch wrapper with built-in error handling.
 * Prevents unhandled promise rejections and provides graceful fallback.
 *
 * Usage:
 *   const { data, ok } = await safeFetch<Candle[]>('/api/market/history?symbol=EURUSD');
 *   if (ok && data) { /* use data *\/ }
 */
export interface SafeFetchResult<T> {
  data: T | null;
  ok: boolean;
  status?: number;
  error?: string;
}

export const safeFetch = async <T>(
  url: string,
  options?: RequestInit,
  fallbackValue: T | null = null
): Promise<SafeFetchResult<T>> => {
  try {
    const res = await fetch(url, options);

    if (!res.ok) {
      console.warn(`[SafeFetch] HTTP ${res.status}: ${res.statusText} for ${url}`);
      return {
        data: fallbackValue,
        ok: false,
        status: res.status,
        error: `HTTP ${res.status}: ${res.statusText}`,
      };
    }

    // Handle empty responses
    const text = await res.text();
    if (!text || text.trim() === '') {
      return { data: fallbackValue, ok: true, status: res.status };
    }

    const data = JSON.parse(text) as T;
    return { data, ok: true, status: res.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown fetch error';
    console.warn(`[SafeFetch] Failed: ${message} for ${url}`);
    return {
      data: fallbackValue,
      ok: false,
      error: message,
    };
  }
};

/**
 * Server-side safe fetch wrapper (for Node.js environment).
 * Same API as safeFetch but uses global fetch available in Node 18+.
 */
export const serverSafeFetch = safeFetch;
