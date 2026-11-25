'use client';

import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { Button, type ButtonProps } from '@/components/ui/button';
import type { ActionState } from './actions';

/** A one-button form bound to a server action, with pending state, confirm and result message. */
export function ActionButton({
  action,
  label,
  pendingLabel,
  confirm,
  variant,
  size,
  disabled,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  label: string;
  pendingLabel?: string;
  confirm?: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className="space-y-2"
    >
      <Button type="submit" variant={variant} size={size} disabled={disabled || pending}>
        {pending ? (pendingLabel ?? 'Working…') : label}
      </Button>
      <FormMessage message={state.error} />
      <FormMessage message={state.ok} tone="success" />
    </form>
  );
}
