/**
 * Calendar dates (expiry, "today") are `YYYY-MM-DD` strings, which compare
 * correctly as strings. "Today" is always passed in by the caller in the
 * branch's local timezone — the domain never reads a clock.
 */
export type CalendarDate = string;

const CALENDAR_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function assertCalendarDate(value: string, label: string): void {
  if (!CALENDAR_DATE.test(value)) {
    throw new RangeError(`${label} must be a YYYY-MM-DD date, got "${value}"`);
  }
}
