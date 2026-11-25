import { Prisma } from '@prisma/client';
import type { Tx } from '@/lib/db';
import { toAuditJson } from './serialize';

export interface AuditEntry {
  actorId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

/**
 * Append an audit entry inside the caller's transaction, so the entry and the change it
 * describes commit or roll back together. `audit_log` is append-only at the DB level.
 */
export async function withAudit(tx: Pick<Tx, 'auditLog'>, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      before: jsonOrNull(entry.before),
      after: jsonOrNull(entry.after),
      ip: entry.ip ?? null,
    },
  });
}

function jsonOrNull(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined || value === null) return Prisma.JsonNull;
  return toAuditJson(value) as Prisma.InputJsonValue;
}

export { toAuditJson } from './serialize';
export { diffJson, type DiffEntry } from './diff';
