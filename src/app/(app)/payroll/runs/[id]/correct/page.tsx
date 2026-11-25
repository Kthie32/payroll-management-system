import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/lib/db';
import { nextOpenPeriodFor } from '@/lib/payroll/server/periods-inputs';
import { isPosted, type RunStatus } from '@/lib/payroll/status';
import { requirePermission } from '@/lib/rbac';

export const metadata = { title: 'Correct in next run · Payroll' };
export const dynamic = 'force-dynamic';

/**
 * "Correct in next run": approved runs are never edited, so a correction is entered as an
 * adjustment in the next open period. Redirects there with the employee and run preselected.
 */
export default async function CorrectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ employee?: string }>;
}) {
  await requirePermission('payroll.inputs');
  const { id } = await params;
  const { employee } = await searchParams;
  const run = await db.payrollRun.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!run || !employee) notFound();
  if (!isPosted(run.status as RunStatus)) redirect(`/payroll/runs/${run.id}`);

  const next = await nextOpenPeriodFor(run.id, employee);
  if (next) {
    redirect(
      `/payroll/periods/${next.id}/inputs?adjust=${encodeURIComponent(employee)}&run=${encodeURIComponent(run.id)}#adjustments`,
    );
  }
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>No open period to correct in</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          Corrections are made in a later pay period, but every later period for this
          employee&apos;s pay group is already approved or has not been created yet.
        </p>
        <p>
          <Link className="text-primary hover:underline" href="/payroll/periods">
            Generate the next pay period
          </Link>
          , then use &ldquo;Correct in next run&rdquo; again.
        </p>
      </CardContent>
    </Card>
  );
}
