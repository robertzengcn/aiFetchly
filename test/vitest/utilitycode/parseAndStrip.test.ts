import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { parseAndStrip, safeParseAndStrip } from '@/utils/parseAndStrip'

const schema = z.object({
  email: z.string().email(),
  phone: z.string().optional(),
})

describe('parseAndStrip', () => {
  it('strips unknown fields from input', () => {
    const payload = {
      email: 'a@b.com',
      phone: '123',
      rogue: 'should be removed',
      nested: { x: 1 },
    }
    const result = parseAndStrip(payload, schema)
    expect(result).toEqual({ email: 'a@b.com', phone: '123' })
    expect('rogue' in result).toBe(false)
    expect('nested' in result).toBe(false)
  })

  it('accepts minimal required fields', () => {
    const result = parseAndStrip({ email: 'x@y.com' }, schema)
    expect(result).toEqual({ email: 'x@y.com' })
  })

  it('throws on missing required field', () => {
    expect(() => parseAndStrip({ phone: '123' }, schema)).toThrow()
  })

  it('throws on wrong type', () => {
    expect(() =>
      parseAndStrip({ email: 123 }, schema),
    ).toThrow()
  })
})

describe('safeParseAndStrip', () => {
  it('returns success with stripped data on valid input', () => {
    const result = safeParseAndStrip(
      { email: 'a@b.com', rogue: 'x' },
      schema,
    )
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({ email: 'a@b.com' })
    }
  })

  it('returns failure with combined error message on invalid input', () => {
    const result = safeParseAndStrip({ phone: '123' }, schema)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toMatch(/email/)
    }
  })

  it('does not throw on null input', () => {
    expect(() => safeParseAndStrip(null, schema)).not.toThrow()
  })
})
