import { renderToBuffer } from '@react-pdf/renderer';
import { createElement } from 'react';
import { auth } from '@/auth';
import { requiredOnboardingStep } from '@/auth.config';
import { db } from '@/lib/db';
import { can } from '@/lib/rbac/core';
import { PayslipDocument } from '@/lib/payroll/payslip-pdf';
import { loadPayslips } from '@/lib/payroll/server/payslips';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PDF payslips for a run: `?employeeId=` for one employee, otherwise all employees in one file.
 * Requires payroll.view. Roles are re-read from the database.
 */
export async function GET(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const session = await auth();
  const u = session?.user;
  if (!u?.id || requiredOnboardingStep(u)) return new Response('Unauthorized', { status: 401 });
  const user = await db.user.findUnique({
    where: { id: u.id },
    select: { isActive: true, roles: { select: { role: { select: { code: true } } } } },
  });
  if (!user?.isActive || !can(user.roles.map((r) => r.role.code), 'payslips.view')) {
    return new Response('Forbidden', { status: 403 });
  }

  const { runId } = await params;
  const employeeId = new URL(req.url).searchParams.get('employeeId') ?? undefined;
  const payslips = await loadPayslips(runId, employeeId);
  if (payslips.length === 0) return new Response('Not found', { status: 404 });

  const buffer = await renderToBuffer(createElement(PayslipDocument, { payslips }) as never);
  const first = payslips[0]!;
  const name = employeeId
    ? `payslip-${first.employee.staffNo}-${first.period.payDate}.pdf`
    : `payslips-${first.payGroup.replace(/\W+/g, '-').toLowerCase()}-${first.period.payDate}.pdf`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
