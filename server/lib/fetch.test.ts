import { createServer, type ServerResponse, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchJsonWithTimeout, fetchWithTimeout, safeUrlLabel } from './fetch';
let server: Server | undefined;
afterEach(async () => {
  vi.restoreAllMocks(); vi.useRealTimers();
  if (server) { server.closeAllConnections(); await new Promise<void>(done => server!.close(() => done())); server = undefined; }
});
async function listen(reply: (res: ServerResponse) => void) {
  server = createServer((_req, res) => reply(res));
  await new Promise<void>(resolve => server!.listen(0, '0.0.0.0', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
function delayedBody(res: ServerResponse) {
  res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{"ok":');
  const timer = setTimeout(() => res.end('true}'), 250);
  res.on('close', () => clearTimeout(timer));
}
describe('bounded full-body upstream requests', () => {
  it('enforces the deadline after headers, while the body is stalled', async () => {
    const url = await listen(delayedBody);
    await expect(fetchWithTimeout(url, { timeoutMs: 30 })).rejects.toMatchObject({ kind: 'timeout' });
  });
  it('composes caller cancellation rather than overwriting its signal', async () => {
    const url = await listen(delayedBody); const controller = new AbortController();
    const pending = fetchWithTimeout(url, { signal: controller.signal, timeoutMs: 1000 });
    controller.abort(); await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
  });
  it('does not start a request when the caller already cancelled', async () => {
    const spy = vi.spyOn(globalThis, 'fetch'); const controller = new AbortController(); controller.abort();
    await expect(fetchWithTimeout('https://fixture.invalid', { signal: controller.signal })).rejects.toMatchObject({ kind: 'aborted' });
    expect(spy).not.toHaveBeenCalled();
  });
  it('caps untrusted chunked bodies even without Content-Length', async () => {
    const url = await listen(res => { res.writeHead(200); res.write('x'.repeat(100)); res.end(); });
    await expect(fetchWithTimeout(url, { maxBytes: 16 })).rejects.toMatchObject({ kind: 'size' });
  });
  it('clears the deadline timer on success and retains JSON/headers', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"ok":true}', { headers: { 'x-fixture': 'yes' } }));
    const response = await fetchWithTimeout('https://fixture.invalid');
    expect(await response.json()).toEqual({ ok: true }); expect(response.headers.get('x-fixture')).toBe('yes');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('classifies invalid JSON and HTTP errors without echoing a credential URL', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{broken')).mockResolvedValueOnce(new Response('denied', { status: 429 }));
    await expect(fetchJsonWithTimeout('https://fixture.invalid/quote?apikey=secret')).rejects.toMatchObject({ kind: 'parse' });
    await expect(fetchJsonWithTimeout('https://fixture.invalid/quote?apikey=secret')).rejects.toMatchObject({ kind: 'http', status: 429 });
    expect(safeUrlLabel('https://fixture.invalid/quote?apikey=secret')).toBe('fixture.invalid/quote');
  });
});
