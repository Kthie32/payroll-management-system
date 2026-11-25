import {
  addDays,
  dayOfWeek,
  firstDayOfMonth,
  isIsoDate,
  lastDayOfMonth,
  monthOf,
  type IsoDate,
} from './dates';

export type Frequency = 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY';

export interface GeneratedPeriod {
  start: IsoDate;
  end: IsoDate;
  payDate: IsoDate;
}

export interface GeneratePeriodsOptions {
  frequency: Frequency;
  /** First month, `YYYY-MM`. */
  from: string;
  /** Last month, `YYYY-MM` (inclusive). */
  to: string;
  /** FORTNIGHTLY only: the start date of any fortnight in the cycle. Defaults to the first Monday on/after `from`. */
  anchor?: IsoDate;
}

export const MAX_MONTHS = 24;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const SUNDAY = 0;
const SATURDAY = 6;
const MONDAY = 1;
const WEEK = 7;
const FORTNIGHT = 14;

export class PeriodGenerationError extends Error {
  override name = 'PeriodGenerationError';
}

function parseMonth(s: string): { year: number; month: number } {
  const m = MONTH_RE.exec(s);
  if (!m) throw new PeriodGenerationError(`Expected a month as YYYY-MM, got "${s}"`);
  return { year: Number(m[1]), month: Number(m[2]) };
}

/** Last Monday–Friday day of a month (default pay date for monthly payroll). */
export function lastWorkingDay(year: number, month: number): IsoDate {
  let d = lastDayOfMonth(year, month);
  while (dayOfWeek(d) === SATURDAY || dayOfWeek(d) === SUNDAY) d = addDays(d, -1);
  return d;
}

function monthsBetween(from: string, to: string): Array<{ year: number; month: number }> {
  const a = parseMonth(from);
  const b = parseMonth(to);
  const count = (b.year - a.year) * 12 + (b.month - a.month) + 1;
  if (count < 1) throw new PeriodGenerationError('"To" month must not be before "From" month');
  if (count > MAX_MONTHS) {
    throw new PeriodGenerationError(`At most ${MAX_MONTHS} months can be generated at once`);
  }
  const out: Array<{ year: number; month: number }> = [];
  for (let i = 0; i < count; i++) {
    const idx = a.month - 1 + i;
    out.push({ year: a.year + Math.floor(idx / 12), month: (idx % 12) + 1 });
  }
  return out;
}

/**
 * Generates pay periods covering the months `from`..`to`. A period belongs to the month of its
 * pay date; for WEEKLY/FORTNIGHTLY the default pay date is the period end date, so a period is
 * included when its end date falls inside the range.
 */
export function generatePeriods(opts: GeneratePeriodsOptions): GeneratedPeriod[] {
  const months = monthsBetween(opts.from, opts.to);
  const first = months[0]!;
  const last = months[months.length - 1]!;
  const rangeStart = firstDayOfMonth(first.year, first.month);
  const rangeEnd = lastDayOfMonth(last.year, last.month);

  if (opts.frequency === 'MONTHLY') {
    return months.map(({ year, month }) => ({
      start: firstDayOfMonth(year, month),
      end: lastDayOfMonth(year, month),
      payDate: lastWorkingDay(year, month),
    }));
  }

  const length = opts.frequency === 'WEEKLY' ? WEEK : FORTNIGHT;
  let start: IsoDate;
  if (opts.frequency === 'WEEKLY') {
    // Monday–Sunday weeks: first week whose Sunday end is on/after the range start.
    let end = rangeStart;
    while (dayOfWeek(end) !== SUNDAY) end = addDays(end, 1);
    start = addDays(end, -(WEEK - 1));
  } else {
    let anchor = opts.anchor;
    if (anchor === undefined) {
      anchor = rangeStart;
      while (dayOfWeek(anchor) !== MONDAY) anchor = addDays(anchor, 1);
    } else if (!isIsoDate(anchor)) {
      throw new PeriodGenerationError(`Invalid anchor date "${anchor}"`);
    }
    // Move the anchor in whole fortnights so the first block ends on/after the range start.
    start = anchor;
    while (addDays(start, length - 1) < rangeStart) start = addDays(start, length);
    while (addDays(start, -1) >= rangeStart) start = addDays(start, -length);
  }

  const out: GeneratedPeriod[] = [];
  for (; ; start = addDays(start, length)) {
    const end = addDays(start, length - 1);
    if (end > rangeEnd) break;
    if (end >= rangeStart) out.push({ start, end, payDate: end });
  }
  return out;
}

export interface SiblingPeriod {
  id: string;
  start: IsoDate;
  payDate: IsoDate;
}

/**
 * True when no other period of the same pay group has a later pay date in the same month
 * (ties broken by start date). Used for LST, which is taken on the last cycle of a month.
 */
export function isLastCycleOfMonth(target: SiblingPeriod, siblings: SiblingPeriod[]): boolean {
  const month = monthOf(target.payDate);
  return !siblings.some(
    (p) =>
      p.id !== target.id &&
      monthOf(p.payDate) === month &&
      (p.payDate > target.payDate || (p.payDate === target.payDate && p.start > target.start)),
  );
}
