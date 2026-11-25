import type { StatutoryRule } from '@prisma/client';
import type { LstParams, NssfParams, PayeParams } from '@/lib/payroll-engine';
import { bpToPercent, parseUgxInput, percentToBp } from './input';
import { parseRuleParams } from './rules';

/**
 * Statutory rule entry forms work in human units (UGX amounts as text, rates as percentages);
 * stored params use integer UGX and basis points. Client-safe and pure.
 */

export interface PayeForm {
  bands: { from: string; to: string; rate: string }[];
  surchargeThreshold: string;
  surchargeRate: string;
}
export interface NssfForm {
  employeeRate: string;
  employerRate: string;
  ceiling: string;
}
export interface LstForm {
  bands: { from: string; to: string; annual: string }[];
  instalments: string;
  months: number[];
}
export type RuleForm =
  | { rule: 'PAYE_RES' | 'PAYE_NONRES'; paye: PayeForm }
  | { rule: 'NSSF'; nssf: NssfForm }
  | { rule: 'LST'; lst: LstForm };

type Result = { ok: true; params: PayeParams | NssfParams | LstParams } | { ok: false; error: string };

function amount(label: string, s: string): number {
  const n = parseUgxInput(s);
  if (n === null) throw new Error(`${label}: enter a whole UGX amount`);
  return n;
}
function optionalAmount(label: string, s: string): number | null {
  return s.trim() === '' ? null : amount(label, s);
}
function rate(label: string, s: string): number {
  const bp = percentToBp(s);
  if (bp === null) throw new Error(`${label}: enter a percentage with at most two decimals`);
  return bp;
}

export function ruleFormToParams(form: RuleForm): Result {
  let params: unknown;
  try {
    if (form.rule === 'NSSF') {
      params = {
        employeeRateBp: rate('Employee rate', form.nssf.employeeRate),
        employerRateBp: rate('Employer rate', form.nssf.employerRate),
        ceiling: optionalAmount('Ceiling', form.nssf.ceiling),
      } satisfies NssfParams;
    } else if (form.rule === 'LST') {
      const instalments = Number(form.lst.instalments);
      if (!Number.isInteger(instalments) || instalments < 1) {
        throw new Error('Instalments: enter a whole number of at least 1');
      }
      params = {
        bands: form.lst.bands.map((b, i) => ({
          from: amount(`Band ${i + 1} from`, b.from),
          to: optionalAmount(`Band ${i + 1} to`, b.to),
          annual: amount(`Band ${i + 1} annual LST`, b.annual),
        })),
        instalments,
        months: [...new Set(form.lst.months)].sort((a, b) => a - b),
        basis: 'MONTHLY_GROSS',
      } satisfies LstParams;
    } else {
      const { surchargeThreshold: t, surchargeRate: r } = form.paye;
      const hasSurcharge = t.trim() !== '' || r.trim() !== '';
      params = {
        bands: form.paye.bands.map((b, i) => ({
          from: amount(`Band ${i + 1} from`, b.from),
          to: optionalAmount(`Band ${i + 1} to`, b.to),
          rateBp: rate(`Band ${i + 1} rate`, b.rate),
        })),
        surcharge: hasSurcharge
          ? { threshold: amount('Surcharge threshold', t), rateBp: rate('Surcharge rate', r) }
          : null,
      } satisfies PayeParams;
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  return parseRuleParams(form.rule, params);
}

const blank = (n: number | null) => (n === null ? '' : String(n));

/** Pre-fill a form from stored params (e.g. the current version), or sensible empties. */
export function paramsToRuleForm(rule: StatutoryRule, params: unknown): RuleForm {
  const parsed = params === undefined ? null : parseRuleParams(rule, params);
  const p = parsed?.ok ? parsed.params : null;
  if (rule === 'NSSF') {
    const n = p as NssfParams | null;
    return {
      rule,
      nssf: {
        employeeRate: n ? bpToPercent(n.employeeRateBp) : '',
        employerRate: n ? bpToPercent(n.employerRateBp) : '',
        ceiling: n ? blank(n.ceiling) : '',
      },
    };
  }
  if (rule === 'LST') {
    const l = p as LstParams | null;
    // Fall back to raw months/instalments so an inactive draft with no bands still pre-fills.
    const raw = (params ?? {}) as { months?: unknown; instalments?: unknown };
    return {
      rule,
      lst: {
        bands: (l?.bands ?? []).map((b) => ({
          from: String(b.from),
          to: blank(b.to),
          annual: String(b.annual),
        })),
        instalments: String(l?.instalments ?? (typeof raw.instalments === 'number' ? raw.instalments : '')),
        months: l?.months ?? (Array.isArray(raw.months) ? (raw.months as number[]) : []),
      },
    };
  }
  const y = p as PayeParams | null;
  return {
    rule,
    paye: {
      bands: (y?.bands ?? [{ from: 0, to: null, rateBp: 0 }]).map((b) => ({
        from: String(b.from),
        to: blank(b.to),
        rate: bpToPercent(b.rateBp),
      })),
      surchargeThreshold: y?.surcharge ? String(y.surcharge.threshold) : '',
      surchargeRate: y?.surcharge ? bpToPercent(y.surcharge.rateBp) : '',
    },
  };
}
