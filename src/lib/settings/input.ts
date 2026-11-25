import { BP_DENOMINATOR, type Bp, type Ugx } from '@/lib/money';

/**
 * Form-input helpers shared by settings, statutory rules and loans. Pure and client-safe.
 * Percentages are edited as text ("20", "2.5", "0.75") and stored as basis points (bp).
 */

const BP_PER_PERCENT = BP_DENOMINATOR / 100;

/** "20" → 2000, "2.5" → 250, "0.75" → 75. At most two decimals. Returns null if invalid. */
export function percentToBp(input: string | number): Bp | null {
  const s = String(input).trim().replace(/%$/, '').trim();
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = Number((m[2] ?? '').padEnd(2, '0'));
  const bp = whole * BP_PER_PERCENT + frac;
  return Number.isSafeInteger(bp) ? bp : null;
}

/** 2000 → "20", 250 → "2.5", 75 → "0.75". */
export function bpToPercent(bp: Bp): string {
  if (!Number.isSafeInteger(bp) || bp < 0) throw new RangeError(`invalid bp: ${bp}`);
  const whole = Math.floor(bp / BP_PER_PERCENT);
  const frac = bp % BP_PER_PERCENT;
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}

/** "1,000,000" / "1 000 000" / "1000000" → 1000000. Whole shillings only. Null if invalid. */
export function parseUgxInput(input: string | number | null | undefined): Ugx | null {
  if (input === null || input === undefined) return null;
  const s = String(input).trim().replace(/[,\s_]/g, '').replace(/^UGX/i, '');
  if (!/^\d{1,16}$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

/** Like parseUgxInput, but an empty string means "no value" (null) rather than invalid. */
export function parseOptionalUgx(input: string | null | undefined): Ugx | null | 'invalid' {
  if (input === null || input === undefined || String(input).trim() === '') return null;
  const n = parseUgxInput(input);
  return n === null ? 'invalid' : n;
}

/** Parse an ISO calendar date (YYYY-MM-DD) to a UTC-midnight Date, or null. */
export function parseIsoDateInput(input: string | null | undefined): Date | null {
  if (!input) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) &&
    d.getUTCMonth() === Number(m[2]) - 1 &&
    d.getUTCDate() === Number(m[3])
    ? d
    : null;
}

/** UTC-midnight Date (as stored in @db.Date columns) → "YYYY-MM-DD". */
export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The calendar day before `d` (UTC-midnight dates). */
export function dayBefore(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - 1));
}
