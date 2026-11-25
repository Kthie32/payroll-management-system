import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { decrypt, encrypt } from '@/lib/crypto';

authenticator.options = { window: 1 }; // accept the previous/next 30 s step for clock drift

const ISSUER = 'Payroll';

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function totpUri(email: string, secret: string): string {
  return authenticator.keyuri(email, ISSUER, secret);
}

export function totpQrDataUrl(email: string, secret: string): Promise<string> {
  return QRCode.toDataURL(totpUri(email, secret), { margin: 1, width: 220 });
}

export function verifyTotp(code: string, secret: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  try {
    return authenticator.verify({ token: code, secret });
  } catch {
    return false;
  }
}

/** Pending enrolment secret bound to the user, carried in the form (encrypted). */
export function sealPendingSecret(userId: string, secret: string): string {
  return encrypt(`${userId}:${secret}`);
}

export function openPendingSecret(userId: string, sealed: string): string | null {
  try {
    const plain = decrypt(sealed);
    const [uid, secret] = plain.split(':');
    return uid === userId && secret ? secret : null;
  } catch {
    return null;
  }
}

export const encryptTotpSecret = (secret: string) => encrypt(secret);
export const decryptTotpSecret = (enc: string) => decrypt(enc);

/**
 * Proof that the server verified TOTP just now. Created inside a server action and passed to
 * `unstable_update` (in-process; never sent to the browser). The jwt callback only accepts a
 * proof for the same user that is less than PROOF_TTL_MS old, so a client calling the session
 * endpoint cannot mark itself as verified.
 */
const PROOF_TTL_MS = 60_000;

function sign(userId: string, ts: number): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not set');
  return createHmac('sha256', secret).update(`2fa:${userId}:${ts}`).digest('base64url');
}

export function twoFactorProof(userId: string, now: number = Date.now()): string {
  return `${now}.${sign(userId, now)}`;
}

export function isValidTwoFactorProof(
  userId: string,
  proof: unknown,
  now: number = Date.now(),
): boolean {
  if (typeof proof !== 'string') return false;
  const [tsRaw, mac] = proof.split('.');
  const ts = Number(tsRaw);
  if (!mac || !Number.isSafeInteger(ts) || Math.abs(now - ts) > PROOF_TTL_MS) return false;
  const expected = Buffer.from(sign(userId, ts));
  const given = Buffer.from(mac);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
