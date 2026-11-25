import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { CryptoError, decrypt, encrypt, last4, loadKey } from '@/lib/crypto';

const key = randomBytes(32);

function flipFirstByte(b64: string): string {
  const buf = Buffer.from(b64, 'base64');
  buf[0] = (buf[0] ?? 0) ^ 0xff;
  return buf.toString('base64');
}

describe('encrypt / decrypt', () => {
  it('round-trips', () => {
    const ct = encrypt('0123456789012', key);
    expect(ct.startsWith('v1:')).toBe(true);
    expect(ct).not.toContain('0123456789012');
    expect(decrypt(ct, key)).toBe('0123456789012');
  });

  it('round-trips unicode and empty strings', () => {
    expect(decrypt(encrypt('Ŋaŋŋa ✓', key), key)).toBe('Ŋaŋŋa ✓');
    expect(decrypt(encrypt('', key), key)).toBe('');
  });

  it('uses a fresh IV each time', () => {
    expect(encrypt('same', key)).not.toBe(encrypt('same', key));
  });

  it.each([1, 2, 3])('detects tampering in part %i (iv, tag, ciphertext)', (idx) => {
    const parts = encrypt('secret-value', key).split(':');
    parts[idx] = flipFirstByte(parts[idx]!);
    expect(() => decrypt(parts.join(':'), key)).toThrow(CryptoError);
  });

  it('fails with a wrong key', () => {
    const ct = encrypt('secret', key);
    expect(() => decrypt(ct, randomBytes(32))).toThrow(/wrong key or tampered/);
  });

  it.each(['', 'v1:a:b', 'v2:a:b:c', 'plain-text'])('rejects bad format %j', (bad) => {
    expect(() => decrypt(bad, key)).toThrow(CryptoError);
  });

  it('rejects truncated IV or tag', () => {
    const [v, iv, tag, ct] = encrypt('x', key).split(':');
    expect(() => decrypt([v, iv!.slice(0, 4), tag, ct].join(':'), key)).toThrow(/IV or tag/);
  });

  it('rejects keys of the wrong length', () => {
    expect(() => encrypt('x', randomBytes(16))).toThrow(CryptoError);
    const ct = encrypt('x', key);
    expect(() => decrypt(ct, randomBytes(16))).toThrow(CryptoError);
  });
});

describe('loadKey', () => {
  const original = process.env.FIELD_ENCRYPTION_KEY;
  afterEach(() => {
    process.env.FIELD_ENCRYPTION_KEY = original;
  });

  it('loads a 32-byte base64 key', () => {
    expect(loadKey(key.toString('base64')).equals(key)).toBe(true);
  });
  it('throws when missing', () => {
    expect(() => loadKey('')).toThrow(/not set/);
  });
  it('throws when the wrong length', () => {
    expect(() => loadKey(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });
  it('is used by default for encrypt/decrypt', () => {
    process.env.FIELD_ENCRYPTION_KEY = key.toString('base64');
    expect(decrypt(encrypt('default-key'))).toBe('default-key');
  });
});

describe('last4', () => {
  it('returns the last four non-space characters', () => {
    expect(last4('0123 4567 8901')).toBe('8901');
    expect(last4('12')).toBe('12');
    expect(last4('')).toBe('');
  });
});
