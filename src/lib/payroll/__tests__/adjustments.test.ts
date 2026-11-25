import { describe, expect, it } from 'vitest';
import { calculateEmployee, type PayeParams } from '@/lib/payroll-engine';
import {
  adjustmentNote,
  buildEngineInput,
  type BuildInputArgs,
  type ComponentDef,
} from '../build-input';
import { isAdjustmentCode, validateAdjustment } from '../adjustments';
import { parseInputsCsv, type CsvComponent } from '../csv-inputs';

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
  c: Partial<ComponentDef> & Pick<ComponentDef, 'id' | 'code' | 'kind'>,
): ComponentDef => ({
  name: c.code,
  calcType: 'FIXED',
  taxable: true,
  nssfable: true,
  prorate: false,
  priority: 100,
  sortOrder: 100,
  isActive: true,
  ...c,
});

const COMPONENTS: ComponentDef[] = [
  comp({ id: 'c-basic', code: 'BASIC', kind: 'EARNING', sortOrder: 1 }),
  comp({ id: 'c-arr', code: 'ARREARS', name: 'Arrears', kind: 'EARNING', sortOrder: 50 }),
  comp({
    id: 'c-rec',
    code: 'OVERPAYMENT_RECOVERY',
    name: 'Overpayment recovery',
    kind: 'DEDUCTION',
    taxable: false,
    nssfable: false,
    priority: 5,
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

describe('validateAdjustment', () => {
  const ok = {
    componentCode: 'arrears',
    amountText: '150,000',
    note: 'Missed overtime',
    adjustsRunId: 'r1',
  };
  it('accepts a complete adjustment and normalises it', () => {
    const v = validateAdjustment(ok);
    expect(v).toEqual({
      ok: true,
      value: {
        componentCode: 'ARREARS',
        amount: 150_000,
        note: 'Missed overtime',
        adjustsRunId: 'r1',
      },
    });
  });
  it('rejects bad type, zero or fractional amount, short note and missing run', () => {
    const v = validateAdjustment({
      componentCode: 'BONUS',
      amountText: '0',
      note: 'x',
      adjustsRunId: ' ',
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors).toHaveLength(4);
    expect(validateAdjustment({ ...ok, amountText: '10.5' }).ok).toBe(false);
    expect(validateAdjustment({ ...ok, note: 'y'.repeat(301) }).ok).toBe(false);
  });
  it('knows the adjustment codes', () => {
    expect(isAdjustmentCode('ARREARS')).toBe(true);
    expect(isAdjustmentCode('OVERPAYMENT_RECOVERY')).toBe(true);
    expect(isAdjustmentCode('BONUS')).toBe(false);
  });
});

describe('adjustments in the engine input', () => {
  it('adds arrears as a taxable earning with the explanation as a line note', () => {
    const built = buildEngineInput(
      args({
        inputs: [
          {
            componentId: 'c-arr',
            quantity: null,
            amount: 100_000,
            note: 'Missed overtime',
            adjustsLabel: 'Oct run',
          },
        ],
      }),
    );
    expect(built.lineNotes).toEqual({ ARREARS: 'Correction to Oct run: Missed overtime' });
    const result = calculateEmployee(built.input);
    expect(result.gross).toBe(1_100_000);
    expect(result.lines.find((l) => l.code === 'ARREARS')?.amount).toBe(100_000);
  });
  it('joins several adjustments for the same code and deducts a recovery', () => {
    const built = buildEngineInput(
      args({
        inputs: [
          {
            componentId: 'c-rec',
            quantity: null,
            amount: 30_000,
            note: 'Paid twice',
            adjustsLabel: 'Sep run',
          },
          {
            componentId: 'c-rec',
            quantity: null,
            amount: 20_000,
            note: 'Wrong allowance',
            adjustsLabel: null,
          },
        ],
      }),
    );
    expect(built.lineNotes.OVERPAYMENT_RECOVERY).toBe(
      'Correction to Sep run: Paid twice; Adjustment: Wrong allowance',
    );
    const result = calculateEmployee(built.input);
    expect(result.otherDeductions).toBe(50_000);
  });
  it('has no line notes for ordinary inputs', () => {
    expect(buildEngineInput(args()).lineNotes).toEqual({});
    expect(adjustmentNote('  why  ', undefined)).toBe('Adjustment: why');
  });
});

describe('inputs CSV with adjustments', () => {
  const components = new Map<string, CsvComponent>([
    ['ARREARS', { id: 'c-arr', code: 'ARREARS', calcType: 'FIXED', isActive: true }],
    ['BONUS', { id: 'c-bonus', code: 'BONUS', calcType: 'FIXED', isActive: true }],
  ]);
  const lookups = {
    employeesByStaffNo: new Map([['S1', { id: 'e1', name: 'A B' }]]),
    componentsByCode: components,
    adjustedRuns: new Map([
      ['e1|2026-10-01', [{ runId: 'r-oct' }]],
      ['e1|2026-09-01', [{ runId: 'r-a' }, { runId: 'r-b' }]],
    ]),
  };
  const header = 'staffNo,componentCode,quantity,amount,note,adjustsPeriodStart\n';

  it('resolves the corrected run and keeps the note', () => {
    const r = parseInputsCsv(`${header}S1,ARREARS,,50000,Missed overtime,2026-10-01\n`, lookups);
    expect(r.errorCount).toBe(0);
    expect(r.rows[0]).toMatchObject({
      adjustsRunId: 'r-oct',
      note: 'Missed overtime',
      amount: 50_000,
    });
  });
  it('requires a note and a known, unambiguous run for adjustment rows', () => {
    const r = parseInputsCsv(
      `${header}S1,ARREARS,,50000,,2026-10-01\nS1,ARREARS,,50000,Some reason,2026-08-01\nS1,ARREARS,,50000,Some reason,2026-09-01\nS1,ARREARS,,50000,Some reason,\nS1,ARREARS,,50000,Some reason,01/10/2026\n`,
      lookups,
    );
    expect(r.rows.map((x) => x.errors.length > 0)).toEqual([true, true, true, true, true]);
    expect(r.rows[1]!.errors.join()).toMatch(/No earlier approved run/);
    expect(r.rows[2]!.errors.join()).toMatch(/More than one/);
  });
  it('rejects adjustsPeriodStart on ordinary rows and still works without the optional columns', () => {
    const r = parseInputsCsv(`${header}S1,BONUS,,1000,,2026-10-01\n`, lookups);
    expect(r.rows[0]!.errors.join()).toMatch(/only used with/);
    const plain = parseInputsCsv(
      'staffNo,componentCode,quantity,amount\nS1,BONUS,,1000\n',
      lookups,
    );
    expect(plain.errorCount).toBe(0);
    expect(plain.rows[0]).toMatchObject({ note: null, adjustsRunId: null });
  });
});
