import 'server-only';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

export { hashPassword, verifyPassword } from './argon';

export const passwordPolicy = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[a-z]/, 'Password needs a lowercase letter')
  .regex(/[A-Z]/, 'Password needs an uppercase letter')
  .regex(/[0-9]/, 'Password needs a digit');

/** A temporary password that satisfies the policy; shown to the admin once. */
export function generateTemporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(16);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${out}Aa9`;
}

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;
