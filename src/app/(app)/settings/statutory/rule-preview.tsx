import type { StatutoryRule } from '@prisma/client';
import { divRoundHalfUp, formatUgx, mulBp } from '@/lib/money';
import {
  payeMonthly,
  type LstParams,
  type NssfParams,
  type PayeParams,
} from '@/lib/payroll-engine';
import { bpToPercent } from '@/lib/settings/input';

/** Sample monthly incomes for the sanity-check preview (display only). */
const SAMPLE_INCOMES = [200_000, 335_000, 400_000, 500_000, 1_000_000, 5_000_000, 12_000_000];
const NSSF_SAMPLE = 1_000_000;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function monthName(m: number): string {
  return MONTH_NAMES[m - 1] ?? String(m);
}

const cell = 'px-2 py-1.5 text-left';
const num = 'px-2 py-1.5 text-right tabular-nums';

function range(from: number, to: number | null) {
  return to === null ? `${formatUgx(from)} and above` : `${formatUgx(from)} – ${formatUgx(to)}`;
}

/** Read-only rendering of rule params plus a worked sanity check. Server- and client-safe. */
export function RulePreview({ rule, params }: { rule: StatutoryRule; params: unknown }) {
  if (rule === 'NSSF') {
    const p = params as NssfParams;
    const base = p.ceiling === null ? NSSF_SAMPLE : Math.min(NSSF_SAMPLE, p.ceiling);
    return (
      <div className="space-y-3 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">Employee</dt>
          <dd>{bpToPercent(p.employeeRateBp)}%</dd>
          <dt className="text-muted-foreground">Employer</dt>
          <dd>{bpToPercent(p.employerRateBp)}%</dd>
          <dt className="text-muted-foreground">Ceiling</dt>
          <dd>{p.ceiling === null ? 'None' : formatUgx(p.ceiling)}</dd>
        </dl>
        <p className="rounded-md bg-muted px-3 py-2">
          On {formatUgx(NSSF_SAMPLE)} NSSF-able pay: employee {formatUgx(mulBp(base, p.employeeRateBp))},
          employer {formatUgx(mulBp(base, p.employerRateBp))}.
        </p>
      </div>
    );
  }

  if (rule === 'LST') {
    const p = params as LstParams;
    return (
      <div className="space-y-3 text-sm">
        <p>
          Collected in {p.months.map(monthName).join(', ') || 'no months'} · {p.instalments}{' '}
          instalment{p.instalments === 1 ? '' : 's'} · banded on monthly gross.
        </p>
        {p.bands.length === 0 ? (
          <p className="rounded-md bg-warning/15 px-3 py-2">
            No bands entered. LST cannot be approved until bands are added.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-96 text-sm">
              <thead className="text-muted-foreground">
                <tr>
                  <th className={cell}>Monthly gross</th>
                  <th className={num}>Annual LST</th>
                  <th className={num}>Per instalment</th>
                </tr>
              </thead>
              <tbody>
                {p.bands.map((b, i) => (
                  <tr key={i} className="border-t">
                    <td className={cell}>{range(b.from, b.to)}</td>
                    <td className={num}>{formatUgx(b.annual)}</td>
                    <td className={num}>{formatUgx(divRoundHalfUp(b.annual, p.instalments))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  const p = params as PayeParams;
  return (
    <div className="grid gap-6 text-sm lg:grid-cols-2">
      <div className="space-y-2">
        <p className="font-medium">Monthly bands</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-72">
            <thead className="text-muted-foreground">
              <tr>
                <th className={cell}>Chargeable income</th>
                <th className={num}>Rate</th>
              </tr>
            </thead>
            <tbody>
              {p.bands.map((b, i) => (
                <tr key={i} className="border-t">
                  <td className={cell}>{range(b.from, b.to)}</td>
                  <td className={num}>{bpToPercent(b.rateBp)}%</td>
                </tr>
              ))}
              {p.surcharge ? (
                <tr className="border-t">
                  <td className={cell}>Surcharge above {formatUgx(p.surcharge.threshold)}</td>
                  <td className={num}>+{bpToPercent(p.surcharge.rateBp)}%</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
      <div className="space-y-2">
        <p className="font-medium">Sanity check</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-72">
            <thead className="text-muted-foreground">
              <tr>
                <th className={cell}>Monthly income</th>
                <th className={num}>PAYE</th>
                <th className={num}>Effective</th>
              </tr>
            </thead>
            <tbody>
              {SAMPLE_INCOMES.map((inc) => {
                const tax = payeMonthly(p, inc);
                return (
                  <tr key={inc} className="border-t">
                    <td className={cell}>{formatUgx(inc)}</td>
                    <td className={num}>{formatUgx(tax)}</td>
                    <td className={num}>{((tax / inc) * 100).toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
