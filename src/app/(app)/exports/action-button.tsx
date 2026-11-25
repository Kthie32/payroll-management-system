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
  children,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  label: string;
  pendingLabel?: string;
  confirm?: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  disabled?: boolean;
  /** Extra form fields shown above the button (e.g. a confirmation input). */
  children?: React.ReactNode;
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
      {children}
      <Button type="submit" variant={variant} size={size} disabled={disabled || pending}>
        {pending ? (pendingLabel ?? 'Working…') : label}
      </Button>
      <FormMessage message={state.error} />
      <FormMessage message={state.ok} tone="success" />
    </form>
  );
}
