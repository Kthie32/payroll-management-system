/**
 * Calendar-date helpers for payroll. All dates are ISO `YYYY-MM-DD` strings interpreted as
 * calendar days (no time zone). Prisma `@db.Date` values arrive as UTC midnight `Date`s.
 */

export type IsoDate = string;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export function isIsoDate(s: string): boolean {
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === s;
}

/** `Date` (UTC midnight from `@db.Date`) → `YYYY-MM-DD`. */
export function toIsoDate(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` → `Date` at UTC midnight (for Prisma `@db.Date` columns). */
export function fromIsoDate(iso: IsoDate): Date {
  if (!isIsoDate(iso)) throw new Error(`Invalid ISO date: ${iso}`);
  return new Date(`${iso}T00:00:00.000Z`);
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  return toIsoDate(new Date(fromIsoDate(iso).getTime() + days * MS_PER_DAY));
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(iso: IsoDate): number {
  return fromIsoDate(iso).getUTCDay();
}

/** `YYYY-MM` of a date. */
export function monthOf(iso: IsoDate): string {
  return iso.slice(0, 7);
}

export function firstDayOfMonth(year: number, month: number): IsoDate {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

export function lastDayOfMonth(year: number, month: number): IsoDate {
  return toIsoDate(new Date(Date.UTC(year, month, 0)));
}

/** First and last day of the month containing `iso`. */
export function monthBounds(iso: IsoDate): { start: IsoDate; end: IsoDate } {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  return { start: firstDayOfMonth(year, month), end: lastDayOfMonth(year, month) };
}

/** Uganda's financial year runs 1 July – 30 June. Returns the FY start for a date. */
export function financialYearStart(iso: IsoDate): IsoDate {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  return month >= 7 ? `${year}-07-01` : `${year - 1}-07-01`;
}

/** `2026-11` → `November 2026`. */
export function monthLabel(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y!, (m ?? 1) - 1, 1)),
  );
}

/** `2026-11-30` → `30 Nov 2026`. */
export function formatIsoDate(iso: IsoDate): string {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    fromIsoDate(iso),
  );
}
