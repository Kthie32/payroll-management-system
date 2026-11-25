import { ComingSoon } from '@/components/coming-soon';
import { requirePermission } from '@/lib/rbac';

export const metadata = { title: 'Settings · Payroll' };

export default async function Page() {
  await requirePermission('settings.view');
  return (
    <ComingSoon
      title="Settings"
      phase={2}
      what="Statutory rule versions, proration basis and minimum net pay."
    />
  );
}
