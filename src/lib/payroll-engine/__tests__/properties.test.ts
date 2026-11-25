import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { calculateEmployee, type EngineComponent, type EngineInput } from '@/lib/payroll-engine';
import { NSSF, PAYE_RES } from './fixtures/params.fixture';
import { LST_FIXTURE } from './fixtures/lst-bands.fixture';

const money = fc.integer({ min: 0, max: 50_000_000 });

const earningArb: fc.Arbitrary<EngineComponent> = fc
  .record({
    code: fc.constantFrom(
      'HOUSING',
      'TRANSPORT',
      'LUNCH',
      'AIRTIME',
      'BONUS',
      'OVERTIME',
      'ACTING',
    ),
    calcType: fc.constantFrom('FIXED' as const, 'PERCENT_OF_BASIC' as const, 'RATE_X_QTY' as const),
    amount: money,
    rateBp: fc.integer({ min: 0, max: 5000 }),
    ratePerUnit: fc.integer({ min: 0, max: 200_000 }),
    quantity: fc.integer({ min: 0, max: 30_000 }).map((h) => h / 100),
    taxable: fc.boolean(),
    nssfable: fc.boolean(),
    prorate: fc.boolean(),
  })
  .map((r) => ({ ...r, kind: 'EARNING' as const, priority: 0 }));

const deductionArb: fc.Arbitrary<EngineComponent> = fc
  .record({
    code: fc.constantFrom('LOAN', 'ADVANCE', 'SACCO', 'WELFARE'),
    amount: money,
    priority: fc.integer({ min: 0, max: 50 }),
  })
  .map((r) => ({
    ...r,
    kind: 'DEDUCTION' as const,
    calcType: 'FIXED' as const,
    taxable: false,
    nssfable: false,
    prorate: false,
  }));

const employerArb: fc.Arbitrary<EngineComponent> = money.map((amount) => ({
  code: 'MEDICAL',
  kind: 'EMPLOYER' as const,
  calcType: 'FIXED' as const,
  amount,
  taxable: false,
  nssfable: false,
  prorate: false,
  priority: 0,
}));

const dayArb = fc.integer({ min: 1, max: 28 }).map((d) => `2026-08-${String(d).padStart(2, '0')}`);

const inputArb: fc.Arbitrary<EngineInput> = fc
  .record({
    frequency: fc.constantFrom('WEEKLY' as const, 'FORTNIGHTLY' as const, 'MONTHLY' as const),
    isLastCycleOfMonth: fc.boolean(),
    hireDate: fc.oneof(fc.constant('2020-01-01'), dayArb),
    exitDate: fc.oneof(fc.constant(null), dayArb),
    residency: fc.constantFrom('RESIDENT' as const, 'NON_RESIDENT' as const),
    payeApplicable: fc.boolean(),
    nssfApplicable: fc.boolean(),
    lstApplicable: fc.boolean(),
    basicAmount: money,
    earnings: fc.array(earningArb, { maxLength: 5 }),
    deductions: fc.array(deductionArb, { maxLength: 4 }),
    employer: fc.array(employerArb, { maxLength: 1 }),
    mtdTaxable: money,
    mtdGross: money,
    mtdPayeWithheld: fc.integer({ min: 0, max: 5_000_000 }),
    carryForward: fc.array(fc.record({ code: fc.constantFrom('LOAN', 'SACCO'), amount: money }), {
      maxLength: 2,
    }),
    withLst: fc.boolean(),
    minNetPayBp: fc.integer({ min: 0, max: 10_000 }),
  })
  .map((r) => ({
    period: {
      start: '2026-08-01',
      end: '2026-08-31',
      payDate: '2026-08-28',
      frequency: r.frequency,
      isLastCycleOfMonth: r.frequency === 'MONTHLY' ? true : r.isLastCycleOfMonth,
    },
    employee: {
      id: 'e',
      residency: r.residency,
      hireDate: r.hireDate,
      exitDate: r.exitDate !== null && r.exitDate < r.hireDate ? null : r.exitDate,
      payeApplicable: r.payeApplicable,
      nssfApplicable: r.nssfApplicable,
      lstApplicable: r.lstApplicable,
    },
    components: [
      {
        code: 'BASIC',
        kind: 'EARNING',
        calcType: 'FIXED',
        amount: r.basicAmount,
        taxable: true,
        nssfable: true,
        prorate: true,
        priority: 0,
      },
      ...r.earnings,
      ...r.deductions,
      ...r.employer,
    ],
    monthToDate:
      r.frequency === 'MONTHLY'
        ? { taxable: 0, payeWithheld: 0, gross: 0 }
        : { taxable: r.mtdTaxable, payeWithheld: r.mtdPayeWithheld, gross: r.mtdGross },
    carryForward: r.carryForward,
    rules: {
      paye: PAYE_RES,
      nssf: NSSF,
      lst: r.withLst ? LST_FIXTURE : null,
      lstMonths: [7, 8, 9, 10],
    },
    settings: { minNetPayBp: r.minNetPayBp },
  }));

describe('calculateEmployee — properties (case 24)', () => {
  it('amounts are integers ≥ 0, net ≤ gross, totals reconcile', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const r = calculateEmployee(input);
        const amounts = [
          r.gross,
          r.taxable,
          r.nssfBase,
          r.paye,
          r.nssfEmployee,
          r.nssfEmployer,
          r.lst,
          r.otherDeductions,
          r.net,
          r.employerCost,
          ...r.lines.map((l) => l.amount),
          ...r.carryForward.map((c) => c.amount),
        ];
        for (const a of amounts) {
          expect(Number.isSafeInteger(a)).toBe(true);
          expect(a).toBeGreaterThanOrEqual(0);
        }
        expect(r.net).toBeLessThanOrEqual(r.gross);
        expect(r.net).toBe(r.gross - r.paye - r.nssfEmployee - r.lst - r.otherDeductions);

        const employerExtras = r.lines
          .filter((l) => l.kind === 'EMPLOYER' && l.code !== 'NSSF_ER')
          .reduce((s, l) => s + l.amount, 0);
        expect(r.employerCost).toBe(r.gross + r.nssfEmployer + employerExtras);

        const earningsSum = r.lines
          .filter((l) => l.kind === 'EARNING')
          .reduce((s, l) => s + l.amount, 0);
        expect(earningsSum).toBe(r.gross);
        const deductionSum = r.lines
          .filter((l) => l.kind === 'DEDUCTION')
          .reduce((s, l) => s + l.amount, 0);
        expect(deductionSum).toBe(r.otherDeductions);

        // Net never drops below the floor because of non-statutory deductions.
        const floor = Math.floor((r.gross * input.settings.minNetPayBp) / 10_000);
        const netBefore = r.gross - r.paye - r.nssfEmployee - r.lst;
        if (r.otherDeductions > 0) expect(r.net).toBeGreaterThanOrEqual(Math.min(netBefore, floor));

        // Deterministic.
        expect(calculateEmployee(input)).toEqual(r);
      }),
      { numRuns: 1000 },
    );
  }, 60_000);

  it('when employerCost has no extras it equals gross + NSSF employer', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        input.components = input.components.filter((c) => c.kind !== 'EMPLOYER');
        const r = calculateEmployee(input);
        expect(r.employerCost).toBe(r.gross + r.nssfEmployer);
      }),
      { numRuns: 300 },
    );
  }, 60_000);
});
