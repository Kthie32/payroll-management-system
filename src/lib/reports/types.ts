import type { Ugx } from '@/lib/money';

/** One employee's result in one run, normalised for reporting (money already integer UGX). */
export interface ReportRow {
  runId: string;
  payDate: string; // YYYY-MM-DD
  payGroup: string;
  employeeId: string;
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
  otherDeductions: Ugx;
  net: Ugx;
  employerCost: Ugx;
  lines: { code: string; kind: string; amount: Ugx }[];
}

export type ColumnType = 'text' | 'money' | 'number';

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
}

export type ReportValue = string | number | null;

/** A rendered report: on screen, CSV and XLSX all come from this one shape. */
export interface ReportTable {
  title: string;
  subtitle?: string;
  columns: ReportColumn[];
  rows: Record<string, ReportValue>[];
  /** Optional group label per row index (e.g. department), rendered as section headings. */
  groupBy?: string;
  totals?: Record<string, ReportValue>;
  notes?: string[];
}

export const REPORT_KEYS = [
  'register',
  'paye',
  'nssf',
  'lst',
  'departments',
  'banks',
  'loans',
] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

export const REPORT_META: Record<ReportKey, { title: string; description: string }> = {
  register: {
    title: 'Payroll register',
    description: 'Every employee: earnings by component, statutory deductions, other deductions and net pay.',
  },
  paye: {
    title: 'PAYE return summary (URA)',
    description: 'Per employee TIN, gross, taxable pay and PAYE withheld, with totals.',
  },
  nssf: {
    title: 'NSSF schedule',
    description: 'Per employee NSSF number, contribution base, 5% employee, 10% employer and total.',
  },
  lst: {
    title: 'LST schedule by district',
    description: 'Local Service Tax deducted, grouped by the employee’s LST district.',
  },
  departments: {
    title: 'Department cost summary',
    description: 'Headcount, gross pay, employer NSSF and total employer cost per department.',
  },
  banks: {
    title: 'Bank payment summary',
    description: 'Totals per bank from the generated bank files (latest version per bank and run).',
  },
  loans: {
    title: 'Loans and carry-forward balances',
    description: 'Outstanding loans and advances, plus deductions carried forward and not yet settled.',
  },
};
