import { FormMessage } from '@/components/form-message';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requirePermission, ROLE_LABELS } from '@/lib/rbac';

export const metadata = { title: 'Dashboard · Payroll' };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const user = await requirePermission('dashboard.view');
  const { denied } = await searchParams;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Welcome, {user.name}</h1>
      {denied ? <FormMessage message="You don’t have access to that page." /> : null}
      <Card>
        <CardHeader>
          <CardTitle>Your access</CardTitle>
          <CardDescription>What you can do depends on your roles.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {user.roles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No roles assigned yet. Ask a system administrator.
            </p>
          ) : (
            user.roles.map((r) => (
              <Badge key={r} variant="secondary">
                {ROLE_LABELS[r]}
              </Badge>
            ))
          )}
        </CardContent>
      </Card>
      <p className="text-sm text-muted-foreground">
        Payroll summaries and run status will appear here in Phase 3.
      </p>
    </div>
  );
}
