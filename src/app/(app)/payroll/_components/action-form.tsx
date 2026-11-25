'use client';

import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { Button, type ButtonProps } from '@/components/ui/button';
import type { ActionState } from '../actions';

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/** A single-button form bound to a server action, with inline result messages. */
export function ActionForm({
  action,
  fields,
  label,
  pendingLabel,
  variant,
  confirm,
  children,
  className,
}: {
  action: Action;
  fields: Record<string, string>;
  label: string;
  pendingLabel?: string;
  variant?: ButtonProps['variant'];
  confirm?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  return (
    <form
      action={formAction}
      className={className ?? 'space-y-2'}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {children}
      <Button type="submit" variant={variant} disabled={pending}>
        {pending ? (pendingLabel ?? 'Working…') : label}
      </Button>
      <FormMessage message={state.error} />
      <FormMessage message={state.message} tone="success" />
    </form>
  );
}
