import Papa from 'papaparse';

/**
 * Bank / mobile money result files. After a payment file is processed, the bank or provider
 * returns a report saying which payments succeeded. Finance uploads it here; each row is matched
 * to a payee of that export by staff number (preferred) or account / wallet number, and the amount
 * must equal the payee's net pay. Pure: payees (with decrypted account numbers) are passed in.
 */

export type ResultStatus = 'PAID' | 'FAILED' | 'PENDING';

export interface ResultPayee {
  runEmployeeId: string;
  staffNo: string;
  name: string;
  /** Decrypted account or wallet number. */
  accountNo: string;
  net: number;
}

export interface ParsedResultRow {
  line: number;
  runEmployeeId: string | null;
  staffNo: string | null;
  name: string | null;
  status: ResultStatus | null;
  amount: number | null;
  reference: string | null;
  reason: string | null;
  errors: string[];
}

export interface ResultsParse {
  rows: ParsedResultRow[];
  fileErrors: string[];
  validCount: number;
  errorCount: number;
  /** Payees of the export with no row in the file. */
  unmatchedPayees: ResultPayee[];
}

const MAX_ROWS = 5_000;

const ALIASES = {
  staffNo: ['staffno', 'staff no', 'staff number', 'employee id', 'employee no', 'employee number'],
  account: [
    'account',
    'accountno',
    'account no',
    'account number',
    'msisdn',
    'phone',
    'phone number',
    'mobile',
    'mobile number',
    'wallet',
    'wallet number',
    'beneficiary account',
  ],
  amount: ['amount', 'value', 'paid amount', 'amount paid'],
  status: ['status', 'result', 'state', 'transaction status', 'payment status'],
  reference: ['reference', 'ref', 'transaction id', 'transactionid', 'txn id', 'bank reference'],
  reason: ['reason', 'message', 'remarks', 'comment', 'description', 'error', 'failure reason'],
} as const;

const PAID_WORDS = [
  'SUCCESS',
  'SUCCESSFUL',
  'PAID',
  'COMPLETED',
  'COMPLETE',
  'OK',
  'PROCESSED',
  'CREDITED',
  'APPROVED',
];
const FAILED_WORDS = [
  'FAILED',
  'FAIL',
  'FAILURE',
  'REJECTED',
  'RETURNED',
  'ERROR',
  'DECLINED',
  'UNPAID',
  'CANCELLED',
  'CANCELED',
  'REVERSED',
];
const PENDING_WORDS = ['PENDING', 'PROCESSING', 'QUEUED', 'IN PROGRESS', 'SUBMITTED', 'INITIATED'];

/** Maps a bank's status word to PAID / FAILED / PENDING, or null if unrecognised. */
export function normaliseStatus(raw: string): ResultStatus | null {
  const s = raw.trim().toUpperCase().replace(/[_-]+/g, ' ');
  if (!s) return null;
  if (PAID_WORDS.includes(s)) return 'PAID';
  if (FAILED_WORDS.includes(s)) return 'FAILED';
  if (PENDING_WORDS.includes(s)) return 'PENDING';
  return null;
}

/** Digits only; a local 07XXXXXXXX mobile number becomes 2567XXXXXXXX so both forms match. */
export function normaliseAccount(raw: string): string {
  const d = raw.replace(/\D/g, '');
  return d.length === 10 && d.startsWith('0') ? `256${d.slice(1)}` : d;
}

function findColumn(headers: string[], aliases: readonly string[]): string | null {
  const norm = (h: string) => h.trim().toLowerCase().replace(/[_]+/g, ' ');
  return headers.find((h) => aliases.includes(norm(h))) ?? null;
}

export function parseResultsFile(text: string, payees: readonly ResultPayee[]): ResultsParse {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
  });
  const headers = parsed.meta.fields ?? [];
  const col = {
    staffNo: findColumn(headers, ALIASES.staffNo),
    account: findColumn(headers, ALIASES.account),
    amount: findColumn(headers, ALIASES.amount),
    status: findColumn(headers, ALIASES.status),
    reference: findColumn(headers, ALIASES.reference),
    reason: findColumn(headers, ALIASES.reason),
  };
  const fileErrors: string[] = [];
  if (!col.staffNo && !col.account) {
    fileErrors.push('The file needs a staff number column or an account / phone number column.');
  }
  if (!col.status) fileErrors.push('The file needs a status column (e.g. SUCCESS / FAILED).');
  if (!col.amount) fileErrors.push('The file needs an amount column.');
  if (parsed.data.length > MAX_ROWS) fileErrors.push(`Too many rows (limit ${MAX_ROWS}).`);
  if (fileErrors.length) {
    return { rows: [], fileErrors, validCount: 0, errorCount: 0, unmatchedPayees: [...payees] };
  }

  const byStaff = new Map(payees.map((p) => [p.staffNo.trim().toUpperCase(), p]));
  const byAccount = new Map(payees.map((p) => [normaliseAccount(p.accountNo), p]));
  const seen = new Set<string>();
  const rows: ParsedResultRow[] = [];

  parsed.data.forEach((raw, i) => {
    const get = (c: string | null) => (c ? (raw[c] ?? '').toString().trim() : '');
    const staffText = get(col.staffNo);
    const accountText = get(col.account);
    const statusText = get(col.status);
    const amountText = get(col.amount).replace(/,/g, '');
    // Skip summary / blank lines that identify nobody and carry no status (e.g. a TOTAL row).
    if (!staffText && !accountText && !statusText) return;

    const errors: string[] = [];
    const payee =
      (staffText ? byStaff.get(staffText.toUpperCase()) : undefined) ??
      (accountText ? byAccount.get(normaliseAccount(accountText)) : undefined) ??
      null;
    if (!payee)
      errors.push(`No payee in this file matches ${staffText || accountText || 'this row'}`);
    else if (seen.has(payee.runEmployeeId)) errors.push(`${payee.staffNo} appears more than once`);
    if (payee) seen.add(payee.runEmployeeId);

    const status = normaliseStatus(statusText);
    if (!status) errors.push(`Unrecognised status "${statusText}"`);
    const amountNum = Number(amountText.replace(/\.0+$/, ''));
    const amount =
      /^\d+(\.0+)?$/.test(amountText) && Number.isSafeInteger(amountNum) ? amountNum : null;
    if (amount === null) errors.push(`Invalid amount "${get(col.amount)}"`);
    else if (payee && amount !== payee.net) {
      errors.push(`Amount ${amount} does not match net pay ${payee.net} for ${payee.staffNo}`);
    }

    rows.push({
      line: i + 2,
      runEmployeeId: payee?.runEmployeeId ?? null,
      staffNo: payee?.staffNo ?? (staffText || null),
      name: payee?.name ?? null,
      status,
      amount,
      reference: get(col.reference).slice(0, 100) || null,
      reason: get(col.reason).slice(0, 500) || null,
      errors,
    });
  });

  const errorCount = rows.filter((r) => r.errors.length).length;
  return {
    rows,
    fileErrors,
    validCount: rows.length - errorCount,
    errorCount,
    unmatchedPayees: payees.filter((p) => !seen.has(p.runEmployeeId)),
  };
}

export interface LatestResult {
  runEmployeeId: string;
  status: ResultStatus;
  uploadedAt: Date;
}

/** For each payee, the most recent result across all exports (a re-issue can turn FAILED into PAID). */
export function latestResults(results: readonly LatestResult[]): Map<string, LatestResult> {
  const by = new Map<string, LatestResult>();
  for (const r of results) {
    const cur = by.get(r.runEmployeeId);
    if (!cur || r.uploadedAt > cur.uploadedAt) by.set(r.runEmployeeId, r);
  }
  return by;
}

/** Counts for the run summary and the "mark paid" check. */
export function summariseResults(
  payeeIds: readonly string[],
  latest: ReadonlyMap<string, LatestResult>,
): { paid: number; failed: number; pending: number; noResult: number; failedIds: string[] } {
  let paid = 0;
  let failed = 0;
  let pending = 0;
  let noResult = 0;
  const failedIds: string[] = [];
  for (const id of payeeIds) {
    const r = latest.get(id);
    if (!r) noResult++;
    else if (r.status === 'PAID') paid++;
    else if (r.status === 'FAILED') {
      failed++;
      failedIds.push(id);
    } else pending++;
  }
  return { paid, failed, pending, noResult, failedIds };
}
