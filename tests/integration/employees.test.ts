import { afterAll, describe, expect, it } from 'vitest';
import { decrypt } from '@/lib/crypto';
import { validateImport } from '@/lib/employees/import';
import { deleteBank, deleteDepartment, saveDepartment } from '@/lib/employees/reference';
import {
  addBankAccount,
  assignComponent,
  changeStatus,
  commitImport,
  createEmployee,
  EmployeeError,
  endComponent,
  loadImportLookups,
  updateEmployee,
} from '@/lib/employees/service';
import { employeeFormSchema } from '@/lib/employees/validation';
import { makeEmployee, testDb } from './helpers';

const db = testDb();
afterAll(() => db.$disconnect());

const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const actor = { id: null as unknown as string, ip: '127.0.0.1' };

async function makeBank() {
  const code = `B${uid()}`;
  return db.bank.create({ data: { name: `Bank ${code}`, code } });
}

async function component(code: string, calcType: 'FIXED' | 'PERCENT_OF_BASIC' | 'RATE_X_QTY') {
  return db.payComponent.upsert({
    where: { code },
    update: {},
    create: { code, name: code, kind: 'EARNING', calcType },
  });
}

describe('employee records', () => {
  it('creates an employee with an encrypted NIN and audits it without the NIN', async () => {
    const pg = await db.payGroup.create({ data: { name: `PG ${uid()}`, frequency: 'MONTHLY' } });
    const input = employeeFormSchema.parse({
      staffNo: `E-${uid()}`,
      firstName: 'Jane',
      lastName: 'Doe',
      workerType: 'PERMANENT',
      payGroupId: pg.id,
      hireDate: '2026-01-01',
      residency: 'RESIDENT',
      nin: 'CF90012345ABCD',
    });
    const e = await db.$transaction((tx) => createEmployee(tx, input, actor));
    expect(e.ninEnc).toMatch(/^v1:/);
    expect(decrypt(e.ninEnc!)).toBe('CF90012345ABCD');
    const audit = await db.auditLog.findFirstOrThrow({
      where: { entityId: e.id, action: 'EMPLOYEE_CREATED' },
    });
    expect(JSON.stringify(audit.after)).not.toContain('CF90012345ABCD');

    // Duplicate staff number is refused.
    await expect(db.$transaction((tx) => createEmployee(tx, input, actor))).rejects.toThrow(
      EmployeeError,
    );

    // Blank NIN on update keeps the stored one.
    const updated = await db.$transaction((tx) =>
      updateEmployee(tx, e.id, { ...input, nin: undefined, jobTitle: 'Clerk' }, actor),
    );
    expect(updated.ninEnc).toBe(e.ninEnc);
    expect(updated.jobTitle).toBe('Clerk');
  });

  it('exits, refuses double exit and reinstates', async () => {
    const { employee } = await makeEmployee(db);
    await expect(
      db.$transaction((tx) => changeStatus(tx, employee.id, { kind: 'exit', exitDate: '2025-12-31' }, actor)),
    ).rejects.toThrow('Exit date cannot be before the hire date.');
    const exited = await db.$transaction((tx) =>
      changeStatus(tx, employee.id, { kind: 'exit', exitDate: '2026-11-10' }, actor),
    );
    expect(exited.status).toBe('EXITED');
    await expect(
      db.$transaction((tx) => changeStatus(tx, employee.id, { kind: 'exit', exitDate: '2026-11-11' }, actor)),
    ).rejects.toThrow(EmployeeError);
    const back = await db.$transaction((tx) =>
      changeStatus(tx, employee.id, { kind: 'reactivate' }, actor),
    );
    expect(back.status).toBe('ACTIVE');
    expect(back.exitDate).toBeNull();
  });
});

describe('bank accounts', () => {
  it('switches the active account in one transaction and keeps history', async () => {
    const { employee } = await makeEmployee(db);
    const bank = await makeBank();
    const base = {
      employeeId: employee.id,
      bankId: bank.id,
      accountName: 'Test Employee',
      effectiveFrom: '2026-01-01',
    };
    const first = await db.$transaction((tx) =>
      addBankAccount(tx, { ...base, accountNo: '1111222233' }, actor),
    );
    const second = await db.$transaction((tx) =>
      addBankAccount(tx, { ...base, accountNo: '4444555566' }, actor),
    );
    const rows = await db.employeeBankAccount.findMany({ where: { employeeId: employee.id } });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === first.id)?.isActive).toBe(false);
    expect(rows.find((r) => r.id === second.id)?.isActive).toBe(true);
    expect(second.accountNoLast4).toBe('5566');
    expect(decrypt(second.accountNoEnc)).toBe('4444555566');

    // A bank in use cannot be deleted.
    await expect(db.$transaction((tx) => deleteBank(tx, bank.id, actor))).rejects.toThrow(
      EmployeeError,
    );
  });
});

describe('pay component assignments', () => {
  it('prevents overlapping periods and allows a new period after ending one', async () => {
    const { employee } = await makeEmployee(db);
    const housing = await component(`HOUSE_${uid()}`, 'FIXED');
    const value = { amount: 200_000, rateBp: null, ratePerUnit: null };
    const first = await db.$transaction((tx) =>
      assignComponent(
        tx,
        { employeeId: employee.id, componentId: housing.id, value, effectiveFrom: '2026-01-01' },
        actor,
      ),
    );
    expect(first.amount).toBe(200_000n);

    await expect(
      db.$transaction((tx) =>
        assignComponent(
          tx,
          { employeeId: employee.id, componentId: housing.id, value, effectiveFrom: '2026-07-01' },
          actor,
        ),
      ),
    ).rejects.toThrow(/already assigned/);

    await db.$transaction((tx) => endComponent(tx, first.id, '2026-06-30', actor));
    await expect(
      db.$transaction((tx) => endComponent(tx, first.id, '2026-08-01', actor)),
    ).rejects.toThrow(/already ends/);

    const second = await db.$transaction((tx) =>
      assignComponent(
        tx,
        {
          employeeId: employee.id,
          componentId: housing.id,
          value: { ...value, amount: 250_000 },
          effectiveFrom: '2026-07-01',
        },
        actor,
      ),
    );
    expect(second.amount).toBe(250_000n);
  });

  it('refuses loan-managed components', async () => {
    const { employee } = await makeEmployee(db);
    const loan = await db.payComponent.upsert({
      where: { code: 'LOAN' },
      update: {},
      create: { code: 'LOAN', name: 'Loan', kind: 'DEDUCTION', calcType: 'FIXED' },
    });
    await expect(
      db.$transaction((tx) =>
        assignComponent(
          tx,
          {
            employeeId: employee.id,
            componentId: loan.id,
            value: { amount: 1, rateBp: null, ratePerUnit: null },
            effectiveFrom: '2026-01-01',
          },
          actor,
        ),
      ),
    ).rejects.toThrow(/Loans page/);
  });
});

describe('departments', () => {
  it('blocks deleting a department with employees', async () => {
    const dep = await db.$transaction((tx) =>
      saveDepartment(tx, null, { name: `Dept ${uid()}` }, actor),
    );
    const { employee } = await makeEmployee(db);
    await db.employee.update({ where: { id: employee.id }, data: { departmentId: dep.id } });
    await expect(db.$transaction((tx) => deleteDepartment(tx, dep.id, actor))).rejects.toThrow(
      /Move them/,
    );
  });
});

describe('CSV import', () => {
  it('creates employees, bank accounts and BASIC salaries, and audits once', async () => {
    await component('BASIC', 'FIXED');
    const pg = await db.payGroup.create({ data: { name: `Import PG ${uid()}`, frequency: 'MONTHLY' } });
    const bank = await makeBank();
    const a = `IMP-${uid()}`;
    const b = `IMP-${uid()}`;
    const csv = [
      'staff_no,first_name,last_name,pay_group,hire_date,basic_salary,bank,account_no',
      `${a},Ann,One,${pg.name},2026-02-01,1500000,${bank.code},123456789`,
      `${b},Ben,Two,${pg.name},2026-03-01,,,`,
      `BAD ROW,Cat,Three,Nowhere,2026-03-01,,,`,
    ].join('\n');
    const result = validateImport(csv, await loadImportLookups(db));
    expect(result.validCount).toBe(2);
    expect(result.errorCount).toBe(1);

    const rows = result.rows.flatMap((r) => (r.row ? [r.row] : []));
    const summary = await db.$transaction((tx) =>
      commitImport(tx, rows, { mode: 'VALID_ONLY', totalRows: 3, fileName: 't.csv' }, actor),
    );
    expect(summary).toEqual({ created: 2, bankAccounts: 1, basicSalaries: 1, skipped: 1 });

    const ann = await db.employee.findUniqueOrThrow({
      where: { staffNo: a },
      include: { bankAccounts: true, components: true },
    });
    expect(ann.bankAccounts[0]?.isActive).toBe(true);
    expect(ann.components[0]?.amount).toBe(1_500_000n);

    // Re-importing the same file now fails validation for the existing staff numbers.
    const again = validateImport(csv, await loadImportLookups(db));
    expect(again.validCount).toBe(0);
  });
});
