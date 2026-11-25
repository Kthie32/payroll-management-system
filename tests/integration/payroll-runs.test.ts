import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', async () => {
  const { testDb } = await import('./helpers');
  return { db: testDb() };
});

const { db } = await import('@/lib/db');
const { computeRun } = await import('@/lib/payroll/server/compute');
const { approveRun, createRun, deleteRun, rejectRun, submitRun } = await import(
  '@/lib/payroll/server/workflow'
);
const { generatePeriodsForGroup, importInputsCsv, saveManualInputs } = await import(
  '@/lib/payroll/server/periods-inputs'
);
const { loadPayslips } = await import('@/lib/payroll/server/payslips');

afterAll(() => db.$disconnect());

// Rules dated far in the future so other suites' rule versions cannot interfere.
const EFFECTIVE = new Date('2099-01-01');
const uid = () => Math.random().toString(36).slice(2, 10);

let preparer: { id: string };
let approver: { id: string };
const comp: Record<string, { id: string }> = {};

async function upsertComponent(code: string, data: Record<string, unknown>) {
  comp[code] = await db.payComponent.upsert({
    where: { code },
    update: {},
    create: { code, name: code, ...data } as never,
  });
}

beforeAll(async () => {
  const mk = (name: string) =>
    db.user.create({
      data: { email: `${name}-${uid()}@test.local`, name, passwordHash: 'x', mustChangePassword: false },
    });
  preparer = await mk('preparer');
  approver = await mk('approver');

  await upsertComponent('BASIC', { kind: 'EARNING', calcType: 'FIXED', taxable: true, nssfable: true, prorate: true, sortOrder: 1 });
  await upsertComponent('OVERTIME', { kind: 'EARNING', calcType: 'RATE_X_QTY', taxable: true, nssfable: true, sortOrder: 5 });
  await upsertComponent('LOAN', { kind: 'DEDUCTION', calcType: 'FIXED', taxable: false, nssfable: false, priority: 10 });
  await upsertComponent('SACCO', { kind: 'DEDUCTION', calcType: 'FIXED', taxable: false, nssfable: false, priority: 30 });

  for (const [rule, params] of [
    [
      'PAYE_RES',
      {
        bands: [
          { from: 0, to: 335_000, rateBp: 0 },
          { from: 335_000, to: 410_000, rateBp: 2_000 },
          { from: 410_000, to: 485_000, rateBp: 2_500 },
          { from: 485_000, to: null, rateBp: 3_000 },
        ],
        surcharge: { threshold: 10_000_000, rateBp: 1_000 },
      },
    ],
    ['NSSF', { employeeRateBp: 500, employerRateBp: 1_000, ceiling: null }],
  ] as const) {
    await db.statutoryRuleVersion.upsert({
      where: { rule_effectiveFrom: { rule, effectiveFrom: EFFECTIVE } },
      update: {},
      create: { rule, params, effectiveFrom: EFFECTIVE, active: true, approvedById: preparer.id, approvedAt: new Date() },
    });
  }
});

async function setup(opts: { residency?: 'RESIDENT' | 'NON_RESIDENT' } = {}) {
  const payGroup = await db.payGroup.create({ data: { name: `Monthly ${uid()}`, frequency: 'MONTHLY' } });
  const employee = await db.employee.create({
    data: {
      staffNo: `P-${uid()}`,
      firstName: 'Pay',
      lastName: 'Roll',
      workerType: 'PERMANENT',
      payGroupId: payGroup.id,
      hireDate: new Date('2090-01-01'),
      residency: opts.residency ?? 'RESIDENT',
    },
  });
  await db.employeeComponent.create({
    data: { employeeId: employee.id, componentId: comp.BASIC!.id, amount: 1_000_000n, effectiveFrom: new Date('2090-01-01') },
  });
  const gen = await generatePeriodsForGroup(payGroup.id, { from: '2099-11', to: '2099-11' }, preparer.id, null);
  expect(gen.created).toBe(1);
  const period = await db.payPeriod.findFirstOrThrow({ where: { payGroupId: payGroup.id } });
  return { payGroup, employee, period };
}

describe('payroll run workflow', () => {
  it('computes, enforces separation of duties, approves and posts loans and carry-forwards', async () => {
    const { employee, period } = await setup();
    const loan = await db.loan.create({
      data: { employeeId: employee.id, type: 'LOAN', principal: 300_000n, installment: 100_000n, balance: 300_000n },
    });
    // An older run supplies the carry-forward row (CarryForward.fromRunId is required).
    const oldPeriod = await db.payPeriod.create({
      data: { payGroupId: period.payGroupId, startDate: new Date('2099-10-01'), endDate: new Date('2099-10-31'), payDate: new Date('2099-10-29') },
    });
    const oldRun = await db.payrollRun.create({ data: { periodId: oldPeriod.id, payGroupId: period.payGroupId, status: 'DRAFT' } });
    const cf = await db.carryForward.create({
      data: { employeeId: employee.id, componentCode: 'SACCO', amount: 40_000n, fromRunId: oldRun.id },
    });

    const run = await createRun(period.id, preparer.id, null);
    await expect(createRun(period.id, preparer.id, null)).rejects.toThrow(/already has an open run/);

    const totals = await computeRun(run.id, preparer.id, null);
    expect(totals).toMatchObject({ headcount: 1, gross: 1_000_000, paye: 188_250, nssfEmployee: 50_000, nssfEmployer: 100_000 });
    expect(totals.net).toBe(761_750 - 100_000 - 40_000);

    // Recompute replaces rows rather than duplicating them.
    await computeRun(run.id, preparer.id, null);
    expect(await db.payrollRunEmployee.count({ where: { runId: run.id } })).toBe(1);

    await submitRun(run.id, preparer.id, null);
    await expect(computeRun(run.id, preparer.id, null)).rejects.toThrow(/cannot be recomputed/);
    await expect(approveRun(run.id, preparer.id, null)).rejects.toThrow(/separation of duties/);
    await approveRun(run.id, approver.id, null);

    const after = await db.payrollRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(after).toMatchObject({ status: 'APPROVED', approvedById: approver.id });
    expect((await db.loan.findUniqueOrThrow({ where: { id: loan.id } })).balance).toBe(200_000n);
    expect((await db.carryForward.findUniqueOrThrow({ where: { id: cf.id } })).settledInRunId).toBe(run.id);

    const line = await db.payrollLine.findFirstOrThrow({ where: { runEmployee: { runId: run.id } } });
    await expect(db.payrollLine.update({ where: { id: line.id }, data: { amount: 1n } })).rejects.toThrow(/RUN_IMMUTABLE/);
    await expect(deleteRun(run.id, preparer.id, null)).rejects.toThrow(/Only draft/);
    await expect(saveManualInputs(period.id, [], preparer.id, null)).rejects.toThrow(/approved run/);

    const [slip] = await loadPayslips(run.id, employee.id);
    expect(slip).toMatchObject({ isDraft: false, gross: 1_000_000, net: 621_750 });
    // Carried-forward SACCO is deducted before the current loan instalment.
    expect(slip!.deductions.map((d) => d.code)).toEqual(['SACCO', `LOAN#${loan.id}`]);
    expect(slip!.deductions[1]!.label).toMatch(/\(loan repayment\)$/);
    expect(slip!.ytd.gross).toBe(1_000_000);

    const audit = await db.auditLog.findMany({ where: { entityId: run.id }, orderBy: { at: 'asc' } });
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['PAYROLL_RUN_CREATED', 'PAYROLL_RUN_COMPUTED', 'PAYROLL_RUN_SUBMITTED', 'PAYROLL_RUN_APPROVED']),
    );
  });

  it('creates a carry-forward on approval when deductions exceed net pay', async () => {
    const { employee, period } = await setup();
    await saveManualInputs(
      period.id,
      [{ employeeId: employee.id, componentId: comp.SACCO!.id, value: '900,000' }],
      preparer.id,
      null,
    );
    const run = await createRun(period.id, preparer.id, null);
    await computeRun(run.id, preparer.id, null);
    const re = await db.payrollRunEmployee.findFirstOrThrow({ where: { runId: run.id }, include: { lines: true } });
    const sacco = re.lines.filter((l) => l.code === 'SACCO').reduce((s, l) => s + l.amount, 0n);
    await submitRun(run.id, preparer.id, null);
    await approveRun(run.id, approver.id, null);
    const created = await db.carryForward.findFirstOrThrow({ where: { fromRunId: run.id } });
    expect(created).toMatchObject({ employeeId: employee.id, componentCode: 'SACCO', settledInRunId: null });
    expect(created.amount + sacco).toBe(900_000n);
  });

  it('records employees that cannot be calculated and blocks submission; reject returns a run', async () => {
    const { period } = await setup({ residency: 'NON_RESIDENT' });
    const run = await createRun(period.id, preparer.id, null);
    const totals = await computeRun(run.id, preparer.id, null);
    expect(totals.headcount).toBe(0);
    expect(totals.errors[0]!.message).toMatch(/PAYE_NONRES/);
    await expect(submitRun(run.id, preparer.id, null)).rejects.toThrow(/no employees|could not be calculated/);
  });

  it('rejects with a comment and allows recompute; imports CSV inputs', async () => {
    const { employee, period } = await setup();
    await db.employeeComponent.create({
      data: { employeeId: employee.id, componentId: comp.OVERTIME!.id, ratePerUnit: 10_000n, effectiveFrom: new Date('2090-01-01') },
    });
    const n = await importInputsCsv(
      period.id,
      `staffNo,componentCode,quantity,amount\n${employee.staffNo},OVERTIME,2.5,\n`,
      preparer.id,
      null,
    );
    expect(n).toBe(1);
    await expect(
      importInputsCsv(period.id, `staffNo,componentCode,quantity,amount\nNOPE,OVERTIME,1,\n`, preparer.id, null),
    ).rejects.toThrow(/row\(s\) have errors/);

    const run = await createRun(period.id, preparer.id, null);
    const t = await computeRun(run.id, preparer.id, null);
    expect(t.gross).toBe(1_025_000);
    await submitRun(run.id, preparer.id, null);
    await rejectRun(run.id, approver.id, 'Overtime looks wrong', null);
    expect((await db.payrollRun.findUniqueOrThrow({ where: { id: run.id } })).rejectionComment).toBe('Overtime looks wrong');
    await computeRun(run.id, preparer.id, null);
    expect((await db.payrollRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe('COMPUTED');
    await deleteRun(run.id, preparer.id, null);
    expect(await db.payrollRun.count({ where: { id: run.id } })).toBe(0);
  });
});
