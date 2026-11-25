'use client';

import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { adjustLoanAction, type LoanFormState } from '../actions';

function useAdjust() {
  return useActionState<LoanFormState, FormData>(adjustLoanAction, {});
}

export function RepayForm({ loanId }: { loanId: string }) {
  const [state, action, pending] = useAdjust();
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="intent" value="repay" />
      <input type="hidden" name="loanId" value={loanId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="repay-amount">Amount (UGX)</Label>
          <Input id="repay-amount" name="amount" inputMode="numeric" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="repay-note">Reason</Label>
          <Input id="repay-note" name="note" required maxLength={200} placeholder="e.g. Cash repayment, receipt 1234" />
        </div>
      </div>
      <FormMessage message={state.error} />
      <FormMessage message={state.message} tone="success" />
      <Button type="submit" size="sm" disabled={pending}>
        Record repayment
      </Button>
    </form>
  );
}

export function InstallmentForm({ loanId, current }: { loanId: string; current: number }) {
  const [state, action, pending] = useAdjust();
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="intent" value="installment" />
      <input type="hidden" name="loanId" value={loanId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="inst-amount">New deduction per period (UGX)</Label>
          <Input id="inst-amount" name="amount" inputMode="numeric" required defaultValue={String(current)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="inst-note">Reason (optional)</Label>
          <Input id="inst-note" name="note" maxLength={200} />
        </div>
      </div>
      <FormMessage message={state.error} />
      <FormMessage message={state.message} tone="success" />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        Change instalment
      </Button>
    </form>
  );
}

export function WriteOffForm({ loanId }: { loanId: string }) {
  const [state, action, pending] = useAdjust();
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="intent" value="writeOff" />
      <input type="hidden" name="loanId" value={loanId} />
      <div className="space-y-2">
        <Label htmlFor="wo-note">Reason for write-off</Label>
        <Input id="wo-note" name="note" required maxLength={200} />
      </div>
      <FormMessage message={state.error} />
      <FormMessage message={state.message} tone="success" />
      <Button
        type="submit"
        size="sm"
        variant="destructive"
        disabled={pending}
        onClick={(e) => {
          if (!confirm('Write off the remaining balance? This stops all further deductions.')) {
            e.preventDefault();
          }
        }}
      >
        Write off balance
      </Button>
    </form>
  );
}
