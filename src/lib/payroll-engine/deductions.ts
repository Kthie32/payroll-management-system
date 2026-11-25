import { assertUgx, formatUgx, mulBp } from '@/lib/money';
import type { Bp, CarryForwardItem, Ugx } from './types';

export interface DeductionRequest {
  code: string;
  amount: Ugx;
  priority: number;
}

export interface AppliedDeduction {
  code: string;
  requested: Ugx;
  amount: Ugx;
  carried: Ugx;
  /** True for amounts brought forward from an earlier period. */
  fromCarryForward: boolean;
  note: string;
}

export interface ApplyDeductionsArgs {
  /** Gross − PAYE − NSSF employee − LST. */
  netBeforeDeductions: Ugx;
  gross: Ugx;
  minNetPayBp: Bp;
  carryForward: DeductionRequest[];
  deductions: DeductionRequest[];
}

export interface ApplyDeductionsResult {
  applied: AppliedDeduction[];
  total: Ugx;
  /** Allowed total = max(0, netBeforeDeductions − mulBp(gross, minNetPayBp)). */
  allowed: Ugx;
  /** Unpaid remainders, merged by code, to carry into the next period. */
  carryForward: CarryForwardItem[];
}

const byPriorityThenCode = (a: DeductionRequest, b: DeductionRequest): number =>
  a.priority - b.priority || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);

/**
 * Applies non-statutory deductions without taking net pay below the floor
 * `mulBp(gross, minNetPayBp)`. Carried-forward amounts go first, then current deductions;
 * each group by priority ascending, ties by code. Unpaid remainders are carried forward.
 */
export function applyDeductions(args: ApplyDeductionsArgs): ApplyDeductionsResult {
  assertUgx(args.netBeforeDeductions, 'netBeforeDeductions');
  assertUgx(args.gross, 'gross');
  const floor = mulBp(args.gross, args.minNetPayBp);
  const allowed = Math.max(0, args.netBeforeDeductions - floor);
  let remaining = allowed;

  const queue = [
    ...[...args.carryForward]
      .sort(byPriorityThenCode)
      .map((d) => ({ ...d, fromCarryForward: true })),
    ...[...args.deductions]
      .sort(byPriorityThenCode)
      .map((d) => ({ ...d, fromCarryForward: false })),
  ];

  const applied: AppliedDeduction[] = [];
  const carried = new Map<string, Ugx>();
  for (const d of queue) {
    assertUgx(d.amount, `deduction ${d.code}`);
    const amount = Math.min(d.amount, remaining);
    remaining -= amount;
    const rest = d.amount - amount;
    if (rest > 0) carried.set(d.code, (carried.get(d.code) ?? 0) + rest);

    const origin = d.fromCarryForward ? 'Carried forward from a previous period' : 'Current period';
    const note =
      rest === 0
        ? origin
        : `${origin}; ${formatUgx(amount)} of ${formatUgx(d.amount)} deducted, ${formatUgx(rest)} carried forward (net pay floor)`;
    applied.push({
      code: d.code,
      requested: d.amount,
      amount,
      carried: rest,
      fromCarryForward: d.fromCarryForward,
      note,
    });
  }

  return {
    applied,
    total: allowed - remaining,
    allowed,
    carryForward: [...carried].map(([code, amount]) => ({ code, amount })),
  };
}
