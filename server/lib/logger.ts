const IS_PRODUCTION = process.env.NODE_ENV === 'production';

function redactString(value: string): string {
  return value
    .replace(/Bearer\s+[a-zA-Z0-9_\-.]+/g, 'Bearer [REDACTED]')
    .replace(/token=[a-zA-Z0-9_\-.]+/g, 'token=[REDACTED]')
    .replace(/api[_-]?key[=:]?\s*[a-zA-Z0-9_\-.]+/gi, 'api_key=[REDACTED]')
    .replace(/x-api-key[:=]\s*[a-zA-Z0-9_\-.]+/gi, 'x-api-key=[REDACTED]')
    .replace(/(authorization|secret|token)["']?\s*[:=]\s*["']?[^"',\s]+/gi, '$1=[REDACTED]');
}

export function sanitizeForLogs(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value;

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined,
    };
  }

  if (depth >= 4) return '[Truncated]';
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[Circular]';

  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLogs(item, depth + 1, seen));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    sanitized[key] = /(authorization|api[_-]?key|secret|token)/i.test(key)
      ? '[REDACTED]'
      : sanitizeForLogs(nestedValue, depth + 1, seen);
  }
  return sanitized;
}

export const log = IS_PRODUCTION
  ? (_msg: string, ..._args: any[]) => {}
  : console.log;

export const warn = (msg: string, ...args: any[]) => {
  if (!IS_PRODUCTION || process.env.SHOW_WARNINGS === 'true') {
    console.warn(redactString(msg), ...args.map((arg) => sanitizeForLogs(arg)));
  }
};

export const error = (msg: string, ...args: any[]) => {
  console.error(redactString(msg), ...args.map((arg) => sanitizeForLogs(arg)));
};
