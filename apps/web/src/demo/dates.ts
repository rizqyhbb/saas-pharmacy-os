import type { CalendarDate } from "@apotek/domain";

const DAY_MS = 86_400_000;

const toUtc = (date: CalendarDate): number => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
};

const fromUtc = (ms: number): CalendarDate => new Date(ms).toISOString().slice(0, 10);

export const addDays = (date: CalendarDate, days: number): CalendarDate => fromUtc(toUtc(date) + days * DAY_MS);

export const daysBetween = (from: CalendarDate, to: CalendarDate): number =>
  Math.round((toUtc(to) - toUtc(from)) / DAY_MS);

/** The visitor's local calendar date. Only the client calls this. */
export function localToday(now = new Date()): CalendarDate {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
