import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Field-level encryption (AES-256-GCM) for bank account numbers, NIN and TOTP secrets.
 * Format: `v1:<iv base64>:<auth tag base64>:<ciphertext base64>`.
 * The version prefix allows key rotation later.
 */

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export class CryptoError extends Error {
  override name = 'CryptoError';
}

/** Reads FIELD_ENCRYPTION_KEY (base64, 32 bytes). */
export function loadKey(raw: string | undefined = process.env.FIELD_ENCRYPTION_KEY): Buffer {
  if (!raw) throw new CryptoError('FIELD_ENCRYPTION_KEY is not set');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new CryptoError(
      `FIELD_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}`,
    );
  }
  return key;
}

function checkKey(key: Buffer): Buffer {
  if (key.length !== KEY_BYTES) throw new CryptoError(`key must be ${KEY_BYTES} bytes`);
  return key;
}

export function encrypt(plain: string, key: Buffer = loadKey()): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, checkKey(key), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

export function decrypt(payload: string, key: Buffer = loadKey()): string {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new CryptoError('ciphertext has an unknown format or version');
  }
  const [, ivB64, tagB64, ctB64] = parts as [string, string, string, string];
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new CryptoError('ciphertext has an invalid IV or tag');
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, checkKey(key), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch (err) {
    if (err instanceof CryptoError) throw err;
    throw new CryptoError('decryption failed: wrong key or tampered data');
  }
}

/** Last four non-space characters, for display (e.g. account ••••1234). */
export function last4(s: string): string {
  return s.replace(/\s+/g, '').slice(-4);
}
