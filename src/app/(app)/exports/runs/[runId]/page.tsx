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
import { runPaymentSummary } from '@/lib/exports/payments';
import { toUgx } from '@/lib/money';
import { Input } from '@/components/ui/input';
import { can, requirePermission } from '@/lib/rbac';
import { fmtDate, fmtMoney, runStatusLabel, runStatusVariant } from '@/lib/reports/format';
import { ActionButton } from '../../action-button';
import { generateExportAction, reissueAction, transitionRunAction } from '../../actions';
import { ResultsUpload } from './results-upload';

export const metadata = { title: 'Run export · Payroll' };
export const dynamic = 'force-dynamic';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const dateTime = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Kampala',
});

export default async function RunExportPage({ params }: { params: Promise<{ runId: string }> }) {
  const user = await requirePermission('exports.view');
  const { runId } = await params;

  let loaded;
  try {
    loaded = await loadPaymentPlan(db, runId);
  } catch (e) {
    if (e instanceof ExportError && e.code === 'RUN_NOT_FOUND') notFound();
    throw e;
  }
  const { run, plan } = loaded;
  const [exports, current, templates, payments] = await Promise.all([
    db.bankExport.findMany({
      where: { runId },
      orderBy: [{ bankId: 'asc' }, { version: 'desc' }],
      include: { bank: true, generatedBy: { select: { name: true } } },
    }),
    currentExportBankIds(db, runId),
    Promise.all(
      plan.groups.map(async (g) => [g.bankId, await templateForBank(db, g.bankId)] as const),
    ),
    runPaymentSummary(db, runId),
  ]);
  const templateByBank = new Map(templates);
  const exportable = EXPORTABLE_STATUSES.includes(run.status);
  const canMarkPaid = can(user.roles, 'payroll.markPaid');
  const canGenerate = can(user.roles, 'exports.generate');
  const canUpload = can(user.roles, 'payments.upload');
  // Files that went to the bank: results can be uploaded for these.
  const sentExports = exports.filter(
    (e) => e.status === 'SENT' || (e.status === 'GENERATED' && run.status !== 'APPROVED'),
  );
  const resultIssues = payments.failed.length + payments.pending + payments.noResult;
  const failedByBank = new Map<string, { name: string; count: number }>();
  for (const f of payments.failed) {
    if (!f.currentBankId) continue;
    const cur = failedByBank.get(f.currentBankId) ?? { name: f.currentBankName, count: 0 };
    cur.count++;
    failedByBank.set(f.currentBankId, cur);
  }
  const sections = [
    { kind: 'BANK' as const, title: 'Banks', groups: plan.groups.filter((g) => g.kind === 'BANK') },
    {
      kind: 'MOBILE_MONEY' as const,
      title: 'Mobile money',
      groups: plan.groups.filter((g) => g.kind === 'MOBILE_MONEY'),
    },
  ].filter((sec) => sec.groups.length > 0);
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

      {sections.map((sec) => (
        <section key={sec.kind} className="space-y-3">
          <h2 className="text-lg font-semibold">{sec.title}</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {sec.groups.map((g) => {
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
                    {exportable && canGenerate ? (
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
                          <li
                            key={e.id}
                            className="flex flex-wrap items-center justify-between gap-2 py-2"
                          >
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
                              <div
                                className="font-mono text-xs text-muted-foreground"
                                title={e.fileSha256}
                              >
                                SHA-256 {e.fileSha256.slice(0, 16)}…
                              </div>
                            </div>
                            {e.status !== 'SUPERSEDED' && canGenerate ? (
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
        </section>
      ))}

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

      {sentExports.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Payment results</CardTitle>
            <CardDescription>
              Upload each bank or provider&apos;s result report to record who was paid. Of{' '}
              {payments.payees} payee(s): {payments.paid} paid, {payments.failed.length} failed,{' '}
              {payments.pending} pending, {payments.noResult} without a result yet.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {payments.failed.length > 0 ? (
              <div className="space-y-3 rounded-md border border-destructive/40 p-3">
                <p className="text-sm font-medium text-destructive">
                  Failed payments ({payments.failed.length})
                </p>
                <ul className="space-y-1 text-sm">
                  {payments.failed.map((f) => (
                    <li key={f.runEmployeeId}>
                      <Link href={`/employees/${f.employeeId}`} className="hover:underline">
                        {f.staffNo} · {f.name}
                      </Link>{' '}
                      — UGX {fmtMoney(f.net)} · failed in {f.failedIn}
                      {f.reason ? ` (${f.reason})` : ''} · now paid via {f.currentBankName}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  Fix the account details on the employee page if needed, then make a re-issue file
                  containing only these payees.
                </p>
                {canGenerate ? (
                  <div className="flex flex-wrap gap-3">
                    {[...failedByBank].map(([bankId, b]) => (
                      <ActionButton
                        key={bankId}
                        action={reissueAction.bind(null, run.id, bankId)}
                        label={`Re-issue ${b.count} via ${b.name}`}
                        pendingLabel="Generating…"
                        variant="outline"
                        confirm={`Generate a re-issue file for ${b.count} failed payment(s) through ${b.name}?`}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {canUpload ? (
              <div className="grid gap-6 lg:grid-cols-2">
                {sentExports.map((e) => (
                  <div key={e.id} className="space-y-2 rounded-md border p-3">
                    <p className="text-sm font-medium">
                      {e.bank.name} · version {e.version} ({e.rowCount} rows)
                    </p>
                    <ResultsUpload runId={run.id} exportId={e.id} />
                  </div>
                ))}
              </div>
            ) : null}
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
          {run.status === 'APPROVED' && canGenerate ? (
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
            >
              {resultIssues > 0 ? (
                <div className="max-w-sm space-y-1 rounded-md bg-warning/20 p-2 text-xs">
                  <p>
                    {payments.failed.length} failed, {payments.pending} pending and{' '}
                    {payments.noResult} payee(s) without a bank result. To mark the run paid anyway,
                    type CONFIRM.
                  </p>
                  <Input name="confirm" placeholder="CONFIRM" autoComplete="off" className="h-8" />
                </div>
              ) : null}
            </ActionButton>
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
