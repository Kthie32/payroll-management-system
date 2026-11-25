import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/lib/db';
import { toUgx } from '@/lib/money';
import { formatIsoDate, toIsoDate } from '@/lib/payroll/dates';
import { INPUT_CSV_COLUMNS } from '@/lib/payroll/csv-inputs';
import {
  inputComponents,
  isPeriodLocked,
  periodEmployees,
} from '@/lib/payroll/server/periods-inputs';
import { can, requirePermission } from '@/lib/rbac';
import { ActionForm } from '../../../_components/action-form';
import { clearImportedAction } from '../../../actions';
import { CsvImport } from './csv-import';
import { InputsGrid } from './inputs-grid';

export const metadata = { title: 'Payroll inputs · Payroll' };
export const dynamic = 'force-dynamic';

export default async function InputsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('payroll.view');
  const { id } = await params;
  const period = await db.payPeriod.findUnique({ where: { id }, include: { payGroup: true } });
  if (!period) notFound();

  const [locked, employees, components, inputs] = await Promise.all([
    isPeriodLocked(period.id),
    periodEmployees(period.id),
    inputComponents(),
    db.payrollInput.findMany({
      where: { periodId: period.id },
      include: { component: true, employee: true },
      orderBy: [{ employee: { staffNo: 'asc' } }, { component: { code: 'asc' } }],
    }),
  ]);
  const editable = !locked && can(user.roles, 'payroll.inputs');
  const canImport = !locked && can(user.roles, 'payroll.prepare');

  const manual: Record<string, string> = {};
  for (const i of inputs) {
    if (i.source !== 'MANUAL') continue;
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

      <Card>
        <CardHeader>
          <CardTitle>Import from CSV</CardTitle>
          <CardDescription>
            Columns: {INPUT_CSV_COLUMNS.join(', ')}. Use quantity for rate-based components (e.g.
            OVERTIME hours, DAILY_WAGE days; an amount on those rows overrides the rate per unit)
            and amount for fixed ones (e.g. BONUS, ADVANCE). The whole file is checked first and
            nothing is saved if any row has an error.
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
