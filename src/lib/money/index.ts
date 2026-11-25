/**
 * Money helpers. UGX has no minor unit, so money is a whole number of shillings.
 * In TypeScript it is a safe-integer `number`; in the database it is `BigInt`.
 * Percentages are basis points (10,000 bp = 100%). Rounding is half-up.
 */

export type Ugx = number;
export type Bp = number;

export const BP_DENOMINATOR = 10_000;

export class MoneyError extends Error {
  override name = 'MoneyError';
}

/** Asserts `n` is a safe integer ≥ 0. */
export function assertUgx(n: unknown, label = 'amount'): asserts n is Ugx {
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) {
    throw new MoneyError(
      `${label} must be a non-negative safe integer UGX amount, got ${String(n)}`,
    );
  }
}

/** Asserts `n` is a safe integer (may be negative, e.g. adjustments). */
export function assertSignedUgx(n: unknown, label = 'amount'): asserts n is number {
  if (typeof n !== 'number' || !Number.isSafeInteger(n)) {
    throw new MoneyError(`${label} must be a safe integer UGX amount, got ${String(n)}`);
  }
}

function toSafeNumber(b: bigint, label: string): number {
  if (b > BigInt(Number.MAX_SAFE_INTEGER) || b < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new MoneyError(`${label} is outside the safe integer range`);
  }
  return Number(b);
}

/** Integer division rounded half-up (away from zero for negatives). `den` must be > 0. */
export function divRoundHalfUp(num: number, den: number): number {
  assertSignedUgx(num, 'numerator');
  if (!Number.isSafeInteger(den) || den <= 0) {
    throw new MoneyError(`denominator must be a positive safe integer, got ${String(den)}`);
  }
  const n = BigInt(num);
  const d = BigInt(den);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const q = (abs * 2n + d) / (2n * d);
  return toSafeNumber(neg ? -q : q, 'quotient');
}

/** `amount × bp / 10,000`, rounded half-up. */
export function mulBp(amount: Ugx, bp: Bp): Ugx {
  assertSignedUgx(amount, 'amount');
  if (!Number.isSafeInteger(bp) || bp < 0) {
    throw new MoneyError(`basis points must be a non-negative integer, got ${String(bp)}`);
  }
  const product = BigInt(amount) * BigInt(bp);
  const d = BigInt(BP_DENOMINATOR);
  const neg = product < 0n;
  const abs = neg ? -product : product;
  const q = (abs * 2n + d) / (2n * d);
  return toSafeNumber(neg ? -q : q, 'result');
}

const formatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Formats as `UGX 1,000,000` (negative: `-UGX 1,000`). */
export function formatUgx(n: Ugx): string {
  assertSignedUgx(n, 'amount');
  return n < 0 ? `-UGX ${formatter.format(-n)}` : `UGX ${formatter.format(n)}`;
}

/** Prisma `bigint` → `Ugx`. Throws if outside the safe-integer range. */
export function toUgx(b: bigint): Ugx {
  if (typeof b !== 'bigint') throw new MoneyError(`expected bigint, got ${typeof b}`);
  return toSafeNumber(b, 'amount');
}

/** `Ugx` → Prisma `bigint`. */
export function fromUgx(n: Ugx): bigint {
  assertSignedUgx(n, 'amount');
  return BigInt(n);
}
