import Papa from 'papaparse';

export const INPUT_CSV_COLUMNS = ['staffNo', 'componentCode', 'quantity', 'amount'] as const;
export const MAX_IMPORT_ROWS = 5_000;

export interface CsvEmployee {
  id: string;
  name: string;
}

export interface CsvComponent {
  id: string;
  code: string;
  calcType: 'FIXED' | 'PERCENT_OF_BASIC' | 'RATE_X_QTY';
  isActive: boolean;
}

export interface ParsedInputRow {
  /** 1-based line number in the file (header is line 1). */
  line: number;
  staffNo: string;
  componentCode: string;
  quantity: number | null;
  amount: number | null;
  employeeId: string | null;
  employeeName: string | null;
  componentId: string | null;
  errors: string[];
}

export interface ParseResult {
  rows: ParsedInputRow[];
  validCount: number;
  errorCount: number;
  /** File-level problems (missing columns, too many rows). When present, nothing can be imported. */
  fileErrors: string[];
}

const QTY_RE = /^\d+(\.\d{1,2})?$/;
const AMOUNT_RE = /^\d+$/;

function clean(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Parses and validates a payroll-inputs CSV (columns: staffNo, componentCode, quantity, amount).
 * Pure: lookups are passed in. Amounts are whole shillings (commas allowed); quantities allow two
 * decimals. RATE_X_QTY rows need a quantity (amount, if given, overrides the rate per unit);
 * FIXED rows need an amount; PERCENT_OF_BASIC components cannot be imported.
 */
export function parseInputsCsv(
  text: string,
  lookups: {
    employeesByStaffNo: Map<string, CsvEmployee>;
    componentsByCode: Map<string, CsvComponent>;
  },
): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  });
  const fileErrors: string[] = [];
  const headers = parsed.meta.fields ?? [];
  const missing = INPUT_CSV_COLUMNS.filter((c) => !headers.includes(c));
  if (missing.length) fileErrors.push(`Missing column(s): ${missing.join(', ')}`);
  if (parsed.data.length > MAX_IMPORT_ROWS) {
    fileErrors.push(`Too many rows (${parsed.data.length}); the limit is ${MAX_IMPORT_ROWS}.`);
  }
  if (parsed.data.length === 0 && !missing.length) fileErrors.push('The file has no data rows.');
  if (fileErrors.length) return { rows: [], validCount: 0, errorCount: 0, fileErrors };

  const rows: ParsedInputRow[] = parsed.data.map((raw, i) => {
    const errors: string[] = [];
    const staffNo = clean(raw.staffNo);
    const componentCode = clean(raw.componentCode).toUpperCase();
    const qtyText = clean(raw.quantity);
    const amountText = clean(raw.amount).replace(/,/g, '');

    const employee = staffNo ? lookups.employeesByStaffNo.get(staffNo) : undefined;
    if (!staffNo) errors.push('staffNo is required');
    else if (!employee) errors.push(`Unknown staff number or not in this pay group: ${staffNo}`);

    const component = componentCode ? lookups.componentsByCode.get(componentCode) : undefined;
    if (!componentCode) errors.push('componentCode is required');
    else if (!component) errors.push(`Unknown component code: ${componentCode}`);
    else if (!component.isActive) errors.push(`Component ${componentCode} is inactive`);
    else if (component.calcType === 'PERCENT_OF_BASIC') {
      errors.push(`${componentCode} is a percentage component and cannot take period inputs`);
    }

    let quantity: number | null = null;
    if (qtyText) {
      if (!QTY_RE.test(qtyText)) errors.push(`Invalid quantity "${qtyText}" (max 2 decimals, ≥ 0)`);
      else quantity = Number(qtyText);
    }
    let amount: number | null = null;
    if (amountText) {
      if (!AMOUNT_RE.test(amountText) || !Number.isSafeInteger(Number(amountText))) {
        errors.push(`Invalid amount "${clean(raw.amount)}" (whole shillings, ≥ 0)`);
      } else amount = Number(amountText);
    }

    if (component?.calcType === 'RATE_X_QTY' && quantity === null && !errors.some((e) => e.startsWith('Invalid quantity'))) {
      errors.push(`${componentCode} needs a quantity`);
    }
    if (component?.calcType === 'FIXED' && amount === null && !errors.some((e) => e.startsWith('Invalid amount'))) {
      errors.push(`${componentCode} needs an amount`);
    }

    return {
      line: i + 2,
      staffNo,
      componentCode,
      quantity,
      amount,
      employeeId: employee?.id ?? null,
      employeeName: employee?.name ?? null,
      componentId: component?.id ?? null,
      errors,
    };
  });

  const errorCount = rows.filter((r) => r.errors.length > 0).length;
  return { rows, validCount: rows.length - errorCount, errorCount, fileErrors };
}
