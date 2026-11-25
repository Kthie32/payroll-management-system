import { afterAll, describe, expect, it } from 'vitest';
import { loadRulesForDate } from '@/lib/settings/rules';
import { getSettings } from '@/lib/settings/general';
import { testDb } from './helpers';

const db = testDb();
afterAll(() => db.$disconnect());

// Each test uses its own far-future window so it never collides with seeded or other versions.
async function version(
  rule: 'PAYE_RES' | 'NSSF' | 'LST',
  effectiveFrom: string,
  params: object,
  opts: { approved: boolean; active: boolean; effectiveTo?: string },
) {
  const user = await db.user.create({
    data: { email: `r-${Math.random().toString(36).slice(2)}@t.test`, name: 'Rules', passwordHash: 'x' },
  });
  return db.statutoryRuleVersion.create({
    data: {
      rule,
      params,
      effectiveFrom: new Date(effectiveFrom),
      effectiveTo: opts.effectiveTo ? new Date(opts.effectiveTo) : null,
      active: opts.active,
      approvedById: opts.approved ? user.id : null,
      approvedAt: opts.approved ? new Date() : null,
    },
  });
}

const PAYE = { bands: [{ from: 0, to: null, rateBp: 1000 }], surcharge: null };
const NSSF = { employeeRateBp: 500, employerRateBp: 1000, ceiling: null };

describe('loadRulesForDate', () => {
  it('returns only approved, active versions in effect on the pay date', async () => {
    const paye = await version('PAYE_RES', '2090-07-01', PAYE, { approved: true, active: true });
    await version('PAYE_RES', '2090-08-01', { ...PAYE, surcharge: null }, { approved: false, active: false });
    const nssf = await version('NSSF', '2090-07-01', NSSF, {
      approved: true,
      active: true,
      effectiveTo: '2090-12-31',
    });
    await version(
      'LST',
      '2090-07-01',
      { bands: [], instalments: 4, months: [7, 8, 9, 10], basis: 'MONTHLY_GROSS' },
      { approved: false, active: false },
    );

    const r = await loadRulesForDate(db, new Date('2090-08-28'));
    expect(r.paye.RES).toEqual(PAYE);
    expect(r.nssf).toEqual(NSSF);
    expect(r.lst).toBeNull();
    expect(r.lstMonths).toEqual([7, 8, 9, 10]);
    expect(r.versionIds).toEqual(expect.arrayContaining([paye.id, nssf.id]));

    const later = await loadRulesForDate(db, new Date('2091-01-28'));
    expect(later.nssf).toBeNull(); // window closed on 2090-12-31
  });
});

describe('getSettings', () => {
  it('reads typed values from the settings table', async () => {
    await db.setting.upsert({
      where: { key: 'company.name' },
      create: { key: 'company.name', value: 'Integration Ltd' },
      update: { value: 'Integration Ltd' },
    });
    const s = await getSettings(db);
    expect(s.company.name).toBe('Integration Ltd');
    expect(typeof s.minNetPayBp).toBe('number');
  });
});
