import { assertUgx, type Ugx } from '@/lib/money';
import {
  MissingRuleError,
  type EngineComponent,
  type EngineInput,
  type LstParams,
  type NssfParams,
  type PayeParams,
} from '@/lib/payroll-engine';
import type { IsoDate } from './dates';
import { loanLineCode } from './loan-codes';
import type { Frequency } from './periods';

export interface ComponentDef {
  id: string;
  code: string;
  name: string;
  kind: 'EARNING' | 'DEDUCTION' | 'EMPLOYER';
  calcType: 'FIXED' | 'PERCENT_OF_BASIC' | 'RATE_X_QTY';
  taxable: boolean;
  nssfable: boolean;
  prorate: boolean;
  priority: number;
  sortOrder: number;
  isActive: boolean;
}

export interface AssignmentRow {
  componentId: string;
  amount: Ugx | null;
  rateBp: number | null;
  ratePerUnit: Ugx | null;
  effectiveFrom: IsoDate;
  effectiveTo: IsoDate | null;
}

export interface InputRow {
  componentId: string;
  quantity: number | null;
  amount: Ugx | null;
  /** Adjustment explanation (e.g. arrears or an overpayment recovery). */
  note?: string | null;
  /** Human label of the earlier approved run this input corrects, e.g. "Monthly Staff, Oct 2026". */
  adjustsLabel?: string | null;
}

export interface LoanDeductionRow {
  loanId: string;
  code: string;
  amount: Ugx;
}

export interface CarryForwardRow {
  id: string;
  componentCode: string;
  amount: Ugx;
}

export interface BuildInputArgs {
  period: {
    start: IsoDate;
    end: IsoDate;
    payDate: IsoDate;
    frequency: Frequency;
    isLastCycleOfMonth: boolean;
  };
  employee: {
    id: string;
    residency: 'RESIDENT' | 'NON_RESIDENT';
    hireDate: IsoDate;
    exitDate: IsoDate | null;
    payeApplicable: boolean;
    nssfApplicable: boolean;
    lstApplicable: boolean;
  };
  components: ComponentDef[];
  assignments: AssignmentRow[];
  inputs: InputRow[];
  loans: LoanDeductionRow[];
  carryForwards: CarryForwardRow[];
  monthToDate: { taxable: Ugx; payeWithheld: Ugx; gross: Ugx };
  rules: {
    payeRes: PayeParams | null;
    payeNonRes: PayeParams | null;
    nssf: NssfParams | null;
    lst: LstParams | null;
    lstMonths: number[] | null;
  };
  settings: { minNetPayBp: number };
}

export interface BuiltInput {
  input: EngineInput;
  /** CarryForward rows fed into this calculation (settled when the run is approved). */
  carryForwardIds: string[];
  /** Notes about inputs that were ignored or adjusted (shown as warnings). */
  notes: string[];
  /**
   * Explanations to append to the calculated line for a component code, e.g. why an ARREARS or
   * OVERPAYMENT_RECOVERY adjustment was made and which earlier run it corrects.
   */
  lineNotes: Record<string, string>;
}

/** Text explaining one adjustment input, shown on the run page and payslip. */
export function adjustmentNote(note: string, adjustsLabel: string | null | undefined): string {
  const why = note.trim();
  return adjustsLabel ? `Correction to ${adjustsLabel}: ${why}` : `Adjustment: ${why}`;
}

/** Assignment overlaps [start, end] (all inclusive). */
function overlaps(a: AssignmentRow, start: IsoDate, end: IsoDate): boolean {
  return a.effectiveFrom <= end && (a.effectiveTo === null || a.effectiveTo >= start);
}

const HUNDRED = 100;
function roundQty(q: number): number {
  return Math.round(q * HUNDRED) / HUNDRED;
}

/**
 * Maps database rows for one employee and one period to the engine's input. Pure.
 *
 * - Assigned components: for each active component, the assignment overlapping the period with
 *   the latest `effectiveFrom` wins (a mid-period change is not split; the newer value applies).
 * - Period inputs override the assignment for the same component: FIXED → amounts are summed and
 *   replace the assigned amount; RATE_X_QTY → quantities are summed, and an input `amount` (if
 *   any, last wins) overrides the assigned rate per unit. Inputs for PERCENT_OF_BASIC or inactive
 *   components are ignored with a note.
 * - Loans become per-loan DEDUCTION components (`LOAN#<loanId>`), priority of the LOAN/ADVANCE/SACCO
 *   component.
 * - Carry-forwards are passed with the priority of the matching component.
 */
export function buildEngineInput(args: BuildInputArgs): BuiltInput {
  const { period, employee, rules } = args;
  const notes: string[] = [];

  const paye = employee.residency === 'RESIDENT' ? rules.payeRes : rules.payeNonRes;
  if (rules.nssf === null) throw new MissingRuleError('NSSF', `employee ${employee.id}`);

  const byId = new Map(args.components.map((c) => [c.id, c]));
  const byCode = new Map(args.components.map((c) => [c.code, c]));

  // 1. Effective assignment per component.
  const assigned = new Map<string, AssignmentRow>();
  for (const a of args.assignments) {
    if (!overlaps(a, period.start, period.end)) continue;
    const current = assigned.get(a.componentId);
    if (!current || a.effectiveFrom > current.effectiveFrom) assigned.set(a.componentId, a);
  }

  // 2. Period inputs merged per component.
  const adjustmentTexts = new Map<string, string[]>();
  const merged = new Map<
    string,
    { quantity: number | null; amount: Ugx | null; rate: Ugx | null }
  >();
  for (const row of args.inputs) {
    const def = byId.get(row.componentId);
    if (!def) continue;
    if (!def.isActive) {
      notes.push(`INPUT_IGNORED:${def.code} (component inactive)`);
      continue;
    }
    if (def.calcType === 'PERCENT_OF_BASIC') {
      notes.push(`INPUT_IGNORED:${def.code} (percentage components cannot take period inputs)`);
      continue;
    }
    if (row.note && row.note.trim()) {
      const list = adjustmentTexts.get(def.code) ?? [];
      list.push(adjustmentNote(row.note, row.adjustsLabel));
      adjustmentTexts.set(def.code, list);
    }
    const m = merged.get(def.id) ?? { quantity: null, amount: null, rate: null };
    if (def.calcType === 'FIXED') {
      if (row.amount !== null) m.amount = (m.amount ?? 0) + row.amount;
    } else {
      if (row.quantity !== null) m.quantity = roundQty((m.quantity ?? 0) + row.quantity);
      if (row.amount !== null) m.rate = row.amount;
    }
    merged.set(def.id, m);
  }

  // 3. Engine components.
  const componentIds = new Set([...assigned.keys(), ...merged.keys()]);
  const ordered = [...componentIds]
    .map((id) => byId.get(id))
    .filter((c): c is ComponentDef => c !== undefined && c.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

  const components: EngineComponent[] = [];
  for (const def of ordered) {
    const a = assigned.get(def.id);
    const m = merged.get(def.id);
    const base: EngineComponent = {
      code: def.code,
      name: def.name,
      kind: def.kind,
      calcType: def.calcType,
      taxable: def.taxable,
      nssfable: def.nssfable,
      prorate: def.prorate,
      priority: def.priority,
    };
    if (def.calcType === 'FIXED') {
      const amount = m?.amount ?? a?.amount ?? undefined;
      if (amount !== undefined) base.amount = amount;
    } else if (def.calcType === 'PERCENT_OF_BASIC') {
      if (a?.rateBp != null) base.rateBp = a.rateBp;
    } else {
      const rate = m?.rate ?? a?.ratePerUnit ?? undefined;
      if (rate !== undefined) base.ratePerUnit = rate;
      const quantity = m?.quantity ?? undefined;
      if (quantity !== undefined) base.quantity = quantity;
      // A rate-based component with an assignment but no quantity this period earns nothing:
      // skip it silently rather than warning every period.
      if (quantity === undefined && !m) continue;
    }
    components.push(base);
  }

  // 4. Loans.
  for (const loan of args.loans) {
    assertUgx(loan.amount, `loan ${loan.loanId}`);
    if (loan.amount === 0) continue;
    const def = byCode.get(loan.code);
    components.push({
      code: loanLineCode(loan.code, loan.loanId),
      name: def ? `${def.name} repayment` : `${loan.code} repayment`,
      kind: 'DEDUCTION',
      calcType: 'FIXED',
      amount: loan.amount,
      taxable: false,
      nssfable: false,
      prorate: false,
      priority: def?.priority ?? 0,
    });
  }

  // 5. Carry-forwards.
  const carryForward = args.carryForwards
    .filter((cf) => cf.amount > 0)
    .map((cf) => ({
      code: cf.componentCode,
      amount: cf.amount,
      priority: byCode.get(cf.componentCode)?.priority ?? 0,
    }));

  const input: EngineInput = {
    period: {
      start: period.start,
      end: period.end,
      payDate: period.payDate,
      frequency: period.frequency,
      isLastCycleOfMonth: period.isLastCycleOfMonth,
    },
    employee: { ...employee },
    components,
    monthToDate:
      period.frequency === 'MONTHLY'
        ? { taxable: 0, payeWithheld: 0, gross: 0 }
        : { ...args.monthToDate },
    carryForward,
    rules: {
      paye,
      nssf: rules.nssf,
      lst: rules.lst,
      ...(rules.lstMonths ? { lstMonths: rules.lstMonths } : {}),
    },
    settings: { minNetPayBp: args.settings.minNetPayBp },
  };

  return {
    input,
    carryForwardIds: args.carryForwards.filter((cf) => cf.amount > 0).map((cf) => cf.id),
    notes,
    lineNotes: Object.fromEntries(
      [...adjustmentTexts].map(([code, list]) => [code, list.join('; ')]),
    ),
  };
}
