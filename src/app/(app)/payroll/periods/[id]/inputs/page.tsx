import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/lib/db';
import { toUgx } from '@/lib/money';
import { formatIsoDate, toIsoDate } from '@/lib/payroll/dates';
import { INPUT_CSV_COLUMNS, INPUT_CSV_OPTIONAL_COLUMNS } from '@/lib/payroll/csv-inputs';
import { POSTED_STATUSES } from '@/lib/payroll/status';
import {
  correctableRuns,
  inputComponents,
  isPeriodLocked,
  listAdjustments,
  periodEmployees,
} from '@/lib/payroll/server/periods-inputs';
import { AdjustmentsSection } from './adjustments-section';
import { can, requirePermission } from '@/lib/rbac';
import { ActionForm } from '../../../_components/action-form';
import { clearImportedAction } from '../../../actions';
import { CsvImport } from './csv-import';
import { InputsGrid } from './inputs-grid';

export const metadata = { title: 'Payroll inputs · Payroll' };
export const dynamic = 'force-dynamic';

export default async function InputsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ adjust?: string; run?: string }>;
}) {
  const user = await requirePermission('payroll.view');
  const { id } = await params;
  const { adjust, run: preRun } = await searchParams;
  const period = await db.payPeriod.findUnique({ where: { id }, include: { payGroup: true } });
  if (!period) notFound();

  const [locked, employees, components, inputs, adjustments] = await Promise.all([
    isPeriodLocked(period.id),
    periodEmployees(period.id),
    inputComponents(),
    db.payrollInput.findMany({
      where: { periodId: period.id },
      include: { component: true, employee: true },
      orderBy: [{ employee: { staffNo: 'asc' } }, { component: { code: 'asc' } }],
    }),
    listAdjustments(period.id),
  ]);

  // Runs that can be corrected here: for a preselected employee, the approved runs they were in;
  // otherwise approved runs of this pay group paid before this period (validated again on save).
  const runs =
    adjust && employees.some((e) => e.id === adjust)
      ? await correctableRuns(adjust, period.payDate)
      : (
          await db.payrollRun.findMany({
            where: {
              payGroupId: period.payGroupId,
              status: { in: [...POSTED_STATUSES] },
              period: { payDate: { lt: period.payDate } },
            },
            include: { period: true, payGroup: true },
            orderBy: { period: { payDate: 'desc' } },
            take: 24,
          })
        ).map((r) => ({
          runId: r.id,
          label: `${r.payGroup.name}: ${toIsoDate(r.period.startDate)} – ${toIsoDate(r.period.endDate)}`,
        }));
  const editable = !locked && can(user.roles, 'payroll.inputs');
  const canImport = !locked && can(user.roles, 'payroll.prepare');

  const manual: Record<string, string> = {};
  for (const i of inputs) {
    if (i.source !== 'MANUAL' || i.note !== null || i.adjustsRunId !== null) continue;
    const key = `${i.employeeId}:${i.componentId}`;
    const value =
      i.component.calcType === 'RATE_X_QTY'
        ? (i.quantity?.toNumber() ?? 0)
        : i.amount === null
          ? 0
          : toUgx(i.amount);
    manual[key] = String(Number(manual[key] ?? 0) + value);
  }
  const imported = inputs.filter((i) => i.source === 'IMPORT');

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm">
          <Link
            href={`/payroll/periods?payGroupId=${period.payGroupId}`}
            className="text-muted-foreground hover:underline"
          >
            Pay periods
          </Link>
        </p>
        <h1 className="text-2xl font-semibold">
          Inputs: {period.payGroup.name}, {formatIsoDate(toIsoDate(period.startDate))} –{' '}
          {formatIsoDate(toIsoDate(period.endDate))}
        </h1>
        <p className="text-sm text-muted-foreground">
          Pay date {formatIsoDate(toIsoDate(period.payDate))}
          {locked ? ' · Locked: this period has an approved run.' : ''}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Variable pay for this period</CardTitle>
          <CardDescription>
            Quantity columns (hours, days) are multiplied by the employee’s rate. Amount columns are
            whole shillings and replace the employee’s usual amount for this period only. Leave a
            cell empty for nothing. Recompute the run after changing inputs.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          {employees.length === 0 ? (
            <p className="px-6 text-sm text-muted-foreground sm:px-0">
              No employees in this pay group are employed during the period.
            </p>
          ) : (
            <InputsGrid
              periodId={period.id}
              editable={editable}
              employees={employees.map((e) => ({
                id: e.id,
                staffNo: e.staffNo,
                name: [e.firstName, e.lastName].join(' '),
              }))}
              components={components.map((c) => ({
                id: c.id,
                code: c.code,
                name: c.name,
                kind: c.kind,
                isQuantity: c.calcType === 'RATE_X_QTY',
              }))}
              values={manual}
            />
          )}
        </CardContent>
      </Card>

      <AdjustmentsSection
        periodId={period.id}
        editable={editable}
        employees={employees.map((e) => ({
          id: e.id,
          staffNo: e.staffNo,
          name: [e.firstName, e.lastName].join(' '),
        }))}
        runs={runs}
        adjustments={adjustments}
        preselect={{ employeeId: adjust, runId: preRun }}
      />

      <Card>
        <CardHeader>
          <CardTitle>Import from CSV</CardTitle>
          <CardDescription>
            Columns: {INPUT_CSV_COLUMNS.join(', ')}. Use quantity for rate-based components (e.g.
            OVERTIME hours, DAILY_WAGE days; an amount on those rows overrides the rate per unit)
            and amount for fixed ones (e.g. BONUS, ADVANCE). Optional columns{' '}
            {INPUT_CSV_OPTIONAL_COLUMNS.join(', ')}: ARREARS and OVERPAYMENT_RECOVERY rows need an
            amount, a note and adjustsPeriodStart (the start date, YYYY-MM-DD, of the approved run
            being corrected). The whole file is checked first and nothing is saved if any row has an
            error.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {canImport ? (
            <CsvImport periodId={period.id} />
          ) : (
            <p className="text-sm text-muted-foreground">Read only.</p>
          )}
          {imported.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm">
                {imported.length} imported input(s) are included in this period.
              </p>
              {canImport ? (
                <ActionForm
                  action={clearImportedAction}
                  fields={{ periodId: period.id }}
                  label="Remove all imported inputs"
                  variant="outline"
                  confirm="Remove every imported input for this period?"
                />
              ) : null}
              <ul className="max-h-64 overflow-auto rounded-md border text-sm">
                {imported.map((i) => (
                  <li
                    key={i.id}
                    className="flex justify-between gap-3 border-b px-3 py-1.5 last:border-0"
                  >
                    <span>
                      {i.employee.staffNo} · {i.component.code}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {i.quantity !== null ? `qty ${i.quantity.toNumber()}` : ''}
                      {i.quantity !== null && i.amount !== null ? ' · ' : ''}
                      {i.amount !== null ? `UGX ${toUgx(i.amount).toLocaleString('en-UG')}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
