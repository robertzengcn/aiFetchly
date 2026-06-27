import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { lazySchema } from '@/utils/lazySchema'

describe('lazySchema', () => {
  it('defers factory execution until first call', () => {
    let executed = false
    const s = lazySchema(() => {
      executed = true
      return z.string()
    })
    expect(executed).toBe(false)
    s()
    expect(executed).toBe(true)
  })

  it('caches the factory result (reference identity)', () => {
    let calls = 0
    const s = lazySchema(() => {
      calls++
      return z.object({ a: z.string() })
    })
    const a = s()
    const b = s()
    expect(a).toBe(b)
    expect(calls).toBe(1)
  })

  it('does not share cache across different lazySchema instances', () => {
    const s1 = lazySchema(() => z.string())
    const s2 = lazySchema(() => z.string())
    expect(s1()).not.toBe(s2())
  })

  it('supports safeParse on the produced schema', () => {
    const s = lazySchema(() => z.strictObject({ x: z.number() }))
    expect(s().safeParse({ x: 1 }).success).toBe(true)
    expect(s().safeParse({ x: 'a' }).success).toBe(false)
  })
})
