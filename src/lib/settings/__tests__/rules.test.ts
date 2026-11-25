import { describe, expect, it } from 'vitest';
import {
  approvalProblem,
  InvalidRuleParamsError,
  latestVersion,
  resolveRuleVersion,
  rulesForDate,
  versionsToClose,
  type RuleVersionLike,
} from '../rules';

const PAYE = {
  bands: [
    { from: 0, to: 335000, rateBp: 0 },
    { from: 335000, to: null, rateBp: 3000 },
  ],
  surcharge: null,
};
const NSSF = { employeeRateBp: 500, employerRateBp: 1000, ceiling: null };
const LST = {
  bands: [
    { from: 0, to: 100000, annual: 0 },
    { from: 100000, to: null, annual: 100000 },
  ],
  instalments: 4,
  months: [7, 8, 9, 10],
  basis: 'MONTHLY_GROSS',
};

let seq = 0;
function v(p: Partial<RuleVersionLike> & Pick<RuleVersionLike, 'rule'>): RuleVersionLike {
  return {
    id: `v${++seq}`,
    params: p.rule === 'NSSF' ? NSSF : p.rule === 'LST' ? LST : PAYE,
    effectiveFrom: new Date('2026-07-01'),
    effectiveTo: null,
    active: true,
    approvedById: 'u1',
    ...p,
  };
}

const d = (s: string) => new Date(s);

describe('resolveRuleVersion', () => {
  it('returns the approved, active version covering the date', () => {
    const a = v({ rule: 'PAYE_RES' });
    expect(resolveRuleVersion([a], 'PAYE_RES', d('2026-11-28'))).toBe(a);
  });

  it('ignores inactive, unapproved, future, expired and other-rule versions', () => {
    const list = [
      v({ rule: 'PAYE_RES', active: false }),
      v({ rule: 'PAYE_RES', approvedById: null }),
      v({ rule: 'PAYE_RES', effectiveFrom: d('2027-01-01') }),
      v({ rule: 'PAYE_RES', effectiveFrom: d('2025-07-01'), effectiveTo: d('2026-06-30') }),
      v({ rule: 'NSSF' }),
    ];
    expect(resolveRuleVersion(list, 'PAYE_RES', d('2026-11-28'))).toBeNull();
  });

  it('includes both ends of the effective window', () => {
    const a = v({ rule: 'NSSF', effectiveFrom: d('2026-07-01'), effectiveTo: d('2026-12-31') });
    expect(resolveRuleVersion([a], 'NSSF', d('2026-07-01'))).toBe(a);
    expect(resolveRuleVersion([a], 'NSSF', d('2026-12-31'))).toBe(a);
    expect(resolveRuleVersion([a], 'NSSF', d('2027-01-01'))).toBeNull();
  });

  it('picks the latest effectiveFrom when several match', () => {
    const old = v({ rule: 'NSSF', effectiveFrom: d('2025-07-01') });
    const cur = v({ rule: 'NSSF', effectiveFrom: d('2026-07-01') });
    expect(resolveRuleVersion([cur, old], 'NSSF', d('2026-11-01'))).toBe(cur);
    expect(resolveRuleVersion([old, cur], 'NSSF', d('2026-11-01'))).toBe(cur);
  });
});

describe('latestVersion', () => {
  it('ignores status', () => {
    const a = v({ rule: 'LST', effectiveFrom: d('2025-07-01') });
    const b = v({ rule: 'LST', effectiveFrom: d('2026-07-01'), active: false, approvedById: null });
    expect(latestVersion([a, b, v({ rule: 'NSSF' })], 'LST')).toBe(b);
    expect(latestVersion([], 'LST')).toBeNull();
  });
});

describe('rulesForDate', () => {
  it('returns parsed params and the ids used', () => {
    const p = v({ rule: 'PAYE_RES' });
    const n = v({ rule: 'NSSF' });
    const l = v({ rule: 'LST' });
    const r = rulesForDate([p, n, l], d('2026-08-28'));
    expect(r.paye.RES).toEqual(PAYE);
    expect(r.paye.NONRES).toBeNull();
    expect(r.nssf).toEqual(NSSF);
    expect(r.lst?.instalments).toBe(4);
    expect(r.lstMonths).toEqual([7, 8, 9, 10]);
    expect(r.versionIds.sort()).toEqual([p.id, n.id, l.id].sort());
  });

  it('takes LST months from an inactive version when no LST rule is in effect', () => {
    const draft = v({
      rule: 'LST',
      active: false,
      approvedById: null,
      params: { bands: [], instalments: 4, months: [7, 8, 9, 10], basis: 'MONTHLY_GROSS' },
    });
    const r = rulesForDate([draft, v({ rule: 'NSSF' })], d('2026-08-28'));
    expect(r.lst).toBeNull();
    expect(r.lstMonths).toEqual([7, 8, 9, 10]);
  });

  it('leaves lstMonths undefined when no LST version exists or months are malformed', () => {
    expect(rulesForDate([], d('2026-08-28')).lstMonths).toBeUndefined();
    const bad = v({ rule: 'LST', active: false, params: { months: 'x' } });
    expect(rulesForDate([bad], d('2026-08-28')).lstMonths).toBeUndefined();
  });

  it('throws InvalidRuleParamsError for corrupt params in an approved version', () => {
    const bad = v({ rule: 'NSSF', params: { employeeRateBp: -1 } });
    expect(() => rulesForDate([bad], d('2026-08-28'))).toThrow(InvalidRuleParamsError);
  });
});

describe('approvalProblem', () => {
  const current = v({ rule: 'PAYE_RES', effectiveFrom: d('2026-07-01') });
  const draft = () =>
    v({ rule: 'PAYE_RES', effectiveFrom: d('2027-07-01'), active: false, approvedById: null });

  it('allows a different user to approve a later, valid draft', () => {
    const dr = draft();
    expect(approvalProblem(dr, [current, dr], 'creator', 'approver')).toBeNull();
  });

  it('blocks self-approval', () => {
    const dr = draft();
    expect(approvalProblem(dr, [current, dr], 'same', 'same')).toBe('SAME_USER');
  });

  it('blocks re-approval', () => {
    expect(approvalProblem(current, [current], 'a', 'b')).toBe('ALREADY_APPROVED');
  });

  it('blocks a draft that does not start after the current version', () => {
    const dr = { ...draft(), effectiveFrom: d('2026-07-01') };
    expect(approvalProblem(dr, [current, dr], 'a', 'b')).toBe('NOT_AFTER_CURRENT');
  });

  it('blocks invalid params and LST with no bands', () => {
    const bad = { ...draft(), params: { bands: [] } };
    expect(approvalProblem(bad, [bad], 'a', 'b')).toBe('INVALID_PARAMS');
    const lst = v({
      rule: 'LST',
      active: false,
      approvedById: null,
      params: { bands: [], instalments: 4, months: [7], basis: 'MONTHLY_GROSS' },
    });
    expect(approvalProblem(lst, [lst], 'a', 'b')).toBe('LST_NO_BANDS');
  });
});

describe('versionsToClose', () => {
  it('closes earlier open/overlapping approved versions of the same rule only', () => {
    const open = v({ rule: 'NSSF', effectiveFrom: d('2026-07-01') });
    const closedBefore = v({
      rule: 'NSSF',
      effectiveFrom: d('2025-07-01'),
      effectiveTo: d('2026-06-30'),
    });
    const overlapping = v({
      rule: 'NSSF',
      effectiveFrom: d('2026-01-01'),
      effectiveTo: d('2027-12-31'),
    });
    const otherRule = v({ rule: 'PAYE_RES' });
    const unapproved = v({ rule: 'NSSF', approvedById: null });
    const draft = v({ rule: 'NSSF', effectiveFrom: d('2027-07-01'), approvedById: null });
    const toClose = versionsToClose(draft, [open, closedBefore, overlapping, otherRule, unapproved, draft]);
    expect(toClose.map((x) => x.id).sort()).toEqual([open.id, overlapping.id].sort());
  });
});
