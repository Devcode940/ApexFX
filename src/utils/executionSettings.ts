/**
 * Paper-trading execution cost settings. Off/zero by default so existing journals
 * keep midpoint-only fills until the user opts into more realistic costs.
 * Read synchronously at order transitions; never trusted for live trading (there is none).
 */
export interface ExecutionSettings {
  /** Fill BUY at ask and SELL/close at bid when the quote carries both. */
  spreadFills: boolean;
  /** Commission charged per lot per leg (entry leg + exit leg), USD. */
  commissionUsdPerLot: number;
}
const KEY = 'apexfx.execution.settings.v1';
export const DEFAULT_EXECUTION_SETTINGS: ExecutionSettings = { spreadFills: false, commissionUsdPerLot: 0 };

export function loadExecutionSettings(): ExecutionSettings {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!raw || typeof raw !== 'object') return DEFAULT_EXECUTION_SETTINGS;
    const value = raw as Record<string, unknown>;
    const commission = typeof value.commissionUsdPerLot === 'number' && Number.isFinite(value.commissionUsdPerLot)
      ? Math.min(100, Math.max(0, value.commissionUsdPerLot)) : 0;
    return { spreadFills: value.spreadFills === true, commissionUsdPerLot: commission };
  } catch { return DEFAULT_EXECUTION_SETTINGS; }
}

export function saveExecutionSettings(settings: ExecutionSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* private mode: session-only */ }
}
