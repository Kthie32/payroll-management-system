/**
 * Pure validation helpers for employee records. No DB, no server-only imports, so they can be
 * shared by server actions, the CSV importer and unit tests.
 */
import { CalcType, InstitutionType, Residency, WorkerType } from '@prisma/client';
import { z } from 'zod';

// ── Dates (calendar dates, stored as @db.Date at UTC midnight) ─────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date in `yyyy-mm-dd` form. */
export function isIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** `yyyy-mm-dd` → Date at UTC midnight (how Prisma stores @db.Date). */
export function isoToDate(s: string): Date {
  if (!isIsoDate(s)) throw new Error(`Invalid date: ${s}`);
  return new Date(`${s}T00:00:00.000Z`);
}

/** Date (UTC midnight) → `yyyy-mm-dd`. */
export function dateToIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const isoDateSchema = z.string().trim().refine(isIsoDate, 'Enter a valid date (yyyy-mm-dd)');

const optionalIsoDate = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine((v) => v === undefined || isIsoDate(v), 'Enter a valid date (yyyy-mm-dd)');

// ── Identifiers ─────────────────────────────────────────────────────────

/** URA TIN: exactly 10 digits. */
export const TIN_PATTERN = /^\d{10}$/;
/**
 * NSSF member number. TODO-confirm the exact format with NSSF; accepted here as 6–20 letters
 * or digits so existing numbers are not rejected.
 */
export const NSSF_PATTERN = /^[A-Z0-9]{6,20}$/;
/** Uganda National ID Number (NIN): 14 letters/digits, e.g. CM90012345ABCD. */
export const NIN_PATTERN = /^[A-Z0-9]{14}$/;
/** Bank account number: 6–20 digits (spaces and dashes are stripped first). */
export const ACCOUNT_NO_PATTERN = /^\d{6,20}$/;

export function normaliseId(v: string): string {
  return v.replace(/[\s-]+/g, '').toUpperCase();
}

const optionalId = (pattern: RegExp, message: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? normaliseId(v) : undefined))
    .refine((v) => v === undefined || pattern.test(v), message);

/** `CM90012345ABCD` → `CM••••••••ABCD`. */
export function maskNin(nin: string): string {
  if (nin.length <= 6) return '•'.repeat(nin.length);
  return `${nin.slice(0, 2)}${'•'.repeat(nin.length - 6)}${nin.slice(-4)}`;
}

// ── Phone numbers and mobile money wallets ──────────────────────────────

/**
 * Normalises a Ugandan phone number to international form without "+": 2567XXXXXXXX.
 * Accepts 07XXXXXXXX, 7XXXXXXXX, +2567XXXXXXXX, 2567XXXXXXXX and 00256…, with spaces/dashes.
 * Returns null when it is not a 12-digit 256 number.
 */
export function normaliseUgPhone(raw: string): string | null {
  let s = raw.replace(/[\s().-]+/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('00')) s = s.slice(2);
  if (/^0\d{9}$/.test(s)) s = `256${s.slice(1)}`;
  else if (/^[1-9]\d{8}$/.test(s)) s = `256${s}`;
  return /^256\d{9}$/.test(s) ? s : null;
}

/**
 * Network prefixes (the two digits after 256) accepted for each mobile money provider, keyed by
 * the provider's bank code. TODO-confirm with MTN and Airtel before go-live.
 */
export const WALLET_PREFIXES: Readonly<Record<string, readonly string[]>> = {
  MTNMOMO: ['76', '77', '78', '39'],
  AIRTELMONEY: ['70', '74', '75', '20'],
};

/** Display name for a provider code, used in error messages. */
const PROVIDER_LABEL: Readonly<Record<string, string>> = {
  MTNMOMO: 'MTN Mobile Money',
  AIRTELMONEY: 'Airtel Money',
};

/** "256772445566" → "+256 772 445 566". */
export function formatUgPhone(p: string): string {
  return /^256\d{9}$/.test(p) ? `+256 ${p.slice(3, 6)} ${p.slice(6, 9)} ${p.slice(9)}` : p;
}

export interface PaymentInstitution {
  kind: InstitutionType;
  code: string;
}

/**
 * Validates and normalises the account number for a payment destination.
 * Banks: 6–20 digits. Mobile money: a Ugandan wallet number on one of the provider's prefixes
 * (providers with no known prefix list accept any 256 number).
 */
export function normalisePaymentAccount(
  institution: PaymentInstitution,
  raw: string,
): { ok: true; accountNo: string } | { ok: false; error: string } {
  if (institution.kind === 'MOBILE_MONEY') {
    const phone = normaliseUgPhone(raw);
    if (!phone) {
      return {
        ok: false,
        error: 'Enter the wallet phone number, e.g. 0772 123456 or 256772123456',
      };
    }
    const prefixes = WALLET_PREFIXES[institution.code.toUpperCase()];
    if (prefixes && !prefixes.includes(phone.slice(3, 5))) {
      const label = PROVIDER_LABEL[institution.code.toUpperCase()] ?? institution.code;
      return {
        ok: false,
        error: `${formatUgPhone(phone)} is not a ${label} number (expected 0${prefixes.join('/0')}…)`,
      };
    }
    return { ok: true, accountNo: phone };
  }
  const acc = normaliseId(raw);
  return ACCOUNT_NO_PATTERN.test(acc)
    ? { ok: true, accountNo: acc }
    : { ok: false, error: 'Account number must be 6–20 digits' };
}

/** Masked account number for display: `••••1234`. */
export function maskAccount(last4: string): string {
  return `••••${last4}`;
}

// ── Booleans from forms / CSV ───────────────────────────────────────────

const TRUE_WORDS = new Set(['1', 'true', 'yes', 'y', 'on']);
const FALSE_WORDS = new Set(['0', 'false', 'no', 'n', 'off']);

/** Parses a yes/no style value. Empty → `fallback`; anything unrecognised → null. */
export function parseFlag(v: unknown, fallback: boolean): boolean | null {
  if (v === undefined || v === null) return fallback;
  const s = String(v).trim().toLowerCase();
  if (s === '') return fallback;
  if (TRUE_WORDS.has(s)) return true;
  if (FALSE_WORDS.has(s)) return false;
  return null;
}

const flag = (fallback: boolean) =>
  z.unknown().transform((v, ctx) => {
    const parsed = parseFlag(v, fallback);
    if (parsed === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Use yes or no' });
      return z.NEVER;
    }
    return parsed;
  });

// ── Money ───────────────────────────────────────────────────────────────

/**
 * Parses a whole-shilling amount typed by a person: commas, spaces and a leading "UGX" are
 * allowed. Returns null when it is not a non-negative safe integer.
 */
export function parseUgxInput(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const s = String(v)
    .trim()
    .replace(/^ugx\s*/i, '')
    .replace(/[,\s]/g, '');
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

/** Percent with up to 2 decimals (e.g. "12.5") → basis points (1250). Null if invalid. */
export function percentToBp(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().replace(/%$/, '');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  const [whole = '0', frac = ''] = s.split('.');
  const bp = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return bp <= 10_000 ? bp : null;
}

/** Basis points → percent string for display (1250 → "12.5"). */
export function bpToPercent(bp: number): string {
  const whole = Math.trunc(bp / 100);
  const frac = bp % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}

export const ugxSchema = z.unknown().transform((v, ctx) => {
  const n = parseUgxInput(v);
  if (n === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a whole amount in UGX' });
    return z.NEVER;
  }
  return n;
});

// ── Employee form ───────────────────────────────────────────────────────

const name = (label: string, max: number) =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} is too long`);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

/** Optional email, lower-cased. */
export const optionalEmail = z
  .string()
  .trim()
  .max(191)
  .optional()
  .transform((v) => (v ? v.toLowerCase() : undefined))
  .refine((v) => v === undefined || z.string().email().safeParse(v).success, 'Enter a valid email');

/** Optional Ugandan phone number, normalised to 2567XXXXXXXX (any network). */
export const optionalPhone = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v || !v.trim()) return undefined;
    const p = normaliseUgPhone(v);
    if (!p) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter a Ugandan phone number, e.g. 0772 123456',
      });
      return z.NEVER;
    }
    return p;
  });

export const employeeFormSchema = z.object({
  staffNo: z
    .string()
    .trim()
    .min(1, 'Staff number is required')
    .max(40)
    .regex(/^[A-Za-z0-9/_-]+$/, 'Staff number may use letters, digits, / _ and -')
    .transform((v) => v.toUpperCase()),
  firstName: name('First name', 80),
  lastName: name('Last name', 80),
  otherNames: optionalText(120),
  workerType: z.nativeEnum(WorkerType, { message: 'Choose a worker type' }),
  payGroupId: z.string().min(1, 'Choose a pay group'),
  departmentId: optionalText(191),
  jobTitle: optionalText(120),
  grade: optionalText(40),
  hireDate: isoDateSchema,
  residency: z.nativeEnum(Residency, { message: 'Choose residency' }),
  tin: optionalId(TIN_PATTERN, 'TIN must be exactly 10 digits'),
  nssfNo: optionalId(NSSF_PATTERN, 'NSSF number must be 6–20 letters or digits'),
  nin: optionalId(NIN_PATTERN, 'NIN must be 14 letters or digits'),
  lstDistrict: optionalText(80),
  email: optionalEmail,
  phone: optionalPhone,
  payeApplicable: flag(true),
  nssfApplicable: flag(true),
  lstApplicable: flag(true),
});
export type EmployeeFormInput = z.infer<typeof employeeFormSchema>;

/** Reads an employee form; unchecked checkboxes are absent from FormData, so they mean "no". */
export function employeeFormValues(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) if (typeof v === 'string') out[k] = v;
  for (const k of ['payeApplicable', 'nssfApplicable', 'lstApplicable']) {
    out[k] = fd.get(k) ? 'yes' : 'no';
  }
  return out;
}

export const exitSchema = z.object({
  employeeId: z.string().min(1),
  exitDate: isoDateSchema,
});

// ── Payment details (bank account or mobile money wallet) ───────────────

/**
 * Shape check only; the account number is validated against the chosen institution's kind with
 * normalisePaymentAccount() once the institution is known.
 */
export const bankAccountSchema = z.object({
  employeeId: z.string().min(1),
  bankId: z.string().min(1, 'Choose a bank or mobile money provider'),
  branchCode: optionalText(20),
  accountNo: z.string().trim().min(1, 'Enter the account or wallet number').max(40),
  accountName: name('Account name', 160),
  effectiveFrom: isoDateSchema,
});

// ── Pay component assignment ────────────────────────────────────────────

export const componentAssignmentSchema = z.object({
  employeeId: z.string().min(1),
  componentId: z.string().min(1, 'Choose a component'),
  value: z.string().trim().min(1, 'Enter a value'),
  effectiveFrom: isoDateSchema,
  effectiveTo: optionalIsoDate,
});

export interface ComponentValue {
  amount: number | null;
  rateBp: number | null;
  ratePerUnit: number | null;
}

/** Interprets the single "value" field according to the component's calcType. */
export function componentValueFor(
  calcType: CalcType,
  raw: string,
): { ok: true; value: ComponentValue } | { ok: false; error: string } {
  switch (calcType) {
    case 'FIXED': {
      const amount = parseUgxInput(raw);
      return amount === null
        ? { ok: false, error: 'Enter a whole amount in UGX' }
        : { ok: true, value: { amount, rateBp: null, ratePerUnit: null } };
    }
    case 'PERCENT_OF_BASIC': {
      const rateBp = percentToBp(raw);
      return rateBp === null
        ? { ok: false, error: 'Enter a percentage between 0 and 100 (up to 2 decimals)' }
        : { ok: true, value: { amount: null, rateBp, ratePerUnit: null } };
    }
    case 'RATE_X_QTY': {
      const ratePerUnit = parseUgxInput(raw);
      return ratePerUnit === null
        ? { ok: false, error: 'Enter a whole rate in UGX per unit' }
        : { ok: true, value: { amount: null, rateBp: null, ratePerUnit } };
    }
  }
}

export interface DateRange {
  from: string; // yyyy-mm-dd
  to: string | null; // inclusive; null = open-ended
}

/** True when two inclusive date ranges share at least one day (null `to` = open-ended). */
export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  const aEndsBeforeB = a.to !== null && a.to < b.from;
  const bEndsBeforeA = b.to !== null && b.to < a.from;
  return !aEndsBeforeB && !bEndsBeforeA;
}

/** Component codes managed by the Loans module, not assignable directly to employees. */
export const LOAN_MANAGED_CODES: readonly string[] = ['LOAN', 'ADVANCE'];

// ── Departments / banks ─────────────────────────────────────────────────

export const departmentSchema = z.object({
  name: name('Name', 120),
  costCentreCode: optionalText(40),
});

export const bankSchema = z.object({
  name: name('Name', 120),
  kind: z.nativeEnum(InstitutionType, { message: 'Choose bank or mobile money' }).default('BANK'),
  code: z
    .string()
    .trim()
    .min(1, 'Code is required')
    .max(20)
    .regex(/^[A-Za-z0-9_-]+$/, 'Code may use letters, digits, _ and -')
    .transform((v) => v.toUpperCase()),
});
