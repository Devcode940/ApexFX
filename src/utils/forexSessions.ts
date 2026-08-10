import { Candlestick, Timeframe } from '../types';
import { TIME_CONFIG } from './forexData';

export type ForexSessionKey = 'tokyo' | 'london' | 'newyork' | 'sydney';

export interface ForexSessionDef {
  key: ForexSessionKey;
  name: string;
  city: string;
  flag: string;
  utcStart: number; // UTC hour e.g. 0
  utcEnd: number;   // UTC hour e.g. 9
  bgDark: string;
  bgLight: string;
  borderDark: string;
  borderLight: string;
  textDark: string;
  textLight: string;
  badgePosTop: number; // Offset for badge stacking in case of session overlap
}

export const FOREX_SESSIONS: ForexSessionDef[] = [
  {
    key: 'tokyo',
    name: 'Tokyo (Asian)',
    city: 'Tokyo',
    flag: '🇯🇵',
    utcStart: 0,
    utcEnd: 9,
    bgDark: 'rgba(234, 179, 8, 0.08)',
    bgLight: 'rgba(254, 240, 138, 0.45)',
    borderDark: 'rgba(234, 179, 8, 0.3)',
    borderLight: 'rgba(202, 138, 4, 0.45)',
    textDark: '#eab308',
    textLight: '#ca8a04',
    badgePosTop: 6,
  },
  {
    key: 'london',
    name: 'London (European)',
    city: 'London',
    flag: '🇬🇧',
    utcStart: 8,
    utcEnd: 17,
    bgDark: 'rgba(59, 130, 246, 0.08)',
    bgLight: 'rgba(191, 219, 254, 0.45)',
    borderDark: 'rgba(59, 130, 246, 0.3)',
    borderLight: 'rgba(37, 99, 235, 0.45)',
    textDark: '#3b82f6',
    textLight: '#2563eb',
    badgePosTop: 28,
  },
  {
    key: 'newyork',
    name: 'New York (US)',
    city: 'New York',
    flag: '🇺🇸',
    utcStart: 13,
    utcEnd: 22,
    bgDark: 'rgba(16, 185, 129, 0.08)',
    bgLight: 'rgba(167, 243, 208, 0.45)',
    borderDark: 'rgba(16, 185, 129, 0.3)',
    borderLight: 'rgba(5, 150, 105, 0.45)',
    textDark: '#10b981',
    textLight: '#059669',
    badgePosTop: 50,
  },
  {
    key: 'sydney',
    name: 'Sydney (Pacific)',
    city: 'Sydney',
    flag: '🇦🇺',
    utcStart: 22,
    utcEnd: 7, // Wraps midnight 22:00 -> 07:00
    bgDark: 'rgba(168, 85, 247, 0.08)',
    bgLight: 'rgba(233, 213, 255, 0.45)',
    borderDark: 'rgba(168, 85, 247, 0.3)',
    borderLight: 'rgba(147, 51, 234, 0.45)',
    textDark: '#c084fc',
    textLight: '#9333ea',
    badgePosTop: 72,
  },
];

/**
 * Checks if a session is active at a given Unix timestamp in seconds
 */
export function isSessionActiveAtTime(session: ForexSessionDef, timeSec: number): boolean {
  const date = new Date(timeSec * 1000);
  const hour = date.getUTCHours();
  if (session.utcStart < session.utcEnd) {
    return hour >= session.utcStart && hour < session.utcEnd;
  } else {
    // Session wraps midnight (e.g. Sydney 22:00 -> 07:00 UTC)
    return hour >= session.utcStart || hour < session.utcEnd;
  }
}

/**
 * Formats the UTC session active hours into user's local timezone hours
 */
export function getSessionLocalHoursString(session: ForexSessionDef): string {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), session.utcStart, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), session.utcEnd, 0));
  if (session.utcStart > session.utcEnd && now.getUTCHours() < session.utcEnd) {
    start.setUTCDate(start.getUTCDate() - 1);
  }
  const startStr = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const endStr = end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${startStr} – ${endStr}`;
}

/**
 * Gets local timezone abbreviation name (e.g., PST, EST, GMT, JST)
 */
export function getLocalTimezoneName(): string {
  try {
    const date = new Date();
    const parts = new Intl.DateTimeFormat([], { timeZoneName: 'short' }).formatToParts(date);
    const tzPart = parts.find(p => p.type === 'timeZoneName');
    return tzPart ? tzPart.value : 'Local';
  } catch {
    return 'Local';
  }
}

/**
 * Formats full timestamp into local time and UTC string
 */
export function formatFullTime(timeSec: number): { localStr: string; utcStr: string; tzName: string } {
  const date = new Date(timeSec * 1000);
  const tzName = getLocalTimezoneName();
  const localStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  const utcStr = date.toISOString().slice(11, 19) + ' UTC';
  return { localStr, utcStr, tzName };
}

export interface SessionBlock {
  id: string;
  session: ForexSessionDef;
  startTime: number;
  endTime: number;
}

/**
 * Generates contiguous session blocks for chart background shading based on dataset and timeframe
 */
export function generateSessionBlocks(
  data: Candlestick[],
  timeframe: Timeframe,
  enabledSessions: Record<ForexSessionKey, boolean>
): SessionBlock[] {
  if (!data || data.length === 0) return [];
  const timeOffset = TIME_CONFIG[timeframe]?.offsetSec || 3600;
  const blocks: SessionBlock[] = [];

  FOREX_SESSIONS.forEach((session) => {
    if (!enabledSessions[session.key]) return;

    let currentBlock: SessionBlock | null = null;

    data.forEach((candle, idx) => {
      const active = isSessionActiveAtTime(session, candle.time);

      if (active) {
        if (!currentBlock) {
          currentBlock = {
            id: `session-${session.key}-${candle.time}`,
            session,
            startTime: candle.time,
            endTime: candle.time + timeOffset,
          };
        } else {
          currentBlock.endTime = candle.time + timeOffset;
        }
      } else {
        if (currentBlock) {
          blocks.push(currentBlock);
          currentBlock = null;
        }
      }

      // Finalize at end of array
      if (idx === data.length - 1 && currentBlock) {
        blocks.push(currentBlock);
      }
    });
  });

  return blocks;
}
