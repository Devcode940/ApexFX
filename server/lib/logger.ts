const IS_PRODUCTION = process.env.NODE_ENV === 'production';

export const log = IS_PRODUCTION
  ? (_msg: string, ..._args: any[]) => {}
  : console.log;

export const warn = (msg: string, ...args: any[]) => {
  if (!IS_PRODUCTION || process.env.SHOW_WARNINGS === 'true') {
    console.warn(msg, ...args);
  }
};

export const error = (msg: string, ...args: any[]) => {
  const sanitized = msg
    .replace(/Bearer\s+[a-zA-Z0-9_\-\.]+/g, 'Bearer [REDACTED]')
    .replace(/token=[a-zA-Z0-9_\-\.]+/g, 'token=[REDACTED]')
    .replace(/api[_-]?key[=:]?\s*[a-zA-Z0-9_\-\.]+/gi, 'api_key=[REDACTED]')
    .replace(/x-api-key[:=]\s*[a-zA-Z0-9_\-\.]+/gi, 'x-api-key=[REDACTED]');
  console.error(sanitized, ...args);
};
