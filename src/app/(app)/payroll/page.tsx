import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/db';
import { formatUgx } from '@/lib/money';
import { formatIsoDate, toIsoDate } from '@/lib/payroll/dates';
import { STATUS_LABELS, type RunStatus } from '@/lib/payroll/status';
import { parseTotals } from '@/lib/payroll/totals';
import { can, requirePermission } from '@/lib/rbac';
import { ActionForm } from './_components/action-form';
import { RunStatusBadge } from './_components/status-badge';
import { createRunAction } from './actions';

export const metadata = { title: 'Payroll · Payroll' };
export const dynamic = 'force-dynamic';

const STATUSES = Object.keys(STATUS_LABELS) as RunStatus[];

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission('payroll.view');
  const canPrepare = can(user.roles, 'payroll.prepare');
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
  const payGroupId = one(sp.payGroupId);
  const statusParam = one(sp.status);
  const status = STATUSES.includes(statusParam as RunStatus) ? (statusParam as RunStatus) : undefined;

  const [groups, runs, openablePeriods] = await Promise.all([
    db.payGroup.findMany({ orderBy: { name: 'asc' } }),
    db.payrollRun.findMany({
      where: { ...(payGroupId ? { payGroupId } : {}), ...(status ? { status } : {}) },
      include: { period: true, payGroup: true },
      orderBy: [{ period: { payDate: 'desc' } }, { createdAt: 'desc' }],
      take: 100,
    }),
    canPrepare
      ? db.payPeriod.findMany({
          where: { runs: { none: { status: { not: 'REJECTED' } } } },
          include: { payGroup: true },
          orderBy: [{ payDate: 'asc' }],
          take: 200,
        })
      : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Payroll</h1>
        <Button asChild variant="outline">
          <Link href="/payroll/periods">Pay periods &amp; inputs</Link>
        </Button>
      </div>

      {canPrepare ? (
        <Card>
          <CardHeader>
            <CardTitle>Start a payroll run</CardTitle>
            <CardDescription>
              Pick a pay period. Generate periods first under “Pay periods &amp; inputs” if the one
              you need is missing.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {openablePeriods.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Every pay period already has a run. Generate more periods to continue.
              </p>
            ) : (
              <ActionForm
                action={createRunAction}
                fields={{}}
                label="Create run"
                pendingLabel="Creating…"
                className="flex flex-col gap-3 sm:flex-row sm:items-end"
              >
                <div className="w-full space-y-2 sm:max-w-md">
                  <Label htmlFor="periodId">Pay period</Label>
                  <NativeSelect id="periodId" name="periodId" required defaultValue="">
                    <option value="" disabled>
                      Select a period…
                    </option>
                    {openablePeriods.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.payGroup.name}: {formatIsoDate(toIsoDate(p.startDate))} –{' '}
                        {formatIsoDate(toIsoDate(p.endDate))} (pay {formatIsoDate(toIsoDate(p.payDate))})
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </ActionForm>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Runs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 px-0 sm:px-6">
          <form className="flex flex-col gap-3 px-6 sm:flex-row sm:items-end sm:px-0" method="get">
            <div className="space-y-2 sm:w-56">
              <Label htmlFor="f-group">Pay group</Label>
              <NativeSelect id="f-group" name="payGroupId" defaultValue={payGroupId ?? ''}>
                <option value="">All pay groups</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2 sm:w-56">
              <Label htmlFor="f-status">Status</Label>
              <NativeSelect id="f-status" name="status" defaultValue={status ?? ''}>
                <option value="">Any status</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Button type="submit" variant="secondary">
              Filter
            </Button>
          </form>

          {runs.length === 0 ? (
            <p className="px-6 text-sm text-muted-foreground sm:px-0">No runs match.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Pay group</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Employees</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => {
                  const t = parseTotals(r.totals);
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Link className="font-medium text-primary hover:underline" href={`/payroll/runs/${r.id}`}>
                          {formatIsoDate(toIsoDate(r.period.startDate))} – {formatIsoDate(toIsoDate(r.period.endDate))}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          Pay date {formatIsoDate(toIsoDate(r.period.payDate))}
                        </p>
                      </TableCell>
                      <TableCell>{r.payGroup.name}</TableCell>
                      <TableCell>
                        <RunStatusBadge status={r.status} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{t.headcount}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatUgx(t.gross)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatUgx(t.net)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
