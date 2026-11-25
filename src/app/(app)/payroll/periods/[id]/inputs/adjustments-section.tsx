import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatUgx, toUgx } from '@/lib/money';
import { ADJUSTMENT_CODES, ADJUSTMENT_LABELS, NOTE_MAX } from '@/lib/payroll/adjustments';
import { formatIsoDate, toIsoDate } from '@/lib/payroll/dates';
import type { listAdjustments } from '@/lib/payroll/server/periods-inputs';
import { ActionForm } from '../../../_components/action-form';
import { addAdjustmentAction, removeAdjustmentAction } from '../../../actions';

const SELECT =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm ' +
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

type Adjustment = Awaited<ReturnType<typeof listAdjustments>>[number];

/**
 * Arrears and overpayment recoveries for this period. Each one explains the correction and links
 * to the earlier approved run it corrects; that run is never edited.
 */
export function AdjustmentsSection({
  periodId,
  editable,
  employees,
  runs,
  adjustments,
  preselect,
}: {
  periodId: string;
  editable: boolean;
  employees: Array<{ id: string; staffNo: string; name: string }>;
  runs: Array<{ runId: string; label: string }>;
  adjustments: Adjustment[];
  preselect: { employeeId?: string; runId?: string };
}) {
  return (
    <Card id="adjustments">
      <CardHeader>
        <CardTitle>Adjustments to earlier runs</CardTitle>
        <CardDescription>
          Approved payrolls are never edited. If someone was under-paid, add arrears; if they were
          over-paid, add an overpayment recovery. Each adjustment needs an explanation and the run
          it corrects, and both appear on the payslip. Recompute the run afterwards.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {adjustments.length ? (
          <ul className="divide-y rounded-md border text-sm">
            {adjustments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
                <div className="min-w-0 space-y-0.5">
                  <p className="font-medium">
                    {a.employee.staffNo} {a.employee.firstName} {a.employee.lastName} ·{' '}
                    {a.component.name}{' '}
                    <span className="tabular-nums">
                      {a.amount === null ? '' : formatUgx(toUgx(a.amount))}
                    </span>
                  </p>
                  <p className="text-muted-foreground">
                    {a.adjustsRun
                      ? `Corrects run ${formatIsoDate(toIsoDate(a.adjustsRun.period.startDate))} – ${formatIsoDate(toIsoDate(a.adjustsRun.period.endDate))}: `
                      : ''}
                    {a.note}
                    {a.source === 'IMPORT' ? ' (imported)' : ''}
                  </p>
                </div>
                {editable && a.source === 'MANUAL' ? (
                  <ActionForm
                    action={removeAdjustmentAction}
                    fields={{ inputId: a.id }}
                    label="Remove"
                    variant="outline"
                    confirm="Remove this adjustment?"
                  />
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No adjustments in this period.</p>
        )}

        {editable ? (
          runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              There are no earlier approved runs to correct yet.
            </p>
          ) : (
            <ActionForm
              action={addAdjustmentAction}
              fields={{ periodId }}
              label="Add adjustment"
              className="grid gap-3 sm:grid-cols-2"
            >
              <div className="space-y-1">
                <Label htmlFor="adj-employee">Employee</Label>
                <select
                  id="adj-employee"
                  name="employeeId"
                  required
                  defaultValue={preselect.employeeId ?? ''}
                  className={SELECT}
                >
                  <option value="" disabled>
                    Choose…
                  </option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.staffNo} {e.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="adj-run">Run being corrected</Label>
                <select
                  id="adj-run"
                  name="adjustsRunId"
                  required
                  defaultValue={preselect.runId ?? ''}
                  className={SELECT}
                >
                  <option value="" disabled>
                    Choose…
                  </option>
                  {runs.map((r) => (
                    <option key={r.runId} value={r.runId}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="adj-type">Type</Label>
                <select id="adj-type" name="componentCode" required className={SELECT}>
                  {ADJUSTMENT_CODES.map((c) => (
                    <option key={c} value={c}>
                      {ADJUSTMENT_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="adj-amount">Amount (UGX)</Label>
                <Input
                  id="adj-amount"
                  name="amount"
                  inputMode="numeric"
                  required
                  placeholder="e.g. 150000"
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="adj-note">Explanation</Label>
                <Input
                  id="adj-note"
                  name="note"
                  required
                  minLength={5}
                  maxLength={NOTE_MAX}
                  placeholder="e.g. 10 overtime hours on 14 Oct were left out"
                />
              </div>
            </ActionForm>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
