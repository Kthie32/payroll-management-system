import type { RoleCode } from '@prisma/client';

export const ROLE_CODES = [
  'SYSTEM_ADMIN',
  'HR_OFFICER',
  'PAYROLL_OFFICER',
  'FINANCE_APPROVER',
  'AUDITOR',
] as const satisfies readonly RoleCode[];

export const PERMISSIONS = [
  'dashboard.view',
  'users.manage',
  'users.view',
  'settings.view',
  'settings.edit',
  'rules.edit',
  'rules.approve',
  'banks.manage',
  'templates.manage',
  'employees.view',
  'employees.edit',
  'pay.view',
  'pay.edit',
  'bank.reveal',
  'payroll.view',
  'payroll.inputs',
  'payroll.prepare',
  'payroll.approve',
  'payslips.view',
  'payslips.generate',
  'exports.view',
  'exports.generate',
  'payroll.markPaid',
  'payments.upload',
  'loans.view',
  'loans.edit',
  'reports.view',
  'audit.view',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Role → permissions. Must match the roles table in CLAUDE.md (Magezi Harvest Limited spec).
 * - pay.view: salary amounts, payslips and run figures. pay.edit: an employee's pay structure.
 * - bank.reveal: see full bank / mobile money account numbers.
 * - payroll.inputs: enter variable inputs; payroll.prepare: create, import, compute, submit runs.
 * The per-run rule "the preparer never approves" is enforced separately in the payroll workflow.
 */
export const ROLE_PERMISSIONS: Record<RoleCode, readonly Permission[]> = {
  SYSTEM_ADMIN: [
    'dashboard.view',
    'users.manage',
    'users.view',
    'settings.view',
    'settings.edit',
    'rules.edit',
    'banks.manage',
    'templates.manage',
    'employees.view',
    'audit.view',
  ],
  HR_OFFICER: [
    'dashboard.view',
    'employees.view',
    'employees.edit',
    'pay.view',
    'pay.edit',
    'bank.reveal',
    'payroll.view',
    'payroll.inputs',
    'payslips.view',
    'loans.view',
    'loans.edit',
    'reports.view',
  ],
  PAYROLL_OFFICER: [
    'dashboard.view',
    'settings.view',
    'employees.view',
    'pay.view',
    'payroll.view',
    'payroll.inputs',
    'payroll.prepare',
    'payslips.view',
    'payslips.generate',
    'loans.view',
    'loans.edit',
    'reports.view',
  ],
  FINANCE_APPROVER: [
    'dashboard.view',
    'settings.view',
    'rules.approve',
    'employees.view',
    'pay.view',
    'bank.reveal',
    'payroll.view',
    'payroll.approve',
    'payslips.view',
    'exports.view',
    'exports.generate',
    'payroll.markPaid',
    'payments.upload',
    'loans.view',
    'reports.view',
  ],
  AUDITOR: [
    'dashboard.view',
    'users.view',
    'settings.view',
    'employees.view',
    'pay.view',
    'payroll.view',
    'payslips.view',
    'exports.view',
    'loans.view',
    'reports.view',
    'audit.view',
  ],
};

/** Roles that must enrol and verify TOTP before using the app (CLAUDE.md rule 9). */
export const ROLES_REQUIRING_2FA: readonly RoleCode[] = ['SYSTEM_ADMIN', 'FINANCE_APPROVER'];

export const ROLE_LABELS: Record<RoleCode, string> = {
  SYSTEM_ADMIN: 'System Admin',
  HR_OFFICER: 'HR Officer',
  PAYROLL_OFFICER: 'Payroll Officer',
  FINANCE_APPROVER: 'Finance Approver',
  AUDITOR: 'Auditor',
};
