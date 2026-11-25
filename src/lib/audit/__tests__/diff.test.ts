import { describe, expect, it } from 'vitest';
import { diffJson } from '../diff';
import { toAuditJson } from '../serialize';

describe('diffJson', () => {
  it('returns nothing for equal values', () => {
    expect(diffJson({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] })).toEqual([]);
  });

  it('reports changed, added and removed keys with dotted paths', () => {
    const d = diffJson({ a: 1, b: { c: 'x' }, gone: true }, { a: 2, b: { c: 'x', d: 3 } });
    expect(d).toEqual([
      { path: 'a', kind: 'changed', before: 1, after: 2 },
      { path: 'b.d', kind: 'added', after: 3 },
      { path: 'gone', kind: 'removed', before: true },
    ]);
  });

  it('diffs arrays by index', () => {
    expect(diffJson({ r: ['A'] }, { r: ['A', 'B'] })).toEqual([
      { path: 'r[1]', kind: 'added', after: 'B' },
    ]);
    expect(diffJson(['A', 'B'], ['A'])).toEqual([{ path: '[1]', kind: 'removed', before: 'B' }]);
  });

  it('treats null roots as creation and deletion', () => {
    expect(diffJson(null, { a: 1 })).toEqual([{ path: '(root)', kind: 'added', after: { a: 1 } }]);
    expect(diffJson({ a: 1 }, undefined)).toEqual([
      { path: '(root)', kind: 'removed', before: { a: 1 } },
    ]);
  });

  it('reports a type change as changed', () => {
    expect(diffJson({ a: [1] }, { a: 'x' })).toEqual([
      { path: 'a', kind: 'changed', before: [1], after: 'x' },
    ]);
  });
});

describe('toAuditJson', () => {
  it('serialises bigint, dates and nested values', () => {
    const at = new Date('2026-11-25T10:00:00.000Z');
    expect(toAuditJson({ amount: 1_000_000n, at, list: [1n], skip: undefined })).toEqual({
      amount: '1000000',
      at: '2026-11-25T10:00:00.000Z',
      list: ['1'],
    });
  });

  it('redacts secrets and *Enc fields', () => {
    expect(
      toAuditJson({
        email: 'a@b.c',
        passwordHash: 'h',
        totpSecretEnc: 's',
        ninEnc: null,
        accountNoEnc: 'x',
      }),
    ).toEqual({
      email: 'a@b.c',
      passwordHash: '[REDACTED]',
      totpSecretEnc: '[REDACTED]',
      ninEnc: null,
      accountNoEnc: '[REDACTED]',
    });
  });

  it('handles primitives and non-finite numbers', () => {
    expect(toAuditJson(undefined)).toBeNull();
    expect(toAuditJson('x')).toBe('x');
    expect(toAuditJson(true)).toBe(true);
    expect(toAuditJson(Number.NaN)).toBe('NaN');
  });

  it('stringifies Decimal-like objects', () => {
    const dec = { toFixed: () => '1.50', toString: () => '1.5' };
    expect(toAuditJson({ q: dec })).toEqual({ q: '1.5' });
  });
});
