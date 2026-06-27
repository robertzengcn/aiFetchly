import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { semanticBoolean } from '@/utils/semanticBoolean'

describe('semanticBoolean', () => {
  it('passes through native booleans', () => {
    expect(semanticBoolean().parse(true)).toBe(true)
    expect(semanticBoolean().parse(false)).toBe(false)
  })

  it.each([
    ['true', true],
    ['false', false],
  ])('converts literal string %s to %s', (input, expected) => {
    expect(semanticBoolean().parse(input)).toBe(expected)
  })

  it('does NOT convert non-boolean strings (unlike unsafe coercion)', () => {
    expect(() => semanticBoolean().parse('yes')).toThrow()
    expect(() => semanticBoolean().parse('1')).toThrow()
    expect(() => semanticBoolean().parse('')).toThrow()
  })

  it('does NOT treat truthy strings as true', () => {
    // The classic z.coerce.boolean trap: any non-empty string becomes true.
    // semanticBoolean must NOT do that.
    expect(() => semanticBoolean().parse('false')).not.toBe(true) // 'false' must NOT become true
    expect(semanticBoolean().parse('false')).toBe(false)
  })

  it('does NOT convert numbers (1/0 are ambiguous)', () => {
    expect(() => semanticBoolean().parse(1)).toThrow()
    expect(() => semanticBoolean().parse(0)).toThrow()
  })

  it('works inside an object schema for LLM compatibility', () => {
    const s = z.strictObject({ enabled: semanticBoolean() })
    expect(s.parse({ enabled: 'true' })).toEqual({ enabled: true })
    expect(s.parse({ enabled: false })).toEqual({ enabled: false })
  })
})
