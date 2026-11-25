import { Plus } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { db } from '@/lib/db';
import { can, requirePermission } from '@/lib/rbac';
import { CALC_LABELS, KIND_LABELS } from '@/lib/settings/components';
import { PageHeader } from '../_components/page-header';

export const metadata = { title: 'Pay components · Payroll' };
export const dynamic = 'force-dynamic';

const KIND_ORDER = { EARNING: 0, DEDUCTION: 1, EMPLOYER: 2 } as const;

export default async function ComponentsPage() {
  const user = await requirePermission('settings.view');
  const canEdit = can(user.roles, 'settings.edit');
  const rows = (await db.payComponent.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] })).sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pay components"
        description="Every earning, deduction and employer cost the payroll can use."
        back={{ href: '/settings', label: 'Settings' }}
        actions={
          canEdit ? (
            <Button asChild>
              <Link href="/settings/components/new">
                <Plus aria-hidden /> New component
              </Link>
            </Button>
          ) : null
        }
      />
      <Card>
        <CardContent className="px-0 pt-2 sm:px-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Component</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Calculation</TableHead>
                <TableHead>Treatment</TableHead>
                <TableHead className="text-right">Priority</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id} className={c.isActive ? undefined : 'opacity-60'}>
                  <TableCell>
                    <Link href={`/settings/components/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    <p className="font-mono text-xs text-muted-foreground">{c.code}</p>
                  </TableCell>
                  <TableCell>
                    <Badge variant={c.kind === 'EARNING' ? 'success' : c.kind === 'DEDUCTION' ? 'warning' : 'secondary'}>
                      {KIND_LABELS[c.kind]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{CALC_LABELS[c.calcType]}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {!c.isActive ? <Badge variant="destructive">Inactive</Badge> : null}
                      {c.taxable ? <Badge variant="outline">Taxable</Badge> : null}
                      {c.nssfable ? <Badge variant="outline">NSSF</Badge> : null}
                      {c.prorate ? <Badge variant="outline">Prorated</Badge> : null}
                      {!c.recurring ? <Badge variant="outline">One-off</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.priority}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    No pay components yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
