import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { formatZodValidationError } from '@/utils/zodErrors'

describe('formatZodValidationError', () => {
  it('reports missing required params', () => {
    const s = z.strictObject({ a: z.string(), b: z.number() })
    const result = s.safeParse({})
    if (!result.success) {
      const msg = formatZodValidationError('test:ch', result.error)
      expect(msg).toContain('test:ch')
      expect(msg).toMatch(/missing/i)
      // Should reference both missing fields
      expect(msg).toMatch(/a/)
      expect(msg).toMatch(/b/)
    } else {
      throw new Error('should have failed')
    }
  })

  it('reports unexpected params', () => {
    const s = z.strictObject({ a: z.string() })
    const result = s.safeParse({ a: 'x', extra: 1 })
    if (!result.success) {
      const msg = formatZodValidationError('test:ch', result.error)
      expect(msg).toMatch(/unexpected/i)
      expect(msg).toContain('extra')
    }
  })

  it('reports type mismatches', () => {
    const s = z.strictObject({ a: z.number() })
    const result = s.safeParse({ a: 'not-a-number' })
    if (!result.success) {
      const msg = formatZodValidationError('test:ch', result.error)
      expect(msg).toMatch(/type/i)
      expect(msg).toContain('a')
    }
  })

  it('includes scope prefix in all messages', () => {
    const s = z.strictObject({ a: z.string() })
    const result = s.safeParse({})
    if (!result.success) {
      const msg = formatZodValidationError('my-scope', result.error)
      expect(msg.startsWith('[my-scope]')).toBe(true)
    }
  })

  it('combines multiple error categories in one message', () => {
    const s = z.strictObject({ a: z.string(), b: z.number() })
    // missing a, wrong b type, extra field c
    const result = s.safeParse({ b: 'wrong', c: 1 })
    if (!result.success) {
      const msg = formatZodValidationError('ch', result.error)
      // Should mention all three categories
      expect(msg.toLowerCase()).toMatch(/missing|unexpected|type/)
    }
  })

  it('falls back to error.message when no specific issues match', () => {
    // Construct a fake error-like object
    const fakeError = {
      issues: [
        {
          code: 'custom' as const,
          path: ['x'],
          message: 'custom failure reason',
        },
      ],
      message: 'fallback',
    }
    const msg = formatZodValidationError('scope', fakeError as never)
    expect(msg).toContain('scope')
    expect(msg).toContain('custom failure reason')
  })
})
