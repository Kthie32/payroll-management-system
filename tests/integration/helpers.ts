import 'dotenv/config';
import { PrismaClient, type RunStatus } from '@prisma/client';

export function testDb(): PrismaClient {
  return new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
}

const uid = () => Math.random().toString(36).slice(2, 10);

export async function makeEmployee(db: PrismaClient) {
  const payGroup = await db.payGroup.create({
    data: { name: `PG ${uid()}`, frequency: 'MONTHLY' },
  });
  const employee = await db.employee.create({
    data: {
      staffNo: `T-${uid()}`,
      firstName: 'Test',
      lastName: 'Employee',
      workerType: 'PERMANENT',
      payGroupId: payGroup.id,
      hireDate: new Date('2026-01-01'),
    },
  });
  return { payGroup, employee };
}

/** A run with one employee row and one line, created while DRAFT and then moved to `status`. */
export async function makeRunWithLine(db: PrismaClient, status: RunStatus) {
  const { payGroup, employee } = await makeEmployee(db);
  const period = await db.payPeriod.create({
    data: {
      payGroupId: payGroup.id,
      startDate: new Date('2026-11-01'),
      endDate: new Date('2026-11-30'),
      payDate: new Date('2026-11-28'),
    },
  });
  const run = await db.payrollRun.create({
    data: { periodId: period.id, payGroupId: payGroup.id, status: 'DRAFT' },
  });
  const zero = 0n;
  const runEmployee = await db.payrollRunEmployee.create({
    data: {
      runId: run.id,
      employeeId: employee.id,
      snapshot: {},
      gross: 1_000_000n,
      taxable: 1_000_000n,
      nssfBase: 1_000_000n,
      paye: 188_250n,
      nssfEmployee: 50_000n,
      nssfEmployer: 100_000n,
      lst: zero,
      otherDeductions: zero,
      net: 761_750n,
      employerCost: 1_100_000n,
      warnings: [],
    },
  });
  const line = await db.payrollLine.create({
    data: { runEmployeeId: runEmployee.id, code: 'BASIC', kind: 'EARNING', amount: 1_000_000n },
  });
  if (status !== 'DRAFT') {
    await db.payrollRun.update({ where: { id: run.id }, data: { status } });
  }
  return { run, runEmployee, line, employee, period };
}
