/**
 * Zod 错误格式化器。
 *
 * 接受任意「带 issues 数组」的对象，不直接依赖 ZodError 的完整类型，
 * 以兼容 zod v3/v4 的 issue 结构差异，并便于测试构造 fake。
 */

/**
 * 最小化的 zod issue 描述。字段对齐 zod v3 ZodIssue 的结构子集。
 */
export type AnyIssue = {
  code: string;
  path: (string | number)[];
  message: string;
  keys?: string[];
  expected?: string;
  received?: string;
};

/**
 * 接受任意「带 issues 数组」的错误对象。issues 字段为 unknown[] 以兼容
 * ZodError（其 ZodIssue 类型与本库 AnyIssue 不完全结构兼容），
 * 函数内部统一收敛为 AnyIssue[]。
 */
export type AnyZodError = {
  issues: readonly unknown[];
  message?: string;
};

function pathStr(p: (string | number)[]): string {
  return p.length ? p.join(".") : "<root>";
}

/**
 * 面向开发者/LLM 的错误信息（IPC handler 用）。
 * 输出英文，机器可读，分三类：
 *  1. Missing required params
 *  2. Unexpected params
 *  3. Type mismatch params
 *
 * 其余 issue 直接用其 message 拼接。
 */
export function formatZodValidationError(
  scope: string,
  error: AnyZodError
): string {
  // 把 issues 统一收敛为 AnyIssue[]，避免与库内 ZodIssue 类型 union 后字段访问受限
  const issues: AnyIssue[] = (error.issues ?? []).map((i) => i as AnyIssue);

  // "missing" = required field absent. In zod v3 the issue message is "Required"
  // and received is "undefined"; in v4 the message includes "received undefined".
  // Match both to stay version-tolerant.
  const isMissing = (i: AnyIssue): boolean =>
    i.code === "invalid_type" &&
    (i.received === "undefined" ||
      i.message.toLowerCase().includes("received undefined") ||
      i.message.toLowerCase() === "required");

  const missing = issues.filter(isMissing);
  const unexpected = issues.filter((i) => i.code === "unrecognized_keys");
  const mismatch = issues.filter(
    (i) => i.code === "invalid_type" && !isMissing(i)
  );
  const others = issues.filter(
    (i) => i.code !== "invalid_type" && i.code !== "unrecognized_keys"
  );

  const parts: string[] = [];
  if (missing.length) {
    parts.push(
      `Missing required params: ${missing
        .map((m) => pathStr(m.path))
        .join(", ")}`
    );
  }
  if (unexpected.length) {
    const keys = unexpected.flatMap((u) => u.keys ?? []);
    parts.push(`Unexpected params: ${keys.join(", ")}`);
  }
  if (mismatch.length) {
    parts.push(
      `Type mismatch: ${mismatch
        .map((m) => `${pathStr(m.path)} (${m.message})`)
        .join("; ")}`
    );
  }
  if (others.length) {
    parts.push(
      others.map((o) => `${pathStr(o.path)}: ${o.message}`).join("; ")
    );
  }

  const body = parts.length
    ? parts.join(" | ")
    : error.message ?? "validation failed";
  return `[${scope}] ${body}`;
}

/**
 * 面向用户的错误信息（配置加载用）。
 *
 * TODO(i18n): Phase 4 接入完整 6 语言错误码表（en/zh/es/fr/de/ja）。
 * 当前返回英文版本作为 fallback，保证 Phase 1 IPC 基础设施可用。
 */
export function formatZodError(
  scope: string,
  error: AnyZodError,
  _locale = "en"
): string {
  return formatZodValidationError(scope, error);
}
