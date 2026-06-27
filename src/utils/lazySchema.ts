/**
 * 延迟构造 Schema，首次调用后缓存。
 *
 * 设计目的：
 * 1. 解决 schema 跨模块循环依赖（factory 在首次调用时才执行）
 * 2. 保证引用恒等 —— 同一 lazySchema 多次调用返回同一 ZodType 实例，
 *    使 WeakMap 缓存（zodToJsonSchema）生效
 *
 * 参考：Claude Code 的 lazySchema 实现
 */
export function lazySchema<T>(factory: () => T): () => T {
  let cached: T | undefined
  return () => (cached ??= factory())
}
