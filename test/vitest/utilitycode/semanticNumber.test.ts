import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { semanticNumber } from '@/utils/semanticNumber'

describe('semanticNumber', () => {
  it('passes through native numbers', () => {
    expect(semanticNumber().parse(42)).toBe(42)
  })

  it.each([
    ['123', 123],
    ['-5', -5],
    ['1.5', 1.5],
    ['0', 0],
  ])('converts pure numeric string %s to number', (input, expected) => {
    expect(semanticNumber().parse(input)).toBe(expected)
  })

  it('does NOT convert empty string to 0 (unlike z.coerce.number)', () => {
    expect(() => semanticNumber().parse('')).toThrow()
  })

  it('does NOT convert null to 0 (unlike z.coerce.number)', () => {
    expect(() => semanticNumber().parse(null)).toThrow()
  })

  it('does NOT convert non-numeric strings', () => {
    expect(() => semanticNumber().parse('abc')).toThrow()
    expect(() => semanticNumber().parse('12px')).toThrow()
  })

  it('does NOT convert undefined', () => {
    expect(() => semanticNumber().parse(undefined)).toThrow()
  })

  it('respects inner schema constraints after conversion', () => {
    const positive = semanticNumber(z.number().int().positive())
    expect(positive.parse('5')).toBe(5)
    expect(() => positive.parse('-1')).toThrow() // converted to -1, fails positive
    expect(() => positive.parse('1.5')).toThrow() // converted to 1.5, fails int
  })

  it('works inside an object schema for LLM compatibility', () => {
    const s = z.strictObject({
      count: semanticNumber(z.number().int().nonnegative()),
    })
    // LLM may emit "3" instead of 3
    expect(s.parse({ count: '3' })).toEqual({ count: 3 })
    expect(s.parse({ count: 7 })).toEqual({ count: 7 })
  })
})
