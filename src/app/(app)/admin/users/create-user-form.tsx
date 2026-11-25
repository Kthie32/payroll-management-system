'use client';

import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ROLE_CODES, ROLE_LABELS } from '@/lib/rbac/permissions';
import { createUserAction, type CreateUserState } from './actions';

export function CreateUserForm() {
  const [state, action, pending] = useActionState<CreateUserState, FormData>(createUserAction, {});
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">Full name</Label>
          <Input id="name" name="name" required maxLength={120} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required />
        </div>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Roles</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {ROLE_CODES.map((code) => (
            <label key={code} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="roles" value={code} className="size-4 accent-primary" />
              {ROLE_LABELS[code]}
            </label>
          ))}
        </div>
      </fieldset>
      <FormMessage message={state.error} />
      {state.created ? (
        <div
          role="status"
          className="space-y-1 rounded-md border border-success/40 bg-success/10 p-3 text-sm"
        >
          <p>
            Created <strong>{state.created.email}</strong>. Give them this temporary password — it
            will not be shown again:
          </p>
          <code data-testid="temp-password" className="block rounded bg-card px-2 py-1 font-mono">
            {state.created.tempPassword}
          </code>
        </div>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? 'Creating…' : 'Create user'}
      </Button>
    </form>
  );
}
