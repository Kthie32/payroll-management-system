import { describe, expect, it } from 'vitest';
import { applyDeductions, lstInstalment, nssf } from '@/lib/payroll-engine';
import { NSSF } from './fixtures/params.fixture';
import { LST_FIXTURE } from './fixtures/lst-bands.fixture';

describe('nssf', () => {
  it('5% employee / 10% employer', () => {
    expect(nssf({ params: NSSF, base: 1_000_000, applicable: true })).toEqual({
      base: 1_000_000,
      employee: 50_000,
      employer: 100_000,
    });
  });
  it('rounds half-up', () => {
    expect(nssf({ params: NSSF, base: 10, applicable: true })).toEqual({
      base: 10,
      employee: 1,
      employer: 1,
    });
    expect(nssf({ params: NSSF, base: 15, applicable: true })).toEqual({
      base: 15,
      employee: 1,
      employer: 2,
    });
  });
  it('applies a ceiling when set', () => {
    expect(
      nssf({ params: { ...NSSF, ceiling: 500_000 }, base: 1_000_000, applicable: true }),
    ).toEqual({
      base: 500_000,
      employee: 25_000,
      employer: 50_000,
    });
  });
  it('case 16: zero when not applicable', () => {
    expect(nssf({ params: NSSF, base: 1_000_000, applicable: false })).toEqual({
      base: 0,
      employee: 0,
      employer: 0,
    });
  });
  it('rejects a negative base', () => {
    expect(() => nssf({ params: NSSF, base: -1, applicable: true })).toThrow();
  });
});

describe('lstInstalment', () => {
  const base = {
    params: LST_FIXTURE,
    payDate: '2026-08-28',
    isLastCycleOfMonth: true,
    applicable: true,
    monthlyGross: 1_000_000,
  };

  it('case 19: August, last cycle → annual ÷ 4 rounded half-up', () => {
    const r = lstInstalment(base);
    expect(r.amount).toBe(7_501); // 30,002 ÷ 4 = 7,500.5 → 7,501
    expect(r.warning).toBeNull();
  });
  it('case 18: November → 0', () => {
    expect(lstInstalment({ ...base, payDate: '2026-11-28' })).toMatchObject({
      amount: 0,
      note: 'Not an LST month',
    });
  });
  it('not the last cycle of the month → 0', () => {
    expect(lstInstalment({ ...base, isLastCycleOfMonth: false }).amount).toBe(0);
  });
  it('not applicable → 0', () => {
    expect(lstInstalment({ ...base, applicable: false }).note).toMatch(/lstApplicable = false/);
  });
  it('band boundaries: from inclusive, to exclusive', () => {
    expect(lstInstalment({ ...base, monthlyGross: 99_999 }).amount).toBe(0);
    expect(lstInstalment({ ...base, monthlyGross: 100_000 }).amount).toBe(2_500);
    expect(lstInstalment({ ...base, monthlyGross: 2_000_000 }).amount).toBe(25_000);
  });
  it('no band configured → 0', () => {
    expect(lstInstalment({ ...base, params: { ...LST_FIXTURE, bands: [] } }).note).toMatch(
      /No LST band/,
    );
  });
  it('case 20: rule missing in an LST month → warning', () => {
    const r = lstInstalment({ ...base, params: null, fallbackMonths: [7, 8, 9, 10] });
    expect(r).toMatchObject({ amount: 0, warning: 'LST_RULE_MISSING' });
  });
  it('rule missing without known months → warns on the last cycle', () => {
    expect(lstInstalment({ ...base, params: null }).warning).toBe('LST_RULE_MISSING');
  });
  it('rule missing outside LST months or not last cycle → no warning', () => {
    expect(
      lstInstalment({ ...base, params: null, fallbackMonths: [7], payDate: '2026-11-28' }).warning,
    ).toBeNull();
    expect(lstInstalment({ ...base, params: null, isLastCycleOfMonth: false }).warning).toBeNull();
  });
  it('rejects a negative gross', () => {
    expect(() => lstInstalment({ ...base, monthlyGross: -1 })).toThrow();
  });
});

describe('applyDeductions', () => {
  it('case 22: caps at net − floor and carries the rest forward', () => {
    const r = applyDeductions({
      netBeforeDeductions: 761_750,
      gross: 1_000_000,
      minNetPayBp: 2000,
      carryForward: [],
      deductions: [{ code: 'LOAN', amount: 900_000, priority: 10 }],
    });
    expect(r.allowed).toBe(561_750);
    expect(r.total).toBe(561_750);
    expect(r.applied[0]).toMatchObject({ amount: 561_750, carried: 338_250 });
    expect(r.carryForward).toEqual([{ code: 'LOAN', amount: 338_250 }]);
  });

  it('case 23: carried-forward amounts go before current deductions', () => {
    const r = applyDeductions({
      netBeforeDeductions: 100_000,
      gross: 100_000,
      minNetPayBp: 0,
      carryForward: [{ code: 'WELFARE', amount: 70_000, priority: 40 }],
      deductions: [{ code: 'LOAN', amount: 50_000, priority: 10 }],
    });
    expect(r.applied.map((a) => [a.code, a.amount, a.fromCarryForward])).toEqual([
      ['WELFARE', 70_000, true],
      ['LOAN', 30_000, false],
    ]);
    expect(r.applied[0]!.note).toMatch(/Carried forward from a previous period/);
    expect(r.carryForward).toEqual([{ code: 'LOAN', amount: 20_000 }]);
  });

  it('orders by priority, ties by code', () => {
    const r = applyDeductions({
      netBeforeDeductions: 1_000_000,
      gross: 1_000_000,
      minNetPayBp: 0,
      carryForward: [],
      deductions: [
        { code: 'WELFARE', amount: 1, priority: 40 },
        { code: 'SACCO', amount: 1, priority: 30 },
        { code: 'B', amount: 1, priority: 10 },
        { code: 'A', amount: 1, priority: 10 },
        { code: 'A', amount: 1, priority: 10 },
      ],
    });
    expect(r.applied.map((a) => a.code)).toEqual(['A', 'A', 'B', 'SACCO', 'WELFARE']);
  });

  it('minNetPayBp 0 allows the full net', () => {
    const r = applyDeductions({
      netBeforeDeductions: 500,
      gross: 1_000,
      minNetPayBp: 0,
      carryForward: [],
      deductions: [{ code: 'LOAN', amount: 500, priority: 10 }],
    });
    expect(r.total).toBe(500);
    expect(r.carryForward).toEqual([]);
    expect(r.applied[0]!.note).toBe('Current period');
  });

  it('zero allowance carries everything and merges by code', () => {
    const r = applyDeductions({
      netBeforeDeductions: 100,
      gross: 1_000,
      minNetPayBp: 5000,
      carryForward: [{ code: 'LOAN', amount: 30, priority: 10 }],
      deductions: [{ code: 'LOAN', amount: 50, priority: 10 }],
    });
    expect(r.allowed).toBe(0);
    expect(r.carryForward).toEqual([{ code: 'LOAN', amount: 80 }]);
  });

  it('validates amounts', () => {
    expect(() =>
      applyDeductions({
        netBeforeDeductions: -1,
        gross: 0,
        minNetPayBp: 0,
        carryForward: [],
        deductions: [],
      }),
    ).toThrow();
    expect(() =>
      applyDeductions({
        netBeforeDeductions: 0,
        gross: 1.5,
        minNetPayBp: 0,
        carryForward: [],
        deductions: [],
      }),
    ).toThrow();
    expect(() =>
      applyDeductions({
        netBeforeDeductions: 10,
        gross: 10,
        minNetPayBp: 0,
        carryForward: [],
        deductions: [{ code: 'X', amount: -5, priority: 1 }],
      }),
    ).toThrow();
  });
});
