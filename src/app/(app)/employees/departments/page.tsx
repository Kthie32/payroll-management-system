import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/lib/db';
import { can, requirePermission } from '@/lib/rbac';
import { EmployeesNav } from '../employees-nav';
import { deleteDepartmentAction, saveDepartmentAction } from '../reference-actions';
import { RefCreateForm, type RefField, RefRow } from '../reference-editor';

export const metadata = { title: 'Departments · Payroll' };
export const dynamic = 'force-dynamic';

const FIELDS: RefField[] = [
  { name: 'name', label: 'Name', maxLength: 120, required: true },
  { name: 'costCentreCode', label: 'Cost centre', maxLength: 40, mono: true },
];

export default async function DepartmentsPage() {
  const user = await requirePermission('employees.view');
  const canEdit = can(user.roles, 'employees.edit');
  const departments = await db.department.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { employees: true } } },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Departments</h1>
      <EmployeesNav active="/employees/departments" canEdit={canEdit} />

      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle>Add department</CardTitle>
            <CardDescription>
              The cost centre code is used to group payroll costs in reports.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RefCreateForm fields={FIELDS} save={saveDepartmentAction} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>All departments ({departments.length})</CardTitle>
          <CardDescription>A department with employees cannot be deleted.</CardDescription>
        </CardHeader>
        <CardContent>
          {departments.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No departments yet.</p>
          ) : (
            <ul className="divide-y">
              {departments.map((d) => (
                <RefRow
                  key={d.id}
                  id={d.id}
                  noun="department"
                  fields={FIELDS}
                  values={{ name: d.name, costCentreCode: d.costCentreCode ?? '' }}
                  usage={`${d._count.employees} employee${d._count.employees === 1 ? '' : 's'}`}
                  canEdit={canEdit}
                  save={saveDepartmentAction}
                  remove={deleteDepartmentAction}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
