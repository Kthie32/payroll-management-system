import type { LoanStatus } from '@prisma/client';

export const LOAN_STATUS_BADGE: Record<
  LoanStatus,
  { label: string; variant: 'success' | 'secondary' | 'destructive' }
> = {
  ACTIVE: { label: 'Active', variant: 'success' },
  SETTLED: { label: 'Settled', variant: 'secondary' },
  WRITTEN_OFF: { label: 'Written off', variant: 'destructive' },
};
