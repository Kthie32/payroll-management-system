import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { deleteBankAction, saveBankAction } from '../../employees/reference-actions';
import { RefCreateForm, type RefField, RefRow } from '../../employees/reference-editor';

export const metadata = { title: 'Banks and mobile money · Magezi Payroll' };
export const dynamic = 'force-dynamic';

const KIND_OPTIONS = [
  { value: 'BANK', label: 'Bank' },
  { value: 'MOBILE_MONEY', label: 'Mobile money' },
] as const;

const FIELDS: RefField[] = [
  { name: 'name', label: 'Name', maxLength: 120, required: true },
  { name: 'code', label: 'Code', maxLength: 20, required: true, mono: true },
  { name: 'kind', label: 'Type', maxLength: 20, required: true, options: KIND_OPTIONS },
];

/** System Admin: banks and mobile money providers that employees can be paid through. */
export default async function AdminBanksPage() {
  await requirePermission('banks.manage');
  const institutions = await db.bank.findMany({
    orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    include: {
      _count: { select: { accounts: { where: { isActive: true } }, templates: true } },
    },
  });
  const groups = KIND_OPTIONS.map((k) => ({
    ...k,
    rows: institutions.filter((i) => i.kind === k.value),
  }));

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Banks and mobile money</h1>
        <p className="text-sm text-muted-foreground">
          Where salaries can be paid. Employees choose one of these as their payment destination;
          each one gets its own bulk-payment file.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add a bank or provider</CardTitle>
          <CardDescription>
            The code identifies it in CSV imports and payment files. For mobile money, the
            employee&apos;s account number is their wallet phone number. Use the codes MTNMOMO and
            AIRTELMONEY for MTN and Airtel so wallet numbers are checked against their prefixes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RefCreateForm fields={FIELDS} save={saveBankAction} />
        </CardContent>
      </Card>

      {groups.map((g) => (
        <Card key={g.value}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {g.value === 'BANK' ? 'Banks' : 'Mobile money providers'}
              <Badge variant="outline">{g.rows.length}</Badge>
            </CardTitle>
            <CardDescription>
              One that is used by any account, export template or export cannot be deleted, and its
              type cannot change once employees use it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {g.rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">None yet.</p>
            ) : (
              <ul className="divide-y">
                {g.rows.map((b) => (
                  <RefRow
                    key={b.id}
                    id={b.id}
                    noun={b.kind === 'BANK' ? 'bank' : 'provider'}
                    fields={FIELDS}
                    values={{ name: b.name, code: b.code, kind: b.kind }}
                    usage={`${b._count.accounts} active account${b._count.accounts === 1 ? '' : 's'}${
                      b._count.templates ? ` · ${b._count.templates} export template(s)` : ''
                    }`}
                    canEdit
                    save={saveBankAction}
                    remove={deleteBankAction}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
