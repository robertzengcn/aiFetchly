/**
 * Proxy AI Tools — shared types, Zod schemas, normalizers, and helpers.
 *
 * This module is intentionally free of database and Electron imports so it can
 * be unit-tested in isolation. The runtime service (`src/service/ProxyAiTools.ts`)
 * composes these pure building blocks with `ProxyModule` / `ProxyController`.
 *
 * Credential safety: every public result type is built from `SafeProxySummary`,
 * which NEVER carries `pass` or `password`. Credential presence is exposed only
 * as `hasPassword: boolean`.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Value types
// ---------------------------------------------------------------------------

export type ProxyProtocol = "http" | "https" | "socks4" | "socks5";

export type ProxyBasicStatus = "unknown" | "pass" | "failure";

export type ProxyGooglePassStatus = "not_checked" | "pass" | "fail";

const PROTOCOL_VALUES: ReadonlySet<string> = new Set<ProxyProtocol>([
  "http",
  "https",
  "socks4",
  "socks5",
]);

// ---------------------------------------------------------------------------
// Safe result types (LLM-facing) — never expose raw credentials
// ---------------------------------------------------------------------------

export interface SafeProxySummary {
  readonly id: number;
  readonly host: string;
  readonly port: string;
  readonly protocol?: ProxyProtocol;
  readonly username?: string;
  readonly hasPassword: boolean;
  readonly countryCode?: string;
  readonly addtime?: string;
  readonly checktime?: string;
  readonly status?: ProxyBasicStatus;
  readonly googlePass?: ProxyGooglePassStatus;
}

/**
 * Stable error envelope returned by every proxy AI tool on failure.
 * `PERMISSION_REQUIRED` / `AI_DISABLED` are reserved for higher layers; tools
 * surface validation, not-found, mismatch, and operational failures directly.
 */
export interface ProxyToolError {
  readonly success: false;
  readonly code:
    | "INVALID_INPUT"
    | "AI_DISABLED"
    | "PROXY_NOT_FOUND"
    | "EXPECTED_PROXY_MISMATCH"
    | "DUPLICATE_PROXY"
    | "CHECK_FAILED"
    | "IMPORT_FAILED"
    | "DELETE_FAILED"
    | "INTERNAL_ERROR"
    | "UNSUPPORTED_OPERATION";
  readonly error: string;
}

export type ProxyToolResult<T> = T | ProxyToolError;

export interface ProxyListToolResult {
  readonly success: true;
  readonly proxies: readonly SafeProxySummary[];
  readonly total: number;
  readonly page: number;
  readonly size: number;
  readonly credentialsRedacted: true;
}

export interface ProxyGetToolResult {
  readonly success: true;
  readonly proxy: SafeProxySummary;
  readonly credentialsRedacted: true;
}

export interface ProxyCreateToolResult {
  readonly success: true;
  readonly created: true;
  readonly proxy: SafeProxySummary;
}

export interface ProxyUpdateToolResult {
  readonly success: true;
  readonly updated: true;
  readonly proxy: SafeProxySummary;
  readonly changedFields: readonly string[];
}

export interface ProxyDeleteToolResult {
  readonly success: true;
  readonly deleted: true;
  readonly proxy: SafeProxySummary;
}

export interface ProxyImportToolResult {
  readonly success: true;
  readonly importedCount: number;
  readonly skippedDuplicateCount: number;
  readonly invalidCount: number;
  readonly invalidRows?: readonly ProxyImportInvalidRow[];
  readonly proxies: readonly SafeProxySummary[];
  readonly credentialsRedacted: true;
}

export interface ProxyImportInvalidRow {
  readonly index: number;
  readonly error: string;
}

export interface ProxyCheckItemResult {
  readonly proxy: SafeProxySummary;
  readonly basic?: "pass" | "failure";
  readonly googlePass?: "pass" | "fail";
  readonly error?: string;
}

export interface ProxyCheckToolResult {
  readonly success: true;
  readonly checkedCount: number;
  readonly basicPassCount: number;
  readonly basicFailCount: number;
  readonly googlePassCount: number;
  readonly googleFailCount: number;
  readonly results: readonly ProxyCheckItemResult[];
}

export interface ProxyRemoveFailedToolResult {
  readonly success: true;
  readonly dryRun: boolean;
  readonly candidateCount: number;
  readonly deletedCount: number;
  readonly proxies: readonly SafeProxySummary[];
}

// ---------------------------------------------------------------------------
// Batch check interfaces (used by ProxyController.checkProxyBatch)
// ---------------------------------------------------------------------------

export type ProxyCheckMode = "basic" | "google" | "both";

export interface ProxyCheckBatchOptions {
  readonly proxyIds?: readonly number[];
  readonly checkAll?: boolean;
  readonly mode: ProxyCheckMode;
  readonly timeoutMs: number;
  readonly concurrency: number;
  readonly onProgress?: (progress: ProxyCheckProgress) => void;
}

export interface ProxyCheckProgress {
  readonly checked: number;
  readonly total: number;
  readonly proxyId: number;
  readonly basic?: "pass" | "failure";
  readonly googlePass?: "pass" | "fail";
  readonly error?: string;
}

export interface ProxyCheckItemInternal {
  readonly proxyId: number;
  readonly basic?: "pass" | "failure";
  readonly googlePass?: "pass" | "fail";
  readonly error?: string;
}

export interface ProxyCheckBatchResult {
  readonly total: number;
  readonly checked: number;
  readonly results: readonly ProxyCheckItemInternal[];
}

// ---------------------------------------------------------------------------
// Status + protocol mapping helpers
// ---------------------------------------------------------------------------

/**
 * Map a numeric basic-check status to the LLM-safe status string.
 *
 * The model layer hardcodes `status: 1` for freshly created proxies that have
 * never been checked, so `1` is only treated as `"pass"` when a `checktime`
 * is present (i.e. the controller enrichment confirmed a real check record).
 */
export function mapBasicStatus(
  status: number | undefined | null,
  hasChecktime: boolean
): ProxyBasicStatus {
  if (status === 2) {
    return "failure";
  }
  if (status === 1 && hasChecktime) {
    return "pass";
  }
  return "unknown";
}

export function mapGooglePassStatus(
  googlePass: number | undefined | null
): ProxyGooglePassStatus {
  if (googlePass === 1) {
    return "pass";
  }
  if (googlePass === 2) {
    return "fail";
  }
  return "not_checked";
}

export function mapProtocol(
  protocol: string | undefined | null
): ProxyProtocol | undefined {
  if (typeof protocol !== "string") {
    return undefined;
  }
  const normalized = protocol.trim().toLowerCase();
  return PROTOCOL_VALUES.has(normalized)
    ? (normalized as ProxyProtocol)
    : undefined;
}

// ---------------------------------------------------------------------------
// Normalizers (pure; return undefined when input is invalid)
// ---------------------------------------------------------------------------

export function normalizeProtocol(input: unknown): ProxyProtocol | undefined {
  if (typeof input !== "string") {
    return undefined;
  }
  const normalized = input.trim().toLowerCase();
  return PROTOCOL_VALUES.has(normalized)
    ? (normalized as ProxyProtocol)
    : undefined;
}

/** Normalize a port to a string integer in [1, 65535], or undefined. */
export function normalizePort(input: unknown): string | undefined {
  let raw: string;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) {
      return undefined;
    }
    raw = String(input);
  } else if (typeof input === "string") {
    raw = input.trim();
  } else {
    return undefined;
  }
  const num = Number(raw);
  if (!Number.isInteger(num) || num < 1 || num > 65535) {
    return undefined;
  }
  return String(num);
}

/**
 * Normalize a host. MVP rules: non-empty after trim, no internal whitespace,
 * no URL path/query/hash delimiters. IPv6 brackets are allowed.
 */
export function normalizeHost(input: unknown): string | undefined {
  if (typeof input !== "string") {
    return undefined;
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (/\s/.test(trimmed) || /[/?#]/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

/** Normalize an optional string. undefined => undefined; null => null. */
export function normalizeNullableString(
  input: unknown
): string | null | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (input === null) {
    return null;
  }
  if (typeof input === "string") {
    return input.trim();
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Safe proxy summary mapper
// ---------------------------------------------------------------------------

/**
 * Loose input shape accepted by the safe-summary mapper. Accepts both the
 * list shape (`username` / `password`) and the detail shape (`user` / `pass`).
 */
export interface SafeProxySummaryInput {
  readonly id?: number;
  readonly host?: string;
  readonly port?: string | number;
  readonly protocol?: string;
  readonly username?: string;
  readonly user?: string;
  readonly password?: string;
  readonly pass?: string;
  readonly country_code?: string;
  readonly addtime?: string;
  readonly checktime?: string;
  readonly status?: number;
  readonly googlePass?: number;
}

export function toSafeProxySummary(
  input: SafeProxySummaryInput
): SafeProxySummary {
  if (
    input.id === undefined ||
    input.host === undefined ||
    input.port === undefined
  ) {
    throw new Error("Cannot map incomplete proxy to safe summary");
  }
  const port = normalizePort(input.port) ?? String(input.port);
  const username = input.username ?? input.user;
  const hasPassword = Boolean(input.password ?? input.pass);
  const hasChecktime = Boolean(input.checktime);

  const summary: SafeProxySummary = {
    id: input.id,
    host: input.host,
    port,
    protocol: mapProtocol(input.protocol),
    ...(username !== undefined ? { username } : {}),
    hasPassword,
    ...(input.country_code !== undefined
      ? { countryCode: input.country_code }
      : {}),
    ...(input.addtime !== undefined ? { addtime: input.addtime } : {}),
    ...(input.checktime !== undefined ? { checktime: input.checktime } : {}),
    status: mapBasicStatus(input.status, hasChecktime),
    googlePass: mapGooglePassStatus(input.googlePass),
  };
  return summary;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const protocolField = z
  .string()
  .trim()
  .transform((value) => value.toLowerCase())
  .pipe(z.enum(["http", "https", "socks4", "socks5"]));

const portField = z
  .union([z.string(), z.number()])
  .transform((value, ctx): string => {
    const normalized = normalizePort(value);
    if (normalized === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "port must be an integer between 1 and 65535",
      });
      return z.NEVER;
    }
    return normalized;
  });

const hostField = z
  .string()
  .trim()
  .min(1, "host is required")
  .refine((value) => !/\s/.test(value) && !/[/?#]/.test(value), {
    message:
      "host must not contain whitespace or URL path/query/hash characters",
  });

const optionalNullableString = z.string().trim().nullable().optional();

/** Reusable per-row shape for create / import. */
const proxyRowSchema = z.object({
  host: hostField,
  port: portField,
  protocol: protocolField,
  user: z.string().trim().optional(),
  pass: z.string().optional(),
  country_code: z.string().trim().optional(),
});

export type ProxyListInput = z.infer<typeof proxyListSchema>;
export const proxyListSchema = z.object({
  page: z.number().int().min(0).default(0),
  size: z.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
  status: z.enum(["unknown", "pass", "failure"]).optional(),
  googlePass: z.enum(["not_checked", "pass", "fail"]).optional(),
});

export type ProxyGetInput = z.infer<typeof proxyGetSchema>;
export const proxyGetSchema = z.object({
  proxy_id: z.number().int().positive("proxy_id must be a positive integer"),
});

export type ProxyCreateInput = z.infer<typeof proxyCreateSchema>;
export const proxyCreateSchema = proxyRowSchema;

export type ProxyUpdateInput = z.infer<typeof proxyUpdateSchema>;
export const proxyUpdateSchema = z
  .object({
    proxy_id: z.number().int().positive("proxy_id must be a positive integer"),
    host: hostField.optional(),
    port: portField.optional(),
    protocol: protocolField.optional(),
    user: optionalNullableString,
    pass: optionalNullableString,
    country_code: optionalNullableString,
    expected_host: z.string().trim().optional(),
    expected_port: portField.optional(),
  })
  .refine(
    (value) =>
      value.host !== undefined ||
      value.port !== undefined ||
      value.protocol !== undefined ||
      value.user !== undefined ||
      value.pass !== undefined ||
      value.country_code !== undefined,
    { message: "At least one update field is required" }
  );

export type ProxyDeleteInput = z.infer<typeof proxyDeleteSchema>;
export const proxyDeleteSchema = z.object({
  proxy_id: z.number().int().positive("proxy_id must be a positive integer"),
  expected_host: z.string().trim().optional(),
  expected_port: portField.optional(),
});

export type ProxyImportInput = z.infer<typeof proxyImportSchema>;
export const proxyImportSchema = z.object({
  proxies: z.array(proxyRowSchema).min(1).max(500),
  duplicatePolicy: z.enum(["skip", "fail"]).default("skip"),
});

export type ProxyCheckInput = z.infer<typeof proxyCheckSchema>;
export const proxyCheckSchema = z
  .object({
    proxy_ids: z.array(z.number().int().positive()).min(1).max(100).optional(),
    check_all: z.boolean().optional(),
    filters: proxyListSchema
      .pick({ status: true, googlePass: true, search: true })
      .optional(),
    mode: z.enum(["basic", "google", "both"]).default("both"),
    timeout_ms: z.number().int().min(1000).max(60000).default(15000),
    concurrency: z.number().int().min(1).max(10).default(3),
  })
  .refine(
    (value) => {
      const selectors = [
        Boolean(value.proxy_ids && value.proxy_ids.length > 0),
        Boolean(value.check_all),
        Boolean(value.filters),
      ];
      return selectors.filter(Boolean).length === 1;
    },
    {
      message: "Provide exactly one of proxy_ids, check_all, or filters",
    }
  );

export type ProxyRemoveFailedInput = z.infer<typeof proxyRemoveFailedSchema>;
export const proxyRemoveFailedSchema = z.object({
  failureType: z.enum(["basic", "google", "either"]).default("basic"),
  // Default true (safe): an omitted dry_run lists candidates instead of
  // deleting. This matches the registry description and the design's
  // "always dry-run first" guidance; deletion only happens on explicit
  // dry_run: false (still gated by requiresConfirmation).
  dry_run: z.boolean().default(true),
  max_delete: z.number().int().min(1).max(500).default(100),
});

// ---------------------------------------------------------------------------
// Concurrency helper (no external dependency)
// ---------------------------------------------------------------------------

/**
 * Run `worker` over `items` with at most `concurrency` in flight.
 *
 * - Preserves input order in the returned results array.
 * - A worker that rejects records `undefined` at its index and does NOT abort
 *   the batch; callers decide how to treat failures.
 */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<(R | undefined)[]> {
  const limited = Math.max(1, Math.min(concurrency, items.length));
  const results: (R | undefined)[] = new Array(items.length).fill(undefined);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      try {
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      } catch {
        results[currentIndex] = undefined;
      }
    }
  }

  const workers = Array.from({ length: limited }, () => runWorker());
  await Promise.all(workers);
  return results;
}
