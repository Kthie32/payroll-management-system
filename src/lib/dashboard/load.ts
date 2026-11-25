import type { PrismaClient } from '@prisma/client';
import { toUgx, type Ugx } from '@/lib/money';
import { FINAL_STATUSES } from '@/lib/reports/load';
import { buildTrend, ruleStatuses, trendStartMonth, type RuleStatus, type TrendPoint } from './summary';

export interface DashboardData {
  activeEmployees: number;
  missingBankAccounts: number;
  lastRun: {
    id: string;
    payGroup: string;
    payDate: string;
    status: string;
    gross: Ugx;
    net: Ugx;
    headcount: number;
  } | null;
  nextPayDate: { payDate: string; payGroup: string } | null;
  awaitingApproval: number;
  inPreparation: number;
  awaitingExport: number;
  rules: RuleStatus[];
  lst: { active: boolean; bandCount: number };
  trend: TrendPoint[];
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

function bandCount(params: unknown): number {
  if (params && typeof params === 'object' && 'bands' in params && Array.isArray(params.bands)) {
    return params.bands.length;
  }
  return 0;
}

/** Everything the dashboard shows. Safe on an empty database. `today` is an ISO date. */
export async function loadDashboard(client: PrismaClient, today: string): Promise<DashboardData> {
  const todayDate = new Date(`${today}T00:00:00Z`);
  const endMonth = today.slice(0, 7);
  const trendFrom = new Date(`${trendStartMonth(endMonth)}-01T00:00:00Z`);

  const [
    activeEmployees,
    missingBankAccounts,
    lastRunRow,
    nextPeriod,
    awaitingApproval,
    inPreparation,
    awaitingExport,
    ruleRows,
    trendRuns,
  ] = await Promise.all([
    client.employee.count({ where: { status: 'ACTIVE' } }),
    client.employee.count({ where: { status: 'ACTIVE', bankAccounts: { none: { isActive: true } } } }),
    client.payrollRun.findFirst({
      where: { status: { in: [...FINAL_STATUSES] } },
      orderBy: [{ period: { payDate: 'desc' } }, { approvedAt: 'desc' }],
      include: { period: true, payGroup: true },
    }),
    client.payPeriod.findFirst({
      where: {
        payDate: { gte: todayDate },
        runs: { none: { status: { in: [...FINAL_STATUSES] } } },
      },
      orderBy: { payDate: 'asc' },
      include: { payGroup: true },
    }),
    client.payrollRun.count({ where: { status: 'SUBMITTED' } }),
    client.payrollRun.count({ where: { status: { in: ['DRAFT', 'COMPUTED', 'REJECTED'] } } }),
    client.payrollRun.count({ where: { status: 'APPROVED' } }),
    client.statutoryRuleVersion.findMany({
      select: {
        rule: true,
        active: true,
        approvedById: true,
        effectiveFrom: true,
        effectiveTo: true,
        params: true,
      },
    }),
    client.payrollRun.findMany({
      where: { status: { in: [...FINAL_STATUSES] }, period: { payDate: { gte: trendFrom } } },
      select: { id: true, period: { select: { payDate: true } } },
    }),
  ]);

  const runIds = [...trendRuns.map((r) => r.id), ...(lastRunRow ? [lastRunRow.id] : [])];
  const sums = runIds.length
    ? await client.payrollRunEmployee.groupBy({
        by: ['runId'],
        where: { runId: { in: runIds } },
        _sum: { gross: true, net: true },
        _count: { _all: true },
      })
    : [];
  const sumByRun = new Map(sums.map((s) => [s.runId, s]));
  const sumOf = (runId: string) => {
    const s = sumByRun.get(runId);
    return {
      gross: toUgx(s?._sum.gross ?? 0n),
      net: toUgx(s?._sum.net ?? 0n),
      headcount: s?._count._all ?? 0,
    };
  };

  const versions = ruleRows.map((r) => ({
    rule: r.rule,
    active: r.active,
    approved: Boolean(r.approvedById),
    effectiveFrom: iso(r.effectiveFrom),
    effectiveTo: r.effectiveTo ? iso(r.effectiveTo) : null,
  }));
  const lstRow = ruleRows
    .filter((r) => r.rule === 'LST' && r.active && r.approvedById && iso(r.effectiveFrom) <= today)
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];

  return {
    activeEmployees,
    missingBankAccounts,
    lastRun: lastRunRow
      ? {
          id: lastRunRow.id,
          payGroup: lastRunRow.payGroup.name,
          payDate: iso(lastRunRow.period.payDate),
          status: lastRunRow.status,
          ...sumOf(lastRunRow.id),
        }
      : null,
    nextPayDate: nextPeriod
      ? { payDate: iso(nextPeriod.payDate), payGroup: nextPeriod.payGroup.name }
      : null,
    awaitingApproval,
    inPreparation,
    awaitingExport,
    rules: ruleStatuses(versions, ['PAYE_RES', 'NSSF'], today),
    lst: { active: Boolean(lstRow), bandCount: lstRow ? bandCount(lstRow.params) : 0 },
    trend: buildTrend(
      trendRuns.map((r) => ({ payDate: iso(r.period.payDate), ...sumOf(r.id) })),
      endMonth,
    ),
  };
}

/** Today's date in Kampala (UTC+3, no DST) as YYYY-MM-DD. */
export function kampalaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Kampala',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
