import { withAudit } from '@/lib/audit';
import type { Tx } from '@/lib/db';
import { assertUgx, fromUgx, toUgx, type Ugx } from '@/lib/money';
import { applyRepayment, deductionAmount, LoanRuleError, type LoanCode } from './logic';

export * from './logic';

export interface LoanDeduction {
  loanId: string;
  code: LoanCode;
  amount: Ugx;
}

/**
 * This period's loan deductions for an employee: one per ACTIVE loan with a balance, each
 * min(instalment, balance). If `onDate` is given, loans whose start period begins after it are
 * skipped. Oldest loans first.
 */
export async function activeLoanDeductions(
  tx: Pick<Tx, 'loan'>,
  employeeId: string,
  onDate?: Date,
): Promise<LoanDeduction[]> {
  const loans = await tx.loan.findMany({
    where: { employeeId, status: 'ACTIVE', balance: { gt: 0n } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { startPeriod: { select: { startDate: true } } },
  });
  return loans
    .filter((l) => !onDate || !l.startPeriod || l.startPeriod.startDate.getTime() <= onDate.getTime())
    .map((l) => ({
      loanId: l.id,
      code: l.type,
      amount: deductionAmount(toUgx(l.installment), toUgx(l.balance)),
    }))
    .filter((d) => d.amount > 0);
}

/**
 * Reduce loan balances for repayments taken in an approved payroll run. Settles loans that reach
 * zero. Uses a conditional update so a concurrent change cannot drive a balance negative.
 */
export async function applyLoanRepayments(
  tx: Pick<Tx, 'loan' | 'auditLog'>,
  repayments: readonly { loanId: string; amount: Ugx }[],
  runId: string,
  actorId: string | null = null,
): Promise<void> {
  for (const r of repayments) {
    assertUgx(r.amount, 'repayment');
    if (r.amount === 0) continue;
    const loan = await tx.loan.findUnique({ where: { id: r.loanId } });
    if (!loan) throw new LoanRuleError(`Loan ${r.loanId} not found`);
    const before = toUgx(loan.balance);
    const { balance, settled } = applyRepayment(before, r.amount);
    const updated = await tx.loan.updateMany({
      where: { id: loan.id, balance: loan.balance },
      data: { balance: fromUgx(balance), ...(settled ? { status: 'SETTLED' as const } : {}) },
    });
    if (updated.count !== 1) {
      throw new LoanRuleError(`Loan ${loan.id} changed while applying the repayment; retry.`);
    }
    await withAudit(tx, {
      actorId,
      action: 'LOAN_REPAID_BY_PAYROLL',
      entity: 'Loan',
      entityId: loan.id,
      before: { balance: before, status: loan.status },
      after: { balance, status: settled ? 'SETTLED' : loan.status, amount: r.amount, runId },
    });
  }
}
