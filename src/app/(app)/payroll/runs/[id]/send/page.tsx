import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
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
import { messagingConfig } from '@/lib/messaging';
import { formatIsoDate, toIsoDate } from '@/lib/payroll/dates';
import { deliveryStatus, normalisePhone } from '@/lib/payroll/server/delivery';
import { isPosted, type RunStatus } from '@/lib/payroll/status';
import { can, requirePermission } from '@/lib/rbac';
import { ActionForm } from '../../../_components/action-form';
import { sendPayslipsAction } from '../../../actions';

export const metadata = { title: 'Send payslips · Payroll' };
export const dynamic = 'force-dynamic';

const dateTime = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Kampala',
});

type Delivery = NonNullable<ReturnType<Awaited<ReturnType<typeof deliveryStatus>>['get']>>[number];

function StatusCell({ d }: { d: Delivery | undefined }) {
  if (!d) return <span className="text-muted-foreground">Not sent</span>;
  const s = d.message?.status ?? 'QUEUED';
  return (
    <div className="space-y-0.5">
      <Badge variant={s === 'FAILED' ? 'destructive' : s === 'SENT' ? 'success' : 'secondary'}>
        {s === 'SENT' ? 'Sent' : s === 'FAILED' ? 'Failed' : 'Queued'}
      </Badge>
      <p className="text-xs text-muted-foreground">
        {dateTime.format(d.createdAt)}
        {d.openedAt ? ` · opened ${d.openCount}×` : ''}
        {d.expiresAt < new Date() ? ' · link expired' : ''}
      </p>
      {d.message?.error ? <p className="text-xs text-destructive">{d.message.error}</p> : null}
    </div>
  );
}

export default async function SendPayslipsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('payslips.view');
  const canSend = can(user.roles, 'payslips.generate');
  const { id } = await params;
  const run = await db.payrollRun.findUnique({
    where: { id },
    include: {
      period: true,
      payGroup: true,
      employees: {
        select: {
          employeeId: true,
          employee: {
            select: { staffNo: true, firstName: true, lastName: true, email: true, phone: true },
          },
        },
        orderBy: { employee: { staffNo: 'asc' } },
      },
    },
  });
  if (!run) notFound();
  const posted = isPosted(run.status as RunStatus);
  const status = await deliveryStatus(run.id);
  let mode: 'outbox' | 'live' = 'outbox';
  let configError: string | null = null;
  try {
    mode = messagingConfig().mode;
  } catch (e) {
    configError = e instanceof Error ? e.message : String(e);
  }

  const missingEmail = run.employees.filter((r) => !r.employee.email).length;
  const missingPhone = run.employees.filter((r) => !normalisePhone(r.employee.phone)).length;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-sm">
          <Link href={`/payroll/runs/${run.id}`} className="text-muted-foreground hover:underline">
            Back to run
          </Link>
        </p>
        <h1 className="text-2xl font-semibold">
          Send payslips: {run.payGroup.name}, {formatIsoDate(toIsoDate(run.period.startDate))} –{' '}
          {formatIsoDate(toIsoDate(run.period.endDate))}
        </h1>
        <p className="text-sm text-muted-foreground">
          Email carries the PDF and a secure link; SMS carries the link only. Each link works for
          one employee, expires after a few days, and asks for the last 4 digits of their phone or
          their staff number.
        </p>
      </div>

      {configError ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          Messaging is misconfigured: {configError}
        </div>
      ) : mode === 'outbox' ? (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <strong>Outbox mode:</strong> nothing is actually emailed or texted. Messages are stored
          in the{' '}
          <Link href="/admin/messages" className="text-primary hover:underline">
            message outbox
          </Link>{' '}
          for review. Set MESSAGING_MODE=live with SMTP and SMS settings to deliver for real.
        </div>
      ) : null}

      {!posted ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Payslips can be sent once the run is approved.
          </CardContent>
        </Card>
      ) : canSend ? (
        <Card>
          <CardHeader>
            <CardTitle>Send</CardTitle>
            <CardDescription>
              {missingEmail} employee(s) have no email and {missingPhone} have no valid mobile
              number; they are skipped for that channel. HR can add contact details on the employee
              page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={sendPayslipsAction}
              fields={{ runId: run.id }}
              label="Send payslips"
              pendingLabel="Sending…"
              confirm="Send payslips now?"
              className="space-y-4"
            >
              <fieldset className="flex flex-wrap gap-4 text-sm">
                <legend className="mb-1 font-medium">Channels</legend>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="channel" value="EMAIL" defaultChecked /> Email (PDF +
                  link)
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="channel" value="SMS" /> SMS (link)
                </label>
              </fieldset>
              <fieldset className="space-y-2 text-sm">
                <legend className="mb-1 font-medium">Employees</legend>
                <label className="flex items-center gap-2">
                  <input type="radio" name="scope" value="all" defaultChecked /> Everyone in this
                  run ({run.employees.length})
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="scope" value="selected" /> Only those ticked below
                </label>
                <div className="grid max-h-56 gap-1 overflow-auto rounded-md border p-2 sm:grid-cols-2">
                  {run.employees.map((r) => (
                    <label key={r.employeeId} className="flex items-center gap-2">
                      <input type="checkbox" name="employeeId" value={r.employeeId} />
                      {r.employee.staffNo} {r.employee.firstName} {r.employee.lastName}
                    </label>
                  ))}
                </div>
              </fieldset>
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Delivery status</CardTitle>
          <CardDescription>Latest email and SMS for each employee.</CardDescription>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>SMS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {run.employees.map((r) => {
                const list = status.get(r.employeeId) ?? [];
                const email = list.find((d) => d.channel === 'EMAIL');
                const sms = list.find((d) => d.channel === 'SMS');
                return (
                  <TableRow key={r.employeeId} className="align-top">
                    <TableCell>
                      <p className="font-medium">
                        {r.employee.staffNo} {r.employee.firstName} {r.employee.lastName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {r.employee.email ?? 'no email'} ·{' '}
                        {normalisePhone(r.employee.phone) ?? 'no mobile number'}
                      </p>
                    </TableCell>
                    <TableCell>
                      <StatusCell d={email} />
                    </TableCell>
                    <TableCell>
                      <StatusCell d={sms} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
