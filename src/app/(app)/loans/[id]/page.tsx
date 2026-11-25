import { loanLineCode } from '@/lib/payroll/loan-codes';
import { notFound } from 'next/navigation';
import { FormMessage } from '@/components/form-message';
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
import { LOAN_TYPE_LABELS, periodsRemaining } from '@/lib/loans/logic';
import { formatUgx, toUgx } from '@/lib/money';
import { can, requirePermission } from '@/lib/rbac';
import { toIsoDate } from '@/lib/settings/input';
import { PageHeader } from '../../settings/_components/page-header';
import { LOAN_STATUS_BADGE } from '../status';
import { InstallmentForm, RepayForm, WriteOffForm } from './adjust-forms';

export const metadata = { title: 'Loan · Payroll' };
export const dynamic = 'force-dynamic';

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeZone: 'Africa/Kampala',
});

const ACTION_LABELS: Record<string, string> = {
  LOAN_CREATED: 'Loan created',
  LOAN_MANUAL_REPAYMENT: 'Manual repayment',
  LOAN_INSTALLMENT_CHANGED: 'Instalment changed',
  LOAN_WRITTEN_OFF: 'Written off',
  LOAN_REPAID_BY_PAYROLL: 'Payroll deduction applied',
};

const PAID_STATUSES = ['APPROVED', 'EXPORTED', 'PAID', 'LOCKED'] as const;

export default async function LoanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const user = await requirePermission('loans.view');
  const canEdit = can(user.roles, 'loans.edit');
  const { id } = await params;
  const { created } = await searchParams;
  const loan = await db.loan.findUnique({
    where: { id },
    include: {
      employee: { select: { id: true, staffNo: true, firstName: true, lastName: true } },
      startPeriod: { select: { startDate: true, endDate: true } },
    },
  });
  if (!loan) notFound();

  const [lines, events] = await Promise.all([
    // Payroll deductions for this exact loan (lines are coded <TYPE>#<loanId>) on approved runs.
    db.payrollLine.findMany({
      where: {
        code: loanLineCode(loan.type, loan.id),
        runEmployee: {
          employeeId: loan.employeeId,
          run: { status: { in: [...PAID_STATUSES] } },
        },
      },
      orderBy: { createdAt: 'asc' },
      include: {
        runEmployee: {
          select: {
            run: {
              select: { period: { select: { startDate: true, endDate: true, payDate: true } } },
            },
          },
        },
      },
    }),
    db.auditLog.findMany({
      where: { entity: 'Loan', entityId: loan.id },
      orderBy: { at: 'asc' },
      include: { actor: { select: { name: true } } },
    }),
  ]);

  const principal = toUgx(loan.principal);
  const balance = toUgx(loan.balance);
  const installment = toUgx(loan.installment);
  const repaid = principal - balance;
  const s = LOAN_STATUS_BADGE[loan.status];
  const name = `${loan.employee.firstName} ${loan.employee.lastName}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${LOAN_TYPE_LABELS[loan.type]} — ${name}`}
        description={`Staff no. ${loan.employee.staffNo} · created ${dateFmt.format(loan.createdAt)}`}
        back={{ href: '/loans', label: 'Loans' }}
        actions={<Badge variant={s.variant}>{s.label}</Badge>}
      />
      {created ? (
        <FormMessage
          tone="success"
          message="Loan created. It will be deducted from the next payroll run."
        />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Amount lent" value={formatUgx(principal)} />
        <Stat label="Repaid" value={formatUgx(repaid)} />
        <Stat label="Balance" value={formatUgx(balance)} strong />
        <Stat
          label="Per period"
          value={formatUgx(installment)}
          hint={
            loan.status === 'ACTIVE'
              ? `${periodsRemaining(balance, installment)} period(s) left${
                  loan.startPeriod ? ` · starts ${toIsoDate(loan.startPeriod.startDate)}` : ''
                }`
              : undefined
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Payroll deductions</CardTitle>
          <CardDescription>Taken in approved payroll runs.</CardDescription>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>Pay date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => {
                const p = l.runEmployee.run.period;
                return (
                  <TableRow key={l.id}>
                    <TableCell className="tabular-nums">
                      {toIsoDate(p.startDate)} – {toIsoDate(p.endDate)}
                    </TableCell>
                    <TableCell className="tabular-nums">{toIsoDate(p.payDate)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatUgx(toUgx(l.amount))}
                    </TableCell>
                  </TableRow>
                );
              })}
              {lines.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                    No payroll deductions yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {canEdit && loan.status === 'ACTIVE' ? (
        <Card>
          <CardHeader>
            <CardTitle>Adjust</CardTitle>
            <CardDescription>Every change is recorded in the audit log.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Repayment outside payroll</h3>
              <RepayForm loanId={loan.id} />
            </section>
            <section className="space-y-2 border-t pt-6">
              <h3 className="text-sm font-medium">Change the deduction per period</h3>
              <InstallmentForm loanId={loan.id} current={installment} />
            </section>
            <section className="space-y-2 border-t pt-6">
              <h3 className="text-sm font-medium">Write off</h3>
              <WriteOffForm loanId={loan.id} />
            </section>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3 text-sm">
            {events.map((e) => {
              const after = (e.after ?? {}) as Record<string, unknown>;
              const detail = [
                typeof after.amount === 'number' ? formatUgx(after.amount) : null,
                typeof after.installment === 'number'
                  ? `instalment ${formatUgx(after.installment)}`
                  : null,
                typeof after.balance === 'number' ? `balance ${formatUgx(after.balance)}` : null,
                typeof after.note === 'string' && after.note ? `“${after.note}”` : null,
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <li key={e.id} className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
                  <span className="shrink-0 text-muted-foreground tabular-nums sm:w-32">
                    {dateFmt.format(e.at)}
                  </span>
                  <span>
                    <span className="font-medium">{ACTION_LABELS[e.action] ?? e.action}</span>
                    {detail ? ` — ${detail}` : ''}
                    <span className="text-muted-foreground"> · {e.actor?.name ?? 'System'}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  strong,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <Card>
      <CardContent className="space-y-1 pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className={strong ? 'text-xl font-semibold tabular-nums' : 'text-xl tabular-nums'}>
          {value}
        </p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
