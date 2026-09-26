/**
 * Minimal first-party error telemetry: browser exceptions are POSTed to our own
 * /api/client-errors (server-side rate limited, size capped, redacted in logs).
 * No Sentry-style capture of page content, inputs, or account state — just the
 * error's own message/class and where it happened.
 */
const REPORT_EVERY_MS = 60_000;
let lastReportAt = 0;

interface ClientErrorPayload { kind: 'error' | 'rejection'; message: string; file?: string; at: number }

function report(payload: ClientErrorPayload): void {
  const now = Date.now();
  if (now - lastReportAt < REPORT_EVERY_MS) return; // one beacon per minute, per tab
  lastReportAt = now;
  try {
    const body = JSON.stringify({ ...payload, message: payload.message.slice(0, 300), ua: navigator.userAgent.slice(0, 120) });
    // sendBeacon survives unload; fall back to keepalive fetch.
    if (navigator.sendBeacon?.('/api/client-errors', new Blob([body], { type: 'application/json' }))) return;
    void fetch('/api/client-errors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => { /* telemetry must never surface */ });
  } catch { /* nothing left to try; stay silent */ }
}

export function installClientErrorReporting(): void {
  if (!import.meta.env.PROD) return; // dev console is the better channel there
  window.addEventListener('error', event => {
    report({ kind: 'error', message: event.error?.name ? `${event.error.name}: ${event.error.message}` : event.message || 'Script error',
      file: event.filename, at: Date.now() });
  });
  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason;
    const message = reason instanceof Error ? `${reason.name}: ${reason.message}` : typeof reason === 'string' ? reason : 'Unhandled rejection';
    report({ kind: 'rejection', message, at: Date.now() });
  });
}
