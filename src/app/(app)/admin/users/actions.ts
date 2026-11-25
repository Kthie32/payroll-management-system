'use server';

import { RoleCode } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withAudit } from '@/lib/audit';
import { generateTemporaryPassword, hashPassword } from '@/lib/auth/password';
import { currentIp } from '@/lib/auth/request';
import { db, type Tx } from '@/lib/db';
import { assertPermission } from '@/lib/rbac';

const roleSchema = z.nativeEnum(RoleCode);

// ── Create ──────────────────────────────────────────────────────────────

export interface CreateUserState {
  error?: string;
  created?: { email: string; tempPassword: string };
}

const createSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  roles: z.array(roleSchema).min(1, 'Pick at least one role'),
});

export async function createUserAction(
  _prev: CreateUserState,
  formData: FormData,
): Promise<CreateUserState> {
  const actor = await assertPermission('users.manage');
  const parsed = createSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    roles: formData.getAll('roles'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { name, email, roles } = parsed.data;

  if (await db.user.findUnique({ where: { email }, select: { id: true } })) {
    return { error: 'A user with that email already exists.' };
  }

  const tempPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(tempPassword);
  const ip = await currentIp();

  await db.$transaction(async (tx) => {
    const roleRows = await tx.role.findMany({ where: { code: { in: roles } } });
    const user = await tx.user.create({
      data: {
        name,
        email,
        passwordHash,
        mustChangePassword: true,
        roles: { create: roleRows.map((r) => ({ roleId: r.id })) },
      },
    });
    await withAudit(tx, {
      actorId: actor.id,
      action: 'USER_CREATED',
      entity: 'User',
      entityId: user.id,
      after: { email, name, roles, isActive: true, mustChangePassword: true },
      ip,
    });
  });

  revalidatePath('/admin/users');
  return { created: { email, tempPassword } };
}

// ── Manage ──────────────────────────────────────────────────────────────

export interface ManageUserState {
  error?: string;
  message?: string;
  tempPassword?: string;
}

const manageSchema = z.discriminatedUnion('intent', [
  z.object({ intent: z.literal('addRole'), userId: z.string().min(1), role: roleSchema }),
  z.object({ intent: z.literal('removeRole'), userId: z.string().min(1), role: roleSchema }),
  z.object({ intent: z.literal('deactivate'), userId: z.string().min(1) }),
  z.object({ intent: z.literal('reactivate'), userId: z.string().min(1) }),
  z.object({ intent: z.literal('reset2fa'), userId: z.string().min(1) }),
  z.object({ intent: z.literal('resetPassword'), userId: z.string().min(1) }),
]);

async function otherActiveAdmins(tx: Tx, excludeUserId: string): Promise<number> {
  return tx.user.count({
    where: {
      id: { not: excludeUserId },
      isActive: true,
      roles: { some: { role: { code: 'SYSTEM_ADMIN' } } },
    },
  });
}

class UserActionError extends Error {}

export async function manageUserAction(
  _prev: ManageUserState,
  formData: FormData,
): Promise<ManageUserState> {
  const actor = await assertPermission('users.manage');
  const parsed = manageSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Invalid request.' };
  const input = parsed.data;
  const ip = await currentIp();
  const self = input.userId === actor.id;

  try {
    const result = await db.$transaction(async (tx): Promise<ManageUserState> => {
      const user = await tx.user.findUnique({
        where: { id: input.userId },
        include: { roles: { include: { role: true } } },
      });
      if (!user) throw new UserActionError('User not found.');
      const currentRoles = user.roles.map((r) => r.role.code);
      const audit = (action: string, before: unknown, after: unknown) =>
        withAudit(tx, {
          actorId: actor.id,
          action,
          entity: 'User',
          entityId: user.id,
          before,
          after,
          ip,
        });

      switch (input.intent) {
        case 'addRole': {
          if (currentRoles.includes(input.role)) return { message: 'Role already assigned.' };
          const role = await tx.role.findUniqueOrThrow({ where: { code: input.role } });
          await tx.userRole.create({ data: { userId: user.id, roleId: role.id } });
          await audit(
            'USER_ROLE_ADDED',
            { roles: currentRoles },
            { roles: [...currentRoles, input.role] },
          );
          return { message: 'Role added.' };
        }
        case 'removeRole': {
          if (!currentRoles.includes(input.role)) return { message: 'Role not assigned.' };
          if (input.role === 'SYSTEM_ADMIN') {
            if (self) throw new UserActionError('You cannot remove your own System Admin role.');
            if ((await otherActiveAdmins(tx, user.id)) === 0) {
              throw new UserActionError('At least one active System Admin must remain.');
            }
          }
          await tx.userRole.deleteMany({ where: { userId: user.id, role: { code: input.role } } });
          await audit(
            'USER_ROLE_REMOVED',
            { roles: currentRoles },
            { roles: currentRoles.filter((r) => r !== input.role) },
          );
          return { message: 'Role removed.' };
        }
        case 'deactivate': {
          if (self) throw new UserActionError('You cannot deactivate yourself.');
          if (
            currentRoles.includes('SYSTEM_ADMIN') &&
            (await otherActiveAdmins(tx, user.id)) === 0
          ) {
            throw new UserActionError('At least one active System Admin must remain.');
          }
          await tx.user.update({ where: { id: user.id }, data: { isActive: false } });
          await audit('USER_DEACTIVATED', { isActive: user.isActive }, { isActive: false });
          return { message: 'User deactivated.' };
        }
        case 'reactivate': {
          await tx.user.update({
            where: { id: user.id },
            data: { isActive: true, failedLogins: 0, lockedUntil: null },
          });
          await audit('USER_REACTIVATED', { isActive: user.isActive }, { isActive: true });
          return { message: 'User reactivated.' };
        }
        case 'reset2fa': {
          await tx.user.update({
            where: { id: user.id },
            data: { totpSecretEnc: null, totpEnrolledAt: null },
          });
          await audit(
            'USER_2FA_RESET',
            { totpEnrolled: Boolean(user.totpEnrolledAt) },
            { totpEnrolled: false },
          );
          return { message: 'Two-factor reset. The user will enrol again at next sign-in.' };
        }
        case 'resetPassword': {
          const tempPassword = generateTemporaryPassword();
          await tx.user.update({
            where: { id: user.id },
            data: {
              passwordHash: await hashPassword(tempPassword),
              mustChangePassword: true,
              failedLogins: 0,
              lockedUntil: null,
            },
          });
          await audit(
            'USER_PASSWORD_RESET',
            { mustChangePassword: user.mustChangePassword },
            { mustChangePassword: true },
          );
          return { message: 'Password reset.', tempPassword };
        }
      }
    });
    revalidatePath('/admin/users');
    return result;
  } catch (e) {
    if (e instanceof UserActionError) return { error: e.message };
    throw e;
  }
}
