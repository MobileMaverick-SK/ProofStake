import { describe, expect, it } from 'vitest';
import { fromDecimalString, toDecimalString, usd } from '../src/core/shared';

describe('Money', () => {
  it('is integer cents and refuses anything else', () => {
    expect(usd(2000)).toEqual({ cents: 2000, currency: 'USD' });
    expect(() => usd(19.99)).toThrow(RangeError);
    expect(() => usd(-1)).toThrow(RangeError);
    expect(() => usd(Number.NaN)).toThrow(RangeError);
  });

  it.each([
    [2000, '20.00'],
    [2050, '20.50'],
    [5, '0.05'],
    [0, '0.00'],
    [123456, '1234.56'],
  ])('formats %i cents as "%s" for PayPal', (cents, text) => {
    expect(toDecimalString(usd(cents))).toBe(text);
    expect(fromDecimalString(text).cents).toBe(cents);
  });

  it('parses PayPal amounts without floating point error', () => {
    expect(fromDecimalString('19.99').cents).toBe(1999);
    expect(fromDecimalString('0.1').cents).toBe(10);
    expect(fromDecimalString('7').cents).toBe(700);
    expect(() => fromDecimalString('1.999')).toThrow(RangeError);
    expect(() => fromDecimalString('-5.00')).toThrow(RangeError);
    expect(() => fromDecimalString('abc')).toThrow(RangeError);
  });
});
