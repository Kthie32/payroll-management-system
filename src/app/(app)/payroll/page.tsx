import { ComingSoon } from '@/components/coming-soon';
import { requirePermission } from '@/lib/rbac';

export const metadata = { title: 'Payroll · Payroll' };

export default async function Page() {
  await requirePermission('payroll.view');
  return (
    <ComingSoon
      title="Payroll"
      phase={3}
      what="Pay periods, payroll runs, review, approval and payslips."
    />
  );
}
