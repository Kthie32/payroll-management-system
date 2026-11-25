import { describe, expect, it } from 'vitest';
import { kampalaToday } from '../load';
import { buildTrend, ruleStatuses, trendStartMonth, type RuleVersionLite } from '../summary';

describe('trend', () => {
  it('zero-fills six months ending at the given month, crossing a year boundary', () => {
    const t = buildTrend(
      [
        { payDate: '2026-02-27', gross: 100, net: 80 },
        { payDate: '2026-02-13', gross: 50, net: 40 },
        { payDate: '2025-10-30', gross: 7, net: 7 }, // outside window
        { payDate: '2025-09-30', gross: 10, net: 9 },
      ],
      '2026-02',
    );
    expect(t.map((p) => p.month)).toEqual([
      '2025-09',
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
    expect(t[0]).toMatchObject({ label: 'Sep 25', gross: 10, net: 9 });
    expect(t[5]).toMatchObject({ label: 'Feb 26', gross: 150, net: 120 });
    expect(t[2]).toMatchObject({ gross: 0, net: 0 });
  });

  it('reports the first month of the window', () => {
    expect(trendStartMonth('2026-02')).toBe('2025-09');
    expect(trendStartMonth('2026-12', 3)).toBe('2026-10');
  });
});

describe('rule statuses', () => {
  const v = (over: Partial<RuleVersionLite>): RuleVersionLite => ({
    rule: 'PAYE_RES',
    active: true,
    approved: true,
    effectiveFrom: '2026-07-01',
    effectiveTo: null,
    ...over,
  });
  const today = '2026-11-25';

  it('ok when an active approved version covers today', () => {
    expect(ruleStatuses([v({})], ['PAYE_RES'], today)[0]?.state).toBe('ok');
  });

  it('missing when nothing was entered', () => {
    expect(ruleStatuses([], ['NSSF'], today)[0]).toMatchObject({ state: 'missing' });
  });

  it('unapproved when the covering version is not approved', () => {
    expect(ruleStatuses([v({ approved: false })], ['PAYE_RES'], today)[0]?.state).toBe(
      'unapproved',
    );
  });

  it('inactive when only inactive or out-of-range versions exist', () => {
    expect(ruleStatuses([v({ active: false })], ['PAYE_RES'], today)[0]?.state).toBe('inactive');
    expect(ruleStatuses([v({ effectiveFrom: '2027-07-01' })], ['PAYE_RES'], today)[0]?.state).toBe(
      'inactive',
    );
  });

  it('expiring when it ends within 30 days without an approved successor', () => {
    const ending = v({ effectiveTo: '2026-12-10' });
    expect(ruleStatuses([ending], ['PAYE_RES'], today)[0]?.state).toBe('expiring');
    const successor = v({ effectiveFrom: '2026-12-11' });
    expect(ruleStatuses([ending, successor], ['PAYE_RES'], today)[0]?.state).toBe('ok');
    expect(ruleStatuses([v({ effectiveTo: '2027-06-30' })], ['PAYE_RES'], today)[0]?.state).toBe(
      'ok',
    );
  });
});

describe('kampala date', () => {
  it('uses UTC+3', () => {
    expect(kampalaToday(new Date('2026-11-25T22:30:00Z'))).toBe('2026-11-26');
    expect(kampalaToday(new Date('2026-11-25T20:30:00Z'))).toBe('2026-11-25');
  });
});
