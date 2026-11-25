/**
 * Employee CSV import: pure parsing and validation (no DB). The caller supplies lookups for
 * pay groups, departments, banks and existing staff numbers, then commits the valid rows.
 */
import { Residency, WorkerType } from '@prisma/client';
import Papa from 'papaparse';
import { z } from 'zod';
import {
  ACCOUNT_NO_PATTERN,
  isIsoDate,
  NIN_PATTERN,
  normaliseId,
  NSSF_PATTERN,
  parseFlag,
  parseUgxInput,
  TIN_PATTERN,
} from './validation';

export const MAX_IMPORT_ROWS = 2000;
/** Kept under Next.js's 1 MB server-action body limit. */
export const MAX_IMPORT_BYTES = 900_000;

/** Column order of the downloadable template. Only the first five are required. */
export const IMPORT_COLUMNS = [
  'staff_no',
  'first_name',
  'last_name',
  'pay_group',
  'hire_date',
  'other_names',
  'worker_type',
  'department',
  'job_title',
  'grade',
  'residency',
  'tin',
  'nssf_no',
  'nin',
  'lst_district',
  'paye_applicable',
  'nssf_applicable',
  'lst_applicable',
  'basic_salary',
  'bank',
  'branch_code',
  'account_no',
  'account_name',
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

const REQUIRED_COLUMNS: readonly ImportColumn[] = [
  'staff_no',
  'first_name',
  'last_name',
  'pay_group',
  'hire_date',
];

export const IMPORT_TEMPLATE_EXAMPLE: Record<ImportColumn, string> = {
  staff_no: 'EMP001',
  first_name: 'Jane',
  last_name: 'Namubiru',
  pay_group: 'Monthly Staff',
  hire_date: '2026-01-15',
  other_names: '',
  worker_type: 'PERMANENT',
  department: 'Finance',
  job_title: 'Accountant',
  grade: 'G5',
  residency: 'RESIDENT',
  tin: '1000123456',
  nssf_no: 'NS1234567',
  nin: 'CF90012345ABCD',
  lst_district: 'Kampala',
  paye_applicable: 'yes',
  nssf_applicable: 'yes',
  lst_applicable: 'yes',
  basic_salary: '1500000',
  bank: 'STANBIC',
  branch_code: '001',
  account_no: '9030012345678',
  account_name: 'Jane Namubiru',
};

/** CSV text for the template download: header plus one example row. */
export function importTemplateCsv(): string {
  return Papa.unparse({
    fields: [...IMPORT_COLUMNS],
    data: [IMPORT_COLUMNS.map((c) => IMPORT_TEMPLATE_EXAMPLE[c])],
  });
}

export interface ImportLookups {
  /** Pay groups keyed by lower-cased name. */
  payGroups: Map<string, string>;
  /** Departments keyed by lower-cased name. */
  departments: Map<string, string>;
  /** Banks keyed by lower-cased code AND lower-cased name. */
  banks: Map<string, string>;
  /** Staff numbers already in the database (upper-cased). */
  existingStaffNos: Set<string>;
}

export interface ValidImportRow {
  line: number;
  staffNo: string;
  firstName: string;
  lastName: string;
  otherNames: string | null;
  workerType: WorkerType;
  payGroupId: string;
  departmentId: string | null;
  jobTitle: string | null;
  grade: string | null;
  hireDate: string;
  residency: Residency;
  tin: string | null;
  nssfNo: string | null;
  nin: string | null;
  lstDistrict: string | null;
  payeApplicable: boolean;
  nssfApplicable: boolean;
  lstApplicable: boolean;
  basicSalary: number | null;
  bankAccount: {
    bankId: string;
    branchCode: string | null;
    accountNo: string;
    accountName: string;
  } | null;
}

export interface ImportRowResult {
  line: number;
  staffNo: string;
  name: string;
  errors: string[];
  row: ValidImportRow | null;
}

export interface ImportResult {
  /** File-level problems (missing columns, too many rows, empty file). */
  fileErrors: string[];
  rows: ImportRowResult[];
  validCount: number;
  errorCount: number;
}

function normaliseHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/** Parses CSV text into header-keyed records. */
export function parseCsv(text: string): { records: Record<string, string>[]; errors: string[] } {
  const result = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: normaliseHeader,
    transform: (v) => v.trim(),
  });
  const errors = result.errors
    .filter((e) => e.code !== 'UndetectableDelimiter')
    .map((e) => (e.row !== undefined ? `Line ${e.row + 2}: ${e.message}` : e.message));
  return { records: result.data, errors };
}

const text = (v: string | undefined) => (v && v.length > 0 ? v : null);

function enumValue<T extends string>(
  raw: string | undefined,
  values: readonly T[],
  fallback: T,
): T | null {
  if (!raw) return fallback;
  const v = raw.trim().toUpperCase().replace(/[\s-]+/g, '_');
  return (values as readonly string[]).includes(v) ? (v as T) : null;
}

const WORKER_TYPES = Object.values(WorkerType);
const RESIDENCIES = Object.values(Residency);

/** Validates one CSV record. `seen` tracks staff numbers earlier in the same file. */
export function validateRecord(
  rec: Record<string, string>,
  line: number,
  lookups: ImportLookups,
  seen: Set<string>,
): ImportRowResult {
  const errors: string[] = [];
  const staffNo = (rec.staff_no ?? '').trim().toUpperCase();
  const firstName = (rec.first_name ?? '').trim();
  const lastName = (rec.last_name ?? '').trim();

  if (!staffNo) errors.push('staff_no is required');
  else if (!/^[A-Z0-9/_-]{1,40}$/.test(staffNo))
    errors.push('staff_no may use letters, digits, / _ and - (max 40)');
  else if (lookups.existingStaffNos.has(staffNo)) errors.push(`staff_no ${staffNo} already exists`);
  else if (seen.has(staffNo)) errors.push(`staff_no ${staffNo} appears more than once in the file`);
  if (staffNo) seen.add(staffNo);

  if (!firstName) errors.push('first_name is required');
  else if (firstName.length > 80) errors.push('first_name is too long');
  if (!lastName) errors.push('last_name is required');
  else if (lastName.length > 80) errors.push('last_name is too long');

  const payGroupId = lookups.payGroups.get((rec.pay_group ?? '').trim().toLowerCase());
  if (!rec.pay_group) errors.push('pay_group is required');
  else if (!payGroupId) errors.push(`pay_group "${rec.pay_group}" not found`);

  let departmentId: string | null = null;
  if (rec.department) {
    departmentId = lookups.departments.get(rec.department.trim().toLowerCase()) ?? null;
    if (!departmentId) errors.push(`department "${rec.department}" not found`);
  }

  const hireDate = (rec.hire_date ?? '').trim();
  if (!hireDate) errors.push('hire_date is required');
  else if (!isIsoDate(hireDate)) errors.push('hire_date must be yyyy-mm-dd');

  const workerType = enumValue(rec.worker_type, WORKER_TYPES, 'PERMANENT');
  if (!workerType) errors.push(`worker_type must be one of ${WORKER_TYPES.join(', ')}`);
  const residency = enumValue(rec.residency, RESIDENCIES, 'RESIDENT');
  if (!residency) errors.push(`residency must be one of ${RESIDENCIES.join(', ')}`);

  const idField = (key: 'tin' | 'nssf_no' | 'nin', pattern: RegExp, message: string) => {
    const raw = rec[key];
    if (!raw) return null;
    const v = normaliseId(raw);
    if (!pattern.test(v)) {
      errors.push(message);
      return null;
    }
    return v;
  };
  const tin = idField('tin', TIN_PATTERN, 'tin must be exactly 10 digits');
  const nssfNo = idField('nssf_no', NSSF_PATTERN, 'nssf_no must be 6–20 letters or digits');
  const nin = idField('nin', NIN_PATTERN, 'nin must be 14 letters or digits');

  const flagField = (key: 'paye_applicable' | 'nssf_applicable' | 'lst_applicable') => {
    const v = parseFlag(rec[key], true);
    if (v === null) errors.push(`${key} must be yes or no`);
    return v ?? true;
  };
  const payeApplicable = flagField('paye_applicable');
  const nssfApplicable = flagField('nssf_applicable');
  const lstApplicable = flagField('lst_applicable');

  let basicSalary: number | null = null;
  if (rec.basic_salary) {
    basicSalary = parseUgxInput(rec.basic_salary);
    if (basicSalary === null) errors.push('basic_salary must be a whole amount in UGX');
  }

  let bankAccount: ValidImportRow['bankAccount'] = null;
  const anyBank = rec.bank || rec.account_no || rec.account_name || rec.branch_code;
  if (anyBank) {
    const bankId = rec.bank ? lookups.banks.get(rec.bank.trim().toLowerCase()) : undefined;
    if (!rec.bank) errors.push('bank is required when bank details are given');
    else if (!bankId) errors.push(`bank "${rec.bank}" not found (use the bank code or name)`);
    const accountNo = normaliseId(rec.account_no ?? '');
    if (!accountNo) errors.push('account_no is required when bank details are given');
    else if (!ACCOUNT_NO_PATTERN.test(accountNo)) errors.push('account_no must be 6–20 digits');
    const accountName = (rec.account_name ?? '').trim() || `${firstName} ${lastName}`.trim();
    if (accountName.length > 160) errors.push('account_name is too long');
    if (bankId && ACCOUNT_NO_PATTERN.test(accountNo)) {
      bankAccount = { bankId, branchCode: text(rec.branch_code), accountNo, accountName };
    }
  }

  const ok = errors.length === 0 && payGroupId && workerType && residency;
  return {
    line,
    staffNo,
    name: `${firstName} ${lastName}`.trim(),
    errors,
    row: ok
      ? {
          line,
          staffNo,
          firstName,
          lastName,
          otherNames: text(rec.other_names),
          workerType,
          payGroupId,
          departmentId,
          jobTitle: text(rec.job_title),
          grade: text(rec.grade),
          hireDate,
          residency,
          tin,
          nssfNo,
          nin,
          lstDistrict: text(rec.lst_district),
          payeApplicable,
          nssfApplicable,
          lstApplicable,
          basicSalary,
          bankAccount,
        }
      : null,
  };
}

/** Parses and validates a whole file. */
export function validateImport(textContent: string, lookups: ImportLookups): ImportResult {
  const empty: ImportResult = { fileErrors: [], rows: [], validCount: 0, errorCount: 0 };
  if (textContent.length > MAX_IMPORT_BYTES) {
    return { ...empty, fileErrors: ['File is larger than 900 KB. Split it into smaller files.'] };
  }
  const { records, errors } = parseCsv(textContent);
  if (records.length === 0) {
    return { ...empty, fileErrors: errors.length ? errors : ['The file has no data rows.'] };
  }
  const headers = Object.keys(records[0] ?? {});
  const missing = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
  if (missing.length) {
    return { ...empty, fileErrors: [`Missing required column(s): ${missing.join(', ')}`] };
  }
  if (records.length > MAX_IMPORT_ROWS) {
    return {
      ...empty,
      fileErrors: [`The file has ${records.length} rows; the limit is ${MAX_IMPORT_ROWS}.`],
    };
  }
  const seen = new Set<string>();
  // Header is line 1, so the first data row is line 2.
  const rows = records.map((rec, i) => validateRecord(rec, i + 2, lookups, seen));
  const validCount = rows.filter((r) => r.row).length;
  return { fileErrors: errors, rows, validCount, errorCount: rows.length - validCount };
}

export const importModeSchema = z.enum(['ALL_OR_NOTHING', 'VALID_ONLY']);
export type ImportMode = z.infer<typeof importModeSchema>;
