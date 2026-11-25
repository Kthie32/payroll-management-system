import type { TrendPoint } from '@/lib/dashboard/summary';
import { fmtCompactUgx, fmtMoney } from '@/lib/reports/format';

/** Paired CSS bars (gross, net) per month. No chart library; accessible via a hidden table. */
export function TrendChart({ points }: { points: TrendPoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.gross));
  const empty = points.every((p) => p.gross === 0 && p.net === 0);

  return (
    <div className="space-y-3">
      {empty ? (
        <p className="text-sm text-muted-foreground">No approved payroll in the last six months.</p>
      ) : null}
      <div className="flex h-48 items-end gap-2 sm:gap-4" aria-hidden="true">
        {points.map((p) => (
          <div key={p.month} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
            <div className="flex h-full w-full items-end justify-center gap-1">
              <div
                className="w-1/2 max-w-6 rounded-t bg-primary/40"
                style={{ height: `${(p.gross / max) * 100}%` }}
                title={`Gross ${fmtCompactUgx(p.gross)}`}
              />
              <div
                className="w-1/2 max-w-6 rounded-t bg-primary"
                style={{ height: `${(p.net / max) * 100}%` }}
                title={`Net ${fmtCompactUgx(p.net)}`}
              />
            </div>
            <span className="text-xs text-muted-foreground">{p.label}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-4 text-xs text-muted-foreground" aria-hidden="true">
        <span className="flex items-center gap-1">
          <span className="inline-block size-3 rounded-sm bg-primary/40" /> Gross
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-3 rounded-sm bg-primary" /> Net
        </span>
      </div>
      <table className="sr-only">
        <caption>Gross and net pay by month</caption>
        <thead>
          <tr>
            <th>Month</th>
            <th>Gross (UGX)</th>
            <th>Net (UGX)</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.month}>
              <td>{p.label}</td>
              <td>{fmtMoney(p.gross)}</td>
              <td>{fmtMoney(p.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
