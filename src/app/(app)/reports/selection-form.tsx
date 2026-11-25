import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { db } from '@/lib/db';
import { fmtDate, runStatusLabel } from '@/lib/reports/format';
import { financialYearOf, fyLabel, type Selection } from '@/lib/reports/range';

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** GET form that drives every report. Server component: lists recent runs for run mode. */
export async function SelectionForm({
  action,
  selection,
  today,
  showGrouping = false,
}: {
  action: string;
  selection: Selection;
  today: string;
  showGrouping?: boolean;
}) {
  const runs = await db.payrollRun.findMany({
    where: { status: { not: 'REJECTED' } },
    orderBy: [{ period: { payDate: 'desc' } }],
    take: 36,
    select: { id: true, status: true, period: { select: { payDate: true } }, payGroup: { select: { name: true } } },
  });
  const currentFy = financialYearOf(today);
  const fys = Array.from({ length: 6 }, (_, i) => currentFy - i);

  return (
    <Card>
      <CardContent className="pt-6">
        <form method="get" action={action} className="space-y-4">
          <fieldset className="grid gap-4 md:grid-cols-3">
            <legend className="sr-only">Which payroll runs</legend>
            <div className="space-y-2">
              <Label htmlFor="mode">Report on</Label>
              <NativeSelect id="mode" name="mode" defaultValue={selection.mode}>
                <option value="month">A pay month</option>
                <option value="fy">A financial year (Jul–Jun)</option>
                <option value="runs">Specific runs</option>
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="month">Pay month</Label>
              <Input
                id="month"
                name="month"
                type="month"
                defaultValue={selection.month ?? today.slice(0, 7)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fy">Financial year</Label>
              <NativeSelect id="fy" name="fy" defaultValue={String(selection.fy ?? currentFy)}>
                {fys.map((y) => (
                  <option key={y} value={y}>
                    {fyLabel(y)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </fieldset>

          <details open={selection.mode === 'runs'} className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              Specific runs (used when “Specific runs” is selected)
            </summary>
            {runs.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No payroll runs yet.</p>
            ) : (
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {runs.map((r) => (
                  <label key={r.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="run"
                      value={r.id}
                      defaultChecked={selection.runIds.includes(r.id)}
                    />
                    <span>
                      {fmtDate(iso(r.period.payDate))} · {r.payGroup.name}{' '}
                      <span className="text-muted-foreground">({runStatusLabel(r.status)})</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </details>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="draft" value="1" defaultChecked={selection.includeDraft} />
              Include unapproved (draft) runs — figures are <strong>not final</strong>
            </label>
            {showGrouping ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="group"
                  value="1"
                  defaultChecked={selection.groupByDepartment}
                />
                Group by department
              </label>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button type="submit">Show report</Button>
            <Button asChild variant="ghost">
              <Link href={action}>Reset</Link>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
