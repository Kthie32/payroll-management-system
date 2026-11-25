import { afterAll, describe, expect, it } from 'vitest';
import { encrypt, last4 } from '@/lib/crypto';
import {
  ExportError,
  generateBankExport,
  loadPaymentPlan,
  renderRecordedExport,
  transitionRun,
} from '@/lib/exports/service';
import { buildReport } from '@/lib/reports/load';
import { parseSelection } from '@/lib/reports/range';
import { makeRunWithLine, testDb } from './helpers';

const db = testDb();
afterAll(() => db.$disconnect());

const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase();

async function actor() {
  const u = await db.user.create({
    data: { email: `exp-${uid()}@example.com`, name: 'Exporter', passwordHash: 'x', mustChangePassword: false },
  });
  return { actorId: u.id, ip: '127.0.0.1' };
}

/** An APPROVED run whose single employee (net 761,750) has an active account at a new bank. */
async function approvedRunWithAccount() {
  const { run, runEmployee } = await makeRunWithLine(db, 'APPROVED');
  const bank = await db.bank.create({ data: { name: `Bank ${uid()}`, code: `B${uid()}` } });
  const accountNo = '9030001234567';
  await db.employeeBankAccount.create({
    data: {
      employeeId: runEmployee.employeeId,
      bankId: bank.id,
      accountNoEnc: encrypt(accountNo),
      accountNoLast4: last4(accountNo),
      accountName: 'Test Employee',
      effectiveFrom: new Date('2026-01-01'),
    },
  });
  return { run, bank, runEmployee };
}

describe('bank exports', () => {
  it('generates versioned files, supersedes old ones, and re-downloads with a matching checksum', async () => {
    const who = await actor();
    const { run, bank } = await approvedRunWithAccount();

    const v1 = await generateBankExport(db, run.id, bank.id, who);
    expect(v1).toMatchObject({ version: 1, rowCount: 1, totalAmount: 761_750n, status: 'GENERATED' });
    const v2 = await generateBankExport(db, run.id, bank.id, who);
    expect(v2.version).toBe(2);
    const old = await db.bankExport.findUniqueOrThrow({ where: { id: v1.id } });
    expect(old.status).toBe('SUPERSEDED');

    const file = await renderRecordedExport(db, v2.id, who);
    expect(file.sha256).toBe(v2.fileSha256);
    expect(file.bytes.toString()).toContain('9030001234567');

    const audits = await db.auditLog.findMany({ where: { entity: 'BankExport', entityId: v2.id } });
    expect(audits.map((a) => a.action).sort()).toEqual(['BANK_EXPORT_DOWNLOADED', 'BANK_EXPORT_GENERATED']);
    expect(JSON.stringify(audits)).not.toContain('9030001234567');
  });

  it('refuses a re-download when bank details changed after generation', async () => {
    const who = await actor();
    const { run, bank, runEmployee } = await approvedRunWithAccount();
    const v1 = await generateBankExport(db, run.id, bank.id, who);
    await db.employeeBankAccount.updateMany({
      where: { employeeId: runEmployee.employeeId },
      data: { accountName: 'Changed Name' },
    });
    await expect(renderRecordedExport(db, v1.id, who)).rejects.toMatchObject({ code: 'CHECKSUM_MISMATCH' });
  });

  it('blocks generation when an employee has no active account', async () => {
    const who = await actor();
    const { run } = await makeRunWithLine(db, 'APPROVED');
    const bank = await db.bank.create({ data: { name: `Bank ${uid()}`, code: `B${uid()}` } });
    const { plan } = await loadPaymentPlan(db, run.id);
    expect(plan.missingAccounts).toHaveLength(1);
    await expect(generateBankExport(db, run.id, bank.id, who)).rejects.toBeInstanceOf(ExportError);
  });

  it('refuses to export a draft run', async () => {
    const who = await actor();
    const { run } = await makeRunWithLine(db, 'DRAFT');
    await expect(generateBankExport(db, run.id, 'x', who)).rejects.toMatchObject({
      code: 'RUN_NOT_EXPORTABLE',
    });
  });

  it('moves APPROVED → EXPORTED → PAID → LOCKED and rejects skipping steps', async () => {
    const who = await actor();
    const { run, bank } = await approvedRunWithAccount();
    await expect(transitionRun(db, run.id, 'EXPORTED', who)).rejects.toMatchObject({
      code: 'EXPORTS_INCOMPLETE',
    });
    await expect(transitionRun(db, run.id, 'PAID', who)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
    const v1 = await generateBankExport(db, run.id, bank.id, who);
    await transitionRun(db, run.id, 'EXPORTED', who);
    expect((await db.bankExport.findUniqueOrThrow({ where: { id: v1.id } })).status).toBe('SENT');
    await transitionRun(db, run.id, 'PAID', who);
    const locked = await transitionRun(db, run.id, 'LOCKED', who);
    expect(locked.status).toBe('LOCKED');
    expect(locked.exportedAt && locked.paidAt && locked.lockedAt).toBeTruthy();
  });
});

describe('reports', () => {
  it('includes approved runs and excludes drafts unless asked', async () => {
    const approved = await makeRunWithLine(db, 'APPROVED');
    const draft = await makeRunWithLine(db, 'DRAFT');
    const sel = parseSelection({ mode: 'runs', run: [approved.run.id, draft.run.id] });
    const final = await buildReport(db, 'register', sel, '2026-11-25');
    expect(final.runCount).toBe(1);
    expect(final.totals).toMatchObject({ net: 761_750 });

    const withDraft = await buildReport(
      db,
      'register',
      parseSelection({ mode: 'runs', run: [approved.run.id, draft.run.id], draft: '1' }),
      '2026-11-25',
    );
    expect(withDraft.runCount).toBe(2);
    expect(withDraft.draftRunCount).toBe(1);
  });
});
