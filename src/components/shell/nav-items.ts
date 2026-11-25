import type { Permission } from '@/lib/rbac/permissions';

export type NavIcon =
  | 'dashboard'
  | 'employees'
  | 'payroll'
  | 'exports'
  | 'reports'
  | 'loans'
  | 'settings'
  | 'users'
  | 'audit';

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  permission: Permission;
}

/** Sidebar entries; each is shown only if the user holds `permission`. */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: 'dashboard', permission: 'dashboard.view' },
  { href: '/employees', label: 'Employees', icon: 'employees', permission: 'employees.view' },
  { href: '/payroll', label: 'Payroll', icon: 'payroll', permission: 'payroll.view' },
  { href: '/exports', label: 'Exports', icon: 'exports', permission: 'payroll.export' },
  { href: '/reports', label: 'Reports', icon: 'reports', permission: 'reports.view' },
  { href: '/loans', label: 'Loans', icon: 'loans', permission: 'loans.view' },
  { href: '/settings', label: 'Settings', icon: 'settings', permission: 'settings.view' },
  { href: '/admin/users', label: 'Users', icon: 'users', permission: 'users.manage' },
  { href: '/audit', label: 'Audit', icon: 'audit', permission: 'audit.view' },
];
