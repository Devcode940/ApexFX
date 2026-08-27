/**
 * fetch with timeout + user-agent + abort controller
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = 8000, ...fetchOpts } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...fetchOpts,
      signal: controller.signal,
      headers: {
        'User-Agent': 'ApexFX-Terminal/1.0 (Production)',
        ...(fetchOpts.headers || {}),
      },
    });
    return res;
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms for ${url}`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJsonWithTimeout<T = any>(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<T> {
  const res = await fetchWithTimeout(url, options);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return (await res.json()) as T;
}
