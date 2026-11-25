/**
 * Departments and payment institutions (banks and mobile money providers): create, rename and
 * delete (blocked while in use). Audited.
 */
import type { InstitutionType, Prisma } from '@prisma/client';
import { withAudit } from '@/lib/audit';
import { type Actor, EmployeeError } from './service';

type Tx = Prisma.TransactionClient;

export interface DepartmentInput {
  name: string;
  costCentreCode?: string;
}

async function assertDepartmentNameFree(tx: Tx, name: string, exceptId?: string) {
  const clash = await tx.department.findUnique({ where: { name }, select: { id: true } });
  if (clash && clash.id !== exceptId)
    throw new EmployeeError(`Department "${name}" already exists.`);
}

export async function saveDepartment(
  tx: Tx,
  id: string | null,
  input: DepartmentInput,
  actor: Actor,
) {
  await assertDepartmentNameFree(tx, input.name, id ?? undefined);
  const data = { name: input.name, costCentreCode: input.costCentreCode ?? null };
  if (!id) {
    const row = await tx.department.create({ data });
    await withAudit(tx, {
      actorId: actor.id,
      action: 'DEPARTMENT_CREATED',
      entity: 'Department',
      entityId: row.id,
      after: data,
      ip: actor.ip,
    });
    return row;
  }
  const before = await tx.department.findUnique({ where: { id } });
  if (!before) throw new EmployeeError('Department not found.');
  const row = await tx.department.update({ where: { id }, data });
  await withAudit(tx, {
    actorId: actor.id,
    action: 'DEPARTMENT_UPDATED',
    entity: 'Department',
    entityId: id,
    before: { name: before.name, costCentreCode: before.costCentreCode },
    after: data,
    ip: actor.ip,
  });
  return row;
}

export async function deleteDepartment(tx: Tx, id: string, actor: Actor) {
  const row = await tx.department.findUnique({
    where: { id },
    include: { _count: { select: { employees: true } } },
  });
  if (!row) throw new EmployeeError('Department not found.');
  if (row._count.employees > 0) {
    throw new EmployeeError(
      `"${row.name}" has ${row._count.employees} employee(s). Move them to another department first.`,
    );
  }
  await tx.department.delete({ where: { id } });
  await withAudit(tx, {
    actorId: actor.id,
    action: 'DEPARTMENT_DELETED',
    entity: 'Department',
    entityId: id,
    before: { name: row.name, costCentreCode: row.costCentreCode },
    ip: actor.ip,
  });
}

export interface BankInput {
  name: string;
  code: string;
  kind: InstitutionType;
}

const KIND_LABEL: Record<InstitutionType, string> = {
  BANK: 'bank',
  MOBILE_MONEY: 'mobile money provider',
};

export async function saveBank(tx: Tx, id: string | null, input: BankInput, actor: Actor) {
  const nameClash = await tx.bank.findUnique({ where: { name: input.name }, select: { id: true } });
  if (nameClash && nameClash.id !== id)
    throw new EmployeeError(`Bank "${input.name}" already exists.`);
  const codeClash = await tx.bank.findUnique({ where: { code: input.code }, select: { id: true } });
  if (codeClash && codeClash.id !== id)
    throw new EmployeeError(`Bank code ${input.code} is already used.`);

  if (!id) {
    const row = await tx.bank.create({ data: input });
    await withAudit(tx, {
      actorId: actor.id,
      action: 'BANK_CREATED',
      entity: 'Bank',
      entityId: row.id,
      after: input,
      ip: actor.ip,
    });
    return row;
  }
  const before = await tx.bank.findUnique({
    where: { id },
    include: { _count: { select: { accounts: true } } },
  });
  if (!before) throw new EmployeeError('Bank not found.');
  // Account numbers are validated by kind (digits vs wallet numbers), so the kind is fixed once
  // any employee uses this institution.
  if (before.kind !== input.kind && before._count.accounts > 0) {
    throw new EmployeeError(
      `"${before.name}" is used by ${before._count.accounts} payment account(s), so it cannot be ` +
        `changed from a ${KIND_LABEL[before.kind]} to a ${KIND_LABEL[input.kind]}.`,
    );
  }
  const row = await tx.bank.update({ where: { id }, data: input });
  await withAudit(tx, {
    actorId: actor.id,
    action: 'BANK_UPDATED',
    entity: 'Bank',
    entityId: id,
    before: { name: before.name, code: before.code, kind: before.kind },
    after: input,
    ip: actor.ip,
  });
  return row;
}

export async function deleteBank(tx: Tx, id: string, actor: Actor) {
  const row = await tx.bank.findUnique({
    where: { id },
    include: { _count: { select: { accounts: true, templates: true, exports: true } } },
  });
  if (!row) throw new EmployeeError('Bank not found.');
  const uses = row._count.accounts + row._count.templates + row._count.exports;
  if (uses > 0) {
    throw new EmployeeError(
      `"${row.name}" is used by ${row._count.accounts} account(s), ${row._count.templates} export ` +
        `template(s) and ${row._count.exports} export(s), so it cannot be deleted.`,
    );
  }
  await tx.bank.delete({ where: { id } });
  await withAudit(tx, {
    actorId: actor.id,
    action: 'BANK_DELETED',
    entity: 'Bank',
    entityId: id,
    before: { name: row.name, code: row.code, kind: row.kind },
    ip: actor.ip,
  });
}
