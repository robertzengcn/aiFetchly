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

/**
 * Persistent logger variant: writes audit entries to SQLite via
 * HookAuditModule while still mirroring to the console logger so
 * dev behavior stays observable even if the DB write fails.
 *
 * The `import("@/modules/HookAuditModule").HookAuditModule` type
 * reference is a lazy type-only import — it avoids a circular
 * module-load dependency: HookAuditModule imports BaseModule which
 * imports Token, and HookAuditService is imported by HookDispatcher
 * which is imported widely. Deferring the import keeps the module
 * graph acyclic at load time.
 */
export interface PersistentHookAuditLogger extends HookAuditLogger {
  setModule(module: import("@/modules/HookAuditModule").HookAuditModule): void;
}

class PersistentHookAuditLoggerImpl implements PersistentHookAuditLogger {
  private module?: import("@/modules/HookAuditModule").HookAuditModule;

  setModule(module: import("@/modules/HookAuditModule").HookAuditModule): void {
    this.module = module;
  }

  log(entry: HookAuditEntry): void {
    // Always log to console first so behavior is observable in dev
    // even if the DB write fails.
    ConsoleHookAuditLogger.log(entry);

    const mod = this.module;
    if (!mod) return;

    // Fire-and-forget — the dispatcher must never block on audit.
    void mod
      .recordEntry({
        hookRunId: entry.hookRunId,
        hookId: entry.hookId,
        eventName: entry.eventName,
        source: entry.source,
        type: entry.type,
        matchQuery: entry.matchQuery,
        status: entry.status,
        durationMs: entry.durationMs,
        reason: entry.reason,
      })
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[HookAuditService] persistent log failed:", err);
      });
  }
}

export const PersistentHookAuditLogger: PersistentHookAuditLogger =
  new PersistentHookAuditLoggerImpl();

/** Current logger holder. Tests can swap via `setHookAuditLoggerForTests`. */
let active: HookAuditLogger = ConsoleHookAuditLogger;

export function getHookAuditLogger(): HookAuditLogger {
  return active;
}

/**
 * Called once at app startup to switch from console-only to DB-backed
 * audit. The startup wiring (in main-process init) constructs a
 * HookAuditModule, calls PersistentHookAuditLogger.setModule(...),
 * then passes PersistentHookAuditLogger here.
 */
export function setHookAuditLogger(logger: HookAuditLogger): void {
  active = logger;
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
