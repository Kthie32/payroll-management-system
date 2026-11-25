import 'server-only';
import type { RoleCode } from '@prisma/client';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { requiredOnboardingStep } from '@/auth.config';
import { db } from '@/lib/db';
import { can, ForbiddenError } from './core';
import type { Permission } from './permissions';

export { can, permissionsFor, requires2fa, ForbiddenError } from './core';
export * from './permissions';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  roles: RoleCode[];
}

/**
 * Returns the fully-authenticated user (password changed, 2FA satisfied) or redirects.
 * Roles and the active flag are re-read from the database on every call, so deactivation and
 * role removal take effect immediately rather than when the JWT expires.
 */
export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  const u = session?.user;
  if (!u?.id) redirect('/login');
  const step = requiredOnboardingStep(u);
  if (step) redirect(step);

  const user = await db.user.findUnique({
    where: { id: u.id },
    select: {
      id: true,
      email: true,
      name: true,
      isActive: true,
      roles: { select: { role: { select: { code: true } } } },
    },
  });
  if (!user || !user.isActive) redirect('/logout');
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    roles: user.roles.map((r) => r.role.code),
  };
}

/** For server components/pages: redirects to /dashboard?denied=1 when the permission is missing. */
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.roles, permission)) redirect('/dashboard?denied=1');
  return user;
}

/** For server actions: throws ForbiddenError (never silently succeeds). */
export async function assertPermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.roles, permission)) throw new ForbiddenError(permission);
  return user;
}

/** Requires at least one of the given roles. */
export async function requireRole(...roles: RoleCode[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.roles.some((r) => roles.includes(r))) redirect('/dashboard?denied=1');
  return user;
}
