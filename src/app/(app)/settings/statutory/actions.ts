'use server';

import { Prisma, StatutoryRule } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { withAudit } from '@/lib/audit';
import { currentIp } from '@/lib/auth/request';
import { db } from '@/lib/db';
import { assertPermission } from '@/lib/rbac';
import { dayBefore, parseIsoDateInput, toIsoDate } from '@/lib/settings/input';
import { ruleFormToParams, type RuleForm } from '@/lib/settings/rule-form';
import { approvalProblem, versionsToClose } from '@/lib/settings/rules';

export interface RuleActionState {
  error?: string;
  message?: string;
}

const textField = z.string().trim();
const formShape = z.discriminatedUnion('rule', [
  z.object({
    rule: z.enum(['PAYE_RES', 'PAYE_NONRES']),
    paye: z.object({
      bands: z.array(z.object({ from: textField, to: textField, rate: textField })).max(50),
      surchargeThreshold: textField,
      surchargeRate: textField,
    }),
  }),
  z.object({
    rule: z.literal('NSSF'),
    nssf: z.object({ employeeRate: textField, employerRate: textField, ceiling: textField }),
  }),
  z.object({
    rule: z.literal('LST'),
    lst: z.object({
      bands: z.array(z.object({ from: textField, to: textField, annual: textField })).max(50),
      instalments: textField,
      months: z.array(z.number().int().min(1).max(12)),
    }),
  }),
]);

export async function createRuleVersionAction(
  _prev: RuleActionState,
  formData: FormData,
): Promise<RuleActionState> {
  const actor = await assertPermission('rules.edit');
  const effectiveFrom = parseIsoDateInput(String(formData.get('effectiveFrom') ?? ''));
  if (!effectiveFrom) return { error: 'Enter the date the rule takes effect.' };
  const sourceUrl = z
    .union([z.literal(''), z.string().trim().url('Source must be a valid URL').max(500)])
    .safeParse(String(formData.get('sourceUrl') ?? '').trim());
  if (!sourceUrl.success) return { error: sourceUrl.error.issues[0]?.message };

  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get('form') ?? ''));
  } catch {
    return { error: 'The form could not be read. Reload and try again.' };
  }
  const shape = formShape.safeParse(raw);
  if (!shape.success) return { error: 'The form could not be read. Reload and try again.' };
  const form = shape.data as RuleForm;
  const params = ruleFormToParams(form);
  if (!params.ok) return { error: params.error };

  const rule = form.rule as StatutoryRule;
  const clash = await db.statutoryRuleVersion.findUnique({
    where: { rule_effectiveFrom: { rule, effectiveFrom } },
    select: { id: true },
  });
  if (clash) return { error: `A ${rule} version already starts on ${toIsoDate(effectiveFrom)}.` };

  const ip = await currentIp();
  const created = await db.$transaction(async (tx) => {
    const v = await tx.statutoryRuleVersion.create({
      data: {
        rule,
        params: params.params as Prisma.InputJsonValue,
        effectiveFrom,
        active: false,
        sourceUrl: sourceUrl.data || null,
      },
    });
    await withAudit(tx, {
      actorId: actor.id,
      action: 'RULE_VERSION_CREATED',
      entity: 'StatutoryRuleVersion',
      entityId: v.id,
      after: { rule, effectiveFrom: toIsoDate(effectiveFrom), params: params.params, sourceUrl: v.sourceUrl },
      ip,
    });
    return v;
  });
  revalidatePath('/settings/statutory');
  redirect(`/settings/statutory/${created.id}?created=1`);
}

const PROBLEM_MESSAGES = {
  ALREADY_APPROVED: 'This version is already approved.',
  SAME_USER: 'You entered this version, so someone else must approve it.',
  NOT_AFTER_CURRENT:
    'An approved version already starts on or after this date. Enter a later effective date.',
  LST_NO_BANDS: 'LST cannot be approved without bands.',
  INVALID_PARAMS: 'The parameters are not valid.',
} as const;

export async function approveRuleVersionAction(
  _prev: RuleActionState,
  formData: FormData,
): Promise<RuleActionState> {
  const actor = await assertPermission('rules.approve');
  const id = String(formData.get('id') ?? '');
  const ip = await currentIp();

  const result = await db.$transaction(async (tx) => {
    const draft = await tx.statutoryRuleVersion.findUnique({ where: { id } });
    if (!draft) return { error: 'Version not found.' };
    const others = await tx.statutoryRuleVersion.findMany({ where: { rule: draft.rule } });
    const createdEntry = await tx.auditLog.findFirst({
      where: { action: 'RULE_VERSION_CREATED', entity: 'StatutoryRuleVersion', entityId: id },
      select: { actorId: true },
    });
    const problem = approvalProblem(draft, others, createdEntry?.actorId ?? null, actor.id);
    if (problem) return { error: PROBLEM_MESSAGES[problem] };

    const closeOn = dayBefore(draft.effectiveFrom);
    for (const prev of versionsToClose(draft, others)) {
      await tx.statutoryRuleVersion.update({ where: { id: prev.id }, data: { effectiveTo: closeOn } });
      await withAudit(tx, {
        actorId: actor.id,
        action: 'RULE_VERSION_SUPERSEDED',
        entity: 'StatutoryRuleVersion',
        entityId: prev.id,
        before: { effectiveTo: prev.effectiveTo ? toIsoDate(prev.effectiveTo) : null },
        after: { effectiveTo: toIsoDate(closeOn), supersededBy: draft.id },
        ip,
      });
    }
    const now = new Date();
    await tx.statutoryRuleVersion.update({
      where: { id },
      data: { approvedById: actor.id, approvedAt: now, active: true },
    });
    await withAudit(tx, {
      actorId: actor.id,
      action: 'RULE_VERSION_APPROVED',
      entity: 'StatutoryRuleVersion',
      entityId: id,
      before: { active: draft.active, approvedById: null },
      after: { active: true, approvedById: actor.id, approvedAt: now.toISOString() },
      ip,
    });
    return { message: 'Approved. This version is now in effect from its start date.' };
  });

  revalidatePath('/settings/statutory');
  revalidatePath(`/settings/statutory/${id}`);
  return result;
}

export async function discardRuleVersionAction(
  _prev: RuleActionState,
  formData: FormData,
): Promise<RuleActionState> {
  const actor = await assertPermission('rules.edit');
  const id = String(formData.get('id') ?? '');
  const v = await db.statutoryRuleVersion.findUnique({ where: { id } });
  if (!v) return { error: 'Version not found.' };
  if (v.approvedById) return { error: 'Approved versions cannot be discarded.' };
  const ip = await currentIp();
  await db.$transaction(async (tx) => {
    await tx.statutoryRuleVersion.delete({ where: { id } });
    await withAudit(tx, {
      actorId: actor.id,
      action: 'RULE_VERSION_DISCARDED',
      entity: 'StatutoryRuleVersion',
      entityId: id,
      before: { rule: v.rule, effectiveFrom: toIsoDate(v.effectiveFrom), params: v.params },
      ip,
    });
  });
  revalidatePath('/settings/statutory');
  redirect('/settings/statutory');
}
