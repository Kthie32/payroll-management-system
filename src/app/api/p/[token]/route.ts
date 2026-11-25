import { renderToBuffer } from '@react-pdf/renderer';
import { cookies } from 'next/headers';
import { createElement } from 'react';
import { PayslipDocument } from '@/lib/payroll/payslip-pdf';
import { accessCookieName, verifyAccessCookie } from '@/lib/payroll/payslip-links';
import { findDeliveryByToken } from '@/lib/payroll/server/delivery';
import { loadPayslips } from '@/lib/payroll/server/payslips';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Public PDF download for a verified payslip link (see /p/[token]). */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const delivery = await findDeliveryByToken(token);
  if (!delivery) return new Response('Link invalid or expired', { status: 404 });
  const secret = process.env.AUTH_SECRET ?? '';
  const cookie = (await cookies()).get(accessCookieName(delivery.id))?.value;
  if (!secret || !verifyAccessCookie(secret, delivery.id, cookie, Date.now())) {
    return new Response('Confirm your details on the payslip page first', { status: 403 });
  }
  const payslips = await loadPayslips(delivery.runEmployee.runId, delivery.runEmployee.employeeId);
  const first = payslips[0];
  if (!first) return new Response('Not found', { status: 404 });
  const buffer = await renderToBuffer(createElement(PayslipDocument, { payslips }) as never);
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="payslip-${first.employee.staffNo}-${first.period.payDate}.pdf"`,
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
