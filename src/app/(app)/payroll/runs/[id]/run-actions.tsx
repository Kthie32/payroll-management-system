'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import type { RunStatus } from '@/lib/payroll/status';
import { ActionForm } from '../../_components/action-form';
import {
  approveRunAction,
  computeRunAction,
  deleteRunAction,
  rejectRunAction,
  submitRunAction,
} from '../../actions';

function Blocked({ reason }: { reason: string }) {
  return <p className="text-xs text-muted-foreground">{reason}</p>;
}

export function RunActions({
  runId,
  status,
  canPrepare,
  canApprove,
  isEditable,
  submitBlocked,
  approveBlocked,
  rejectBlocked,
  periodId,
}: {
  runId: string;
  status: RunStatus;
  canPrepare: boolean;
  canApprove: boolean;
  isEditable: boolean;
  submitBlocked: string | null;
  approveBlocked: string | null;
  rejectBlocked: string | null;
  periodId: string;
}) {
  const fields = { runId };
  const showPrepare = canPrepare && (isEditable || status === 'COMPUTED');
  const showApprove = canApprove && status === 'SUBMITTED';
  if (!showPrepare && !showApprove) return null;

  return (
    <Card>
      <CardContent className="flex flex-col gap-6 pt-6 lg:flex-row lg:flex-wrap lg:items-start">
        {showPrepare ? (
          <>
            <div className="space-y-2">
              <ActionForm
                action={computeRunAction}
                fields={fields}
                label={status === 'DRAFT' ? 'Compute payroll' : 'Recompute'}
                pendingLabel="Computing…"
              />
              <Button asChild variant="link" className="h-auto p-0 text-xs">
                <Link href={`/payroll/periods/${periodId}/inputs`}>Edit period inputs</Link>
              </Button>
            </div>
            {status === 'COMPUTED' ? (
              <div className="space-y-1">
                {submitBlocked ? (
                  <>
                    <Button disabled>Submit for approval</Button>
                    <Blocked reason={submitBlocked} />
                  </>
                ) : (
                  <ActionForm
                    action={submitRunAction}
                    fields={fields}
                    label="Submit for approval"
                    pendingLabel="Submitting…"
                    confirm="Submit this run for approval? It cannot be changed while it is being reviewed."
                  />
                )}
              </div>
            ) : null}
            <ActionForm
              action={deleteRunAction}
              fields={fields}
              label="Delete run"
              variant="outline"
              pendingLabel="Deleting…"
              confirm="Delete this run and all its calculations?"
            />
          </>
        ) : null}

        {showApprove ? (
          <>
            <div className="space-y-1">
              {approveBlocked ? (
                <>
                  <Button disabled>Approve</Button>
                  <Blocked reason={approveBlocked} />
                </>
              ) : (
                <ActionForm
                  action={approveRunAction}
                  fields={fields}
                  label="Approve run"
                  pendingLabel="Approving…"
                  confirm="Approve this run? Approved payroll cannot be changed, loan balances are updated and unpaid deductions are carried forward."
                />
              )}
            </div>
            <div className="w-full max-w-md space-y-1">
              {rejectBlocked ? (
                <>
                  <Button variant="destructive" disabled>
                    Reject
                  </Button>
                  <Blocked reason={rejectBlocked} />
                </>
              ) : (
                <ActionForm action={rejectRunAction} fields={fields} label="Reject" variant="destructive" pendingLabel="Rejecting…">
                  <Label htmlFor="comment">Reason for rejecting</Label>
                  <textarea
                    id="comment"
                    name="comment"
                    required
                    minLength={5}
                    maxLength={2000}
                    rows={3}
                    className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </ActionForm>
              )}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
