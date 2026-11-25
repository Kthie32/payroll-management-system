import { afterAll, describe, expect, it } from 'vitest';
import { makeEmployee, testDb } from './helpers';

const db = testDb();
afterAll(() => db.$disconnect());

async function makeBank() {
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  return db.bank.create({ data: { name: `Bank ${code}`, code } });
}

function account(employeeId: string, bankId: string, isActive: boolean) {
  return {
    employeeId,
    bankId,
    accountNoEnc: 'v1:test',
    accountNoLast4: '1234',
    accountName: 'Test Employee',
    effectiveFrom: new Date('2026-01-01'),
    isActive,
  };
}

describe('one active bank account per employee', () => {
  it('rejects a second active account', async () => {
    const { employee } = await makeEmployee(db);
    const bank = await makeBank();
    await db.employeeBankAccount.create({ data: account(employee.id, bank.id, true) });
    await expect(
      db.employeeBankAccount.create({ data: account(employee.id, bank.id, true) }),
    ).rejects.toThrow();
  });

  it('allows any number of inactive accounts, and switching the active one', async () => {
    const { employee } = await makeEmployee(db);
    const bank = await makeBank();
    const first = await db.employeeBankAccount.create({
      data: account(employee.id, bank.id, true),
    });
    await db.employeeBankAccount.create({ data: account(employee.id, bank.id, false) });
    await db.employeeBankAccount.create({ data: account(employee.id, bank.id, false) });

    await db.employeeBankAccount.update({ where: { id: first.id }, data: { isActive: false } });
    await expect(
      db.employeeBankAccount.create({ data: account(employee.id, bank.id, true) }),
    ).resolves.toBeTruthy();
  });

  it('different employees can each have an active account', async () => {
    const a = await makeEmployee(db);
    const b = await makeEmployee(db);
    const bank = await makeBank();
    await db.employeeBankAccount.create({ data: account(a.employee.id, bank.id, true) });
    await expect(
      db.employeeBankAccount.create({ data: account(b.employee.id, bank.id, true) }),
    ).resolves.toBeTruthy();
  });
});
