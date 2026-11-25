import { assertUgx, divRoundHalfUp, formatUgx } from '@/lib/money';
import { parseIsoDate } from './dates';
import { WARNINGS, type IsoDate, type LstParams, type Ugx } from './types';

export interface LstArgs {
  params: LstParams | null;
  /** Months LST is collected in, used only when `params` is null (to decide whether to warn). */
  fallbackMonths?: number[];
  payDate: IsoDate;
  isLastCycleOfMonth: boolean;
  applicable: boolean;
  /** Gross for the whole month: month-to-date gross + this cycle's gross. */
  monthlyGross: Ugx;
}

export interface LstResult {
  amount: Ugx;
  note: string;
  warning: string | null;
}

/**
 * Local Service Tax instalment. Collected only in the rule's months, on the last pay cycle of the
 * month. The band is chosen on monthly gross: `from ≤ gross < to` (last band open-ended).
 * Instalment = `round_half_up(annual ÷ instalments)`.
 */
export function lstInstalment(args: LstArgs): LstResult {
  assertUgx(args.monthlyGross, 'monthly gross');
  const month = parseIsoDate(args.payDate).month;

  if (!args.applicable) {
    return {
      amount: 0,
      note: 'LST not applicable for this employee (lstApplicable = false)',
      warning: null,
    };
  }
  if (args.params === null) {
    const inLstMonth = args.fallbackMonths === undefined || args.fallbackMonths.includes(month);
    if (inLstMonth && args.isLastCycleOfMonth) {
      return {
        amount: 0,
        note: 'No active approved LST rule; LST not deducted',
        warning: WARNINGS.LST_RULE_MISSING,
      };
    }
    return { amount: 0, note: 'Not an LST month', warning: null };
  }
  if (!args.params.months.includes(month)) {
    return { amount: 0, note: 'Not an LST month', warning: null };
  }
  if (!args.isLastCycleOfMonth) {
    return { amount: 0, note: 'LST is deducted on the last pay cycle of the month', warning: null };
  }
  const gross = args.monthlyGross;
  const band = args.params.bands.find((b) => gross >= b.from && (b.to === null || gross < b.to));
  if (!band) {
    return { amount: 0, note: 'No LST band configured for this income', warning: null };
  }
  const amount = divRoundHalfUp(band.annual, args.params.instalments);
  return {
    amount,
    note: `Annual LST ${formatUgx(band.annual)} ÷ ${args.params.instalments} instalments (monthly gross ${formatUgx(gross)})`,
    warning: null,
  };
}
