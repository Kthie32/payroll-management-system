/**
 * Employee data operations. Every function takes the caller's transaction client and writes
 * its own audit entry, so the change and its audit record commit together.
 * No Next.js imports here, so integration tests can call these directly.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { withAudit } from '@/lib/audit';
import { encrypt, last4 } from '@/lib/crypto';
import { fromUgx } from '@/lib/money';
import type { ImportLookups, ImportMode, ValidImportRow } from './import';
import {
  type ComponentValue,
  dateToIso,
  type EmployeeFormInput,
  isoToDate,
  LOAN_MANAGED_CODES,
  normalisePaymentAccount,
  rangesOverlap,
} from './validation';

type Tx = Prisma.TransactionClient;

export interface Actor {
  id: string;
  ip: string | null;
}

/** An error whose message is safe to show to the user. */
export class EmployeeError extends Error {}

function employeeData(input: EmployeeFormInput) {
  return {
    staffNo: input.staffNo,
    firstName: input.firstName,
    lastName: input.lastName,
    otherNames: input.otherNames ?? null,
    workerType: input.workerType,
    payGroupId: input.payGroupId,
    departmentId: input.departmentId ?? null,
    jobTitle: input.jobTitle ?? null,
    grade: input.grade ?? null,
    hireDate: isoToDate(input.hireDate),
    residency: input.residency,
    tin: input.tin ?? null,
    nssfNo: input.nssfNo ?? null,
    lstDistrict: input.lstDistrict ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    payeApplicable: input.payeApplicable,
    nssfApplicable: input.nssfApplicable,
    lstApplicable: input.lstApplicable,
  };
}

/** Audit-friendly view of an employee row: dates as ISO, no encrypted values. */
function auditView(e: {
  staffNo: string;
  firstName: string;
  lastName: string;
  otherNames: string | null;
  workerType: string;
  payGroupId: string;
  departmentId: string | null;
  jobTitle: string | null;
  grade: string | null;
  hireDate: Date;
  exitDate?: Date | null;
  residency: string;
  tin: string | null;
  nssfNo: string | null;
  ninEnc?: string | null;
  lstDistrict: string | null;
  email?: string | null;
  phone?: string | null;
  payeApplicable: boolean;
  nssfApplicable: boolean;
  lstApplicable: boolean;
  status?: string;
}) {
  return {
    staffNo: e.staffNo,
    firstName: e.firstName,
    lastName: e.lastName,
    otherNames: e.otherNames,
    workerType: e.workerType,
    payGroupId: e.payGroupId,
    departmentId: e.departmentId,
    jobTitle: e.jobTitle,
    grade: e.grade,
    hireDate: dateToIso(e.hireDate),
    exitDate: e.exitDate ? dateToIso(e.exitDate) : null,
    residency: e.residency,
    tin: e.tin,
    nssfNo: e.nssfNo,
    ninOnFile: Boolean(e.ninEnc),
    lstDistrict: e.lstDistrict,
    email: e.email ?? null,
    phone: e.phone ?? null,
    payeApplicable: e.payeApplicable,
    nssfApplicable: e.nssfApplicable,
    lstApplicable: e.lstApplicable,
    status: e.status,
  };
}

async function assertStaffNoFree(tx: Tx, staffNo: string, exceptId?: string) {
  const clash = await tx.employee.findUnique({ where: { staffNo }, select: { id: true } });
  if (clash && clash.id !== exceptId) {
    throw new EmployeeError(`Staff number ${staffNo} is already used by another employee.`);
  }
}

async function assertReferences(tx: Tx, input: EmployeeFormInput) {
  if (!(await tx.payGroup.findUnique({ where: { id: input.payGroupId }, select: { id: true } }))) {
    throw new EmployeeError('Pay group not found.');
  }
  if (
    input.departmentId &&
    !(await tx.department.findUnique({ where: { id: input.departmentId }, select: { id: true } }))
  ) {
    throw new EmployeeError('Department not found.');
  }
}

export async function createEmployee(tx: Tx, input: EmployeeFormInput, actor: Actor) {
  await assertStaffNoFree(tx, input.staffNo);
  await assertReferences(tx, input);
  const employee = await tx.employee.create({
    data: { ...employeeData(input), ninEnc: input.nin ? encrypt(input.nin) : null },
  });
  await withAudit(tx, {
    actorId: actor.id,
    action: 'EMPLOYEE_CREATED',
    entity: 'Employee',
    entityId: employee.id,
    after: auditView(employee),
    ip: actor.ip,
  });
  return employee;
}

/** Updates profile fields. A blank NIN keeps the stored one. Status/exit use changeStatus. */
export async function updateEmployee(
  tx: Tx,
  employeeId: string,
  input: EmployeeFormInput,
  actor: Actor,
) {
  const before = await tx.employee.findUnique({ where: { id: employeeId } });
  if (!before) throw new EmployeeError('Employee not found.');
  await assertStaffNoFree(tx, input.staffNo, employeeId);
  await assertReferences(tx, input);
  if (before.exitDate && isoToDate(input.hireDate) > before.exitDate) {
    throw new EmployeeError('Hire date cannot be after the exit date.');
  }
  const after = await tx.employee.update({
    where: { id: employeeId },
    data: {
      ...employeeData(input),
      ...(input.nin ? { ninEnc: encrypt(input.nin) } : {}),
    },
  });
  await withAudit(tx, {
    actorId: actor.id,
    action: 'EMPLOYEE_UPDATED',
    entity: 'Employee',
    entityId: employeeId,
    before: auditView(before),
    after: { ...auditView(after), ninChanged: Boolean(input.nin) },
    ip: actor.ip,
  });
  return after;
}

export type StatusChange =
  { kind: 'exit'; exitDate: string } | { kind: 'suspend' } | { kind: 'reactivate' };

export async function changeStatus(tx: Tx, employeeId: string, change: StatusChange, actor: Actor) {
  const before = await tx.employee.findUnique({ where: { id: employeeId } });
  if (!before) throw new EmployeeError('Employee not found.');

  let data: Prisma.EmployeeUpdateInput;
  let action: string;
  switch (change.kind) {
    case 'exit': {
      if (before.status === 'EXITED') throw new EmployeeError('Employee has already exited.');
      const exitDate = isoToDate(change.exitDate);
      if (exitDate < before.hireDate) {
        throw new EmployeeError('Exit date cannot be before the hire date.');
      }
      data = { status: 'EXITED', exitDate };
      action = 'EMPLOYEE_EXITED';
      break;
    }
    case 'suspend':
      if (before.status !== 'ACTIVE')
        throw new EmployeeError('Only active employees can be suspended.');
      data = { status: 'SUSPENDED' };
      action = 'EMPLOYEE_SUSPENDED';
      break;
    case 'reactivate':
      if (before.status === 'ACTIVE') throw new EmployeeError('Employee is already active.');
      // Reinstating an exited employee clears the exit date.
      data = { status: 'ACTIVE', exitDate: null };
      action = 'EMPLOYEE_REACTIVATED';
      break;
  }
  const after = await tx.employee.update({ where: { id: employeeId }, data });
  await withAudit(tx, {
    actorId: actor.id,
    action,
    entity: 'Employee',
    entityId: employeeId,
    before: {
      status: before.status,
      exitDate: before.exitDate ? dateToIso(before.exitDate) : null,
    },
    after: { status: after.status, exitDate: after.exitDate ? dateToIso(after.exitDate) : null },
    ip: actor.ip,
  });
  return after;
}

// ── Payment details (bank account or mobile money wallet) ───────────────

export interface NewBankAccount {
  employeeId: string;
  bankId: string;
  branchCode?: string;
  accountNo: string;
  accountName: string;
  effectiveFrom: string;
}

/**
 * Adds a payment destination (bank account or mobile money wallet) and makes it the active one.
 * The previous active one is deactivated first, because the database allows only one active
 * destination per employee. For mobile money the account number is the normalised wallet number
 * (2567XXXXXXXX) and there is no branch.
 */
export async function addBankAccount(tx: Tx, input: NewBankAccount, actor: Actor) {
  const employee = await tx.employee.findUnique({
    where: { id: input.employeeId },
    select: { id: true },
  });
  if (!employee) throw new EmployeeError('Employee not found.');
  const bank = await tx.bank.findUnique({ where: { id: input.bankId } });
  if (!bank) throw new EmployeeError('Bank or mobile money provider not found.');
  const checked = normalisePaymentAccount(bank, input.accountNo);
  if (!checked.ok) throw new EmployeeError(checked.error);
  const accountNo = checked.accountNo;
  const branchCode = bank.kind === 'MOBILE_MONEY' ? null : (input.branchCode ?? null);

  const previous = await tx.employeeBankAccount.findFirst({
    where: { employeeId: input.employeeId, isActive: true },
    include: { bank: { select: { code: true } } },
  });
  if (previous) {
    await tx.employeeBankAccount.update({ where: { id: previous.id }, data: { isActive: false } });
  }
  const account = await tx.employeeBankAccount.create({
    data: {
      employeeId: input.employeeId,
      bankId: input.bankId,
      branchCode,
      accountNoEnc: encrypt(accountNo),
      accountNoLast4: last4(accountNo),
      accountName: input.accountName,
      effectiveFrom: isoToDate(input.effectiveFrom),
      isActive: true,
    },
  });
  await withAudit(tx, {
    actorId: actor.id,
    action: 'BANK_ACCOUNT_ADDED',
    entity: 'EmployeeBankAccount',
    entityId: account.id,
    before: previous
      ? { activeAccountId: previous.id, bank: previous.bank.code, last4: previous.accountNoLast4 }
      : null,
    after: {
      employeeId: input.employeeId,
      bank: bank.code,
      kind: bank.kind,
      branchCode: account.branchCode,
      last4: account.accountNoLast4,
      accountName: account.accountName,
      effectiveFrom: input.effectiveFrom,
    },
    ip: actor.ip,
  });
  return account;
}

// ── Pay component assignments ───────────────────────────────────────────

export interface NewAssignment {
  employeeId: string;
  componentId: string;
  value: ComponentValue;
  effectiveFrom: string;
  effectiveTo?: string;
}

function assignmentRange(a: { effectiveFrom: Date; effectiveTo: Date | null }) {
  return { from: dateToIso(a.effectiveFrom), to: a.effectiveTo ? dateToIso(a.effectiveTo) : null };
}

async function assertNoOverlap(
  tx: Tx,
  employeeId: string,
  componentId: string,
  range: { from: string; to: string | null },
  exceptId?: string,
) {
  const existing = await tx.employeeComponent.findMany({
    where: { employeeId, componentId, ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
  const clash = existing.find((e) => rangesOverlap(assignmentRange(e), range));
  if (clash) {
    const r = assignmentRange(clash);
    throw new EmployeeError(
      `This component is already assigned from ${r.from} to ${r.to ?? 'open-ended'}. ` +
        'End that assignment first.',
    );
  }
}

export async function assignComponent(tx: Tx, input: NewAssignment, actor: Actor) {
  const component = await tx.payComponent.findUnique({ where: { id: input.componentId } });
  if (!component || !component.isActive) throw new EmployeeError('Pay component not found.');
  if (LOAN_MANAGED_CODES.includes(component.code)) {
    throw new EmployeeError(`${component.name} is managed from the Loans page.`);
  }
  const employee = await tx.employee.findUnique({
    where: { id: input.employeeId },
    select: { id: true },
  });
  if (!employee) throw new EmployeeError('Employee not found.');
  if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) {
    throw new EmployeeError('End date cannot be before the start date.');
  }
  const range = { from: input.effectiveFrom, to: input.effectiveTo ?? null };
  await assertNoOverlap(tx, input.employeeId, input.componentId, range);

  const row = await tx.employeeComponent.create({
    data: {
      employeeId: input.employeeId,
      componentId: input.componentId,
      amount: input.value.amount === null ? null : fromUgx(input.value.amount),
      rateBp: input.value.rateBp,
      ratePerUnit: input.value.ratePerUnit === null ? null : fromUgx(input.value.ratePerUnit),
      effectiveFrom: isoToDate(input.effectiveFrom),
      effectiveTo: input.effectiveTo ? isoToDate(input.effectiveTo) : null,
    },
  });
  await withAudit(tx, {
    actorId: actor.id,
    action: 'EMPLOYEE_COMPONENT_ASSIGNED',
    entity: 'EmployeeComponent',
    entityId: row.id,
    after: { employeeId: input.employeeId, component: component.code, ...input.value, ...range },
    ip: actor.ip,
  });
  return row;
}

/** Sets (or brings forward) the end date of an assignment. Assignments are never deleted. */
export async function endComponent(
  tx: Tx,
  assignmentId: string,
  effectiveTo: string,
  actor: Actor,
) {
  const row = await tx.employeeComponent.findUnique({
    where: { id: assignmentId },
    include: { component: { select: { code: true } } },
  });
  if (!row) throw new EmployeeError('Assignment not found.');
  const before = assignmentRange(row);
  if (effectiveTo < before.from)
    throw new EmployeeError('End date cannot be before the start date.');
  if (before.to !== null && effectiveTo > before.to) {
    throw new EmployeeError(
      `This assignment already ends on ${before.to}. Assign a new period instead.`,
    );
  }
  await tx.employeeComponent.update({
    where: { id: assignmentId },
    data: { effectiveTo: isoToDate(effectiveTo) },
  });
  await withAudit(tx, {
    actorId: actor.id,
    action: 'EMPLOYEE_COMPONENT_ENDED',
    entity: 'EmployeeComponent',
    entityId: assignmentId,
    before: { component: row.component.code, ...before },
    after: { component: row.component.code, from: before.from, to: effectiveTo },
    ip: actor.ip,
  });
}

// ── CSV import ──────────────────────────────────────────────────────────

export async function loadImportLookups(client: PrismaClient | Tx): Promise<ImportLookups> {
  const [payGroups, departments, banks, staff] = await Promise.all([
    client.payGroup.findMany({ select: { id: true, name: true } }),
    client.department.findMany({ select: { id: true, name: true } }),
    client.bank.findMany({ select: { id: true, name: true, code: true, kind: true } }),
    client.employee.findMany({ select: { staffNo: true } }),
  ]);
  const bankMap = new Map<
    string,
    { id: string; kind: (typeof banks)[number]['kind']; code: string }
  >();
  for (const b of banks) {
    const info = { id: b.id, kind: b.kind, code: b.code };
    bankMap.set(b.code.toLowerCase(), info);
    bankMap.set(b.name.toLowerCase(), info);
  }
  return {
    payGroups: new Map(payGroups.map((p) => [p.name.toLowerCase(), p.id])),
    departments: new Map(departments.map((d) => [d.name.toLowerCase(), d.id])),
    banks: bankMap,
    existingStaffNos: new Set(staff.map((s) => s.staffNo.toUpperCase())),
  };
}

export interface ImportSummary {
  created: number;
  bankAccounts: number;
  basicSalaries: number;
  skipped: number;
}

/** Creates employees (plus optional bank account and BASIC salary) for already-validated rows. */
export async function commitImport(
  tx: Tx,
  rows: ValidImportRow[],
  meta: { mode: ImportMode; totalRows: number; fileName: string | null },
  actor: Actor,
): Promise<ImportSummary> {
  const basic = await tx.payComponent.findUnique({ where: { code: 'BASIC' } });
  if (rows.some((r) => r.basicSalary !== null) && !basic) {
    throw new EmployeeError('The BASIC pay component is missing; cannot import salaries.');
  }
  const summary: ImportSummary = {
    created: 0,
    bankAccounts: 0,
    basicSalaries: 0,
    skipped: meta.totalRows - rows.length,
  };

  for (const r of rows) {
    if (await tx.employee.findUnique({ where: { staffNo: r.staffNo }, select: { id: true } })) {
      throw new EmployeeError(`Line ${r.line}: staff number ${r.staffNo} already exists.`);
    }
    const hireDate = isoToDate(r.hireDate);
    const employee = await tx.employee.create({
      data: {
        staffNo: r.staffNo,
        firstName: r.firstName,
        lastName: r.lastName,
        otherNames: r.otherNames,
        workerType: r.workerType,
        payGroupId: r.payGroupId,
        departmentId: r.departmentId,
        jobTitle: r.jobTitle,
        grade: r.grade,
        hireDate,
        residency: r.residency,
        tin: r.tin,
        nssfNo: r.nssfNo,
        ninEnc: r.nin ? encrypt(r.nin) : null,
        lstDistrict: r.lstDistrict,
        email: r.email,
        phone: r.phone,
        payeApplicable: r.payeApplicable,
        nssfApplicable: r.nssfApplicable,
        lstApplicable: r.lstApplicable,
      },
    });
    summary.created++;
    if (r.bankAccount) {
      await tx.employeeBankAccount.create({
        data: {
          employeeId: employee.id,
          bankId: r.bankAccount.bankId,
          branchCode: r.bankAccount.branchCode,
          accountNoEnc: encrypt(r.bankAccount.accountNo),
          accountNoLast4: last4(r.bankAccount.accountNo),
          accountName: r.bankAccount.accountName,
          effectiveFrom: hireDate,
          isActive: true,
        },
      });
      summary.bankAccounts++;
    }
    if (r.basicSalary !== null && basic) {
      await tx.employeeComponent.create({
        data: {
          employeeId: employee.id,
          componentId: basic.id,
          amount: fromUgx(r.basicSalary),
          effectiveFrom: hireDate,
        },
      });
      summary.basicSalaries++;
    }
  }

  await withAudit(tx, {
    actorId: actor.id,
    action: 'EMPLOYEE_IMPORTED',
    entity: 'Employee',
    entityId: null,
    after: {
      fileName: meta.fileName,
      mode: meta.mode,
      totalRows: meta.totalRows,
      ...summary,
      staffNos: rows.map((r) => r.staffNo),
    },
    ip: actor.ip,
  });
  return summary;
}
