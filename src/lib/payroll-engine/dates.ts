import { InvalidInputError } from './errors';
import type { IsoDate } from './types';

const MS_PER_DAY = 24 * 60 * 60 * 1000; // engine-constants-allow: calendar arithmetic

interface ParsedDate {
  year: number;
  month: number;
  day: number;
  /** Days since the Unix epoch (UTC). */
  dayNumber: number;
}

/** Parses a strict `YYYY-MM-DD` calendar date. Throws InvalidInputError if invalid. */
export function parseIsoDate(value: IsoDate): ParsedDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new InvalidInputError(`Invalid date "${value}"`);
  const [, yyyy, mm, dd] = match;
  const year = Number(yyyy);
  const month = Number(mm);
  const day = Number(dd);
  const ms = Date.UTC(year, month - 1, day);
  const check = new Date(ms);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new InvalidInputError(`Invalid date "${value}"`);
  }
  return { year, month, day, dayNumber: ms / MS_PER_DAY };
}

/** Number of calendar days from `start` to `end`, both inclusive. */
export function daysInclusive(start: IsoDate, end: IsoDate): number {
  const a = parseIsoDate(start).dayNumber;
  const b = parseIsoDate(end).dayNumber;
  if (b < a) throw new InvalidInputError(`End date ${end} is before start date ${start}`);
  return b - a + 1;
}

/**
 * Days of the period the employee was employed: overlap of [periodStart, periodEnd]
 * with [hireDate, exitDate ?? periodEnd], inclusive. Returns 0 when there is no overlap.
 */
export function daysEmployed(
  periodStart: IsoDate,
  periodEnd: IsoDate,
  hireDate: IsoDate,
  exitDate: IsoDate | null,
): number {
  const ps = parseIsoDate(periodStart).dayNumber;
  const pe = parseIsoDate(periodEnd).dayNumber;
  if (pe < ps)
    throw new InvalidInputError(`Period end ${periodEnd} is before start ${periodStart}`);
  const from = Math.max(ps, parseIsoDate(hireDate).dayNumber);
  const to = Math.min(pe, exitDate === null ? pe : parseIsoDate(exitDate).dayNumber);
  return to < from ? 0 : to - from + 1;
}
