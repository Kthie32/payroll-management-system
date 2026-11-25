'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { withAudit } from '@/lib/audit';
import { currentIp } from '@/lib/auth/request';
import { db } from '@/lib/db';
import { assertPermission } from '@/lib/rbac';
import { componentCodeSchema, componentFieldsSchema } from '@/lib/settings/components';
import { componentInUse } from '@/lib/settings/usage';

export interface ComponentFormState {
  error?: string;
  message?: string;
}

function fields(formData: FormData) {
  return componentFieldsSchema.safeParse({
    name: formData.get('name'),
    kind: formData.get('kind'),
    calcType: formData.get('calcType'),
    taxable: formData.get('taxable'),
    nssfable: formData.get('nssfable'),
    prorate: formData.get('prorate'),
    recurring: formData.get('recurring'),
    isActive: formData.get('isActive'),
    priority: formData.get('priority'),
    sortOrder: formData.get('sortOrder'),
  });
}

export async function createComponentAction(
  _prev: ComponentFormState,
  formData: FormData,
): Promise<ComponentFormState> {
  const actor = await assertPermission('settings.edit');
  const code = componentCodeSchema.safeParse(formData.get('code'));
  if (!code.success) return { error: code.error.issues[0]?.message };
  const parsed = fields(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  if (await db.payComponent.findUnique({ where: { code: code.data }, select: { id: true } })) {
    return { error: `A component with code ${code.data} already exists.` };
  }
  const ip = await currentIp();
  const created = await db.$transaction(async (tx) => {
    const c = await tx.payComponent.create({ data: { code: code.data, ...parsed.data } });
    await withAudit(tx, {
      actorId: actor.id,
      action: 'COMPONENT_CREATED',
      entity: 'PayComponent',
      entityId: c.id,
      after: { code: c.code, ...parsed.data },
      ip,
    });
    return c;
  });
  revalidatePath('/settings/components');
  redirect(`/settings/components/${created.id}?saved=1`);
}

export async function updateComponentAction(
  _prev: ComponentFormState,
  formData: FormData,
): Promise<ComponentFormState> {
  const actor = await assertPermission('settings.edit');
  const id = z.string().min(1).safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing component id' };
  const parsed = fields(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const before = await db.payComponent.findUnique({ where: { id: id.data } });
  if (!before) return { error: 'Component not found.' };
  const ip = await currentIp();
  await db.$transaction(async (tx) => {
    await tx.payComponent.update({ where: { id: id.data }, data: parsed.data });
    await withAudit(tx, {
      actorId: actor.id,
      action: 'COMPONENT_UPDATED',
      entity: 'PayComponent',
      entityId: id.data,
      before: pick(before, Object.keys(parsed.data)),
      after: parsed.data,
      ip,
    });
  });
  revalidatePath('/settings/components');
  revalidatePath(`/settings/components/${id.data}`);
  return { message: 'Saved.' };
}

/** Delete only if the component has never been used; otherwise the caller should deactivate. */
export async function deleteComponentAction(
  _prev: ComponentFormState,
  formData: FormData,
): Promise<ComponentFormState> {
  const actor = await assertPermission('settings.edit');
  const id = String(formData.get('id') ?? '');
  const c = await db.payComponent.findUnique({ where: { id } });
  if (!c) return { error: 'Component not found.' };
  if (await componentInUse(c.id, c.code)) {
    return { error: 'This component has been used, so it can only be deactivated.' };
  }
  const ip = await currentIp();
  await db.$transaction(async (tx) => {
    await tx.payComponent.delete({ where: { id } });
    await withAudit(tx, {
      actorId: actor.id,
      action: 'COMPONENT_DELETED',
      entity: 'PayComponent',
      entityId: id,
      before: c,
      ip,
    });
  });
  revalidatePath('/settings/components');
  redirect('/settings/components');
}

function pick<T extends object>(obj: T, keys: string[]): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([k]) => keys.includes(k)),
  ) as Partial<T>;
}
