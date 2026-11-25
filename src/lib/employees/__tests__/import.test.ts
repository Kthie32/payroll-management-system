import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import {
  IMPORT_COLUMNS,
  type ImportLookups,
  importTemplateCsv,
  MAX_IMPORT_ROWS,
  validateImport,
} from '../import';

const lookups = (): ImportLookups => ({
  payGroups: new Map([
    ['monthly staff', 'pg-monthly'],
    ['casual workers', 'pg-casual'],
  ]),
  departments: new Map([['finance', 'dep-fin']]),
  banks: new Map([
    ['stanbic', 'bank-stanbic'],
    ['stanbic bank uganda', 'bank-stanbic'],
  ]),
  existingStaffNos: new Set(['EMP999']),
});

const header = 'staff_no,first_name,last_name,pay_group,hire_date';

describe('importTemplateCsv', () => {
  it('has every column and a valid example row', () => {
    const csv = importTemplateCsv();
    const parsed = Papa.parse<string[]>(csv);
    expect(parsed.data[0]).toEqual([...IMPORT_COLUMNS]);
    const result = validateImport(csv, {
      ...lookups(),
      departments: new Map([['finance', 'dep-fin']]),
    });
    expect(result.fileErrors).toEqual([]);
    expect(result.validCount).toBe(1);
    const row = result.rows[0]?.row;
    expect(row?.basicSalary).toBe(1_500_000);
    expect(row?.bankAccount).toEqual({
      bankId: 'bank-stanbic',
      branchCode: '001',
      accountNo: '9030012345678',
      accountName: 'Jane Namubiru',
    });
    expect(row?.nin).toBe('CF90012345ABCD');
  });
});

describe('validateImport', () => {
  it('accepts a minimal row with defaults', () => {
    const r = validateImport(`${header}\nE1,Jane,Doe,Monthly Staff,2026-01-01\n`, lookups());
    expect(r.validCount).toBe(1);
    expect(r.rows[0]?.row).toMatchObject({
      line: 2,
      staffNo: 'E1',
      workerType: 'PERMANENT',
      residency: 'RESIDENT',
      payGroupId: 'pg-monthly',
      departmentId: null,
      payeApplicable: true,
      basicSalary: null,
      bankAccount: null,
    });
  });

  it('normalises headers and strips a BOM', () => {
    const r = validateImport(
      `﻿Staff No,First Name,Last-Name,Pay Group,Hire Date\nE1,Jane,Doe,monthly staff,2026-01-01`,
      lookups(),
    );
    expect(r.validCount).toBe(1);
  });

  it('reports missing required columns', () => {
    const r = validateImport('staff_no,first_name\nE1,Jane', lookups());
    expect(r.fileErrors[0]).toMatch(/last_name, pay_group, hire_date/);
    expect(r.rows).toEqual([]);
  });

  it('reports an empty file', () => {
    expect(validateImport('', lookups()).fileErrors).toEqual(['The file has no data rows.']);
    expect(validateImport(header, lookups()).fileErrors).toEqual(['The file has no data rows.']);
  });

  it('rejects too many rows and oversized files', () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `E${i},A,B,Monthly Staff,2026-01-01`);
    expect(validateImport(`${header}\n${rows.join('\n')}`, lookups()).fileErrors[0]).toMatch(/limit/);
    expect(validateImport('x'.repeat(900_001), lookups()).fileErrors[0]).toMatch(/900 KB/);
  });

  it('flags duplicates within the file and against the database', () => {
    const r = validateImport(
      `${header}\nE1,A,B,Monthly Staff,2026-01-01\ne1,C,D,Monthly Staff,2026-01-01\nEMP999,E,F,Monthly Staff,2026-01-01`,
      lookups(),
    );
    expect(r.validCount).toBe(1);
    expect(r.rows[1]?.errors).toContain('staff_no E1 appears more than once in the file');
    expect(r.rows[2]?.errors).toContain('staff_no EMP999 already exists');
  });

  it('collects every error on a bad row', () => {
    const csv = [
      'staff_no,first_name,last_name,pay_group,hire_date,worker_type,residency,department,tin,nssf_no,nin,paye_applicable,basic_salary,bank,account_no',
      'bad no,,,Nowhere,2026-02-30,INTERN,ALIEN,Marketing,123,1,XX,maybe,12.5,NOBANK,12',
    ].join('\n');
    const r = validateImport(csv, lookups());
    const errors = r.rows[0]?.errors ?? [];
    expect(r.validCount).toBe(0);
    expect(r.errorCount).toBe(1);
    for (const expected of [
      'staff_no may use letters, digits, / _ and - (max 40)',
      'first_name is required',
      'last_name is required',
      'pay_group "Nowhere" not found',
      'department "Marketing" not found',
      'hire_date must be yyyy-mm-dd',
      'tin must be exactly 10 digits',
      'nssf_no must be 6–20 letters or digits',
      'nin must be 14 letters or digits',
      'paye_applicable must be yes or no',
      'basic_salary must be a whole amount in UGX',
      'bank "NOBANK" not found (use the bank code or name)',
      'account_no must be 6–20 digits',
    ]) {
      expect(errors).toContain(expected);
    }
    expect(errors.some((e) => e.startsWith('worker_type must be one of'))).toBe(true);
    expect(errors.some((e) => e.startsWith('residency must be one of'))).toBe(true);
  });

  it('requires bank and account number when any bank detail is given', () => {
    const r = validateImport(
      `${header},branch_code\nE1,A,B,Monthly Staff,2026-01-01,001`,
      lookups(),
    );
    expect(r.rows[0]?.errors).toEqual([
      'bank is required when bank details are given',
      'account_no is required when bank details are given',
    ]);
  });

  it('defaults the account name to the employee name and accepts bank names', () => {
    const r = validateImport(
      `${header},bank,account_no\nE1,Jane,Doe,Monthly Staff,2026-01-01,Stanbic Bank Uganda,1234 5678`,
      lookups(),
    );
    expect(r.rows[0]?.row?.bankAccount).toEqual({
      bankId: 'bank-stanbic',
      branchCode: null,
      accountNo: '12345678',
      accountName: 'Jane Doe',
    });
  });

  it('rejects over-long names', () => {
    const long = 'x'.repeat(81);
    const r = validateImport(
      `${header},account_name,bank,account_no\nE1,${long},${long},Monthly Staff,2026-01-01,${'y'.repeat(161)},stanbic,12345678`,
      lookups(),
    );
    expect(r.rows[0]?.errors).toEqual([
      'first_name is too long',
      'last_name is too long',
      'account_name is too long',
    ]);
  });

  it('surfaces CSV syntax problems as file errors without losing rows', () => {
    const r = validateImport(`${header}\nE1,"Jane,Doe,Monthly Staff,2026-01-01`, lookups());
    expect(r.fileErrors.length).toBeGreaterThan(0);
  });
});
