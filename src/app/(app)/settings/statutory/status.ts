import type { StatutoryRuleVersion } from '@prisma/client';

type V = Pick<StatutoryRuleVersion, 'id' | 'approvedById' | 'active' | 'effectiveFrom'>;

/** Human status of a rule version relative to the one in effect today. */
export function versionStatus(v: V, current: { id: string } | null, today: Date) {
  if (!v.approvedById) return { label: 'Draft — awaiting approval', variant: 'warning' as const };
  if (!v.active) return { label: 'Inactive', variant: 'outline' as const };
  if (current?.id === v.id) return { label: 'In effect', variant: 'success' as const };
  if (v.effectiveFrom > today) return { label: 'Scheduled', variant: 'secondary' as const };
  return { label: 'Superseded', variant: 'outline' as const };
}

/** Today's date in Kampala as a UTC-midnight Date (matches @db.Date values). */
export function kampalaToday(): Date {
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kampala' }).format(new Date());
  return new Date(`${iso}T00:00:00Z`);
}
