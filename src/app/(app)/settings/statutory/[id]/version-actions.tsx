'use client';

import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { Button } from '@/components/ui/button';
import {
  approveRuleVersionAction,
  discardRuleVersionAction,
  type RuleActionState,
} from '../actions';

export function ApproveVersion({ id, blockedReason }: { id: string; blockedReason: string | null }) {
  const [state, action, pending] = useActionState<RuleActionState, FormData>(
    approveRuleVersionAction,
    {},
  );
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      {blockedReason ? <p className="text-sm text-muted-foreground">{blockedReason}</p> : null}
      <FormMessage message={state.error} />
      <FormMessage message={state.message} tone="success" />
      <Button
        type="submit"
        disabled={pending || Boolean(blockedReason)}
        onClick={(e) => {
          if (!confirm('Approve this version? Payroll will use it from its effective date.')) {
            e.preventDefault();
          }
        }}
      >
        {pending ? 'Approving…' : 'Approve version'}
      </Button>
    </form>
  );
}

export function DiscardVersion({ id }: { id: string }) {
  const [state, action, pending] = useActionState<RuleActionState, FormData>(
    discardRuleVersionAction,
    {},
  );
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <FormMessage message={state.error} />
      <Button
        type="submit"
        variant="outline"
        disabled={pending}
        onClick={(e) => {
          if (!confirm('Discard this draft?')) e.preventDefault();
        }}
      >
        Discard draft
      </Button>
    </form>
  );
}
