// Calendar-date arithmetic on "YYYY-MM-DD" strings (Gregorian storage, Jalali months for display/navigation).
// Dates are handled as UTC-noon Date objects so no server/browser time zone can shift the day.
import { addMonths, endOfMonth, startOfMonth } from "date-fns-jalali";

export function isoToNoon(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`);
}

export function noonToIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = isoToNoon(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return noonToIso(d);
}

/** 0 = Sunday … 6 = Saturday (same as Postgres extract(dow)). */
export function dow(iso: string): number {
  return isoToNoon(iso).getUTCDay();
}

export function weekStartOf(iso: string, weekStart = 6): string {
  return addDays(iso, -((dow(iso) - weekStart + 7) % 7));
}

export function weekDays(iso: string, weekStart = 6): string[] {
  const start = weekStartOf(iso, weekStart);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Jalali month containing `iso`: first/last day and a full Saturday-first grid (5–6 weeks). */
export function jalaliMonth(iso: string, weekStart = 6) {
  const noon = isoToNoon(iso);
  // date-fns-jalali uses local getters; noon UTC keeps the same calendar day in every real-world zone.
  const first = noonToIso(new Date(Date.UTC(startOfMonth(noon).getFullYear(), startOfMonth(noon).getMonth(), startOfMonth(noon).getDate(), 12)));
  const lastLocal = endOfMonth(noon);
  const last = noonToIso(new Date(Date.UTC(lastLocal.getFullYear(), lastLocal.getMonth(), lastLocal.getDate(), 12)));
  const gridStart = weekStartOf(first, weekStart);
  const days: string[] = [];
  for (let d = gridStart; d <= last || days.length % 7 !== 0; d = addDays(d, 1)) days.push(d);
  return { first, last, days };
}

export function shiftJalaliMonth(iso: string, months: number): string {
  const shifted = addMonths(isoToNoon(iso), months);
  return noonToIso(new Date(Date.UTC(shifted.getFullYear(), shifted.getMonth(), shifted.getDate(), 12)));
}

/** Postgres-parsable instant for local midnight of `iso` in `tz` (e.g. "2026-10-17 00:00:00 Asia/Tehran"). */
export function localMidnight(iso: string, tz: string): string {
  return `${iso} 00:00:00 ${tz}`;
}
