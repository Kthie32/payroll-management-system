export type RunStatus =
  | 'DRAFT'
  | 'COMPUTED'
  | 'SUBMITTED'
  | 'REJECTED'
  | 'APPROVED'
  | 'EXPORTED'
  | 'PAID'
  | 'LOCKED';

/** Statuses at which a run is final: its rows are immutable (DB triggers enforce this). */
export const POSTED_STATUSES = ['APPROVED', 'EXPORTED', 'PAID', 'LOCKED'] as const satisfies readonly RunStatus[];

/** Statuses from which a run can be (re)computed or deleted. */
export const EDITABLE_STATUSES = ['DRAFT', 'COMPUTED', 'REJECTED'] as const satisfies readonly RunStatus[];

export const STATUS_LABELS: Record<RunStatus, string> = {
  DRAFT: 'Draft',
  COMPUTED: 'Computed',
  SUBMITTED: 'Submitted for approval',
  REJECTED: 'Rejected',
  APPROVED: 'Approved',
  EXPORTED: 'Exported to bank',
  PAID: 'Paid',
  LOCKED: 'Locked',
};

export function isPosted(status: RunStatus): boolean {
  return (POSTED_STATUSES as readonly RunStatus[]).includes(status);
}

export function isEditable(status: RunStatus): boolean {
  return (EDITABLE_STATUSES as readonly RunStatus[]).includes(status);
}

/** Reason a run cannot be submitted, or null. */
export function submitBlockReason(run: {
  status: RunStatus;
  headcount: number;
  errorCount: number;
}): string | null {
  if (run.status !== 'COMPUTED') return 'Only a computed run can be submitted for approval.';
  if (run.headcount === 0) return 'The run has no employees. Check the pay group and period.';
  if (run.errorCount > 0) {
    return `${run.errorCount} employee(s) could not be calculated. Fix the errors and recompute first.`;
  }
  return null;
}

/** Reason the actor cannot approve the run, or null. Enforces separation of duties. */
export function approveBlockReason(run: {
  status: RunStatus;
  computedById: string | null;
  actorId: string;
}): string | null {
  if (run.status !== 'SUBMITTED') return 'Only a submitted run can be approved.';
  if (run.computedById === run.actorId) {
    return 'You computed this run, so you cannot approve it (separation of duties).';
  }
  return null;
}

export function rejectBlockReason(run: {
  status: RunStatus;
  computedById: string | null;
  actorId: string;
}): string | null {
  if (run.status !== 'SUBMITTED') return 'Only a submitted run can be rejected.';
  if (run.computedById === run.actorId) {
    return 'You computed this run, so you cannot review it (separation of duties).';
  }
  return null;
}
