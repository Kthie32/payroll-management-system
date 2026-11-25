import { describe, expect, it } from 'vitest';
import { payeMonthly, type PayeParams } from '@/lib/payroll-engine';
import { componentCodeSchema, componentFieldsSchema } from '../components';
import { settingsFromRows } from '../general';
import { parseLstBandsCsv } from '../lst-csv';
import { paramsToRuleForm, ruleFormToParams, type RuleForm } from '../rule-form';

const PAYE_FORM: RuleForm = {
  rule: 'PAYE_RES',
  paye: {
    bands: [
      { from: '0', to: '335,000', rate: '0' },
      { from: '335,000', to: '410,000', rate: '20' },
      { from: '410,000', to: '485,000', rate: '25' },
      { from: '485,000', to: '', rate: '30' },
    ],
    surchargeThreshold: '10,000,000',
    surchargeRate: '10',
  },
};

describe('ruleFormToParams', () => {
  it('converts a PAYE form to params that reproduce the worked example', () => {
    const r = ruleFormToParams(PAYE_FORM);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = r.params as PayeParams;
    expect(p.bands[1]).toEqual({ from: 335000, to: 410000, rateBp: 2000 });
    expect(p.surcharge).toEqual({ threshold: 10000000, rateBp: 1000 });
    expect(payeMonthly(p, 1_000_000)).toBe(188_250);
    expect(payeMonthly(p, 12_000_000)).toBe(3_688_250);
  });

  it('treats a blank surcharge as none', () => {
    const r = ruleFormToParams({
      rule: 'PAYE_NONRES',
      paye: { ...PAYE_FORM.paye, surchargeThreshold: '', surchargeRate: '' },
    } as RuleForm);
    expect(r.ok && (r.params as PayeParams).surcharge).toBeNull();
  });

  it('reports bad amounts, rates and non-contiguous bands', () => {
    const bad = (bands: { from: string; to: string; rate: string }[]) =>
      ruleFormToParams({ rule: 'PAYE_RES', paye: { bands, surchargeThreshold: '', surchargeRate: '' } });
    expect(bad([{ from: 'x', to: '', rate: '0' }])).toMatchObject({ ok: false });
    expect(bad([{ from: '0', to: '', rate: '1.234' }])).toMatchObject({ ok: false });
    const gap = bad([
      { from: '0', to: '100', rate: '0' },
      { from: '200', to: '', rate: '10' },
    ]);
    expect(gap.ok).toBe(false);
    if (!gap.ok) expect(gap.error).toMatch(/contiguous/);
  });

  it('converts NSSF and LST forms', () => {
    expect(
      ruleFormToParams({ rule: 'NSSF', nssf: { employeeRate: '5', employerRate: '10', ceiling: '' } }),
    ).toEqual({ ok: true, params: { employeeRateBp: 500, employerRateBp: 1000, ceiling: null } });

    const lst = ruleFormToParams({
      rule: 'LST',
      lst: {
        bands: [
          { from: '0', to: '100,000', annual: '0' },
          { from: '100,000', to: '', annual: '100,000' },
        ],
        instalments: '4',
        months: [10, 7, 8, 9, 7],
      },
    });
    expect(lst.ok && lst.params).toMatchObject({ instalments: 4, months: [7, 8, 9, 10] });
    expect(
      ruleFormToParams({ rule: 'LST', lst: { bands: [], instalments: '0', months: [7] } }).ok,
    ).toBe(false);
  });

  it('round-trips through paramsToRuleForm', () => {
    const r = ruleFormToParams(PAYE_FORM);
    if (!r.ok) throw new Error(r.error);
    expect(ruleFormToParams(paramsToRuleForm('PAYE_RES', r.params))).toEqual(r);
    const nssf = { employeeRateBp: 500, employerRateBp: 1000, ceiling: 5_000_000 };
    expect(ruleFormToParams(paramsToRuleForm('NSSF', nssf))).toEqual({ ok: true, params: nssf });
  });

  it('gives empty forms when there are no params, and keeps months of a band-less LST draft', () => {
    expect(paramsToRuleForm('NSSF', undefined)).toEqual({
      rule: 'NSSF',
      nssf: { employeeRate: '', employerRate: '', ceiling: '' },
    });
    expect(paramsToRuleForm('PAYE_RES', undefined)).toMatchObject({
      paye: { bands: [{ from: '0', to: '', rate: '0' }] },
    });
    const lst = paramsToRuleForm('LST', { bands: [], instalments: 4, months: [7, 8] });
    expect(lst).toMatchObject({ lst: { bands: [], instalments: '4', months: [7, 8] } });
  });
});

describe('parseLstBandsCsv', () => {
  it('parses a valid file', () => {
    const r = parseLstBandsCsv('From,To,Annual\n0,100000,0\n100000,"200,000",5000\n200000,,10000\n');
    expect(r).toEqual({
      ok: true,
      bands: [
        { from: 0, to: 100000, annual: 0 },
        { from: 100000, to: 200000, annual: 5000 },
        { from: 200000, to: null, annual: 10000 },
      ],
    });
  });

  it('reports missing columns, bad values and empty files', () => {
    expect(parseLstBandsCsv('from,annual\n0,0')).toMatchObject({ ok: false });
    const bad = parseLstBandsCsv('from,to,annual\nx,1,2\n0,y,z');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors).toHaveLength(3);
    expect(parseLstBandsCsv('from,to,annual\n')).toEqual({ ok: false, errors: ['No bands found'] });
  });
});

describe('componentFieldsSchema / componentCodeSchema', () => {
  it('normalises codes and blocks reserved ones', () => {
    expect(componentCodeSchema.parse(' housing_2 ')).toBe('HOUSING_2');
    expect(componentCodeSchema.safeParse('PAYE').success).toBe(false);
    expect(componentCodeSchema.safeParse('1X').success).toBe(false);
  });

  it('clears taxable/nssfable for non-earnings', () => {
    const base = { name: 'Welfare', calcType: 'FIXED', taxable: 'on', nssfable: 'on', priority: '40', sortOrder: '1' };
    expect(componentFieldsSchema.parse({ ...base, kind: 'DEDUCTION' })).toMatchObject({
      taxable: false,
      nssfable: false,
      priority: 40,
    });
    expect(componentFieldsSchema.parse({ ...base, kind: 'EARNING' })).toMatchObject({
      taxable: true,
      nssfable: true,
      prorate: false,
    });
  });
});

describe('settingsFromRows', () => {
  it('reads typed values and falls back to defaults', () => {
    expect(settingsFromRows([])).toEqual({
      minNetPayBp: 0,
      prorationBasis: 'CALENDAR_DAYS',
      company: { name: '', tin: '', nssfEmployerNo: '', address: '' },
      payslipFooter: '',
    });
    const s = settingsFromRows([
      { key: 'minNetPayBp', value: 2000 },
      { key: 'prorationBasis', value: 'BOGUS' },
      { key: 'company.name', value: 'Acme Ltd' },
      { key: 'company.tin', value: 123 },
      { key: 'payslip.footer', value: 'Thank you' },
    ]);
    expect(s.minNetPayBp).toBe(2000);
    expect(s.prorationBasis).toBe('CALENDAR_DAYS');
    expect(s.company).toMatchObject({ name: 'Acme Ltd', tin: '' });
    expect(s.payslipFooter).toBe('Thank you');
    expect(settingsFromRows([{ key: 'minNetPayBp', value: 20000 }]).minNetPayBp).toBe(0);
  });
});
