import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', async () => {
  const { testDb } = await import('./helpers');
  return { db: testDb() };
});

const { db } = await import('@/lib/db');
const { encrypt, last4 } = await import('@/lib/crypto');
const { computeRun } = await import('@/lib/payroll/server/compute');
const { approveRun, createRun, rejectRun, submitRun } =
  await import('@/lib/payroll/server/workflow');
const {
  addAdjustment,
  generatePeriodsForGroup,
  listAdjustments,
  nextOpenPeriodFor,
  saveManualInputs,
} = await import('@/lib/payroll/server/periods-inputs');
const { findDeliveryByToken, sendPayslips } = await import('@/lib/payroll/server/delivery');
const { generateBankExport, renderRecordedExport, transitionRun } =
  await import('@/lib/exports/service');
const { importPaymentResults, previewPaymentResults, reissueFailedPayments, runPaymentSummary } =
  await import('@/lib/exports/payments');

afterAll(() => db.$disconnect());

// Rules dated far in the future so other suites' rule versions cannot interfere.
const EFFECTIVE = new Date('2099-01-01');
const uid = () => Math.random().toString(36).slice(2, 10);

let creator: { id: string };
let preparer: { id: string };
let submitter: { id: string };
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
      data: {
        email: `${name}-${uid()}@test.local`,
        name,
        passwordHash: 'x',
        mustChangePassword: false,
      },
    });
  [creator, preparer, submitter, approver] = await Promise.all([
    mk('creator'),
    mk('preparer'),
    mk('submitter'),
    mk('approver'),
  ]);
  await upsertComponent('BASIC', {
    kind: 'EARNING',
    calcType: 'FIXED',
    taxable: true,
    nssfable: true,
    prorate: true,
    sortOrder: 1,
  });
  await upsertComponent('ARREARS', {
    kind: 'EARNING',
    calcType: 'FIXED',
    taxable: true,
    nssfable: true,
    recurring: false,
    sortOrder: 60,
  });
  await upsertComponent('OVERPAYMENT_RECOVERY', {
    kind: 'DEDUCTION',
    calcType: 'FIXED',
    taxable: false,
    nssfable: false,
    recurring: false,
    priority: 5,
  });
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
      create: {
        rule,
        params,
        effectiveFrom: EFFECTIVE,
        active: true,
        approvedById: creator.id,
        approvedAt: new Date(),
      },
    });
  }
});

/** A pay group with two employees (bank + mobile money), periods Mar–May 2099. */
async function setup() {
  const payGroup = await db.payGroup.create({
    data: { name: `Magezi ${uid()}`, frequency: 'MONTHLY' },
  });
  const bank = await db.bank.create({
    data: { name: `Bank ${uid()}`, code: `B${uid()}`, kind: 'BANK' },
  });
  const momo = await db.bank.create({
    data: { name: `MTN ${uid()}`, code: `MTN${uid()}`, kind: 'MOBILE_MONEY' },
  });
  const mkEmp = async (
    first: string,
    extra: Record<string, unknown>,
    bankId: string,
    acct: string,
  ) => {
    const e = await db.employee.create({
      data: {
        staffNo: `M-${uid()}`,
        firstName: first,
        lastName: 'Test',
        workerType: 'PERMANENT',
        payGroupId: payGroup.id,
        hireDate: new Date('2090-01-01'),
        ...extra,
      },
    });
    await db.employeeComponent.create({
      data: {
        employeeId: e.id,
        componentId: comp.BASIC!.id,
        amount: 1_000_000n,
        effectiveFrom: new Date('2090-01-01'),
      },
    });
    await db.employeeBankAccount.create({
      data: {
        employeeId: e.id,
        bankId,
        accountNoEnc: encrypt(acct),
        accountNoLast4: last4(acct),
        accountName: `${first} Test`,
        effectiveFrom: new Date('2090-01-01'),
      },
    });
    return e;
  };
  const withEmail = await mkEmp(
    'Ann',
    { email: 'ann@test.local', phone: '256772000111' },
    bank.id,
    '1234567890',
  );
  const noContact = await mkEmp('Ben', {}, momo.id, '256772445566');
  await generatePeriodsForGroup(payGroup.id, { from: '2099-03', to: '2099-05' }, preparer.id, null);
  const periods = await db.payPeriod.findMany({
    where: { payGroupId: payGroup.id },
    orderBy: { startDate: 'asc' },
  });
  return { payGroup, bank, momo, withEmail, noContact, periods };
}

/** Create (creator) → compute (preparer) → submit (submitter) → approve (approver). */
async function approvedRun(periodId: string) {
  const run = await createRun(periodId, creator.id, null);
  await computeRun(run.id, preparer.id, null);
  await submitRun(run.id, submitter.id, null);
  await approveRun(run.id, approver.id, null);
  return run;
}

describe('separation of duties covers creator, computer and submitter', () => {
  it('records each preparer and refuses approval or rejection by any of them', async () => {
    const { periods } = await setup();
    const run = await createRun(periods[0]!.id, creator.id, null);
    await computeRun(run.id, preparer.id, null);
    await submitRun(run.id, submitter.id, null);
    const r = await db.payrollRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(r).toMatchObject({
      createdById: creator.id,
      computedById: preparer.id,
      submittedById: submitter.id,
    });
    expect(r.submittedAt).not.toBeNull();

    await expect(approveRun(run.id, creator.id, null)).rejects.toThrow(/created this run/);
    await expect(approveRun(run.id, preparer.id, null)).rejects.toThrow(/computed this run/);
    await expect(approveRun(run.id, submitter.id, null)).rejects.toThrow(/submitted this run/);
    await expect(rejectRun(run.id, submitter.id, 'no', null)).rejects.toThrow(/cannot reject/);

    // Rejection by an independent approver clears the submitter; a new submitter can resubmit.
    await rejectRun(run.id, approver.id, 'Check overtime', null);
    expect(
      (await db.payrollRun.findUniqueOrThrow({ where: { id: run.id } })).submittedById,
    ).toBeNull();
    await computeRun(run.id, preparer.id, null);
    await submitRun(run.id, approver.id, null);
    await expect(approveRun(run.id, approver.id, null)).rejects.toThrow(/submitted this run/);
    await approveRun(run.id, submitter.id, null);
    expect((await db.payrollRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe(
      'APPROVED',
    );
  });
});

describe('adjustments in the next run', () => {
  it('adds arrears and a recovery linked to an approved run, keeps them through grid saves, and notes them on lines', async () => {
    const { periods, withEmail } = await setup();
    const march = await approvedRun(periods[0]!.id);
    const next = await nextOpenPeriodFor(march.id, withEmail.id);
    expect(next?.id).toBe(periods[1]!.id);

    await expect(
      addAdjustment(
        next!.id,
        withEmail.id,
        { componentCode: 'ARREARS', amountText: '50000', note: 'short', adjustsRunId: 'nope' },
        preparer.id,
        null,
      ),
    ).rejects.toThrow(/earlier approved run/);
    await addAdjustment(
      next!.id,
      withEmail.id,
      {
        componentCode: 'ARREARS',
        amountText: '50,000',
        note: 'Overtime on 14 March left out',
        adjustsRunId: march.id,
      },
      preparer.id,
      null,
    );
    await addAdjustment(
      next!.id,
      withEmail.id,
      {
        componentCode: 'OVERPAYMENT_RECOVERY',
        amountText: '20000',
        note: 'Transport paid twice',
        adjustsRunId: march.id,
      },
      preparer.id,
      null,
    );
    // Saving the variable-pay grid must not wipe adjustments.
    await saveManualInputs(next!.id, [], preparer.id, null);
    expect(await listAdjustments(next!.id)).toHaveLength(2);

    const april = await createRun(next!.id, creator.id, null);
    await computeRun(april.id, preparer.id, null);
    const re = await db.payrollRunEmployee.findFirstOrThrow({
      where: { runId: april.id, employeeId: withEmail.id },
      include: { lines: true },
    });
    expect(re.gross).toBe(1_050_000n);
    const arrears = re.lines.find((l) => l.code === 'ARREARS')!;
    expect(arrears.note).toMatch(/^Correction to .*: Overtime on 14 March left out/);
    const recovery = re.lines.find((l) => l.code === 'OVERPAYMENT_RECOVERY')!;
    expect(recovery.amount).toBe(20_000n);
    expect(recovery.note).toMatch(/Transport paid twice/);
    // The corrected run itself is untouched.
    expect(
      (
        await db.payrollRunEmployee.findFirstOrThrow({
          where: { runId: march.id, employeeId: withEmail.id },
        })
      ).gross,
    ).toBe(1_000_000n);
  });
});

describe('payslip delivery (outbox mode)', () => {
  it('stores messages, hashes link tokens, skips missing contacts and resolves the link', async () => {
    const { periods, withEmail } = await setup();
    const run = await approvedRun(periods[0]!.id);
    const summary = await sendPayslips(
      run.id,
      { employeeIds: null, channels: ['EMAIL', 'SMS'] },
      preparer.id,
      null,
    );
    expect(summary).toMatchObject({ sent: 2, failed: 0 });
    expect(summary.skipped).toHaveLength(2); // Ben has neither email nor phone

    const deliveries = await db.payslipDelivery.findMany({
      where: { runEmployee: { runId: run.id } },
      include: { message: true },
    });
    expect(deliveries).toHaveLength(2);
    const sms = deliveries.find((d) => d.channel === 'SMS')!;
    expect(sms.recipient).toBe('256772000111');
    expect(sms.message?.provider).toBe('outbox');
    const token = /\/p\/([A-Za-z0-9_-]{43})/.exec(sms.message!.body)![1]!;
    expect(sms.tokenHash).not.toContain(token);
    const found = await findDeliveryByToken(token);
    expect(found?.runEmployee.employeeId).toBe(withEmail.id);
    expect(await findDeliveryByToken('x'.repeat(43))).toBeNull();
    const email = deliveries.find((d) => d.channel === 'EMAIL')!;
    expect(email.message?.body).toMatch(/\[Attachments: payslip-/);

    // Not before approval.
    const draft = await createRun(periods[1]!.id, creator.id, null);
    await expect(
      sendPayslips(draft.id, { employeeIds: null, channels: ['EMAIL'] }, preparer.id, null),
    ).rejects.toThrow(/approved/);
  });
});

describe('payment results and re-issue', () => {
  it('records bank results, lists failures and re-issues only the failed payee', async () => {
    const { periods, bank, momo, withEmail, noContact } = await setup();
    const run = await approvedRun(periods[0]!.id);
    const actor = { actorId: approver.id, ip: null };
    const bankFile = await generateBankExport(db, run.id, bank.id, actor);
    const momoFile = await generateBankExport(db, run.id, momo.id, actor);
    await transitionRun(db, run.id, 'EXPORTED', actor);

    const net = (
      await db.payrollRunEmployee.findFirstOrThrow({
        where: { runId: run.id, employeeId: withEmail.id },
      })
    ).net;
    const ann = await db.employee.findUniqueOrThrow({ where: { id: withEmail.id } });
    const ben = await db.employee.findUniqueOrThrow({ where: { id: noContact.id } });

    const bad = await previewPaymentResults(
      db,
      bankFile.id,
      `Staff No,Amount,Status\n${ann.staffNo},1,SUCCESS\n`,
    );
    expect(bad.errorCount).toBe(1);
    await importPaymentResults(
      db,
      bankFile.id,
      `Staff No,Amount,Status,Reference\n${ann.staffNo},${net},SUCCESS,TX1\n`,
      actor,
    );
    await importPaymentResults(
      db,
      momoFile.id,
      `MSISDN,Amount,Status,Reason\n0772445566,${net},FAILED,Wallet not registered\n`,
      actor,
    );

    let summary = await runPaymentSummary(db, run.id);
    expect(summary).toMatchObject({ paid: 1, pending: 0, noResult: 0 });
    expect(summary.failed.map((f) => f.staffNo)).toEqual([ben.staffNo]);

    const reissue = await reissueFailedPayments(db, run.id, momo.id, actor);
    expect(reissue).toMatchObject({ rowCount: 1, version: 2 });
    await expect(reissueFailedPayments(db, run.id, bank.id, actor)).rejects.toThrow(
      /No failed payments/,
    );
    const file = await renderRecordedExport(db, reissue.id, actor);
    expect(new TextDecoder().decode(file.bytes)).toMatch(/REISSUE/);
    // The re-issue is recorded on the export itself, linked to the file whose payment failed.
    const reRec = await db.bankExport.findUniqueOrThrow({ where: { id: reissue.id } });
    expect(reRec).toMatchObject({ isReissue: true, reissueOfId: momoFile.id, status: 'GENERATED' });
    expect(reRec.payeeEmployeeIds).toEqual([ben.id]);

    // Results can be uploaded for a re-issue straight away; doing so marks it SENT.
    await importPaymentResults(
      db,
      reissue.id,
      `MSISDN,Amount,Status\n256772445566,${net},PAID\n`,
      actor,
    );
    summary = await runPaymentSummary(db, run.id);
    expect(summary).toMatchObject({ paid: 2, failed: [] });
    expect((await db.bankExport.findUniqueOrThrow({ where: { id: reissue.id } })).status).toBe(
      'SENT',
    );
  });
});

describe('payslip link lockout', () => {
  it('counts wrong answers on the delivery and locks at the limit', async () => {
    const { recordVerifyFailure, isLinkLocked, failedAttempts } =
      await import('@/lib/payroll/server/delivery');
    const { MAX_VERIFY_ATTEMPTS } = await import('@/lib/payroll/payslip-links');
    const delivery = await db.payslipDelivery.findFirstOrThrow({ where: { failedAttempts: 0 } });
    for (let i = 1; i < MAX_VERIFY_ATTEMPTS; i++) await recordVerifyFailure(delivery.id, null);
    expect(await failedAttempts(delivery.id)).toBe(MAX_VERIFY_ATTEMPTS - 1);
    expect(await isLinkLocked(delivery.id)).toBe(false);
    await recordVerifyFailure(delivery.id, null);
    expect(await isLinkLocked(delivery.id)).toBe(true);
    const row = await db.payslipDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(row.lockedAt).not.toBeNull();
    const locked = await db.auditLog.count({
      where: { entityId: delivery.id, action: 'PAYSLIP_LINK_LOCKED' },
    });
    expect(locked).toBe(1);
  });
});
