import { Badge } from '@/components/ui/badge';
import { STATUS_LABELS, type RunStatus } from '@/lib/payroll/status';

const VARIANT: Record<
  RunStatus,
  'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline'
> = {
  DRAFT: 'outline',
  COMPUTED: 'secondary',
  SUBMITTED: 'warning',
  REJECTED: 'destructive',
  APPROVED: 'success',
  EXPORTED: 'success',
  PAID: 'success',
  LOCKED: 'default',
};

export function RunStatusBadge({ status }: { status: string }) {
  const s = status as RunStatus;
  return <Badge variant={VARIANT[s] ?? 'outline'}>{STATUS_LABELS[s] ?? status}</Badge>;
}
