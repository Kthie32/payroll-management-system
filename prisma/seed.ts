/**
 * Idempotent seed: safe to run repeatedly. Creates only what is missing and never overwrites
 * values an administrator may have changed (passwords, settings, approved rules).
 * Runs as the migrator user (MIGRATE_DATABASE_URL).
 */
import 'dotenv/config';
import {
  CalcType,
  ComponentKind,
  PayFrequency,
  PrismaClient,
  RoleCode,
  StatutoryRule,
  type Prisma,
} from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withAudit } from '../src/lib/audit';
import { hashPassword } from '../src/lib/auth/argon';

const db = new PrismaClient({ datasourceUrl: process.env.MIGRATE_DATABASE_URL });
type Tx = Prisma.TransactionClient;

const RULES_EFFECTIVE_FROM = new Date('2026-07-01T00:00:00.000Z');

const ROLES: { code: RoleCode; name: string; description: string }[] = [
  {
    code: 'SYSTEM_ADMIN',
    name: 'System Admin',
    description: 'Users, settings and statutory rule entry',
  },
  { code: 'HR_OFFICER', name: 'HR Officer', description: 'Employee records and loans' },
  {
    code: 'PAYROLL_OFFICER',
    name: 'Payroll Officer',
    description: 'Prepares and computes payroll',
  },
  {
    code: 'FINANCE_APPROVER',
    name: 'Finance Approver',
    description: 'Approves payroll and statutory rules',
  },
  { code: 'AUDITOR', name: 'Auditor', description: 'Read-only access including the audit log' },
];

// Params exactly as in CLAUDE.md → "Statutory parameters". TODO-confirm against URA / NSSF.
const PAYE_RES_PARAMS = {
  bands: [
    { from: 0, to: 335000, rateBp: 0 },
    { from: 335000, to: 410000, rateBp: 2000 },
    { from: 410000, to: 485000, rateBp: 2500 },
    { from: 485000, to: null, rateBp: 3000 },
  ],
  surcharge: { threshold: 10000000, rateBp: 1000 },
};
const NSSF_PARAMS = { employeeRateBp: 500, employerRateBp: 1000, ceiling: null };

interface ComponentSeed {
  code: string;
  name: string;
  kind: ComponentKind;
  calcType: CalcType;
  taxable: boolean;
  nssfable: boolean;
  prorate: boolean;
  recurring: boolean;
  priority: number;
  sortOrder: number;
}

const earning = (
  code: string,
  name: string,
  calcType: CalcType,
  sortOrder: number,
  opts: Partial<ComponentSeed> = {},
): ComponentSeed => ({
  code,
  name,
  kind: 'EARNING',
  calcType,
  taxable: true,
  nssfable: true,
  prorate: false,
  recurring: true,
  priority: 0,
  sortOrder,
  ...opts,
});

const deduction = (code: string, name: string, priority: number): ComponentSeed => ({
  code,
  name,
  kind: 'DEDUCTION',
  calcType: 'FIXED',
  taxable: false,
  nssfable: false,
  prorate: false,
  recurring: true,
  priority,
  sortOrder: 100 + priority,
});

const COMPONENTS: ComponentSeed[] = [
  earning('BASIC', 'Basic salary', 'FIXED', 10, { prorate: true }),
  // TODO-confirm: HOUSING / TRANSPORT / LUNCH / AIRTIME default to taxable + NSSF-able.
  // Confirm treatment of each allowance with the tax advisor before go-live.
  earning('HOUSING', 'Housing allowance', 'FIXED', 20),
  earning('TRANSPORT', 'Transport allowance', 'FIXED', 30),
  earning('LUNCH', 'Lunch allowance', 'FIXED', 40),
  earning('AIRTIME', 'Airtime allowance', 'FIXED', 50),
  earning('OVERTIME', 'Overtime', 'RATE_X_QTY', 60),
  earning('BONUS', 'Bonus', 'FIXED', 70, { recurring: false }),
  earning('DAILY_WAGE', 'Daily wage (casual)', 'RATE_X_QTY', 80),
  deduction('LOAN', 'Loan repayment', 10),
  deduction('ADVANCE', 'Salary advance recovery', 20),
  deduction('SACCO', 'SACCO contribution', 30),
  deduction('WELFARE', 'Welfare contribution', 40),
];

const PAY_GROUPS: { name: string; frequency: PayFrequency }[] = [
  { name: 'Monthly Staff', frequency: 'MONTHLY' },
  { name: 'Casual Workers', frequency: 'WEEKLY' },
];

const SETTINGS: { key: string; value: Prisma.InputJsonValue }[] = [
  { key: 'minNetPayBp', value: 0 },
  { key: 'prorationBasis', value: 'CALENDAR_DAYS' },
];

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set (see .env.example)`);
  return v;
}

function loadLstBands(): unknown[] {
  const file = join(__dirname, 'data', 'lst-bands.json');
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { bands?: unknown };
  if (!Array.isArray(parsed.bands))
    throw new Error('prisma/data/lst-bands.json: "bands" must be an array');
  return parsed.bands;
}

async function seedRoles(tx: Tx) {
  for (const r of ROLES) {
    const existing = await tx.role.findUnique({ where: { code: r.code } });
    if (existing) continue;
    const role = await tx.role.create({ data: r });
    await withAudit(tx, {
      actorId: null,
      action: 'SEED_CREATE',
      entity: 'Role',
      entityId: role.id,
      after: r,
    });
  }
}

async function seedAdmin(tx: Tx): Promise<string> {
  const email = requireEnv('SEED_ADMIN_EMAIL').trim().toLowerCase();
  const password = requireEnv('SEED_ADMIN_PASSWORD');
  const adminRole = await tx.role.findUniqueOrThrow({ where: { code: 'SYSTEM_ADMIN' } });

  let user = await tx.user.findUnique({ where: { email } });
  if (!user) {
    user = await tx.user.create({
      data: {
        email,
        name: 'System Administrator',
        passwordHash: await hashPassword(password),
        mustChangePassword: true,
      },
    });
    await withAudit(tx, {
      actorId: null,
      action: 'SEED_CREATE',
      entity: 'User',
      entityId: user.id,
      after: { email, name: user.name, mustChangePassword: true },
    });
  }

  const link = await tx.userRole.findUnique({
    where: { userId_roleId: { userId: user.id, roleId: adminRole.id } },
  });
  if (!link) {
    await tx.userRole.create({ data: { userId: user.id, roleId: adminRole.id } });
    await withAudit(tx, {
      actorId: null,
      action: 'SEED_CREATE',
      entity: 'UserRole',
      entityId: user.id,
      after: { roles: ['SYSTEM_ADMIN'] },
    });
  }
  return user.id;
}

async function seedRule(
  tx: Tx,
  rule: StatutoryRule,
  params: Prisma.InputJsonValue,
  opts: { active: boolean; approvedById: string | null; sourceUrl?: string },
) {
  const where = { rule_effectiveFrom: { rule, effectiveFrom: RULES_EFFECTIVE_FROM } };
  if (await tx.statutoryRuleVersion.findUnique({ where })) return;
  const created = await tx.statutoryRuleVersion.create({
    data: {
      rule,
      params,
      effectiveFrom: RULES_EFFECTIVE_FROM,
      active: opts.active,
      sourceUrl: opts.sourceUrl ?? null,
      approvedById: opts.approvedById,
      approvedAt: opts.approvedById ? new Date() : null,
    },
  });
  await withAudit(tx, {
    actorId: null,
    action: 'SEED_CREATE',
    entity: 'StatutoryRuleVersion',
    entityId: created.id,
    after: { rule, params, effectiveFrom: '2026-07-01', active: opts.active },
  });
}

async function seedPayGroups(tx: Tx) {
  for (const g of PAY_GROUPS) {
    if (await tx.payGroup.findUnique({ where: { name: g.name } })) continue;
    const pg = await tx.payGroup.create({ data: g });
    await withAudit(tx, {
      actorId: null,
      action: 'SEED_CREATE',
      entity: 'PayGroup',
      entityId: pg.id,
      after: g,
    });
  }
}

async function seedComponents(tx: Tx) {
  for (const c of COMPONENTS) {
    if (await tx.payComponent.findUnique({ where: { code: c.code } })) continue;
    const pc = await tx.payComponent.create({ data: c });
    await withAudit(tx, {
      actorId: null,
      action: 'SEED_CREATE',
      entity: 'PayComponent',
      entityId: pc.id,
      after: c,
    });
  }
}

async function seedSettings(tx: Tx) {
  for (const s of SETTINGS) {
    if (await tx.setting.findUnique({ where: { key: s.key } })) continue;
    const row = await tx.setting.create({ data: s });
    await withAudit(tx, {
      actorId: null,
      action: 'SEED_CREATE',
      entity: 'Setting',
      entityId: row.id,
      after: s,
    });
  }
}

async function main() {
  const lstBands = loadLstBands();
  await db.$transaction(
    async (tx) => {
      await seedRoles(tx);
      const adminId = await seedAdmin(tx);
      await seedRule(tx, 'PAYE_RES', PAYE_RES_PARAMS, { active: true, approvedById: adminId });
      await seedRule(tx, 'NSSF', NSSF_PARAMS, { active: true, approvedById: adminId });
      await seedRule(
        tx,
        'LST',
        {
          bands: lstBands,
          instalments: 4,
          months: [7, 8, 9, 10],
          basis: 'MONTHLY_GROSS',
        } as Prisma.InputJsonValue,
        { active: false, approvedById: null },
      );
      await seedPayGroups(tx);
      await seedComponents(tx);
      await seedSettings(tx);
    },
    { timeout: 60_000 },
  );
  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
