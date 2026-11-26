import type { Prisma, PrismaClient, RunStatus } from '@prisma/client';
import { toUgx } from '@/lib/money';
import {
  bankSummary,
  paymentResultsReport,
  departmentCost,
  loanBalances,
  lstSchedule,
  nssfSchedule,
  payeReturn,
  payrollRegister,
} from './aggregate';
import { describeSelection, payDateRange, type Selection } from './range';
import type { ReportKey, ReportRow, ReportTable } from './types';

/** Runs that count as final for reporting. */
export const FINAL_STATUSES: readonly RunStatus[] = ['APPROVED', 'EXPORTED', 'PAID', 'LOCKED'];
/** Statuses included when "include draft" is ticked (rejected runs never count). */
export const DRAFT_STATUSES: readonly RunStatus[] = ['DRAFT', 'COMPUTED', 'SUBMITTED'];

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function runWhere(s: Selection, today: string): Prisma.PayrollRunWhereInput {
  const statuses = s.includeDraft ? [...FINAL_STATUSES, ...DRAFT_STATUSES] : [...FINAL_STATUSES];
  const where: Prisma.PayrollRunWhereInput = { status: { in: statuses } };
  if (s.mode === 'runs') {
    where.id = { in: s.runIds.length ? s.runIds : ['__none__'] };
  } else {
    const range = payDateRange(s, today)!;
    where.period = { payDate: { gte: new Date(range.from), lte: new Date(range.to) } };
  }
  return where;
}

export async function loadReportRows(
  client: PrismaClient,
  s: Selection,
  today: string,
): Promise<{ rows: ReportRow[]; runCount: number; draftRunCount: number }> {
  const runs = await client.payrollRun.findMany({
    where: runWhere(s, today),
    select: {
      id: true,
      status: true,
      period: { select: { payDate: true } },
      payGroup: { select: { name: true } },
      employees: {
        include: {
          lines: { select: { code: true, kind: true, amount: true } },
          employee: {
            select: {
              staffNo: true,
              firstName: true,
              lastName: true,
              otherNames: true,
              tin: true,
              nssfNo: true,
              lstDistrict: true,
              department: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  const rows: ReportRow[] = [];
  for (const run of runs) {
    for (const re of run.employees) {
      const e = re.employee;
      rows.push({
        runId: run.id,
        payDate: iso(run.period.payDate),
        payGroup: run.payGroup.name,
        employeeId: re.employeeId,
        staffNo: e.staffNo,
        name: [e.firstName, e.otherNames, e.lastName].filter(Boolean).join(' '),
        tin: e.tin,
        nssfNo: e.nssfNo,
        department: e.department?.name ?? null,
        lstDistrict: e.lstDistrict,
        gross: toUgx(re.gross),
        taxable: toUgx(re.taxable),
        nssfBase: toUgx(re.nssfBase),
        paye: toUgx(re.paye),
        nssfEmployee: toUgx(re.nssfEmployee),
        nssfEmployer: toUgx(re.nssfEmployer),
        lst: toUgx(re.lst),
        otherDeductions: toUgx(re.otherDeductions),
        net: toUgx(re.net),
        employerCost: toUgx(re.employerCost),
        lines: re.lines.map((l) => ({ code: l.code, kind: l.kind, amount: toUgx(l.amount) })),
      });
    }
  }
  return {
    rows,
    runCount: runs.length,
    draftRunCount: runs.filter((r) => DRAFT_STATUSES.includes(r.status)).length,
  };
}

/** Build any report for a selection. Loans ignore the selection (they are a current snapshot). */
export async function buildReport(
  client: PrismaClient,
  key: ReportKey,
  s: Selection,
  today: string,
): Promise<ReportTable & { runCount: number; draftRunCount: number }> {
  const subtitle = describeSelection(s, today);

  if (key === 'loans') {
    const [loans, cfs] = await Promise.all([
      client.loan.findMany({
        where: { status: 'ACTIVE' },
        include: { employee: { select: { staffNo: true, firstName: true, lastName: true } } },
      }),
      client.carryForward.findMany({
        where: { settledInRunId: null },
        include: {
          employee: { select: { staffNo: true, firstName: true, lastName: true } },
          fromRun: { select: { period: { select: { payDate: true } } } },
        },
      }),
    ]);
    const t = loanBalances(
      loans.map((l) => ({
        staffNo: l.employee.staffNo,
        name: `${l.employee.firstName} ${l.employee.lastName}`,
        type: l.type,
        principal: toUgx(l.principal),
        installment: toUgx(l.installment),
        balance: toUgx(l.balance),
        status: l.status,
      })),
      cfs.map((c) => ({
        staffNo: c.employee.staffNo,
        name: `${c.employee.firstName} ${c.employee.lastName}`,
        componentCode: c.componentCode,
        amount: toUgx(c.amount),
        fromPayDate: iso(c.fromRun.period.payDate),
      })),
    );
    return { ...t, subtitle: `Current balances as of ${today}`, runCount: 0, draftRunCount: 0 };
  }

  if (key === 'banks') {
    const exports = await client.bankExport.findMany({
      where: { run: runWhere(s, today) },
      include: {
        bank: { select: { name: true, kind: true } },
        run: { select: { period: { select: { payDate: true } } } },
      },
    });
    const runIds = new Set(exports.map((e) => e.runId));
    const t = bankSummary(
      exports.map((e) => ({
        runId: e.runId,
        payDate: iso(e.run.period.payDate),
        bankName: e.bank.name,
        kind: e.bank.kind,
        reissue: e.isReissue,
        version: e.version,
        status: e.status,
        rowCount: e.rowCount,
        totalAmount: toUgx(e.totalAmount),
      })),
    );
    return { ...t, subtitle, runCount: runIds.size, draftRunCount: 0 };
  }

  if (key === 'payments') {
    const runs = await client.payrollRun.findMany({
      where: { ...runWhere(s, today), status: { in: [...FINAL_STATUSES] } },
      select: {
        id: true,
        payGroup: { select: { name: true } },
        period: { select: { payDate: true } },
        employees: {
          select: {
            id: true,
            net: true,
            employee: {
              select: {
                bankAccounts: {
                  where: { isActive: true },
                  take: 1,
                  select: { bank: { select: { name: true, kind: true } } },
                },
              },
            },
            paymentResults: {
              select: {
                status: true,
                uploadedAt: true,
                bankExport: { select: { bank: { select: { name: true, kind: true } } } },
              },
            },
          },
        },
      },
    });
    const records = runs.flatMap((run) =>
      run.employees
        .filter((re) => toUgx(re.net) > 0)
        .map((re) => {
          const last = [...re.paymentResults].sort(
            (a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime(),
          )[0];
          const bank = last?.bankExport.bank ?? re.employee.bankAccounts[0]?.bank ?? null;
          return {
            runId: run.id,
            payDate: iso(run.period.payDate),
            payGroup: run.payGroup.name,
            institution: bank?.name ?? 'No active account',
            kind: bank?.kind ?? null,
            net: toUgx(re.net),
            status: last?.status ?? null,
          };
        }),
    );
    const t = paymentResultsReport(records);
    return { ...t, subtitle, runCount: runs.length, draftRunCount: 0 };
  }

  const { rows, runCount, draftRunCount } = await loadReportRows(client, s, today);
  const table =
    key === 'register'
      ? payrollRegister(rows, { groupByDepartment: s.groupByDepartment })
      : key === 'paye'
        ? payeReturn(rows)
        : key === 'nssf'
          ? nssfSchedule(rows)
          : key === 'lst'
            ? lstSchedule(rows)
            : departmentCost(rows);
  return { ...table, subtitle, runCount, draftRunCount };
}
