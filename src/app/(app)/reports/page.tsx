import { ComingSoon } from '@/components/coming-soon';
import { requirePermission } from '@/lib/rbac';

export const metadata = { title: 'Reports · Payroll' };

export default async function Page() {
  await requirePermission('reports.view');
  return (
    <ComingSoon
      title="Reports"
      phase={4}
      what="PAYE, NSSF and LST returns, payroll registers and cost reports."
    />
  );
}
