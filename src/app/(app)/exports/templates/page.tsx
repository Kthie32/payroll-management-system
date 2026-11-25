import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { can, requireUser } from '@/lib/rbac';

export const metadata = { title: 'Bank file templates · Payroll' };
export const dynamic = 'force-dynamic';

export default async function TemplatesPage() {
  const user = await requireUser();
  const canEdit = can(user.roles, 'templates.manage');
  if (!canEdit && !can(user.roles, 'exports.view')) redirect('/dashboard?denied=1');

  const banks = await db.bank.findMany({
    orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    include: {
      templates: { orderBy: { updatedAt: 'desc' }, take: 1 },
      _count: { select: { accounts: { where: { isActive: true } } } },
    },
  });

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {can(user.roles, 'exports.view') ? (
          <Link href="/exports" className="text-sm text-muted-foreground hover:underline">
            ← Bank exports
          </Link>
        ) : null}
        <h1 className="text-2xl font-semibold">Payment file templates</h1>
        <p className="text-sm text-muted-foreground">
          Each bank and mobile money provider can have its own file layout. Without one, banks use
          the generic CSV template and MTN MoMo / Airtel Money use their bulk-payment layouts.
          {canEdit ? '' : ' Only a system administrator can change templates.'}
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Banks and mobile money providers</CardTitle>
          <CardDescription>
            Banks are managed in Settings. Active accounts shows how many employees are paid through
            each bank.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          {banks.length === 0 ? (
            <p className="px-6 text-sm text-muted-foreground sm:px-0">
              No banks have been set up yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bank</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Template</TableHead>
                  <TableHead className="text-right">Active accounts</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {banks.map((b) => {
                  const t = b.templates[0];
                  return (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">
                        {b.name}{' '}
                        {b.kind === 'MOBILE_MONEY' ? (
                          <Badge variant="outline">Mobile money</Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>{b.code}</TableCell>
                      <TableCell>
                        {t ? (
                          <Badge>{t.format} · custom</Badge>
                        ) : (
                          <Badge variant="secondary">
                            CSV · {b.kind === 'MOBILE_MONEY' ? 'provider default' : 'default'}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{b._count.accounts}</TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/exports/templates/${b.id}`}>
                            {canEdit ? 'Edit' : 'View'}
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
