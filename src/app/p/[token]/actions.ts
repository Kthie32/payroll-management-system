'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { currentIp } from '@/lib/auth/request';
import { messagingConfig } from '@/lib/messaging';
import {
  ACCESS_MINUTES,
  accessCookieName,
  answerMatches,
  makeAccessCookie,
  MAX_VERIFY_ATTEMPTS,
} from '@/lib/payroll/payslip-links';
import {
  failedAttempts,
  findDeliveryByToken,
  recordOpen,
  recordVerifyFailure,
} from '@/lib/payroll/server/delivery';

export interface VerifyState {
  error?: string;
}

const INVALID = 'This link is invalid or has expired. Ask the payroll office to send it again.';
const SECONDS_PER_MINUTE = 60;

/** Public: the employee confirms the last 4 digits of their phone (or their staff number). */
export async function verifyPayslipLinkAction(_p: VerifyState, fd: FormData): Promise<VerifyState> {
  const token = String(fd.get('token') ?? '');
  const answer = String(fd.get('answer') ?? '').slice(0, 40);
  const delivery = await findDeliveryByToken(token);
  if (!delivery) return { error: INVALID };
  const ip = await currentIp();
  const failures = await failedAttempts(delivery.id);
  if (failures >= MAX_VERIFY_ATTEMPTS) {
    return { error: 'Too many wrong attempts. Ask the payroll office to send a new link.' };
  }
  if (!answerMatches(answer, delivery.runEmployee.employee)) {
    await recordVerifyFailure(delivery.id, ip);
    const left = MAX_VERIFY_ATTEMPTS - failures - 1;
    return {
      error:
        left > 0
          ? `That does not match our records. ${left} attempt${left === 1 ? '' : 's'} left.`
          : 'Too many wrong attempts. Ask the payroll office to send a new link.',
    };
  }
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not set');
  (await cookies()).set(
    accessCookieName(delivery.id),
    makeAccessCookie(secret, delivery.id, Date.now()),
    {
      httpOnly: true,
      sameSite: 'lax',
      secure: messagingConfig().baseUrl.startsWith('https://'),
      path: '/',
      maxAge: ACCESS_MINUTES * SECONDS_PER_MINUTE,
    },
  );
  await recordOpen(delivery.id, ip);
  redirect(`/p/${token}`);
}
