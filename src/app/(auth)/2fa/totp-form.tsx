'use client';

import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { enrolTotpAction, verifyTotpAction, type TotpState } from './actions';

export function TotpForm({ mode, pending }: { mode: 'enrol' | 'verify'; pending?: string }) {
  const [state, action, busy] = useActionState<TotpState, FormData>(
    mode === 'enrol' ? enrolTotpAction : verifyTotpAction,
    {},
  );
  return (
    <form action={action} className="space-y-4">
      {pending ? <input type="hidden" name="pending" value={pending} /> : null}
      <div className="space-y-2">
        <Label htmlFor="code">6-digit code</Label>
        <Input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          autoFocus
          className="text-center text-lg tracking-[0.4em]"
        />
      </div>
      <FormMessage message={state.error} />
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? 'Checking…' : mode === 'enrol' ? 'Turn on two-factor' : 'Verify'}
      </Button>
    </form>
  );
}
