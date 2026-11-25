import { describe, expect, it } from 'vitest';
import {
  addDays,
  financialYearStart,
  formatIsoDate,
  fromIsoDate,
  isIsoDate,
  monthBounds,
  monthLabel,
  toIsoDate,
} from '../dates';
import {
  generatePeriods,
  isLastCycleOfMonth,
  lastWorkingDay,
  PeriodGenerationError,
} from '../periods';

describe('dates', () => {
  it('validates ISO dates', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-2-3')).toBe(false);
    expect(() => fromIsoDate('nope')).toThrow();
  });
  it('round-trips and adds days across months and leap years', () => {
    expect(toIsoDate(fromIsoDate('2028-02-29'))).toBe('2028-02-29');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('month bounds and financial year', () => {
    expect(monthBounds('2026-11-17')).toEqual({ start: '2026-11-01', end: '2026-11-30' });
    expect(monthBounds('2028-02-10').end).toBe('2028-02-29');
    expect(financialYearStart('2026-11-30')).toBe('2026-07-01');
    expect(financialYearStart('2027-06-30')).toBe('2026-07-01');
    expect(financialYearStart('2026-07-01')).toBe('2026-07-01');
  });
  it('formats labels', () => {
    expect(monthLabel('2026-11')).toBe('November 2026');
    expect(formatIsoDate('2026-11-30')).toBe('30 Nov 2026');
  });
});

describe('lastWorkingDay', () => {
  it('returns the last Monday–Friday of the month', () => {
    expect(lastWorkingDay(2026, 11)).toBe('2026-11-30'); // Monday
    expect(lastWorkingDay(2026, 10)).toBe('2026-10-30'); // 31st is Saturday
    expect(lastWorkingDay(2026, 5)).toBe('2026-05-29'); // 31st is Sunday
  });
});

describe('generatePeriods', () => {
  it('MONTHLY: calendar months, pay date last working day', () => {
    const p = generatePeriods({ frequency: 'MONTHLY', from: '2026-10', to: '2027-01' });
    expect(p).toHaveLength(4);
    expect(p[0]).toEqual({ start: '2026-10-01', end: '2026-10-31', payDate: '2026-10-30' });
    expect(p[1]).toEqual({ start: '2026-11-01', end: '2026-11-30', payDate: '2026-11-30' });
    expect(p[3]).toEqual({ start: '2027-01-01', end: '2027-01-31', payDate: '2027-01-29' });
  });

  it('WEEKLY: Monday–Sunday weeks whose end falls in the range', () => {
    const p = generatePeriods({ frequency: 'WEEKLY', from: '2026-11', to: '2026-11' });
    expect(p.map((x) => x.end)).toEqual([
      '2026-11-01',
      '2026-11-08',
      '2026-11-15',
      '2026-11-22',
      '2026-11-29',
    ]);
    expect(p[0]).toEqual({ start: '2026-10-26', end: '2026-11-01', payDate: '2026-11-01' });
    const dec = generatePeriods({ frequency: 'WEEKLY', from: '2026-12', to: '2026-12' });
    expect(dec[0]!.start).toBe('2026-11-30'); // continues without a gap
    expect(dec[dec.length - 1]!.end).toBe('2026-12-27');
  });

  it('FORTNIGHTLY: 14-day blocks from the default anchor (first Monday)', () => {
    const p = generatePeriods({ frequency: 'FORTNIGHTLY', from: '2026-11', to: '2026-11' });
    expect(p).toEqual([
      { start: '2026-10-19', end: '2026-11-01', payDate: '2026-11-01' },
      { start: '2026-11-02', end: '2026-11-15', payDate: '2026-11-15' },
      { start: '2026-11-16', end: '2026-11-29', payDate: '2026-11-29' },
    ]);
  });

  it('FORTNIGHTLY: honours an explicit anchor before or after the range', () => {
    const early = generatePeriods({
      frequency: 'FORTNIGHTLY',
      from: '2026-11',
      to: '2026-11',
      anchor: '2026-01-05',
    });
    const late = generatePeriods({
      frequency: 'FORTNIGHTLY',
      from: '2026-11',
      to: '2026-11',
      anchor: '2027-03-01',
    });
    expect(early).toEqual(late);
    for (const x of early) expect(x.end >= '2026-11-01' && x.end <= '2026-11-30').toBe(true);
    expect(early.every((x, i) => i === 0 || x.start === addDays(early[i - 1]!.end, 1))).toBe(true);
  });

  it('rejects bad ranges and anchors', () => {
    expect(() => generatePeriods({ frequency: 'MONTHLY', from: '2026-12', to: '2026-11' })).toThrow(
      PeriodGenerationError,
    );
    expect(() => generatePeriods({ frequency: 'MONTHLY', from: '2026-13', to: '2026-12' })).toThrow(
      PeriodGenerationError,
    );
    expect(() => generatePeriods({ frequency: 'MONTHLY', from: '2026-01', to: '2028-12' })).toThrow(
      /At most/,
    );
    expect(() =>
      generatePeriods({
        frequency: 'FORTNIGHTLY',
        from: '2026-11',
        to: '2026-11',
        anchor: '2026-02-30',
      }),
    ).toThrow(/anchor/);
  });
});

describe('isLastCycleOfMonth', () => {
  const periods = [
    { id: 'a', start: '2026-10-26', payDate: '2026-11-01' },
    { id: 'b', start: '2026-11-23', payDate: '2026-11-29' },
    { id: 'c', start: '2026-11-30', payDate: '2026-12-06' },
  ];
  it('is true only for the latest pay date in the month', () => {
    expect(isLastCycleOfMonth(periods[0]!, periods)).toBe(false);
    expect(isLastCycleOfMonth(periods[1]!, periods)).toBe(true);
    expect(isLastCycleOfMonth(periods[2]!, periods)).toBe(true);
  });
  it('breaks pay-date ties by start date', () => {
    const tie = [
      { id: 'x', start: '2026-11-01', payDate: '2026-11-30' },
      { id: 'y', start: '2026-11-16', payDate: '2026-11-30' },
    ];
    expect(isLastCycleOfMonth(tie[0]!, tie)).toBe(false);
    expect(isLastCycleOfMonth(tie[1]!, tie)).toBe(true);
  });
});
