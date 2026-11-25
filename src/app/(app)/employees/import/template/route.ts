import { importTemplateCsv } from '@/lib/employees/import';
import { requirePermission } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

/** Downloadable CSV template for the employee import. */
export async function GET() {
  await requirePermission('employees.edit');
  return new Response(`﻿${importTemplateCsv()}\r\n`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="employee-import-template.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
