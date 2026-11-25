'use client';

import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { generatePeriodsAction, type ActionState } from '../actions';

export function GeneratePeriodsForm({
  payGroupId,
  frequency,
}: {
  payGroupId: string;
  frequency: 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY';
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(generatePeriodsAction, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="payGroupId" value={payGroupId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="from">From month</Label>
          <Input id="from" name="from" type="month" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="to">To month</Label>
          <Input id="to" name="to" type="month" required />
        </div>
        {frequency === 'FORTNIGHTLY' ? (
          <div className="space-y-2">
            <Label htmlFor="anchor">Anchor (start of any fortnight)</Label>
            <Input id="anchor" name="anchor" type="date" />
          </div>
        ) : null}
      </div>
      <FormMessage message={state.error} />
      <FormMessage message={state.message} tone="success" />
      <Button type="submit" disabled={pending}>
        {pending ? 'Generating…' : 'Generate periods'}
      </Button>
    </form>
  );
}
