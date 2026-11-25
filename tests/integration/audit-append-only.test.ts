import { afterAll, describe, expect, it } from 'vitest';
import { withAudit } from '@/lib/audit';
import { testDb } from './helpers';

const db = testDb();
afterAll(() => db.$disconnect());

describe('audit_log is append-only', () => {
  it('accepts inserts via withAudit inside a transaction', async () => {
    await db.$transaction((tx) =>
      withAudit(tx, {
        actorId: null,
        action: 'TEST',
        entity: 'Test',
        entityId: 'a',
        after: { n: 1n },
      }),
    );
    const row = await db.auditLog.findFirst({ where: { action: 'TEST', entityId: 'a' } });
    expect(row?.after).toEqual({ n: '1' });
  });

  it('rejects UPDATE', async () => {
    const row = await db.auditLog.create({ data: { action: 'X', entity: 'Test' } });
    await expect(
      db.auditLog.update({ where: { id: row.id }, data: { action: 'TAMPERED' } }),
    ).rejects.toThrow(/AUDIT_APPEND_ONLY/);
    await expect(
      db.$executeRaw`UPDATE audit_log SET action = 'TAMPERED' WHERE id = ${row.id}`,
    ).rejects.toThrow(/AUDIT_APPEND_ONLY/);
  });

  it('rejects DELETE', async () => {
    const row = await db.auditLog.create({ data: { action: 'X', entity: 'Test' } });
    await expect(db.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(
      /AUDIT_APPEND_ONLY/,
    );
    await expect(db.auditLog.deleteMany({})).rejects.toThrow(/AUDIT_APPEND_ONLY/);
  });

  it('rolls the audit entry back with its transaction', async () => {
    await expect(
      db.$transaction(async (tx) => {
        await withAudit(tx, { actorId: null, action: 'ROLLBACK_ME', entity: 'Test' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await db.auditLog.count({ where: { action: 'ROLLBACK_ME' } })).toBe(0);
  });
});
