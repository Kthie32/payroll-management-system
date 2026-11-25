import { describe, expect, it } from 'vitest';
import {
  assertSignedUgx,
  assertUgx,
  divRoundHalfUp,
  formatUgx,
  fromUgx,
  MoneyError,
  mulBp,
  toUgx,
} from '@/lib/money';

describe('assertUgx', () => {
  it('accepts non-negative safe integers', () => {
    expect(() => assertUgx(0)).not.toThrow();
    expect(() => assertUgx(Number.MAX_SAFE_INTEGER)).not.toThrow();
  });
  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '100', null, undefined, 10n])(
    'rejects %s',
    (v) => {
      expect(() => assertUgx(v, 'x')).toThrow(MoneyError);
    },
  );
  it('includes the label in the message', () => {
    expect(() => assertUgx(-5, 'basic')).toThrow(/basic/);
  });
});

describe('assertSignedUgx', () => {
  it('accepts negative integers and rejects floats', () => {
    expect(() => assertSignedUgx(-5)).not.toThrow();
    expect(() => assertSignedUgx(0.5)).toThrow(MoneyError);
  });
});

describe('divRoundHalfUp', () => {
  it('rounds half up', () => {
    expect(divRoundHalfUp(5, 2)).toBe(3);
    expect(divRoundHalfUp(7, 2)).toBe(4);
    expect(divRoundHalfUp(4, 3)).toBe(1);
    expect(divRoundHalfUp(5, 3)).toBe(2);
    expect(divRoundHalfUp(0, 7)).toBe(0);
  });
  it('rounds negatives away from zero at .5', () => {
    expect(divRoundHalfUp(-5, 2)).toBe(-3);
    expect(divRoundHalfUp(-4, 3)).toBe(-1);
  });
  it('is exact for large values', () => {
    expect(divRoundHalfUp(3_000_000 * 15, 30)).toBe(1_500_000);
    expect(divRoundHalfUp(Number.MAX_SAFE_INTEGER, 1)).toBe(Number.MAX_SAFE_INTEGER);
  });
  it.each([0, -1, 1.5, NaN])('rejects denominator %s', (d) => {
    expect(() => divRoundHalfUp(10, d)).toThrow(MoneyError);
  });
  it('rejects a non-integer numerator', () => {
    expect(() => divRoundHalfUp(1.5, 2)).toThrow(MoneyError);
  });
});

describe('mulBp', () => {
  it('applies basis points', () => {
    expect(mulBp(1_000_000, 500)).toBe(50_000);
    expect(mulBp(1_000_000, 1000)).toBe(100_000);
    expect(mulBp(1_000_000, 0)).toBe(0);
    expect(mulBp(1_000_000, 10_000)).toBe(1_000_000);
  });
  it('rounds half up', () => {
    expect(mulBp(10, 500)).toBe(1); // 0.5 → 1
    expect(mulBp(9, 500)).toBe(0); // 0.45 → 0
    expect(mulBp(30, 500)).toBe(2); // 1.5 → 2
    expect(mulBp(-10, 500)).toBe(-1);
  });
  it('avoids float error on large values', () => {
    expect(mulBp(9_007_199_254_740, 9_999)).toBe(9_006_298_534_815);
  });
  it.each([-1, 1.5])('rejects bp %s', (bp) => {
    expect(() => mulBp(100, bp)).toThrow(MoneyError);
  });
  it('throws when the result overflows', () => {
    expect(() => mulBp(Number.MAX_SAFE_INTEGER, 20_000)).toThrow(MoneyError);
  });
});

describe('formatUgx', () => {
  it('formats with thousands separators', () => {
    expect(formatUgx(1_000_000)).toBe('UGX 1,000,000');
    expect(formatUgx(0)).toBe('UGX 0');
    expect(formatUgx(-1500)).toBe('-UGX 1,500');
  });
  it('rejects non-integers', () => {
    expect(() => formatUgx(1.5)).toThrow(MoneyError);
  });
});

describe('toUgx / fromUgx', () => {
  it('round-trips', () => {
    expect(toUgx(fromUgx(761_750))).toBe(761_750);
    expect(fromUgx(0)).toBe(0n);
    expect(toUgx(-5n)).toBe(-5);
  });
  it('throws on unsafe bigint', () => {
    expect(() => toUgx(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(MoneyError);
    expect(() => toUgx(BigInt(Number.MIN_SAFE_INTEGER) - 1n)).toThrow(MoneyError);
  });
  it('rejects non-bigint input', () => {
    expect(() => toUgx(5 as unknown as bigint)).toThrow(MoneyError);
  });
  it('fromUgx rejects floats', () => {
    expect(() => fromUgx(1.2)).toThrow(MoneyError);
  });
});
