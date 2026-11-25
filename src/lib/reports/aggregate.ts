import type { Ugx } from '@/lib/money';
import type { ReportColumn, ReportRow, ReportTable, ReportValue } from './types';

function money(key: string, label: string): ReportColumn {
  return { key, label, type: 'money' };
}
function text(key: string, label: string): ReportColumn {
  return { key, label, type: 'text' };
}

function sumColumns(
  rows: Record<string, ReportValue>[],
  columns: ReportColumn[],
  labelKey: string,
  label = 'TOTAL',
): Record<string, ReportValue> {
  const totals: Record<string, ReportValue> = { [labelKey]: label };
  for (const c of columns) {
    if (c.type === 'text') continue;
    totals[c.key] = rows.reduce(
      (s, r) => s + (typeof r[c.key] === 'number' ? (r[c.key] as number) : 0),
      0,
    );
  }
  return totals;
}

function byText(a: string | null, b: string | null): number {
  return (a ?? '').localeCompare(b ?? '');
}

/** Earning codes present in the data, in first-seen order after sorting by code for stability. */
export function earningCodes(rows: readonly ReportRow[]): string[] {
  const codes = new Set<string>();
  for (const r of rows) for (const l of r.lines) if (l.kind === 'EARNING') codes.add(l.code);
  return [...codes].sort((a, b) => (a === 'BASIC' ? -1 : b === 'BASIC' ? 1 : a.localeCompare(b)));
}

/**
 * Per-employee register. With several runs an employee appears once per run (one row per payslip).
 * Grouped by department when asked.
 */
export function payrollRegister(
  rows: readonly ReportRow[],
  opts: { groupByDepartment?: boolean } = {},
): ReportTable {
  const codes = earningCodes(rows);
  const columns: ReportColumn[] = [
    text('payDate', 'Pay date'),
    text('staffNo', 'Staff no.'),
    text('name', 'Name'),
    text('department', 'Department'),
    ...codes.map((c) => money(`e_${c}`, c)),
    money('gross', 'Gross'),
    money('paye', 'PAYE'),
    money('nssfEmployee', 'NSSF 5%'),
    money('lst', 'LST'),
    money('otherDeductions', 'Other deductions'),
    money('net', 'Net pay'),
    money('nssfEmployer', 'NSSF 10% (employer)'),
    money('employerCost', 'Employer cost'),
  ];

  const sorted = [...rows].sort(
    (a, b) =>
      (opts.groupByDepartment ? byText(a.department, b.department) : 0) ||
      a.payDate.localeCompare(b.payDate) ||
      a.staffNo.localeCompare(b.staffNo),
  );

  const out = sorted.map((r) => {
    const row: Record<string, ReportValue> = {
      payDate: r.payDate,
      staffNo: r.staffNo,
      name: r.name,
      department: r.department ?? 'Unassigned',
      gross: r.gross,
      paye: r.paye,
      nssfEmployee: r.nssfEmployee,
      lst: r.lst,
      otherDeductions: r.otherDeductions,
      net: r.net,
      nssfEmployer: r.nssfEmployer,
      employerCost: r.employerCost,
    };
    for (const c of codes) row[`e_${c}`] = 0;
    for (const l of r.lines) {
      if (l.kind === 'EARNING') row[`e_${l.code}`] = (row[`e_${l.code}`] as number) + l.amount;
    }
    return row;
  });

  return {
    title: 'Payroll register',
    columns,
    rows: out,
    groupBy: opts.groupByDepartment ? 'department' : undefined,
    totals: sumColumns(out, columns, 'payDate'),
  };
}

interface EmployeeAgg {
  staffNo: string;
  name: string;
  tin: string | null;
  nssfNo: string | null;
  department: string | null;
  lstDistrict: string | null;
  gross: Ugx;
  taxable: Ugx;
  nssfBase: Ugx;
  paye: Ugx;
  nssfEmployee: Ugx;
  nssfEmployer: Ugx;
  lst: Ugx;
}

/** Sum each employee across all selected runs (latest identity fields win). */
export function perEmployee(rows: readonly ReportRow[]): EmployeeAgg[] {
  const map = new Map<string, EmployeeAgg>();
  for (const r of [...rows].sort((a, b) => a.payDate.localeCompare(b.payDate))) {
    const a = map.get(r.employeeId) ?? {
      staffNo: r.staffNo,
      name: r.name,
      tin: r.tin,
      nssfNo: r.nssfNo,
      department: r.department,
      lstDistrict: r.lstDistrict,
      gross: 0,
      taxable: 0,
      nssfBase: 0,
      paye: 0,
      nssfEmployee: 0,
      nssfEmployer: 0,
      lst: 0,
    };
    Object.assign(a, {
      staffNo: r.staffNo,
      name: r.name,
      tin: r.tin,
      nssfNo: r.nssfNo,
      department: r.department,
      lstDistrict: r.lstDistrict,
    });
    a.gross += r.gross;
    a.taxable += r.taxable;
    a.nssfBase += r.nssfBase;
    a.paye += r.paye;
    a.nssfEmployee += r.nssfEmployee;
    a.nssfEmployer += r.nssfEmployer;
    a.lst += r.lst;
    map.set(r.employeeId, a);
  }
  return [...map.values()].sort((a, b) => a.staffNo.localeCompare(b.staffNo));
}

export function payeReturn(rows: readonly ReportRow[]): ReportTable {
  const columns: ReportColumn[] = [
    text('tin', 'TIN'),
    text('staffNo', 'Staff no.'),
    text('name', 'Employee name'),
    money('gross', 'Gross emoluments'),
    money('taxable', 'Chargeable income'),
    money('paye', 'PAYE withheld'),
  ];
  const agg = perEmployee(rows);
  const out = agg.map((e) => ({
    tin: e.tin ?? '',
    staffNo: e.staffNo,
    name: e.name,
    gross: e.gross,
    taxable: e.taxable,
    paye: e.paye,
  }));
  const missingTin = agg.filter((e) => !e.tin && e.paye > 0).length;
  return {
    title: 'PAYE return summary',
    columns,
    rows: out,
    totals: sumColumns(out, columns, 'tin'),
    notes: [
      'TODO-confirm: column layout against the current URA PAYE return template before filing.',
      ...(missingTin ? [`${missingTin} employee(s) with PAYE have no TIN recorded.`] : []),
    ],
  };
}

export function nssfSchedule(rows: readonly ReportRow[]): ReportTable {
  const columns: ReportColumn[] = [
    text('nssfNo', 'NSSF no.'),
    text('staffNo', 'Staff no.'),
    text('name', 'Employee name'),
    money('nssfBase', 'Contribution base'),
    money('nssfEmployee', 'Employee 5%'),
    money('nssfEmployer', 'Employer 10%'),
    money('total', 'Total 15%'),
  ];
  const agg = perEmployee(rows).filter((e) => e.nssfEmployee > 0 || e.nssfEmployer > 0);
  const out = agg.map((e) => ({
    nssfNo: e.nssfNo ?? '',
    staffNo: e.staffNo,
    name: e.name,
    nssfBase: e.nssfBase,
    nssfEmployee: e.nssfEmployee,
    nssfEmployer: e.nssfEmployer,
    total: e.nssfEmployee + e.nssfEmployer,
  }));
  const missing = agg.filter((e) => !e.nssfNo).length;
  return {
    title: 'NSSF schedule',
    columns,
    rows: out,
    totals: sumColumns(out, columns, 'nssfNo'),
    notes: [
      'TODO-confirm: column layout against the NSSF e-return template before submission.',
      ...(missing ? [`${missing} contributing employee(s) have no NSSF number recorded.`] : []),
    ],
  };
}

export function lstSchedule(rows: readonly ReportRow[]): ReportTable {
  const columns: ReportColumn[] = [
    text('district', 'District'),
    text('staffNo', 'Staff no.'),
    text('name', 'Employee name'),
    money('lst', 'LST deducted'),
  ];
  const agg = perEmployee(rows).filter((e) => e.lst > 0);
  const out = agg
    .map((e) => ({
      district: e.lstDistrict ?? 'Not set',
      staffNo: e.staffNo,
      name: e.name,
      lst: e.lst,
    }))
    .sort((a, b) => a.district.localeCompare(b.district) || a.staffNo.localeCompare(b.staffNo));
  return {
    title: 'LST schedule by district',
    columns,
    rows: out,
    groupBy: 'district',
    totals: sumColumns(out, columns, 'district'),
  };
}

export function departmentCost(rows: readonly ReportRow[]): ReportTable {
  const columns: ReportColumn[] = [
    text('department', 'Department'),
    { key: 'headcount', label: 'Employees', type: 'number' },
    money('gross', 'Gross pay'),
    money('nssfEmployer', 'Employer NSSF'),
    money('otherEmployer', 'Other employer costs'),
    money('employerCost', 'Total employer cost'),
  ];
  const map = new Map<
    string,
    { ids: Set<string>; gross: Ugx; nssfEmployer: Ugx; employerCost: Ugx }
  >();
  for (const r of rows) {
    const key = r.department ?? 'Unassigned';
    const d = map.get(key) ?? {
      ids: new Set<string>(),
      gross: 0,
      nssfEmployer: 0,
      employerCost: 0,
    };
    d.ids.add(r.employeeId);
    d.gross += r.gross;
    d.nssfEmployer += r.nssfEmployer;
    d.employerCost += r.employerCost;
    map.set(key, d);
  }
  const out = [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([department, d]) => ({
      department,
      headcount: d.ids.size,
      gross: d.gross,
      nssfEmployer: d.nssfEmployer,
      otherEmployer: d.employerCost - d.gross - d.nssfEmployer,
      employerCost: d.employerCost,
    }));
  const totals = sumColumns(out, columns, 'department');
  totals.headcount = new Set(rows.map((r) => r.employeeId)).size;
  return { title: 'Department cost summary', columns, rows: out, totals };
}

export interface BankExportRecord {
  runId: string;
  payDate: string;
  bankName: string;
  /** BANK or MOBILE_MONEY (defaults to BANK). */
  kind?: 'BANK' | 'MOBILE_MONEY';
  version: number;
  status: 'GENERATED' | 'SUPERSEDED' | 'SENT';
  rowCount: number;
  totalAmount: Ugx;
  /** A re-issue file re-sends only payments that failed the first time. */
  reissue?: boolean;
}

const KIND_LABEL = { BANK: 'Bank', MOBILE_MONEY: 'Mobile money' } as const;

/**
 * Totals per bank or mobile money provider. Normal files: the latest non-superseded version per
 * run and institution. Re-issue files (failed payments sent again) are added in their own column.
 */
export function bankSummary(exports: readonly BankExportRecord[]): ReportTable {
  const columns: ReportColumn[] = [
    text('bank', 'Bank / provider'),
    text('type', 'Type'),
    { key: 'files', label: 'Files', type: 'number' },
    { key: 'payees', label: 'Payees', type: 'number' },
    money('total', 'Total in files'),
    { key: 'reissuedPayees', label: 'Re-issued payees', type: 'number' },
    money('reissued', 'Re-issued amount'),
  ];
  const latest = new Map<string, BankExportRecord>();
  const reissues: BankExportRecord[] = [];
  for (const e of exports) {
    if (e.status === 'SUPERSEDED') continue;
    if (e.reissue) {
      reissues.push(e);
      continue;
    }
    const k = `${e.runId}|${e.bankName}`;
    const cur = latest.get(k);
    if (!cur || e.version > cur.version) latest.set(k, e);
  }
  type Acc = {
    type: string;
    files: number;
    payees: number;
    total: Ugx;
    reissuedPayees: number;
    reissued: Ugx;
  };
  const map = new Map<string, Acc>();
  const acc = (e: BankExportRecord): Acc => {
    const cur = map.get(e.bankName) ?? {
      type: KIND_LABEL[e.kind ?? 'BANK'],
      files: 0,
      payees: 0,
      total: 0,
      reissuedPayees: 0,
      reissued: 0,
    };
    map.set(e.bankName, cur);
    return cur;
  };
  for (const e of latest.values()) {
    const b = acc(e);
    b.files += 1;
    b.payees += e.rowCount;
    b.total += e.totalAmount;
  }
  for (const e of reissues) {
    const b = acc(e);
    b.files += 1;
    b.reissuedPayees += e.rowCount;
    b.reissued += e.totalAmount;
  }
  const out = [...map.entries()]
    .sort(([a, x], [b, y]) => (x.type === y.type ? a.localeCompare(b) : x.type === 'Bank' ? -1 : 1))
    .map(([bank, b]) => ({ bank, ...b }));
  return {
    title: 'Payment summary (banks and mobile money)',
    columns,
    rows: out,
    totals: sumColumns(out, columns, 'bank'),
  };
}

export interface PaymentOutcomeRecord {
  runId: string;
  payDate: string;
  payGroup: string;
  /** Bank / provider the payee was (last) paid through. */
  institution: string;
  kind: 'BANK' | 'MOBILE_MONEY' | null;
  net: Ugx;
  /** Latest result from the bank; null if none uploaded yet. */
  status: 'PAID' | 'FAILED' | 'PENDING' | null;
}

/** Paid / failed / pending / no-result counts and amounts per run and institution. */
export function paymentResultsReport(records: readonly PaymentOutcomeRecord[]): ReportTable {
  const columns: ReportColumn[] = [
    text('payDate', 'Pay date'),
    text('payGroup', 'Pay group'),
    text('institution', 'Bank / provider'),
    text('type', 'Type'),
    { key: 'paidCount', label: 'Paid', type: 'number' },
    money('paidAmount', 'Paid amount'),
    { key: 'failedCount', label: 'Failed', type: 'number' },
    money('failedAmount', 'Failed amount'),
    { key: 'pendingCount', label: 'Pending', type: 'number' },
    { key: 'noResultCount', label: 'No result', type: 'number' },
    money('noResultAmount', 'No-result amount'),
  ];
  const map = new Map<string, Record<string, ReportValue> & { _sort: string }>();
  for (const r of records) {
    const key = `${r.payDate}|${r.runId}|${r.institution}`;
    const row =
      map.get(key) ??
      ({
        _sort: key,
        payDate: r.payDate,
        payGroup: r.payGroup,
        institution: r.institution,
        type: r.kind ? KIND_LABEL[r.kind] : '—',
        paidCount: 0,
        paidAmount: 0,
        failedCount: 0,
        failedAmount: 0,
        pendingCount: 0,
        noResultCount: 0,
        noResultAmount: 0,
      } as Record<string, ReportValue> & { _sort: string });
    const add = (k: string, n: number) => {
      row[k] = (row[k] as number) + n;
    };
    if (r.status === 'PAID') {
      add('paidCount', 1);
      add('paidAmount', r.net);
    } else if (r.status === 'FAILED') {
      add('failedCount', 1);
      add('failedAmount', r.net);
    } else if (r.status === 'PENDING') add('pendingCount', 1);
    else {
      add('noResultCount', 1);
      add('noResultAmount', r.net);
    }
    map.set(key, row);
  }
  const out = [...map.values()]
    .sort((a, b) => a._sort.localeCompare(b._sort))
    .map(({ _sort: _s, ...rest }) => rest);
  return {
    title: 'Payment results',
    columns,
    rows: out,
    totals: sumColumns(out, columns, 'payDate'),
    notes: [
      'Status is the latest result uploaded from the bank or provider; a successful re-issue replaces an earlier failure.',
    ],
  };
}

export interface LoanRecord {
  staffNo: string;
  name: string;
  type: string;
  principal: Ugx;
  installment: Ugx;
  balance: Ugx;
  status: string;
}
export interface CarryForwardRecord {
  staffNo: string;
  name: string;
  componentCode: string;
  amount: Ugx;
  fromPayDate: string;
}

export function loanBalances(
  loans: readonly LoanRecord[],
  carryForwards: readonly CarryForwardRecord[],
): ReportTable {
  const columns: ReportColumn[] = [
    text('staffNo', 'Staff no.'),
    text('name', 'Employee name'),
    text('item', 'Item'),
    text('detail', 'Detail'),
    money('principal', 'Principal'),
    money('installment', 'Instalment'),
    money('balance', 'Outstanding'),
  ];
  const out: Record<string, ReportValue>[] = [
    ...loans.map((l) => ({
      staffNo: l.staffNo,
      name: l.name,
      item: l.type,
      detail: l.status,
      principal: l.principal,
      installment: l.installment,
      balance: l.balance,
    })),
    ...carryForwards.map((c) => ({
      staffNo: c.staffNo,
      name: c.name,
      item: 'CARRY FORWARD',
      detail: `${c.componentCode} from ${c.fromPayDate}`,
      principal: null,
      installment: null,
      balance: c.amount,
    })),
  ].sort((a, b) => String(a.staffNo).localeCompare(String(b.staffNo)));
  return {
    title: 'Loans and carry-forward balances',
    columns,
    rows: out,
    totals: sumColumns(out, columns, 'staffNo'),
  };
}

/** Convert a report table to a grid for CSV/XLSX: title, header row, rows, totals. */
export function reportToGrid(t: ReportTable): {
  grid: (string | number | null)[][];
  boldRows: number[];
  moneyColumns: number[];
} {
  const grid: (string | number | null)[][] = [[t.title]];
  if (t.subtitle) grid.push([t.subtitle]);
  grid.push([]);
  const headerRow = grid.length;
  grid.push(t.columns.map((c) => c.label));
  for (const r of t.rows) grid.push(t.columns.map((c) => r[c.key] ?? null));
  const boldRows = [0, headerRow];
  if (t.totals) {
    boldRows.push(grid.length);
    grid.push(t.columns.map((c) => t.totals?.[c.key] ?? null));
  }
  for (const n of t.notes ?? []) grid.push([n]);
  const moneyColumns = t.columns.flatMap((c, i) => (c.type === 'money' ? [i] : []));
  return { grid, boldRows, moneyColumns };
}
