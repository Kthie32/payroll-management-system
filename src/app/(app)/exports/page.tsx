import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { db } from '@/lib/db';
import { toUgx } from '@/lib/money';
import { can, requirePermission } from '@/lib/rbac';
import { fmtDate, fmtMoney, runStatusLabel, runStatusVariant } from '@/lib/reports/format';

export const metadata = { title: 'Bank exports · Payroll' };
export const dynamic = 'force-dynamic';

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function ExportsPage() {
  const user = await requirePermission('exports.view');
  const runs = await db.payrollRun.findMany({
    where: { status: { in: ['APPROVED', 'EXPORTED', 'PAID', 'LOCKED'] } },
    orderBy: [{ period: { payDate: 'desc' } }],
    take: 50,
    include: {
      period: true,
      payGroup: true,
      _count: { select: { employees: true, exports: true } },
    },
  });
  const sums = runs.length
    ? await db.payrollRunEmployee.groupBy({
        by: ['runId'],
        where: { runId: { in: runs.map((r) => r.id) } },
        _sum: { net: true },
      })
    : [];
  const netByRun = new Map(sums.map((s) => [s.runId, toUgx(s._sum.net ?? 0n)]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Bank exports</h1>
          <p className="text-sm text-muted-foreground">
            Generate bank payment files for approved payroll runs, then mark runs exported, paid and
            locked.
          </p>
        </div>
        {can(user.roles, 'exports.view') || can(user.roles, 'templates.manage') ? (
          <Button asChild variant="outline">
            <Link href="/exports/templates">Bank file templates</Link>
          </Button>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Approved runs</CardTitle>
          <CardDescription>The 50 most recent runs that are approved or later.</CardDescription>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          {runs.length === 0 ? (
            <p className="px-6 text-sm text-muted-foreground sm:px-0">
              No approved payroll runs yet. Runs appear here after a Finance Approver approves them.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pay date</TableHead>
                  <TableHead>Pay group</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Employees</TableHead>
                  <TableHead className="text-right">Net pay (UGX)</TableHead>
                  <TableHead className="text-right">Files</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">
                      {fmtDate(iso(r.period.payDate))}
                    </TableCell>
                    <TableCell>{r.payGroup.name}</TableCell>
                    <TableCell>
                      <Badge variant={runStatusVariant(r.status)}>{runStatusLabel(r.status)}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r._count.employees}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtMoney(netByRun.get(r.id) ?? 0)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r._count.exports}</TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/exports/runs/${r.id}`}>Open</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
