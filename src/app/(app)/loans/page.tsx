import { LoanStatus, LoanType, type Prisma } from '@prisma/client';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { db } from '@/lib/db';
import { LOAN_TYPE_LABELS, LOAN_TYPES } from '@/lib/loans/logic';
import { formatUgx, toUgx } from '@/lib/money';
import { can, requirePermission } from '@/lib/rbac';
import { PageHeader } from '../settings/_components/page-header';
import { LOAN_STATUS_BADGE } from './status';

export const metadata = { title: 'Loans · Payroll' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

const filterSchema = z.object({
  status: z.nativeEnum(LoanStatus).optional().catch(undefined),
  type: z.nativeEnum(LoanType).optional().catch(undefined),
  q: z.string().trim().max(80).optional().catch(undefined),
  page: z.coerce.number().int().min(1).catch(1).default(1),
});

export default async function LoansPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission('loans.view');
  const canEdit = can(user.roles, 'loans.edit');
  const raw = await searchParams;
  const f = filterSchema.parse(
    Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, (Array.isArray(v) ? v[0] : v) || undefined])),
  );
  const status = raw.status === undefined ? 'ACTIVE' : f.status; // default view: active loans

  const where: Prisma.LoanWhereInput = {
    ...(status ? { status } : {}),
    ...(f.type ? { type: f.type } : {}),
    ...(f.q
      ? {
          employee: {
            OR: [
              { staffNo: { contains: f.q } },
              { firstName: { contains: f.q } },
              { lastName: { contains: f.q } },
            ],
          },
        }
      : {}),
  };
  const [total, loans, outstanding] = await Promise.all([
    db.loan.count({ where }),
    db.loan.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { employee: { select: { staffNo: true, firstName: true, lastName: true } } },
    }),
    db.loan.aggregate({ where: { ...where, status: 'ACTIVE' }, _sum: { balance: true } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (page: number) => {
    const p = new URLSearchParams();
    p.set('status', status ?? '');
    if (f.type) p.set('type', f.type);
    if (f.q) p.set('q', f.q);
    p.set('page', String(page));
    return `/loans?${p.toString()}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Loans"
        description="Loans, salary advances and SACCO contributions deducted through payroll."
        actions={
          canEdit ? (
            <Button asChild>
              <Link href="/loans/new">
                <Plus aria-hidden /> New loan
              </Link>
            </Button>
          ) : null
        }
      />

      <Card>
        <CardContent className="pt-6">
          <form method="get" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_12rem_12rem_auto] lg:items-end">
            <div className="space-y-2">
              <Label htmlFor="q">Employee</Label>
              <Input id="q" name="q" defaultValue={f.q ?? ''} placeholder="Name or staff number" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <NativeSelect id="status" name="status" defaultValue={status ?? ''}>
                <option value="">All</option>
                <option value="ACTIVE">Active</option>
                <option value="SETTLED">Settled</option>
                <option value="WRITTEN_OFF">Written off</option>
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="type">Type</Label>
              <NativeSelect id="type" name="type" defaultValue={f.type ?? ''}>
                <option value="">All</option>
                {LOAN_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {LOAN_TYPE_LABELS[t]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Button type="submit" variant="outline">
              Filter
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 px-0 pt-4 sm:px-6">
          <p className="px-4 text-sm text-muted-foreground sm:px-0">
            {total} loan{total === 1 ? '' : 's'} · outstanding on active loans shown:{' '}
            <strong className="text-foreground">{formatUgx(toUgx(outstanding._sum.balance ?? 0n))}</strong>
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Principal</TableHead>
                <TableHead className="text-right">Per period</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loans.map((l) => {
                const s = LOAN_STATUS_BADGE[l.status];
                return (
                  <TableRow key={l.id}>
                    <TableCell>
                      <Link href={`/loans/${l.id}`} className="font-medium hover:underline">
                        {l.employee.lastName}, {l.employee.firstName}
                      </Link>
                      <p className="text-xs text-muted-foreground">{l.employee.staffNo}</p>
                    </TableCell>
                    <TableCell className="text-sm">{LOAN_TYPE_LABELS[l.type]}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUgx(toUgx(l.principal))}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUgx(toUgx(l.installment))}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatUgx(toUgx(l.balance))}</TableCell>
                    <TableCell>
                      <Badge variant={s.variant}>{s.label}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
              {loans.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No loans match these filters.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
          {pages > 1 ? (
            <nav className="flex items-center justify-between px-4 text-sm sm:px-0" aria-label="Pagination">
              {f.page > 1 ? <Link href={qs(f.page - 1)} className="underline">Previous</Link> : <span />}
              <span className="text-muted-foreground">
                Page {f.page} of {pages}
              </span>
              {f.page < pages ? <Link href={qs(f.page + 1)} className="underline">Next</Link> : <span />}
            </nav>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
