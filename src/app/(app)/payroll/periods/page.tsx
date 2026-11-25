import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/db';
import { formatIsoDate, monthLabel, monthOf, toIsoDate } from '@/lib/payroll/dates';
import { isPosted, type RunStatus } from '@/lib/payroll/status';
import { can, requirePermission } from '@/lib/rbac';
import { RunStatusBadge } from '../_components/status-badge';
import { GeneratePeriodsForm } from './generate-form';
import { PayDateForm } from './pay-date-form';

export const metadata = { title: 'Pay periods · Payroll' };
export const dynamic = 'force-dynamic';

export default async function PeriodsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission('payroll.view');
  const canPrepare = can(user.roles, 'payroll.prepare');
  const sp = await searchParams;
  const groups = await db.payGroup.findMany({ orderBy: { name: 'asc' } });
  const requested = Array.isArray(sp.payGroupId) ? sp.payGroupId[0] : sp.payGroupId;
  const group = groups.find((g) => g.id === requested) ?? groups[0];

  const periods = group
    ? await db.payPeriod.findMany({
        where: { payGroupId: group.id },
        include: {
          runs: { select: { id: true, status: true }, orderBy: { createdAt: 'desc' } },
          _count: { select: { inputs: true } },
        },
        orderBy: { startDate: 'desc' },
        take: 120,
      })
    : [];

  const byMonth = new Map<string, typeof periods>();
  for (const p of periods) {
    const key = monthOf(toIsoDate(p.payDate));
    byMonth.set(key, [...(byMonth.get(key) ?? []), p]);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm">
            <Link href="/payroll" className="text-muted-foreground hover:underline">
              Payroll
            </Link>
          </p>
          <h1 className="text-2xl font-semibold">Pay periods &amp; inputs</h1>
        </div>
      </div>

      {groups.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No pay groups exist yet. Create one under Settings.
          </CardContent>
        </Card>
      ) : (
        <>
          <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="space-y-2 sm:w-64">
              <Label htmlFor="pg">Pay group</Label>
              <NativeSelect id="pg" name="payGroupId" defaultValue={group?.id}>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.frequency.toLowerCase()})
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Button type="submit" variant="secondary">
              Show
            </Button>
          </form>

          {canPrepare && group ? (
            <Card>
              <CardHeader>
                <CardTitle>Generate periods for {group.name}</CardTitle>
                <CardDescription>
                  {group.frequency === 'MONTHLY'
                    ? 'One period per calendar month. The pay date defaults to the last working day and can be changed below.'
                    : group.frequency === 'WEEKLY'
                      ? 'Monday–Sunday weeks. A week belongs to the month in which it ends (its pay date).'
                      : 'Fourteen-day blocks counted from the anchor date. Use the same anchor every time so cycles stay aligned.'}{' '}
                  Existing periods are skipped.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <GeneratePeriodsForm payGroupId={group.id} frequency={group.frequency} />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Periods</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 px-0 sm:px-6">
              {periods.length === 0 ? (
                <p className="px-6 text-sm text-muted-foreground sm:px-0">No periods yet.</p>
              ) : (
                [...byMonth].map(([month, list]) => (
                  <section key={month} className="space-y-2">
                    <h2 className="px-6 text-sm font-semibold sm:px-0">{monthLabel(month)}</h2>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Period</TableHead>
                          <TableHead>Pay date</TableHead>
                          <TableHead>Run</TableHead>
                          <TableHead>Inputs</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {list.map((p) => {
                          const run = p.runs.find((r) => r.status !== 'REJECTED') ?? p.runs[0];
                          const locked = p.runs.some((r) => isPosted(r.status as RunStatus));
                          return (
                            <TableRow key={p.id} className="align-top">
                              <TableCell className="whitespace-nowrap">
                                {formatIsoDate(toIsoDate(p.startDate))} – {formatIsoDate(toIsoDate(p.endDate))}
                              </TableCell>
                              <TableCell>
                                {canPrepare && !locked ? (
                                  <PayDateForm periodId={p.id} payDate={toIsoDate(p.payDate)} />
                                ) : (
                                  formatIsoDate(toIsoDate(p.payDate))
                                )}
                              </TableCell>
                              <TableCell>
                                {run ? (
                                  <Link href={`/payroll/runs/${run.id}`} className="inline-flex">
                                    <RunStatusBadge status={run.status} />
                                  </Link>
                                ) : (
                                  <span className="text-sm text-muted-foreground">None</span>
                                )}
                              </TableCell>
                              <TableCell>
                                <Link
                                  href={`/payroll/periods/${p.id}/inputs`}
                                  className="text-sm text-primary hover:underline"
                                >
                                  {p._count.inputs} input(s){locked ? ' (locked)' : ''}
                                </Link>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </section>
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
