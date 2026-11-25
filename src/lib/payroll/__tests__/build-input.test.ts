import { describe, expect, it } from 'vitest';
import { calculateEmployee, MissingRuleError, type PayeParams } from '@/lib/payroll-engine';
import { buildEngineInput, type BuildInputArgs, type ComponentDef } from '../build-input';
import { loanLineCode } from '../loan-codes';

// Test fixtures (statutory figures belong in data, never in source).
const PAYE: PayeParams = {
  bands: [
    { from: 0, to: 335_000, rateBp: 0 },
    { from: 335_000, to: 410_000, rateBp: 2_000 },
    { from: 410_000, to: 485_000, rateBp: 2_500 },
    { from: 485_000, to: null, rateBp: 3_000 },
  ],
  surcharge: { threshold: 10_000_000, rateBp: 1_000 },
};
const NSSF = { employeeRateBp: 500, employerRateBp: 1_000, ceiling: null };

const comp = (
  c: Partial<ComponentDef> & Pick<ComponentDef, 'id' | 'code' | 'kind' | 'calcType'>,
): ComponentDef => ({
  name: c.code,
  taxable: true,
  nssfable: true,
  prorate: false,
  priority: 100,
  sortOrder: 100,
  isActive: true,
  ...c,
});

const COMPONENTS: ComponentDef[] = [
  comp({
    id: 'c-basic',
    code: 'BASIC',
    kind: 'EARNING',
    calcType: 'FIXED',
    prorate: true,
    sortOrder: 1,
  }),
  comp({
    id: 'c-house',
    code: 'HOUSING',
    kind: 'EARNING',
    calcType: 'PERCENT_OF_BASIC',
    sortOrder: 2,
  }),
  comp({ id: 'c-ot', code: 'OVERTIME', kind: 'EARNING', calcType: 'RATE_X_QTY', sortOrder: 3 }),
  comp({ id: 'c-bonus', code: 'BONUS', kind: 'EARNING', calcType: 'FIXED', sortOrder: 4 }),
  comp({
    id: 'c-lunch',
    code: 'LUNCH',
    kind: 'EARNING',
    calcType: 'FIXED',
    taxable: false,
    nssfable: false,
    sortOrder: 5,
  }),
  comp({ id: 'c-old', code: 'OLD', kind: 'EARNING', calcType: 'FIXED', isActive: false }),
  comp({
    id: 'c-loan',
    code: 'LOAN',
    kind: 'DEDUCTION',
    calcType: 'FIXED',
    taxable: false,
    nssfable: false,
    priority: 10,
  }),
  comp({
    id: 'c-adv',
    code: 'ADVANCE',
    kind: 'DEDUCTION',
    calcType: 'FIXED',
    taxable: false,
    nssfable: false,
    priority: 20,
  }),
  comp({
    id: 'c-sacco',
    code: 'SACCO',
    kind: 'DEDUCTION',
    calcType: 'FIXED',
    taxable: false,
    nssfable: false,
    priority: 30,
  }),
  comp({
    id: 'c-med',
    code: 'MEDICAL',
    kind: 'EMPLOYER',
    calcType: 'FIXED',
    taxable: false,
    nssfable: false,
  }),
];

function args(over: Partial<BuildInputArgs> = {}): BuildInputArgs {
  return {
    period: {
      start: '2026-11-01',
      end: '2026-11-30',
      payDate: '2026-11-30',
      frequency: 'MONTHLY',
      isLastCycleOfMonth: true,
    },
    employee: {
      id: 'e1',
      residency: 'RESIDENT',
      hireDate: '2020-01-01',
      exitDate: null,
      payeApplicable: true,
      nssfApplicable: true,
      lstApplicable: true,
    },
    components: COMPONENTS,
    assignments: [
      {
        componentId: 'c-basic',
        amount: 1_000_000,
        rateBp: null,
        ratePerUnit: null,
        effectiveFrom: '2025-01-01',
        effectiveTo: null,
      },
    ],
    inputs: [],
    loans: [],
    carryForwards: [],
    monthToDate: { taxable: 0, payeWithheld: 0, gross: 0 },
    rules: { payeRes: PAYE, payeNonRes: null, nssf: NSSF, lst: null, lstMonths: [7, 8, 9, 10] },
    settings: { minNetPayBp: 0 },
    ...over,
  };
}

describe('buildEngineInput', () => {
  it('produces input that reproduces the worked example', () => {
    const { input, notes } = buildEngineInput(args());
    expect(notes).toEqual([]);
    expect(input.components).toHaveLength(1);
    const r = calculateEmployee(input);
    expect(r.paye).toBe(188_250);
    expect(r.nssfEmployee).toBe(50_000);
    expect(r.net).toBe(761_750);
    expect(input.rules.lstMonths).toEqual([7, 8, 9, 10]);
  });

  it('passes hire/exit dates through so the engine prorates', () => {
    const { input } = buildEngineInput(
      args({
        employee: { ...args().employee, hireDate: '2026-11-16' },
        assignments: [
          {
            componentId: 'c-basic',
            amount: 3_000_000,
            rateBp: null,
            ratePerUnit: null,
            effectiveFrom: '2026-11-16',
            effectiveTo: null,
          },
        ],
      }),
    );
    expect(calculateEmployee(input).gross).toBe(1_500_000);
  });

  it('uses the newest overlapping assignment and ignores ones outside the period', () => {
    const { input } = buildEngineInput(
      args({
        assignments: [
          {
            componentId: 'c-basic',
            amount: 900_000,
            rateBp: null,
            ratePerUnit: null,
            effectiveFrom: '2025-01-01',
            effectiveTo: '2026-11-14',
          },
          {
            componentId: 'c-basic',
            amount: 1_100_000,
            rateBp: null,
            ratePerUnit: null,
            effectiveFrom: '2026-11-15',
            effectiveTo: null,
          },
          {
            componentId: 'c-bonus',
            amount: 50_000,
            rateBp: null,
            ratePerUnit: null,
            effectiveFrom: '2026-12-01',
            effectiveTo: null,
          },
          {
            componentId: 'c-lunch',
            amount: 70_000,
            rateBp: null,
            ratePerUnit: null,
            effectiveFrom: '2026-01-01',
            effectiveTo: '2026-10-31',
          },
        ],
      }),
    );
    expect(input.components.map((c) => [c.code, c.amount])).toEqual([['BASIC', 1_100_000]]);
  });

  it('maps PERCENT_OF_BASIC with its rate and keeps sort order', () => {
    const { input } = buildEngineInput(
      args({
        assignments: [
          ...args().assignments,
          {
            componentId: 'c-house',
            amount: null,
            rateBp: 2_000,
            ratePerUnit: null,
            effectiveFrom: '2025-01-01',
            effectiveTo: null,
          },
        ],
      }),
    );
    expect(input.components.map((c) => c.code)).toEqual(['BASIC', 'HOUSING']);
    expect(input.components[1]).toMatchObject({ calcType: 'PERCENT_OF_BASIC', rateBp: 2_000 });
    expect(calculateEmployee(input).gross).toBe(1_200_000);
  });

  it('FIXED inputs are summed and override the assigned amount', () => {
    const { input } = buildEngineInput(
      args({
        assignments: [
          ...args().assignments,
          {
            componentId: 'c-lunch',
            amount: 100_000,
            rateBp: null,
            ratePerUnit: null,
            effectiveFrom: '2025-01-01',
            effectiveTo: null,
          },
        ],
        inputs: [
          { componentId: 'c-lunch', quantity: null, amount: 30_000 },
          { componentId: 'c-lunch', quantity: null, amount: 20_000 },
          { componentId: 'c-bonus', quantity: null, amount: 250_000 },
          { componentId: 'c-bonus', quantity: 3, amount: null },
        ],
      }),
    );
    const byCode = Object.fromEntries(input.components.map((c) => [c.code, c]));
    expect(byCode.LUNCH!.amount).toBe(50_000);
    expect(byCode.BONUS!.amount).toBe(250_000);
  });

  it('RATE_X_QTY: quantities summed, input amount overrides the rate, no quantity → skipped', () => {
    const withRate = buildEngineInput(
      args({
        assignments: [
          ...args().assignments,
          {
            componentId: 'c-ot',
            amount: null,
            rateBp: null,
            ratePerUnit: 10_000,
            effectiveFrom: '2025-01-01',
            effectiveTo: null,
          },
        ],
        inputs: [
          { componentId: 'c-ot', quantity: 1.25, amount: null },
          { componentId: 'c-ot', quantity: 0.5, amount: null },
        ],
      }),
    ).input;
    const ot = withRate.components.find((c) => c.code === 'OVERTIME')!;
    expect(ot).toMatchObject({ quantity: 1.75, ratePerUnit: 10_000 });

    const overridden = buildEngineInput(
      args({
        assignments: [
          ...args().assignments,
          {
            componentId: 'c-ot',
            amount: null,
            rateBp: null,
            ratePerUnit: 10_000,
            effectiveFrom: '2025-01-01',
            effectiveTo: null,
          },
        ],
        inputs: [{ componentId: 'c-ot', quantity: 2, amount: 15_000 }],
      }),
    ).input;
    expect(overridden.components.find((c) => c.code === 'OVERTIME')).toMatchObject({
      quantity: 2,
      ratePerUnit: 15_000,
    });

    const noQty = buildEngineInput(
      args({
        assignments: [
          ...args().assignments,
          {
            componentId: 'c-ot',
            amount: null,
            rateBp: null,
            ratePerUnit: 10_000,
            effectiveFrom: '2025-01-01',
            effectiveTo: null,
          },
        ],
      }),
    ).input;
    expect(noQty.components.some((c) => c.code === 'OVERTIME')).toBe(false);

    const rateOnly = buildEngineInput(
      args({ inputs: [{ componentId: 'c-ot', quantity: null, amount: 9_000 }] }),
    ).input;
    const r = calculateEmployee(rateOnly);
    expect(r.warnings).toContain('COMPONENT_MISSING_VALUE:OVERTIME');
  });

  it('ignores inputs for inactive, unknown or percentage components with notes', () => {
    const { input, notes } = buildEngineInput(
      args({
        inputs: [
          { componentId: 'c-old', quantity: null, amount: 5 },
          { componentId: 'c-house', quantity: null, amount: 5 },
          { componentId: 'missing', quantity: null, amount: 5 },
        ],
      }),
    );
    expect(input.components.map((c) => c.code)).toEqual(['BASIC']);
    expect(notes).toEqual([
      'INPUT_IGNORED:OLD (component inactive)',
      'INPUT_IGNORED:HOUSING (percentage components cannot take period inputs)',
    ]);
  });

  it('adds loans as per-loan deductions with the component priority', () => {
    const { input } = buildEngineInput(
      args({
        loans: [
          { loanId: 'L1', code: 'LOAN', amount: 100_000 },
          { loanId: 'L2', code: 'ADVANCE', amount: 50_000 },
          { loanId: 'L3', code: 'LOAN', amount: 0 },
          { loanId: 'L4', code: 'UNKNOWN', amount: 1_000 },
        ],
      }),
    );
    const loans = input.components.filter((c) => c.kind === 'DEDUCTION');
    expect(loans.map((c) => [c.code, c.priority, c.amount])).toEqual([
      [loanLineCode('LOAN', 'L1'), 10, 100_000],
      [loanLineCode('ADVANCE', 'L2'), 20, 50_000],
      [loanLineCode('UNKNOWN', 'L4'), 0, 1_000],
    ]);
    expect(loans[0]!.name).toBe('LOAN repayment');
    const r = calculateEmployee(input);
    expect(r.otherDeductions).toBe(151_000);
    // Engine order: priority ascending (UNKNOWN has priority 0).
    expect(r.lines.filter((l) => l.kind === 'DEDUCTION').map((l) => l.code)).toEqual([
      'UNKNOWN#L4',
      'LOAN#L1',
      'ADVANCE#L2',
    ]);
  });

  it('passes carry-forwards with component priority and returns their ids', () => {
    const built = buildEngineInput(
      args({
        carryForwards: [
          { id: 'cf1', componentCode: 'SACCO', amount: 40_000 },
          { id: 'cf2', componentCode: 'NOPE', amount: 10_000 },
          { id: 'cf3', componentCode: 'SACCO', amount: 0 },
        ],
      }),
    );
    expect(built.input.carryForward).toEqual([
      { code: 'SACCO', amount: 40_000, priority: 30 },
      { code: 'NOPE', amount: 10_000, priority: 0 },
    ]);
    expect(built.carryForwardIds).toEqual(['cf1', 'cf2']);
  });

  it('uses month-to-date only for weekly/fortnightly pay', () => {
    const mtd = { taxable: 250_000, payeWithheld: 0, gross: 250_000 };
    const monthly = buildEngineInput(args({ monthToDate: mtd })).input;
    expect(monthly.monthToDate).toEqual({ taxable: 0, payeWithheld: 0, gross: 0 });
    const fortnight = buildEngineInput(
      args({
        period: {
          start: '2026-11-16',
          end: '2026-11-29',
          payDate: '2026-11-29',
          frequency: 'FORTNIGHTLY',
          isLastCycleOfMonth: true,
        },
        monthToDate: mtd,
        assignments: [
          {
            componentId: 'c-basic',
            amount: 250_000,
            rateBp: null,
            ratePerUnit: null,
            effectiveFrom: '2025-01-01',
            effectiveTo: null,
          },
        ],
      }),
    ).input;
    expect(fortnight.monthToDate).toEqual(mtd);
    expect(calculateEmployee(fortnight).paye).toBe(38_250);
  });

  it('selects PAYE by residency and throws when NSSF rule is missing', () => {
    const nonRes = buildEngineInput(
      args({ employee: { ...args().employee, residency: 'NON_RESIDENT' } }),
    ).input;
    expect(nonRes.rules.paye).toBeNull();
    expect(() => calculateEmployee(nonRes)).toThrow(MissingRuleError);
    expect(() => buildEngineInput(args({ rules: { ...args().rules, nssf: null } }))).toThrow(
      MissingRuleError,
    );
    const noMonths = buildEngineInput(args({ rules: { ...args().rules, lstMonths: null } })).input;
    expect('lstMonths' in noMonths.rules).toBe(false);
  });

  it('includes employer components', () => {
    const { input } = buildEngineInput(
      args({
        assignments: [
          ...args().assignments,
          {
            componentId: 'c-med',
            amount: 80_000,
            rateBp: null,
            ratePerUnit: null,
            effectiveFrom: '2025-01-01',
            effectiveTo: null,
          },
        ],
      }),
    );
    expect(calculateEmployee(input).employerCost).toBe(1_000_000 + 100_000 + 80_000);
  });
});
