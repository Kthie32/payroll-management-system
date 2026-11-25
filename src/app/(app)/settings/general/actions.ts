'use server';

import type { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withAudit } from '@/lib/audit';
import { currentIp } from '@/lib/auth/request';
import { db } from '@/lib/db';
import { BP_DENOMINATOR } from '@/lib/money';
import { assertPermission } from '@/lib/rbac';
import {
  SETTING_KEYS,
  SUPPORTED_PRORATION_BASES,
  type ProrationBasis,
} from '@/lib/settings/general';
import { percentToBp } from '@/lib/settings/input';

export interface GeneralSettingsState {
  error?: string;
  message?: string;
}

const schema = z.object({
  minNetPay: z.string().trim(),
  prorationBasis: z.string(),
  companyName: z.string().trim().max(160),
  // TODO-confirm: URA TINs are 10 digits.
  companyTin: z
    .string()
    .trim()
    .refine((s) => s === '' || /^\d{10}$/.test(s), 'TIN must be 10 digits'),
  companyNssfEmployerNo: z.string().trim().max(30),
  companyAddress: z.string().trim().max(500),
  payslipFooter: z.string().trim().max(500),
});

export async function saveGeneralSettingsAction(
  _prev: GeneralSettingsState,
  formData: FormData,
): Promise<GeneralSettingsState> {
  const actor = await assertPermission('settings.edit');
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const f = parsed.data;

  const minNetPayBp = percentToBp(f.minNetPay);
  if (minNetPayBp === null || minNetPayBp > BP_DENOMINATOR) {
    return { error: 'Minimum net pay must be a percentage between 0 and 100.' };
  }
  if (!SUPPORTED_PRORATION_BASES.includes(f.prorationBasis as ProrationBasis)) {
    return { error: 'Only calendar-day proration is available at the moment.' };
  }

  const next: Record<string, Prisma.InputJsonValue> = {
    [SETTING_KEYS.minNetPayBp]: minNetPayBp,
    [SETTING_KEYS.prorationBasis]: f.prorationBasis,
    [SETTING_KEYS.companyName]: f.companyName,
    [SETTING_KEYS.companyTin]: f.companyTin,
    [SETTING_KEYS.companyNssfEmployerNo]: f.companyNssfEmployerNo,
    [SETTING_KEYS.companyAddress]: f.companyAddress,
    [SETTING_KEYS.payslipFooter]: f.payslipFooter,
  };

  const ip = await currentIp();
  const changed = await db.$transaction(async (tx) => {
    const rows = await tx.setting.findMany({ where: { key: { in: Object.keys(next) } } });
    const current = new Map(rows.map((r) => [r.key, r.value]));
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(next)) {
      const old = current.get(key);
      if (JSON.stringify(old ?? null) === JSON.stringify(value)) continue;
      // Don't create empty optional settings that never existed.
      if (old === undefined && value === '') continue;
      await tx.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
      before[key] = old ?? null;
      after[key] = value;
    }
    if (Object.keys(after).length) {
      await withAudit(tx, {
        actorId: actor.id,
        action: 'SETTINGS_UPDATED',
        entity: 'Setting',
        entityId: null,
        before,
        after,
        ip,
      });
    }
    return Object.keys(after).length;
  });

  revalidatePath('/settings/general');
  return { message: changed ? 'Settings saved.' : 'No changes.' };
}
