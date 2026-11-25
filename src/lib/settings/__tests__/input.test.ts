import { describe, expect, it } from 'vitest';
import {
  bpToPercent,
  dayBefore,
  parseIsoDateInput,
  parseOptionalUgx,
  parseUgxInput,
  percentToBp,
  toIsoDate,
} from '../input';

describe('percentToBp', () => {
  it.each([
    ['20', 2000],
    ['2.5', 250],
    ['0.75', 75],
    ['0', 0],
    ['100', 10000],
    [' 30 % ', 3000],
    [5, 500],
  ])('%s → %d', (input, bp) => expect(percentToBp(input)).toBe(bp));

  it.each(['', 'abc', '1.234', '-5', '1e3', '.5'])('rejects %j', (input) =>
    expect(percentToBp(input)).toBeNull(),
  );
});

describe('bpToPercent', () => {
  it.each([
    [2000, '20'],
    [250, '2.5'],
    [75, '0.75'],
    [5, '0.05'],
    [0, '0'],
    [10000, '100'],
  ])('%d → %s', (bp, s) => expect(bpToPercent(bp)).toBe(s));

  it('round-trips', () => {
    for (const bp of [1, 9, 10, 99, 101, 1234, 3000]) expect(percentToBp(bpToPercent(bp))).toBe(bp);
  });

  it('rejects invalid bp', () => {
    expect(() => bpToPercent(-1)).toThrow();
    expect(() => bpToPercent(1.5)).toThrow();
  });
});

describe('parseUgxInput', () => {
  it.each([
    ['1,000,000', 1000000],
    ['1 000 000', 1000000],
    ['UGX 500', 500],
    ['0', 0],
    [250000, 250000],
  ])('%j → %d', (input, n) => expect(parseUgxInput(input)).toBe(n));

  it.each(['', '1.5', '-10', 'abc', '12345678901234567', null, undefined])('rejects %j', (input) =>
    expect(parseUgxInput(input)).toBeNull(),
  );

  it('parseOptionalUgx treats blank as null', () => {
    expect(parseOptionalUgx('')).toBeNull();
    expect(parseOptionalUgx(undefined)).toBeNull();
    expect(parseOptionalUgx('1,500')).toBe(1500);
    expect(parseOptionalUgx('x')).toBe('invalid');
  });
});

describe('dates', () => {
  it('parses valid ISO dates as UTC midnight', () => {
    expect(parseIsoDateInput('2026-07-01')?.toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });
  it.each(['2026-02-30', '2026-13-01', '01/07/2026', '', null])('rejects %j', (s) =>
    expect(parseIsoDateInput(s)).toBeNull(),
  );
  it('dayBefore crosses month and year boundaries', () => {
    expect(toIsoDate(dayBefore(new Date('2026-07-01')))).toBe('2026-06-30');
    expect(toIsoDate(dayBefore(new Date('2027-01-01')))).toBe('2026-12-31');
    expect(toIsoDate(dayBefore(new Date('2028-03-01')))).toBe('2028-02-29');
  });
});
