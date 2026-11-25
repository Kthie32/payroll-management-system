'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auth, unstable_update } from '@/auth';
import { withAudit } from '@/lib/audit';
import { hashPassword, passwordPolicy, verifyPassword } from '@/lib/auth/password';
import { currentIp } from '@/lib/auth/request';
import { db } from '@/lib/db';

export interface ChangePasswordState {
  error?: string;
}

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: passwordPolicy,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { message: 'Passwords do not match' })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: 'New password must differ from the current one',
  });

export async function changePasswordAction(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect('/login');

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) redirect('/logout');
  if (!(await verifyPassword(user.passwordHash, parsed.data.currentPassword))) {
    return { error: 'Current password is incorrect.' };
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);
  const ip = await currentIp();
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false },
    });
    await withAudit(tx, {
      actorId: userId,
      action: 'PASSWORD_CHANGED',
      entity: 'User',
      entityId: userId,
      before: { mustChangePassword: user.mustChangePassword },
      after: { mustChangePassword: false },
      ip,
    });
  });

  await unstable_update({});
  redirect('/dashboard');
}
