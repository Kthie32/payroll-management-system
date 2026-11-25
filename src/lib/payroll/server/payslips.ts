import 'server-only';
import { db } from '@/lib/db';
import { toUgx, type Ugx } from '@/lib/money';
import { LINE_CODES } from '@/lib/payroll-engine';
import { getSettings, type CompanyDetails } from '@/lib/settings/general';
import { financialYearStart, fromIsoDate, toIsoDate } from '../dates';
import { displayCode, parseLoanLineCode } from '../loan-codes';
import { isPosted, POSTED_STATUSES, type RunStatus } from '../status';
import type { RunEmployeeSnapshot } from './compute';

export interface PayslipLine {
  code: string;
  label: string;
  quantity: number | null;
  rate: number | null;
  amount: Ugx;
  note: string;
}

export interface PayslipView {
  company: CompanyDetails;
  footer: string;
  runId: string;
  status: RunStatus;
  isDraft: boolean;
  payGroup: string;
  period: { start: string; end: string; payDate: string };
  employeeId: string;
  employee: RunEmployeeSnapshot['employee'];
  earnings: PayslipLine[];
  statutory: PayslipLine[];
  deductions: PayslipLine[];
  employer: PayslipLine[];
  gross: Ugx;
  totalDeductions: Ugx;
  net: Ugx;
  employerCost: Ugx;
  ytd: { gross: Ugx; paye: Ugx; nssfEmployee: Ugx; lst: Ugx; net: Ugx };
}

const STATUTORY_LABELS: Record<string, string> = {
  [LINE_CODES.PAYE]: 'PAYE',
  [LINE_CODES.NSSF_EMPLOYEE]: 'NSSF (employee)',
  [LINE_CODES.NSSF_EMPLOYER]: 'NSSF (employer)',
  [LINE_CODES.LST]: 'Local Service Tax',
};

export function lineLabel(code: string, names: Record<string, string>): string {
  if (STATUTORY_LABELS[code]) return STATUTORY_LABELS[code];
  const base = displayCode(code);
  const name = names[base] ?? base;
  return parseLoanLineCode(code) ? `${name} (loan repayment)` : name;
}

/**
 * Loads payslips for a run (all employees, or one). Draft (not yet approved) runs are returned
 * with `isDraft` so the UI can watermark them. YTD covers the financial year (1 July – 30 June) of
 * the pay date: approved-or-later runs up to this pay date, plus this run.
 */
export async function loadPayslips(runId: string, employeeId?: string): Promise<PayslipView[]> {
  const run = await db.payrollRun.findUnique({
    where: { id: runId },
    include: { period: true, payGroup: true },
  });
  if (!run) return [];
  const rows = await db.payrollRunEmployee.findMany({
    where: { runId, ...(employeeId ? { employeeId } : {}) },
    // cuids generated in one createMany are monotonic, so id order is the engine's line order.
    include: { lines: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
  });
  if (rows.length === 0) return [];
  const settings = await getSettings(db);
  const payDate = toIsoDate(run.period.payDate);

  const ytdRows = await db.payrollRunEmployee.groupBy({
    by: ['employeeId'],
    where: {
      employeeId: { in: rows.map((r) => r.employeeId) },
      runId: { not: run.id },
      run: {
        status: { in: [...POSTED_STATUSES] },
        period: { payDate: { gte: fromIsoDate(financialYearStart(payDate)), lte: run.period.payDate } },
      },
    },
    _sum: { gross: true, paye: true, nssfEmployee: true, lst: true, net: true },
  });
  const ytdBy = new Map(ytdRows.map((r) => [r.employeeId, r._sum]));

  const status = run.status as RunStatus;
  const views = rows.map((re): PayslipView => {
    const snap = re.snapshot as unknown as RunEmployeeSnapshot;
    const names = snap.componentNames ?? {};
    const lines = re.lines.map(
      (l): PayslipLine & { kind: string } => ({
        kind: l.kind,
        code: l.code,
        label: lineLabel(l.code, names),
        quantity: l.quantity === null ? null : l.quantity.toNumber(),
        rate: l.rate === null ? null : Number(l.rate),
        amount: toUgx(l.amount),
        note: l.note,
      }),
    );
    const strip = ({ kind: _k, ...rest }: PayslipLine & { kind: string }): PayslipLine => rest;
    const prior = ytdBy.get(re.employeeId);
    const gross = toUgx(re.gross);
    const paye = toUgx(re.paye);
    const nssfEmployee = toUgx(re.nssfEmployee);
    const lst = toUgx(re.lst);
    const net = toUgx(re.net);
    return {
      company: settings.company,
      footer: settings.payslipFooter,
      runId: run.id,
      status,
      isDraft: !isPosted(status),
      payGroup: run.payGroup.name,
      period: { start: toIsoDate(run.period.startDate), end: toIsoDate(run.period.endDate), payDate },
      employeeId: re.employeeId,
      employee: snap.employee,
      earnings: lines.filter((l) => l.kind === 'EARNING').map(strip),
      statutory: lines.filter((l) => l.kind === 'STATUTORY').map(strip),
      deductions: lines.filter((l) => l.kind === 'DEDUCTION' && l.amount > 0).map(strip),
      employer: lines.filter((l) => l.kind === 'EMPLOYER').map(strip),
      gross,
      totalDeductions: gross - net,
      net,
      employerCost: toUgx(re.employerCost),
      ytd: {
        gross: gross + toUgx(prior?.gross ?? 0n),
        paye: paye + toUgx(prior?.paye ?? 0n),
        nssfEmployee: nssfEmployee + toUgx(prior?.nssfEmployee ?? 0n),
        lst: lst + toUgx(prior?.lst ?? 0n),
        net: net + toUgx(prior?.net ?? 0n),
      },
    };
  });
  return views.sort((a, b) => a.employee.staffNo.localeCompare(b.employee.staffNo));
}
