import { Card, CardContent } from '@/components/ui/card';
import { db } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { EMPTY_EMPLOYEE, EmployeeForm } from '../employee-form';

export const metadata = { title: 'New employee · Payroll' };
export const dynamic = 'force-dynamic';

export default async function NewEmployeePage() {
  await requirePermission('employees.edit');
  const [payGroups, departments] = await Promise.all([
    db.payGroup.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    db.department.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New employee</h1>
        <p className="text-sm text-muted-foreground">
          Add bank details and pay components on the employee page after saving.
        </p>
      </div>
      <Card>
        <CardContent className="pt-6">
          <EmployeeForm
            defaults={EMPTY_EMPLOYEE}
            payGroups={payGroups}
            departments={departments}
          />
        </CardContent>
      </Card>
    </div>
  );
}
