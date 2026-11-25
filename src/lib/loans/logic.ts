import type { LoanType } from '@prisma/client';
import { assertUgx, type Ugx } from '@/lib/money';

/** Loan types map 1:1 to the deduction component codes the payroll uses. */
export const LOAN_TYPES = ['LOAN', 'ADVANCE', 'SACCO'] as const satisfies readonly LoanType[];
export type LoanCode = (typeof LOAN_TYPES)[number];

export const LOAN_TYPE_LABELS: Record<LoanType, string> = {
  LOAN: 'Loan',
  ADVANCE: 'Salary advance',
  SACCO: 'SACCO',
};

/** This period's deduction: the instalment, but never more than the outstanding balance. */
export function deductionAmount(installment: Ugx, balance: Ugx): Ugx {
  assertUgx(installment, 'installment');
  assertUgx(balance, 'balance');
  return Math.min(installment, balance);
}

export class LoanRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoanRuleError';
  }
}

/** Apply a repayment to a balance. Throws if it would overpay. */
export function applyRepayment(balance: Ugx, amount: Ugx): { balance: Ugx; settled: boolean } {
  assertUgx(balance, 'balance');
  assertUgx(amount, 'repayment');
  if (amount === 0) throw new LoanRuleError('Repayment must be more than zero.');
  if (amount > balance) {
    throw new LoanRuleError('Repayment is more than the outstanding balance.');
  }
  const next = balance - amount;
  return { balance: next, settled: next === 0 };
}

/** Validate a new loan's numbers. Returns a user-facing message, or null if fine. */
export function newLoanProblem(principal: Ugx, installment: Ugx): string | null {
  if (principal <= 0) return 'Principal must be more than zero.';
  if (installment <= 0) return 'Instalment must be more than zero.';
  if (installment > principal) return 'Instalment cannot be more than the principal.';
  return null;
}

/** Validate an instalment change against the loan. */
export function installmentChangeProblem(installment: Ugx, principal: Ugx): string | null {
  if (installment <= 0) return 'Instalment must be more than zero.';
  if (installment > principal) return 'Instalment cannot be more than the principal.';
  return null;
}

/** Number of payroll periods left at the current instalment (last one may be smaller). */
export function periodsRemaining(balance: Ugx, installment: Ugx): number {
  if (balance <= 0) return 0;
  if (installment <= 0) return Infinity;
  return Math.ceil(balance / installment);
}
