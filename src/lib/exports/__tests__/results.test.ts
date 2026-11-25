import { describe, expect, it } from 'vitest';
import { planPayments, type PayeeInput } from '../group';
import {
  latestResults,
  normaliseAccount,
  normaliseStatus,
  parseResultsFile,
  summariseResults,
  type ResultPayee,
} from '../results';
import {
  AIRTEL_MONEY_TEMPLATE,
  DEFAULT_TEMPLATE,
  defaultTemplateFor,
  MOBILE_MONEY_TEMPLATE,
  MTN_MOMO_TEMPLATE,
} from '../template';

const payees: ResultPayee[] = [
  {
    runEmployeeId: 're1',
    staffNo: 'S1',
    name: 'Grace N',
    accountNo: '9030012345671',
    net: 3_751_750,
  },
  {
    runEmployeeId: 're2',
    staffNo: 'S2',
    name: 'Esther N',
    accountNo: '256772445566',
    net: 150_000,
  },
  {
    runEmployeeId: 're3',
    staffNo: 'S3',
    name: 'Moses K',
    accountNo: '2200011122233',
    net: 120_000,
  },
];

describe('normalising bank result values', () => {
  it('maps common status words', () => {
    expect(normaliseStatus('Success')).toBe('PAID');
    expect(normaliseStatus('COMPLETED')).toBe('PAID');
    expect(normaliseStatus('rejected')).toBe('FAILED');
    expect(normaliseStatus('in_progress')).toBe('PENDING');
    expect(normaliseStatus('maybe')).toBeNull();
    expect(normaliseStatus('')).toBeNull();
  });
  it('treats 07… and 2567… mobile numbers alike', () => {
    expect(normaliseAccount('0772 445 566')).toBe('256772445566');
    expect(normaliseAccount('+256-772-445566')).toBe('256772445566');
    expect(normaliseAccount('9030012345671')).toBe('9030012345671');
  });
});

describe('parseResultsFile', () => {
  it('matches by staff number or account/phone, checks amounts and keeps reference and reason', () => {
    const csv = [
      'Staff No,Account Number,Amount,Status,Reference,Reason',
      'S1,,3751750.00,SUCCESS,TX1,',
      ',0772445566,"150,000",FAILED,TX2,Wallet not registered',
      'TOTAL,,3901750,,,',
    ].join('\n');
    const r = parseResultsFile(csv, payees);
    expect(r.fileErrors).toEqual([]);
    expect(r.errorCount).toBe(1); // the TOTAL row matches nobody
    const [a, b] = r.rows;
    expect(a).toMatchObject({
      runEmployeeId: 're1',
      status: 'PAID',
      amount: 3_751_750,
      reference: 'TX1',
    });
    expect(b).toMatchObject({
      runEmployeeId: 're2',
      status: 'FAILED',
      reason: 'Wallet not registered',
    });
    expect(r.unmatchedPayees.map((p) => p.staffNo)).toEqual(['S3']);
  });
  it('skips blank summary lines and flags wrong amounts, duplicates and unknown statuses', () => {
    const csv = [
      'msisdn,amount,status',
      '256772445566,150001,SUCCESS',
      '256772445566,150000,SUCCESS',
      '2200011122233,120000,WHO_KNOWS',
      ',,',
    ].join('\n');
    const r = parseResultsFile(csv, payees);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]!.errors.join()).toMatch(/does not match net pay/);
    expect(r.rows[1]!.errors.join()).toMatch(/more than once/);
    expect(r.rows[2]!.errors.join()).toMatch(/Unrecognised status/);
  });
  it('reports missing columns', () => {
    const r = parseResultsFile('name,amount\nA,1\n', payees);
    expect(r.fileErrors.join(' ')).toMatch(/staff number column/);
    expect(r.fileErrors.join(' ')).toMatch(/status column/);
  });
});

describe('latest results and summary', () => {
  it('lets a later re-issue result replace an earlier failure', () => {
    const latest = latestResults([
      { runEmployeeId: 're2', status: 'FAILED', uploadedAt: new Date('2026-12-01') },
      { runEmployeeId: 're2', status: 'PAID', uploadedAt: new Date('2026-12-03') },
      { runEmployeeId: 're1', status: 'PAID', uploadedAt: new Date('2026-12-01') },
      { runEmployeeId: 're4', status: 'PENDING', uploadedAt: new Date('2026-12-01') },
    ]);
    expect(latest.get('re2')!.status).toBe('PAID');
    expect(summariseResults(['re1', 're2', 're3', 're4'], latest)).toEqual({
      paid: 2,
      failed: 0,
      pending: 1,
      noResult: 1,
      failedIds: [],
    });
  });
});

describe('mobile money templates and grouping', () => {
  it('picks the provider layout for mobile money and the generic one for banks', () => {
    expect(defaultTemplateFor({ code: 'MTNMOMO', kind: 'MOBILE_MONEY' })).toBe(MTN_MOMO_TEMPLATE);
    expect(defaultTemplateFor({ code: 'AIRTELMONEY', kind: 'MOBILE_MONEY' })).toBe(
      AIRTEL_MONEY_TEMPLATE,
    );
    expect(defaultTemplateFor({ code: 'OTHER', kind: 'MOBILE_MONEY' })).toBe(MOBILE_MONEY_TEMPLATE);
    expect(defaultTemplateFor({ code: 'SBIC', kind: 'BANK' })).toBe(DEFAULT_TEMPLATE);
    expect(MTN_MOMO_TEMPLATE.mapping.columns[0]).toMatchObject({
      field: 'accountNo',
      header: 'MSISDN',
    });
    expect(MTN_MOMO_TEMPLATE.footerRules.rows).toEqual([]);
  });
  it('lists banks before mobile money providers', () => {
    const p = (
      staffNo: string,
      bankId: string,
      bankName: string,
      kind: 'BANK' | 'MOBILE_MONEY',
    ): PayeeInput => ({
      employeeId: staffNo,
      staffNo,
      employeeName: staffNo,
      net: 100,
      account: {
        bankId,
        bankName,
        bankCode: bankId,
        bankKind: kind,
        branchCode: null,
        accountName: staffNo,
        accountNoEnc: 'x',
        accountNoLast4: '0000',
      },
    });
    const plan = planPayments([
      p('A', 'mtn', 'MTN Mobile Money', 'MOBILE_MONEY'),
      p('B', 'abs', 'Absa', 'BANK'),
      p('C', 'air', 'Airtel Money', 'MOBILE_MONEY'),
      p('D', 'sbc', 'Stanbic', 'BANK'),
    ]);
    expect(plan.groups.map((g) => `${g.kind}:${g.bankName}`)).toEqual([
      'BANK:Absa',
      'BANK:Stanbic',
      'MOBILE_MONEY:Airtel Money',
      'MOBILE_MONEY:MTN Mobile Money',
    ]);
  });
});
