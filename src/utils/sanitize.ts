/**
 * XSS-safe string sanitization utility.
 * Escapes HTML special characters to prevent script injection
 * when rendering user-supplied content to the DOM or storing
 * in localStorage for later display.
 */
export const sanitizeString = (str: string): string => {
  if (typeof str !== 'string') return '';
  return str.replace(/[&<>"'`=/]/g, (char) => {
    const entityMap: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
      '`': '&#96;',
      '=': '&equals;',
      '/': '&#47;',
    };
    return entityMap[char] || char;
  });
};

/**
 * Safely parse JSON from localStorage with schema version support.
 * Returns defaultValue on any parse failure or corruption.
 */
export const safeParseJSON = <T>(
  raw: string | null,
  defaultValue: T,
  schemaVersion?: number
): T => {
  if (!raw) return defaultValue;
  try {
    const parsed = JSON.parse(raw) as T & { __schemaVersion?: number };
    if (schemaVersion !== undefined && parsed.__schemaVersion !== schemaVersion) {
      return defaultValue;
    }
    return parsed as T;
  } catch {
    return defaultValue;
  }
};

/**
 * Safely stringify to JSON with optional schema version tag.
 */
export const safeStringifyJSON = (value: unknown, schemaVersion?: number): string => {
  const toSerialize = schemaVersion !== undefined
    ? { ...(value as Record<string, unknown>), __schemaVersion: schemaVersion }
    : value;
  return JSON.stringify(toSerialize);
};

/**
 * Sanitize a symbol name — allow only uppercase letters, digits, and slash.
 */
export const sanitizeSymbol = (symbol: string): string => {
  if (typeof symbol !== 'string') return '';
  return symbol.replace(/[^A-Z0-9/]/g, '').slice(0, 20);
};

/**
 * Sanitize a timeframe — only allow known valid values.
 */
export const sanitizeTimeframe = (tf: string): string => {
  const valid = ['1m', '5m', '15m', '1H', '4H', 'D', 'W', 'M'];
  return valid.includes(tf) ? tf : '1H';
};
