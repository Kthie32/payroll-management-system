'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auth, unstable_update } from '@/auth';
import { withAudit } from '@/lib/audit';
import { LOCKOUT_MINUTES, MAX_FAILED_LOGINS } from '@/lib/auth/password';
import { currentIp } from '@/lib/auth/request';
import {
  decryptTotpSecret,
  encryptTotpSecret,
  openPendingSecret,
  twoFactorProof,
  verifyTotp,
} from '@/lib/auth/totp';
import { db } from '@/lib/db';

export interface TotpState {
  error?: string;
}

const codeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code from your app');

async function sessionUserId(): Promise<string> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) redirect('/login');
  return id;
}

export async function enrolTotpAction(_prev: TotpState, formData: FormData): Promise<TotpState> {
  const userId = await sessionUserId();
  const code = codeSchema.safeParse(formData.get('code'));
  if (!code.success) return { error: code.error.issues[0]?.message };

  const secret = openPendingSecret(userId, String(formData.get('pending') ?? ''));
  if (!secret) return { error: 'Enrolment expired. Reload the page and scan the new code.' };
  if (!verifyTotp(code.data, secret)) return { error: 'That code is not valid. Try again.' };

  const ip = await currentIp();
  await db.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.totpEnrolledAt) throw new Error('ALREADY_ENROLLED');
    await tx.user.update({
      where: { id: userId },
      data: { totpSecretEnc: encryptTotpSecret(secret), totpEnrolledAt: new Date() },
    });
    await withAudit(tx, {
      actorId: userId,
      action: 'TOTP_ENROLLED',
      entity: 'User',
      entityId: userId,
      before: { totpEnrolled: false },
      after: { totpEnrolled: true },
      ip,
    });
  });

  await unstable_update({ twoFactorProof: twoFactorProof(userId) } as never);
  redirect('/dashboard');
}

export async function verifyTotpAction(_prev: TotpState, formData: FormData): Promise<TotpState> {
  const userId = await sessionUserId();
  const code = codeSchema.safeParse(formData.get('code'));
  if (!code.success) return { error: code.error.issues[0]?.message };

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) redirect('/logout');
  if (!user.totpSecretEnc || !user.totpEnrolledAt) redirect('/2fa/enrol');
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return { error: 'Too many attempts. Try again in 15 minutes.' };
  }

  const ip = await currentIp();
  if (!verifyTotp(code.data, decryptTotpSecret(user.totpSecretEnc))) {
    const failed = user.failedLogins + 1;
    const lock = failed >= MAX_FAILED_LOGINS;
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          failedLogins: lock ? 0 : failed,
          lockedUntil: lock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
        },
      });
      await withAudit(tx, {
        actorId: userId,
        action: lock ? 'ACCOUNT_LOCKED' : 'TOTP_FAILED',
        entity: 'User',
        entityId: userId,
        ip,
      });
    });
    return { error: 'That code is not valid. Try again.' };
  }

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { failedLogins: 0 } });
    await withAudit(tx, {
      actorId: userId,
      action: 'TOTP_VERIFIED',
      entity: 'User',
      entityId: userId,
      ip,
    });
  });

  await unstable_update({ twoFactorProof: twoFactorProof(userId) } as never);
  redirect('/dashboard');
}
