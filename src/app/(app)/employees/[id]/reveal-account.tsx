'use client';

import { Eye } from 'lucide-react';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { revealAccountAction, type RevealState } from '../actions';

/** Shows "••••1234", with a Reveal button for editors. Each reveal is written to the audit log. */
export function RevealAccount({
  accountId,
  masked,
  canReveal,
}: {
  accountId: string;
  masked: string;
  canReveal: boolean;
}) {
  const [state, action, pending] = useActionState<RevealState, FormData>(revealAccountAction, {});
  if (state.accountNo) {
    return <span className="font-mono text-sm">{state.accountNo}</span>;
  }
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono text-sm">{masked}</span>
      {canReveal ? (
        <form action={action}>
          <input type="hidden" name="accountId" value={accountId} />
          <Button
            type="submit"
            size="sm"
            variant="ghost"
            disabled={pending}
            title="Reveal the full number (recorded in the audit log)"
          >
            <Eye aria-hidden /> Reveal
          </Button>
        </form>
      ) : null}
      {state.error ? <span className="text-xs text-destructive">{state.error}</span> : null}
    </span>
  );
}
