/**
 * Server-side data access per role (Magezi spec: "each user has a level of access depending on
 * the information and the role"), plus mobile money payment details.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { decrypt } from '@/lib/crypto';
import { loadDashboard } from '@/lib/dashboard/load';
import { saveBank } from '@/lib/employees/reference';
import { addBankAccount, EmployeeError } from '@/lib/employees/service';
import { employeeAccess } from '@/lib/employees/visibility';
import { makeEmployee, makeRunWithLine, testDb } from './helpers';

const db = testDb();
afterAll(() => db.$disconnect());

const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const actor = { id: null as unknown as string, ip: '127.0.0.1' };

describe('pay figures are not loaded for roles without pay.view', () => {
  it('dashboard: System Admin gets headcount but no gross, net or trend', async () => {
    await makeRunWithLine(db, 'APPROVED');
    const today = '2026-12-15';
    const admin = employeeAccess(['SYSTEM_ADMIN']);
    expect(admin.canSeePay).toBe(false);

    const hidden = await loadDashboard(db, today, { includePay: admin.canSeePay });
    expect(hidden.lastRun).not.toBeNull();
    expect(hidden.lastRun?.gross).toBeNull();
    expect(hidden.lastRun?.net).toBeNull();
    expect(hidden.lastRun?.headcount).toBeGreaterThan(0);
    expect(hidden.trend).toEqual([]);

    const shown = await loadDashboard(db, today, { includePay: true });
    expect(shown.lastRun?.gross).not.toBeNull();
    expect(shown.trend.length).toBeGreaterThan(0);
  });
});

describe('mobile money payment details', () => {
  async function provider(code: string) {
    return db.bank.upsert({
      where: { code },
      update: { kind: 'MOBILE_MONEY' },
      create: { code, name: `${code} wallet`, kind: 'MOBILE_MONEY' },
    });
  }

  it('stores an MTN wallet normalised, encrypted and without a branch', async () => {
    const { employee } = await makeEmployee(db);
    const mtn = await provider('MTNMOMO');
    const account = await db.$transaction((tx) =>
      addBankAccount(
        tx,
        {
          employeeId: employee.id,
          bankId: mtn.id,
          branchCode: '001',
          accountNo: '0772 445 566',
          accountName: 'Test Employee',
          effectiveFrom: '2026-11-01',
        },
        actor,
      ),
    );
    expect(decrypt(account.accountNoEnc)).toBe('256772445566');
    expect(account.accountNoLast4).toBe('5566');
    expect(account.branchCode).toBeNull();
  });

  it('refuses an Airtel number on MTN, and a phone number on a bank', async () => {
    const { employee } = await makeEmployee(db);
    const mtn = await provider('MTNMOMO');
    await expect(
      db.$transaction((tx) =>
        addBankAccount(
          tx,
          {
            employeeId: employee.id,
            bankId: mtn.id,
            accountNo: '0752123456',
            accountName: 'Test',
            effectiveFrom: '2026-11-01',
          },
          actor,
        ),
      ),
    ).rejects.toBeInstanceOf(EmployeeError);

    const bank = await db.bank.create({ data: { code: `B${uid()}`, name: `Bank ${uid()}` } });
    await expect(
      db.$transaction((tx) =>
        addBankAccount(
          tx,
          {
            employeeId: employee.id,
            bankId: bank.id,
            accountNo: '+256 772 445566',
            accountName: 'Test',
            effectiveFrom: '2026-11-01',
          },
          actor,
        ),
      ),
    ).rejects.toThrow(/6–20 digits/);
  });

  it('switching from a bank account to a wallet keeps one active destination', async () => {
    const { employee } = await makeEmployee(db);
    const bank = await db.bank.create({ data: { code: `B${uid()}`, name: `Bank ${uid()}` } });
    const airtel = await provider('AIRTELMONEY');
    const base = { employeeId: employee.id, accountName: 'Test', effectiveFrom: '2026-11-01' };
    await db.$transaction((tx) =>
      addBankAccount(tx, { ...base, bankId: bank.id, accountNo: '1111222233' }, actor),
    );
    await db.$transaction((tx) =>
      addBankAccount(tx, { ...base, bankId: airtel.id, accountNo: '0752123456' }, actor),
    );
    const active = await db.employeeBankAccount.findMany({
      where: { employeeId: employee.id, isActive: true },
      include: { bank: true },
    });
    expect(active).toHaveLength(1);
    expect(active[0]?.bank.kind).toBe('MOBILE_MONEY');
  });

  it('an institution cannot change kind once employees use it', async () => {
    const { employee } = await makeEmployee(db);
    const code = `B${uid()}`;
    const bank = await db.$transaction((tx) =>
      saveBank(tx, null, { name: `Bank ${code}`, code, kind: 'BANK' }, actor),
    );
    await db.$transaction((tx) =>
      addBankAccount(
        tx,
        {
          employeeId: employee.id,
          bankId: bank.id,
          accountNo: '1234567890',
          accountName: 'Test',
          effectiveFrom: '2026-11-01',
        },
        actor,
      ),
    );
    await expect(
      db.$transaction((tx) =>
        saveBank(tx, bank.id, { name: bank.name, code, kind: 'MOBILE_MONEY' }, actor),
      ),
    ).rejects.toThrow(/cannot be changed/);
    // Renaming without changing the kind is still fine.
    await db.$transaction((tx) =>
      saveBank(tx, bank.id, { name: `${bank.name} Ltd`, code, kind: 'BANK' }, actor),
    );
  });
});
