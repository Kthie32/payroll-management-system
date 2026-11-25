import { ComingSoon } from '@/components/coming-soon';
import { requirePermission } from '@/lib/rbac';

export const metadata = { title: 'Loans · Payroll' };

export default async function Page() {
  await requirePermission('loans.view');
  return (
    <ComingSoon
      title="Loans"
      phase={2}
      what="Loans, salary advances and SACCO deductions with repayment schedules."
    />
  );
}
