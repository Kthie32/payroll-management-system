import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { db } from '@/lib/db';
import { can, requirePermission, ROLE_LABELS } from '@/lib/rbac';
import { CreateUserForm } from './create-user-form';
import { ManageUser } from './manage-user';

export const metadata = { title: 'Users · Payroll' };
export const dynamic = 'force-dynamic';

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Kampala',
});

export default async function UsersPage() {
  const me = await requirePermission('users.view');
  const canManage = can(me.roles, 'users.manage');
  const users = await db.user.findMany({
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    include: { roles: { include: { role: true } } },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Users</h1>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Create user</CardTitle>
            <CardDescription>
              The user signs in with a temporary password and must change it. System Admins and
              Finance Approvers must also set up two-factor authentication.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateUserForm />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>All users ({users.length})</CardTitle>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last sign-in</TableHead>
                <TableHead className="min-w-72">Roles and actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => {
                const totpEnrolled = Boolean(u.totpEnrolledAt);
                const locked = u.lockedUntil && u.lockedUntil > new Date();
                return (
                  <TableRow key={u.id} className="align-top">
                    <TableCell className="align-top">
                      <p className="font-medium">{u.name}</p>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                    </TableCell>
                    <TableCell className="space-y-1 align-top">
                      <div className="flex flex-wrap gap-1">
                        {u.isActive ? (
                          <Badge variant="success">Active</Badge>
                        ) : (
                          <Badge variant="destructive">Inactive</Badge>
                        )}
                        {locked ? <Badge variant="warning">Locked</Badge> : null}
                        {u.mustChangePassword ? (
                          <Badge variant="outline">Temp password</Badge>
                        ) : null}
                        <Badge variant={totpEnrolled ? 'secondary' : 'outline'}>
                          2FA {totpEnrolled ? 'on' : 'off'}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap align-top text-sm text-muted-foreground">
                      {u.lastLoginAt ? dateFmt.format(u.lastLoginAt) : 'Never'}
                    </TableCell>
                    <TableCell className="align-top">
                      {canManage ? (
                        <ManageUser
                          userId={u.id}
                          roles={u.roles.map((r) => r.role.code)}
                          isActive={u.isActive}
                          totpEnrolled={totpEnrolled}
                          isSelf={u.id === me.id}
                        />
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {u.roles.map((r) => (
                            <Badge key={r.role.code} variant="secondary">
                              {ROLE_LABELS[r.role.code]}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
