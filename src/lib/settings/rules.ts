import type { StatutoryRule } from '@prisma/client';
import type { Tx } from '@/lib/db';
import {
  lstParamsSchema,
  nssfParamsSchema,
  payeParamsSchema,
  type LstParams,
  type NssfParams,
  type PayeParams,
} from '@/lib/payroll-engine';
import { getSettings } from './general';

export { getSettings };
export type { AppSettings, CompanyDetails } from './general';

export const STATUTORY_RULES = ['PAYE_RES', 'PAYE_NONRES', 'NSSF', 'LST'] as const satisfies
  readonly StatutoryRule[];

export const RULE_LABELS: Record<StatutoryRule, string> = {
  PAYE_RES: 'PAYE — residents',
  PAYE_NONRES: 'PAYE — non-residents',
  NSSF: 'NSSF',
  LST: 'Local Service Tax',
};

export interface RuleVersionLike {
  id: string;
  rule: StatutoryRule;
  params: unknown;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  active: boolean;
  approvedById: string | null;
}

/** The version of `rule` in effect on `onDate`: active, approved, and covering the date. */
export function resolveRuleVersion<V extends RuleVersionLike>(
  versions: readonly V[],
  rule: StatutoryRule,
  onDate: Date,
): V | null {
  const t = onDate.getTime();
  let best: V | null = null;
  for (const v of versions) {
    if (v.rule !== rule || !v.active || !v.approvedById) continue;
    if (v.effectiveFrom.getTime() > t) continue;
    if (v.effectiveTo && v.effectiveTo.getTime() < t) continue;
    if (!best || v.effectiveFrom.getTime() > best.effectiveFrom.getTime()) best = v;
  }
  return best;
}

/** The most recent version of `rule` by effectiveFrom, regardless of status. */
export function latestVersion<V extends RuleVersionLike>(
  versions: readonly V[],
  rule: StatutoryRule,
): V | null {
  let best: V | null = null;
  for (const v of versions) {
    if (v.rule !== rule) continue;
    if (!best || v.effectiveFrom.getTime() > best.effectiveFrom.getTime()) best = v;
  }
  return best;
}

export type RuleApprovalProblem =
  | 'ALREADY_APPROVED'
  | 'SAME_USER'
  | 'NOT_AFTER_CURRENT'
  | 'LST_NO_BANDS'
  | 'INVALID_PARAMS';

/**
 * Checks whether `draft` may be approved by `approverId`.
 * `others` are all versions of the same rule (the draft itself may be included).
 */
export function approvalProblem(
  draft: RuleVersionLike,
  others: readonly RuleVersionLike[],
  creatorId: string | null,
  approverId: string,
): RuleApprovalProblem | null {
  if (draft.approvedById) return 'ALREADY_APPROVED';
  if (creatorId && creatorId === approverId) return 'SAME_USER';
  const parsed = parseRuleParams(draft.rule, draft.params);
  if (!parsed.ok) return 'INVALID_PARAMS';
  if (draft.rule === 'LST' && (parsed.params as LstParams).bands.length === 0) {
    return 'LST_NO_BANDS';
  }
  const laterOrSame = others.some(
    (v) =>
      v.id !== draft.id &&
      v.rule === draft.rule &&
      v.active &&
      v.approvedById &&
      v.effectiveFrom.getTime() >= draft.effectiveFrom.getTime(),
  );
  return laterOrSame ? 'NOT_AFTER_CURRENT' : null;
}

/** Versions whose effective window must be closed when `draft` is approved. */
export function versionsToClose(
  draft: RuleVersionLike,
  others: readonly RuleVersionLike[],
): RuleVersionLike[] {
  const start = draft.effectiveFrom.getTime();
  return others.filter(
    (v) =>
      v.id !== draft.id &&
      v.rule === draft.rule &&
      v.active &&
      v.approvedById !== null &&
      v.effectiveFrom.getTime() < start &&
      (v.effectiveTo === null || v.effectiveTo.getTime() >= start),
  );
}

type ParsedParams =
  | { ok: true; params: PayeParams | NssfParams | LstParams }
  | { ok: false; error: string };

/** Validate stored/submitted params for a rule with the engine's zod schemas. */
export function parseRuleParams(rule: StatutoryRule, params: unknown): ParsedParams {
  const schema =
    rule === 'NSSF' ? nssfParamsSchema : rule === 'LST' ? lstParamsSchema : payeParamsSchema;
  const r = schema.safeParse(params);
  return r.success
    ? { ok: true, params: r.data }
    : { ok: false, error: r.error.issues[0]?.message ?? 'Invalid parameters' };
}

export interface RulesForDate {
  paye: { RES: PayeParams | null; NONRES: PayeParams | null };
  nssf: NssfParams | null;
  lst: LstParams | null;
  /** Months of the latest LST version even if inactive (for the engine's LST_RULE_MISSING). */
  lstMonths: number[] | undefined;
  /** Ids of the versions used, for PayrollRun.ruleVersionIds. */
  versionIds: string[];
}

export class InvalidRuleParamsError extends Error {
  constructor(
    readonly versionId: string,
    readonly rule: StatutoryRule,
    detail: string,
  ) {
    super(`Statutory rule ${rule} (version ${versionId}) has invalid parameters: ${detail}`);
    this.name = 'InvalidRuleParamsError';
  }
}

/** Pick and parse the rule versions in effect on `payDate`. Pure; see loadRulesForDate. */
export function rulesForDate(versions: readonly RuleVersionLike[], payDate: Date): RulesForDate {
  const versionIds: string[] = [];
  function pick<T>(rule: StatutoryRule): T | null {
    const v = resolveRuleVersion(versions, rule, payDate);
    if (!v) return null;
    const parsed = parseRuleParams(rule, v.params);
    if (!parsed.ok) throw new InvalidRuleParamsError(v.id, rule, parsed.error);
    versionIds.push(v.id);
    return parsed.params as T;
  }
  const RES = pick<PayeParams>('PAYE_RES');
  const NONRES = pick<PayeParams>('PAYE_NONRES');
  const nssf = pick<NssfParams>('NSSF');
  const lst = pick<LstParams>('LST');

  let lstMonths: number[] | undefined;
  if (lst) {
    lstMonths = lst.months;
  } else {
    const latest = latestVersion(versions, 'LST');
    const months = (latest?.params as { months?: unknown } | undefined)?.months;
    if (Array.isArray(months) && months.every((m) => Number.isInteger(m))) {
      lstMonths = months as number[];
    }
  }
  return { paye: { RES, NONRES }, nssf, lst, lstMonths, versionIds };
}

/** Load all statutory rule versions and return those in effect on `payDate`, parsed. */
export async function loadRulesForDate(
  tx: Pick<Tx, 'statutoryRuleVersion'>,
  payDate: Date,
): Promise<RulesForDate> {
  const versions = await tx.statutoryRuleVersion.findMany({
    select: {
      id: true,
      rule: true,
      params: true,
      effectiveFrom: true,
      effectiveTo: true,
      active: true,
      approvedById: true,
    },
  });
  return rulesForDate(versions, payDate);
}
