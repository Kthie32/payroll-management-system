import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { loadPayslips } from '@/lib/payroll/server/payslips';
import { PayslipCard } from '../../../../_components/payslip-card';
import { requirePermission } from '@/lib/rbac';

export const metadata = { title: 'Payslip · Payroll' };
export const dynamic = 'force-dynamic';

export default async function PayslipPage({
  params,
}: {
  params: Promise<{ id: string; employeeId: string }>;
}) {
  await requirePermission('payslips.view');
  const { id, employeeId } = await params;
  const [p] = await loadPayslips(id, employeeId);
  if (!p) notFound();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={`/payroll/runs/${p.runId}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          Back to run
        </Link>
        <Button asChild>
          <a href={`/api/payslips/${p.runId}?employeeId=${p.employeeId}`}>Download PDF</a>
        </Button>
      </div>

      <PayslipCard p={p} />
    </div>
  );
}
