'use server';

import { AuthError } from 'next-auth';
import { redirect } from 'next/navigation';
import { signIn } from '@/auth';
import { requiredOnboardingStep } from '@/auth.config';
import { db } from '@/lib/db';
import { requires2fa } from '@/lib/rbac/core';

export interface LoginState {
  error?: string;
}

function safeCallback(raw: FormDataEntryValue | null): string {
  const v = typeof raw === 'string' ? raw : '';
  return v.startsWith('/') && !v.startsWith('//') ? v : '/dashboard';
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = formData.get('email');
  try {
    await signIn('credentials', {
      email,
      password: formData.get('password'),
      redirect: false,
    });
  } catch (e) {
    if (e instanceof AuthError) {
      const code = (e as AuthError & { code?: string }).code;
      if (code === 'locked') {
        return { error: 'This account is temporarily locked. Try again in 15 minutes.' };
      }
      return { error: 'Invalid email or password.' };
    }
    throw e;
  }

  // Send the user straight to their next onboarding step (if any) so the URL matches the page.
  // The middleware and requireUser() enforce the same rule independently.
  const user = await db.user.findUnique({
    where: { email: String(email ?? '').trim().toLowerCase() },
    select: {
      mustChangePassword: true,
      totpEnrolledAt: true,
      totpSecretEnc: true,
      roles: { select: { role: { select: { code: true } } } },
    },
  });
  const step = user
    ? requiredOnboardingStep({
        mustChangePassword: user.mustChangePassword,
        requires2fa: requires2fa(user.roles.map((r) => r.role.code)),
        totpEnrolled: Boolean(user.totpEnrolledAt && user.totpSecretEnc),
        twoFactorVerified: false,
      })
    : null;
  redirect(step ?? safeCallback(formData.get('callbackUrl')));
}
