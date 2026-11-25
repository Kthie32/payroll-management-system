import { describe, expect, it } from 'vitest';
import {
  ACCESS_MINUTES,
  answerMatches,
  hashLinkToken,
  looksLikeToken,
  makeAccessCookie,
  newLinkToken,
  verifyAccessCookie,
} from '../payslip-links';

describe('payslip link tokens', () => {
  it('are 43-char base64url, unique, and hashed to sha256 hex', () => {
    const a = newLinkToken();
    const b = newLinkToken();
    expect(a).not.toBe(b);
    expect(looksLikeToken(a)).toBe(true);
    expect(looksLikeToken('short')).toBe(false);
    expect(looksLikeToken(`${a.slice(0, 42)}/`)).toBe(false);
    expect(hashLinkToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashLinkToken(a)).toBe(hashLinkToken(a));
  });
});

describe('answerMatches', () => {
  const emp = { phone: '256772445566', staffNo: 'DEMO009' };
  it('accepts the last 4 phone digits or the staff number (any case)', () => {
    expect(answerMatches('5566', emp)).toBe(true);
    expect(answerMatches(' demo009 ', emp)).toBe(true);
  });
  it('rejects anything else, including an empty answer', () => {
    expect(answerMatches('4455', emp)).toBe(false);
    expect(answerMatches('', emp)).toBe(false);
    expect(answerMatches('1234', { phone: null, staffNo: 'X1' })).toBe(false);
  });
});

describe('access cookie', () => {
  const secret = 'test-secret';
  const now = 1_800_000_000_000;
  it('is valid for its delivery until it expires', () => {
    const c = makeAccessCookie(secret, 'd1', now);
    expect(verifyAccessCookie(secret, 'd1', c, now + 1000)).toBe(true);
    expect(verifyAccessCookie(secret, 'd1', c, now + ACCESS_MINUTES * 60_000 + 1)).toBe(false);
  });
  it('cannot be reused for another delivery, forged or tampered', () => {
    const c = makeAccessCookie(secret, 'd1', now);
    expect(verifyAccessCookie(secret, 'd2', c, now)).toBe(false);
    expect(verifyAccessCookie('other', 'd1', c, now)).toBe(false);
    const [exp, sig] = c.split('.');
    expect(verifyAccessCookie(secret, 'd1', `${Number(exp) + 1}.${sig}`, now)).toBe(false);
    expect(verifyAccessCookie(secret, 'd1', undefined, now)).toBe(false);
    expect(verifyAccessCookie(secret, 'd1', 'garbage', now)).toBe(false);
  });
});
