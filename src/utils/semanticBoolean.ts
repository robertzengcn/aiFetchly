import { z } from 'zod'

/**
 * 仅当输入恰好是 "true"/"false" 字符串时转换为对应 boolean，
 * 否则原样透传给内部 schema 报错。
 *
 * 为什么不用 z.coerce.boolean()？
 * - z.coerce.boolean() 把任何非空字符串（包括 "false"）当作 true
 *
 * 用途：兼容 LLM 输出的字符串布尔值。
 */
export function semanticBoolean<T extends z.ZodType>(inner: T = z.boolean() as unknown as T) {
  return z.preprocess(
    (v: unknown) => (v === 'true' ? true : v === 'false' ? false : v),
    inner,
  )
}
