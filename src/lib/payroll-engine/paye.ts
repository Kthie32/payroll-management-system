import { assertUgx, BP_DENOMINATOR, toUgx } from '@/lib/money';
import type { PayeParams, Ugx } from './types';

const D = BigInt(BP_DENOMINATOR);

/** Rounds a sum of `amount × bp` products to whole shillings, half-up, once. */
function roundBpProducts(sum: bigint): Ugx {
  return toUgx((sum * 2n + D) / (2n * D));
}

/**
 * PAYE on a month's chargeable income using monthly bands plus an optional surcharge on the
 * amount above a threshold. Computed exactly and rounded half-up once.
 */
export function payeMonthly(params: PayeParams, chargeable: Ugx): Ugx {
  assertUgx(chargeable, 'chargeable income');
  const income = BigInt(chargeable);
  let sum = 0n;
  for (const band of params.bands) {
    const from = BigInt(band.from);
    if (income <= from) break;
    const upper = band.to === null ? income : BigInt(Math.min(band.to, chargeable));
    sum += (upper - from) * BigInt(band.rateBp);
  }
  if (params.surcharge && chargeable > params.surcharge.threshold) {
    sum += (income - BigInt(params.surcharge.threshold)) * BigInt(params.surcharge.rateBp);
  }
  return roundBpProducts(sum);
}

export interface PayeCumulativeArgs {
  params: PayeParams;
  /** Taxable pay already processed earlier in the same month. */
  mtdTaxable: Ugx;
  /** PAYE already withheld earlier in the same month. */
  mtdPayeWithheld: Ugx;
  /** Taxable pay in this cycle. */
  taxable: Ugx;
}

export interface PayeCumulativeResult {
  paye: Ugx;
  /** Tax due for the whole month so far (including this cycle). */
  monthTotal: Ugx;
  /** True when more was withheld earlier than is due for the month (PAYE floored at 0). */
  overwithheld: boolean;
}

/** Cumulative PAYE for weekly/fortnightly cycles: month-to-date tax minus tax already withheld. */
export function payeCumulative(args: PayeCumulativeArgs): PayeCumulativeResult {
  assertUgx(args.mtdTaxable, 'mtdTaxable');
  assertUgx(args.mtdPayeWithheld, 'mtdPayeWithheld');
  assertUgx(args.taxable, 'taxable');
  const monthTotal = payeMonthly(args.params, args.mtdTaxable + args.taxable);
  const due = monthTotal - args.mtdPayeWithheld;
  return { paye: Math.max(0, due), monthTotal, overwithheld: due < 0 };
}
