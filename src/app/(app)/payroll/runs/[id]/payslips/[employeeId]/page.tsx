import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatUgx } from '@/lib/money';
import { formatIsoDate } from '@/lib/payroll/dates';
import { loadPayslips, type PayslipLine } from '@/lib/payroll/server/payslips';
import { requirePermission } from '@/lib/rbac';

export const metadata = { title: 'Payslip · Payroll' };
export const dynamic = 'force-dynamic';

function Section({
  title,
  lines,
  totalLabel,
  total,
}: {
  title: string;
  lines: PayslipLine[];
  totalLabel?: string;
  total?: number;
}) {
  if (lines.length === 0 && total === undefined) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      <table className="w-full text-sm">
        <tbody>
          {lines.map((l, i) => (
            <tr key={`${l.code}-${i}`} className="border-b align-top">
              <td className="py-1.5 pr-3">
                {l.label}
                {l.note ? (
                  <span className="block text-xs text-muted-foreground">{l.note}</span>
                ) : null}
              </td>
              <td className="whitespace-nowrap py-1.5 text-right tabular-nums">
                {formatUgx(l.amount)}
              </td>
            </tr>
          ))}
          {total !== undefined ? (
            <tr className="font-semibold">
              <td className="py-1.5">{totalLabel}</td>
              <td className="py-1.5 text-right tabular-nums">{formatUgx(total)}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  );
}

export default async function PayslipPage({
  params,
}: {
  params: Promise<{ id: string; employeeId: string }>;
}) {
  await requirePermission('payslips.view');
  const { id, employeeId } = await params;
  const [p] = await loadPayslips(id, employeeId);
  if (!p) notFound();
  const e = p.employee;

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

      <Card className="relative mx-auto max-w-3xl overflow-hidden">
        {p.isDraft ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-center text-7xl font-bold text-destructive/10 -rotate-[30deg] select-none"
          >
            DRAFT
          </div>
        ) : null}
        <CardContent className="space-y-6 pt-6">
          <header className="flex flex-col justify-between gap-3 sm:flex-row">
            <div>
              <p className="text-lg font-semibold">{p.company.name || 'Company name not set'}</p>
              {p.company.address ? (
                <p className="text-sm text-muted-foreground">{p.company.address}</p>
              ) : null}
              {p.company.tin ? (
                <p className="text-sm text-muted-foreground">TIN {p.company.tin}</p>
              ) : null}
            </div>
            <div className="sm:text-right">
              <p className="font-semibold">
                Payslip {p.isDraft ? <Badge variant="destructive">Draft</Badge> : null}
              </p>
              <p className="text-sm text-muted-foreground">
                {formatIsoDate(p.period.start)} – {formatIsoDate(p.period.end)}
              </p>
              <p className="text-sm text-muted-foreground">
                Pay date {formatIsoDate(p.period.payDate)}
              </p>
            </div>
          </header>

          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 rounded-md border p-3 text-sm sm:grid-cols-2">
            {[
              ['Name', e.name],
              ['Staff no.', e.staffNo],
              ['Job title', e.jobTitle ?? '—'],
              ['Department', e.department ?? '—'],
              ['TIN', e.tin ?? '—'],
              ['NSSF no.', e.nssfNo ?? '—'],
              ['Pay group', p.payGroup],
              ['Bank', e.bank ? `${e.bank.bankName} ••••${e.bank.last4}` : 'No active account'],
            ].map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <dt className="text-muted-foreground">{k}:</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>

          <Section title="Earnings" lines={p.earnings} totalLabel="Gross pay" total={p.gross} />
          <Section title="Statutory deductions" lines={p.statutory} />
          <Section
            title="Other deductions"
            lines={p.deductions}
            totalLabel="Total deductions"
            total={p.totalDeductions}
          />

          <div className="flex items-center justify-between rounded-md bg-muted p-4 text-lg font-semibold">
            <span>Net pay</span>
            <span className="tabular-nums">{formatUgx(p.net)}</span>
          </div>

          <Section title="Employer contributions (not deducted from pay)" lines={p.employer} />

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Year to date (financial year from 1 July)</h2>
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
              {[
                ['Gross', p.ytd.gross],
                ['PAYE', p.ytd.paye],
                ['NSSF (employee)', p.ytd.nssfEmployee],
                ['LST', p.ytd.lst],
                ['Net', p.ytd.net],
              ].map(([k, v]) => (
                <div key={k as string} className="rounded-md border p-2">
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="tabular-nums">{formatUgx(v as number)}</dd>
                </div>
              ))}
            </dl>
          </section>

          <p className="border-t pt-3 text-center text-xs text-muted-foreground">
            {p.footer || 'This payslip is computer generated and does not require a signature.'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
