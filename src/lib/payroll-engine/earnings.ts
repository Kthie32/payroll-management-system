import { assertUgx, divRoundHalfUp, formatUgx, mulBp } from '@/lib/money';
import { daysEmployed, daysInclusive } from './dates';
import { InvalidInputError } from './errors';
import {
  BASIC_CODE,
  WARNINGS,
  type EngineComponent,
  type EngineInput,
  type EngineLine,
  type Ugx,
} from './types';

const HUNDREDTHS = 100;

/** `round_half_up(amount × daysWorked ÷ daysInPeriod)`. Full amount when worked ≥ period. */
export function prorate(amount: Ugx, daysWorked: number, daysInPeriod: number): Ugx {
  assertUgx(amount, 'amount');
  if (!Number.isInteger(daysInPeriod) || daysInPeriod <= 0) {
    throw new InvalidInputError(`daysInPeriod must be a positive integer, got ${daysInPeriod}`);
  }
  if (!Number.isInteger(daysWorked) || daysWorked < 0) {
    throw new InvalidInputError(`daysWorked must be a non-negative integer, got ${daysWorked}`);
  }
  if (daysWorked >= daysInPeriod) return amount;
  return divRoundHalfUp(amount * daysWorked, daysInPeriod);
}

/** Rate × quantity, quantity in at most two decimals, rounded half-up. */
export function rateTimesQuantity(ratePerUnit: Ugx, quantity: number): Ugx {
  assertUgx(ratePerUnit, 'ratePerUnit');
  const hundredths = Math.round(quantity * HUNDREDTHS);
  if (hundredths < 0) throw new InvalidInputError(`quantity must be ≥ 0, got ${quantity}`);
  return divRoundHalfUp(ratePerUnit * hundredths, HUNDREDTHS);
}

function formatBp(rateBp: number): string {
  return `${(rateBp / HUNDREDTHS).toFixed(2)}%`;
}

export interface ComponentAmount {
  amount: Ugx;
  quantity: number | null;
  rate: number | null;
  note: string;
  warning: string | null;
}

/**
 * Amount for one component before any proration.
 * - FIXED: `amount`
 * - PERCENT_OF_BASIC: `mulBp(basic, rateBp)` (basic is already prorated)
 * - RATE_X_QTY: `round_half_up(ratePerUnit × quantity)`
 * A missing value yields 0 and a `COMPONENT_MISSING_VALUE:<code>` warning.
 */
export function componentAmount(component: EngineComponent, basic: Ugx): ComponentAmount {
  const missing = (what: string): ComponentAmount => ({
    amount: 0,
    quantity: null,
    rate: null,
    note: `No ${what} supplied; nothing paid`,
    warning: `${WARNINGS.COMPONENT_MISSING_VALUE}:${component.code}`,
  });

  switch (component.calcType) {
    case 'FIXED':
      if (component.amount === undefined) return missing('amount');
      return {
        amount: component.amount,
        quantity: null,
        rate: null,
        note: 'Fixed amount',
        warning: null,
      };
    case 'PERCENT_OF_BASIC':
      if (component.rateBp === undefined) return missing('rate');
      return {
        amount: mulBp(basic, component.rateBp),
        quantity: null,
        rate: component.rateBp,
        note: `${formatBp(component.rateBp)} of basic ${formatUgx(basic)}`,
        warning: null,
      };
    case 'RATE_X_QTY':
      if (component.ratePerUnit === undefined) return missing('rate per unit');
      if (component.quantity === undefined) return missing('quantity');
      return {
        amount: rateTimesQuantity(component.ratePerUnit, component.quantity),
        quantity: component.quantity,
        rate: component.ratePerUnit,
        note: `${component.quantity} × ${formatUgx(component.ratePerUnit)}`,
        warning: null,
      };
  }
}

export interface EarningsResult {
  lines: EngineLine[];
  /** Prorated basic pay (sum of BASIC components). */
  basic: Ugx;
  gross: Ugx;
  taxable: Ugx;
  nssfBase: Ugx;
  daysWorked: number;
  daysInPeriod: number;
  warnings: string[];
}

/**
 * Computes all EARNING components. BASIC is computed first so PERCENT_OF_BASIC components can
 * use the prorated basic. Proration (calendar days) applies to FIXED components with
 * `prorate = true`; PERCENT_OF_BASIC follows the already-prorated basic, and RATE_X_QTY reflects
 * actual quantities, so neither is prorated again.
 */
export function computeEarnings(
  input: Pick<EngineInput, 'components' | 'period' | 'employee'>,
): EarningsResult {
  const { period, employee } = input;
  const daysInPeriod = daysInclusive(period.start, period.end);
  const daysWorked = daysEmployed(period.start, period.end, employee.hireDate, employee.exitDate);
  const warnings: string[] = [];
  if (daysWorked === 0) warnings.push(WARNINGS.NO_DAYS_WORKED);

  const earnings = input.components.filter((c) => c.kind === 'EARNING');
  const ordered = [
    ...earnings.filter((c) => c.code === BASIC_CODE),
    ...earnings.filter((c) => c.code !== BASIC_CODE),
  ];

  const computed = new Map<EngineComponent, EngineLine>();
  let basic = 0;
  let gross = 0;
  let taxable = 0;
  let nssfBase = 0;

  for (const component of ordered) {
    const base = componentAmount(component, basic);
    if (base.warning) warnings.push(base.warning);
    let amount = base.amount;
    let note = base.note;
    if (component.prorate && component.calcType === 'FIXED' && daysWorked < daysInPeriod) {
      amount = prorate(base.amount, daysWorked, daysInPeriod);
      note = `Prorated ${daysWorked}/${daysInPeriod} days of ${formatUgx(base.amount)}`;
    }
    if (component.code === BASIC_CODE) basic += amount;
    gross += amount;
    if (component.taxable) taxable += amount;
    if (component.nssfable) nssfBase += amount;
    if (!component.taxable) note += ' (not taxable)';
    computed.set(component, {
      code: component.code,
      kind: 'EARNING',
      quantity: base.quantity,
      rate: base.rate,
      amount,
      note,
    });
  }

  // Lines keep the caller's order (by sortOrder), not the computation order.
  const lines = earnings.map((c) => computed.get(c)!);
  return { lines, basic, gross, taxable, nssfBase, daysWorked, daysInPeriod, warnings };
}
