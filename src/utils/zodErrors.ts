import type { ZodError } from "zod";

/**
 * 一个最小化的 zod issue 描述，兼容 v3。
 * 用结构化字段而非完整 ZodIssue 类型，便于构造测试 fake。
 */
type AnyIssue = {
  code: string;
  path: (string | number)[];
  message: string;
  keys?: string[];
  expected?: string;
  received?: string;
};

type AnyZodError = {
  issues: AnyIssue[];
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
  error: ZodError | AnyZodError
): string {
  const issues = error.issues ?? [];

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
  error: ZodError | AnyZodError,
  _locale = "en"
): string {
  return formatZodValidationError(scope, error);
}
