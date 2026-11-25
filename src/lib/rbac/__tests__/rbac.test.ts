import { describe, expect, it } from 'vitest';
import { can, ForbiddenError, permissionsFor, requires2fa } from '../core';
import { PERMISSIONS, ROLE_CODES, ROLE_PERMISSIONS } from '../permissions';

describe('role → permission map (must match CLAUDE.md)', () => {
  it('matches the agreed table', () => {
    expect(ROLE_PERMISSIONS).toMatchInlineSnapshot(`
      {
        "AUDITOR": [
          "dashboard.view",
          "settings.view",
          "employees.view",
          "payroll.view",
          "loans.view",
          "reports.view",
          "audit.view",
        ],
        "FINANCE_APPROVER": [
          "dashboard.view",
          "settings.view",
          "rules.approve",
          "employees.view",
          "payroll.view",
          "payroll.approve",
          "payroll.export",
          "payroll.markPaid",
          "loans.view",
          "reports.view",
        ],
        "HR_OFFICER": [
          "dashboard.view",
          "employees.view",
          "employees.edit",
          "payroll.view",
          "loans.view",
          "loans.edit",
          "reports.view",
        ],
        "PAYROLL_OFFICER": [
          "dashboard.view",
          "employees.view",
          "payroll.view",
          "payroll.prepare",
          "payroll.export",
          "payroll.markPaid",
          "loans.view",
          "loans.edit",
          "reports.view",
        ],
        "SYSTEM_ADMIN": [
          "dashboard.view",
          "users.manage",
          "settings.view",
          "settings.edit",
          "rules.edit",
          "employees.view",
          "audit.view",
        ],
      }
    `);
  });

  it('every role has a valid, duplicate-free permission list', () => {
    for (const role of ROLE_CODES) {
      const perms = ROLE_PERMISSIONS[role];
      expect(new Set(perms).size).toBe(perms.length);
      for (const p of perms) expect(PERMISSIONS).toContain(p);
    }
  });

  it('only SYSTEM_ADMIN manages users; only SYSTEM_ADMIN and AUDITOR see audit', () => {
    for (const role of ROLE_CODES) {
      expect(can([role], 'users.manage')).toBe(role === 'SYSTEM_ADMIN');
      expect(can([role], 'audit.view')).toBe(role === 'SYSTEM_ADMIN' || role === 'AUDITOR');
    }
  });

  it('separation: preparer cannot approve and approver cannot prepare', () => {
    expect(can(['PAYROLL_OFFICER'], 'payroll.approve')).toBe(false);
    expect(can(['FINANCE_APPROVER'], 'payroll.prepare')).toBe(false);
  });
});

describe('can / permissionsFor / requires2fa', () => {
  it('handles empty and missing roles', () => {
    expect(can([], 'dashboard.view')).toBe(false);
    expect(can(undefined, 'dashboard.view')).toBe(false);
    expect(can(null, 'dashboard.view')).toBe(false);
  });

  it('unions permissions across roles', () => {
    expect(can(['HR_OFFICER', 'AUDITOR'], 'audit.view')).toBe(true);
    const perms = permissionsFor(['HR_OFFICER', 'AUDITOR']);
    expect(perms).toContain('employees.edit');
    expect(perms).toContain('audit.view');
    expect(perms).toEqual([...perms].sort());
  });

  it('requires 2FA for SYSTEM_ADMIN and FINANCE_APPROVER only', () => {
    expect(requires2fa(['SYSTEM_ADMIN'])).toBe(true);
    expect(requires2fa(['AUDITOR', 'FINANCE_APPROVER'])).toBe(true);
    expect(requires2fa(['HR_OFFICER', 'PAYROLL_OFFICER', 'AUDITOR'])).toBe(false);
  });

  it('ForbiddenError names the permission', () => {
    const e = new ForbiddenError('users.manage');
    expect(e.message).toContain('users.manage');
    expect(e.name).toBe('ForbiddenError');
  });
});
