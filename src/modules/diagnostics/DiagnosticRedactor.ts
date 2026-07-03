"use strict";

const REDACTED = "[REDACTED]";
const MAX_DEPTH = 5;
const MAX_PROPERTIES = 100;
const MAX_VALUE_LENGTH = 1024;
const SENSITIVE_KEY_RE =
  /^(password|passwd|secret|token|access_token|refresh_token|api_key|apikey|authorization|cookie)$/i;

const STRING_PATTERNS: ReadonlyArray<{ regex: RegExp; replacement: string }> = [
  // Authorization: Bearer <token>
  {
    regex: /(Authorization\s*:\s*)(?:Bearer\s+)[^\s,;]*/gi,
    replacement: `$1${REDACTED}`,
  },
  // access_token=..., refresh_token=..., api_key=..., password=...
  {
    regex:
      /((?:access_token|refresh_token|api_key|apikey|password|passwd|secret|token)=)[^&;\s]+/gi,
    replacement: `$1${REDACTED}`,
  },
  // query params ?token=...&code=...&state=...
  {
    regex:
      /([?&](?:token|access_token|refresh_token|code|state|api_key)=)[^&\s]+/gi,
    replacement: `$1${REDACTED}`,
  },
  // Cookie: <values>
  { regex: /(Cookie\s*:\s*).*/gi, replacement: `$1${REDACTED}` },
];

export function redactString(input: string): string {
  let out = input;
  for (const { regex, replacement } of STRING_PATTERNS) {
    out = out.replace(regex, replacement);
  }
  if (out.length > MAX_VALUE_LENGTH * 4) {
    out = out.slice(0, MAX_VALUE_LENGTH * 4) + "…[truncated]";
  }
  return out;
}

export function redactMetadata(input: unknown): Record<string, unknown> {
  const root = coerceObject(input);
  const out: Record<string, unknown> = {};
  const keys = Object.keys(root).slice(0, MAX_PROPERTIES);
  for (const k of keys) {
    if (SENSITIVE_KEY_RE.test(k)) {
      out[k] = REDACTED;
    } else {
      out[k] = walk(root[k], 1);
    }
  }
  if (Object.keys(root).length > MAX_PROPERTIES) {
    out["__truncated"] = true;
  }
  return out;
}

function coerceObject(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return { value: v as unknown };
}

function walk(value: unknown, depth: number): unknown {
  if (value === null) return null;
  if (typeof value === "string") return clampString(redactString(value));
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (
    typeof value === "function" ||
    typeof value === "symbol" ||
    typeof value === "bigint"
  ) {
    return clampString(redactString(String(value)));
  }
  if (typeof value === "undefined") return null;
  if (depth >= MAX_DEPTH) {
    return clampString(redactString(safeStringify(value)));
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_PROPERTIES).map((v) => walk(v, depth + 1));
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const keys = Object.keys(obj).slice(0, MAX_PROPERTIES);
    for (const k of keys) {
      if (SENSITIVE_KEY_RE.test(k)) {
        out[k] = REDACTED;
      } else {
        out[k] = walk(obj[k], depth + 1);
      }
    }
    return out;
  }
  return null;
}

function clampString(s: string): string {
  if (s.length <= MAX_VALUE_LENGTH) return s;
  return (
    s.slice(0, MAX_VALUE_LENGTH) +
    `…[truncated ${s.length - MAX_VALUE_LENGTH} chars]`
  );
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
