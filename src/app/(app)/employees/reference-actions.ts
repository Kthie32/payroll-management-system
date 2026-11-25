'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { currentIp } from '@/lib/auth/request';
import { db } from '@/lib/db';
import { deleteBank, deleteDepartment, saveBank, saveDepartment } from '@/lib/employees/reference';
import { EmployeeError } from '@/lib/employees/service';
import { bankSchema, departmentSchema } from '@/lib/employees/validation';
import { assertPermission } from '@/lib/rbac';
import type { ActionState } from './actions';

async function actor() {
  const user = await assertPermission('employees.edit');
  return { id: user.id, ip: await currentIp() };
}

function values(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === 'string') out[k] = v;
  return out;
}

const idSchema = z.string().trim().min(1).optional().or(z.literal('').transform(() => undefined));

async function run(fd: FormData, fn: () => Promise<void>, path: string, ok: string) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof EmployeeError) return { error: e.message, values: values(fd) };
    throw e;
  }
  revalidatePath(path);
  return { message: ok };
}

export async function saveDepartmentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const who = await actor();
  const id = idSchema.parse(fd.get('id') ?? '');
  const parsed = departmentSchema.safeParse(values(fd));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message, values: values(fd) };
  return run(
    fd,
    async () => {
      await db.$transaction((tx) => saveDepartment(tx, id ?? null, parsed.data, who));
    },
    '/employees/departments',
    id ? 'Department updated.' : 'Department added.',
  );
}

export async function deleteDepartmentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const who = await actor();
  const id = z.string().min(1).parse(fd.get('id'));
  return run(
    fd,
    () => db.$transaction((tx) => deleteDepartment(tx, id, who)),
    '/employees/departments',
    'Department deleted.',
  );
}

export async function saveBankAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const who = await actor();
  const id = idSchema.parse(fd.get('id') ?? '');
  const parsed = bankSchema.safeParse(values(fd));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message, values: values(fd) };
  return run(
    fd,
    async () => {
      await db.$transaction((tx) => saveBank(tx, id ?? null, parsed.data, who));
    },
    '/employees/banks',
    id ? 'Bank updated.' : 'Bank added.',
  );
}

export async function deleteBankAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const who = await actor();
  const id = z.string().min(1).parse(fd.get('id'));
  return run(
    fd,
    () => db.$transaction((tx) => deleteBank(tx, id, who)),
    '/employees/banks',
    'Bank deleted.',
  );
}
