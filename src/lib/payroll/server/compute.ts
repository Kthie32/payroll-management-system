import 'server-only';
import { Prisma } from '@prisma/client';
import { withAudit } from '@/lib/audit';
import { db } from '@/lib/db';
import { fromUgx, toUgx } from '@/lib/money';
import {
  calculateEmployee,
  InvalidInputError,
  MissingRuleError,
  type EngineInput,
  type EngineResult,
} from '@/lib/payroll-engine';
import { activeLoanDeductions } from '@/lib/loans';
import { getSettings } from '@/lib/settings/general';
import { loadRulesForDate } from '@/lib/settings/rules';
import { buildEngineInput, type ComponentDef } from '../build-input';
import { formatIsoDate, monthBounds, toIsoDate } from '../dates';
import { isLastCycleOfMonth } from '../periods';
import { isEditable, POSTED_STATUSES, type RunStatus } from '../status';
import { sumTotals, type EmployeeAmounts, type RunError } from '../totals';
import { RunActionError } from './errors';

/** What is stored in `payroll_run_employees.snapshot`. */
export interface RunEmployeeSnapshot {
  input: EngineInput;
  employee: {
    staffNo: string;
    name: string;
    firstName: string;
    lastName: string;
    jobTitle: string | null;
    grade: string | null;
    department: string | null;
    costCentreCode: string | null;
    tin: string | null;
    nssfNo: string | null;
    hireDate: string;
    exitDate: string | null;
    bank: {
      accountId: string;
      bankId: string;
      bankName: string;
      /** BANK or MOBILE_MONEY (absent on snapshots taken before mobile money support). */
      kind?: 'BANK' | 'MOBILE_MONEY';
      branchCode: string | null;
      accountName: string;
      last4: string;
    } | null;
  };
  /** CarryForward rows consumed by this calculation (settled on approval). */
  carryForwardIds: string[];
  /** Unpaid remainders to carry into the next period (created on approval). */
  carryForwardOut: Array<{ code: string; amount: number }>;
  componentNames: Record<string, string>;
}

function fullName(e: { firstName: string; lastName: string; otherNames: string | null }): string {
  return [e.firstName, e.otherNames, e.lastName].filter(Boolean).join(' ');
}

function errorMessage(e: unknown): string {
  if (e instanceof MissingRuleError || e instanceof InvalidInputError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

/**
 * Computes (or recomputes) a run: builds engine input for every employee in the pay group whose
 * employment overlaps the period (SUSPENDED employees are skipped), runs the engine, and replaces
 * the run's employees and lines in one transaction. Employees the engine rejects (e.g. missing
 * PAYE rule) are recorded in `totals.errors` and get no row.
 *
 * Month-to-date (cumulative PAYE, LST basis) uses only APPROVED-or-later runs of earlier periods
 * whose pay date is in the same month, so earlier cycles must be approved first.
 */
export async function computeRun(runId: string, actorId: string, ip: string | null) {
  const run = await db.payrollRun.findUnique({
    where: { id: runId },
    include: { period: true, payGroup: true },
  });
  if (!run) throw new RunActionError('Run not found.');
  if (!isEditable(run.status as RunStatus)) {
    throw new RunActionError(`A run that is ${run.status.toLowerCase()} cannot be recomputed.`);
  }
  const { period, payGroup } = run;
  const start = toIsoDate(period.startDate);
  const end = toIsoDate(period.endDate);
  const payDate = toIsoDate(period.payDate);

  const [siblings, rules, settings, componentRows] = await Promise.all([
    db.payPeriod.findMany({
      where: { payGroupId: payGroup.id },
      select: { id: true, startDate: true, payDate: true },
    }),
    loadRulesForDate(db, period.payDate),
    getSettings(db),
    db.payComponent.findMany(),
  ]);
  const lastCycle = isLastCycleOfMonth(
    { id: period.id, start, payDate },
    siblings.map((p) => ({
      id: p.id,
      start: toIsoDate(p.startDate),
      payDate: toIsoDate(p.payDate),
    })),
  );
  const components: ComponentDef[] = componentRows.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    kind: c.kind,
    calcType: c.calcType,
    taxable: c.taxable,
    nssfable: c.nssfable,
    prorate: c.prorate,
    priority: c.priority,
    sortOrder: c.sortOrder,
    isActive: c.isActive,
  }));
  const componentNames = Object.fromEntries(componentRows.map((c) => [c.code, c.name]));

  const employees = await db.employee.findMany({
    where: {
      payGroupId: payGroup.id,
      status: { not: 'SUSPENDED' },
      hireDate: { lte: period.endDate },
      OR: [{ exitDate: null }, { exitDate: { gte: period.startDate } }],
    },
    include: {
      department: true,
      bankAccounts: { where: { isActive: true }, include: { bank: true }, take: 1 },
      components: {
        where: {
          effectiveFrom: { lte: period.endDate },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: period.startDate } }],
        },
      },
    },
    orderBy: [{ staffNo: 'asc' }],
  });
  const employeeIds = employees.map((e) => e.id);

  const [inputs, carryForwards, mtdRows] = await Promise.all([
    db.payrollInput.findMany({ where: { periodId: period.id, employeeId: { in: employeeIds } } }),
    db.carryForward.findMany({
      where: { employeeId: { in: employeeIds }, settledInRunId: null },
      orderBy: { createdAt: 'asc' },
    }),
    payGroup.frequency === 'MONTHLY'
      ? Promise.resolve([])
      : db.payrollRunEmployee.groupBy({
          by: ['employeeId'],
          where: {
            employeeId: { in: employeeIds },
            run: {
              status: { in: [...POSTED_STATUSES] },
              periodId: { not: period.id },
              period: {
                payDate: {
                  gte: new Date(`${monthBounds(payDate).start}T00:00:00.000Z`),
                  lte: period.payDate,
                },
              },
            },
          },
          _sum: { taxable: true, paye: true, gross: true },
        }),
  ]);
  const mtdBy = new Map(
    mtdRows.map((r) => [
      r.employeeId,
      {
        taxable: toUgx(r._sum.taxable ?? 0n),
        payeWithheld: toUgx(r._sum.paye ?? 0n),
        gross: toUgx(r._sum.gross ?? 0n),
      },
    ]),
  );

  const results: Array<{
    employeeId: string;
    snapshot: RunEmployeeSnapshot;
    result: EngineResult;
  }> = [];
  const errors: RunError[] = [];

  // Labels for earlier runs that adjustment inputs correct (shown in line notes).
  const adjustsIds = [
    ...new Set(inputs.map((i) => i.adjustsRunId).filter((x): x is string => !!x)),
  ];
  const adjustsRuns = adjustsIds.length
    ? await db.payrollRun.findMany({
        where: { id: { in: adjustsIds } },
        select: {
          id: true,
          payGroup: { select: { name: true } },
          period: { select: { startDate: true, endDate: true } },
        },
      })
    : [];
  const adjustsLabel = new Map(
    adjustsRuns.map((r) => [
      r.id,
      `${r.payGroup.name} run ${formatIsoDate(toIsoDate(r.period.startDate))} – ${formatIsoDate(toIsoDate(r.period.endDate))}`,
    ]),
  );

  for (const e of employees) {
    const name = fullName(e);
    try {
      const loans = await activeLoanDeductions(db, e.id, period.endDate);
      const built = buildEngineInput({
        period: {
          start,
          end,
          payDate,
          frequency: payGroup.frequency,
          isLastCycleOfMonth: lastCycle,
        },
        employee: {
          id: e.id,
          residency: e.residency,
          hireDate: toIsoDate(e.hireDate),
          exitDate: e.exitDate ? toIsoDate(e.exitDate) : null,
          payeApplicable: e.payeApplicable,
          nssfApplicable: e.nssfApplicable,
          lstApplicable: e.lstApplicable,
        },
        components,
        assignments: e.components.map((a) => ({
          componentId: a.componentId,
          amount: a.amount === null ? null : toUgx(a.amount),
          rateBp: a.rateBp,
          ratePerUnit: a.ratePerUnit === null ? null : toUgx(a.ratePerUnit),
          effectiveFrom: toIsoDate(a.effectiveFrom),
          effectiveTo: a.effectiveTo ? toIsoDate(a.effectiveTo) : null,
        })),
        inputs: inputs
          .filter((i) => i.employeeId === e.id)
          .map((i) => ({
            componentId: i.componentId,
            quantity: i.quantity === null ? null : i.quantity.toNumber(),
            amount: i.amount === null ? null : toUgx(i.amount),
            note: i.note,
            adjustsLabel: i.adjustsRunId ? (adjustsLabel.get(i.adjustsRunId) ?? null) : null,
          })),
        loans: loans.map((l) => ({ loanId: l.loanId, code: l.code, amount: l.amount })),
        carryForwards: carryForwards
          .filter((cf) => cf.employeeId === e.id)
          .map((cf) => ({ id: cf.id, componentCode: cf.componentCode, amount: toUgx(cf.amount) })),
        monthToDate: mtdBy.get(e.id) ?? { taxable: 0, payeWithheld: 0, gross: 0 },
        rules: {
          payeRes: rules.paye.RES,
          payeNonRes: rules.paye.NONRES,
          nssf: rules.nssf,
          lst: rules.lst,
          lstMonths: rules.lstMonths ?? null,
        },
        settings: { minNetPayBp: settings.minNetPayBp },
      });
      const result = calculateEmployee(built.input);
      result.warnings.push(...built.notes);
      for (const line of result.lines) {
        const extra = built.lineNotes[line.code];
        if (extra) line.note = line.note ? `${extra} (${line.note})` : extra;
      }
      const bank = e.bankAccounts[0];
      if (!bank) result.warnings.push('NO_ACTIVE_BANK_ACCOUNT');
      results.push({
        employeeId: e.id,
        result,
        snapshot: {
          input: built.input,
          employee: {
            staffNo: e.staffNo,
            name,
            firstName: e.firstName,
            lastName: e.lastName,
            jobTitle: e.jobTitle,
            grade: e.grade,
            department: e.department?.name ?? null,
            costCentreCode: e.department?.costCentreCode ?? null,
            tin: e.tin,
            nssfNo: e.nssfNo,
            hireDate: toIsoDate(e.hireDate),
            exitDate: e.exitDate ? toIsoDate(e.exitDate) : null,
            bank: bank
              ? {
                  accountId: bank.id,
                  bankId: bank.bankId,
                  bankName: bank.bank.name,
                  kind: bank.bank.kind,
                  branchCode: bank.branchCode,
                  accountName: bank.accountName,
                  last4: bank.accountNoLast4,
                }
              : null,
          },
          carryForwardIds: built.carryForwardIds,
          carryForwardOut: result.carryForward,
          componentNames,
        },
      });
    } catch (err) {
      errors.push({ employeeId: e.id, staffNo: e.staffNo, name, message: errorMessage(err) });
    }
  }

  const totals = sumTotals(
    results.map((r): EmployeeAmounts => r.result),
    errors,
  );

  await db.$transaction(
    async (tx) => {
      const fresh = await tx.payrollRun.findUniqueOrThrow({ where: { id: run.id } });
      if (!isEditable(fresh.status as RunStatus)) {
        throw new RunActionError('The run changed while computing. Reload and try again.');
      }
      await tx.payrollLine.deleteMany({ where: { runEmployee: { runId: run.id } } });
      await tx.payrollRunEmployee.deleteMany({ where: { runId: run.id } });
      for (const r of results) {
        const res = r.result;
        const created = await tx.payrollRunEmployee.create({
          data: {
            runId: run.id,
            employeeId: r.employeeId,
            snapshot: r.snapshot as unknown as Prisma.InputJsonValue,
            gross: fromUgx(res.gross),
            taxable: fromUgx(res.taxable),
            nssfBase: fromUgx(res.nssfBase),
            paye: fromUgx(res.paye),
            nssfEmployee: fromUgx(res.nssfEmployee),
            nssfEmployer: fromUgx(res.nssfEmployer),
            lst: fromUgx(res.lst),
            otherDeductions: fromUgx(res.otherDeductions),
            net: fromUgx(res.net),
            employerCost: fromUgx(res.employerCost),
            warnings: res.warnings,
          },
        });
        if (res.lines.length) {
          await tx.payrollLine.createMany({
            data: res.lines.map((l) => ({
              runEmployeeId: created.id,
              code: l.code,
              kind: l.kind,
              quantity: l.quantity === null ? null : new Prisma.Decimal(l.quantity.toFixed(2)),
              rate: l.rate === null ? null : BigInt(l.rate),
              amount: fromUgx(l.amount),
              note: l.note.slice(0, 500),
            })),
          });
        }
      }
      try {
        await tx.payrollRun.update({
          where: { id: run.id },
          data: {
            status: 'COMPUTED',
            computedById: actorId,
            computedAt: new Date(),
            totals: totals as unknown as Prisma.InputJsonValue,
            ruleVersionIds: rules.versionIds,
          },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new RunActionError(
            'Another open run already exists for this period. Delete or finish it first.',
          );
        }
        throw e;
      }
      await withAudit(tx, {
        actorId,
        action: 'PAYROLL_RUN_COMPUTED',
        entity: 'PayrollRun',
        entityId: run.id,
        before: { status: fresh.status },
        after: {
          status: 'COMPUTED',
          headcount: totals.headcount,
          gross: totals.gross,
          net: totals.net,
          errors: totals.errors.length,
          ruleVersionIds: rules.versionIds,
        },
        ip,
      });
    },
    { timeout: 120_000, maxWait: 10_000 },
  );

  return totals;
}
