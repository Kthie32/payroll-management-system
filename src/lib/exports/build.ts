import { assertUgx, type Ugx } from '@/lib/money';
import type { ColumnFormat, ExportTemplateSpec } from './template';
import { toCsv, toXlsx, sha256Hex, type Cell, type Grid } from './writers';

/** One payee in a bank file. `accountNo` is the decrypted account number. */
export interface PaymentRow {
  staffNo: string;
  employeeName: string;
  accountName: string;
  accountNo: string;
  branchCode: string | null;
  amount: Ugx;
}

export interface BankFileContext {
  companyName: string;
  bankName: string;
  bankCode: string;
  batchRef: string;
  /** ISO date YYYY-MM-DD. */
  payDate: string;
  /** Human period label, e.g. "NOV 2026". */
  period: string;
}

export interface BankFile {
  bytes: Buffer;
  sha256: string;
  rowCount: number;
  totalAmount: Ugx;
  format: 'CSV' | 'XLSX';
}

export class ExportTotalsError extends Error {
  constructor(expected: number, actual: number) {
    super(`Bank file total ${actual} does not match expected net total ${expected}`);
    this.name = 'ExportTotalsError';
  }
}

export function formatDate(iso: string, format: ColumnFormat): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`Invalid ISO date: ${iso}`);
  const [, y, mo, d] = m;
  if (format === 'DATE_DMY') return `${d}/${mo}/${y}`;
  if (format === 'DATE_YMD') return `${y}${mo}${d}`;
  return `${y}-${mo}-${d}`;
}

export function formatAmount(amount: Ugx, format: ColumnFormat): string {
  assertUgx(amount);
  return format === 'DECIMAL_2' ? `${amount}.00` : String(amount);
}

function formatText(value: string, format: ColumnFormat): string {
  return format === 'UPPER' ? value.toUpperCase() : value;
}

export function applyTokens(text: string, tokens: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in tokens ? String(tokens[key]) : whole,
  );
}

/** Build the full grid (header rows, column titles, data rows, footer rows) for a bank file. */
export function buildBankGrid(
  template: ExportTemplateSpec,
  rows: readonly PaymentRow[],
  ctx: BankFileContext,
): { grid: Grid; dataRowCount: number; totalAmount: Ugx; headerRowIndexes: number[] } {
  let total = 0;
  for (const r of rows) {
    assertUgx(r.amount, `amount for ${r.staffNo}`);
    total += r.amount;
  }
  assertUgx(total, 'bank file total');

  const tokens: Record<string, string | number> = {
    companyName: ctx.companyName,
    bankName: ctx.bankName,
    bankCode: ctx.bankCode,
    batchRef: ctx.batchRef,
    payDate: ctx.payDate,
    period: ctx.period,
    count: rows.length,
    total,
  };
  const narrative = applyTokens(template.mapping.narrative, tokens);

  const grid: Grid = [];
  const headerRowIndexes: number[] = [];
  for (const r of template.headerRules.rows) grid.push(r.map((c) => applyTokens(c, tokens)));
  if (template.headerRules.includeColumnHeaders) {
    headerRowIndexes.push(grid.length);
    grid.push(template.mapping.columns.map((c) => c.header));
  }

  for (const r of rows) {
    grid.push(
      template.mapping.columns.map((col): Cell => {
        switch (col.field) {
          case 'staffNo':
            return formatText(r.staffNo, col.format);
          case 'employeeName':
            return formatText(r.employeeName, col.format);
          case 'accountName':
            return formatText(r.accountName, col.format);
          case 'accountNo':
            return r.accountNo;
          case 'branchCode':
            return formatText(r.branchCode ?? '', col.format);
          case 'bankCode':
            return formatText(ctx.bankCode, col.format);
          case 'amount':
            return formatAmount(r.amount, col.format);
          case 'narrative':
            return formatText(narrative, col.format);
          case 'payDate':
            return formatDate(ctx.payDate, col.format.startsWith('DATE_') ? col.format : 'DATE_ISO');
        }
      }),
    );
  }

  for (const r of template.footerRules.rows) grid.push(r.map((c) => applyTokens(c, tokens)));
  return { grid, dataRowCount: rows.length, totalAmount: total, headerRowIndexes };
}

/**
 * Build a bank file and its checksum. `expectedTotal` is the sum of net pay for the payees in
 * this bank; a mismatch throws, so a file that does not reconcile is never produced.
 */
export async function buildBankFile(
  template: ExportTemplateSpec,
  rows: readonly PaymentRow[],
  ctx: BankFileContext,
  expectedTotal: Ugx,
): Promise<BankFile> {
  const { grid, dataRowCount, totalAmount, headerRowIndexes } = buildBankGrid(
    template,
    rows,
    ctx,
  );
  if (totalAmount !== expectedTotal) throw new ExportTotalsError(expectedTotal, totalAmount);

  const bytes =
    template.format === 'XLSX'
      ? await toXlsx(grid, {
          sheetName: `${ctx.bankCode} ${ctx.period}`,
          timestamp: new Date(`${ctx.payDate}T00:00:00Z`),
          boldRows: headerRowIndexes,
        })
      : toCsv(grid);
  return {
    bytes,
    sha256: sha256Hex(bytes),
    rowCount: dataRowCount,
    totalAmount,
    format: template.format,
  };
}

/** Deterministic batch reference: <period>-<bank>-V<version>, e.g. 202611-STANBIC-V2. */
export function batchRef(payDate: string, bankCode: string, version: number): string {
  const yyyymm = payDate.slice(0, 7).replace('-', '');
  const bank = bankCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return `${yyyymm}-${bank}-V${version}`;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** "2026-11-28" → "NOV 2026". */
export function periodLabel(payDate: string): string {
  const [y, m] = payDate.split('-');
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
}
