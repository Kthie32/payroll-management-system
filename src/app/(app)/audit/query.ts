import type { Prisma } from '@prisma/client';
import { z } from 'zod';

export const PAGE_SIZE = 50;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .catch(undefined);

export const auditFilterSchema = z.object({
  entity: z.string().max(80).optional().catch(undefined),
  actor: z.string().max(191).optional().catch(undefined),
  from: isoDate,
  to: isoDate,
  page: z.coerce.number().int().min(1).max(100_000).catch(1).default(1),
});

export type AuditFilters = z.infer<typeof auditFilterSchema>;

/**
 * Build the Prisma filter. Dates are interpreted in Kampala time (UTC+3, no DST);
 * `to` is inclusive of the whole day.
 */
export function auditWhere(f: AuditFilters): Prisma.AuditLogWhereInput {
  const at: Prisma.DateTimeFilter = {};
  if (f.from) at.gte = new Date(`${f.from}T00:00:00+03:00`);
  if (f.to) {
    const end = new Date(`${f.to}T00:00:00+03:00`);
    end.setUTCDate(end.getUTCDate() + 1);
    at.lt = end;
  }
  return {
    ...(f.entity ? { entity: f.entity } : {}),
    ...(f.actor ? { actorId: f.actor } : {}),
    ...(f.from || f.to ? { at } : {}),
  };
}

export function pageHref(f: AuditFilters, page: number): string {
  const p = new URLSearchParams();
  if (f.entity) p.set('entity', f.entity);
  if (f.actor) p.set('actor', f.actor);
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  if (page > 1) p.set('page', String(page));
  const qs = p.toString();
  return qs ? `/audit?${qs}` : '/audit';
}
