import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/lib/db';
import { IMPORT_COLUMNS, MAX_IMPORT_ROWS } from '@/lib/employees/import';
import { requirePermission } from '@/lib/rbac';
import { EmployeesNav } from '../employees-nav';
import { ImportClient } from './import-client';

export const metadata = { title: 'Import employees · Payroll' };
export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  await requirePermission('employees.edit');
  const [payGroups, departments, banks] = await Promise.all([
    db.payGroup.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
    db.department.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
    db.bank.findMany({ select: { code: true, kind: true }, orderBy: { code: 'asc' } }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Import employees</h1>
      <EmployeesNav active="/employees/import" canEdit />

      <Card>
        <CardHeader>
          <CardTitle>1. Prepare your file</CardTitle>
          <CardDescription>
            Use the template. Only staff_no, first_name, last_name, pay_group and hire_date are
            required. Dates are yyyy-mm-dd; yes/no columns default to yes. Up to {MAX_IMPORT_ROWS}{' '}
            rows per file.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <Button asChild variant="outline">
            <a href="/employees/import/template" download>
              <Download aria-hidden /> Download template
            </a>
          </Button>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">pay_group</dt>
              <dd>{payGroups.map((p) => p.name).join(', ') || 'None set up'}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">department</dt>
              <dd>{departments.map((d) => d.name).join(', ') || 'None set up'}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                bank (bank code)
              </dt>
              <dd>
                {banks
                  .filter((b) => b.kind === 'BANK')
                  .map((b) => b.code)
                  .join(', ') || 'None set up'}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                bank (mobile money code)
              </dt>
              <dd>
                {banks
                  .filter((b) => b.kind === 'MOBILE_MONEY')
                  .map((b) => b.code)
                  .join(', ') || 'None set up'}
              </dd>
            </div>
          </dl>
          <details>
            <summary className="cursor-pointer text-muted-foreground">All columns</summary>
            <p className="mt-2 font-mono text-xs">{IMPORT_COLUMNS.join(', ')}</p>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Upload, check and import</CardTitle>
          <CardDescription>
            Nothing is saved until you confirm. A basic_salary value creates a BASIC pay component
            from the hire date. Payment details create the active payment destination: for a bank
            give account_no (and branch_code); for mobile money put the provider code in bank and
            the wallet phone number in wallet_number (e.g. 0772123456). email and phone are used to
            send payslips.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ImportClient />
        </CardContent>
      </Card>
    </div>
  );
}
