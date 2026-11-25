import { describe, expect, it } from 'vitest';
import { employeeAccess, resolveSection } from '../visibility';

describe('employeeAccess', () => {
  it('System Admin sees profile and payment details but no money, and edits nothing', () => {
    const a = employeeAccess(['SYSTEM_ADMIN']);
    expect(a.sections).toEqual(['profile', 'payment']);
    expect(a.canSeePay).toBe(false);
    expect(a.canEditProfile).toBe(false);
    expect(a.canEditPayment).toBe(false);
    expect(a.canEditPay).toBe(false);
    expect(a.canRevealAccount).toBe(false);
  });

  it('HR Officer sees everything and edits profile, payment details and pay structure', () => {
    const a = employeeAccess(['HR_OFFICER']);
    expect(a.sections).toEqual(['profile', 'payment', 'components', 'loans', 'history']);
    expect(a.canEditProfile && a.canEditPayment && a.canEditPay && a.canRevealAccount).toBe(true);
  });

  it('Payroll Officer sees pay but edits nothing on the employee record', () => {
    const a = employeeAccess(['PAYROLL_OFFICER']);
    expect(a.sections).toEqual(['profile', 'payment', 'components', 'loans', 'history']);
    expect(a.canEditProfile || a.canEditPayment || a.canEditPay).toBe(false);
    expect(a.canRevealAccount).toBe(false);
  });

  it('Finance Approver sees pay and may reveal account numbers, but edits nothing', () => {
    const a = employeeAccess(['FINANCE_APPROVER']);
    expect(a.canSeePay).toBe(true);
    expect(a.canRevealAccount).toBe(true);
    expect(a.canEditProfile || a.canEditPayment || a.canEditPay).toBe(false);
  });

  it('Auditor reads everything and changes nothing', () => {
    const a = employeeAccess(['AUDITOR']);
    expect(a.sections).toEqual(['profile', 'payment', 'components', 'loans', 'history']);
    expect(a.canEditProfile || a.canEditPayment || a.canEditPay || a.canRevealAccount).toBe(false);
  });

  it('combines roles: Admin + HR gets the union', () => {
    const a = employeeAccess(['SYSTEM_ADMIN', 'HR_OFFICER']);
    expect(a.canSeePay).toBe(true);
    expect(a.canEditPay).toBe(true);
  });

  it('no roles: nothing', () => {
    const a = employeeAccess([]);
    expect(a.sections).toEqual([]);
    expect(a.canSeePay).toBe(false);
  });
});

describe('resolveSection', () => {
  it('falls back to profile for a section the user may not open', () => {
    const admin = employeeAccess(['SYSTEM_ADMIN']);
    expect(resolveSection('components', admin)).toBe('profile');
    expect(resolveSection('history', admin)).toBe('profile');
    expect(resolveSection('payment', admin)).toBe('payment');
    expect(resolveSection(undefined, admin)).toBe('profile');
    expect(resolveSection('nonsense', admin)).toBe('profile');
  });
  it('allows permitted sections', () => {
    expect(resolveSection('history', employeeAccess(['AUDITOR']))).toBe('history');
  });
});
