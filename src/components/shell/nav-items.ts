import type { RoleCode } from '@prisma/client';
import { can } from '@/lib/rbac/core';
import type { Permission } from '@/lib/rbac/permissions';

export type NavIcon =
  | 'dashboard'
  | 'employees'
  | 'payroll'
  | 'exports'
  | 'reports'
  | 'loans'
  | 'settings'
  | 'banks'
  | 'messages'
  | 'users'
  | 'audit';

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  /** Shown when the user holds this permission… */
  permission: Permission;
  /** …or any of these (optional). */
  anyOf?: readonly Permission[];
}

/** Sidebar entries; each is shown only if the user holds `permission` (or one of `anyOf`). */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: 'dashboard', permission: 'dashboard.view' },
  { href: '/employees', label: 'Employees', icon: 'employees', permission: 'employees.view' },
  { href: '/payroll', label: 'Payroll', icon: 'payroll', permission: 'payroll.view' },
  { href: '/exports', label: 'Exports', icon: 'exports', permission: 'exports.view' },
  { href: '/reports', label: 'Reports', icon: 'reports', permission: 'reports.view' },
  { href: '/loans', label: 'Loans', icon: 'loans', permission: 'loans.view' },
  { href: '/settings', label: 'Settings', icon: 'settings', permission: 'settings.view' },
  { href: '/admin/banks', label: 'Banks', icon: 'banks', permission: 'banks.manage' },
  {
    href: '/admin/messages',
    label: 'Messages',
    icon: 'messages',
    permission: 'payslips.generate',
    anyOf: ['users.manage'],
  },
  { href: '/admin/users', label: 'Users', icon: 'users', permission: 'users.view' },
  { href: '/audit', label: 'Audit', icon: 'audit', permission: 'audit.view' },
];

/** True when the item should be shown to a user with these roles. */
export function navItemVisible(roles: readonly RoleCode[], item: NavItem): boolean {
  return can(roles, item.permission) || (item.anyOf ?? []).some((p) => can(roles, p));
}

/** The sidebar entries for a user. Prefer this over filtering on `permission` alone. */
export function navItemsFor(roles: readonly RoleCode[]): NavItem[] {
  return NAV_ITEMS.filter((i) => navItemVisible(roles, i));
}
