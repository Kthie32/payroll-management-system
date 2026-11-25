import { describe, expect, it } from 'vitest';
import { parseInputsCsv, MAX_IMPORT_ROWS, type CsvComponent } from '../csv-inputs';
import {
  displayCode,
  loanLineCode,
  loanRepaymentsFromLines,
  parseLoanLineCode,
} from '../loan-codes';
import {
  approveBlockReason,
  isEditable,
  isPosted,
  rejectBlockReason,
  submitBlockReason,
} from '../status';
import { computeVariance, emptyTotals, parseTotals, sumTotals } from '../totals';

describe('loan codes', () => {
  it('round-trips and ignores plain codes', () => {
    expect(loanLineCode('LOAN', 'abc')).toBe('LOAN#abc');
    expect(parseLoanLineCode('LOAN#abc')).toEqual({ componentCode: 'LOAN', loanId: 'abc' });
    expect(parseLoanLineCode('LOAN')).toBeNull();
    expect(parseLoanLineCode('#abc')).toBeNull();
    expect(parseLoanLineCode('LOAN#')).toBeNull();
    expect(displayCode('ADVANCE#x')).toBe('ADVANCE');
    expect(displayCode('BASIC')).toBe('BASIC');
  });
  it('sums repayments per loan from deduction lines only', () => {
    expect(
      loanRepaymentsFromLines([
        { code: 'LOAN#a', kind: 'DEDUCTION', amount: 100 },
        { code: 'LOAN#a', kind: 'DEDUCTION', amount: 50 },
        { code: 'ADVANCE#b', kind: 'DEDUCTION', amount: 0 },
        { code: 'SACCO', kind: 'DEDUCTION', amount: 70 },
        { code: 'X#c', kind: 'EARNING', amount: 70 },
      ]),
    ).toEqual([{ loanId: 'a', amount: 150 }]);
  });
});

describe('status rules', () => {
  it('classifies statuses', () => {
    expect(isPosted('APPROVED')).toBe(true);
    expect(isPosted('SUBMITTED')).toBe(false);
    expect(isEditable('REJECTED')).toBe(true);
    expect(isEditable('SUBMITTED')).toBe(false);
  });
  it('blocks submission with errors or no employees', () => {
    expect(submitBlockReason({ status: 'COMPUTED', headcount: 3, errorCount: 0 })).toBeNull();
    expect(submitBlockReason({ status: 'DRAFT', headcount: 3, errorCount: 0 })).toMatch(/computed/);
    expect(submitBlockReason({ status: 'COMPUTED', headcount: 0, errorCount: 0 })).toMatch(
      /no employees/,
    );
    expect(submitBlockReason({ status: 'COMPUTED', headcount: 3, errorCount: 2 })).toMatch(
      /2 employee/,
    );
  });
  it('enforces separation of duties on approve and reject for every preparer', () => {
    const prep = { createdById: 'c', computedById: 'p', submittedById: 's' };
    const sub = { ...prep, status: 'SUBMITTED' as const };
    expect(approveBlockReason({ ...sub, actorId: 'approver' })).toBeNull();
    expect(approveBlockReason({ ...sub, actorId: 'c' })).toMatch(/created this run.*separation/);
    expect(approveBlockReason({ ...sub, actorId: 'p' })).toMatch(/computed this run/);
    expect(approveBlockReason({ ...sub, actorId: 's' })).toMatch(/submitted this run/);
    expect(approveBlockReason({ ...prep, status: 'COMPUTED', actorId: 'approver' })).toMatch(
      /submitted run/,
    );
    expect(rejectBlockReason({ ...sub, actorId: 'approver' })).toBeNull();
    expect(rejectBlockReason({ ...sub, actorId: 'c' })).toMatch(/cannot reject/);
    expect(rejectBlockReason({ ...sub, actorId: 's' })).toMatch(/submitted this run/);
    expect(rejectBlockReason({ ...prep, status: 'APPROVED', actorId: 'approver' })).toMatch(
      /submitted run/,
    );
    expect(
      approveBlockReason({
        createdById: null,
        computedById: null,
        submittedById: null,
        status: 'SUBMITTED',
        actorId: 'x',
      }),
    ).toBeNull();
  });
});

describe('totals and variance', () => {
  const row = (gross: number, net: number, warnings: string[] = []) => ({
    gross,
    taxable: gross,
    paye: 10,
    nssfEmployee: 5,
    nssfEmployer: 10,
    lst: 0,
    otherDeductions: 0,
    net,
    employerCost: gross + 10,
    warnings,
  });
  it('sums employee amounts', () => {
    const t = sumTotals(
      [row(100, 85, ['A']), row(200, 185, ['B', 'C'])],
      [{ employeeId: 'e', staffNo: 'S', name: 'N', message: 'm' }],
    );
    expect(t).toMatchObject({
      headcount: 2,
      gross: 300,
      net: 270,
      paye: 20,
      employerCost: 320,
      warningCount: 3,
    });
    expect(t.errors).toHaveLength(1);
  });
  it('parses stored totals defensively', () => {
    expect(parseTotals(null)).toEqual(emptyTotals());
    expect(parseTotals({ gross: 5, net: 'x', errors: [{ message: 'm' }] })).toMatchObject({
      gross: 5,
      net: 0,
    });
    expect(parseTotals({ gross: 1.5 }).gross).toBe(0);
    expect(parseTotals({ errors: 'no' }).errors).toEqual([]);
  });
  it('flags new, gone and >10% changes', () => {
    const v = computeVariance(
      [
        { employeeId: 'a', gross: 100, net: 100 },
        { employeeId: 'b', gross: 100, net: 111 },
        { employeeId: 'c', gross: 100, net: 110 },
        { employeeId: 'd', gross: 100, net: 50 },
        { employeeId: 'z', gross: 0, net: 5 },
        { employeeId: 'y', gross: 0, net: 0 },
      ],
      [
        { employeeId: 'b', gross: 100, net: 100 },
        { employeeId: 'c', gross: 100, net: 100 },
        { employeeId: 'd', gross: 100, net: 100 },
        { employeeId: 'e', gross: 100, net: 100 },
        { employeeId: 'z', gross: 0, net: 0 },
        { employeeId: 'y', gross: 0, net: 0 },
      ],
    );
    expect(v.flagged.map((f) => [f.employeeId, f.reason, f.changeBp])).toEqual([
      ['a', 'NEW', null],
      ['b', 'CHANGE', 1_100],
      ['d', 'CHANGE', -5_000],
      ['z', 'CHANGE', null],
      ['e', 'LEFT', null],
    ]);
    expect(v.headcount).toEqual({ previous: 6, current: 6, delta: 0 });
    expect(v.net.delta).toBe(476 - 500);
  });
});

describe('parseInputsCsv', () => {
  const employeesByStaffNo = new Map([
    ['S001', { id: 'e1', name: 'Jane' }],
    ['S002', { id: 'e2', name: 'Paul' }],
  ]);
  const comps: CsvComponent[] = [
    { id: 'c1', code: 'OVERTIME', calcType: 'RATE_X_QTY', isActive: true },
    { id: 'c2', code: 'BONUS', calcType: 'FIXED', isActive: true },
    { id: 'c3', code: 'HOUSING', calcType: 'PERCENT_OF_BASIC', isActive: true },
    { id: 'c4', code: 'OLD', calcType: 'FIXED', isActive: false },
  ];
  const lookups = { employeesByStaffNo, componentsByCode: new Map(comps.map((c) => [c.code, c])) };

  it('parses valid rows (BOM, spacing, commas, lowercase codes)', () => {
    const r = parseInputsCsv(
      '﻿staffNo, componentCode ,quantity,amount\nS001,overtime,1.5,\nS002,BONUS,,"250,000"\n\n',
      lookups,
    );
    expect(r.fileErrors).toEqual([]);
    expect(r.validCount).toBe(2);
    expect(r.rows[0]).toMatchObject({
      line: 2,
      employeeId: 'e1',
      componentId: 'c1',
      quantity: 1.5,
      amount: null,
      errors: [],
    });
    expect(r.rows[1]).toMatchObject({
      line: 3,
      employeeName: 'Paul',
      componentId: 'c2',
      amount: 250_000,
    });
  });

  it('reports row errors', () => {
    const r = parseInputsCsv(
      [
        'staffNo,componentCode,quantity,amount',
        ',BONUS,,100',
        'S999,BONUS,,100',
        'S001,,,100',
        'S001,NOPE,,100',
        'S001,OLD,,100',
        'S001,HOUSING,,100',
        'S001,OVERTIME,1.234,',
        'S001,BONUS,,12.5',
        'S001,OVERTIME,,',
        'S001,BONUS,,',
      ].join('\n'),
      lookups,
    );
    expect(r.validCount).toBe(0);
    expect(r.errorCount).toBe(10);
    expect(r.rows.map((x) => x.errors[0])).toEqual([
      'staffNo is required',
      'Unknown staff number or not in this pay group: S999',
      'componentCode is required',
      'Unknown component code: NOPE',
      'Component OLD is inactive',
      'HOUSING is a percentage component and cannot take period inputs',
      'Invalid quantity "1.234" (max 2 decimals, ≥ 0)',
      'Invalid amount "12.5" (whole shillings, ≥ 0)',
      'OVERTIME needs a quantity',
      'BONUS needs an amount',
    ]);
  });

  it('reports file-level errors', () => {
    expect(parseInputsCsv('staffNo,amount\nS001,5', lookups).fileErrors[0]).toMatch(
      /Missing column/,
    );
    expect(parseInputsCsv('staffNo,componentCode,quantity,amount\n', lookups).fileErrors).toEqual([
      'The file has no data rows.',
    ]);
    const big = [
      'staffNo,componentCode,quantity,amount',
      ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => 'S001,BONUS,,1'),
    ];
    expect(parseInputsCsv(big.join('\n'), lookups).fileErrors[0]).toMatch(/Too many rows/);
  });
});
