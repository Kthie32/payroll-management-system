'use client';

import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { verifyPayslipLinkAction, type VerifyState } from './actions';

export function VerifyForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<VerifyState, FormData>(
    verifyPayslipLinkAction,
    {},
  );
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <div className="space-y-1">
        <Label htmlFor="answer">Last 4 digits of your phone number, or your staff number</Label>
        <Input id="answer" name="answer" autoComplete="off" required maxLength={40} autoFocus />
      </div>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Checking…' : 'View my payslip'}
      </Button>
      <FormMessage message={state.error} />
    </form>
  );
}
