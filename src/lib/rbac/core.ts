import type { RoleCode } from '@prisma/client';
import { ROLE_PERMISSIONS, ROLES_REQUIRING_2FA, type Permission } from './permissions';

/** Pure permission check — safe in middleware, server and client code. */
export function can(
  roles: readonly RoleCode[] | undefined | null,
  permission: Permission,
): boolean {
  if (!roles) return false;
  return roles.some((r) => ROLE_PERMISSIONS[r]?.includes(permission));
}

export function permissionsFor(roles: readonly RoleCode[]): Permission[] {
  return [...new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r] ?? []))].sort();
}

export function requires2fa(roles: readonly RoleCode[]): boolean {
  return roles.some((r) => ROLES_REQUIRING_2FA.includes(r));
}

export class ForbiddenError extends Error {
  constructor(public readonly permission: string) {
    super(`FORBIDDEN: missing ${permission}`);
    this.name = 'ForbiddenError';
  }
}
