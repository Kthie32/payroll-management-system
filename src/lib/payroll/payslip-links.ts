import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Secure payslip links (sent by email or SMS). The random token travels only in the link; the
 * database stores its SHA-256. After the employee confirms the last 4 digits of their phone number
 * (or their staff number), a short-lived signed cookie lets them view and download that one payslip.
 */

const TOKEN_BYTES = 32;
export const MAX_VERIFY_ATTEMPTS = 5;
export const ACCESS_MINUTES = 30;
const MS_PER_MINUTE = 60_000;
const LAST_DIGITS = 4;

export function newLinkToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashLinkToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Tokens are base64url of 32 bytes (43 characters). Anything else is rejected before a DB lookup. */
export function looksLikeToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

/** The employee's answer matches the last 4 digits of their phone, or their staff number. */
export function answerMatches(
  answer: string,
  employee: { phone: string | null; staffNo: string },
): boolean {
  const a = answer.trim();
  if (!a) return false;
  const digits = (employee.phone ?? '').replace(/\D/g, '');
  if (digits.length >= LAST_DIGITS && a === digits.slice(-LAST_DIGITS)) return true;
  return a.toUpperCase() === employee.staffNo.trim().toUpperCase();
}

export function accessCookieName(deliveryId: string): string {
  return `pslip_${deliveryId}`;
}

function sign(secret: string, deliveryId: string, expiresAt: number): string {
  return createHmac('sha256', secret)
    .update(`payslip:${deliveryId}:${expiresAt}`)
    .digest('base64url');
}

/** Cookie value granting access to one delivery until `now + ACCESS_MINUTES`. */
export function makeAccessCookie(secret: string, deliveryId: string, now: number): string {
  const expiresAt = now + ACCESS_MINUTES * MS_PER_MINUTE;
  return `${expiresAt}.${sign(secret, deliveryId, expiresAt)}`;
}

export function verifyAccessCookie(
  secret: string,
  deliveryId: string,
  value: string | undefined,
  now: number,
): boolean {
  if (!value) return false;
  const [expRaw, sig] = value.split('.');
  const expiresAt = Number(expRaw);
  if (!sig || !Number.isSafeInteger(expiresAt) || expiresAt < now) return false;
  const expected = Buffer.from(sign(secret, deliveryId, expiresAt));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
