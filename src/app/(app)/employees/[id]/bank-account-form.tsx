'use client';

import { useActionState, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { type ActionState, addBankAccountAction } from '../actions';
import { Field, pick } from '../field';

export interface PaymentInstitutionOption {
  id: string;
  name: string;
  code: string;
  kind: 'BANK' | 'MOBILE_MONEY';
}

/**
 * Adds a payment destination: a bank account, or a mobile money wallet (MTN MoMo, Airtel Money).
 * For mobile money the "account number" is the wallet phone number and there is no branch.
 * The server validates and normalises the number for the chosen institution.
 */
export function BankAccountForm({
  employeeId,
  banks,
  defaultAccountName,
  defaultWallet,
  today,
  hasActive,
}: {
  employeeId: string;
  banks: PaymentInstitutionOption[];
  defaultAccountName: string;
  /** The employee's phone number, offered as the wallet number. */
  defaultWallet: string;
  today: string;
  hasActive: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addBankAccountAction, {});
  const fe = state.fieldErrors ?? {};
  const v = (name: string, fallback: string) => pick(state.values, name, fallback);
  const [bankId, setBankId] = useState(v('bankId', ''));
  const selected = banks.find((b) => b.id === bankId);
  const isWallet = selected?.kind === 'MOBILE_MONEY';
  const bankList = banks.filter((b) => b.kind === 'BANK');
  const walletList = banks.filter((b) => b.kind === 'MOBILE_MONEY');

  if (banks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No banks or mobile money providers are set up yet. The System Admin adds them under Admin →
        Banks and mobile money.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="employeeId" value={employeeId} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field name="bankId" label="Paid through" error={fe.bankId}>
          <NativeSelect
            id="bankId"
            name="bankId"
            required
            value={bankId}
            onChange={(e) => setBankId(e.target.value)}
          >
            <option value="">Choose…</option>
            {bankList.length ? (
              <optgroup label="Banks">
                {bankList.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.code})
                  </option>
                ))}
              </optgroup>
            ) : null}
            {walletList.length ? (
              <optgroup label="Mobile money">
                {walletList.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </NativeSelect>
        </Field>
        {isWallet ? null : (
          <Field name="branchCode" label="Branch code" error={fe.branchCode}>
            <Input
              id="branchCode"
              name="branchCode"
              maxLength={20}
              defaultValue={v('branchCode', '')}
            />
          </Field>
        )}
        <Field
          name="accountNo"
          label={isWallet ? 'Wallet phone number' : 'Account number'}
          error={fe.accountNo}
          hint={
            isWallet
              ? 'e.g. 0772 123456. Saved as 2567… and stored encrypted.'
              : 'Stored encrypted.'
          }
        >
          <Input
            key={isWallet ? 'wallet' : 'bank'}
            id="accountNo"
            name="accountNo"
            required
            inputMode={isWallet ? 'tel' : 'numeric'}
            autoComplete="off"
            maxLength={30}
            defaultValue={isWallet ? defaultWallet : ''}
          />
        </Field>
        <Field
          name="accountName"
          label={isWallet ? 'Registered wallet name' : 'Account name'}
          error={fe.accountName}
        >
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
            !window.confirm('The current payment details will be deactivated. Continue?')
          )
            e.preventDefault();
        }}
      >
        {pending ? 'Saving…' : isWallet ? 'Add wallet' : 'Add account'}
      </Button>
    </form>
  );
}
