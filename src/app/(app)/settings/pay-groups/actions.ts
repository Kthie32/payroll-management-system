'use server';

import { PayFrequency } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withAudit } from '@/lib/audit';
import { currentIp } from '@/lib/auth/request';
import { db } from '@/lib/db';
import { assertPermission } from '@/lib/rbac';
import { payGroupUsage } from '@/lib/settings/usage';

export interface PayGroupState {
  error?: string;
  message?: string;
}

const nameSchema = z.string().trim().min(2, 'Name is required').max(120);
const frequencySchema = z.nativeEnum(PayFrequency);

async function nameTaken(name: string, exceptId?: string) {
  const other = await db.payGroup.findUnique({ where: { name }, select: { id: true } });
  return Boolean(other && other.id !== exceptId);
}

export async function createPayGroupAction(
  _prev: PayGroupState,
  formData: FormData,
): Promise<PayGroupState> {
  const actor = await assertPermission('settings.edit');
  const parsed = z
    .object({ name: nameSchema, frequency: frequencySchema })
    .safeParse({ name: formData.get('name'), frequency: formData.get('frequency') });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  if (await nameTaken(parsed.data.name)) return { error: 'A pay group with that name exists.' };

  const ip = await currentIp();
  await db.$transaction(async (tx) => {
    const g = await tx.payGroup.create({ data: parsed.data });
    await withAudit(tx, {
      actorId: actor.id,
      action: 'PAY_GROUP_CREATED',
      entity: 'PayGroup',
      entityId: g.id,
      after: parsed.data,
      ip,
    });
  });
  revalidatePath('/settings/pay-groups');
  return { message: `Created “${parsed.data.name}”.` };
}

export async function updatePayGroupAction(
  _prev: PayGroupState,
  formData: FormData,
): Promise<PayGroupState> {
  const actor = await assertPermission('settings.edit');
  const parsed = z
    .object({ id: z.string().min(1), name: nameSchema, frequency: frequencySchema })
    .safeParse({
      id: formData.get('id'),
      name: formData.get('name'),
      frequency: formData.get('frequency'),
    });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { id, name, frequency } = parsed.data;

  const before = await db.payGroup.findUnique({ where: { id } });
  if (!before) return { error: 'Pay group not found.' };
  if (await nameTaken(name, id)) return { error: 'A pay group with that name exists.' };
  if (frequency !== before.frequency && (await payGroupUsage(id)).periods > 0) {
    return { error: 'Frequency cannot change once pay periods exist for this group.' };
  }

  const ip = await currentIp();
  await db.$transaction(async (tx) => {
    await tx.payGroup.update({ where: { id }, data: { name, frequency } });
    await withAudit(tx, {
      actorId: actor.id,
      action: 'PAY_GROUP_UPDATED',
      entity: 'PayGroup',
      entityId: id,
      before: { name: before.name, frequency: before.frequency },
      after: { name, frequency },
      ip,
    });
  });
  revalidatePath('/settings/pay-groups');
  return { message: 'Saved.' };
}

export async function deletePayGroupAction(
  _prev: PayGroupState,
  formData: FormData,
): Promise<PayGroupState> {
  const actor = await assertPermission('settings.edit');
  const id = String(formData.get('id') ?? '');
  const before = await db.payGroup.findUnique({ where: { id } });
  if (!before) return { error: 'Pay group not found.' };
  if ((await payGroupUsage(id)).inUse) {
    return { error: 'This group has employees, periods or runs, so it cannot be deleted.' };
  }
  const ip = await currentIp();
  await db.$transaction(async (tx) => {
    await tx.payGroup.delete({ where: { id } });
    await withAudit(tx, {
      actorId: actor.id,
      action: 'PAY_GROUP_DELETED',
      entity: 'PayGroup',
      entityId: id,
      before: { name: before.name, frequency: before.frequency },
      ip,
    });
  });
  revalidatePath('/settings/pay-groups');
  return { message: 'Deleted.' };
}
