import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { requiredOnboardingStep } from '@/auth.config';
import { withAudit } from '@/lib/audit';
import { ipFromHeaders } from '@/lib/auth/request';
import { kampalaToday } from '@/lib/dashboard/load';
import { db } from '@/lib/db';
import { CONTENT_TYPES, safeFileName, toCsv, toXlsx } from '@/lib/exports/writers';
import { can } from '@/lib/rbac/core';
import { reportToGrid } from '@/lib/reports/aggregate';
import { buildReport } from '@/lib/reports/load';
import { parseSelection } from '@/lib/reports/range';
import { REPORT_KEYS, type ReportKey } from '@/lib/reports/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Download a report as CSV or XLSX. Downloads are audited (metadata only). */
export async function GET(req: Request, { params }: { params: Promise<{ report: string }> }) {
  const session = await auth();
  const sessionUser = session?.user;
  if (!sessionUser?.id || requiredOnboardingStep(sessionUser)) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }
  const user = await db.user.findUnique({
    where: { id: sessionUser.id },
    select: { id: true, isActive: true, roles: { select: { role: { select: { code: true } } } } },
  });
  if (!user?.isActive || !can(user.roles.map((r) => r.role.code), 'reports.view')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { report } = await params;
  if (!(REPORT_KEYS as readonly string[]).includes(report)) {
    return NextResponse.json({ error: 'Unknown report' }, { status: 404 });
  }
  const url = new URL(req.url);
  const format = url.searchParams.get('format') === 'csv' ? 'CSV' : 'XLSX';
  const raw: Record<string, string[]> = {};
  for (const [k, v] of url.searchParams) (raw[k] ??= []).push(v);
  const selection = parseSelection(raw);
  const today = kampalaToday();

  const table = await buildReport(db, report as ReportKey, selection, today);
  const { grid, boldRows, moneyColumns } = reportToGrid(table);
  const bytes =
    format === 'CSV'
      ? toCsv(grid, { guardFormulas: true })
      : await toXlsx(grid, {
          sheetName: table.title,
          timestamp: new Date(`${today}T00:00:00Z`),
          boldRows,
          moneyColumns,
        });

  await db.$transaction((tx) =>
    withAudit(tx, {
      actorId: user.id,
      action: 'REPORT_DOWNLOADED',
      entity: 'Report',
      entityId: report,
      after: { format, selection, rows: table.rows.length, runs: table.runCount },
      ip: ipFromHeaders(req.headers),
    }),
  );

  const draft = table.draftRunCount > 0 ? '_DRAFT' : '';
  const fileName = safeFileName(`${table.title}_${today}${draft}.${format === 'CSV' ? 'csv' : 'xlsx'}`);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': CONTENT_TYPES[format],
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
