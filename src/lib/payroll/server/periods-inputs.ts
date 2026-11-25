import 'server-only';
import { Prisma } from '@prisma/client';
import { withAudit } from '@/lib/audit';
import { db } from '@/lib/db';
import { fromUgx } from '@/lib/money';
import { ADJUSTMENT_CODES, validateAdjustment, type AdjustmentDraft } from '../adjustments';
import { parseInputsCsv, type CsvAdjustedRun, type CsvComponent } from '../csv-inputs';
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

export async function updatePayDate(
  periodId: string,
  payDate: string,
  actorId: string,
  ip: string | null,
) {
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

/**
 * Components shown in the inputs grid: active, not percentage-based, and not adjustment codes
 * (arrears and recoveries are entered in the Adjustments section with a note and a corrected run).
 */
export async function inputComponents() {
  return db.payComponent.findMany({
    where: {
      isActive: true,
      calcType: { not: 'PERCENT_OF_BASIC' },
      code: { notIn: [...ADJUSTMENT_CODES] },
    },
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
export async function saveManualInputs(
  periodId: string,
  cells: GridCell[],
  actorId: string,
  ip: string | null,
) {
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
      rows.push({
        periodId,
        employeeId: cell.employeeId,
        componentId: comp.id,
        quantity: new Prisma.Decimal(v),
        source: 'MANUAL',
      });
    } else {
      if (!AMT_RE.test(v) || !Number.isSafeInteger(Number(v))) {
        errors.push(`${comp.code}: "${cell.value}" is not a valid amount (whole shillings)`);
        continue;
      }
      if (Number(v) === 0) continue;
      rows.push({
        periodId,
        employeeId: cell.employeeId,
        componentId: comp.id,
        amount: fromUgx(Number(v)),
        source: 'MANUAL',
      });
    }
  }
  if (errors.length) throw new RunActionError(errors.slice(0, 5).join('; '));

  await db.$transaction(async (tx) => {
    // Adjustments are MANUAL inputs too, but always carry a note: keep them.
    const removed = await tx.payrollInput.deleteMany({
      where: { periodId, source: 'MANUAL', note: null, adjustsRunId: null },
    });
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
  return parseInputsCsv(text, {
    ...(await csvLookups(periodId)),
    adjustedRuns: await adjustedRunsForCsv(periodId),
  });
}

/** Imports a CSV. All rows must be valid; otherwise nothing is imported. */
export async function importInputsCsv(
  periodId: string,
  text: string,
  actorId: string,
  ip: string | null,
) {
  await assertPeriodOpen(periodId);
  const parsed = parseInputsCsv(text, {
    ...(await csvLookups(periodId)),
    adjustedRuns: await adjustedRunsForCsv(periodId),
  });
  if (parsed.fileErrors.length) throw new RunActionError(parsed.fileErrors.join(' '));
  if (parsed.errorCount > 0) {
    throw new RunActionError(
      `${parsed.errorCount} row(s) have errors. Fix the file and preview again.`,
    );
  }
  await db.$transaction(async (tx) => {
    await tx.payrollInput.createMany({
      data: parsed.rows.map((r) => ({
        periodId,
        employeeId: r.employeeId!,
        componentId: r.componentId!,
        quantity: r.quantity === null ? null : new Prisma.Decimal(r.quantity.toFixed(2)),
        amount: r.amount === null ? null : fromUgx(r.amount),
        note: r.note,
        adjustsRunId: r.adjustsRunId,
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

// ── Adjustments (corrections to earlier approved runs) ───────────────────

/** Approved-or-later runs that included the employee and were paid before `beforePayDate`. */
export async function correctableRuns(employeeId: string, beforePayDate: Date) {
  const rows = await db.payrollRunEmployee.findMany({
    where: {
      employeeId,
      run: { status: { in: [...POSTED_STATUSES] }, period: { payDate: { lt: beforePayDate } } },
    },
    select: {
      net: true,
      run: {
        select: {
          id: true,
          payGroup: { select: { name: true } },
          period: { select: { startDate: true, endDate: true, payDate: true } },
        },
      },
    },
    orderBy: { run: { period: { payDate: 'desc' } } },
    take: 24,
  });
  return rows.map((r) => ({
    runId: r.run.id,
    label: `${r.run.payGroup.name}: ${toIsoDate(r.run.period.startDate)} – ${toIsoDate(r.run.period.endDate)}`,
    payDate: toIsoDate(r.run.period.payDate),
    startDate: toIsoDate(r.run.period.startDate),
  }));
}

/** Adjustment inputs (arrears / recoveries) entered for a period. */
export async function listAdjustments(periodId: string) {
  return db.payrollInput.findMany({
    where: { periodId, component: { code: { in: [...ADJUSTMENT_CODES] } } },
    include: {
      component: { select: { code: true, name: true } },
      employee: { select: { staffNo: true, firstName: true, lastName: true } },
      adjustsRun: {
        select: { id: true, period: { select: { startDate: true, endDate: true } } },
      },
    },
    orderBy: [{ employee: { staffNo: 'asc' } }, { createdAt: 'asc' }],
  });
}

/**
 * Adds an ARREARS or OVERPAYMENT_RECOVERY input to an open period, linked to the earlier approved
 * run it corrects. The corrected run itself is never changed.
 */
export async function addAdjustment(
  periodId: string,
  employeeId: string,
  draft: AdjustmentDraft,
  actorId: string,
  ip: string | null,
) {
  await assertPeriodOpen(periodId);
  const v = validateAdjustment(draft);
  if (!v.ok) throw new RunActionError(v.errors.join(' '));
  const period = await db.payPeriod.findUnique({ where: { id: periodId } });
  if (!period) throw new RunActionError('Pay period not found.');
  const employees = await periodEmployees(periodId);
  if (!employees.some((e) => e.id === employeeId)) {
    throw new RunActionError('That employee is not paid in this period.');
  }
  const allowed = await correctableRuns(employeeId, period.payDate);
  if (!allowed.some((r) => r.runId === v.value.adjustsRunId)) {
    throw new RunActionError('Choose an earlier approved run that included this employee.');
  }
  const component = await db.payComponent.findUnique({ where: { code: v.value.componentCode } });
  if (!component || !component.isActive) {
    throw new RunActionError(`The ${v.value.componentCode} pay component is missing or inactive.`);
  }
  return db.$transaction(async (tx) => {
    const row = await tx.payrollInput.create({
      data: {
        periodId,
        employeeId,
        componentId: component.id,
        amount: fromUgx(v.value.amount),
        note: v.value.note,
        adjustsRunId: v.value.adjustsRunId,
        source: 'MANUAL',
      },
    });
    await withAudit(tx, {
      actorId,
      action: 'PAYROLL_ADJUSTMENT_ADDED',
      entity: 'PayrollInput',
      entityId: row.id,
      after: {
        periodId,
        employeeId,
        componentCode: v.value.componentCode,
        amount: v.value.amount,
        note: v.value.note,
        adjustsRunId: v.value.adjustsRunId,
      },
      ip,
    });
    return row;
  });
}

export async function removeAdjustment(inputId: string, actorId: string, ip: string | null) {
  const row = await db.payrollInput.findUnique({
    where: { id: inputId },
    include: { component: { select: { code: true } } },
  });
  if (!row || !(ADJUSTMENT_CODES as readonly string[]).includes(row.component.code)) {
    throw new RunActionError('Adjustment not found.');
  }
  await assertPeriodOpen(row.periodId);
  await db.$transaction(async (tx) => {
    await tx.payrollInput.delete({ where: { id: row.id } });
    await withAudit(tx, {
      actorId,
      action: 'PAYROLL_ADJUSTMENT_REMOVED',
      entity: 'PayrollInput',
      entityId: row.id,
      before: {
        periodId: row.periodId,
        employeeId: row.employeeId,
        componentCode: row.component.code,
        amount: row.amount === null ? null : row.amount.toString(),
        note: row.note,
        adjustsRunId: row.adjustsRunId,
      },
      ip,
    });
  });
  return row.periodId;
}

/**
 * The period in which to correct an approved run for an employee: the earliest open (not yet
 * approved) period of the employee's current pay group with a pay date after the run's.
 */
export async function nextOpenPeriodFor(runId: string, employeeId: string) {
  const [run, employee] = await Promise.all([
    db.payrollRun.findUnique({ where: { id: runId }, include: { period: true } }),
    db.employee.findUnique({ where: { id: employeeId }, select: { payGroupId: true } }),
  ]);
  if (!run || !employee) return null;
  const candidates = await db.payPeriod.findMany({
    where: { payGroupId: employee.payGroupId, payDate: { gt: run.period.payDate } },
    orderBy: { payDate: 'asc' },
    take: 12,
  });
  for (const p of candidates) {
    if (!(await isPeriodLocked(p.id))) return p;
  }
  return null;
}

/** Resolves CSV adjustment references: an approved run that included the employee and started on the date. */
export async function adjustedRunsForCsv(periodId: string): Promise<Map<string, CsvAdjustedRun[]>> {
  const period = await db.payPeriod.findUniqueOrThrow({ where: { id: periodId } });
  const rows = await db.payrollRunEmployee.findMany({
    where: {
      run: { status: { in: [...POSTED_STATUSES] }, period: { payDate: { lt: period.payDate } } },
    },
    select: {
      employeeId: true,
      run: { select: { id: true, period: { select: { startDate: true } } } },
    },
  });
  const map = new Map<string, CsvAdjustedRun[]>();
  for (const r of rows) {
    const key = `${r.employeeId}|${toIsoDate(r.run.period.startDate)}`;
    const list = map.get(key) ?? [];
    list.push({ runId: r.run.id });
    map.set(key, list);
  }
  return map;
}
