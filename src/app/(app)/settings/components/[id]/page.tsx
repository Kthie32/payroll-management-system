import { notFound } from 'next/navigation';
import { FormMessage } from '@/components/form-message';
import { Card, CardContent } from '@/components/ui/card';
import { db } from '@/lib/db';
import { can, requirePermission } from '@/lib/rbac';
import { componentInUse } from '@/lib/settings/usage';
import { PageHeader, ReadOnlyNote } from '../../_components/page-header';
import { ComponentForm } from '../component-form';

export const metadata = { title: 'Pay component · Payroll' };
export const dynamic = 'force-dynamic';

export default async function ComponentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const user = await requirePermission('settings.view');
  const canEdit = can(user.roles, 'settings.edit');
  const { id } = await params;
  const { saved } = await searchParams;
  const c = await db.payComponent.findUnique({ where: { id } });
  if (!c) notFound();
  const inUse = await componentInUse(c.id, c.code);

  return (
    <div className="space-y-6">
      <PageHeader
        title={c.name}
        description={<span className="font-mono">{c.code}</span>}
        back={{ href: '/settings/components', label: 'Pay components' }}
      />
      {saved ? <FormMessage tone="success" message="Component created." /> : null}
      {!canEdit ? <ReadOnlyNote>You can view this component but not change it.</ReadOnlyNote> : null}
      {inUse && canEdit ? (
        <ReadOnlyNote>
          This component is in use. Untick “Active” to stop using it; it cannot be deleted.
        </ReadOnlyNote>
      ) : null}
      <Card>
        <CardContent className="pt-6">
          <ComponentForm
            canEdit={canEdit}
            inUse={inUse}
            initial={{
              id: c.id,
              code: c.code,
              name: c.name,
              kind: c.kind,
              calcType: c.calcType,
              taxable: c.taxable,
              nssfable: c.nssfable,
              prorate: c.prorate,
              recurring: c.recurring,
              isActive: c.isActive,
              priority: c.priority,
              sortOrder: c.sortOrder,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
