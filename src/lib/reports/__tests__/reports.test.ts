import { describe, expect, it } from 'vitest';
import {
  bankSummary,
  departmentCost,
  earningCodes,
  loanBalances,
  lstSchedule,
  nssfSchedule,
  payeReturn,
  payrollRegister,
  perEmployee,
  reportToGrid,
} from '../aggregate';
import {
  describeSelection,
  financialYearOf,
  fyLabel,
  parseSelection,
  payDateRange,
  selectionQuery,
} from '../range';
import type { ReportRow } from '../types';

function row(over: Partial<ReportRow> & Pick<ReportRow, 'employeeId' | 'staffNo'>): ReportRow {
  return {
    runId: 'r1',
    payDate: '2026-11-28',
    payGroup: 'Monthly Staff',
    name: `Emp ${over.staffNo}`,
    tin: '1000000001',
    nssfNo: 'NS001',
    department: 'Finance',
    lstDistrict: 'Kampala',
    gross: 1_000_000,
    taxable: 1_000_000,
    nssfBase: 1_000_000,
    paye: 188_250,
    nssfEmployee: 50_000,
    nssfEmployer: 100_000,
    lst: 0,
    otherDeductions: 0,
    net: 761_750,
    employerCost: 1_100_000,
    lines: [{ code: 'BASIC', kind: 'EARNING', amount: 1_000_000 }],
    ...over,
  };
}

const a = row({ employeeId: 'a', staffNo: 'E002', department: 'Ops' });
const b = row({
  employeeId: 'b',
  staffNo: 'E001',
  department: null,
  gross: 1_200_000,
  employerCost: 1_350_000,
  nssfEmployer: 120_000,
  lines: [
    { code: 'BASIC', kind: 'EARNING', amount: 1_000_000 },
    { code: 'HOUSING', kind: 'EARNING', amount: 150_000 },
    { code: 'HOUSING', kind: 'EARNING', amount: 50_000 },
    { code: 'PAYE', kind: 'STATUTORY', amount: 188_250 },
    { code: 'MEDICAL', kind: 'EMPLOYER', amount: 30_000 },
  ],
});

describe('payroll register', () => {
  it('lists earning codes with BASIC first, then alphabetical', () => {
    expect(earningCodes([a, b])).toEqual(['BASIC', 'HOUSING']);
    expect(earningCodes([row({ employeeId: 'x', staffNo: 'X', lines: [
      { code: 'ZED', kind: 'EARNING', amount: 1 },
      { code: 'ALPHA', kind: 'EARNING', amount: 1 },
    ] })])).toEqual(['ALPHA', 'ZED']);
  });

  it('builds one row per payslip, sums repeated earning codes, and totals money columns', () => {
    const t = payrollRegister([a, b]);
    expect(t.rows.map((r) => r.staffNo)).toEqual(['E001', 'E002']);
    expect(t.rows[0]).toMatchObject({ e_BASIC: 1_000_000, e_HOUSING: 200_000, department: 'Unassigned' });
    expect(t.rows[1]).toMatchObject({ e_HOUSING: 0 });
    expect(t.totals).toMatchObject({ payDate: 'TOTAL', gross: 2_200_000, net: 1_523_500, e_HOUSING: 200_000 });
    expect(t.groupBy).toBeUndefined();
  });

  it('groups by department when asked', () => {
    const t = payrollRegister([a, b], { groupByDepartment: true });
    expect(t.groupBy).toBe('department');
    expect(t.rows.map((r) => r.department)).toEqual(['Unassigned', 'Ops']);
  });
});

describe('per-employee aggregation', () => {
  it('sums across runs and keeps the latest identity fields', () => {
    const oct = row({ employeeId: 'a', staffNo: 'E002', payDate: '2026-10-28', tin: null, runId: 'r0' });
    const agg = perEmployee([a, oct]);
    expect(agg).toHaveLength(1);
    expect(agg[0]).toMatchObject({ gross: 2_000_000, paye: 376_500, tin: '1000000001' });
  });
});

describe('statutory schedules', () => {
  it('PAYE return lists TIN and flags missing TINs', () => {
    const t = payeReturn([a, row({ employeeId: 'c', staffNo: 'E003', tin: null })]);
    expect(t.rows[0]).toMatchObject({ tin: '1000000001', paye: 188_250 });
    expect(t.rows[1]).toMatchObject({ tin: '' });
    expect(t.totals).toMatchObject({ paye: 376_500 });
    expect(t.notes?.some((n) => n.includes('1 employee(s) with PAYE have no TIN'))).toBe(true);
  });

  it('NSSF schedule computes 15% total, skips non-contributors, flags missing numbers', () => {
    const none = row({ employeeId: 'z', staffNo: 'E009', nssfEmployee: 0, nssfEmployer: 0 });
    const noNo = row({ employeeId: 'y', staffNo: 'E008', nssfNo: null });
    const t = nssfSchedule([a, none, noNo]);
    expect(t.rows.map((r) => r.staffNo)).toEqual(['E002', 'E008']);
    expect(t.rows[0]).toMatchObject({ nssfEmployee: 50_000, nssfEmployer: 100_000, total: 150_000 });
    expect(t.totals).toMatchObject({ total: 300_000 });
    expect(t.notes).toHaveLength(2);
    expect(nssfSchedule([a]).notes).toHaveLength(1);
  });

  it('LST schedule groups by district and skips zero LST', () => {
    const t = lstSchedule([
      row({ employeeId: '1', staffNo: 'E1', lst: 25_000, lstDistrict: 'Wakiso' }),
      row({ employeeId: '2', staffNo: 'E2', lst: 25_000, lstDistrict: null }),
      row({ employeeId: '3', staffNo: 'E3', lst: 10_000 }),
      a,
    ]);
    expect(t.rows.map((r) => r.district)).toEqual(['Kampala', 'Not set', 'Wakiso']);
    expect(t.totals).toMatchObject({ lst: 60_000 });
    expect(t.groupBy).toBe('district');
  });
});

describe('department cost', () => {
  it('counts distinct employees and splits employer costs', () => {
    const t = departmentCost([a, b, row({ employeeId: 'a', staffNo: 'E002', department: 'Ops', runId: 'r2' })]);
    expect(t.rows).toEqual([
      { department: 'Ops', headcount: 1, gross: 2_000_000, nssfEmployer: 200_000, otherEmployer: 0, employerCost: 2_200_000 },
      { department: 'Unassigned', headcount: 1, gross: 1_200_000, nssfEmployer: 120_000, otherEmployer: 30_000, employerCost: 1_350_000 },
    ]);
    expect(t.totals).toMatchObject({ headcount: 2, employerCost: 3_550_000 });
  });
});

describe('bank summary', () => {
  it('uses the latest non-superseded version per run and bank', () => {
    const base = { runId: 'r1', payDate: '2026-11-28', rowCount: 2 };
    const t = bankSummary([
      { ...base, bankName: 'Stanbic', version: 1, status: 'SUPERSEDED', totalAmount: 999 },
      { ...base, bankName: 'Stanbic', version: 2, status: 'GENERATED', totalAmount: 1000 },
      { ...base, bankName: 'Stanbic', version: 3, status: 'SENT', totalAmount: 1500 },
      { ...base, bankName: 'Absa', version: 1, status: 'SENT', totalAmount: 500, rowCount: 1 },
      { ...base, runId: 'r2', bankName: 'Absa', version: 1, status: 'SENT', totalAmount: 700, rowCount: 1 },
    ]);
    expect(t.rows).toEqual([
      { bank: 'Absa', files: 2, payees: 2, total: 1200 },
      { bank: 'Stanbic', files: 1, payees: 2, total: 1500 },
    ]);
    expect(t.totals).toMatchObject({ total: 2700, files: 3 });
  });
});

describe('loans', () => {
  it('lists loans and unsettled carry-forwards sorted by staff number', () => {
    const t = loanBalances(
      [{ staffNo: 'E2', name: 'B', type: 'LOAN', principal: 1000, installment: 100, balance: 600, status: 'ACTIVE' }],
      [{ staffNo: 'E1', name: 'A', componentCode: 'SACCO', amount: 50, fromPayDate: '2026-10-28' }],
    );
    expect(t.rows.map((r) => r.item)).toEqual(['CARRY FORWARD', 'LOAN']);
    expect(t.rows[0]).toMatchObject({ detail: 'SACCO from 2026-10-28', principal: null });
    expect(t.totals).toMatchObject({ balance: 650, principal: 1000 });
  });
});

describe('report grid', () => {
  it('puts title, subtitle, header, rows, totals and notes in order', () => {
    const t = { ...payeReturn([a]), subtitle: 'Pay month 2026-11' };
    const { grid, boldRows, moneyColumns } = reportToGrid(t);
    expect(grid[0]).toEqual(['PAYE return summary']);
    expect(grid[1]).toEqual(['Pay month 2026-11']);
    expect(grid[3]?.[0]).toBe('TIN');
    expect(grid[4]?.[5]).toBe(188_250);
    expect(grid[5]?.[0]).toBe('TOTAL');
    expect(boldRows).toEqual([0, 3, 5]);
    expect(moneyColumns).toEqual([3, 4, 5]);
    expect(String(grid[6]?.[0])).toContain('TODO-confirm');
  });

  it('handles tables without subtitle or totals', () => {
    const { grid, boldRows } = reportToGrid({
      title: 'T',
      columns: [{ key: 'x', label: 'X', type: 'text' }],
      rows: [{}],
    });
    expect(grid).toEqual([['T'], [], ['X'], [null]]);
    expect(boldRows).toEqual([0, 2]);
  });
});

describe('selection', () => {
  it('parses search params with defaults and repeated run ids', () => {
    expect(parseSelection({})).toMatchObject({ mode: 'month', includeDraft: false });
    const s = parseSelection({ mode: 'runs', run: ['r1', 'r2,r3'], draft: '1', group: '1' });
    expect(s).toMatchObject({ mode: 'runs', runIds: ['r1', 'r2', 'r3'], includeDraft: true, groupByDepartment: true });
    expect(parseSelection({ mode: 'month', month: '2026-13' }).mode).toBe('month');
    expect(parseSelection({ mode: 'month', month: '2026-13' }).month).toBeUndefined();
    expect(parseSelection({ mode: ['fy'], fy: '2026' })).toMatchObject({ mode: 'fy', fy: 2026 });
  });

  it('computes month and financial-year ranges', () => {
    expect(payDateRange(parseSelection({ month: '2028-02' }), '2026-11-25')).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    });
    expect(payDateRange(parseSelection({}), '2026-11-25')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(payDateRange(parseSelection({ mode: 'fy' }), '2026-03-10')).toEqual({
      from: '2025-07-01',
      to: '2026-06-30',
    });
    expect(payDateRange(parseSelection({ mode: 'runs', run: 'x' }), '2026-11-25')).toBeNull();
  });

  it('financial year starts in July', () => {
    expect(financialYearOf('2026-07-01')).toBe(2026);
    expect(financialYearOf('2026-06-30')).toBe(2025);
    expect(fyLabel(2026)).toBe('FY 2026/27');
    expect(fyLabel(2099)).toBe('FY 2099/00');
  });

  it('round-trips through a query string and describes itself', () => {
    for (const p of [
      { mode: 'runs', run: ['a', 'b'], draft: '1' },
      { mode: 'month', month: '2026-11', group: '1' },
      { mode: 'fy', fy: '2026' },
    ]) {
      const s = parseSelection(p);
      const back = parseSelection(Object.fromEntries(
        [...new URLSearchParams(selectionQuery(s)).keys()].map((k) => [
          k,
          new URLSearchParams(selectionQuery(s)).getAll(k),
        ]),
      ));
      expect(back).toEqual(s);
    }
    expect(describeSelection(parseSelection({ mode: 'runs', run: 'a', draft: '1' }), '2026-11-25')).toBe(
      '1 selected run(s) — INCLUDES UNAPPROVED (DRAFT) RUNS',
    );
    expect(describeSelection(parseSelection({ mode: 'fy' }), '2026-11-25')).toBe('FY 2026/27');
    expect(describeSelection(parseSelection({}), '2026-11-25')).toBe('Pay month 2026-11');
  });
});
