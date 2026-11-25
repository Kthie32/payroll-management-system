import { describe, expect, it } from 'vitest';
import {
  componentAmount,
  computeEarnings,
  daysEmployed,
  daysInclusive,
  InvalidInputError,
  parseIsoDate,
  prorate,
  rateTimesQuantity,
} from '@/lib/payroll-engine';
import { basic, earning, makeInput } from './fixtures/params.fixture';

describe('parseIsoDate', () => {
  it('parses valid dates', () => {
    expect(parseIsoDate('2026-11-25')).toMatchObject({ year: 2026, month: 11, day: 25 });
  });
  it.each(['2026-02-30', '2026-13-01', '26-11-01', '2026/11/01', ''])('rejects %j', (s) => {
    expect(() => parseIsoDate(s)).toThrow(InvalidInputError);
  });
});

describe('daysInclusive', () => {
  it('same day = 1', () => expect(daysInclusive('2026-11-05', '2026-11-05')).toBe(1));
  it('November = 30', () => expect(daysInclusive('2026-11-01', '2026-11-30')).toBe(30));
  it('February 2028 (leap) = 29', () => expect(daysInclusive('2028-02-01', '2028-02-29')).toBe(29));
  it('February 2027 = 28', () => expect(daysInclusive('2027-02-01', '2027-02-28')).toBe(28));
  it('spans a year end', () => expect(daysInclusive('2026-12-25', '2027-01-07')).toBe(14));
  it('end before start throws', () => {
    expect(() => daysInclusive('2026-11-30', '2026-11-01')).toThrow(InvalidInputError);
  });
});

describe('daysEmployed', () => {
  const s = '2026-11-01';
  const e = '2026-11-30';
  it('full period when hired before and no exit', () =>
    expect(daysEmployed(s, e, '2020-01-01', null)).toBe(30));
  it('hired mid-period', () => expect(daysEmployed(s, e, '2026-11-16', null)).toBe(15));
  it('exited mid-period (exit day inclusive)', () =>
    expect(daysEmployed(s, e, '2020-01-01', '2026-11-10')).toBe(10));
  it('hired and exited inside the period', () =>
    expect(daysEmployed(s, e, '2026-11-05', '2026-11-14')).toBe(10));
  it('hired after the period → 0', () => expect(daysEmployed(s, e, '2026-12-01', null)).toBe(0));
  it('exited before the period → 0', () =>
    expect(daysEmployed(s, e, '2020-01-01', '2026-10-31')).toBe(0));
  it('exit after the period → full', () =>
    expect(daysEmployed(s, e, '2020-01-01', '2027-01-31')).toBe(30));
  it('rejects an inverted period', () => {
    expect(() => daysEmployed(e, s, '2020-01-01', null)).toThrow(InvalidInputError);
  });
});

describe('prorate', () => {
  it('full amount when worked ≥ period', () => {
    expect(prorate(3_000_000, 30, 30)).toBe(3_000_000);
    expect(prorate(3_000_000, 31, 30)).toBe(3_000_000);
  });
  it('rounds half-up', () => {
    expect(prorate(1_000_001, 15, 30)).toBe(500_001); // 500,000.5 → 500,001
    expect(prorate(100, 1, 3)).toBe(33);
    expect(prorate(100, 2, 3)).toBe(67);
  });
  it('zero days → 0', () => expect(prorate(3_000_000, 0, 30)).toBe(0));
  it.each([
    [100, 1, 0],
    [100, -1, 30],
    [100, 1.5, 30],
    [100, 1, 2.5],
  ])('rejects prorate(%i, %i, %i)', (a, w, p) => {
    expect(() => prorate(a, w, p)).toThrow(InvalidInputError);
  });
  it('rejects a negative amount', () => expect(() => prorate(-1, 1, 30)).toThrow());
});

describe('rateTimesQuantity', () => {
  it('handles two-decimal quantities with half-up rounding', () => {
    expect(rateTimesQuantity(10_000, 1.5)).toBe(15_000);
    expect(rateTimesQuantity(3_333, 1.5)).toBe(5_000); // 4,999.5 → 5,000
    expect(rateTimesQuantity(1_001, 0.25)).toBe(250); // 250.25 → 250
    expect(rateTimesQuantity(10_000, 0)).toBe(0);
  });
  it('rejects negative quantities', () => {
    expect(() => rateTimesQuantity(10_000, -1)).toThrow(InvalidInputError);
  });
});

describe('componentAmount', () => {
  it('flags a missing FIXED amount', () => {
    const r = componentAmount({ ...earning('BONUS', 0), amount: undefined }, 0);
    expect(r.amount).toBe(0);
    expect(r.warning).toBe('COMPONENT_MISSING_VALUE:BONUS');
  });
  it('flags a missing rate, rate per unit and quantity', () => {
    expect(
      componentAmount({ ...earning('X', 0), calcType: 'PERCENT_OF_BASIC', amount: undefined }, 100)
        .warning,
    ).toBe('COMPONENT_MISSING_VALUE:X');
    expect(
      componentAmount(
        { ...earning('OT', 0), calcType: 'RATE_X_QTY', amount: undefined, quantity: 2 },
        0,
      ).warning,
    ).toBe('COMPONENT_MISSING_VALUE:OT');
    expect(
      componentAmount(
        { ...earning('OT', 0), calcType: 'RATE_X_QTY', amount: undefined, ratePerUnit: 5 },
        0,
      ).warning,
    ).toBe('COMPONENT_MISSING_VALUE:OT');
  });
});

describe('computeEarnings', () => {
  it('case 11: hired 2026-11-16, basic 3,000,000 → 1,500,000', () => {
    const r = computeEarnings(
      makeInput({ employee: { hireDate: '2026-11-16' }, components: [basic(3_000_000)] }),
    );
    expect(r.lines[0]!.amount).toBe(1_500_000);
    expect(r.lines[0]!.note).toMatch(/Prorated 15\/30/);
    expect(r.gross).toBe(1_500_000);
  });

  it('case 12: exited 2026-11-10, basic 3,000,000 → 1,000,000', () => {
    const r = computeEarnings(
      makeInput({ employee: { exitDate: '2026-11-10' }, components: [basic(3_000_000)] }),
    );
    expect(r.lines[0]!.amount).toBe(1_000_000);
  });

  it('does not prorate components with prorate = false', () => {
    const r = computeEarnings(
      makeInput({
        employee: { hireDate: '2026-11-16' },
        components: [basic(3_000_000), earning('TRANSPORT', 100_000)],
      }),
    );
    expect(r.lines[1]!.amount).toBe(100_000);
  });

  it('PERCENT_OF_BASIC uses prorated basic and is not prorated again', () => {
    const housing = {
      ...earning('HOUSING', 0),
      calcType: 'PERCENT_OF_BASIC' as const,
      amount: undefined,
      rateBp: 1000,
      prorate: true,
    };
    const r = computeEarnings(
      makeInput({ employee: { hireDate: '2026-11-16' }, components: [housing, basic(3_000_000)] }),
    );
    // Lines keep input order; housing listed first but computed after BASIC.
    expect(r.lines.map((l) => l.code)).toEqual(['HOUSING', 'BASIC']);
    expect(r.lines[0]!.amount).toBe(150_000);
    expect(r.lines[0]!.note).toBe('10.00% of basic UGX 1,500,000');
    expect(r.basic).toBe(1_500_000);
  });

  it('RATE_X_QTY: 1.5 units, not prorated', () => {
    const ot = {
      ...earning('OVERTIME', 0),
      calcType: 'RATE_X_QTY' as const,
      amount: undefined,
      ratePerUnit: 3_333,
      quantity: 1.5,
      prorate: true,
    };
    const r = computeEarnings(
      makeInput({ employee: { hireDate: '2026-11-16' }, components: [ot] }),
    );
    expect(r.lines[0]).toMatchObject({ amount: 5_000, quantity: 1.5, rate: 3_333 });
  });

  it('splits taxable and NSSF-able totals', () => {
    const r = computeEarnings(
      makeInput({
        components: [
          basic(1_000_000),
          earning('ALLOW', 200_000, { taxable: false, nssfable: false }),
          earning('LUNCH', 50_000, { taxable: true, nssfable: false }),
        ],
      }),
    );
    expect(r).toMatchObject({ gross: 1_250_000, taxable: 1_050_000, nssfBase: 1_000_000 });
    expect(r.lines[1]!.note).toMatch(/not taxable/);
  });

  it('warns when no days were worked', () => {
    const r = computeEarnings(makeInput({ employee: { hireDate: '2026-12-05' } }));
    expect(r.gross).toBe(0);
    expect(r.warnings).toContain('NO_DAYS_WORKED');
  });

  it('ignores deduction and employer components', () => {
    const r = computeEarnings(
      makeInput({
        components: [
          basic(1_000_000),
          { ...earning('LOAN', 5), kind: 'DEDUCTION' },
          { ...earning('MED', 5), kind: 'EMPLOYER' },
        ],
      }),
    );
    expect(r.lines).toHaveLength(1);
  });
});
