import { describe, expect, it } from 'vitest';
import { type NavItem, navItemsFor, navItemVisible } from '../nav-items';

const hrefs = (roles: Parameters<typeof navItemsFor>[0]) => navItemsFor(roles).map((i) => i.href);

describe('navItemsFor', () => {
  it('System Admin: users, banks, settings, audit, employees — no payroll, exports or loans', () => {
    const h = hrefs(['SYSTEM_ADMIN']);
    expect(h).toEqual(
      expect.arrayContaining(['/admin/users', '/admin/banks', '/settings', '/audit', '/employees']),
    );
    expect(h).not.toEqual(expect.arrayContaining(['/payroll']));
    expect(h).not.toContain('/exports');
    expect(h).not.toContain('/loans');
  });

  it('Finance Approver sees exports; Payroll Officer does not', () => {
    expect(hrefs(['FINANCE_APPROVER'])).toContain('/exports');
    expect(hrefs(['PAYROLL_OFFICER'])).not.toContain('/exports');
  });

  it('Auditor sees users (read-only) and audit, but not bank management', () => {
    const h = hrefs(['AUDITOR']);
    expect(h).toContain('/admin/users');
    expect(h).toContain('/audit');
    expect(h).not.toContain('/admin/banks');
  });

  it('anyOf shows an item for any listed permission', () => {
    const item: NavItem = {
      href: '/x',
      label: 'X',
      icon: 'messages',
      permission: 'payslips.generate',
      anyOf: ['users.manage'],
    };
    expect(navItemVisible(['PAYROLL_OFFICER'], item)).toBe(true);
    expect(navItemVisible(['SYSTEM_ADMIN'], item)).toBe(true);
    expect(navItemVisible(['AUDITOR'], item)).toBe(false);
  });
});
