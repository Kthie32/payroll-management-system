'use client';

import type { RoleCode } from '@prisma/client';
import { X } from 'lucide-react';
import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { ROLE_CODES, ROLE_LABELS } from '@/lib/rbac/permissions';
import { manageUserAction, type ManageUserState } from './actions';

export function ManageUser({
  userId,
  roles,
  isActive,
  totpEnrolled,
  isSelf,
}: {
  userId: string;
  roles: RoleCode[];
  isActive: boolean;
  totpEnrolled: boolean;
  isSelf: boolean;
}) {
  const [state, action, pending] = useActionState<ManageUserState, FormData>(manageUserAction, {});
  const unassigned = ROLE_CODES.filter((r) => !roles.includes(r));

  const IntentButton = ({
    intent,
    children,
    variant = 'outline',
    confirm,
  }: {
    intent: string;
    children: React.ReactNode;
    variant?: 'outline' | 'destructive';
    confirm?: string;
  }) => (
    <Button
      type="submit"
      name="intent"
      value={intent}
      size="sm"
      variant={variant}
      disabled={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
    </Button>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {roles.map((r) => (
          <form key={r} action={action}>
            <input type="hidden" name="userId" value={userId} />
            <input type="hidden" name="role" value={r} />
            <Badge variant="secondary" className="gap-1 pr-1">
              {ROLE_LABELS[r]}
              <button
                type="submit"
                name="intent"
                value="removeRole"
                disabled={pending}
                aria-label={`Remove ${ROLE_LABELS[r]}`}
                className="rounded hover:bg-muted"
              >
                <X className="size-3" />
              </button>
            </Badge>
          </form>
        ))}
      </div>

      {unassigned.length > 0 ? (
        <form action={action} className="flex gap-2">
          <input type="hidden" name="userId" value={userId} />
          <NativeSelect name="role" aria-label="Role to add" className="h-8 w-auto text-xs">
            {unassigned.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </NativeSelect>
          <IntentButton intent="addRole">Add role</IntentButton>
        </form>
      ) : null}

      <form action={action} className="flex flex-wrap gap-2">
        <input type="hidden" name="userId" value={userId} />
        <IntentButton intent="resetPassword" confirm="Reset this user's password?">
          Reset password
        </IntentButton>
        {totpEnrolled ? (
          <IntentButton intent="reset2fa" confirm="Reset two-factor for this user?">
            Reset 2FA
          </IntentButton>
        ) : null}
        {isActive ? (
          !isSelf && (
            <IntentButton intent="deactivate" variant="destructive" confirm="Deactivate this user?">
              Deactivate
            </IntentButton>
          )
        ) : (
          <IntentButton intent="reactivate">Reactivate</IntentButton>
        )}
      </form>

      <FormMessage message={state.error} />
      <FormMessage message={state.message} tone="success" />
      {state.tempPassword ? (
        <p className="text-sm">
          New temporary password (shown once):{' '}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{state.tempPassword}</code>
        </p>
      ) : null}
    </div>
  );
}
