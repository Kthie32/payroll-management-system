import type { EmployeeStatus, Residency, WorkerType } from '@prisma/client';

export const WORKER_TYPE_LABELS: Record<WorkerType, string> = {
  PERMANENT: 'Permanent',
  CONTRACT: 'Contract',
  CASUAL: 'Casual',
};

export const RESIDENCY_LABELS: Record<Residency, string> = {
  RESIDENT: 'Resident',
  NON_RESIDENT: 'Non-resident',
};

export const STATUS_LABELS: Record<EmployeeStatus, string> = {
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  EXITED: 'Exited',
};

export const STATUS_BADGE: Record<EmployeeStatus, 'success' | 'warning' | 'destructive'> = {
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  EXITED: 'destructive',
};

export function fullName(e: { firstName: string; lastName: string; otherNames?: string | null }) {
  return [e.firstName, e.otherNames, e.lastName].filter(Boolean).join(' ');
}

export const dateFmt = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeZone: 'UTC', // @db.Date values are stored at UTC midnight
});

/** Today's calendar date in Kampala as yyyy-mm-dd. */
export function todayKampala(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Kampala',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
