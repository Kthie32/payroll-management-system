import 'server-only';
import { Prisma } from '@prisma/client';
import { withAudit } from '@/lib/audit';
import { db } from '@/lib/db';
import { fromUgx, toUgx } from '@/lib/money';
import { applyLoanRepayments } from '@/lib/loans';
import { loanRepaymentsFromLines, parseLoanLineCode } from '../loan-codes';
import {
  approveBlockReason,
  isEditable,
  rejectBlockReason,
  submitBlockReason,
  type RunStatus,
} from '../status';
import { parseTotals } from '../totals';
import type { RunEmployeeSnapshot } from './compute';
import { RunActionError } from './errors';

/** Creates a DRAFT run for a period. One open (non-rejected) run per period, enforced by the DB. */
export async function createRun(periodId: string, actorId: string, ip: string | null) {
  const period = await db.payPeriod.findUnique({ where: { id: periodId } });
  if (!period) throw new RunActionError('Pay period not found.');
  try {
    return await db.$transaction(async (tx) => {
      const run = await tx.payrollRun.create({
        data: {
          periodId: period.id,
          payGroupId: period.payGroupId,
          status: 'DRAFT',
          createdById: actorId,
        },
      });
      await withAudit(tx, {
        actorId,
        action: 'PAYROLL_RUN_CREATED',
        entity: 'PayrollRun',
        entityId: run.id,
        after: { periodId: period.id, payGroupId: period.payGroupId, status: 'DRAFT' },
        ip,
      });
      return run;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new RunActionError('This period already has an open run.');
    }
    throw e;
  }
}

export async function submitRun(runId: string, actorId: string, ip: string | null) {
  await db.$transaction(async (tx) => {
    const run = await tx.payrollRun.findUnique({ where: { id: runId } });
    if (!run) throw new RunActionError('Run not found.');
    const totals = parseTotals(run.totals);
    const reason = submitBlockReason({
      status: run.status as RunStatus,
      headcount: totals.headcount,
      errorCount: totals.errors.length,
    });
    if (reason) throw new RunActionError(reason);
    await tx.payrollRun.update({
      where: { id: run.id },
      data: { status: 'SUBMITTED', submittedById: actorId, submittedAt: new Date() },
    });
    await withAudit(tx, {
      actorId,
      action: 'PAYROLL_RUN_SUBMITTED',
      entity: 'PayrollRun',
      entityId: run.id,
      before: { status: run.status },
      after: { status: 'SUBMITTED', submittedById: actorId },
      ip,
    });
  });
}

export async function rejectRun(
  runId: string,
  actorId: string,
  comment: string,
  ip: string | null,
) {
  await db.$transaction(async (tx) => {
    const run = await tx.payrollRun.findUnique({ where: { id: runId } });
    if (!run) throw new RunActionError('Run not found.');
    const reason = rejectBlockReason({
      status: run.status as RunStatus,
      createdById: run.createdById,
      computedById: run.computedById,
      submittedById: run.submittedById,
      actorId,
    });
    if (reason) throw new RunActionError(reason);
    await tx.payrollRun.update({
      where: { id: run.id },
      // Clear the submitter: after rejection the run is prepared again and resubmitted.
      data: {
        status: 'REJECTED',
        rejectionComment: comment,
        submittedById: null,
        submittedAt: null,
      },
    });
    await withAudit(tx, {
      actorId,
      action: 'PAYROLL_RUN_REJECTED',
      entity: 'PayrollRun',
      entityId: run.id,
      before: { status: run.status },
      after: { status: 'REJECTED', rejectionComment: comment },
      ip,
    });
  });
}

/**
 * Approves a submitted run. In one transaction: sets APPROVED, settles consumed carry-forwards,
 * creates new carry-forwards for unpaid deductions (loan remainders stay on the loan balance
 * instead), and reduces loan balances by the amounts actually deducted.
 */
export async function approveRun(runId: string, actorId: string, ip: string | null) {
  await db.$transaction(
    async (tx) => {
      const run = await tx.payrollRun.findUnique({
        where: { id: runId },
        include: { employees: { include: { lines: true } } },
      });
      if (!run) throw new RunActionError('Run not found.');
      const reason = approveBlockReason({
        status: run.status as RunStatus,
        createdById: run.createdById,
        computedById: run.computedById,
        submittedById: run.submittedById,
        actorId,
      });
      if (reason) throw new RunActionError(reason);

      const settleIds: string[] = [];
      const newCarryForwards: Prisma.CarryForwardCreateManyInput[] = [];
      const repaymentLines: Array<{ code: string; kind: string; amount: number }> = [];
      for (const re of run.employees) {
        const snap = re.snapshot as unknown as RunEmployeeSnapshot;
        settleIds.push(...(snap.carryForwardIds ?? []));
        for (const cf of snap.carryForwardOut ?? []) {
          if (cf.amount <= 0 || parseLoanLineCode(cf.code)) continue;
          newCarryForwards.push({
            employeeId: re.employeeId,
            componentCode: cf.code,
            amount: fromUgx(cf.amount),
            fromRunId: run.id,
          });
        }
        for (const l of re.lines) {
          repaymentLines.push({ code: l.code, kind: l.kind, amount: toUgx(l.amount) });
        }
      }

      await tx.payrollRun.update({
        where: { id: run.id },
        data: { status: 'APPROVED', approvedById: actorId, approvedAt: new Date() },
      });
      let settled = 0;
      if (settleIds.length) {
        const res = await tx.carryForward.updateMany({
          where: { id: { in: settleIds }, settledInRunId: null },
          data: { settledInRunId: run.id },
        });
        settled = res.count;
      }
      if (newCarryForwards.length) await tx.carryForward.createMany({ data: newCarryForwards });
      const repayments = loanRepaymentsFromLines(repaymentLines);
      await applyLoanRepayments(tx, repayments, run.id, actorId);

      const totals = parseTotals(run.totals);
      await withAudit(tx, {
        actorId,
        action: 'PAYROLL_RUN_APPROVED',
        entity: 'PayrollRun',
        entityId: run.id,
        before: { status: run.status },
        after: {
          status: 'APPROVED',
          headcount: totals.headcount,
          net: totals.net,
          carryForwardsSettled: settled,
          carryForwardsCreated: newCarryForwards.length,
          loanRepayments: repayments.length,
        },
        ip,
      });
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}

/** Deletes a run that has not been submitted or approved. */
export async function deleteRun(runId: string, actorId: string, ip: string | null) {
  await db.$transaction(async (tx) => {
    const run = await tx.payrollRun.findUnique({ where: { id: runId } });
    if (!run) throw new RunActionError('Run not found.');
    if (!isEditable(run.status as RunStatus)) {
      throw new RunActionError('Only draft, computed or rejected runs can be deleted.');
    }
    await tx.payrollLine.deleteMany({ where: { runEmployee: { runId: run.id } } });
    await tx.payrollRunEmployee.deleteMany({ where: { runId: run.id } });
    await tx.payrollRun.delete({ where: { id: run.id } });
    await withAudit(tx, {
      actorId,
      action: 'PAYROLL_RUN_DELETED',
      entity: 'PayrollRun',
      entityId: run.id,
      before: { status: run.status, periodId: run.periodId },
      ip,
    });
  });
}
