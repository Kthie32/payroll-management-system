import { describe, expect, it, vi } from 'vitest';
import {
  activeLoanDeductions,
  applyLoanRepayments,
  applyRepayment,
  deductionAmount,
  installmentChangeProblem,
  LoanRuleError,
  newLoanProblem,
  periodsRemaining,
} from '..';

describe('loan logic', () => {
  it('deducts min(instalment, balance)', () => {
    expect(deductionAmount(100_000, 250_000)).toBe(100_000);
    expect(deductionAmount(100_000, 40_000)).toBe(40_000);
    expect(deductionAmount(100_000, 0)).toBe(0);
    expect(() => deductionAmount(-1, 10)).toThrow();
  });

  it('applies repayments and settles at zero', () => {
    expect(applyRepayment(250_000, 100_000)).toEqual({ balance: 150_000, settled: false });
    expect(applyRepayment(100_000, 100_000)).toEqual({ balance: 0, settled: true });
    expect(() => applyRepayment(100, 101)).toThrow(LoanRuleError);
    expect(() => applyRepayment(100, 0)).toThrow(LoanRuleError);
  });

  it('validates new loans and instalment changes', () => {
    expect(newLoanProblem(0, 1)).toMatch(/Principal/);
    expect(newLoanProblem(100, 0)).toMatch(/Instalment/);
    expect(newLoanProblem(100, 101)).toMatch(/more than the principal/);
    expect(newLoanProblem(100, 100)).toBeNull();
    expect(installmentChangeProblem(0, 100)).toMatch(/more than zero/);
    expect(installmentChangeProblem(200, 100)).toMatch(/principal/);
    expect(installmentChangeProblem(50, 100)).toBeNull();
  });

  it('counts periods remaining', () => {
    expect(periodsRemaining(250_000, 100_000)).toBe(3);
    expect(periodsRemaining(0, 100_000)).toBe(0);
    expect(periodsRemaining(10, 0)).toBe(Infinity);
  });
});

function loanRow(over: Record<string, unknown>) {
  return {
    id: 'l1',
    type: 'LOAN',
    installment: 100_000n,
    balance: 250_000n,
    status: 'ACTIVE',
    startPeriod: null,
    ...over,
  };
}

describe('activeLoanDeductions', () => {
  it('maps active loans to deductions, skipping future starts and zero amounts', async () => {
    const findMany = vi.fn().mockResolvedValue([
      loanRow({ id: 'a' }),
      loanRow({ id: 'b', type: 'SACCO', balance: 30_000n }),
      loanRow({ id: 'c', startPeriod: { startDate: new Date('2027-01-01') } }),
      loanRow({ id: 'd', installment: 0n }),
    ]);
    const tx = { loan: { findMany } } as never;
    const out = await activeLoanDeductions(tx, 'emp', new Date('2026-11-28'));
    expect(out).toEqual([
      { loanId: 'a', code: 'LOAN', amount: 100_000 },
      { loanId: 'b', code: 'SACCO', amount: 30_000 },
    ]);
    expect(findMany.mock.calls[0]![0].where).toMatchObject({ employeeId: 'emp', status: 'ACTIVE' });
    // Without a date, future-start loans are included.
    expect(await activeLoanDeductions(tx, 'emp')).toHaveLength(3);
  });
});

describe('applyLoanRepayments', () => {
  function fakeTx(loan: ReturnType<typeof loanRow> | null, count = 1) {
    return {
      loan: {
        findUnique: vi.fn().mockResolvedValue(loan),
        updateMany: vi.fn().mockResolvedValue({ count }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
  }

  it('reduces the balance, settles at zero and audits', async () => {
    const tx = fakeTx(loanRow({ balance: 100_000n }));
    await applyLoanRepayments(tx as never, [{ loanId: 'l1', amount: 100_000 }], 'run1', 'u1');
    expect(tx.loan.updateMany).toHaveBeenCalledWith({
      where: { id: 'l1', balance: 100_000n },
      data: { balance: 0n, status: 'SETTLED' },
    });
    const audit = tx.auditLog.create.mock.calls[0]![0].data;
    expect(audit).toMatchObject({ action: 'LOAN_REPAID_BY_PAYROLL', entityId: 'l1', actorId: 'u1' });
  });

  it('keeps the loan active on a partial repayment and skips zero amounts', async () => {
    const tx = fakeTx(loanRow({}));
    await applyLoanRepayments(
      tx as never,
      [
        { loanId: 'l1', amount: 0 },
        { loanId: 'l1', amount: 100_000 },
      ],
      'run1',
    );
    expect(tx.loan.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.loan.updateMany.mock.calls[0]![0].data).toEqual({ balance: 150_000n });
  });

  it('fails on a missing loan, an overpayment or a concurrent change', async () => {
    await expect(
      applyLoanRepayments(fakeTx(null) as never, [{ loanId: 'x', amount: 1 }], 'r'),
    ).rejects.toThrow(/not found/);
    await expect(
      applyLoanRepayments(fakeTx(loanRow({ balance: 10n })) as never, [{ loanId: 'l1', amount: 11 }], 'r'),
    ).rejects.toThrow(LoanRuleError);
    await expect(
      applyLoanRepayments(fakeTx(loanRow({}), 0) as never, [{ loanId: 'l1', amount: 1 }], 'r'),
    ).rejects.toThrow(/changed/);
  });
});
