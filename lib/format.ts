// Persian display helpers. Pure functions, safe on server and client.
// Dates are composed from Intl parts so server and browser render identical strings.

import { irrToTomanString } from "./money";

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const numberFmt = new Intl.NumberFormat("fa-IR");

export function toLatinDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/** Digits only → Persian digits, no grouping (dates, codes, phone numbers). */
export function faDigits(value: string | number): string {
  return String(value).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);
}

/** Grouped Persian number, e.g. ۱۲٬۵۰۰٬۰۰۰. */
export function faNumber(value: number | bigint): string {
  return numberFmt.format(value);
}

/** amount_irr → "۱۲٬۵۰۰٬۰۰۰ تومان". */
export function formatToman(irr: string | bigint, withUnit = true): string {
  const toman = irrToTomanString(irr);
  const [whole, frac] = toman.split(".");
  const text = faNumber(BigInt(whole)) + (frac ? `٫${faDigits(frac)}` : "");
  return withUnit ? `${text} تومان` : text;
}

/** Input like "۱۲,۵۰۰,۰۰۰" or "12500000" → "12500000" (ASCII digits, no separators). */
export function normalizeAmountInput(value: string): string {
  return toLatinDigits(value).replace(/[\s,٬،.]/g, "");
}

type Instant = Date | string;

function asDate(value: Instant): Date {
  if (value instanceof Date) return value;
  // Date-only business dates ("YYYY-MM-DD") are pinned to noon UTC so no zone can shift the day.
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
}

function zoneFor(value: Instant, timeZone: string): string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? "UTC" : timeZone;
}

export type JalaliParts = { year: string; month: string; day: string; monthName: string; weekday: string };

export function jalaliParts(value: Instant, timeZone: string): JalaliParts {
  const date = asDate(value);
  const tz = zoneFor(value, timeZone);
  const named = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).formatToParts(date);
  const numeric = new Intl.DateTimeFormat("en-US-u-ca-persian-nu-latn", {
    timeZone: tz,
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).formatToParts(date);
  const pick = (parts: Intl.DateTimeFormatPart[], type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: pick(numeric, "year"),
    month: pick(numeric, "month"),
    day: pick(numeric, "day"),
    monthName: pick(named, "month"),
    weekday: pick(named, "weekday"),
  };
}

/** "۲۵ مهر" */
export function formatDayMonth(value: Instant, timeZone: string): string {
  const p = jalaliParts(value, timeZone);
  return `${faDigits(p.day)} ${p.monthName}`;
}

/** "۲۵ مهر ۱۴۰۵" */
export function formatDate(value: Instant, timeZone: string): string {
  const p = jalaliParts(value, timeZone);
  return `${faDigits(p.day)} ${p.monthName} ${faDigits(p.year)}`;
}

/** "شنبه، ۲۵ مهر ۱۴۰۵" */
export function formatDateWithWeekday(value: Instant, timeZone: string): string {
  const p = jalaliParts(value, timeZone);
  return `${p.weekday}، ${faDigits(p.day)} ${p.monthName} ${faDigits(p.year)}`;
}

/** "۰۹:۳۰" */
export function formatTime(value: Instant, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(asDate(value));
  const h = parts.find((p) => p.type === "hour")?.value ?? "00";
  const m = parts.find((p) => p.type === "minute")?.value ?? "00";
  return faDigits(`${h}:${m}`);
}

/** Org-local calendar date of an instant, as "YYYY-MM-DD" (Gregorian). */
export function localIsoDate(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const get = (t: string) => parts.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** "امروز، ۰۹:۳۰" for today, otherwise "۲۲ مهر، ۱۶:۲۰". */
export function formatStamp(value: Instant, timeZone: string, now: Date = new Date()): string {
  const date = asDate(value);
  const day = localIsoDate(date, timeZone) === localIsoDate(now, timeZone) ? "امروز" : formatDayMonth(date, timeZone);
  return `${day}، ${formatTime(date, timeZone)}`;
}

/** "۶۰٪" */
export function formatPercent(value: number): string {
  return `${faNumber(value)}٪`;
}

/** Two-letter initials as shown on Figma avatars: "سارا محمدی" → "س‌م". */
export function initials(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0][0], words[words.length - 1][0]] : [words[0]?.[0] ?? "?"];
  return letters.join("‌");
}
