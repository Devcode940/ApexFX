import { calendarResponse, type CalendarEvent } from '../../shared/calendar';

// Deliberately synthetic contract fixtures, not historical or forecast claims.
export const CALENDAR_NOW = Date.parse('2026-09-23T12:00:00Z');
export const rawCalendarEvents = [
  { title: 'USD survey fixture', country: 'USD', date: '2026-09-23T09:45:00-04:00', impact: 'High', forecast: '51.7', previous: '52.0' },
  { title: 'GBP speech fixture', country: 'GBP', date: '2026-09-24T03:00:00-04:00', impact: 'Medium', forecast: '', previous: '' },
  { title: 'JPY holiday fixture', country: 'JPY', date: '2026-09-23T00:00:00-04:00', impact: 'Holiday', forecast: '', previous: '' },
];
export function calendarEvent(extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id: 'a'.repeat(24), title: 'USD event fixture', currency: 'USD', impact: 'HIGH',
    scheduledAt: CALENDAR_NOW + 3600_000, sourceDate: '2026-09-23T09:00:00-04:00', timing: 'scheduled',
    forecast: '3.2%', previous: '3.1%', actual: null, ...extra };
}
export function calendarFixture(events = [calendarEvent()], fetchedAt = CALENDAR_NOW) {
  return calendarResponse({ version: 1, fetchedAt, events }, CALENDAR_NOW);
}
