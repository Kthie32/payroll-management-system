import { notFound } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { decrypt } from '@/lib/crypto';
import { db } from '@/lib/db';
import { dateToIso, maskNin } from '@/lib/employees/validation';
import { requirePermission } from '@/lib/rbac';
import { EmployeeForm } from '../../employee-form';
import { fullName } from '../../labels';

export const metadata = { title: 'Edit employee · Payroll' };
export const dynamic = 'force-dynamic';

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('employees.edit');
  const { id } = await params;
  const [e, payGroups, departments] = await Promise.all([
    db.employee.findUnique({ where: { id } }),
    db.payGroup.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    db.department.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  if (!e) notFound();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Edit {fullName(e)}</h1>
      <Card>
        <CardContent className="pt-6">
          <EmployeeForm
            employeeId={e.id}
            maskedNin={e.ninEnc ? maskNin(decrypt(e.ninEnc)) : null}
            payGroups={payGroups}
            departments={departments}
            defaults={{
              staffNo: e.staffNo,
              firstName: e.firstName,
              lastName: e.lastName,
              otherNames: e.otherNames ?? '',
              workerType: e.workerType,
              payGroupId: e.payGroupId,
              departmentId: e.departmentId ?? '',
              jobTitle: e.jobTitle ?? '',
              grade: e.grade ?? '',
              hireDate: dateToIso(e.hireDate),
              residency: e.residency,
              tin: e.tin ?? '',
              nssfNo: e.nssfNo ?? '',
              lstDistrict: e.lstDistrict ?? '',
              payeApplicable: e.payeApplicable,
              nssfApplicable: e.nssfApplicable,
              lstApplicable: e.lstApplicable,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
