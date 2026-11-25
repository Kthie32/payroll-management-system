import 'server-only';
import { randomUUID } from 'node:crypto';
import NextAuth, { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';
import { authConfig } from '@/auth.config';
import { db } from '@/lib/db';
import { withAudit } from '@/lib/audit';
import { LOCKOUT_MINUTES, MAX_FAILED_LOGINS, verifyPassword } from '@/lib/auth/password';
import { ipFromHeaders } from '@/lib/auth/request';
import { isValidTwoFactorProof } from '@/lib/auth/totp';
import { requires2fa } from '@/lib/rbac/core';

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

class LockedOut extends CredentialsSignin {
  override code = 'locked';
}

async function loadAuthState(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { roles: { include: { role: true } } },
  });
  if (!user || !user.isActive) return null;
  const roles = user.roles.map((r) => r.role.code);
  return {
    roles,
    mustChangePassword: user.mustChangePassword,
    totpEnrolled: Boolean(user.totpEnrolledAt && user.totpSecretEnc),
    requires2fa: requires2fa(roles),
  };
}

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;
        const ip = request instanceof Request ? ipFromHeaders(request.headers) : null;

        const user = await db.user.findUnique({
          where: { email },
          include: { roles: { include: { role: true } } },
        });

        if (!user || !user.isActive) {
          await db.$transaction((tx) =>
            withAudit(tx, {
              actorId: user?.id ?? null,
              action: 'LOGIN_FAILED',
              entity: 'User',
              entityId: user?.id ?? null,
              after: { email, reason: user ? 'inactive' : 'unknown_email' },
              ip,
            }),
          );
          return null;
        }

        const now = new Date();
        if (user.lockedUntil && user.lockedUntil > now) {
          await db.$transaction((tx) =>
            withAudit(tx, {
              actorId: user.id,
              action: 'LOGIN_FAILED',
              entity: 'User',
              entityId: user.id,
              after: { reason: 'locked', lockedUntil: user.lockedUntil },
              ip,
            }),
          );
          throw new LockedOut();
        }

        const ok = await verifyPassword(user.passwordHash, password);
        if (!ok) {
          const failed = user.failedLogins + 1;
          const lock = failed >= MAX_FAILED_LOGINS;
          await db.$transaction(async (tx) => {
            await tx.user.update({
              where: { id: user.id },
              data: {
                failedLogins: lock ? 0 : failed,
                lockedUntil: lock ? new Date(now.getTime() + LOCKOUT_MINUTES * 60_000) : null,
              },
            });
            await withAudit(tx, {
              actorId: user.id,
              action: lock ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED',
              entity: 'User',
              entityId: user.id,
              after: { reason: 'bad_password', failedLogins: failed },
              ip,
            });
          });
          return null;
        }

        await db.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: user.id },
            data: { failedLogins: 0, lockedUntil: null, lastLoginAt: now },
          });
          await withAudit(tx, {
            actorId: user.id,
            action: 'LOGIN_SUCCESS',
            entity: 'User',
            entityId: user.id,
            ip,
          });
        });

        const roles = user.roles.map((r) => r.role.code);
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          roles,
          mustChangePassword: user.mustChangePassword,
          totpEnrolled: Boolean(user.totpEnrolledAt && user.totpSecretEnc),
          requires2fa: requires2fa(roles),
          twoFactorVerified: false,
        };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user, trigger, session }) {
      if (user) {
        // Fresh sign-in: new session id; 2FA must be verified again for this session.
        token.sub = user.id;
        token.sid = randomUUID();
        token.roles = user.roles ?? [];
        token.mustChangePassword = user.mustChangePassword ?? true;
        token.totpEnrolled = user.totpEnrolled ?? false;
        token.requires2fa = user.requires2fa ?? false;
        token.twoFactorVerified = false;
        return token;
      }

      if (trigger === 'update' && token.sub) {
        // Never trust client-supplied session data: reload from the DB.
        const state = await loadAuthState(token.sub);
        if (!state) return null;
        Object.assign(token, state);
        const proof = (session as { twoFactorProof?: unknown } | undefined)?.twoFactorProof;
        if (proof !== undefined && isValidTwoFactorProof(token.sub, proof)) {
          token.twoFactorVerified = true;
        }
        if (!state.totpEnrolled) token.twoFactorVerified = false;
      }
      return token;
    },
  },
});
