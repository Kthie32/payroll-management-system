import type { PrismaClient } from '@prisma/client';
import { withAudit } from '@/lib/audit';
import { decrypt } from '@/lib/crypto';
import { fromUgx, toUgx } from '@/lib/money';
import {
  latestResults,
  parseResultsFile,
  summariseResults,
  type ResultPayee,
  type ResultsParse,
} from './results';
import {
  ExportError,
  generateBankExport,
  loadPaymentPlan,
  reissueSubset,
  type ActorContext,
} from './service';

/** The payees contained in a recorded export, with decrypted account numbers for matching. */
async function exportPayees(client: PrismaClient, exportId: string) {
  const rec = await client.bankExport.findUnique({
    where: { id: exportId },
    include: { bank: true },
  });
  if (!rec) throw new ExportError('EXPORT_NOT_FOUND', 'Export not found.');
  const [{ plan }, subset, runEmployees] = await Promise.all([
    loadPaymentPlan(client, rec.runId),
    Promise.resolve(reissueSubset(rec)),
    client.payrollRunEmployee.findMany({
      where: { runId: rec.runId },
      select: { id: true, employeeId: true },
    }),
  ]);
  const reBy = new Map(runEmployees.map((r) => [r.employeeId, r.id]));
  const group = plan.groups.find((g) => g.bankId === rec.bankId);
  const payees: ResultPayee[] = (group?.payees ?? [])
    .filter((p) => !subset || subset.has(p.employeeId))
    .map((p) => ({
      runEmployeeId: reBy.get(p.employeeId)!,
      staffNo: p.staffNo,
      name: p.employeeName,
      accountNo: p.account ? decrypt(p.account.accountNoEnc) : '',
      net: p.net,
    }));
  return { rec, payees };
}

/**
 * Results can be recorded once a file has gone to the bank or provider:
 * - a normal file once the run is marked exported (file status SENT);
 * - a re-issue file as soon as it is generated, because re-issues are made after the run is
 *   already exported and are uploaded to the bank straight away. Recording results for a
 *   re-issue marks it SENT.
 */
function assertSent(rec: { status: string; isReissue: boolean }) {
  const ok = rec.isReissue
    ? rec.status === 'GENERATED' || rec.status === 'SENT'
    : rec.status === 'SENT';
  if (!ok) {
    throw new ExportError(
      'INVALID_TRANSITION',
      'Upload results for a file that has been sent to the bank (mark the run exported first).',
    );
  }
}

export async function previewPaymentResults(
  client: PrismaClient,
  exportId: string,
  text: string,
): Promise<ResultsParse> {
  const { rec, payees } = await exportPayees(client, exportId);
  assertSent(rec);
  return parseResultsFile(text, payees);
}

/**
 * Records the bank's results for one export. All rows must be valid; otherwise nothing is saved.
 * Uploading again replaces earlier results for the same payees in this export.
 */
export async function importPaymentResults(
  client: PrismaClient,
  exportId: string,
  text: string,
  actor: ActorContext,
) {
  const { rec, payees } = await exportPayees(client, exportId);
  assertSent(rec);
  const parsed = parseResultsFile(text, payees);
  if (parsed.fileErrors.length)
    throw new ExportError('EXPORT_NOT_FOUND', parsed.fileErrors.join(' '));
  if (parsed.errorCount) {
    throw new ExportError(
      'EXPORT_NOT_FOUND',
      `${parsed.errorCount} row(s) have errors. Fix the file and preview again.`,
    );
  }
  const counts = { PAID: 0, FAILED: 0, PENDING: 0 };
  await client.$transaction(async (tx) => {
    if (rec.isReissue && rec.status === 'GENERATED') {
      // Results prove the re-issue reached the bank.
      await tx.bankExport.update({ where: { id: rec.id }, data: { status: 'SENT' } });
    }
    for (const r of parsed.rows) {
      counts[r.status!]++;
      const data = {
        status: r.status!,
        amount: fromUgx(r.amount!),
        reference: r.reference,
        reason: r.reason,
        uploadedById: actor.actorId,
        uploadedAt: new Date(),
      };
      await tx.paymentResult.upsert({
        where: {
          bankExportId_runEmployeeId: { bankExportId: rec.id, runEmployeeId: r.runEmployeeId! },
        },
        update: data,
        create: { bankExportId: rec.id, runEmployeeId: r.runEmployeeId!, ...data },
      });
    }
    await withAudit(tx, {
      actorId: actor.actorId,
      action: 'PAYMENT_RESULTS_UPLOADED',
      entity: 'BankExport',
      entityId: rec.id,
      after: {
        runId: rec.runId,
        bank: rec.bank.name,
        version: rec.version,
        rows: parsed.rows.length,
        paid: counts.PAID,
        failed: counts.FAILED,
        pending: counts.PENDING,
        notInFile: parsed.unmatchedPayees.length,
      },
      ip: actor.ip,
    });
  });
  return { ...counts, notInFile: parsed.unmatchedPayees.length };
}

/** Payment outcome for every payee of a run (latest result across all of its exports). */
export async function runPaymentSummary(client: PrismaClient, runId: string) {
  const [{ plan }, runEmployees, results] = await Promise.all([
    loadPaymentPlan(client, runId),
    client.payrollRunEmployee.findMany({
      where: { runId },
      select: { id: true, employeeId: true, net: true },
    }),
    client.paymentResult.findMany({
      where: { bankExport: { runId } },
      select: {
        runEmployeeId: true,
        status: true,
        uploadedAt: true,
        reason: true,
        reference: true,
        bankExport: { select: { bank: { select: { name: true } }, version: true } },
      },
    }),
  ]);
  const toPay = runEmployees.filter((r) => toUgx(r.net) > 0);
  const latest = latestResults(results);
  const summary = summariseResults(
    toPay.map((r) => r.id),
    latest,
  );
  const reByEmp = new Map(runEmployees.map((r) => [r.employeeId, r.id]));
  const empByRe = new Map(runEmployees.map((r) => [r.id, r.employeeId]));
  const payeeByEmp = new Map(
    plan.groups.flatMap((g) =>
      g.payees.map((p) => [p.employeeId, { payee: p, group: g }] as const),
    ),
  );
  const failed = summary.failedIds.map((reId) => {
    const employeeId = empByRe.get(reId)!;
    const where = payeeByEmp.get(employeeId);
    const result = results
      .filter((r) => r.runEmployeeId === reId)
      .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())[0];
    return {
      runEmployeeId: reId,
      employeeId,
      staffNo: where?.payee.staffNo ?? '',
      name: where?.payee.employeeName ?? '',
      net: where?.payee.net ?? 0,
      reason: result?.reason ?? null,
      failedIn: result ? `${result.bankExport.bank.name} v${result.bankExport.version}` : '',
      /** Where the employee would be paid now (their current active account). */
      currentBankId: where?.group.bankId ?? null,
      currentBankName: where?.group.bankName ?? 'No active account',
    };
  });
  return { ...summary, payees: toPay.length, failed, reByEmp };
}

/** New export for one bank holding only the payees whose latest result is FAILED. */
export async function reissueFailedPayments(
  client: PrismaClient,
  runId: string,
  bankId: string,
  actor: ActorContext,
) {
  const summary = await runPaymentSummary(client, runId);
  const ids = summary.failed.filter((f) => f.currentBankId === bankId).map((f) => f.employeeId);
  if (ids.length === 0) {
    throw new ExportError('NOTHING_TO_REISSUE', 'No failed payments are due through this bank.');
  }
  return generateBankExport(client, runId, bankId, actor, { reissueEmployeeIds: ids });
}
