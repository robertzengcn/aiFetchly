import { z } from "zod";

/**
 * JSON Schema 类型（最小定义，足够 LLM function calling 使用）。
 * 避免引入 json-schema-typed 包。
 */
export type JsonSchema7Type = {
  type?: string;
  properties?: Record<string, JsonSchema7Type>;
  items?: JsonSchema7Type;
  required?: string[];
  enum?: (string | number)[];
  description?: string;
  additionalProperties?: boolean | JsonSchema7Type;
  anyOf?: JsonSchema7Type[];
  oneOf?: JsonSchema7Type[];
  allOf?: JsonSchema7Type[];
  $ref?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  [k: string]: unknown;
};

// WeakMap 依赖 lazySchema 保证的引用恒等
const cache = new WeakMap<z.ZodTypeAny, JsonSchema7Type>();

/**
 * 将 Zod schema 转 JSON Schema，供 LLM function calling 使用。
 *
 * 使用 zod 4 原生 z.toJSONSchema（target: "openapi-3.0"）。
 * unrepresentable: "any" 使 z.date()/bigint 等无法直接表达的类型
 * 降级为 {}，而不是抛错 —— AI 工具注册不应因单个字段崩溃。
 *
 * 缓存命中是关键优化：每次 AI 调用会转换数十到数百次。
 * 必须配合 lazySchema 使用 —— 若直接内联 z.object({...})，
 * 每次调用产生新引用，WeakMap 永远 miss。
 */
export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema7Type {
  const hit = cache.get(schema);
  if (hit) return hit;
  const result = z.toJSONSchema(schema, {
    target: "openapi-3.0",
    // io:"input" 匹配旧 zod-to-json-schema 的语义：带 default 的字段
    // 不进 required（LLM 可省略）、对象不附加 additionalProperties、
    // default 值仍写进 schema。默认的 io:"output" 会把带 default 的
    // 字段全部标成 required，改变 LLM function calling 契约。
    io: "input",
    unrepresentable: "any",
  }) as unknown as JsonSchema7Type;
  // 兜底移除可能附加的 $schema 字段，避免污染 LLM schema
  if (result && typeof result === "object" && "$schema" in result) {
    delete (result as { $schema?: unknown }).$schema;
  }
  cache.set(schema, result);
  return result;
}
