import { Plus } from 'lucide-react';
import Link from 'next/link';
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
import { can, requirePermission } from '@/lib/rbac';
import { EmployeesNav } from './employees-nav';
import {
  dateFmt,
  fullName,
  STATUS_BADGE,
  STATUS_LABELS,
  WORKER_TYPE_LABELS,
} from './labels';
import { employeeWhere, PAGE_SIZE, pageHref, parseFilters } from './query';

export const metadata = { title: 'Employees · Payroll' };
export const dynamic = 'force-dynamic';

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission('employees.view');
  const canEdit = can(user.roles, 'employees.edit');
  const filters = parseFilters(await searchParams);
  const where = employeeWhere(filters);

  const [total, rows, payGroups, departments] = await Promise.all([
    db.employee.count({ where }),
    db.employee.findMany({
      where,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { staffNo: 'asc' }],
      skip: (filters.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        payGroup: { select: { name: true } },
        department: { select: { name: true } },
      },
    }),
    db.payGroup.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    db.department.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(
    filters.q || filters.status || filters.payGroup || filters.department || filters.workerType,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Employees</h1>
        {canEdit ? (
          <Button asChild>
            <Link href="/employees/new">
              <Plus aria-hidden /> New employee
            </Link>
          </Button>
        ) : null}
      </div>
      <EmployeesNav active="/employees" canEdit={canEdit} />

      <Card>
        <CardContent className="pt-6">
          <form method="get" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
            <div className="space-y-2 lg:col-span-2">
              <Label htmlFor="q">Search</Label>
              <Input
                id="q"
                name="q"
                type="search"
                placeholder="Name, staff number or job title"
                defaultValue={filters.q ?? ''}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <NativeSelect id="status" name="status" defaultValue={filters.status ?? ''}>
                <option value="">Any</option>
                {Object.entries(STATUS_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="payGroup">Pay group</Label>
              <NativeSelect id="payGroup" name="payGroup" defaultValue={filters.payGroup ?? ''}>
                <option value="">Any</option>
                {payGroups.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="department">Department</Label>
              <NativeSelect
                id="department"
                name="department"
                defaultValue={filters.department ?? ''}
              >
                <option value="">Any</option>
                <option value="none">No department</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="workerType">Worker type</Label>
              <NativeSelect
                id="workerType"
                name="workerType"
                defaultValue={filters.workerType ?? ''}
              >
                <option value="">Any</option>
                {Object.entries(WORKER_TYPE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex gap-2 lg:col-span-6">
              <Button type="submit">Filter</Button>
              {filtered ? (
                <Button asChild variant="ghost">
                  <Link href="/employees">Clear</Link>
                </Button>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="px-0 pt-2 sm:px-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Staff no.</TableHead>
                <TableHead className="hidden md:table-cell">Department</TableHead>
                <TableHead className="hidden md:table-cell">Pay group</TableHead>
                <TableHead className="hidden lg:table-cell">Hired</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    {filtered
                      ? 'No employees match these filters.'
                      : 'No employees yet. Add one or import a CSV file.'}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <Link
                        href={`/employees/${e.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {fullName(e)}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {[e.jobTitle, WORKER_TYPE_LABELS[e.workerType]].filter(Boolean).join(' · ')}
                      </p>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{e.staffNo}</TableCell>
                    <TableCell className="hidden text-sm md:table-cell">
                      {e.department?.name ?? '—'}
                    </TableCell>
                    <TableCell className="hidden text-sm md:table-cell">{e.payGroup.name}</TableCell>
                    <TableCell className="hidden whitespace-nowrap text-sm lg:table-cell">
                      {dateFmt.format(e.hireDate)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_BADGE[e.status]}>{STATUS_LABELS[e.status]}</Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between px-3 pt-4 text-sm text-muted-foreground sm:px-0">
            <span>
              {total} employee{total === 1 ? '' : 's'} · page {filters.page} of {pages}
            </span>
            <div className="flex gap-2">
              {filters.page > 1 ? (
                <Button asChild size="sm" variant="outline">
                  <Link href={pageHref(filters, filters.page - 1)}>Previous</Link>
                </Button>
              ) : null}
              {filters.page < pages ? (
                <Button asChild size="sm" variant="outline">
                  <Link href={pageHref(filters, filters.page + 1)}>Next</Link>
                </Button>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
