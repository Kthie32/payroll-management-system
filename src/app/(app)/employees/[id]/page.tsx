import { Pencil } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FormMessage } from '@/components/form-message';
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
import { decrypt } from '@/lib/crypto';
import { db } from '@/lib/db';
import {
  bpToPercent,
  dateToIso,
  LOAN_MANAGED_CODES,
  maskAccount,
  maskNin,
} from '@/lib/employees/validation';
import { formatUgx, toUgx } from '@/lib/money';
import { can, requirePermission } from '@/lib/rbac';
import { cn } from '@/lib/utils';
import {
  dateFmt,
  fullName,
  RESIDENCY_LABELS,
  STATUS_BADGE,
  STATUS_LABELS,
  todayKampala,
  WORKER_TYPE_LABELS,
} from '../labels';
import { BankAccountForm } from './bank-account-form';
import { AssignComponentForm, EndComponentForm } from './component-forms';
import { RevealAccount } from './reveal-account';
import { StatusControls } from './status-controls';

export const metadata = { title: 'Employee · Payroll' };
export const dynamic = 'force-dynamic';

const TABS = [
  { key: 'profile', label: 'Profile' },
  { key: 'bank', label: 'Bank accounts' },
  { key: 'components', label: 'Pay components' },
  { key: 'loans', label: 'Loans' },
  { key: 'history', label: 'Payroll history' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export default async function EmployeePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission('employees.view');
  const canEdit = can(user.roles, 'employees.edit');
  const { id } = await params;
  const sp = await searchParams;
  const tabParam = typeof sp.tab === 'string' ? sp.tab : 'profile';
  const tab: TabKey = TABS.some((t) => t.key === tabParam) ? (tabParam as TabKey) : 'profile';

  const e = await db.employee.findUnique({
    where: { id },
    include: {
      payGroup: { select: { name: true, frequency: true } },
      department: { select: { name: true, costCentreCode: true } },
    },
  });
  if (!e) notFound();
  const today = todayKampala();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            <Link href="/employees" className="hover:underline">
              Employees
            </Link>{' '}
            / <span className="font-mono">{e.staffNo}</span>
          </p>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
            {fullName(e)}
            <Badge variant={STATUS_BADGE[e.status]}>{STATUS_LABELS[e.status]}</Badge>
          </h1>
          <p className="text-sm text-muted-foreground">
            {[e.jobTitle, e.department?.name, e.payGroup.name].filter(Boolean).join(' · ')}
          </p>
        </div>
        {canEdit ? (
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <Button asChild variant="outline" size="sm">
              <Link href={`/employees/${e.id}/edit`}>
                <Pencil aria-hidden /> Edit profile
              </Link>
            </Button>
            <StatusControls employeeId={e.id} status={e.status} today={today} />
          </div>
        ) : null}
      </div>

      {sp.created ? <FormMessage tone="success" message="Employee created." /> : null}
      {sp.saved ? <FormMessage tone="success" message="Changes saved." /> : null}

      <nav aria-label="Employee sections" className="flex gap-1 overflow-x-auto border-b">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === 'profile' ? `/employees/${e.id}` : `/employees/${e.id}?tab=${t.key}`}
            aria-current={tab === t.key ? 'page' : undefined}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              tab === t.key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === 'profile' ? <ProfileTab e={e} /> : null}
      {tab === 'bank' ? <BankTab employee={e} canEdit={canEdit} today={today} /> : null}
      {tab === 'components' ? (
        <ComponentsTab employeeId={e.id} canEdit={canEdit} today={today} />
      ) : null}
      {tab === 'loans' ? <LoansTab employeeId={e.id} /> : null}
      {tab === 'history' ? <HistoryTab employeeId={e.id} /> : null}
    </div>
  );
}

// ── Profile ─────────────────────────────────────────────────────────────

type EmployeeWithRefs = NonNullable<
  Awaited<ReturnType<typeof db.employee.findUnique>>
> & {
  payGroup: { name: string; frequency: string };
  department: { name: string; costCentreCode: string | null } | null;
};

function ProfileTab({ e }: { e: EmployeeWithRefs }) {
  const yesNo = (b: boolean) => (b ? 'Yes' : 'No');
  const rows: [string, React.ReactNode][] = [
    ['Staff number', <span key="s" className="font-mono">{e.staffNo}</span>],
    ['Worker type', WORKER_TYPE_LABELS[e.workerType]],
    ['Pay group', `${e.payGroup.name} (${e.payGroup.frequency.toLowerCase()})`],
    [
      'Department',
      e.department
        ? `${e.department.name}${e.department.costCentreCode ? ` · ${e.department.costCentreCode}` : ''}`
        : '—',
    ],
    ['Job title', e.jobTitle ?? '—'],
    ['Grade', e.grade ?? '—'],
    ['Hire date', dateFmt.format(e.hireDate)],
    ['Exit date', e.exitDate ? dateFmt.format(e.exitDate) : '—'],
    ['Tax residency', RESIDENCY_LABELS[e.residency]],
    ['TIN', e.tin ?? '—'],
    ['NSSF number', e.nssfNo ?? '—'],
    ['National ID (NIN)', e.ninEnc ? maskNin(decrypt(e.ninEnc)) : '—'],
    ['LST district', e.lstDistrict ?? '—'],
    ['PAYE applies', yesNo(e.payeApplicable)],
    ['NSSF applies', yesNo(e.nssfApplicable)],
    ['LST applies', yesNo(e.lstApplicable)],
  ];
  return (
    <Card>
      <CardContent className="pt-6">
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
              <dd className="mt-0.5 text-sm">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

// ── Bank accounts ───────────────────────────────────────────────────────

async function BankTab({
  employee,
  canEdit,
  today,
}: {
  employee: EmployeeWithRefs;
  canEdit: boolean;
  today: string;
}) {
  const [accounts, banks] = await Promise.all([
    db.employeeBankAccount.findMany({
      where: { employeeId: employee.id },
      orderBy: [{ isActive: 'desc' }, { effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      include: { bank: { select: { name: true, code: true } } },
    }),
    canEdit
      ? db.bank.findMany({ select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } })
      : Promise.resolve([]),
  ]);
  const hasActive = accounts.some((a) => a.isActive);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Bank accounts</CardTitle>
          <CardDescription>
            Salary is paid into the active account. Earlier accounts are kept as history.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bank</TableHead>
                <TableHead>Account</TableHead>
                <TableHead className="hidden md:table-cell">Account name</TableHead>
                <TableHead className="hidden sm:table-cell">From</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    No bank account on file.
                  </TableCell>
                </TableRow>
              ) : (
                accounts.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="text-sm">
                      {a.bank.name}
                      {a.branchCode ? (
                        <p className="text-xs text-muted-foreground">Branch {a.branchCode}</p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <RevealAccount
                        accountId={a.id}
                        masked={maskAccount(a.accountNoLast4)}
                        canReveal={canEdit}
                      />
                    </TableCell>
                    <TableCell className="hidden text-sm md:table-cell">{a.accountName}</TableCell>
                    <TableCell className="hidden whitespace-nowrap text-sm sm:table-cell">
                      {dateFmt.format(a.effectiveFrom)}
                    </TableCell>
                    <TableCell>
                      {a.isActive ? (
                        <Badge variant="success">Active</Badge>
                      ) : (
                        <Badge variant="outline">Inactive</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle>{hasActive ? 'Change bank account' : 'Add bank account'}</CardTitle>
            <CardDescription>
              The new account becomes the active one
              {hasActive ? ' and the current one is kept as history' : ''}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BankAccountForm
              employeeId={employee.id}
              banks={banks}
              defaultAccountName={fullName(employee)}
              today={today}
              hasActive={hasActive}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

// ── Pay components ──────────────────────────────────────────────────────

function describeValue(
  calcType: string,
  a: { amount: bigint | null; rateBp: number | null; ratePerUnit: bigint | null },
): string {
  if (calcType === 'FIXED' && a.amount !== null) return formatUgx(toUgx(a.amount));
  if (calcType === 'PERCENT_OF_BASIC' && a.rateBp !== null) return `${bpToPercent(a.rateBp)}% of basic`;
  if (calcType === 'RATE_X_QTY' && a.ratePerUnit !== null) {
    return `${formatUgx(toUgx(a.ratePerUnit))} per unit`;
  }
  return '—';
}

async function ComponentsTab({
  employeeId,
  canEdit,
  today,
}: {
  employeeId: string;
  canEdit: boolean;
  today: string;
}) {
  const [assignments, components] = await Promise.all([
    db.employeeComponent.findMany({
      where: { employeeId },
      include: { component: true },
      orderBy: [{ component: { sortOrder: 'asc' } }, { effectiveFrom: 'desc' }],
    }),
    canEdit
      ? db.payComponent.findMany({
          where: { isActive: true, code: { notIn: [...LOAN_MANAGED_CODES] } },
          select: { id: true, code: true, name: true, kind: true, calcType: true },
          orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }],
        })
      : Promise.resolve([]),
  ]);

  const status = (from: string, to: string | null) =>
    from > today ? 'Upcoming' : to !== null && to < today ? 'Ended' : 'Current';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Pay components</CardTitle>
          <CardDescription>
            Recurring earnings and deductions. Assignments are end-dated, never deleted, so past
            payrolls stay explainable. Loans and advances are managed on the Loans page.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Component</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Status</TableHead>
                {canEdit ? <TableHead className="w-0" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={canEdit ? 5 : 4}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No pay components assigned. Most employees need at least a basic salary.
                  </TableCell>
                </TableRow>
              ) : (
                assignments.map((a) => {
                  const from = dateToIso(a.effectiveFrom);
                  const to = a.effectiveTo ? dateToIso(a.effectiveTo) : null;
                  const s = status(from, to);
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="text-sm">
                        {a.component.name}
                        <p className="text-xs text-muted-foreground">
                          {a.component.code} · {a.component.kind.toLowerCase()}
                        </p>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {describeValue(a.component.calcType, a)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {dateFmt.format(a.effectiveFrom)} –{' '}
                        {a.effectiveTo ? dateFmt.format(a.effectiveTo) : 'open'}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            s === 'Current' ? 'success' : s === 'Upcoming' ? 'secondary' : 'outline'
                          }
                        >
                          {s}
                        </Badge>
                      </TableCell>
                      {canEdit ? (
                        <TableCell>
                          {s !== 'Ended' ? (
                            <EndComponentForm
                              employeeId={employeeId}
                              assignmentId={a.id}
                              defaultDate={to && to < today ? to : from > today ? from : today}
                            />
                          ) : null}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle>Assign a component</CardTitle>
          </CardHeader>
          <CardContent>
            <AssignComponentForm employeeId={employeeId} components={components} today={today} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

// ── Loans (read-only) ───────────────────────────────────────────────────

async function LoansTab({ employeeId }: { employeeId: string }) {
  const loans = await db.loan.findMany({
    where: { employeeId },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
  });
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <div className="space-y-1.5">
          <CardTitle>Loans and advances</CardTitle>
          <CardDescription>Read-only here. Manage them on the Loans page.</CardDescription>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/loans?employee=${employeeId}`}>Open Loans</Link>
        </Button>
      </CardHeader>
      <CardContent className="px-0 sm:px-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Principal</TableHead>
              <TableHead className="text-right">Instalment</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loans.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  No loans or advances.
                </TableCell>
              </TableRow>
            ) : (
              loans.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="text-sm">{l.type.charAt(0) + l.type.slice(1).toLowerCase()}</TableCell>
                  <TableCell className="whitespace-nowrap text-right text-sm tabular-nums">
                    {formatUgx(toUgx(l.principal))}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right text-sm tabular-nums">
                    {formatUgx(toUgx(l.installment))}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right text-sm tabular-nums">
                    {formatUgx(toUgx(l.balance))}
                  </TableCell>
                  <TableCell>
                    <Badge variant={l.status === 'ACTIVE' ? 'success' : 'outline'}>
                      {l.status.replace('_', ' ').toLowerCase()}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ── Payroll history (read-only) ─────────────────────────────────────────

async function HistoryTab({ employeeId }: { employeeId: string }) {
  const rows = await db.payrollRunEmployee.findMany({
    where: { employeeId },
    include: {
      run: {
        select: {
          id: true,
          status: true,
          period: { select: { startDate: true, endDate: true, payDate: true } },
        },
      },
    },
    orderBy: { run: { period: { startDate: 'desc' } } },
    take: 36,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payroll history</CardTitle>
        <CardDescription>The most recent 36 pay periods this employee was included in.</CardDescription>
      </CardHeader>
      <CardContent className="px-0 sm:px-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Period</TableHead>
              <TableHead className="hidden sm:table-cell">Pay date</TableHead>
              <TableHead className="text-right">Gross</TableHead>
              <TableHead className="hidden text-right md:table-cell">PAYE</TableHead>
              <TableHead className="text-right">Net</TableHead>
              <TableHead>Run</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  Not included in any payroll run yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-sm">
                    {dateFmt.format(r.run.period.startDate)} – {dateFmt.format(r.run.period.endDate)}
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap text-sm sm:table-cell">
                    {dateFmt.format(r.run.period.payDate)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right text-sm tabular-nums">
                    {formatUgx(toUgx(r.gross))}
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap text-right text-sm tabular-nums md:table-cell">
                    {formatUgx(toUgx(r.paye))}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right text-sm font-medium tabular-nums">
                    {formatUgx(toUgx(r.net))}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/payroll/runs/${r.run.id}`}
                      className="text-sm text-primary hover:underline"
                    >
                      {r.run.status.toLowerCase()}
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
