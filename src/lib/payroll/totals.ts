import type { Ugx } from '@/lib/money';

export interface RunError {
  employeeId: string;
  staffNo: string;
  name: string;
  message: string;
}

export interface RunTotals {
  headcount: number;
  gross: Ugx;
  taxable: Ugx;
  paye: Ugx;
  nssfEmployee: Ugx;
  nssfEmployer: Ugx;
  lst: Ugx;
  otherDeductions: Ugx;
  net: Ugx;
  employerCost: Ugx;
  warningCount: number;
  errors: RunError[];
}

export interface EmployeeAmounts {
  gross: Ugx;
  taxable: Ugx;
  paye: Ugx;
  nssfEmployee: Ugx;
  nssfEmployer: Ugx;
  lst: Ugx;
  otherDeductions: Ugx;
  net: Ugx;
  employerCost: Ugx;
  warnings: string[];
}

export function emptyTotals(): RunTotals {
  return {
    headcount: 0,
    gross: 0,
    taxable: 0,
    paye: 0,
    nssfEmployee: 0,
    nssfEmployer: 0,
    lst: 0,
    otherDeductions: 0,
    net: 0,
    employerCost: 0,
    warningCount: 0,
    errors: [],
  };
}

export function sumTotals(rows: EmployeeAmounts[], errors: RunError[] = []): RunTotals {
  const t = emptyTotals();
  for (const r of rows) {
    t.headcount += 1;
    t.gross += r.gross;
    t.taxable += r.taxable;
    t.paye += r.paye;
    t.nssfEmployee += r.nssfEmployee;
    t.nssfEmployer += r.nssfEmployer;
    t.lst += r.lst;
    t.otherDeductions += r.otherDeductions;
    t.net += r.net;
    t.employerCost += r.employerCost;
    t.warningCount += r.warnings.length;
  }
  t.errors = errors;
  return t;
}

/** Reads a totals JSON blob defensively (older/invalid shapes become zeros). */
export function parseTotals(json: unknown): RunTotals {
  const t = emptyTotals();
  if (!json || typeof json !== 'object') return t;
  const o = json as Record<string, unknown>;
  for (const key of Object.keys(t) as Array<keyof RunTotals>) {
    if (key === 'errors') continue;
    const v = o[key];
    if (typeof v === 'number' && Number.isSafeInteger(v)) (t[key] as number) = v;
  }
  if (Array.isArray(o.errors)) t.errors = o.errors as RunError[];
  return t;
}

export interface VarianceRow {
  employeeId: string;
  previousNet: Ugx | null;
  net: Ugx | null;
  reason: 'NEW' | 'LEFT' | 'CHANGE';
  /** Change in basis points of the previous net (null for NEW/LEFT or previous net 0). */
  changeBp: number | null;
}

export interface Variance {
  headcount: { previous: number; current: number; delta: number };
  gross: { previous: Ugx; current: Ugx; delta: number };
  net: { previous: Ugx; current: Ugx; delta: number };
  flagged: VarianceRow[];
}

const BP = 10_000;
/** Per-employee net change above 10% is flagged. */
export const VARIANCE_THRESHOLD_BP = 1_000;

/** Compares two runs. Employees are flagged when new, gone, or net changed by more than 10%. */
export function computeVariance(
  current: Array<{ employeeId: string; gross: Ugx; net: Ugx }>,
  previous: Array<{ employeeId: string; gross: Ugx; net: Ugx }>,
  thresholdBp = VARIANCE_THRESHOLD_BP,
): Variance {
  const sum = (rows: Array<{ gross: Ugx; net: Ugx }>, k: 'gross' | 'net') =>
    rows.reduce((s, r) => s + r[k], 0);
  const prevBy = new Map(previous.map((r) => [r.employeeId, r]));
  const curBy = new Map(current.map((r) => [r.employeeId, r]));
  const flagged: VarianceRow[] = [];

  for (const cur of current) {
    const prev = prevBy.get(cur.employeeId);
    if (!prev) {
      flagged.push({
        employeeId: cur.employeeId,
        previousNet: null,
        net: cur.net,
        reason: 'NEW',
        changeBp: null,
      });
      continue;
    }
    const diff = cur.net - prev.net;
    if (prev.net === 0) {
      if (diff !== 0) {
        flagged.push({
          employeeId: cur.employeeId,
          previousNet: 0,
          net: cur.net,
          reason: 'CHANGE',
          changeBp: null,
        });
      }
      continue;
    }
    if (Math.abs(diff) * BP > thresholdBp * prev.net) {
      flagged.push({
        employeeId: cur.employeeId,
        previousNet: prev.net,
        net: cur.net,
        reason: 'CHANGE',
        changeBp: Math.round((diff * BP) / prev.net),
      });
    }
  }
  for (const prev of previous) {
    if (!curBy.has(prev.employeeId)) {
      flagged.push({
        employeeId: prev.employeeId,
        previousNet: prev.net,
        net: null,
        reason: 'LEFT',
        changeBp: null,
      });
    }
  }

  const pg = sum(previous, 'gross');
  const cg = sum(current, 'gross');
  const pn = sum(previous, 'net');
  const cn = sum(current, 'net');
  return {
    headcount: {
      previous: previous.length,
      current: current.length,
      delta: current.length - previous.length,
    },
    gross: { previous: pg, current: cg, delta: cg - pg },
    net: { previous: pn, current: cn, delta: cn - pn },
    flagged,
  };
}
