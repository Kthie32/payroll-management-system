import Link from 'next/link';
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
import { requirePermission } from '@/lib/rbac';
import { DiffView } from './diff-view';
import { auditFilterSchema, auditWhere, PAGE_SIZE, pageHref } from './query';

export const metadata = { title: 'Audit log · Payroll' };
export const dynamic = 'force-dynamic';

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'medium',
  timeZone: 'Africa/Kampala',
});

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission('audit.view');
  const raw = await searchParams;
  const filters = auditFilterSchema.parse(
    Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v || undefined]),
    ),
  );
  const where = auditWhere(filters);

  const [total, rows, entities, actors] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      orderBy: [{ at: 'desc' }, { id: 'desc' }],
      skip: (filters.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { actor: { select: { name: true, email: true } } },
    }),
    db.auditLog.findMany({
      distinct: ['entity'],
      select: { entity: true },
      orderBy: { entity: 'asc' },
    }),
    db.user.findMany({ select: { id: true, name: true, email: true }, orderBy: { name: 'asc' } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Audit log</h1>
        <p className="text-sm text-muted-foreground">
          Read-only. Entries cannot be edited or deleted. Times are Kampala time.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form method="get" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
            <div className="space-y-2">
              <Label htmlFor="entity">Entity</Label>
              <NativeSelect id="entity" name="entity" defaultValue={filters.entity ?? ''}>
                <option value="">All</option>
                {entities.map((e) => (
                  <option key={e.entity} value={e.entity}>
                    {e.entity}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="actor">Actor</Label>
              <NativeSelect id="actor" name="actor" defaultValue={filters.actor ?? ''}>
                <option value="">Anyone</option>
                {actors.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.email})
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="from">From</Label>
              <Input id="from" name="from" type="date" defaultValue={filters.from ?? ''} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="to">To</Label>
              <Input id="to" name="to" type="date" defaultValue={filters.to ?? ''} />
            </div>
            <div className="flex gap-2">
              <Button type="submit">Filter</Button>
              <Button asChild variant="ghost">
                <Link href="/audit">Clear</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="px-0 pt-2 sm:px-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    No audit entries match these filters.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id} className="align-top">
                    <TableCell className="whitespace-nowrap text-sm">
                      {dateFmt.format(r.at)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.actor ? (
                        <>
                          <p>{r.actor.name}</p>
                          <p className="text-xs text-muted-foreground">{r.actor.email}</p>
                        </>
                      ) : (
                        <span className="text-muted-foreground">System</span>
                      )}
                      {r.ip ? <p className="text-xs text-muted-foreground">{r.ip}</p> : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.action}</TableCell>
                    <TableCell className="text-sm">
                      {r.entity}
                      {r.entityId ? (
                        <p className="font-mono text-xs text-muted-foreground">{r.entityId}</p>
                      ) : null}
                    </TableCell>
                    <TableCell className="min-w-64">
                      {r.before === null && r.after === null ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <details>
                          <summary className="cursor-pointer text-sm text-primary">
                            Show changes
                          </summary>
                          <div className="mt-2">
                            <DiffView before={r.before} after={r.after} />
                          </div>
                        </details>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <nav className="flex items-center justify-between text-sm" aria-label="Pagination">
        <span className="text-muted-foreground">
          {total} entr{total === 1 ? 'y' : 'ies'} · page {Math.min(filters.page, pages)} of {pages}
        </span>
        <div className="flex gap-2">
          {filters.page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={pageHref(filters, filters.page - 1)}>Previous</Link>
            </Button>
          ) : null}
          {filters.page < pages ? (
            <Button asChild variant="outline" size="sm">
              <Link href={pageHref(filters, filters.page + 1)}>Next</Link>
            </Button>
          ) : null}
        </div>
      </nav>
    </div>
  );
}
