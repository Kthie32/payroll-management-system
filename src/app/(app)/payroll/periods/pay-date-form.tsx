'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { updatePayDateAction, type ActionState } from '../actions';

export function PayDateForm({ periodId, payDate }: { periodId: string; payDate: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updatePayDateAction, {});
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="periodId" value={periodId} />
      <div className="flex items-center gap-2">
        <Input
          name="payDate"
          type="date"
          defaultValue={payDate}
          aria-label="Pay date"
          className="h-8 w-40"
          required
        />
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? '…' : 'Save'}
        </Button>
      </div>
      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
      {state.message ? <p className="text-xs text-success">{state.message}</p> : null}
    </form>
  );
}
