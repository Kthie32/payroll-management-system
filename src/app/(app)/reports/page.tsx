import Link from 'next/link';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { kampalaToday } from '@/lib/dashboard/load';
import { requirePermission } from '@/lib/rbac';
import { parseSelection, selectionQuery } from '@/lib/reports/range';
import { REPORT_KEYS, REPORT_META } from '@/lib/reports/types';
import { SelectionForm } from './selection-form';

export const metadata = { title: 'Reports · Payroll' };
export const dynamic = 'force-dynamic';

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission('reports.view');
  const selection = parseSelection(await searchParams);
  const today = kampalaToday();
  const q = selectionQuery(selection);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Only approved (or later) payroll runs are included unless you tick “include draft”. Every
          report can be downloaded as Excel or CSV.
        </p>
      </div>
      <SelectionForm action="/reports" selection={selection} today={today} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORT_KEYS.map((key) => (
          <Link key={key} href={`/reports/${key}?${q}`} className="group">
            <Card className="h-full transition-colors group-hover:border-primary">
              <CardHeader>
                <CardTitle className="text-base">{REPORT_META[key].title}</CardTitle>
                <CardDescription>{REPORT_META[key].description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
