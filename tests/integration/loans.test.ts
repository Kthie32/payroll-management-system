import { afterAll, describe, expect, it } from 'vitest';
import { activeLoanDeductions, applyLoanRepayments } from '@/lib/loans';
import { makeEmployee, testDb } from './helpers';

const db = testDb();
afterAll(() => db.$disconnect());

describe('loans through payroll', () => {
  it('lists deductions and applies repayments until settled', async () => {
    const { employee } = await makeEmployee(db);
    const loan = await db.loan.create({
      data: {
        employeeId: employee.id,
        type: 'LOAN',
        principal: 250_000n,
        installment: 100_000n,
        balance: 250_000n,
      },
    });

    expect(await activeLoanDeductions(db, employee.id)).toEqual([
      { loanId: loan.id, code: 'LOAN', amount: 100_000 },
    ]);

    await db.$transaction((tx) =>
      applyLoanRepayments(tx, [{ loanId: loan.id, amount: 100_000 }], 'run-1'),
    );
    await db.$transaction((tx) =>
      applyLoanRepayments(tx, [{ loanId: loan.id, amount: 100_000 }], 'run-2'),
    );
    expect(await activeLoanDeductions(db, employee.id)).toEqual([
      { loanId: loan.id, code: 'LOAN', amount: 50_000 },
    ]);

    await db.$transaction((tx) =>
      applyLoanRepayments(tx, [{ loanId: loan.id, amount: 50_000 }], 'run-3'),
    );
    const after = await db.loan.findUniqueOrThrow({ where: { id: loan.id } });
    expect(after.balance).toBe(0n);
    expect(after.status).toBe('SETTLED');
    expect(await activeLoanDeductions(db, employee.id)).toEqual([]);

    const audits = await db.auditLog.count({
      where: { entity: 'Loan', entityId: loan.id, action: 'LOAN_REPAID_BY_PAYROLL' },
    });
    expect(audits).toBe(3);
  });

  it('rolls back the whole transaction on an overpayment', async () => {
    const { employee } = await makeEmployee(db);
    const loan = await db.loan.create({
      data: { employeeId: employee.id, type: 'ADVANCE', principal: 10n, installment: 10n, balance: 10n },
    });
    await expect(
      db.$transaction((tx) => applyLoanRepayments(tx, [{ loanId: loan.id, amount: 11 }], 'run-x')),
    ).rejects.toThrow();
    expect((await db.loan.findUniqueOrThrow({ where: { id: loan.id } })).balance).toBe(10n);
  });
});
