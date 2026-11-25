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
import { readyToMarkExported } from '@/lib/exports/group';
import {
  currentExportBankIds,
  EXPORTABLE_STATUSES,
  ExportError,
  loadPaymentPlan,
  templateForBank,
} from '@/lib/exports/service';
import { toUgx } from '@/lib/money';
import { can, requirePermission } from '@/lib/rbac';
import { fmtDate, fmtMoney, runStatusLabel, runStatusVariant } from '@/lib/reports/format';
import { ActionButton } from '../../action-button';
import { generateExportAction, transitionRunAction } from '../../actions';

export const metadata = { title: 'Run export · Payroll' };
export const dynamic = 'force-dynamic';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const dateTime = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Kampala',
});

export default async function RunExportPage({ params }: { params: Promise<{ runId: string }> }) {
  const user = await requirePermission('payroll.export');
  const { runId } = await params;

  let loaded;
  try {
    loaded = await loadPaymentPlan(db, runId);
  } catch (e) {
    if (e instanceof ExportError && e.code === 'RUN_NOT_FOUND') notFound();
    throw e;
  }
  const { run, plan } = loaded;
  const [exports, current, templates] = await Promise.all([
    db.bankExport.findMany({
      where: { runId },
      orderBy: [{ bankId: 'asc' }, { version: 'desc' }],
      include: { bank: true, generatedBy: { select: { name: true } } },
    }),
    currentExportBankIds(db, runId),
    Promise.all(plan.groups.map(async (g) => [g.bankId, await templateForBank(db, g.bankId)] as const)),
  ]);
  const templateByBank = new Map(templates);
  const exportable = EXPORTABLE_STATUSES.includes(run.status);
  const canMarkPaid = can(user.roles, 'payroll.markPaid');
  const ready = readyToMarkExported(plan, current);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link href="/exports" className="text-sm text-muted-foreground hover:underline">
          ← Bank exports
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">
            {run.payGroup.name} · {fmtDate(iso(run.period.payDate))}
          </h1>
          <Badge variant={runStatusVariant(run.status)}>{runStatusLabel(run.status)}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Period {fmtDate(iso(run.period.startDate))} – {fmtDate(iso(run.period.endDate))} ·{' '}
          {run.employees.length} employees · net pay UGX {fmtMoney(plan.runNetTotal)}
        </p>
      </div>

      {!exportable && run.status !== 'PAID' && run.status !== 'LOCKED' ? (
        <p role="alert" className="rounded-md bg-warning/20 px-3 py-2 text-sm">
          This run is {runStatusLabel(run.status).toLowerCase()}. Bank files can only be generated
          once it is approved.
        </p>
      ) : null}

      {plan.missingAccounts.length > 0 ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">
              {plan.missingAccounts.length} employee(s) have no active bank account
            </CardTitle>
            <CardDescription>
              Bank files cannot be generated until every employee with net pay has an active
              account. Add accounts on the employee pages, then come back.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {plan.missingAccounts.map((p) => (
                <li key={p.employeeId}>
                  <Link href={`/employees/${p.employeeId}`} className="hover:underline">
                    {p.staffNo} · {p.employeeName}
                  </Link>{' '}
                  — UGX {fmtMoney(p.net)}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {plan.groups.map((g) => {
          const bankExports = exports.filter((e) => e.bankId === g.bankId);
          const tpl = templateByBank.get(g.bankId);
          return (
            <Card key={g.bankId}>
              <CardHeader>
                <CardTitle>{g.bankName}</CardTitle>
                <CardDescription>
                  {g.payees.length} payee(s) · UGX {fmtMoney(g.total)} ·{' '}
                  {tpl?.isDefault ? 'default template' : 'custom template'} (
                  {tpl?.spec.format ?? 'CSV'})
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {exportable ? (
                  <ActionButton
                    action={generateExportAction.bind(null, run.id, g.bankId)}
                    label={bankExports.length ? 'Generate new version' : 'Generate bank file'}
                    pendingLabel="Generating…"
                    disabled={plan.missingAccounts.length > 0}
                    confirm={
                      bankExports.length
                        ? 'Generate a new version? The previous unsent version will be superseded.'
                        : undefined
                    }
                  />
                ) : null}
                {bankExports.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No file generated yet.</p>
                ) : (
                  <ul className="divide-y text-sm">
                    {bankExports.map((e) => (
                      <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">Version {e.version}</span>
                            <Badge
                              variant={
                                e.status === 'SUPERSEDED'
                                  ? 'secondary'
                                  : e.status === 'SENT'
                                    ? 'success'
                                    : 'default'
                              }
                            >
                              {e.status.toLowerCase()}
                            </Badge>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {e.rowCount} rows · UGX {fmtMoney(toUgx(e.totalAmount))} ·{' '}
                            {dateTime.format(e.generatedAt)} by {e.generatedBy.name}
                          </div>
                          <div className="font-mono text-xs text-muted-foreground" title={e.fileSha256}>
                            SHA-256 {e.fileSha256.slice(0, 16)}…
                          </div>
                        </div>
                        {e.status !== 'SUPERSEDED' ? (
                          <Button asChild size="sm" variant="outline">
                            <a href={`/api/exports/${e.id}`}>Download</a>
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {plan.groups.length === 0 && plan.missingAccounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody in this run has net pay to transfer.</p>
      ) : null}

      {plan.zeroNet.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Not in any bank file</CardTitle>
            <CardDescription>These employees have zero net pay this run.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Staff no.</TableHead>
                  <TableHead>Name</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plan.zeroNet.map((p) => (
                  <TableRow key={p.employeeId}>
                    <TableCell>{p.staffNo}</TableCell>
                    <TableCell>{p.employeeName}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Run status</CardTitle>
          <CardDescription>
            Approved → Exported (all bank files generated) → Paid (bank confirms) → Locked.
            {run.exportedAt ? ` Exported ${dateTime.format(run.exportedAt)}.` : ''}
            {run.paidAt ? ` Paid ${dateTime.format(run.paidAt)}.` : ''}
            {run.lockedAt ? ` Locked ${dateTime.format(run.lockedAt)}.` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4">
          {run.status === 'APPROVED' ? (
            <div className="space-y-1">
              <ActionButton
                action={transitionRunAction.bind(null, run.id, 'EXPORTED')}
                label="Mark run exported"
                disabled={!ready}
                confirm="Mark this run as exported? Current bank files will be marked as sent."
              />
              {!ready ? (
                <p className="text-xs text-muted-foreground">
                  Generate a file for every bank first.
                </p>
              ) : null}
            </div>
          ) : null}
          {run.status === 'EXPORTED' && canMarkPaid ? (
            <ActionButton
              action={transitionRunAction.bind(null, run.id, 'PAID')}
              label="Mark run paid"
              confirm="Confirm the bank has paid every employee in this run?"
            />
          ) : null}
          {run.status === 'PAID' && canMarkPaid ? (
            <ActionButton
              action={transitionRunAction.bind(null, run.id, 'LOCKED')}
              label="Lock run"
              variant="destructive"
              confirm="Lock this run permanently? This cannot be undone."
            />
          ) : null}
          {run.status === 'LOCKED' ? (
            <p className="text-sm text-muted-foreground">This run is locked. No further changes.</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
