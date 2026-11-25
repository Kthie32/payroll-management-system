'use server';

import { LoanType } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { withAudit } from '@/lib/audit';
import { currentIp } from '@/lib/auth/request';
import { db } from '@/lib/db';
import {
  applyRepayment,
  installmentChangeProblem,
  LoanRuleError,
  newLoanProblem,
} from '@/lib/loans';
import { fromUgx, toUgx } from '@/lib/money';
import { assertPermission } from '@/lib/rbac';
import { parseUgxInput } from '@/lib/settings/input';

export interface LoanFormState {
  error?: string;
  message?: string;
}

const createSchema = z.object({
  employeeId: z.string().min(1, 'Choose an employee'),
  type: z.nativeEnum(LoanType),
  principal: z.string(),
  installment: z.string(),
  startPeriodId: z.string().optional(),
});

export async function createLoanAction(
  _prev: LoanFormState,
  formData: FormData,
): Promise<LoanFormState> {
  const actor = await assertPermission('loans.edit');
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { employeeId, type } = parsed.data;
  const principal = parseUgxInput(parsed.data.principal);
  const installment = parseUgxInput(parsed.data.installment);
  if (principal === null) return { error: 'Principal must be a whole UGX amount.' };
  if (installment === null) return { error: 'Instalment must be a whole UGX amount.' };
  const problem = newLoanProblem(principal, installment);
  if (problem) return { error: problem };

  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, payGroupId: true, status: true },
  });
  if (!employee) return { error: 'Employee not found.' };
  if (employee.status === 'EXITED') return { error: 'This employee has exited.' };

  const startPeriodId = parsed.data.startPeriodId || null;
  if (startPeriodId) {
    const period = await db.payPeriod.findUnique({ where: { id: startPeriodId } });
    if (!period || period.payGroupId !== employee.payGroupId) {
      return { error: "The start period must belong to the employee's pay group." };
    }
  }

  // One active loan per type per employee keeps payroll lines (coded by type) unambiguous.
  const existing = await db.loan.findFirst({
    where: { employeeId, type, status: 'ACTIVE' },
    select: { id: true },
  });
  if (existing) {
    return { error: 'This employee already has an active loan of this type. Settle or adjust it first.' };
  }

  const ip = await currentIp();
  const loan = await db.$transaction(async (tx) => {
    const l = await tx.loan.create({
      data: {
        employeeId,
        type,
        principal: fromUgx(principal),
        installment: fromUgx(installment),
        balance: fromUgx(principal),
        startPeriodId,
      },
    });
    await withAudit(tx, {
      actorId: actor.id,
      action: 'LOAN_CREATED',
      entity: 'Loan',
      entityId: l.id,
      after: { employeeId, type, principal, installment, balance: principal, startPeriodId },
      ip,
    });
    return l;
  });
  revalidatePath('/loans');
  redirect(`/loans/${loan.id}?created=1`);
}

const adjustSchema = z.discriminatedUnion('intent', [
  z.object({
    intent: z.literal('repay'),
    loanId: z.string().min(1),
    amount: z.string(),
    note: z.string().trim().min(3, 'Give a short reason').max(200),
  }),
  z.object({
    intent: z.literal('installment'),
    loanId: z.string().min(1),
    amount: z.string(),
    note: z.string().trim().max(200).optional(),
  }),
  z.object({
    intent: z.literal('writeOff'),
    loanId: z.string().min(1),
    note: z.string().trim().min(3, 'Give a reason for the write-off').max(200),
  }),
]);

export async function adjustLoanAction(
  _prev: LoanFormState,
  formData: FormData,
): Promise<LoanFormState> {
  const actor = await assertPermission('loans.edit');
  const parsed = adjustSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const input = parsed.data;
  const ip = await currentIp();

  try {
    const message = await db.$transaction(async (tx) => {
      const loan = await tx.loan.findUnique({ where: { id: input.loanId } });
      if (!loan) throw new LoanRuleError('Loan not found.');
      if (loan.status !== 'ACTIVE') throw new LoanRuleError('Only active loans can be adjusted.');
      const balance = toUgx(loan.balance);
      const principal = toUgx(loan.principal);
      const base = { actorId: actor.id, entity: 'Loan', entityId: loan.id, ip };

      if (input.intent === 'repay') {
        const amount = parseUgxInput(input.amount);
        if (amount === null) throw new LoanRuleError('Amount must be a whole UGX amount.');
        const next = applyRepayment(balance, amount);
        const status = next.settled ? 'SETTLED' : 'ACTIVE';
        await guardedUpdate(tx, loan.id, loan.balance, { balance: fromUgx(next.balance), status });
        await withAudit(tx, {
          ...base,
          action: 'LOAN_MANUAL_REPAYMENT',
          before: { balance, status: loan.status },
          after: { balance: next.balance, status, amount, note: input.note },
        });
        return next.settled ? 'Repayment recorded. The loan is now settled.' : 'Repayment recorded.';
      }

      if (input.intent === 'installment') {
        const amount = parseUgxInput(input.amount);
        if (amount === null) throw new LoanRuleError('Instalment must be a whole UGX amount.');
        const problem = installmentChangeProblem(amount, principal);
        if (problem) throw new LoanRuleError(problem);
        await guardedUpdate(tx, loan.id, loan.balance, { installment: fromUgx(amount) });
        await withAudit(tx, {
          ...base,
          action: 'LOAN_INSTALLMENT_CHANGED',
          before: { installment: toUgx(loan.installment) },
          after: { installment: amount, note: input.note ?? null },
        });
        return 'Instalment updated.';
      }

      await guardedUpdate(tx, loan.id, loan.balance, { status: 'WRITTEN_OFF' });
      await withAudit(tx, {
        ...base,
        action: 'LOAN_WRITTEN_OFF',
        before: { status: loan.status, balance },
        after: { status: 'WRITTEN_OFF', balanceWrittenOff: balance, note: input.note },
      });
      return 'Loan written off. It will no longer be deducted.';
    });
    revalidatePath('/loans');
    revalidatePath(`/loans/${input.loanId}`);
    return { message };
  } catch (e) {
    if (e instanceof LoanRuleError) return { error: e.message };
    throw e;
  }
}

/** Update only if the balance is unchanged since we read it (guards against a concurrent payroll). */
async function guardedUpdate(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  id: string,
  balance: bigint,
  data: { balance?: bigint; installment?: bigint; status?: 'ACTIVE' | 'SETTLED' | 'WRITTEN_OFF' },
) {
  const r = await tx.loan.updateMany({ where: { id, balance, status: 'ACTIVE' }, data });
  if (r.count !== 1) throw new LoanRuleError('The loan changed while you were editing. Reload and try again.');
}
