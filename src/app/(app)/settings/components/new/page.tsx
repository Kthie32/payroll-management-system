import { Card, CardContent } from '@/components/ui/card';
import { requirePermission } from '@/lib/rbac';
import { PageHeader } from '../../_components/page-header';
import { ComponentForm } from '../component-form';

export const metadata = { title: 'New pay component · Payroll' };
export const dynamic = 'force-dynamic';

export default async function NewComponentPage() {
  await requirePermission('settings.edit');
  return (
    <div className="space-y-6">
      <PageHeader title="New pay component" back={{ href: '/settings/components', label: 'Pay components' }} />
      <Card>
        <CardContent className="pt-6">
          <ComponentForm
            canEdit
            initial={{
              code: '',
              name: '',
              kind: 'EARNING',
              calcType: 'FIXED',
              taxable: true,
              nssfable: true,
              prorate: false,
              recurring: true,
              isActive: true,
              priority: 100,
              sortOrder: 100,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
