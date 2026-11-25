import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { normalizeZipTimestamps } from './zip-normalize';

/** A cell in a generated file. Numbers are written as numbers in XLSX, plain digits in CSV. */
export type Cell = string | number | null;
export type Grid = Cell[][];

const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;
const FORMULA_START = /^[=+\-@\t\r]/;

export interface CsvOptions {
  /**
   * Prefix text cells that start with = + - @ with an apostrophe so spreadsheet apps do not
   * evaluate them (CSV injection). Use for reports; never for bank files, whose bytes must be exact.
   */
  guardFormulas?: boolean;
}

export function csvCell(value: Cell, opts: CsvOptions = {}): string {
  if (value === null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let s = value;
  if (opts.guardFormulas && FORMULA_START.test(s)) s = `'${s}`;
  return NEEDS_QUOTES.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180 CSV with CRLF line endings and a trailing CRLF. */
export function toCsv(grid: Grid, opts: CsvOptions = {}): Buffer {
  const text = grid.map((row) => row.map((c) => csvCell(c, opts)).join(',')).join('\r\n');
  return Buffer.from(grid.length ? `${text}\r\n` : '', 'utf8');
}

export interface XlsxOptions {
  sheetName?: string;
  /** Fixed workbook timestamp, so identical data gives identical bytes. */
  timestamp: Date;
  /** Zero-based row indexes to render bold (e.g. column headers, totals). */
  boldRows?: number[];
  /** Zero-based column indexes to format as whole-number money (#,##0). */
  moneyColumns?: number[];
}

export async function toXlsx(grid: Grid, opts: XlsxOptions): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Payroll';
  wb.lastModifiedBy = 'Payroll';
  wb.created = opts.timestamp;
  wb.modified = opts.timestamp;
  const ws = wb.addWorksheet(sanitizeSheetName(opts.sheetName ?? 'Sheet1'));
  for (const row of grid) ws.addRow(row.map((c) => (c === null ? '' : c)));
  for (const r of opts.boldRows ?? []) ws.getRow(r + 1).font = { bold: true };
  for (const c of opts.moneyColumns ?? []) ws.getColumn(c + 1).numFmt = '#,##0';
  grid[0]?.forEach((_, i) => {
    const width = Math.min(
      60,
      Math.max(8, ...grid.map((row) => String(row[i] ?? '').length + 2)),
    );
    ws.getColumn(i + 1).width = width;
  });
  const raw = await wb.xlsx.writeBuffer();
  return normalizeZipTimestamps(new Uint8Array(raw as ArrayBuffer));
}

function sanitizeSheetName(name: string): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, ' ').trim();
  return (cleaned || 'Sheet1').slice(0, 31);
}

export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export const CONTENT_TYPES = {
  CSV: 'text/csv; charset=utf-8',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;

/** Safe ASCII file name for Content-Disposition. */
export function safeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').slice(0, 120);
}
