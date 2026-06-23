import { HookAuditEntry, HookAuditStatus } from "@/entityTypes/hookTypes";

/**
 * Structured audit logging for hook runs.
 *
 * The MVP writes to console only. Persistent audit (entity + module +
 * retention) is deferred to Phase 4 along with hook CRUD UI. Until
 * then we still emit entries so behavior is observable in dev and
 * crash logs.
 *
 * Secrets are redacted before any string is logged. Patterns cover
 * the common token/cookie/authorization leaks; this is defense-in-
 * depth — command hook inputs should never carry `Token` values in
 * the first place (see CommandHookExecutor env handling).
 */

const REDACTION_PATTERNS: ReadonlyArray<{ re: RegExp; replacement: string }> = [
  // OpenAI-style keys (sk-...)
  { re: /sk-[A-Za-z0-9_-]{16,}/g, replacement: "sk-[REDACTED]" },
  // Generic bearer / authorization headers
  { re: /[Bb]earer\s+[A-Za-z0-9_.-]{8,}/g, replacement: "bearer [REDACTED]" },
  {
    re: /([Aa]uthorization)\s*[:=]\s*["']?[A-Za-z0-9_.-]{8,}["']?/g,
    replacement: "$1: [REDACTED]",
  },
  // Common token-shaped query/JSON fields
  {
    re: /(_auth[A-Za-z]*|access_?token|refresh_?token|api_?key|password)\s*[:=]\s*["']?[^\s"']{4,}["']?/g,
    replacement: "$1: [REDACTED]",
  },
  // Cookie headers
  {
    re: /[Cc]ookie\s*[:=]\s*["']?[^\s"']{8,}/g,
    replacement: "cookie: [REDACTED]",
  },
];

export function redactSecrets(value: string): string {
  let out = value;
  for (const { re, replacement } of REDACTION_PATTERNS) {
    out = out.replace(re, replacement);
  }
  return out;
}

export interface HookAuditLogger {
  log(entry: HookAuditEntry): void;
}

/**
 * Default console-backed logger. Structured as a single JSON line so
 * downstream log shippers can parse it without regex.
 */
export const ConsoleHookAuditLogger: HookAuditLogger = {
  log(entry: HookAuditEntry): void {
    try {
      // Sanitize free-text fields. Numeric/enum fields are safe as-is.
      const sanitized: HookAuditEntry = {
        ...entry,
        reason: entry.reason ? redactSecrets(entry.reason) : undefined,
      };
      // eslint-disable-next-line no-console
      console.log(`[hook-audit] ${JSON.stringify(sanitized)}`);
    } catch {
      // Never let audit logging crash the chat stream.
    }
  },
};

/** Current logger holder. Tests can swap via `setHookAuditLoggerForTests`. */
let active: HookAuditLogger = ConsoleHookAuditLogger;

export function getHookAuditLogger(): HookAuditLogger {
  return active;
}

/** Test-only: redirect audit logs. */
export function setHookAuditLoggerForTests(logger: HookAuditLogger): void {
  active = logger;
}

/** Helper: build an entry with a single timestamp/status line. */
export function buildAuditEntry(args: {
  hookRunId: string;
  hookId: string;
  eventName: HookAuditEntry["eventName"];
  source: HookAuditEntry["source"];
  type: HookAuditEntry["type"];
  status: HookAuditStatus;
  matchQuery?: string;
  durationMs?: number;
  reason?: string;
  timestamp?: string;
}): HookAuditEntry {
  return {
    hookRunId: args.hookRunId,
    hookId: args.hookId,
    eventName: args.eventName,
    source: args.source,
    type: args.type,
    status: args.status,
    matchQuery: args.matchQuery,
    durationMs: args.durationMs,
    reason: args.reason,
    timestamp: args.timestamp ?? new Date().toISOString(),
  };
}
