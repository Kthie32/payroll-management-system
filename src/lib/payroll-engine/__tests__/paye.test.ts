import { describe, expect, it } from 'vitest';
import { payeCumulative, payeMonthly } from '@/lib/payroll-engine';
import { PAYE_RES } from './fixtures/params.fixture';

describe('payeMonthly (PAYE_RES) — required cases 1–9', () => {
  it.each([
    [1, 335_000, 0],
    [2, 400_000, 13_000],
    [3, 410_000, 15_000],
    [4, 450_000, 25_000],
    [5, 485_000, 33_750],
    [6, 500_000, 38_250],
    [7, 1_000_000, 188_250],
    [8, 10_000_000, 2_888_250],
    [9, 12_000_000, 3_688_250],
  ])('case %i: PAYE on %i = %i', (_case, chargeable, expected) => {
    expect(payeMonthly(PAYE_RES, chargeable)).toBe(expected);
  });
});

describe('payeMonthly — boundaries and rounding', () => {
  it.each([
    [0, 0],
    [335_001, 0], // 0.2 → 0
    [335_003, 1], // 0.6 → 1
    [410_001, 15_000], // 15,000.25 → 15,000
    [410_002, 15_001], // 15,000.5 → 15,001 (half-up)
    [485_001, 33_750], // 33,750.3 → 33,750
    [10_000_001, 2_888_250], // + 0.3 + 0.1 = 0.4 → 0
    [10_000_002, 2_888_251], // + 0.8 → 1
  ])('PAYE on %i = %i', (chargeable, expected) => {
    expect(payeMonthly(PAYE_RES, chargeable)).toBe(expected);
  });

  it('works without a surcharge', () => {
    expect(payeMonthly({ ...PAYE_RES, surcharge: null }, 12_000_000)).toBe(3_488_250);
  });

  it('rejects negative or fractional income', () => {
    expect(() => payeMonthly(PAYE_RES, -1)).toThrow();
    expect(() => payeMonthly(PAYE_RES, 1.5)).toThrow();
  });
});

describe('payeCumulative', () => {
  it('case 13: fortnight 1, 250,000, MTD 0 → 0', () => {
    expect(
      payeCumulative({ params: PAYE_RES, mtdTaxable: 0, mtdPayeWithheld: 0, taxable: 250_000 })
        .paye,
    ).toBe(0);
  });

  it('case 14: fortnight 2, 250,000, MTD taxable 250,000, MTD PAYE 0 → 38,250', () => {
    const r = payeCumulative({
      params: PAYE_RES,
      mtdTaxable: 250_000,
      mtdPayeWithheld: 0,
      taxable: 250_000,
    });
    expect(r.paye).toBe(38_250);
    expect(r.monthTotal).toBe(38_250);
    expect(r.overwithheld).toBe(false);
  });

  it('four weekly cycles add up to the monthly figure', () => {
    let mtdTaxable = 0;
    let withheld = 0;
    for (const week of [200_000, 300_000, 250_000, 250_000]) {
      const r = payeCumulative({
        params: PAYE_RES,
        mtdTaxable,
        mtdPayeWithheld: withheld,
        taxable: week,
      });
      withheld += r.paye;
      mtdTaxable += week;
    }
    expect(withheld).toBe(payeMonthly(PAYE_RES, 1_000_000));
  });

  it('floors at 0 and flags over-withholding', () => {
    const r = payeCumulative({
      params: PAYE_RES,
      mtdTaxable: 500_000,
      mtdPayeWithheld: 50_000,
      taxable: 0,
    });
    expect(r.paye).toBe(0);
    expect(r.overwithheld).toBe(true);
  });

  it('validates inputs', () => {
    expect(() =>
      payeCumulative({ params: PAYE_RES, mtdTaxable: -1, mtdPayeWithheld: 0, taxable: 0 }),
    ).toThrow();
    expect(() =>
      payeCumulative({ params: PAYE_RES, mtdTaxable: 0, mtdPayeWithheld: 0.5, taxable: 0 }),
    ).toThrow();
    expect(() =>
      payeCumulative({ params: PAYE_RES, mtdTaxable: 0, mtdPayeWithheld: 0, taxable: -3 }),
    ).toThrow();
  });
});
