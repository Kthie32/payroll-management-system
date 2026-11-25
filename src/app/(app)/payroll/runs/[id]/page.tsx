import Link from 'next/link';
import { notFound } from 'next/navigation';
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
import { formatUgx, toUgx } from '@/lib/money';
import { formatIsoDate, toIsoDate } from '@/lib/payroll/dates';
import type { RunEmployeeSnapshot } from '@/lib/payroll/server/compute';
import { lineLabel } from '@/lib/payroll/server/payslips';
import {
  approveBlockReason,
  isEditable,
  isPosted,
  POSTED_STATUSES,
  rejectBlockReason,
  submitBlockReason,
  type RunStatus,
} from '@/lib/payroll/status';
import { computeVariance, parseTotals } from '@/lib/payroll/totals';
import { can, requirePermission } from '@/lib/rbac';
import { RunStatusBadge } from '../../_components/status-badge';
import { RunActions } from './run-actions';

export const metadata = { title: 'Payroll run · Payroll' };
export const dynamic = 'force-dynamic';

const dateTime = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Kampala',
});

const WARNING_TEXT: Record<string, string> = {
  LST_RULE_MISSING: 'LST is due this month but no active LST rule exists',
  LST_SHORTFALL: 'LST limited to the pay available',
  PAYE_OVERWITHHELD: 'More PAYE was withheld earlier this month than is due',
  PAYE_SHORTFALL: 'PAYE limited to the pay available',
  DEDUCTIONS_CARRIED_FORWARD: 'Some deductions did not fit and were carried forward',
  NO_DAYS_WORKED: 'No days worked in this period',
  NO_ACTIVE_BANK_ACCOUNT: 'No active bank account',
};

function warningText(w: string): string {
  const [code, detail] = w.split(':');
  if (code === 'COMPONENT_MISSING_VALUE')
    return `${detail ?? 'A component'} has no amount, rate or quantity`;
  if (code === 'INPUT_IGNORED') return `Input ignored: ${w.slice('INPUT_IGNORED:'.length)}`;
  return WARNING_TEXT[code ?? ''] ?? w;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function signed(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatUgx(Math.abs(n))}`;
}

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('payroll.view');
  const { id } = await params;
  const run = await db.payrollRun.findUnique({
    where: { id },
    include: {
      period: true,
      payGroup: true,
      computedBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
      employees: {
        include: { lines: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
      },
    },
  });
  if (!run) notFound();

  const status = run.status as RunStatus;
  const totals = parseTotals(run.totals);
  const rows = run.employees
    .map((re) => ({ re, snap: re.snapshot as unknown as RunEmployeeSnapshot }))
    .sort((a, b) => a.snap.employee.staffNo.localeCompare(b.snap.employee.staffNo));

  const previous = await db.payrollRun.findFirst({
    where: {
      payGroupId: run.payGroupId,
      id: { not: run.id },
      status: { in: [...POSTED_STATUSES] },
      period: { payDate: { lt: run.period.payDate } },
    },
    orderBy: { period: { payDate: 'desc' } },
    include: { period: true, employees: { select: { employeeId: true, gross: true, net: true } } },
  });
  const variance =
    previous && rows.length
      ? computeVariance(
          rows.map(({ re }) => ({
            employeeId: re.employeeId,
            gross: toUgx(re.gross),
            net: toUgx(re.net),
          })),
          previous.employees.map((e) => ({
            employeeId: e.employeeId,
            gross: toUgx(e.gross),
            net: toUgx(e.net),
          })),
        )
      : null;
  const nameBy = new Map(
    rows.map(({ re, snap }) => [re.employeeId, `${snap.employee.staffNo} ${snap.employee.name}`]),
  );
  if (variance) {
    const missing = variance.flagged
      .filter((f) => !nameBy.has(f.employeeId))
      .map((f) => f.employeeId);
    if (missing.length) {
      const emps = await db.employee.findMany({
        where: { id: { in: missing } },
        select: { id: true, staffNo: true, firstName: true, lastName: true },
      });
      for (const e of emps) nameBy.set(e.id, `${e.staffNo} ${e.firstName} ${e.lastName}`);
    }
  }

  const warningCounts = new Map<string, number>();
  for (const { re } of rows) {
    for (const w of (re.warnings as string[]) ?? []) {
      const text = warningText(w);
      warningCounts.set(text, (warningCounts.get(text) ?? 0) + 1);
    }
  }

  const perms = {
    prepare: can(user.roles, 'payroll.prepare'),
    approve: can(user.roles, 'payroll.approve'),
  };
  const ctx = { status, computedById: run.computedById, actorId: user.id };
  const showPayslips = rows.length > 0;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-sm">
          <Link href="/payroll" className="text-muted-foreground hover:underline">
            Payroll
          </Link>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">
            {run.payGroup.name}: {formatIsoDate(toIsoDate(run.period.startDate))} –{' '}
            {formatIsoDate(toIsoDate(run.period.endDate))}
          </h1>
          <RunStatusBadge status={run.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          Pay date {formatIsoDate(toIsoDate(run.period.payDate))}
          {run.computedAt
            ? ` · Computed ${dateTime.format(run.computedAt)} by ${run.computedBy?.name ?? 'unknown'}`
            : ''}
          {run.approvedAt
            ? ` · Approved ${dateTime.format(run.approvedAt)} by ${run.approvedBy?.name ?? 'unknown'}`
            : ''}
        </p>
      </div>

      {run.rejectionComment && (status === 'REJECTED' || isEditable(status)) ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          <p className="font-medium">Returned by the approver</p>
          <p className="whitespace-pre-wrap">{run.rejectionComment}</p>
        </div>
      ) : null}

      <RunActions
        runId={run.id}
        status={status}
        canPrepare={perms.prepare}
        canApprove={perms.approve}
        isEditable={isEditable(status)}
        submitBlocked={submitBlockReason({
          status,
          headcount: totals.headcount,
          errorCount: totals.errors.length,
        })}
        approveBlocked={approveBlockReason(ctx)}
        rejectBlocked={rejectBlockReason(ctx)}
        periodId={run.periodId}
      />

      {status === 'DRAFT' ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            This run has not been computed yet. Check the{' '}
            <Link
              className="text-primary hover:underline"
              href={`/payroll/periods/${run.periodId}/inputs`}
            >
              period inputs
            </Link>
            , then compute.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Stat label="Employees" value={String(totals.headcount)} />
            <Stat label="Gross pay" value={formatUgx(totals.gross)} />
            <Stat label="PAYE" value={formatUgx(totals.paye)} />
            <Stat
              label="NSSF"
              value={formatUgx(totals.nssfEmployee + totals.nssfEmployer)}
              hint={`Employee ${formatUgx(totals.nssfEmployee)} · Employer ${formatUgx(totals.nssfEmployer)}`}
            />
            <Stat label="LST" value={formatUgx(totals.lst)} />
            <Stat label="Other deductions" value={formatUgx(totals.otherDeductions)} />
            <Stat label="Net pay" value={formatUgx(totals.net)} />
            <Stat label="Employer cost" value={formatUgx(totals.employerCost)} />
          </div>

          {totals.errors.length ? (
            <Card className="border-destructive/50">
              <CardHeader>
                <CardTitle>Employees not calculated ({totals.errors.length})</CardTitle>
                <CardDescription>
                  Fix these and recompute. The run cannot be submitted until they are resolved.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  {totals.errors.map((e) => (
                    <li key={e.employeeId}>
                      <span className="font-medium">
                        {e.staffNo} {e.name}
                      </span>
                      : <span className="text-destructive">{e.message}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {warningCounts.size ? (
            <Card>
              <CardHeader>
                <CardTitle>Warnings</CardTitle>
                <CardDescription>
                  Review before submitting. Details are on each employee below.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  {[...warningCounts].map(([text, n]) => (
                    <li key={text} className="flex items-center gap-2">
                      <Badge variant="warning">{n}</Badge> {text}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {variance && previous ? (
            <Card>
              <CardHeader>
                <CardTitle>Compared with the previous approved run</CardTitle>
                <CardDescription>
                  Pay date {formatIsoDate(toIsoDate(previous.period.payDate))}. Employees who
                  joined, left, or whose net pay changed by more than 10% are listed.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Stat
                    label="Headcount"
                    value={`${variance.headcount.current}`}
                    hint={`${variance.headcount.delta >= 0 ? '+' : ''}${variance.headcount.delta} vs ${variance.headcount.previous}`}
                  />
                  <Stat
                    label="Gross"
                    value={formatUgx(variance.gross.current)}
                    hint={`${signed(variance.gross.delta)} vs ${formatUgx(variance.gross.previous)}`}
                  />
                  <Stat
                    label="Net"
                    value={formatUgx(variance.net.current)}
                    hint={`${signed(variance.net.delta)} vs ${formatUgx(variance.net.previous)}`}
                  />
                </div>
                {variance.flagged.length ? (
                  <ul className="space-y-1 text-sm">
                    {variance.flagged.map((f) => (
                      <li key={f.employeeId} className="flex flex-wrap items-center gap-2">
                        <Badge variant={f.reason === 'CHANGE' ? 'warning' : 'secondary'}>
                          {f.reason === 'NEW'
                            ? 'New'
                            : f.reason === 'LEFT'
                              ? 'Not in this run'
                              : 'Changed'}
                        </Badge>
                        <span>{nameBy.get(f.employeeId) ?? f.employeeId}</span>
                        <span className="text-muted-foreground tabular-nums">
                          {f.previousNet !== null ? formatUgx(f.previousNet) : '—'} →{' '}
                          {f.net !== null ? formatUgx(f.net) : '—'}
                          {f.changeBp !== null
                            ? ` (${f.changeBp > 0 ? '+' : ''}${(f.changeBp / 100).toFixed(1)}%)`
                            : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No unusual changes.</p>
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
              <div className="space-y-1.5">
                <CardTitle>Employees</CardTitle>
                <CardDescription>
                  Open a row to see every line and how it was calculated.
                </CardDescription>
              </div>
              {showPayslips ? (
                <Button asChild variant="outline">
                  <a href={`/api/payslips/${run.id}`}>
                    Download all payslips (PDF){isPosted(status) ? '' : ' — draft'}
                  </a>
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="px-0 sm:px-6">
              {rows.length === 0 ? (
                <p className="px-6 text-sm text-muted-foreground sm:px-0">
                  No employees were calculated.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right">PAYE</TableHead>
                      <TableHead className="text-right">NSSF</TableHead>
                      <TableHead className="text-right">LST</TableHead>
                      <TableHead className="text-right">Other</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map(({ re, snap }) => {
                      const warnings = (re.warnings as string[]) ?? [];
                      const names = snap.componentNames ?? {};
                      return (
                        <TableRow key={re.id} className="align-top">
                          <TableCell className="min-w-64">
                            <details>
                              <summary className="cursor-pointer">
                                <span className="font-medium">{snap.employee.staffNo}</span>{' '}
                                {snap.employee.name}
                                {warnings.length ? (
                                  <Badge variant="warning" className="ml-2">
                                    {warnings.length} warning{warnings.length > 1 ? 's' : ''}
                                  </Badge>
                                ) : null}
                              </summary>
                              <div className="mt-2 space-y-2 text-xs">
                                <table className="w-full">
                                  <tbody>
                                    {re.lines.map((l) => (
                                      <tr key={l.id} className="border-b last:border-0 align-top">
                                        <td className="py-1 pr-2 text-muted-foreground">
                                          {l.kind.toLowerCase()}
                                        </td>
                                        <td className="py-1 pr-2">
                                          <span className="font-medium">
                                            {lineLabel(l.code, names)}
                                          </span>
                                          {l.note ? (
                                            <span className="block text-muted-foreground">
                                              {l.note}
                                            </span>
                                          ) : null}
                                        </td>
                                        <td className="whitespace-nowrap py-1 text-right tabular-nums">
                                          {formatUgx(toUgx(l.amount))}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                {warnings.length ? (
                                  <ul className="list-disc pl-4 text-muted-foreground">
                                    {warnings.map((w) => (
                                      <li key={w}>{warningText(w)}</li>
                                    ))}
                                  </ul>
                                ) : null}
                                <Link
                                  className="text-primary hover:underline"
                                  href={`/payroll/runs/${run.id}/payslips/${re.employeeId}`}
                                >
                                  View payslip
                                </Link>
                              </div>
                            </details>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatUgx(toUgx(re.gross))}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatUgx(toUgx(re.paye))}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatUgx(toUgx(re.nssfEmployee))}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatUgx(toUgx(re.lst))}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatUgx(toUgx(re.otherDeductions))}
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {formatUgx(toUgx(re.net))}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
