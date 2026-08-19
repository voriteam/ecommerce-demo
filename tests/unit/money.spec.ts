import { describe, expect, it } from 'vitest'

import { centsToDecimal, decimalToCents, extendCents, sumCents } from '@/vori/money'

/**
 * Vori re-adds every line and rejects a transaction that does not reconcile, so
 * a rounding error here surfaces much later as a rejected sale. Everything
 * stays in integer cents for that reason; these pin the cases a float loses.
 */
describe('money', () => {
  it('formats cents as a two-place decimal, sign in front', () => {
    expect(centsToDecimal(499)).toBe('4.99')
    expect(centsToDecimal(500)).toBe('5.00')
    expect(centsToDecimal(5)).toBe('0.05')
    expect(centsToDecimal(0)).toBe('0.00')
    expect(centsToDecimal(100000)).toBe('1000.00')
    // promo_savings and discount_total are negative-monetary in the API.
    expect(centsToDecimal(-1234)).toBe('-12.34')
  })

  it('refuses a fractional cent rather than quietly rounding one away', () => {
    expect(() => centsToDecimal(4.5)).toThrow(TypeError)
  })

  it('parses the decimal strings the API returns, truncating past two places', () => {
    expect(decimalToCents('4.99')).toBe(499)
    expect(decimalToCents('12')).toBe(1200)
    expect(decimalToCents('-8.62')).toBe(-862)
    // Truncate rather than round up past the shelf price.
    expect(decimalToCents('4.999')).toBe(499)
  })

  it('returns null for anything that is not a number', () => {
    for (const value of [null, undefined, '', 'free']) {
      expect(decimalToCents(value)).toBeNull()
    }
  })

  it('survives the sums a float would not', () => {
    expect(centsToDecimal(sumCents([decimalToCents('0.10')!, decimalToCents('0.20')!]))).toBe('0.30')
    expect(centsToDecimal(sumCents(Array.from({ length: 11 }, () => 110)))).toBe('12.10')
  })

  it('extends a unit price by a whole quantity only', () => {
    expect(centsToDecimal(extendCents(499, 3))).toBe('14.97')
    for (const bad of [0, 1.5, -2]) {
      expect(() => extendCents(499, bad)).toThrow(RangeError)
    }
  })
})
