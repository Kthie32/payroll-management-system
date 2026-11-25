/**
 * Which parts of an employee record a user may see or change, derived from their roles.
 * Pure (no DB), so pages, server actions and tests share one source of truth.
 *
 * Spec: "Each user has a level of access depending on the information and the role."
 * - Money (pay components, payroll history, loan amounts) needs pay.view; the System Admin
 *   manages the system but never sees pay.
 * - Profile and payment details are edited by HR only (employees.edit); pay structure by pay.edit.
 * - Full account / wallet numbers are revealed only with bank.reveal, and every reveal is audited.
 */
import type { RoleCode } from '@prisma/client';
import { can } from '@/lib/rbac/core';

export type EmployeeSection = 'profile' | 'payment' | 'components' | 'loans' | 'history';

export interface EmployeeAccess {
  /** Sections the user may open, in display order. */
  sections: EmployeeSection[];
  canEditProfile: boolean;
  canEditPayment: boolean;
  canEditPay: boolean;
  canRevealAccount: boolean;
  /** True when money figures (salaries, net pay, loan balances) may be shown. */
  canSeePay: boolean;
}

export function employeeAccess(roles: readonly RoleCode[]): EmployeeAccess {
  const view = can(roles, 'employees.view');
  const canSeePay = view && can(roles, 'pay.view');
  const sections: EmployeeSection[] = [];
  if (view) sections.push('profile', 'payment');
  if (canSeePay) sections.push('components');
  if (canSeePay && can(roles, 'loans.view')) sections.push('loans');
  if (canSeePay && can(roles, 'payroll.view')) sections.push('history');
  return {
    sections,
    canEditProfile: can(roles, 'employees.edit'),
    canEditPayment: can(roles, 'employees.edit'),
    canEditPay: can(roles, 'pay.edit'),
    canRevealAccount: can(roles, 'bank.reveal'),
    canSeePay,
  };
}

/** The section to show for a requested tab: falls back to the profile when not allowed. */
export function resolveSection(
  requested: string | undefined,
  access: EmployeeAccess,
): EmployeeSection {
  const r = (requested ?? 'profile') as EmployeeSection;
  return access.sections.includes(r) ? r : 'profile';
}
