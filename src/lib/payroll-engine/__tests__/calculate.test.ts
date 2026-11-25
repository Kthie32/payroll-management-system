import { describe, expect, it } from 'vitest';
import {
  calculateEmployee,
  InvalidInputError,
  MissingRuleError,
  type EngineInput,
} from '@/lib/payroll-engine';
import { basic, deduction, earning, makeInput, NSSF, PAYE_RES } from './fixtures/params.fixture';
import { LST_FIXTURE } from './fixtures/lst-bands.fixture';

const line = (r: ReturnType<typeof calculateEmployee>, code: string) =>
  r.lines.find((l) => l.code === code)!;

describe('calculateEmployee — required cases', () => {
  it('case 10: worked example, MONTHLY Nov 2026, basic 1,000,000, resident', () => {
    const r = calculateEmployee(makeInput());
    expect(r).toMatchObject({
      gross: 1_000_000,
      taxable: 1_000_000,
      nssfBase: 1_000_000,
      paye: 188_250,
      nssfEmployee: 50_000,
      nssfEmployer: 100_000,
      lst: 0,
      otherDeductions: 0,
      net: 761_750,
      employerCost: 1_100_000,
      carryForward: [],
    });
    expect(r.lines.map((l) => l.code)).toEqual(['BASIC', 'PAYE', 'NSSF_EE', 'LST', 'NSSF_ER']);
    expect(r.lines.every((l) => l.note.length > 0)).toBe(true);
    expect(line(r, 'NSSF_EE').rate).toBe(500);
  });

  it('cases 13–14: cumulative fortnightly PAYE', () => {
    const fortnight = {
      frequency: 'FORTNIGHTLY' as const,
      start: '2026-11-01',
      end: '2026-11-14',
      payDate: '2026-11-14',
      isLastCycleOfMonth: false,
    };
    const casual = { components: [basic(250_000, { prorate: false })] };
    const f1 = calculateEmployee(makeInput({ ...casual, period: fortnight }));
    expect(f1.paye).toBe(0);
    const f2 = calculateEmployee(
      makeInput({
        ...casual,
        period: {
          ...fortnight,
          start: '2026-11-15',
          end: '2026-11-28',
          payDate: '2026-11-28',
          isLastCycleOfMonth: true,
        },
        monthToDate: { taxable: 250_000, payeWithheld: 0, gross: 250_000 },
      }),
    );
    expect(f2.paye).toBe(38_250);
    expect(line(f2, 'PAYE').note).toMatch(/Cumulative PAYE/);
  });

  it('case 15: payeApplicable = false → PAYE 0 with an explanatory note', () => {
    const r = calculateEmployee(makeInput({ employee: { payeApplicable: false } }));
    expect(r.paye).toBe(0);
    expect(line(r, 'PAYE').note).toBe(
      'PAYE not applicable for this employee (payeApplicable = false)',
    );
    expect(r.net).toBe(950_000);
  });

  it('case 15b: payeApplicable = false does not need a PAYE rule', () => {
    const r = calculateEmployee(
      makeInput({ employee: { payeApplicable: false }, rules: { paye: null } }),
    );
    expect(r.paye).toBe(0);
  });

  it('case 16: nssfApplicable = false → NSSF ee and er 0', () => {
    const r = calculateEmployee(makeInput({ employee: { nssfApplicable: false } }));
    expect(r).toMatchObject({
      nssfEmployee: 0,
      nssfEmployer: 0,
      nssfBase: 0,
      employerCost: 1_000_000,
    });
    expect(line(r, 'NSSF_EE')).toMatchObject({
      rate: null,
      note: expect.stringMatching(/nssfApplicable = false/),
    });
  });

  it('case 17: non-taxable allowance 200,000 + basic 1,000,000', () => {
    const r = calculateEmployee(
      makeInput({
        components: [
          basic(1_000_000),
          earning('ALLOWANCE', 200_000, { taxable: false, nssfable: false }),
        ],
      }),
    );
    expect(r.gross).toBe(1_200_000);
    expect(r.taxable).toBe(1_000_000);
    expect(r.paye).toBe(188_250);
  });

  it('case 18: LST in a November run → 0', () => {
    const r = calculateEmployee(makeInput({ rules: { lst: LST_FIXTURE } }));
    expect(r.lst).toBe(0);
    expect(r.warnings).toEqual([]);
  });

  it('case 19: LST in an August run, last cycle, fixture bands → annual ÷ 4 half-up', () => {
    const r = calculateEmployee(
      makeInput({
        period: { start: '2026-08-01', end: '2026-08-31', payDate: '2026-08-28' },
        rules: { lst: LST_FIXTURE },
      }),
    );
    expect(r.lst).toBe(7_501);
    expect(r.net).toBe(1_000_000 - 188_250 - 50_000 - 7_501);
  });

  it('case 20: LST month with rules.lst = null → 0 + LST_RULE_MISSING', () => {
    const r = calculateEmployee(
      makeInput({
        period: { start: '2026-08-01', end: '2026-08-31', payDate: '2026-08-28' },
        rules: { lst: null, lstMonths: [7, 8, 9, 10] },
      }),
    );
    expect(r.lst).toBe(0);
    expect(r.warnings).toContain('LST_RULE_MISSING');
  });

  it('case 21: non-resident with rules.paye = null → MissingRuleError', () => {
    const run = () =>
      calculateEmployee(
        makeInput({ employee: { residency: 'NON_RESIDENT' }, rules: { paye: null } }),
      );
    expect(run).toThrow(MissingRuleError);
    expect(run).toThrow(/PAYE_NONRES/);
  });

  it('resident with rules.paye = null → MissingRuleError PAYE_RES', () => {
    expect(() => calculateEmployee(makeInput({ rules: { paye: null } }))).toThrow(/PAYE_RES/);
  });

  it('case 22: loan 900,000 with minNetPayBp 2000 → 561,750 deducted, 338,250 carried forward', () => {
    const r = calculateEmployee(
      makeInput({
        components: [basic(1_000_000), deduction('LOAN', 900_000, 10)],
        settings: { minNetPayBp: 2000 },
      }),
    );
    expect(r.otherDeductions).toBe(561_750);
    expect(r.net).toBe(200_000);
    expect(r.carryForward).toEqual([{ code: 'LOAN', amount: 338_250 }]);
    expect(r.warnings).toContain('DEDUCTIONS_CARRIED_FORWARD');
  });

  it('case 23: carried-forward amount is deducted before current-period deductions', () => {
    const r = calculateEmployee(
      makeInput({
        components: [
          basic(1_000_000),
          deduction('LOAN', 500_000, 10),
          deduction('WELFARE', 10_000, 40),
        ],
        carryForward: [{ code: 'WELFARE', amount: 400_000 }],
      }),
    );
    const deductions = r.lines.filter((l) => l.kind === 'DEDUCTION');
    expect(deductions.map((d) => [d.code, d.amount])).toEqual([
      ['WELFARE', 400_000],
      ['LOAN', 361_750],
      ['WELFARE', 0],
    ]);
    expect(r.carryForward).toEqual([
      { code: 'LOAN', amount: 138_250 },
      { code: 'WELFARE', amount: 10_000 },
    ]);
    expect(r.net).toBe(0);
  });
});

describe('calculateEmployee — other behaviour', () => {
  it('carry-forward priority falls back to the component priority, else 0', () => {
    const r = calculateEmployee(
      makeInput({
        components: [basic(1_000_000), deduction('SACCO', 1, 30)],
        carryForward: [
          { code: 'SACCO', amount: 5 },
          { code: 'ADVANCE', amount: 5 },
          { code: 'LOAN', amount: 5, priority: 50 },
        ],
      }),
    );
    expect(r.lines.filter((l) => l.kind === 'DEDUCTION').map((l) => l.code)).toEqual([
      'ADVANCE',
      'SACCO',
      'LOAN',
      'SACCO',
    ]);
  });

  it('PERCENT_OF_BASIC deductions and EMPLOYER components', () => {
    const pension = {
      ...deduction('PENSION', 0, 5),
      calcType: 'PERCENT_OF_BASIC' as const,
      amount: undefined,
      rateBp: 500,
    };
    const medical = { ...earning('MEDICAL', 30_000), kind: 'EMPLOYER' as const };
    const r = calculateEmployee(makeInput({ components: [basic(1_000_000), pension, medical] }));
    expect(line(r, 'PENSION').amount).toBe(50_000);
    expect(line(r, 'MEDICAL')).toMatchObject({ kind: 'EMPLOYER', amount: 30_000 });
    expect(r.employerCost).toBe(1_130_000);
    expect(r.net).toBe(711_750);
  });

  it('warns on components with missing values (deduction and employer)', () => {
    const r = calculateEmployee(
      makeInput({
        components: [
          basic(1_000_000),
          { ...deduction('SACCO', 0, 30), amount: undefined },
          { ...earning('MEDICAL', 0), kind: 'EMPLOYER', amount: undefined },
        ],
      }),
    );
    expect(r.warnings).toEqual([
      'COMPONENT_MISSING_VALUE:SACCO',
      'COMPONENT_MISSING_VALUE:MEDICAL',
    ]);
  });

  it('flags PAYE over-withholding on cumulative cycles', () => {
    const r = calculateEmployee(
      makeInput({
        period: {
          frequency: 'WEEKLY',
          start: '2026-11-23',
          end: '2026-11-29',
          payDate: '2026-11-29',
        },
        components: [basic(0, { prorate: false })],
        monthToDate: { taxable: 500_000, payeWithheld: 60_000, gross: 500_000 },
      }),
    );
    expect(r.paye).toBe(0);
    expect(r.warnings).toContain('PAYE_OVERWITHHELD');
  });

  it('limits PAYE to available pay with PAYE_SHORTFALL', () => {
    const harsh = { bands: [{ from: 0, to: null, rateBp: 10_000 }], surcharge: null };
    const r = calculateEmployee(makeInput({ rules: { paye: harsh } }));
    expect(r.paye).toBe(950_000);
    expect(r.net).toBe(0);
    expect(r.warnings).toContain('PAYE_SHORTFALL');
    expect(line(r, 'PAYE').note).toMatch(/limited to available pay/);
  });

  it('limits LST to available pay with LST_SHORTFALL', () => {
    const r = calculateEmployee(
      makeInput({
        period: { start: '2026-08-01', end: '2026-08-31', payDate: '2026-08-28' },
        components: [basic(200_000)],
        rules: { lst: { ...LST_FIXTURE, bands: [{ from: 0, to: null, annual: 1_000_000 }] } },
      }),
    );
    expect(r.lst).toBe(190_000);
    expect(r.net).toBe(0);
    expect(r.warnings).toContain('LST_SHORTFALL');
  });

  it('is deterministic and does not mutate its input', () => {
    const input = makeInput({ components: [basic(1_234_567), deduction('LOAN', 100_000, 10)] });
    const snapshot = structuredClone(input);
    expect(calculateEmployee(input)).toEqual(calculateEmployee(input));
    expect(input).toEqual(snapshot);
  });

  it.each<[string, (i: EngineInput) => void]>([
    ['bad date', (i) => (i.period.start = '2026-13-01')],
    ['fractional amount', (i) => (i.components[0]!.amount = 1.5)],
    ['negative MTD', (i) => (i.monthToDate.gross = -1)],
    ['three-decimal quantity', (i) => (i.components[0] = { ...i.components[0]!, quantity: 1.555 })],
    [
      'non-contiguous PAYE bands',
      (i) =>
        (i.rules.paye = {
          ...PAYE_RES,
          bands: [
            { from: 0, to: 10, rateBp: 0 },
            { from: 20, to: null, rateBp: 1 },
          ],
        }),
    ],
    [
      'PAYE bands not starting at 0',
      (i) => (i.rules.paye = { ...PAYE_RES, bands: [{ from: 5, to: null, rateBp: 0 }] }),
    ],
    [
      'PAYE last band closed',
      (i) => (i.rules.paye = { ...PAYE_RES, bands: [{ from: 0, to: 10, rateBp: 0 }] }),
    ],
    [
      'PAYE inner band open',
      (i) =>
        (i.rules.paye = {
          ...PAYE_RES,
          bands: [
            { from: 0, to: null, rateBp: 0 },
            { from: 10, to: null, rateBp: 0 },
          ],
        }),
    ],
    [
      'PAYE empty band',
      (i) =>
        (i.rules.paye = {
          ...PAYE_RES,
          bands: [
            { from: 0, to: 0, rateBp: 0 },
            { from: 0, to: null, rateBp: 0 },
          ],
        }),
    ],
    ['negative NSSF rate', (i) => (i.rules.nssf = { ...NSSF, employeeRateBp: -1 })],
    ['LST month 13', (i) => (i.rules.lst = { ...LST_FIXTURE, months: [13] })],
  ])('rejects invalid input: %s', (_name, mutate) => {
    const input = makeInput();
    mutate(input);
    expect(() => calculateEmployee(input)).toThrow(InvalidInputError);
  });

  it('accepts an empty LST band table and two-decimal quantities', () => {
    const ot = {
      ...earning('OT', 0),
      calcType: 'RATE_X_QTY' as const,
      amount: undefined,
      ratePerUnit: 1000,
      quantity: 2.25,
    };
    const r = calculateEmployee(
      makeInput({
        components: [basic(1_000_000), ot],
        rules: { lst: { ...LST_FIXTURE, bands: [] } },
      }),
    );
    expect(line(r, 'OT').amount).toBe(2_250);
  });

  it('InvalidInputError lists issues', () => {
    const input = makeInput();
    input.employee.id = '';
    try {
      calculateEmployee(input);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidInputError);
      expect((e as InvalidInputError).issues[0]).toMatch(/employee\.id/);
    }
  });
});

describe('errors', () => {
  it('MissingRuleError without detail', () => {
    expect(new MissingRuleError('NSSF').message).toBe('No active approved NSSF rule');
  });
  it('InvalidInputError without issues', () => {
    expect(new InvalidInputError('bad').message).toBe('bad');
  });
});
