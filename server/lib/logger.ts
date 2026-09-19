/**
 * Structured logging with secret redaction.
 *
 * HARDENING NOTES (2026-09-13 review, finding S1.3):
 *  - The previous implementation sanitized ONLY the first argument. Every call site in
 *    server/services/* passes the sensitive detail as a *variadic* arg
 *    (e.g. error('[TwelveData] quote fetch failed:', e.message)), so upstream API keys
 *    leaked to stdout verbatim. Redaction now applies to EVERY argument, including
 *    Error objects (message + stack).
 *  - Thrown messages must never embed a full upstream URL. server/lib/fetch.ts now
 *    redacts before constructing them; this module is the last line of defence.
 *  - `log` used to be a hard no-op in production, which made "degraded" and "healthy"
 *    indistinguishable in prod logs. It is now level-filtered via LOG_LEVEL so info
 *    logs can be enabled without a code change.
 */

type Level = 'silent' | 'error' | 'warn' | 'info';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const LEVEL_RANK: Record<Level, number> = { silent: 0, error: 1, warn: 2, info: 3 };

function resolveLevel(): Level {
  const raw = (process.env.LOG_LEVEL || '').trim().toLowerCase();
  if (raw === 'silent' || raw === 'error' || raw === 'warn' || raw === 'info') return raw;
  // Default: warnings+errors everywhere; info only outside production (previous behaviour,
  // but now overridable instead of hardcoded off).
  return IS_PRODUCTION ? 'warn' : 'info';
}

const ACTIVE: Level = resolveLevel();

function enabled(level: Level): boolean {
  return LEVEL_RANK[level] <= LEVEL_RANK[ACTIVE];
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // Authorization: Bearer <token>
  [/Bearer\s+[A-Za-z0-9_.=+-]+/gi, 'Bearer [REDACTED]'],
  // ?apikey= / ?api_key= / ?token= / ?secret= / ?password=  (query-string AND json-ish forms).
  // NOTE: intentionally NOT matching a bare `key=` — that produced false positives on ordinary
  // diagnostic strings like `cache key=history:EURUSD:1H`, and no upstream we call uses `key=`.
  [/((?:api[_-]?key|apikey|access[_-]?key|security[_-]?key|token|secret|password)\s*"?\s*[=:]\s*"?)([^\s&"',}\\]+)/gi, '$1[REDACTED]'],
  // Bare key-looking values after a slash (defensive, e.g. logged paths)
  [/(x-api-key\s*[:=]\s*)([^\s&"',]+)/gi, '$1[REDACTED]'],
];

/** Redact anything that looks like a credential from an arbitrary string. */
export function redact(input: string): string {
  let out = input;
  for (const [re, repl] of SECRET_PATTERNS) out = out.replace(re, repl);
  return out;
}

/**
 * Normalize an arbitrary log argument to a redacted string.
 * Error objects are flattened to `name: message` + stack (both redacted) so that
 * callers can keep passing raw errors without leaking what the stack contains.
 */
function normalizeArg(arg: unknown): unknown {
  if (arg instanceof Error) {
    // Prod: one-line, redacted. Dev: keep the stack (already contains the message) but
    // still run it through redact(), since stacks embed URLs.
    if (arg.stack && !IS_PRODUCTION) return redact(String(arg.stack));
    return `${arg.name}: ${redact(String(arg.message))}`;
  }
  if (typeof arg === 'string') return redact(arg);
  if (arg === null || arg === undefined) return arg;
  if (typeof arg === 'object') {
    // Objects (e.g. upstream JSON bodies) may contain keys too — serialize then redact.
    try {
      return redact(JSON.stringify(arg));
    } catch {
      return '[unserializable]';
    }
  }
  return arg;
}

function emit(consoleFn: (...a: any[]) => void, level: Level, msg: string, args: unknown[]) {
  if (!enabled(level)) return;
  consoleFn(redact(msg), ...args.map(normalizeArg));
}

export const log = (msg: string, ...args: unknown[]) => emit(console.log, 'info', msg, args);

export const warn = (msg: string, ...args: unknown[]) => {
  // Preserve the documented SHOW_WARNINGS escape hatch for prod warnings.
  if (IS_PRODUCTION && process.env.SHOW_WARNINGS !== 'true' && !process.env.LOG_LEVEL) return;
  emit(console.warn, 'warn', msg, args);
};

export const error = (msg: string, ...args: unknown[]) => emit(console.error, 'error', msg, args);

/** Exposed for tests. */
export const __testing = { redact, normalizeArg, resolveLevel, enabled };
