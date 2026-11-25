import { describe, expect, it } from 'vitest';
import { can, ForbiddenError, permissionsFor, requires2fa } from '../core';
import { PERMISSIONS, ROLE_CODES, ROLE_PERMISSIONS } from '../permissions';

describe('role → permission map (must match CLAUDE.md)', () => {
  it('matches the agreed table', () => {
    expect(ROLE_PERMISSIONS).toMatchInlineSnapshot(`
      {
        "AUDITOR": [
          "dashboard.view",
          "users.view",
          "settings.view",
          "employees.view",
          "pay.view",
          "payroll.view",
          "payslips.view",
          "exports.view",
          "loans.view",
          "reports.view",
          "audit.view",
        ],
        "FINANCE_APPROVER": [
          "dashboard.view",
          "settings.view",
          "rules.approve",
          "employees.view",
          "pay.view",
          "bank.reveal",
          "payroll.view",
          "payroll.approve",
          "payslips.view",
          "exports.view",
          "exports.generate",
          "payroll.markPaid",
          "payments.upload",
          "loans.view",
          "reports.view",
        ],
        "HR_OFFICER": [
          "dashboard.view",
          "employees.view",
          "employees.edit",
          "pay.view",
          "pay.edit",
          "bank.reveal",
          "payroll.view",
          "payroll.inputs",
          "payslips.view",
          "loans.view",
          "loans.edit",
          "reports.view",
        ],
        "PAYROLL_OFFICER": [
          "dashboard.view",
          "settings.view",
          "employees.view",
          "pay.view",
          "payroll.view",
          "payroll.inputs",
          "payroll.prepare",
          "payslips.view",
          "payslips.generate",
          "loans.view",
          "loans.edit",
          "reports.view",
        ],
        "SYSTEM_ADMIN": [
          "dashboard.view",
          "users.manage",
          "users.view",
          "settings.view",
          "settings.edit",
          "rules.edit",
          "banks.manage",
          "templates.manage",
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

  // Magezi Harvest Limited spec: "Cannot do" column of the roles table.
  it('System Admin cannot touch pay or runs', () => {
    for (const p of [
      'pay.view',
      'pay.edit',
      'payroll.inputs',
      'payroll.prepare',
      'payroll.approve',
      'exports.generate',
    ] as const) {
      expect(can(['SYSTEM_ADMIN'], p)).toBe(false);
    }
    for (const p of [
      'users.manage',
      'banks.manage',
      'templates.manage',
      'settings.edit',
    ] as const) {
      expect(can(['SYSTEM_ADMIN'], p)).toBe(true);
    }
  });

  it('HR Officer cannot approve runs or export bank files', () => {
    expect(can(['HR_OFFICER'], 'payroll.approve')).toBe(false);
    expect(can(['HR_OFFICER'], 'exports.generate')).toBe(false);
    expect(can(['HR_OFFICER'], 'payroll.inputs')).toBe(true);
    expect(can(['HR_OFFICER'], 'pay.edit')).toBe(true);
  });

  it('Payroll Officer prepares and generates payslips but cannot export or mark paid', () => {
    expect(can(['PAYROLL_OFFICER'], 'payroll.prepare')).toBe(true);
    expect(can(['PAYROLL_OFFICER'], 'payslips.generate')).toBe(true);
    expect(can(['PAYROLL_OFFICER'], 'exports.generate')).toBe(false);
    expect(can(['PAYROLL_OFFICER'], 'payroll.markPaid')).toBe(false);
  });

  it('Finance Approver approves, exports, marks paid and uploads results, but edits no employee data or inputs', () => {
    for (const p of [
      'payroll.approve',
      'exports.generate',
      'payroll.markPaid',
      'payments.upload',
    ] as const) {
      expect(can(['FINANCE_APPROVER'], p)).toBe(true);
    }
    for (const p of ['employees.edit', 'pay.edit', 'payroll.inputs'] as const) {
      expect(can(['FINANCE_APPROVER'], p)).toBe(false);
    }
  });

  it('Auditor reads everything and changes nothing', () => {
    const perms = ROLE_PERMISSIONS.AUDITOR;
    for (const p of perms) expect(p.endsWith('.view')).toBe(true);
    for (const p of PERMISSIONS.filter((x) => x.endsWith('.view'))) expect(perms).toContain(p);
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
