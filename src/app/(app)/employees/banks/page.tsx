import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/lib/db';
import { can, requirePermission } from '@/lib/rbac';
import { EmployeesNav } from '../employees-nav';
import { deleteBankAction, saveBankAction } from '../reference-actions';
import { RefCreateForm, type RefField, RefRow } from '../reference-editor';

export const metadata = { title: 'Banks · Payroll' };
export const dynamic = 'force-dynamic';

const FIELDS: RefField[] = [
  { name: 'name', label: 'Name', maxLength: 120, required: true },
  { name: 'code', label: 'Code', maxLength: 20, required: true, mono: true },
];

export default async function BanksPage() {
  const user = await requirePermission('employees.view');
  const canEdit = can(user.roles, 'banks.manage');
  const banks = await db.bank.findMany({
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { accounts: { where: { isActive: true } }, templates: true } },
    },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Banks</h1>
      <EmployeesNav active="/employees/banks" canEdit={canEdit} />

      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle>Add bank</CardTitle>
            <CardDescription>
              The code identifies the bank in CSV imports and bank payment files.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RefCreateForm fields={FIELDS} save={saveBankAction} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>All banks ({banks.length})</CardTitle>
          <CardDescription>
            A bank used by any account, export template or export cannot be deleted.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {banks.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No banks yet.</p>
          ) : (
            <ul className="divide-y">
              {banks.map((b) => (
                <RefRow
                  key={b.id}
                  id={b.id}
                  noun="bank"
                  fields={FIELDS}
                  values={{ name: b.name, code: b.code }}
                  usage={`${b._count.accounts} active account${b._count.accounts === 1 ? '' : 's'}${
                    b._count.templates ? ` · ${b._count.templates} export template(s)` : ''
                  }`}
                  canEdit={canEdit}
                  save={saveBankAction}
                  remove={deleteBankAction}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
