'use client';

import type { EmployeeStatus } from '@prisma/client';
import { useActionState, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type ActionState, changeStatusAction } from '../actions';

export function StatusControls({
  employeeId,
  status,
  today,
}: {
  employeeId: string;
  status: EmployeeStatus;
  today: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(changeStatusAction, {});
  const [exiting, setExiting] = useState(false);

  return (
    <div className="space-y-2">
      <form action={action} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="employeeId" value={employeeId} />
        {status === 'ACTIVE' ? (
          <Button
            type="submit"
            name="intent"
            value="suspend"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={(e) => {
              if (!window.confirm('Suspend this employee? They will be left out of payroll runs.'))
                e.preventDefault();
            }}
          >
            Suspend
          </Button>
        ) : (
          <Button
            type="submit"
            name="intent"
            value="reactivate"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={(e) => {
              if (
                status === 'EXITED' &&
                !window.confirm('Reinstate this employee? Their exit date will be cleared.')
              )
                e.preventDefault();
            }}
          >
            {status === 'EXITED' ? 'Reinstate' : 'Reactivate'}
          </Button>
        )}
        {status !== 'EXITED' && !exiting ? (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => setExiting(true)}
            disabled={pending}
          >
            Exit employee
          </Button>
        ) : null}
      </form>

      {exiting && status !== 'EXITED' ? (
        <form
          action={action}
          className="flex flex-wrap items-end gap-2 rounded-md border p-3"
          onSubmit={() => setExiting(false)}
        >
          <input type="hidden" name="employeeId" value={employeeId} />
          <div className="space-y-1">
            <Label htmlFor="exitDate">Last working day</Label>
            <Input id="exitDate" name="exitDate" type="date" required defaultValue={today} />
          </div>
          <Button type="submit" name="intent" value="exit" variant="destructive" size="sm">
            Confirm exit
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setExiting(false)}>
            Cancel
          </Button>
          <p className="basis-full text-xs text-muted-foreground">
            Pay is prorated up to and including this date.
          </p>
        </form>
      ) : null}
      <FormMessage message={state.error} />
      <FormMessage message={state.message} tone="success" />
    </div>
  );
}
