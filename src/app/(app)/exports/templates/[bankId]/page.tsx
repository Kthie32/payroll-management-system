import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/lib/db';
import { buildBankGrid, periodLabel } from '@/lib/exports/build';
import { templateForBank } from '@/lib/exports/service';
import { TOKENS } from '@/lib/exports/template';
import { can, requireUser } from '@/lib/rbac';
import { ActionButton } from '../../action-button';
import { resetTemplateAction, saveTemplateAction } from '../../actions';
import { TemplateEditor } from './template-editor';

export const metadata = { title: 'Edit bank template · Payroll' };
export const dynamic = 'force-dynamic';

const SAMPLE_DATE = '2026-11-28';

export default async function TemplatePage({ params }: { params: Promise<{ bankId: string }> }) {
  const user = await requireUser();
  const canEdit = can(user.roles, 'templates.manage');
  if (!canEdit && !can(user.roles, 'exports.view')) redirect('/dashboard?denied=1');

  const { bankId } = await params;
  const bank = await db.bank.findUnique({ where: { id: bankId } });
  if (!bank) notFound();
  const { spec, isDefault } = await templateForBank(db, bankId);

  const preview = buildBankGrid(
    spec,
    [
      {
        staffNo: 'E001',
        employeeName: 'Jane Nakato',
        accountName: 'Jane Nakato',
        accountNo: '0123456789',
        branchCode: '001',
        amount: 761_750,
      },
      {
        staffNo: 'E002',
        employeeName: 'Peter Okello',
        accountName: 'Peter Okello',
        accountNo: '9876543210',
        branchCode: null,
        amount: 1_250_000,
      },
    ],
    {
      companyName: 'Your Company',
      bankName: bank.name,
      bankCode: bank.code,
      batchRef: `202611-${bank.code}-V1`,
      payDate: SAMPLE_DATE,
      period: periodLabel(SAMPLE_DATE),
    },
  ).grid;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link href="/exports/templates" className="text-sm text-muted-foreground hover:underline">
          ← Bank file templates
        </Link>
        <h1 className="text-2xl font-semibold">{bank.name}</h1>
        <p className="text-sm text-muted-foreground">
          {isDefault ? 'Using the generic default template.' : 'Using a custom template.'} Changes
          apply to bank files generated after saving; earlier files keep their recorded checksum.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Preview (sample data)</CardTitle>
          <CardDescription>How the current saved template lays out a file.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="min-w-full border-collapse font-mono text-xs">
            <tbody>
              {preview.map((row, i) => (
                <tr key={i} className="border-b last:border-0">
                  {row.map((c, j) => (
                    <td key={j} className="whitespace-nowrap px-2 py-1">
                      {c ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {canEdit ? (
        <>
          <TemplateEditor
            action={saveTemplateAction.bind(null, bank.id)}
            initial={spec}
            tokens={[...TOKENS]}
          />
          {!isDefault ? (
            <Card>
              <CardHeader>
                <CardTitle>Reset</CardTitle>
                <CardDescription>
                  Remove the custom template and use the generic default.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ActionButton
                  action={resetTemplateAction.bind(null, bank.id)}
                  label="Reset to default"
                  variant="outline"
                  confirm="Remove this bank's custom template?"
                />
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
