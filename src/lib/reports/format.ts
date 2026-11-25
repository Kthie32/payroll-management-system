/** Display helpers shared by report, export and dashboard pages. */

const grouped = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** 1234567 → "1,234,567" (UGX amounts are whole shillings). */
export function fmtMoney(n: number | null | undefined): string {
  return typeof n === 'number' ? grouped.format(n) : '';
}

/** 1234567 → "UGX 1.23M"; small values stay exact. For KPI cards. */
export function fmtCompactUgx(n: number): string {
  if (Math.abs(n) >= 1_000_000_000) return `UGX ${(n / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(n) >= 1_000_000) return `UGX ${(n / 1_000_000).toFixed(2)}M`;
  return `UGX ${grouped.format(n)}`;
}

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "2026-11-28" → "28 Nov 2026". */
export function fmtDate(isoDate: string): string {
  return dateFmt.format(new Date(`${isoDate}T00:00:00Z`));
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  COMPUTED: 'Computed',
  SUBMITTED: 'Awaiting approval',
  REJECTED: 'Rejected',
  APPROVED: 'Approved',
  EXPORTED: 'Exported',
  PAID: 'Paid',
  LOCKED: 'Locked',
};

export function runStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function runStatusVariant(
  status: string,
): 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline' {
  switch (status) {
    case 'APPROVED':
    case 'EXPORTED':
      return 'default';
    case 'PAID':
    case 'LOCKED':
      return 'success';
    case 'SUBMITTED':
      return 'warning';
    case 'REJECTED':
      return 'destructive';
    default:
      return 'secondary';
  }
}
