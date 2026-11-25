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
  'settings.view',
  'settings.edit',
  'rules.edit',
  'rules.approve',
  'employees.view',
  'employees.edit',
  'payroll.view',
  'payroll.prepare',
  'payroll.approve',
  'payroll.export',
  'payroll.markPaid',
  'loans.view',
  'loans.edit',
  'reports.view',
  'audit.view',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Role → permissions. Must match the roles table in CLAUDE.md. */
export const ROLE_PERMISSIONS: Record<RoleCode, readonly Permission[]> = {
  SYSTEM_ADMIN: [
    'dashboard.view',
    'users.manage',
    'settings.view',
    'settings.edit',
    'rules.edit',
    'employees.view',
    'audit.view',
  ],
  HR_OFFICER: [
    'dashboard.view',
    'employees.view',
    'employees.edit',
    'payroll.view',
    'loans.view',
    'loans.edit',
    'reports.view',
  ],
  PAYROLL_OFFICER: [
    'dashboard.view',
    'employees.view',
    'payroll.view',
    'payroll.prepare',
    'payroll.export',
    'payroll.markPaid',
    'loans.view',
    'loans.edit',
    'reports.view',
  ],
  FINANCE_APPROVER: [
    'dashboard.view',
    'settings.view',
    'rules.approve',
    'employees.view',
    'payroll.view',
    'payroll.approve',
    'payroll.export',
    'payroll.markPaid',
    'loans.view',
    'reports.view',
  ],
  AUDITOR: [
    'dashboard.view',
    'settings.view',
    'employees.view',
    'payroll.view',
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
