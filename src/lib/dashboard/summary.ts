import type { Ugx } from '@/lib/money';

export interface TrendPoint {
  month: string; // YYYY-MM
  label: string; // e.g. "Nov 26"
  gross: Ugx;
  net: Ugx;
}

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/** Gross and net per pay month for the `months` months ending at `endMonth`, zero-filled. */
export function buildTrend(
  points: readonly { payDate: string; gross: Ugx; net: Ugx }[],
  endMonth: string,
  months = 6,
): TrendPoint[] {
  const out: TrendPoint[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const month = shiftMonth(endMonth, -i);
    const [y, m] = month.split('-');
    out.push({ month, label: `${SHORT[Number(m) - 1]} ${y!.slice(2)}`, gross: 0, net: 0 });
  }
  const byMonth = new Map(out.map((p) => [p.month, p]));
  for (const p of points) {
    const t = byMonth.get(p.payDate.slice(0, 7));
    if (t) {
      t.gross += p.gross;
      t.net += p.net;
    }
  }
  return out;
}

export function trendStartMonth(endMonth: string, months = 6): string {
  return shiftMonth(endMonth, -(months - 1));
}

export type RuleState = 'ok' | 'missing' | 'expiring' | 'unapproved' | 'inactive';

export interface RuleVersionLite {
  rule: string;
  active: boolean;
  approved: boolean;
  effectiveFrom: string; // ISO date
  effectiveTo: string | null;
}

export interface RuleStatus {
  rule: string;
  state: RuleState;
  detail: string;
}

/**
 * Status of each required rule today. `expiring` = in force today but ends within `warnDays`.
 * `unapproved` = a version covers today but is not approved; `inactive` = only inactive versions.
 */
export function ruleStatuses(
  versions: readonly RuleVersionLite[],
  required: readonly string[],
  today: string,
  warnDays = 30,
): RuleStatus[] {
  const warnLimit = addDays(today, warnDays);
  return required.map((rule) => {
    const covering = versions.filter(
      (v) =>
        v.rule === rule && v.effectiveFrom <= today && (!v.effectiveTo || v.effectiveTo >= today),
    );
    const inForce = covering.find((v) => v.active && v.approved);
    if (inForce) {
      if (inForce.effectiveTo && inForce.effectiveTo <= warnLimit) {
        const successor = versions.some(
          (v) =>
            v.rule === rule && v.active && v.approved && v.effectiveFrom > inForce.effectiveTo!,
        );
        if (!successor) {
          return {
            rule,
            state: 'expiring',
            detail: `Ends ${inForce.effectiveTo}; no approved successor.`,
          };
        }
      }
      return { rule, state: 'ok', detail: `In force since ${inForce.effectiveFrom}.` };
    }
    if (covering.some((v) => v.active && !v.approved)) {
      return { rule, state: 'unapproved', detail: 'A version exists but is awaiting approval.' };
    }
    if (covering.length > 0 || versions.some((v) => v.rule === rule)) {
      return { rule, state: 'inactive', detail: 'No active, approved version covers today.' };
    }
    return { rule, state: 'missing', detail: 'No version has been entered.' };
  });
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
