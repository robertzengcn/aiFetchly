import { describe, it, expect } from 'vitest'
import { contactInfoWriteSchema } from '@/schemas/entity/contactInfo'

describe('contactInfoWriteSchema', () => {
  it('accepts a fully-populated contact info', () => {
    const r = contactInfoWriteSchema().safeParse({
      email: 'a@b.com',
      phone: '123',
      address: 'somewhere',
      socialLinks: ['https://x.com'],
      extractionStatus: 'completed',
    })
    expect(r.success).toBe(true)
  })

  it('accepts null for nullable fields', () => {
    const r = contactInfoWriteSchema().safeParse({
      email: null,
      phone: null,
      address: null,
      socialLinks: null,
    })
    expect(r.success).toBe(true)
  })

  it('strips unknown fields (parseAndStrip behavior)', () => {
    const r = contactInfoWriteSchema().safeParse({
      email: 'a@b.com',
      debugSource: 'puppeteer-v1.2',  // not in schema
      htmlSnippet: '<html>...</html>', // not in schema
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect('debugSource' in r.data).toBe(false)
      expect('htmlSnippet' in r.data).toBe(false)
      expect(r.data.email).toBe('a@b.com')
    }
  })

  it('rejects invalid extractionStatus enum', () => {
    const r = contactInfoWriteSchema().safeParse({
      extractionStatus: 'queued', // not in enum
    })
    expect(r.success).toBe(false)
  })

  it('rejects wrong type for socialLinks', () => {
    const r = contactInfoWriteSchema().safeParse({
      socialLinks: 'not-an-array',
    })
    expect(r.success).toBe(false)
  })

  it('accepts empty object (all fields optional)', () => {
    const r = contactInfoWriteSchema().safeParse({})
    expect(r.success).toBe(true)
  })

  it('rejects non-string email', () => {
    const r = contactInfoWriteSchema().safeParse({
      email: 123,
    })
    expect(r.success).toBe(false)
  })
})
