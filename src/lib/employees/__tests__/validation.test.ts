import { describe, expect, it } from 'vitest';
import {
  bankAccountSchema,
  bpToPercent,
  componentValueFor,
  dateToIso,
  employeeFormSchema,
  employeeFormValues,
  formatUgPhone,
  isIsoDate,
  isoToDate,
  maskAccount,
  maskNin,
  normalisePaymentAccount,
  normaliseUgPhone,
  parseFlag,
  parseUgxInput,
  percentToBp,
  rangesOverlap,
} from '../validation';

const base = {
  staffNo: 'emp-001',
  firstName: 'Jane',
  lastName: 'Namubiru',
  workerType: 'PERMANENT',
  payGroupId: 'pg1',
  hireDate: '2026-01-15',
  residency: 'RESIDENT',
  payeApplicable: 'yes',
  nssfApplicable: 'yes',
  lstApplicable: 'no',
};

describe('dates', () => {
  it('accepts real calendar dates only', () => {
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('26-01-01')).toBe(false);
  });
  it('round-trips through UTC midnight', () => {
    expect(isoToDate('2026-11-30').toISOString()).toBe('2026-11-30T00:00:00.000Z');
    expect(dateToIso(isoToDate('2026-11-30'))).toBe('2026-11-30');
    expect(() => isoToDate('nope')).toThrow();
  });
});

describe('employeeFormSchema', () => {
  it('normalises staff number and ids', () => {
    const r = employeeFormSchema.parse({
      ...base,
      tin: '100 012 3456',
      nssfNo: 'ns-123456',
      nin: 'cf90012345abcd',
      otherNames: '',
    });
    expect(r.staffNo).toBe('EMP-001');
    expect(r.tin).toBe('1000123456');
    expect(r.nssfNo).toBe('NS123456');
    expect(r.nin).toBe('CF90012345ABCD');
    expect(r.otherNames).toBeUndefined();
    expect(r.lstApplicable).toBe(false);
  });

  it.each([
    ['tin', '12345', 'TIN must be exactly 10 digits'],
    ['nin', 'CF123', 'NIN must be 14 letters or digits'],
    ['nssfNo', '12', 'NSSF number must be 6–20 letters or digits'],
    ['hireDate', '2026-02-30', 'Enter a valid date (yyyy-mm-dd)'],
    ['staffNo', 'A B', 'Staff number may use letters, digits, / _ and -'],
  ])('rejects bad %s', (field, value, message) => {
    const r = employeeFormSchema.safeParse({ ...base, [field]: value });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe(message);
  });

  it('rejects unrecognised flag words', () => {
    const r = employeeFormSchema.safeParse({ ...base, payeApplicable: 'maybe' });
    expect(r.success).toBe(false);
  });

  it('reads unchecked checkboxes as "no"', () => {
    const fd = new FormData();
    fd.set('staffNo', 'X1');
    fd.set('payeApplicable', 'on');
    const v = employeeFormValues(fd);
    expect(v).toMatchObject({
      staffNo: 'X1',
      payeApplicable: 'yes',
      nssfApplicable: 'no',
      lstApplicable: 'no',
    });
  });
});

describe('masks', () => {
  it('masks NIN and account numbers', () => {
    expect(maskNin('CF90012345ABCD')).toBe('CF••••••••ABCD');
    expect(maskNin('ABC')).toBe('•••');
    expect(maskAccount('5678')).toBe('••••5678');
  });
});

describe('parseFlag', () => {
  it('handles words, blanks and junk', () => {
    expect(parseFlag('Yes', false)).toBe(true);
    expect(parseFlag('0', true)).toBe(false);
    expect(parseFlag('', true)).toBe(true);
    expect(parseFlag(undefined, false)).toBe(false);
    expect(parseFlag('perhaps', true)).toBeNull();
  });
});

describe('money input', () => {
  it('parses whole shillings with commas and UGX prefix', () => {
    expect(parseUgxInput('1,500,000')).toBe(1_500_000);
    expect(parseUgxInput('UGX 250 000')).toBe(250_000);
    expect(parseUgxInput('12.5')).toBeNull();
    expect(parseUgxInput('-5')).toBeNull();
    expect(parseUgxInput('99999999999999999999')).toBeNull();
    expect(parseUgxInput(null)).toBeNull();
  });
  it('converts percent to basis points and back', () => {
    expect(percentToBp('12.5')).toBe(1250);
    expect(percentToBp('10%')).toBe(1000);
    expect(percentToBp('0.05')).toBe(5);
    expect(percentToBp('100')).toBe(10_000);
    expect(percentToBp('100.01')).toBeNull();
    expect(percentToBp('1.234')).toBeNull();
    expect(percentToBp(undefined)).toBeNull();
    expect(bpToPercent(1250)).toBe('12.5');
    expect(bpToPercent(1000)).toBe('10');
    expect(bpToPercent(5)).toBe('0.05');
  });
});

describe('componentValueFor', () => {
  it('maps the single value by calc type', () => {
    expect(componentValueFor('FIXED', '200,000')).toEqual({
      ok: true,
      value: { amount: 200_000, rateBp: null, ratePerUnit: null },
    });
    expect(componentValueFor('PERCENT_OF_BASIC', '15')).toEqual({
      ok: true,
      value: { amount: null, rateBp: 1500, ratePerUnit: null },
    });
    expect(componentValueFor('RATE_X_QTY', '15000')).toEqual({
      ok: true,
      value: { amount: null, rateBp: null, ratePerUnit: 15_000 },
    });
  });
  it('reports bad values', () => {
    expect(componentValueFor('FIXED', 'abc').ok).toBe(false);
    expect(componentValueFor('PERCENT_OF_BASIC', '150').ok).toBe(false);
    expect(componentValueFor('RATE_X_QTY', '1.5').ok).toBe(false);
  });
});

describe('rangesOverlap', () => {
  const r = (from: string, to: string | null) => ({ from, to });
  it('detects overlaps including open-ended ranges', () => {
    expect(rangesOverlap(r('2026-01-01', '2026-06-30'), r('2026-06-30', null))).toBe(true);
    expect(rangesOverlap(r('2026-01-01', null), r('2027-01-01', null))).toBe(true);
    expect(rangesOverlap(r('2026-01-01', '2026-06-29'), r('2026-06-30', null))).toBe(false);
    expect(rangesOverlap(r('2026-07-01', null), r('2026-01-01', '2026-06-30'))).toBe(false);
  });
});

describe('bankAccountSchema', () => {
  it('requires an institution and a number', () => {
    const r = bankAccountSchema.safeParse({
      employeeId: 'e',
      bankId: '',
      accountNo: '',
      accountName: 'Jane',
      effectiveFrom: '2026-01-01',
    });
    expect(r.success).toBe(false);
  });
});

describe('normaliseUgPhone', () => {
  it.each([
    ['0772 445 566', '256772445566'],
    ['772445566', '256772445566'],
    ['+256 772-445-566', '256772445566'],
    ['256772445566', '256772445566'],
    ['00256752123456', '256752123456'],
  ])('%s → %s', (raw, out) => {
    expect(normaliseUgPhone(raw)).toBe(out);
  });
  it.each(['12345', '0772 44556', '+254722000000', 'abc'])('rejects %s', (raw) => {
    expect(normaliseUgPhone(raw)).toBeNull();
  });
  it('formats for display', () => {
    expect(formatUgPhone('256772445566')).toBe('+256 772 445 566');
  });
});

describe('normalisePaymentAccount', () => {
  const bank = { kind: 'BANK' as const, code: 'STANBIC' };
  const mtn = { kind: 'MOBILE_MONEY' as const, code: 'MTNMOMO' };
  const airtel = { kind: 'MOBILE_MONEY' as const, code: 'AIRTELMONEY' };

  it('strips spaces from bank account numbers', () => {
    expect(normalisePaymentAccount(bank, '9030 0123 4567')).toEqual({
      ok: true,
      accountNo: '903001234567',
    });
  });
  it('rejects non-digit bank account numbers', () => {
    expect(normalisePaymentAccount(bank, 'ABC123').ok).toBe(false);
  });
  it('normalises an MTN wallet', () => {
    expect(normalisePaymentAccount(mtn, '0772 445566')).toEqual({
      ok: true,
      accountNo: '256772445566',
    });
  });
  it('rejects an Airtel number for MTN and vice versa', () => {
    expect(normalisePaymentAccount(mtn, '0752123456').ok).toBe(false);
    expect(normalisePaymentAccount(airtel, '0772445566').ok).toBe(false);
    expect(normalisePaymentAccount(airtel, '0752123456')).toEqual({
      ok: true,
      accountNo: '256752123456',
    });
  });
  it('accepts any Ugandan number for an unknown provider', () => {
    expect(normalisePaymentAccount({ kind: 'MOBILE_MONEY', code: 'OTHER' }, '0712000111')).toEqual({
      ok: true,
      accountNo: '256712000111',
    });
  });
  it('rejects a non-phone wallet', () => {
    expect(normalisePaymentAccount(mtn, '9030012345678').ok).toBe(false);
  });
});

describe('employee contact fields', () => {
  it('normalises email and phone, and allows them blank', () => {
    const ok = employeeFormSchema.parse({
      ...base,
      email: ' Jane@Example.com ',
      phone: '0772445566',
    });
    expect(ok.email).toBe('jane@example.com');
    expect(ok.phone).toBe('256772445566');
    const blank = employeeFormSchema.parse({ ...base, email: '', phone: '' });
    expect(blank.email).toBeUndefined();
    expect(blank.phone).toBeUndefined();
  });
  it('rejects invalid email and phone', () => {
    const r = employeeFormSchema.safeParse({ ...base, email: 'nope', phone: '123' });
    expect(r.success).toBe(false);
    const paths = r.success ? [] : r.error.issues.map((i) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(['email', 'phone']));
  });
});
