/**
 * Demo data for reviewing the system (development only). Idempotent: does nothing if DEMO001 exists.
 * Run with `pnpm db:seed:demo` (needs the base seed first).
 *
 * Creates demo users, 10 employees (7 monthly, 3 casual), bank accounts, components, a loan,
 * pay periods, an APPROVED October 2026 run and a COMPUTED November 2026 run awaiting submission,
 * all through the real payroll services so figures come from the engine.
 */
import 'dotenv/config';
import { db } from '@/lib/db';
import { encrypt, last4 } from '@/lib/crypto';
import { hashPassword } from '@/lib/auth/password';
import { withAudit } from '@/lib/audit';
import { generatePeriodsForGroup, saveManualInputs } from '@/lib/payroll/server/periods-inputs';
import { computeRun } from '@/lib/payroll/server/compute';
import { approveRun, createRun, submitRun } from '@/lib/payroll/server/workflow';
import type { RoleCode } from '@prisma/client';

const DEMO_PASSWORD = 'Demo!Pass2026';
const COMPANY_NAME = 'Magezi Harvest Limited';
const OLD_DEMO_COMPANY = 'Demo Company (U) Ltd';
const ESTHER_WALLET = '256772445566';

/** Demo contact details: firstname.lastname@mageziharvest.example and a 2567XXXXXXXX phone. */
function demoEmail(first: string, last: string): string {
  return `${first}.${last}@mageziharvest.example`.toLowerCase();
}
function demoPhone(staffNo: string): string {
  return `2567710${staffNo.slice(-3)}00`.slice(0, 12);
}

const USERS: Array<{ email: string; name: string; role: RoleCode }> = [
  { email: 'hr@example.com', name: 'Harriet HR', role: 'HR_OFFICER' },
  { email: 'payroll@example.com', name: 'Peter Payroll', role: 'PAYROLL_OFFICER' },
  { email: 'finance@example.com', name: 'Fiona Finance', role: 'FINANCE_APPROVER' },
  { email: 'auditor@example.com', name: 'Andrew Auditor', role: 'AUDITOR' },
];

interface DemoEmployee {
  staffNo: string;
  firstName: string;
  lastName: string;
  dept: string;
  job: string;
  group: 'Monthly Staff' | 'Casual Workers';
  hire: string;
  basic?: number;
  housing?: number;
  transport?: number;
  dailyRate?: number;
  bank: string;
  account: string;
}

const EMPLOYEES: DemoEmployee[] = [
  {
    staffNo: 'DEMO001',
    firstName: 'Grace',
    lastName: 'Namubiru',
    dept: 'Finance',
    job: 'Finance Manager',
    group: 'Monthly Staff',
    hire: '2022-02-01',
    basic: 4_500_000,
    housing: 800_000,
    transport: 300_000,
    bank: 'Stanbic Bank Uganda',
    account: '9030012345671',
  },
  {
    staffNo: 'DEMO002',
    firstName: 'Joseph',
    lastName: 'Okello',
    dept: 'Operations',
    job: 'Operations Lead',
    group: 'Monthly Staff',
    hire: '2023-05-15',
    basic: 2_800_000,
    transport: 200_000,
    bank: 'Centenary Bank',
    account: '3100045678123',
  },
  {
    staffNo: 'DEMO003',
    firstName: 'Sarah',
    lastName: 'Nakato',
    dept: 'Sales',
    job: 'Sales Executive',
    group: 'Monthly Staff',
    hire: '2024-01-08',
    basic: 1_200_000,
    transport: 150_000,
    bank: 'Absa Bank Uganda',
    account: '6004123456789',
  },
  {
    staffNo: 'DEMO004',
    firstName: 'David',
    lastName: 'Mugisha',
    dept: 'Administration',
    job: 'Office Administrator',
    group: 'Monthly Staff',
    hire: '2021-09-01',
    basic: 950_000,
    bank: 'dfcu Bank',
    account: '0102345678901',
  },
  {
    staffNo: 'DEMO005',
    firstName: 'Agnes',
    lastName: 'Auma',
    dept: 'HR',
    job: 'HR Officer',
    group: 'Monthly Staff',
    hire: '2025-03-01',
    basic: 1_800_000,
    housing: 300_000,
    bank: 'Equity Bank Uganda',
    account: '1001200345678',
  },
  {
    staffNo: 'DEMO006',
    firstName: 'Brian',
    lastName: 'Ssemakula',
    dept: 'Operations',
    job: 'Driver',
    group: 'Monthly Staff',
    hire: '2026-11-16',
    basic: 600_000,
    bank: 'Centenary Bank',
    account: '3100099887766',
  },
  {
    staffNo: 'DEMO007',
    firstName: 'Ruth',
    lastName: 'Achieng',
    dept: 'Sales',
    job: 'Sales Assistant',
    group: 'Monthly Staff',
    hire: '2020-06-01',
    basic: 380_000,
    bank: 'Stanbic Bank Uganda',
    account: '9030098765432',
  },
  {
    staffNo: 'DEMO008',
    firstName: 'Moses',
    lastName: 'Kato',
    dept: 'Operations',
    job: 'Casual Labourer',
    group: 'Casual Workers',
    hire: '2026-10-01',
    dailyRate: 25_000,
    bank: 'PostBank Uganda',
    account: '2200011122233',
  },
  {
    staffNo: 'DEMO009',
    firstName: 'Esther',
    lastName: 'Nabirye',
    dept: 'Operations',
    job: 'Casual Labourer',
    group: 'Casual Workers',
    hire: '2026-10-01',
    dailyRate: 25_000,
    // Paid by mobile money: the account number is the wallet phone number.
    bank: 'MTN Mobile Money',
    account: ESTHER_WALLET,
  },
  {
    staffNo: 'DEMO010',
    firstName: 'Ivan',
    lastName: 'Tumusiime',
    dept: 'Operations',
    job: 'Casual Supervisor',
    group: 'Casual Workers',
    hire: '2026-10-01',
    dailyRate: 40_000,
    bank: 'Equity Bank Uganda',
    account: '1001299988877',
  },
];

/** Sets createdById if the workflow has not already done so (only allowed before approval). */
async function markPreparer(runId: string, userId: string) {
  await db.payrollRun.updateMany({
    where: { id: runId, createdById: null },
    data: { createdById: userId },
  });
}
async function markSubmitter(runId: string, userId: string) {
  await db.payrollRun.updateMany({
    where: { id: runId, submittedById: null },
    data: { submittedById: userId, submittedAt: new Date() },
  });
}

/**
 * Brings demo data created by an earlier version of this script up to date (idempotent):
 * company name, employee emails/phones, Esther's MTN MoMo wallet, and run preparer/submitter
 * backfilled from the audit log.
 */
async function upgradeExistingDemo(adminId: string) {
  const changes: string[] = [];
  await db.$transaction(async (tx) => {
    const company = await tx.setting.findUnique({ where: { key: 'company.name' } });
    if (company && company.value === OLD_DEMO_COMPANY) {
      await tx.setting.update({ where: { key: 'company.name' }, data: { value: COMPANY_NAME } });
      await withAudit(tx, {
        actorId: adminId,
        action: 'SETTING_UPDATED',
        entity: 'Setting',
        entityId: company.id,
        before: { 'company.name': company.value },
        after: { 'company.name': COMPANY_NAME },
        ip: null,
      });
      changes.push('company name');
    }

    for (const e of EMPLOYEES) {
      const emp = await tx.employee.findUnique({ where: { staffNo: e.staffNo } });
      if (!emp || (emp.email && emp.phone)) continue;
      const data = {
        email: emp.email ?? demoEmail(e.firstName, e.lastName),
        phone: emp.phone ?? (e.staffNo === 'DEMO009' ? ESTHER_WALLET : demoPhone(e.staffNo)),
      };
      await tx.employee.update({ where: { id: emp.id }, data });
      await withAudit(tx, {
        actorId: adminId,
        action: 'EMPLOYEE_UPDATED',
        entity: 'Employee',
        entityId: emp.id,
        before: { email: emp.email, phone: emp.phone },
        after: data,
        ip: null,
      });
      changes.push(`contact details for ${e.staffNo}`);
    }

    const esther = await tx.employee.findUnique({ where: { staffNo: 'DEMO009' } });
    const momo = await tx.bank.findUnique({ where: { code: 'MTNMOMO' } });
    if (esther && momo) {
      const active = await tx.employeeBankAccount.findFirst({
        where: { employeeId: esther.id, isActive: true },
      });
      if (!active || active.bankId !== momo.id) {
        if (active) {
          await tx.employeeBankAccount.update({
            where: { id: active.id },
            data: { isActive: false },
          });
        }
        const acc = await tx.employeeBankAccount.create({
          data: {
            employeeId: esther.id,
            bankId: momo.id,
            accountNoEnc: encrypt(ESTHER_WALLET),
            accountNoLast4: last4(ESTHER_WALLET),
            accountName: `${esther.firstName} ${esther.lastName}`,
            effectiveFrom: new Date('2026-11-01T00:00:00Z'),
          },
        });
        await withAudit(tx, {
          actorId: adminId,
          action: 'BANK_ACCOUNT_ADDED',
          entity: 'EmployeeBankAccount',
          entityId: acc.id,
          before: active ? { bankId: active.bankId, accountNoLast4: active.accountNoLast4 } : null,
          after: { bankId: momo.id, accountNoLast4: acc.accountNoLast4, kind: 'MOBILE_MONEY' },
          ip: null,
        });
        changes.push('Esther MTN MoMo wallet');
      }
    }
  });

  // Backfill preparer/submitter from the audit trail.
  const runs = await db.payrollRun.findMany({
    where: { OR: [{ createdById: null }, { submittedById: null, status: { not: 'DRAFT' } }] },
    select: { id: true, status: true, createdById: true, submittedById: true },
  });
  for (const run of runs) {
    const events = await db.auditLog.findMany({
      where: {
        entity: 'PayrollRun',
        entityId: run.id,
        action: { in: ['PAYROLL_RUN_CREATED', 'PAYROLL_RUN_SUBMITTED'] },
      },
      orderBy: { at: 'asc' },
    });
    const created = events.find((x) => x.action === 'PAYROLL_RUN_CREATED');
    const submitted = events.filter((x) => x.action === 'PAYROLL_RUN_SUBMITTED').at(-1);
    const data: { createdById?: string; submittedById?: string; submittedAt?: Date } = {};
    if (!run.createdById && created?.actorId) data.createdById = created.actorId;
    if (!run.submittedById && submitted?.actorId) {
      data.submittedById = submitted.actorId;
      data.submittedAt = submitted.at;
    }
    if (Object.keys(data).length === 0) continue;
    await db.payrollRun.update({ where: { id: run.id }, data });
    changes.push(`preparer/submitter for run ${run.id}`);
  }
  return changes;
}

async function main() {
  if (await db.employee.findUnique({ where: { staffNo: 'DEMO001' } })) {
    const admin = await db.user.findFirstOrThrow({
      where: { roles: { some: { role: { code: 'SYSTEM_ADMIN' } } } },
      orderBy: { createdAt: 'asc' },
    });
    const changes = await upgradeExistingDemo(admin.id);
    console.log(
      changes.length
        ? `Demo data already present — upgraded: ${changes.join(', ')}.`
        : 'Demo data already present and up to date — nothing to do.',
    );
    return;
  }
  const admin = await db.user.findFirstOrThrow({
    where: { roles: { some: { role: { code: 'SYSTEM_ADMIN' } } } },
    orderBy: { createdAt: 'asc' },
  });

  // Users
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const userIds: Partial<Record<RoleCode, string>> = {};
  for (const u of USERS) {
    const role = await db.role.findUniqueOrThrow({ where: { code: u.role } });
    const user = await db.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email: u.email,
        name: u.name,
        passwordHash,
        mustChangePassword: false,
        roles: { create: { roleId: role.id } },
      },
    });
    userIds[u.role] = user.id;
  }
  const payrollOfficer = userIds.PAYROLL_OFFICER!;
  const approver = userIds.FINANCE_APPROVER!;

  // Company settings
  const company: Record<string, string> = {
    'company.name': COMPANY_NAME,
    'company.tin': '1000123456',
    'company.nssfEmployerNo': 'NS000123456',
    'company.address': 'Plot 1, Kampala Road, Kampala',
    'payslip.footer':
      'This is a computer-generated payslip. Queries: payroll@mageziharvest.example',
  };
  for (const [key, value] of Object.entries(company)) {
    await db.setting.upsert({ where: { key }, update: {}, create: { key, value } });
  }

  // Employees, bank accounts, recurring components
  const comp = Object.fromEntries(
    (await db.payComponent.findMany()).map((c) => [c.code, c.id] as const),
  ) as Record<string, string>;
  const groups = Object.fromEntries(
    (await db.payGroup.findMany()).map((g) => [g.name, g.id] as const),
  );
  const depts = Object.fromEntries(
    (await db.department.findMany()).map((d) => [d.name, d.id] as const),
  );
  const banks = Object.fromEntries((await db.bank.findMany()).map((b) => [b.name, b.id] as const));

  const ids: Record<string, string> = {};
  for (const e of EMPLOYEES) {
    const bankId = banks[e.bank] ?? Object.values(banks)[0];
    if (!bankId) throw new Error('No banks seeded — run pnpm db:seed first');
    const emp = await db.employee.create({
      data: {
        staffNo: e.staffNo,
        firstName: e.firstName,
        lastName: e.lastName,
        workerType: e.group === 'Casual Workers' ? 'CASUAL' : 'PERMANENT',
        payGroupId: groups[e.group]!,
        departmentId: depts[e.dept] ?? null,
        jobTitle: e.job,
        hireDate: new Date(`${e.hire}T00:00:00Z`),
        email: demoEmail(e.firstName, e.lastName),
        phone: e.staffNo === 'DEMO009' ? ESTHER_WALLET : demoPhone(e.staffNo),
        tin: `10${e.staffNo.slice(-3)}45678`.slice(0, 10),
        nssfNo: `NSF${e.staffNo.slice(-3)}2026`,
        lstDistrict: 'Kampala',
        bankAccounts: {
          create: {
            bankId,
            accountNoEnc: encrypt(e.account),
            accountNoLast4: last4(e.account),
            accountName: `${e.firstName} ${e.lastName}`,
            effectiveFrom: new Date(`${e.hire}T00:00:00Z`),
          },
        },
      },
    });
    ids[e.staffNo] = emp.id;
    const from = new Date(`${e.hire}T00:00:00Z`);
    const add = (code: string, data: { amount?: number; ratePerUnit?: number }) =>
      db.employeeComponent.create({
        data: {
          employeeId: emp.id,
          componentId: comp[code]!,
          effectiveFrom: from,
          amount: data.amount !== undefined ? BigInt(data.amount) : null,
          ratePerUnit: data.ratePerUnit !== undefined ? BigInt(data.ratePerUnit) : null,
        },
      });
    if (e.basic) await add('BASIC', { amount: e.basic });
    if (e.housing) await add('HOUSING', { amount: e.housing });
    if (e.transport) await add('TRANSPORT', { amount: e.transport });
    if (e.dailyRate) await add('DAILY_WAGE', { ratePerUnit: e.dailyRate });
  }

  // A loan for Joseph Okello
  await db.loan.create({
    data: {
      employeeId: ids.DEMO002!,
      type: 'LOAN',
      principal: 1_800_000n,
      installment: 300_000n,
      balance: 1_800_000n,
      status: 'ACTIVE',
    },
  });

  await db.$transaction((tx) =>
    withAudit(tx, {
      actorId: admin.id,
      action: 'DEMO_DATA_LOADED',
      entity: 'System',
      entityId: null,
      after: { employees: EMPLOYEES.length, users: USERS.map((u) => u.email) },
      ip: null,
    }),
  );

  // Periods Oct–Dec 2026 for both groups
  await generatePeriodsForGroup(
    groups['Monthly Staff']!,
    { from: '2026-10', to: '2026-12' },
    payrollOfficer,
    null,
  );
  await generatePeriodsForGroup(
    groups['Casual Workers']!,
    { from: '2026-11', to: '2026-12' },
    payrollOfficer,
    null,
  );

  const monthly = await db.payPeriod.findMany({
    where: { payGroupId: groups['Monthly Staff']! },
    orderBy: { startDate: 'asc' },
  });
  const [oct, nov] = monthly;
  if (!oct || !nov) throw new Error('Monthly periods not generated');

  // October: overtime for Joseph, then compute → submit → approve (approver ≠ preparer)
  await saveManualInputs(
    oct.id,
    [{ employeeId: ids.DEMO002!, componentId: comp.OVERTIME!, value: '10' }],
    payrollOfficer,
    null,
  );
  // OVERTIME has no rate assigned by default; give Joseph an hourly rate so the input computes.
  await db.employeeComponent.create({
    data: {
      employeeId: ids.DEMO002!,
      componentId: comp.OVERTIME!,
      ratePerUnit: 15_000n,
      effectiveFrom: new Date('2023-05-15T00:00:00Z'),
    },
  });
  const octRun = await createRun(oct.id, payrollOfficer, null);
  await markPreparer(octRun.id, payrollOfficer);
  await computeRun(octRun.id, payrollOfficer, null);
  await submitRun(octRun.id, payrollOfficer, null);
  await markSubmitter(octRun.id, payrollOfficer);
  await approveRun(octRun.id, approver, null);

  // November: bonus for Sarah, compute only (awaiting review and submission)
  await saveManualInputs(
    nov.id,
    [{ employeeId: ids.DEMO003!, componentId: comp.BONUS!, value: '500000' }],
    payrollOfficer,
    null,
  );
  const novRun = await createRun(nov.id, payrollOfficer, null);
  await markPreparer(novRun.id, payrollOfficer);
  await computeRun(novRun.id, payrollOfficer, null);

  // Casuals: days worked in the first November week
  const casualFirst = await db.payPeriod.findFirst({
    where: { payGroupId: groups['Casual Workers']! },
    orderBy: { startDate: 'asc' },
  });
  if (casualFirst) {
    await saveManualInputs(
      casualFirst.id,
      ['DEMO008', 'DEMO009', 'DEMO010'].map((s, i) => ({
        employeeId: ids[s]!,
        componentId: comp.DAILY_WAGE!,
        value: String(6 - i),
      })),
      payrollOfficer,
      null,
    );
  }

  console.log(
    'Demo data loaded: 10 employees, 4 users, October run APPROVED, November run COMPUTED.',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
