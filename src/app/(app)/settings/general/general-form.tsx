'use client';

import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { saveGeneralSettingsAction, type GeneralSettingsState } from './actions';

export interface GeneralValues {
  minNetPay: string;
  prorationBasis: string;
  companyName: string;
  companyTin: string;
  companyNssfEmployerNo: string;
  companyAddress: string;
  payslipFooter: string;
}

const textarea =
  'flex min-h-20 w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

export function GeneralSettingsForm({ initial, canEdit }: { initial: GeneralValues; canEdit: boolean }) {
  const [state, action, pending] = useActionState<GeneralSettingsState, FormData>(
    saveGeneralSettingsAction,
    {},
  );
  return (
    <form action={action} className="space-y-8">
      <fieldset disabled={!canEdit || pending} className="space-y-8">
        <section className="space-y-4">
          <h2 className="font-medium">Company</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="companyName">Registered name</Label>
              <Input id="companyName" name="companyName" defaultValue={initial.companyName} maxLength={160} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="companyTin">TIN</Label>
              <Input id="companyTin" name="companyTin" inputMode="numeric" defaultValue={initial.companyTin} maxLength={10} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="companyNssfEmployerNo">NSSF employer number</Label>
              <Input id="companyNssfEmployerNo" name="companyNssfEmployerNo" defaultValue={initial.companyNssfEmployerNo} maxLength={30} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="companyAddress">Address</Label>
              <textarea id="companyAddress" name="companyAddress" defaultValue={initial.companyAddress} maxLength={500} className={textarea} />
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="font-medium">Payroll</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="minNetPay">Minimum net pay (% of gross)</Label>
              <Input id="minNetPay" name="minNetPay" inputMode="decimal" defaultValue={initial.minNetPay} required aria-describedby="minNetPay-help" />
              <p id="minNetPay-help" className="text-xs text-muted-foreground">
                Loans and other deductions stop at this floor; the rest carries forward. PAYE, NSSF
                and LST are always deducted. 0 means no floor.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="prorationBasis">Proration basis</Label>
              <NativeSelect id="prorationBasis" name="prorationBasis" defaultValue={initial.prorationBasis} aria-describedby="proration-help">
                <option value="CALENDAR_DAYS">Calendar days</option>
                <option value="WORKING_DAYS" disabled>
                  Working days (not yet available)
                </option>
                <option value="FIXED_30" disabled>
                  Fixed 30-day month (not yet available)
                </option>
              </NativeSelect>
              <p id="proration-help" className="text-xs text-muted-foreground">
                How pay is split for employees who join or leave mid-period.
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-2">
          <Label htmlFor="payslipFooter">Payslip footer</Label>
          <textarea id="payslipFooter" name="payslipFooter" defaultValue={initial.payslipFooter} maxLength={500} className={textarea} placeholder="e.g. Queries to hr@company.co.ug" />
        </section>
      </fieldset>

      <FormMessage message={state.error} />
      <FormMessage message={state.message} tone="success" />
      {canEdit ? (
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save settings'}
        </Button>
      ) : null}
    </form>
  );
}
