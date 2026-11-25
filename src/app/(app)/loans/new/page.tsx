import { Card, CardContent } from '@/components/ui/card';
import { db } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { toIsoDate } from '@/lib/settings/input';
import { PageHeader } from '../../settings/_components/page-header';
import { LoanForm } from '../loan-form';

export const metadata = { title: 'New loan · Payroll' };
export const dynamic = 'force-dynamic';

export default async function NewLoanPage({
  searchParams,
}: {
  searchParams: Promise<{ employeeId?: string }>;
}) {
  await requirePermission('loans.edit');
  const { employeeId } = await searchParams;
  const since = new Date(Date.now() - 62 * 24 * 60 * 60 * 1000);
  const [employees, periods] = await Promise.all([
    db.employee.findMany({
      where: { status: { not: 'EXITED' } },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: { id: true, staffNo: true, firstName: true, lastName: true, payGroupId: true },
    }),
    db.payPeriod.findMany({
      where: { endDate: { gte: since } },
      orderBy: { startDate: 'asc' },
      take: 300,
      select: { id: true, payGroupId: true, startDate: true, endDate: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="New loan or advance"
        description="Deducted from pay every period until the balance is cleared."
        back={{ href: '/loans', label: 'Loans' }}
      />
      <Card>
        <CardContent className="pt-6">
          <LoanForm
            defaultEmployeeId={employees.some((e) => e.id === employeeId) ? employeeId : undefined}
            employees={employees.map((e) => ({
              id: e.id,
              payGroupId: e.payGroupId,
              label: `${e.lastName}, ${e.firstName} (${e.staffNo})`,
            }))}
            periods={periods.map((p) => ({
              id: p.id,
              payGroupId: p.payGroupId,
              label: `${toIsoDate(p.startDate)} – ${toIsoDate(p.endDate)}`,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
