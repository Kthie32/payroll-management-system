import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/lib/db';
import { kampalaToday } from '@/lib/dashboard/load';
import { requirePermission } from '@/lib/rbac';
import { buildReport } from '@/lib/reports/load';
import { parseSelection, selectionQuery } from '@/lib/reports/range';
import { REPORT_KEYS, REPORT_META, type ReportKey } from '@/lib/reports/types';
import { ReportTableView } from '../report-table';
import { SelectionForm } from '../selection-form';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ report: string }> }) {
  const { report } = await params;
  const meta = REPORT_META[report as ReportKey];
  return { title: `${meta?.title ?? 'Report'} · Payroll` };
}

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ report: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission('reports.view');
  const { report } = await params;
  if (!(REPORT_KEYS as readonly string[]).includes(report)) notFound();
  const key = report as ReportKey;
  const selection = parseSelection(await searchParams);
  const today = kampalaToday();
  const table = await buildReport(db, key, selection, today);
  const q = selectionQuery(selection);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link href={`/reports?${q}`} className="text-sm text-muted-foreground hover:underline">
          ← All reports
        </Link>
        <h1 className="text-2xl font-semibold">{REPORT_META[key].title}</h1>
        <p className="text-sm text-muted-foreground">{REPORT_META[key].description}</p>
      </div>

      {key !== 'loans' ? (
        <SelectionForm
          action={`/reports/${key}`}
          selection={selection}
          today={today}
          showGrouping={key === 'register'}
        />
      ) : null}

      {table.draftRunCount > 0 ? (
        <p role="alert" className="rounded-md bg-warning/20 px-3 py-2 text-sm font-medium">
          Includes {table.draftRunCount} unapproved run(s). These figures are not final.
        </p>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4 space-y-0">
          <div className="space-y-1">
            <CardTitle>{table.title}</CardTitle>
            <CardDescription>
              {table.subtitle}
              {key !== 'loans' ? ` · ${table.runCount} run(s)` : ''} · {table.rows.length} row(s)
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button asChild size="sm" variant="outline">
              <a href={`/api/reports/${key}?${q}&format=xlsx`}>Download Excel</a>
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href={`/api/reports/${key}?${q}&format=csv`}>Download CSV</a>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 overflow-x-auto px-0 sm:px-6">
          <ReportTableView table={table} />
          {table.notes?.length ? (
            <ul className="space-y-1 px-6 text-xs text-muted-foreground sm:px-0">
              {table.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
