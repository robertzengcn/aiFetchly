import { z } from 'zod'

/**
 * 仅当输入是纯数字字符串（如 "123"、"-5"、"1.5"）时转换为 number，
 * 否则原样透传给内部 schema 报错。
 *
 * 为什么不用 z.coerce.number()？
 * - z.coerce.number() 会把 "" → 0、null → 0，掩盖 bug
 * - 也会把 "abc" → NaN 然后报错，错误信息混乱
 *
 * 用途：兼容 LLM 输出的字符串数字。
 */
export function semanticNumber<T extends z.ZodType>(inner: T = z.number() as unknown as T) {
  return z.preprocess((v: unknown) => {
    if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) {
      const n = Number(v)
      if (Number.isFinite(n)) return n
    }
    return v
  }, inner)
}
