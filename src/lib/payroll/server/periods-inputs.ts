import 'server-only';
import { Prisma } from '@prisma/client';
import { withAudit } from '@/lib/audit';
import { db } from '@/lib/db';
import { fromUgx } from '@/lib/money';
import { parseInputsCsv, type CsvComponent } from '../csv-inputs';
import { fromIsoDate, toIsoDate } from '../dates';
import { generatePeriods, type GeneratePeriodsOptions } from '../periods';
import { POSTED_STATUSES } from '../status';
import { RunActionError } from './errors';

/** Creates the generated periods that do not exist yet (by pay group + start date). */
export async function generatePeriodsForGroup(
  payGroupId: string,
  opts: Omit<GeneratePeriodsOptions, 'frequency'>,
  actorId: string,
  ip: string | null,
) {
  const group = await db.payGroup.findUnique({ where: { id: payGroupId } });
  if (!group) throw new RunActionError('Pay group not found.');
  const generated = generatePeriods({ ...opts, frequency: group.frequency });
  const existing = await db.payPeriod.findMany({
    where: { payGroupId, startDate: { in: generated.map((p) => fromIsoDate(p.start)) } },
    select: { startDate: true },
  });
  const have = new Set(existing.map((p) => toIsoDate(p.startDate)));
  const toCreate = generated.filter((p) => !have.has(p.start));
  if (toCreate.length === 0) return { created: 0, skipped: generated.length };

  await db.$transaction(async (tx) => {
    await tx.payPeriod.createMany({
      data: toCreate.map((p) => ({
        payGroupId,
        startDate: fromIsoDate(p.start),
        endDate: fromIsoDate(p.end),
        payDate: fromIsoDate(p.payDate),
      })),
      skipDuplicates: true,
    });
    await withAudit(tx, {
      actorId,
      action: 'PAY_PERIODS_GENERATED',
      entity: 'PayGroup',
      entityId: payGroupId,
      after: { from: opts.from, to: opts.to, anchor: opts.anchor ?? null, periods: toCreate },
      ip,
    });
  });
  return { created: toCreate.length, skipped: generated.length - toCreate.length };
}

/** True when the period has a run at APPROVED or later: its inputs and dates are frozen. */
export async function isPeriodLocked(periodId: string): Promise<boolean> {
  const n = await db.payrollRun.count({
    where: { periodId, status: { in: [...POSTED_STATUSES] } },
  });
  return n > 0;
}

async function assertPeriodOpen(periodId: string) {
  if (await isPeriodLocked(periodId)) {
    throw new RunActionError('This period has an approved run, so it can no longer be changed.');
  }
}

export async function updatePayDate(periodId: string, payDate: string, actorId: string, ip: string | null) {
  const period = await db.payPeriod.findUnique({ where: { id: periodId } });
  if (!period) throw new RunActionError('Pay period not found.');
  await assertPeriodOpen(periodId);
  const start = toIsoDate(period.startDate);
  if (payDate < start) throw new RunActionError('The pay date cannot be before the period starts.');
  await db.$transaction(async (tx) => {
    await tx.payPeriod.update({ where: { id: periodId }, data: { payDate: fromIsoDate(payDate) } });
    await withAudit(tx, {
      actorId,
      action: 'PAY_PERIOD_PAYDATE_CHANGED',
      entity: 'PayPeriod',
      entityId: periodId,
      before: { payDate: toIsoDate(period.payDate) },
      after: { payDate },
      ip,
    });
  });
}

/** Employees in the period's pay group whose employment overlaps the period. */
export async function periodEmployees(periodId: string) {
  const period = await db.payPeriod.findUniqueOrThrow({ where: { id: periodId } });
  return db.employee.findMany({
    where: {
      payGroupId: period.payGroupId,
      status: { not: 'SUSPENDED' },
      hireDate: { lte: period.endDate },
      OR: [{ exitDate: null }, { exitDate: { gte: period.startDate } }],
    },
    select: { id: true, staffNo: true, firstName: true, lastName: true, otherNames: true },
    orderBy: { staffNo: 'asc' },
  });
}

/** Components that take per-period inputs: active, not percentage-based. */
export async function inputComponents() {
  return db.payComponent.findMany({
    where: { isActive: true, calcType: { not: 'PERCENT_OF_BASIC' } },
    orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { code: 'asc' }],
  });
}

export interface GridCell {
  employeeId: string;
  componentId: string;
  value: string;
}

const QTY_RE = /^\d+(\.\d{1,2})?$/;
const AMT_RE = /^\d+$/;

/**
 * Replaces all MANUAL inputs of a period with the grid values. RATE_X_QTY cells are quantities,
 * FIXED cells are amounts. Imported inputs are left untouched.
 */
export async function saveManualInputs(periodId: string, cells: GridCell[], actorId: string, ip: string | null) {
  await assertPeriodOpen(periodId);
  const [employees, components] = await Promise.all([periodEmployees(periodId), inputComponents()]);
  const empIds = new Set(employees.map((e) => e.id));
  const compBy = new Map(components.map((c) => [c.id, c]));

  const rows: Prisma.PayrollInputCreateManyInput[] = [];
  const errors: string[] = [];
  for (const cell of cells) {
    const v = cell.value.trim().replace(/,/g, '');
    if (!v) continue;
    const comp = compBy.get(cell.componentId);
    if (!comp || !empIds.has(cell.employeeId)) continue;
    if (comp.calcType === 'RATE_X_QTY') {
      if (!QTY_RE.test(v)) {
        errors.push(`${comp.code}: "${cell.value}" is not a valid quantity (max 2 decimals)`);
        continue;
      }
      if (Number(v) === 0) continue;
      rows.push({ periodId, employeeId: cell.employeeId, componentId: comp.id, quantity: new Prisma.Decimal(v), source: 'MANUAL' });
    } else {
      if (!AMT_RE.test(v) || !Number.isSafeInteger(Number(v))) {
        errors.push(`${comp.code}: "${cell.value}" is not a valid amount (whole shillings)`);
        continue;
      }
      if (Number(v) === 0) continue;
      rows.push({ periodId, employeeId: cell.employeeId, componentId: comp.id, amount: fromUgx(Number(v)), source: 'MANUAL' });
    }
  }
  if (errors.length) throw new RunActionError(errors.slice(0, 5).join('; '));

  await db.$transaction(async (tx) => {
    const removed = await tx.payrollInput.deleteMany({ where: { periodId, source: 'MANUAL' } });
    if (rows.length) await tx.payrollInput.createMany({ data: rows });
    await withAudit(tx, {
      actorId,
      action: 'PAYROLL_INPUTS_SAVED',
      entity: 'PayPeriod',
      entityId: periodId,
      before: { manualInputs: removed.count },
      after: { manualInputs: rows.length },
      ip,
    });
  });
  return rows.length;
}

async function csvLookups(periodId: string) {
  const [employees, components] = await Promise.all([
    periodEmployees(periodId),
    db.payComponent.findMany(),
  ]);
  return {
    employeesByStaffNo: new Map(
      employees.map((e) => [e.staffNo, { id: e.id, name: [e.firstName, e.lastName].join(' ') }]),
    ),
    componentsByCode: new Map(
      components.map((c): [string, CsvComponent] => [
        c.code,
        { id: c.id, code: c.code, calcType: c.calcType, isActive: c.isActive },
      ]),
    ),
  };
}

export async function previewInputsCsv(periodId: string, text: string) {
  return parseInputsCsv(text, await csvLookups(periodId));
}

/** Imports a CSV. All rows must be valid; otherwise nothing is imported. */
export async function importInputsCsv(periodId: string, text: string, actorId: string, ip: string | null) {
  await assertPeriodOpen(periodId);
  const parsed = parseInputsCsv(text, await csvLookups(periodId));
  if (parsed.fileErrors.length) throw new RunActionError(parsed.fileErrors.join(' '));
  if (parsed.errorCount > 0) {
    throw new RunActionError(`${parsed.errorCount} row(s) have errors. Fix the file and preview again.`);
  }
  await db.$transaction(async (tx) => {
    await tx.payrollInput.createMany({
      data: parsed.rows.map((r) => ({
        periodId,
        employeeId: r.employeeId!,
        componentId: r.componentId!,
        quantity: r.quantity === null ? null : new Prisma.Decimal(r.quantity.toFixed(2)),
        amount: r.amount === null ? null : fromUgx(r.amount),
        source: 'IMPORT' as const,
      })),
    });
    await withAudit(tx, {
      actorId,
      action: 'PAYROLL_INPUTS_IMPORTED',
      entity: 'PayPeriod',
      entityId: periodId,
      after: { rows: parsed.rows.length },
      ip,
    });
  });
  return parsed.rows.length;
}

export async function deleteImportedInputs(periodId: string, actorId: string, ip: string | null) {
  await assertPeriodOpen(periodId);
  await db.$transaction(async (tx) => {
    const removed = await tx.payrollInput.deleteMany({ where: { periodId, source: 'IMPORT' } });
    await withAudit(tx, {
      actorId,
      action: 'PAYROLL_INPUTS_IMPORT_CLEARED',
      entity: 'PayPeriod',
      entityId: periodId,
      before: { importedInputs: removed.count },
      ip,
    });
  });
}
