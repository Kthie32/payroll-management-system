'use client';

import { useActionState, useMemo, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatUgx } from '@/lib/money';
import { LOAN_TYPE_LABELS, LOAN_TYPES, periodsRemaining } from '@/lib/loans/logic';
import { parseUgxInput } from '@/lib/settings/input';
import { createLoanAction, type LoanFormState } from './actions';

export interface EmployeeOption {
  id: string;
  label: string;
  payGroupId: string;
}
export interface PeriodOption {
  id: string;
  label: string;
  payGroupId: string;
}

export function LoanForm({
  employees,
  periods,
  defaultEmployeeId,
}: {
  employees: EmployeeOption[];
  periods: PeriodOption[];
  defaultEmployeeId?: string;
}) {
  const [state, action, pending] = useActionState<LoanFormState, FormData>(createLoanAction, {});
  const [employeeId, setEmployeeId] = useState(defaultEmployeeId ?? '');
  const [principal, setPrincipal] = useState('');
  const [installment, setInstallment] = useState('');
  const payGroupId = employees.find((e) => e.id === employeeId)?.payGroupId;
  const groupPeriods = useMemo(
    () => periods.filter((p) => p.payGroupId === payGroupId),
    [periods, payGroupId],
  );
  const p = parseUgxInput(principal);
  const i = parseUgxInput(installment);
  const schedule =
    p && i && i <= p ? `${periodsRemaining(p, i)} deductions of up to ${formatUgx(i)}` : null;

  return (
    <form action={action} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="employeeId">Employee</Label>
          <NativeSelect
            id="employeeId"
            name="employeeId"
            required
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          >
            <option value="">Choose…</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </NativeSelect>
          {employees.length === 0 ? (
            <p className="text-xs text-muted-foreground">No active employees yet.</p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="type">Type</Label>
          <NativeSelect id="type" name="type" defaultValue="LOAN">
            {LOAN_TYPES.map((t) => (
              <option key={t} value={t}>
                {LOAN_TYPE_LABELS[t]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="startPeriodId">First deduction period</Label>
          <NativeSelect id="startPeriodId" name="startPeriodId" defaultValue="" disabled={!payGroupId}>
            <option value="">Next payroll run</option>
            {groupPeriods.map((pp) => (
              <option key={pp.id} value={pp.id}>
                {pp.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="principal">Amount lent (UGX)</Label>
          <Input
            id="principal"
            name="principal"
            inputMode="numeric"
            required
            value={principal}
            onChange={(e) => setPrincipal(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="installment">Deduction per period (UGX)</Label>
          <Input
            id="installment"
            name="installment"
            inputMode="numeric"
            required
            value={installment}
            onChange={(e) => setInstallment(e.target.value)}
            aria-describedby="schedule"
          />
          <p id="schedule" className="text-xs text-muted-foreground">
            {schedule ?? 'The last deduction is reduced to whatever balance is left.'}
          </p>
        </div>
      </div>
      <FormMessage message={state.error} />
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Create loan'}
      </Button>
    </form>
  );
}
