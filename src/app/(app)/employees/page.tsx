import { ComingSoon } from '@/components/coming-soon';
import { requirePermission } from '@/lib/rbac';

export const metadata = { title: 'Employees · Payroll' };

export default async function Page() {
  await requirePermission('employees.view');
  return (
    <ComingSoon
      title="Employees"
      phase={2}
      what="Employee records, pay components, bank accounts and CSV import."
    />
  );
}
