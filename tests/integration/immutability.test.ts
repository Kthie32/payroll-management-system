import { afterAll, describe, expect, it } from 'vitest';
import { makeRunWithLine, testDb } from './helpers';

const db = testDb();
afterAll(() => db.$disconnect());

describe('payroll immutability triggers', () => {
  it('allows changes while the run is DRAFT', async () => {
    const { line, runEmployee } = await makeRunWithLine(db, 'DRAFT');
    await expect(
      db.payrollLine.update({ where: { id: line.id }, data: { amount: 999n } }),
    ).resolves.toMatchObject({ amount: 999n });
    await expect(
      db.payrollLine.create({
        data: { runEmployeeId: runEmployee.id, code: 'X', kind: 'EARNING', amount: 1n },
      }),
    ).resolves.toBeTruthy();
    await expect(db.payrollLine.delete({ where: { id: line.id } })).resolves.toBeTruthy();
  });

  it.each(['APPROVED', 'EXPORTED', 'PAID', 'LOCKED'] as const)(
    'blocks UPDATE of payroll_lines under a %s run',
    async (status) => {
      const { line } = await makeRunWithLine(db, status);
      await expect(
        db.payrollLine.update({ where: { id: line.id }, data: { amount: 1n } }),
      ).rejects.toThrow(/RUN_IMMUTABLE/);
    },
  );

  it('blocks INSERT and DELETE of payroll_lines under an APPROVED run', async () => {
    const { line, runEmployee } = await makeRunWithLine(db, 'APPROVED');
    await expect(
      db.payrollLine.create({
        data: { runEmployeeId: runEmployee.id, code: 'X', kind: 'EARNING', amount: 1n },
      }),
    ).rejects.toThrow(/RUN_IMMUTABLE/);
    await expect(db.payrollLine.delete({ where: { id: line.id } })).rejects.toThrow(
      /RUN_IMMUTABLE/,
    );
  });

  it('blocks UPDATE and DELETE of payroll_run_employees under an APPROVED run', async () => {
    const { runEmployee } = await makeRunWithLine(db, 'APPROVED');
    await expect(
      db.payrollRunEmployee.update({ where: { id: runEmployee.id }, data: { net: 1n } }),
    ).rejects.toThrow(/RUN_IMMUTABLE/);
    await expect(db.payrollRunEmployee.delete({ where: { id: runEmployee.id } })).rejects.toThrow(
      /RUN_IMMUTABLE/,
    );
  });

  it('blocks raw SQL too (not just Prisma)', async () => {
    const { line } = await makeRunWithLine(db, 'APPROVED');
    await expect(
      db.$executeRaw`UPDATE payroll_lines SET amount = 5 WHERE id = ${line.id}`,
    ).rejects.toThrow(/RUN_IMMUTABLE/);
  });

  it('run status only moves forward once APPROVED', async () => {
    const { run } = await makeRunWithLine(db, 'APPROVED');
    await expect(
      db.payrollRun.update({ where: { id: run.id }, data: { status: 'DRAFT' } }),
    ).rejects.toThrow(/RUN_STATUS_BACKWARDS/);
    await expect(
      db.payrollRun.update({
        where: { id: run.id },
        data: { status: 'EXPORTED', exportedAt: new Date() },
      }),
    ).resolves.toMatchObject({ status: 'EXPORTED' });
    await expect(
      db.payrollRun.update({ where: { id: run.id }, data: { totals: { tampered: true } } }),
    ).rejects.toThrow(/RUN_IMMUTABLE/);
    await expect(db.payrollRun.delete({ where: { id: run.id } })).rejects.toThrow(/RUN_IMMUTABLE/);
  });

  it('freezes who created and submitted a run once it is APPROVED', async () => {
    const { run } = await makeRunWithLine(db, 'APPROVED');
    const someone = await db.user.create({
      data: {
        email: `preparer-${Date.now()}@test.local`,
        name: 'Preparer',
        passwordHash: 'x',
      },
    });
    for (const data of [
      { createdById: someone.id },
      { submittedById: someone.id },
      { submittedAt: new Date() },
    ]) {
      await expect(db.payrollRun.update({ where: { id: run.id }, data })).rejects.toThrow(
        /RUN_IMMUTABLE/,
      );
    }
  });

  it('allows only one non-rejected run per period', async () => {
    const { run, period } = await makeRunWithLine(db, 'DRAFT');
    await expect(
      db.payrollRun.create({ data: { periodId: period.id, payGroupId: run.payGroupId } }),
    ).rejects.toThrow();
    await db.payrollRun.update({ where: { id: run.id }, data: { status: 'REJECTED' } });
    await expect(
      db.payrollRun.create({ data: { periodId: period.id, payGroupId: run.payGroupId } }),
    ).resolves.toBeTruthy();
  });
});
