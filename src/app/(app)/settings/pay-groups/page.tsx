import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/lib/db';
import { can, requirePermission } from '@/lib/rbac';
import { PageHeader, ReadOnlyNote } from '../_components/page-header';
import { FREQUENCY_LABELS } from '@/lib/settings/components';
import { CreatePayGroupForm, EditPayGroupForm } from './pay-group-forms';

export const metadata = { title: 'Pay groups · Payroll' };
export const dynamic = 'force-dynamic';

export default async function PayGroupsPage() {
  const user = await requirePermission('settings.view');
  const canEdit = can(user.roles, 'settings.edit');
  const groups = await db.payGroup.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { employees: true, periods: true, runs: true } } },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pay groups"
        description="Employees in a group are paid together on the same schedule."
        back={{ href: '/settings', label: 'Settings' }}
      />
      {!canEdit ? <ReadOnlyNote>You can view pay groups but not change them.</ReadOnlyNote> : null}

      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle>Add a pay group</CardTitle>
            <CardDescription>
              Weekly and fortnightly groups have PAYE worked out cumulatively over the month.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreatePayGroupForm />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>All pay groups ({groups.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {groups.map((g) => {
              const { employees, periods, runs } = g._count;
              return (
                <li key={g.id} className="space-y-2 py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary">{employees} employees</Badge>
                    <Badge variant="outline">{periods} periods</Badge>
                    <Badge variant="outline">{runs} runs</Badge>
                  </div>
                  {canEdit ? (
                    <EditPayGroupForm
                      group={{ id: g.id, name: g.name, frequency: g.frequency }}
                      frequencyLocked={periods > 0}
                      deletable={employees + periods + runs === 0}
                    />
                  ) : (
                    <p className="font-medium">
                      {g.name}{' '}
                      <span className="text-sm font-normal text-muted-foreground">
                        · {FREQUENCY_LABELS[g.frequency]}
                      </span>
                    </p>
                  )}
                </li>
              );
            })}
            {groups.length === 0 ? (
              <li className="py-6 text-center text-sm text-muted-foreground">No pay groups yet.</li>
            ) : null}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
