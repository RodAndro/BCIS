/**
 * Date handling for the billing system.
 *
 * ── THE PROBLEM ─────────────────────────────────────────────────────────────
 * "Today" is ambiguous the moment a server and a workstation disagree about
 * timezone. A payment taken at 07:00 on 2 September in Bukidnon is 23:00 on
 * 1 September in UTC. If the daily collection report uses the server's local
 * date, a payment lands in the wrong day's report and the cash count does not
 * reconcile.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * Instants are stored as `TIMESTAMPTZ` (UTC).
 * Calendar dates used for billing — due dates, billing periods, report days —
 * are stored as `DATE` columns and computed in Asia/Manila.
 * Every "which day is this?" question goes through this module.
 *
 * ── WHY A FIXED OFFSET ──────────────────────────────────────────────────────
 * The Philippines has been on UTC+8 with no daylight saving since 1978, and
 * there is no scheduled change. Using a fixed offset keeps calendar arithmetic
 * exact and dependency-free, instead of leaning on the runtime's ICU timezone
 * database being present and correct on all three office PCs.
 */

/** Business timezone for all calendar computation. */
export const BUSINESS_TIMEZONE = 'Asia/Manila';

/** Asia/Manila is UTC+8, with no daylight saving. */
export const BUSINESS_UTC_OFFSET_MINUTES = 8 * 60;

const MILLISECONDS_PER_DAY = 86_400_000;
const MILLISECONDS_PER_MINUTE = 60_000;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar date in the business timezone, formatted `YYYY-MM-DD`. */
export type BusinessDate = string;

export class DateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DateError';
  }
}

/** True when the value is a well-formed `YYYY-MM-DD` string. */
export function isBusinessDate(value: string): value is BusinessDate {
  if (!ISO_DATE_PATTERN.test(value)) return false;

  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  // Reject 31 February and friends by round-tripping through UTC.
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

function assertBusinessDate(value: string): void {
  if (!isBusinessDate(value)) {
    throw new DateError(`"${value}" is not a valid date in YYYY-MM-DD form.`);
  }
}

/**
 * The calendar date in Asia/Manila for a given instant.
 * This is the function that decides which day a payment belongs to.
 */
export function toBusinessDate(instant: Date): BusinessDate {
  const shifted = new Date(
    instant.getTime() + BUSINESS_UTC_OFFSET_MINUTES * MILLISECONDS_PER_MINUTE,
  );
  return shifted.toISOString().slice(0, 10);
}

/** The current calendar date in Asia/Manila. */
export function businessToday(now: Date = new Date()): BusinessDate {
  return toBusinessDate(now);
}

/**
 * The UTC instant at which a business date begins (00:00 Asia/Manila).
 * Use this to bound a `TIMESTAMPTZ` range when filtering by business day.
 */
export function businessDateStartUtc(date: BusinessDate): Date {
  assertBusinessDate(date);
  const [yearText, monthText, dayText] = date.split('-');
  const utcMidnight = Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText));
  return new Date(utcMidnight - BUSINESS_UTC_OFFSET_MINUTES * MILLISECONDS_PER_MINUTE);
}

/** The inclusive-exclusive UTC range covering one business day. */
export function businessDayRangeUtc(date: BusinessDate): { start: Date; end: Date } {
  const start = businessDateStartUtc(date);
  return { start, end: new Date(start.getTime() + MILLISECONDS_PER_DAY) };
}

function parseToUtcMidnight(date: BusinessDate): number {
  assertBusinessDate(date);
  const [yearText, monthText, dayText] = date.split('-');
  return Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText));
}

/** Add (or subtract, with a negative count) whole days to a business date. */
export function addBusinessDays(date: BusinessDate, days: number): BusinessDate {
  if (!Number.isInteger(days)) {
    throw new DateError(`Day count must be a whole number, received ${String(days)}.`);
  }
  const shifted = new Date(parseToUtcMidnight(date) + days * MILLISECONDS_PER_DAY);
  return shifted.toISOString().slice(0, 10);
}

/** Add whole months to a business date, clamping the day to the target month. */
export function addBusinessMonths(date: BusinessDate, months: number): BusinessDate {
  if (!Number.isInteger(months)) {
    throw new DateError(`Month count must be a whole number, received ${String(months)}.`);
  }
  const [yearText, monthText, dayText] = date.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  const targetIndex = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(targetIndex / 12);
  const targetMonth = targetIndex % 12;

  const lastDayOfTarget = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDayOfTarget);

  return formatUtcDate(new Date(Date.UTC(targetYear, targetMonth, clampedDay)));
}

/**
 * Whole days from `from` to `to`. Negative when `to` precedes `from`.
 * Used for aging buckets: `daysOverdue = daysBetween(dueDate, businessToday())`.
 */
export function daysBetween(from: BusinessDate, to: BusinessDate): number {
  return Math.round((parseToUtcMidnight(to) - parseToUtcMidnight(from)) / MILLISECONDS_PER_DAY);
}

/** First day of the month containing `date`. */
export function startOfBusinessMonth(date: BusinessDate): BusinessDate {
  const [yearText, monthText] = date.split('-');
  return `${yearText}-${monthText}-01`;
}

/** Last day of the month containing `date`. */
export function endOfBusinessMonth(date: BusinessDate): BusinessDate {
  const [yearText, monthText] = date.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${yearText}-${monthText}-${String(lastDay).padStart(2, '0')}`;
}

/** First and last day of the month containing `date`, as a billing period. */
export function businessMonthPeriod(date: BusinessDate): {
  periodStart: BusinessDate;
  periodEnd: BusinessDate;
} {
  return { periodStart: startOfBusinessMonth(date), periodEnd: endOfBusinessMonth(date) };
}

/** Total days in the month containing `date`. Used for proration. */
export function daysInBusinessMonth(date: BusinessDate): number {
  const [yearText, monthText] = date.split('-');
  return new Date(Date.UTC(Number(yearText), Number(monthText), 0)).getUTCDate();
}

/** `2026-09` label for grouping. */
export function businessMonthKey(date: BusinessDate): string {
  return date.slice(0, 7);
}

/** Human label, e.g. `September 2026`. Deterministic, so reports match on every PC. */
export function formatBusinessMonthLabel(date: BusinessDate): string {
  assertBusinessDate(date);
  const [, monthText] = date.split('-');
  const month = Number(monthText);
  const names = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  return `${names[month - 1] ?? 'Unknown'} ${date.slice(0, 4)}`;
}

function formatUtcDate(date: Date): BusinessDate {
  return date.toISOString().slice(0, 10);
}

/**
 * Format a business date for display, e.g. `02 Sep 2026`.
 * Hand-rolled rather than `Intl.DateTimeFormat` so the output is identical on
 * all three workstations regardless of their installed locale data.
 */
export function formatBusinessDate(date: BusinessDate): string {
  assertBusinessDate(date);
  const [yearText, monthText, dayText] = date.split('-');
  const month = Number(monthText);
  const abbreviations = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${dayText} ${abbreviations[month - 1] ?? '???'} ${yearText}`;
}
