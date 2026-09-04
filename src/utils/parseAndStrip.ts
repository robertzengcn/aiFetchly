/**
 * Minimal structural schema interface satisfied by BOTH zod v3 (`zod`) and
 * zod v4 (`zod/v4`) schemas. The project standard for new code is `zod/v4`,
 * while many existing entity schemas still use v3; typing against the narrow
 * `parse`/`safeParse` surface lets this helper accept either without forcing
 * a migration of every caller.
 */
export interface StrippableSchema<T> {
  parse(payload: unknown): T;
  safeParse(payload: unknown): StripParseResult<T>;
}

export type StripParseResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: {
        issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>;
      };
    };

/**
 * 在边界处过滤 unknown 字段 + 校验类型。
 *
 * 用途：外部数据（API 响应、worker 输出、抓取结果）写入 TypeORM entity 前，
 * 调用此 helper 把 schema 没声明的字段全部丢弃，避免脏字段污染数据库。
 *
 * 行为：
 *  - schema 用 `z.object({...})`（非 strict）：parse 默认 strip 未声明字段，
 *    返回的对象只包含 schema 声明的 key
 *  - 字段类型不匹配时抛错
 *  - schema 若用了 `.strictObject()` 则多余字段会抛错（不 strip）；
 *    建议在 parseAndStrip 场景用普通 `z.object`
 *
 * @param payload 任意来源数据
 * @param schema zod schema（推荐用 z.object，不要 z.strictObject）
 * @returns 校验 + 剥离后的对象
 */
export function parseAndStrip<T>(
  payload: unknown,
  schema: StrippableSchema<T>
): T {
  return schema.parse(payload);
}

/**
 * 安全版本：返回 { success, data | error }，不抛错。
 *
 * 适合「数据脏了就丢弃，不阻塞业务」的场景（如后台抓取任务）。
 */
export function safeParseAndStrip<T>(
  payload: unknown,
  schema: StrippableSchema<T>
): { success: true; data: T } | { success: false; error: string } {
  const r = schema.safeParse(payload);
  if (r.success) {
    return { success: true, data: r.data };
  }
  return {
    success: false,
    error: r.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; "),
  };
}
