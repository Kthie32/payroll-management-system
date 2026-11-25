import type { RoleCode } from '@prisma/client';
import type { NextAuthConfig } from 'next-auth';

/** Fields this app stores in the Auth.js JWT. */
export interface AppToken {
  sub?: string;
  roles?: RoleCode[];
  mustChangePassword?: boolean;
  totpEnrolled?: boolean;
  twoFactorVerified?: boolean;
  requires2fa?: boolean;
}

/**
 * Edge-safe Auth.js config used by middleware: no Prisma, no argon2, no Node crypto.
 * The full config (providers, DB-backed jwt callback) lives in src/auth.ts.
 */

export const PUBLIC_PATHS = ['/login'];
const ONBOARDING = { password: '/change-password', enrol: '/2fa/enrol', verify: '/2fa/verify' };

/** Where a signed-in user must be sent before they can use the app, or null if they are done. */
export function requiredOnboardingStep(u: {
  mustChangePassword?: boolean;
  requires2fa?: boolean;
  totpEnrolled?: boolean;
  twoFactorVerified?: boolean;
}): string | null {
  if (u.mustChangePassword) return ONBOARDING.password;
  if (u.requires2fa && !u.totpEnrolled) return ONBOARDING.enrol;
  if (u.requires2fa && !u.twoFactorVerified) return ONBOARDING.verify;
  return null;
}

export const authConfig = {
  pages: { signIn: '/login' },
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60 },
  trustHost: true,
  providers: [],
  callbacks: {
    session({ session, token }) {
      const t = token as AppToken;
      session.user.id = t.sub ?? '';
      session.user.roles = t.roles ?? [];
      session.user.mustChangePassword = t.mustChangePassword ?? true;
      session.user.totpEnrolled = t.totpEnrolled ?? false;
      session.user.twoFactorVerified = t.twoFactorVerified ?? false;
      session.user.requires2fa = t.requires2fa ?? false;
      return session;
    },
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const user = auth?.user;
      const isPublic = PUBLIC_PATHS.includes(pathname);

      if (pathname === '/logout') return true;
      if (!user?.id) return isPublic; // false → redirect to /login with callbackUrl

      const step = requiredOnboardingStep(user);
      const onboardingPaths = Object.values(ONBOARDING);

      if (step && pathname !== step) return Response.redirect(new URL(step, request.nextUrl));
      if (!step && (isPublic || onboardingPaths.includes(pathname))) {
        return Response.redirect(new URL('/dashboard', request.nextUrl));
      }
      return true;
    },
  },
} satisfies NextAuthConfig;
