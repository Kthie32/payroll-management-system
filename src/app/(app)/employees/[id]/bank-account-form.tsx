'use client';

import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { type ActionState, addBankAccountAction } from '../actions';
import { Field, pick } from '../field';

export function BankAccountForm({
  employeeId,
  banks,
  defaultAccountName,
  today,
  hasActive,
}: {
  employeeId: string;
  banks: { id: string; name: string; code: string }[];
  defaultAccountName: string;
  today: string;
  hasActive: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addBankAccountAction, {});
  const fe = state.fieldErrors ?? {};
  const v = (name: string, fallback: string) => pick(state.values, name, fallback);

  if (banks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No banks are set up yet. Add banks on the Banks page first.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="employeeId" value={employeeId} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field name="bankId" label="Bank" error={fe.bankId}>
          <NativeSelect id="bankId" name="bankId" required defaultValue={v('bankId', '')}>
            <option value="">Choose…</option>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.code})
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field name="branchCode" label="Branch code" error={fe.branchCode}>
          <Input id="branchCode" name="branchCode" maxLength={20} defaultValue={v('branchCode', '')} />
        </Field>
        <Field name="accountNo" label="Account number" error={fe.accountNo} hint="Stored encrypted.">
          <Input
            id="accountNo"
            name="accountNo"
            required
            inputMode="numeric"
            autoComplete="off"
            maxLength={30}
          />
        </Field>
        <Field name="accountName" label="Account name" error={fe.accountName}>
          <Input
            id="accountName"
            name="accountName"
            required
            maxLength={160}
            defaultValue={v('accountName', defaultAccountName)}
          />
        </Field>
        <Field name="effectiveFrom" label="Effective from" error={fe.effectiveFrom}>
          <Input
            id="effectiveFrom"
            name="effectiveFrom"
            type="date"
            required
            defaultValue={v('effectiveFrom', today)}
          />
        </Field>
      </div>
      <FormMessage message={state.error} />
      <FormMessage message={state.message} tone="success" />
      <Button
        type="submit"
        disabled={pending}
        onClick={(e) => {
          if (
            hasActive &&
            !window.confirm('The current active account will be deactivated. Continue?')
          )
            e.preventDefault();
        }}
      >
        {pending ? 'Saving…' : 'Add account'}
      </Button>
    </form>
  );
}
