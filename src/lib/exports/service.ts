import type { PrismaClient, RunStatus } from '@prisma/client';
import { withAudit } from '@/lib/audit';
import { decrypt } from '@/lib/crypto';
import { toUgx } from '@/lib/money';
import { batchRef, buildBankFile, periodLabel, type BankFile, type PaymentRow } from './build';
import { planPayments, readyToMarkExported, type PaymentPlan, type PayeeInput } from './group';
import { DEFAULT_TEMPLATE, parseTemplate, type ExportTemplateSpec } from './template';
import { CONTENT_TYPES, safeFileName } from './writers';

export class ExportError extends Error {
  constructor(
    public readonly code:
      | 'RUN_NOT_FOUND'
      | 'RUN_NOT_EXPORTABLE'
      | 'BANK_HAS_NO_PAYEES'
      | 'MISSING_ACCOUNTS'
      | 'EXPORT_NOT_FOUND'
      | 'CHECKSUM_MISMATCH'
      | 'INVALID_TRANSITION'
      | 'EXPORTS_INCOMPLETE',
    message: string,
  ) {
    super(message);
    this.name = 'ExportError';
  }
}

/** Run statuses from which bank files may be generated. */
export const EXPORTABLE_STATUSES: readonly RunStatus[] = ['APPROVED', 'EXPORTED'];

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function companyName(client: PrismaClient): Promise<string> {
  const row = await client.setting.findUnique({ where: { key: 'company.name' } });
  const v = row?.value as unknown;
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (v && typeof v === 'object' && 'value' in v && typeof v.value === 'string') return v.value;
  return 'Company';
}

export async function templateForBank(
  client: PrismaClient,
  bankId: string,
): Promise<{ spec: ExportTemplateSpec; isDefault: boolean }> {
  const row = await client.exportTemplate.findFirst({
    where: { bankId },
    orderBy: { updatedAt: 'desc' },
  });
  return row ? { spec: parseTemplate(row), isDefault: false } : { spec: DEFAULT_TEMPLATE, isDefault: true };
}

function displayName(e: { firstName: string; lastName: string; otherNames: string | null }) {
  return [e.firstName, e.otherNames, e.lastName].filter(Boolean).join(' ');
}

/** Load a run, its payees and their active bank accounts, grouped by bank. */
export async function loadPaymentPlan(client: PrismaClient, runId: string) {
  const run = await client.payrollRun.findUnique({
    where: { id: runId },
    include: {
      period: true,
      payGroup: true,
      employees: {
        select: {
          employeeId: true,
          net: true,
          employee: {
            select: {
              staffNo: true,
              firstName: true,
              lastName: true,
              otherNames: true,
              bankAccounts: {
                where: { isActive: true },
                take: 1,
                include: { bank: true },
              },
            },
          },
        },
      },
    },
  });
  if (!run) throw new ExportError('RUN_NOT_FOUND', 'Payroll run not found.');

  const payees: PayeeInput[] = run.employees.map((re) => {
    const acct = re.employee.bankAccounts[0];
    return {
      employeeId: re.employeeId,
      staffNo: re.employee.staffNo,
      employeeName: displayName(re.employee),
      net: toUgx(re.net),
      account: acct
        ? {
            bankId: acct.bankId,
            bankName: acct.bank.name,
            bankCode: acct.bank.code,
            branchCode: acct.branchCode,
            accountName: acct.accountName,
            accountNoEnc: acct.accountNoEnc,
            accountNoLast4: acct.accountNoLast4,
          }
        : null,
    };
  });
  return { run, plan: planPayments(payees) };
}

async function renderForBank(
  client: PrismaClient,
  plan: PaymentPlan,
  bankId: string,
  payDate: string,
  version: number,
): Promise<{ file: BankFile; bankName: string; bankCode: string }> {
  const group = plan.groups.find((g) => g.bankId === bankId);
  if (!group) throw new ExportError('BANK_HAS_NO_PAYEES', 'No employees in this run are paid through that bank.');
  const { spec } = await templateForBank(client, bankId);
  // Decrypt account numbers only here, only for the rows going into this file.
  const rows: PaymentRow[] = group.payees.map((p) => ({
    staffNo: p.staffNo,
    employeeName: p.employeeName,
    accountName: p.account!.accountName,
    accountNo: decrypt(p.account!.accountNoEnc),
    branchCode: p.account!.branchCode,
    amount: p.net,
  }));
  const file = await buildBankFile(
    spec,
    rows,
    {
      companyName: await companyName(client),
      bankName: group.bankName,
      bankCode: group.bankCode,
      batchRef: batchRef(payDate, group.bankCode, version),
      payDate,
      period: periodLabel(payDate),
    },
    group.total,
  );
  return { file, bankName: group.bankName, bankCode: group.bankCode };
}

export interface ActorContext {
  actorId: string;
  ip: string | null;
}

/**
 * Generate a new version of the bank file for one bank in a run and record it.
 * Earlier GENERATED versions for the same run and bank become SUPERSEDED.
 * Only metadata (never file content or account numbers) is stored and audited.
 */
export async function generateBankExport(
  client: PrismaClient,
  runId: string,
  bankId: string,
  actor: ActorContext,
) {
  const { run, plan } = await loadPaymentPlan(client, runId);
  if (!EXPORTABLE_STATUSES.includes(run.status)) {
    throw new ExportError('RUN_NOT_EXPORTABLE', 'Bank files can only be generated for approved runs.');
  }
  if (plan.missingAccounts.length > 0) {
    throw new ExportError(
      'MISSING_ACCOUNTS',
      `${plan.missingAccounts.length} employee(s) have no active bank account. Fix them first.`,
    );
  }
  const latest = await client.bankExport.findFirst({
    where: { runId, bankId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const version = (latest?.version ?? 0) + 1;
  const payDate = isoDate(run.period.payDate);
  const { file, bankName } = await renderForBank(client, plan, bankId, payDate, version);

  return client.$transaction(async (tx) => {
    const superseded = await tx.bankExport.updateMany({
      where: { runId, bankId, status: 'GENERATED' },
      data: { status: 'SUPERSEDED' },
    });
    const created = await tx.bankExport.create({
      data: {
        runId,
        bankId,
        version,
        fileSha256: file.sha256,
        rowCount: file.rowCount,
        totalAmount: BigInt(file.totalAmount),
        generatedById: actor.actorId,
      },
    });
    await withAudit(tx, {
      actorId: actor.actorId,
      action: 'BANK_EXPORT_GENERATED',
      entity: 'BankExport',
      entityId: created.id,
      after: {
        runId,
        bank: bankName,
        version,
        format: file.format,
        rowCount: file.rowCount,
        totalAmount: file.totalAmount,
        sha256: file.sha256,
        supersededCount: superseded.count,
      },
      ip: actor.ip,
    });
    return created;
  });
}

/**
 * Re-create the file for a recorded export and verify it matches the stored checksum.
 * If employee bank details changed since generation the checksum differs and the download is
 * refused — generate a new version instead.
 */
export async function renderRecordedExport(client: PrismaClient, exportId: string, actor: ActorContext) {
  const rec = await client.bankExport.findUnique({ where: { id: exportId }, include: { bank: true } });
  if (!rec) throw new ExportError('EXPORT_NOT_FOUND', 'Export not found.');
  const { run, plan } = await loadPaymentPlan(client, rec.runId);
  const payDate = isoDate(run.period.payDate);
  const { file, bankCode } = await renderForBank(client, plan, rec.bankId, payDate, rec.version);
  if (file.sha256 !== rec.fileSha256) {
    throw new ExportError(
      'CHECKSUM_MISMATCH',
      'Bank details or the template changed since this file was generated. Generate a new version.',
    );
  }
  await client.$transaction((tx) =>
    withAudit(tx, {
      actorId: actor.actorId,
      action: 'BANK_EXPORT_DOWNLOADED',
      entity: 'BankExport',
      entityId: rec.id,
      after: { runId: rec.runId, bank: rec.bank.name, version: rec.version, sha256: rec.fileSha256 },
      ip: actor.ip,
    }),
  );
  const ext = file.format === 'XLSX' ? 'xlsx' : 'csv';
  return {
    bytes: file.bytes,
    contentType: CONTENT_TYPES[file.format],
    fileName: safeFileName(`${batchRef(payDate, bankCode, rec.version)}.${ext}`),
    sha256: rec.fileSha256,
  };
}

/** Banks whose latest export for this run is not superseded. */
export async function currentExportBankIds(client: PrismaClient, runId: string): Promise<Set<string>> {
  const rows = await client.bankExport.findMany({
    where: { runId, status: { in: ['GENERATED', 'SENT'] } },
    select: { bankId: true },
  });
  return new Set(rows.map((r) => r.bankId));
}

export type RunTransition = 'EXPORTED' | 'PAID' | 'LOCKED';

const FROM: Record<RunTransition, RunStatus> = {
  EXPORTED: 'APPROVED',
  PAID: 'EXPORTED',
  LOCKED: 'PAID',
};

/**
 * Move a run forward after approval. Only status and its timestamp change (the DB trigger
 * rejects anything else on an approved run).
 */
export async function transitionRun(
  client: PrismaClient,
  runId: string,
  to: RunTransition,
  actor: ActorContext,
) {
  const run = await client.payrollRun.findUnique({ where: { id: runId }, select: { status: true } });
  if (!run) throw new ExportError('RUN_NOT_FOUND', 'Payroll run not found.');
  if (run.status !== FROM[to]) {
    throw new ExportError(
      'INVALID_TRANSITION',
      `A run can only be marked ${to.toLowerCase()} from ${FROM[to].toLowerCase()} (it is ${run.status.toLowerCase()}).`,
    );
  }
  if (to === 'EXPORTED') {
    const { plan } = await loadPaymentPlan(client, runId);
    const current = await currentExportBankIds(client, runId);
    if (!readyToMarkExported(plan, current)) {
      throw new ExportError(
        'EXPORTS_INCOMPLETE',
        'Generate a bank file for every bank (and fix missing accounts) before marking the run exported.',
      );
    }
  }
  const now = new Date();
  const stamp =
    to === 'EXPORTED' ? { exportedAt: now } : to === 'PAID' ? { paidAt: now } : { lockedAt: now };

  return client.$transaction(async (tx) => {
    const updated = await tx.payrollRun.update({
      where: { id: runId, status: FROM[to] },
      data: { status: to, ...stamp },
    });
    if (to === 'EXPORTED') {
      await tx.bankExport.updateMany({ where: { runId, status: 'GENERATED' }, data: { status: 'SENT' } });
    }
    await withAudit(tx, {
      actorId: actor.actorId,
      action: `RUN_MARKED_${to}`,
      entity: 'PayrollRun',
      entityId: runId,
      before: { status: FROM[to] },
      after: { status: to },
      ip: actor.ip,
    });
    return updated;
  });
}
