/**
 * Idempotent seed: safe to run repeatedly. Creates only what is missing and never overwrites
 * values an administrator may have changed (passwords, settings, approved rules).
 * Runs as the migrator user (MIGRATE_DATABASE_URL).
 */
import 'dotenv/config';
import {
  CalcType,
  ComponentKind,
  InstitutionType,
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
    description: 'Users, roles, banks, export templates and system settings',
  },
  {
    code: 'HR_OFFICER',
    name: 'HR Officer',
    description: 'Employees, pay structures, bank details and variable inputs',
  },
  {
    code: 'PAYROLL_OFFICER',
    name: 'Payroll Officer',
    description: 'Creates, imports, computes and submits runs; generates payslips',
  },
  {
    code: 'FINANCE_APPROVER',
    name: 'Finance Approver',
    description: 'Approves runs, bank files, marks paid and uploads bank results',
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
  // Corrections to an approved run are paid or recovered in the next run (approved runs are never edited).
  earning('ARREARS', 'Arrears / back-pay adjustment', 'FIXED', 75, { recurring: false }),
  { ...deduction('OVERPAYMENT_RECOVERY', 'Overpayment recovery', 5), recurring: false },
  deduction('LOAN', 'Loan repayment', 10),
  deduction('ADVANCE', 'Salary advance recovery', 20),
  deduction('SACCO', 'SACCO contribution', 30),
  deduction('WELFARE', 'Welfare contribution', 40),
];

const PAY_GROUPS: { name: string; frequency: PayFrequency }[] = [
  { name: 'Monthly Staff', frequency: 'MONTHLY' },
  { name: 'Casual Workers', frequency: 'WEEKLY' },
];

// TODO-confirm: bank codes are placeholders. Replace them with the codes your banks use in
// payment files (e.g. Bank of Uganda / UBA sort codes) before generating bank exports.
const BANKS: { name: string; code: string; kind?: InstitutionType }[] = [
  { name: 'Stanbic Bank Uganda', code: 'STANBIC' },
  { name: 'Centenary Bank', code: 'CENTENARY' },
  { name: 'Absa Bank Uganda', code: 'ABSA' },
  { name: 'dfcu Bank', code: 'DFCU' },
  { name: 'Equity Bank Uganda', code: 'EQUITY' },
  { name: 'Standard Chartered Bank Uganda', code: 'SCB' },
  { name: 'Bank of Africa Uganda', code: 'BOA' },
  { name: 'Housing Finance Bank', code: 'HFB' },
  { name: 'KCB Bank Uganda', code: 'KCB' },
  { name: 'PostBank Uganda', code: 'POSTBANK' },
  // Mobile money providers: the employee's "account number" is the wallet phone number (2567XXXXXXXX).
  { name: 'MTN Mobile Money', code: 'MTNMOMO', kind: 'MOBILE_MONEY' },
  { name: 'Airtel Money', code: 'AIRTELMONEY', kind: 'MOBILE_MONEY' },
];

const DEPARTMENTS: string[] = ['Administration', 'Finance', 'Operations', 'Sales', 'HR'];

const SETTINGS: { key: string; value: Prisma.InputJsonValue }[] = [
  { key: 'minNetPayBp', value: 0 },
  { key: 'prorationBasis', value: 'CALENDAR_DAYS' },
  { key: 'company.name', value: 'Magezi Harvest Limited' },
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
    if (existing) {
      // Role descriptions are documentation, not admin data: keep them in step with the spec.
      if (existing.description !== r.description || existing.name !== r.name) {
        await tx.role.update({
          where: { id: existing.id },
          data: { name: r.name, description: r.description },
        });
        await withAudit(tx, {
          actorId: null,
          action: 'SEED_UPDATE',
          entity: 'Role',
          entityId: existing.id,
          before: { name: existing.name, description: existing.description },
          after: { name: r.name, description: r.description },
        });
      }
      continue;
    }
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

async function seedBanks(tx: Tx) {
  for (const b of BANKS) {
    const exists = await tx.bank.findFirst({
      where: { OR: [{ name: b.name }, { code: b.code }] },
      select: { id: true },
    });
    if (exists) continue;
    const bank = await tx.bank.create({ data: b });
    await withAudit(tx, {
      actorId: null,
      action: 'SEED_CREATE',
      entity: 'Bank',
      entityId: bank.id,
      after: b,
    });
  }
}

async function seedDepartments(tx: Tx) {
  for (const name of DEPARTMENTS) {
    if (await tx.department.findUnique({ where: { name } })) continue;
    const dep = await tx.department.create({ data: { name } });
    await withAudit(tx, {
      actorId: null,
      action: 'SEED_CREATE',
      entity: 'Department',
      entityId: dep.id,
      after: { name },
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
      await seedBanks(tx);
      await seedDepartments(tx);
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
