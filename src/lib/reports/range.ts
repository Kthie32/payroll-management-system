import { z } from 'zod';

/**
 * Report selection. Exactly one of: specific runs, a calendar month (by pay date), or a
 * financial year (July–June, Uganda). Draft runs are excluded unless includeDraft is set.
 */
export const selectionSchema = z.object({
  mode: z.enum(['runs', 'month', 'fy']).default('month'),
  runIds: z.array(z.string().min(1).max(40)).max(50).default([]),
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
  /** Financial year by its starting year: 2026 → 2026-07-01 … 2027-06-30. */
  fy: z.coerce.number().int().min(2000).max(2100).optional(),
  includeDraft: z.boolean().default(false),
  groupByDepartment: z.boolean().default(false),
});
export type Selection = z.infer<typeof selectionSchema>;

/** Parse URL search params (strings / repeated keys) into a Selection. */
export function parseSelection(params: Record<string, string | string[] | undefined>): Selection {
  const one = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const many = (k: string) => {
    const v = params[k];
    return (Array.isArray(v) ? v : v ? [v] : []).flatMap((s) => s.split(',')).filter(Boolean);
  };
  const parsed = selectionSchema.safeParse({
    mode: one('mode') || undefined,
    runIds: many('run'),
    month: one('month') || undefined,
    fy: one('fy') || undefined,
    includeDraft: one('draft') === '1',
    groupByDepartment: one('group') === '1',
  });
  return parsed.success ? parsed.data : selectionSchema.parse({});
}

/** Inclusive pay-date range [from, to] as ISO dates, or null for run-based selection. */
export function payDateRange(s: Selection, today: string): { from: string; to: string } | null {
  if (s.mode === 'runs') return null;
  if (s.mode === 'fy') {
    const start = s.fy ?? financialYearOf(today);
    return { from: `${start}-07-01`, to: `${start + 1}-06-30` };
  }
  const month = s.month ?? today.slice(0, 7);
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** Financial year (by starting calendar year) containing the date. July starts a new year. */
export function financialYearOf(isoDate: string): number {
  const y = Number(isoDate.slice(0, 4));
  const m = Number(isoDate.slice(5, 7));
  return m >= 7 ? y : y - 1;
}

export function fyLabel(start: number): string {
  return `FY ${start}/${String((start + 1) % 100).padStart(2, '0')}`;
}

/** Query string for a selection (used for links and download URLs). */
export function selectionQuery(s: Selection): string {
  const q = new URLSearchParams();
  q.set('mode', s.mode);
  if (s.mode === 'runs') for (const id of s.runIds) q.append('run', id);
  if (s.mode === 'month' && s.month) q.set('month', s.month);
  if (s.mode === 'fy' && s.fy) q.set('fy', String(s.fy));
  if (s.includeDraft) q.set('draft', '1');
  if (s.groupByDepartment) q.set('group', '1');
  return q.toString();
}

export function describeSelection(s: Selection, today: string): string {
  const draft = s.includeDraft ? ' — INCLUDES UNAPPROVED (DRAFT) RUNS' : '';
  if (s.mode === 'runs') return `${s.runIds.length} selected run(s)${draft}`;
  if (s.mode === 'fy') return `${fyLabel(s.fy ?? financialYearOf(today))}${draft}`;
  return `Pay month ${s.month ?? today.slice(0, 7)}${draft}`;
}
