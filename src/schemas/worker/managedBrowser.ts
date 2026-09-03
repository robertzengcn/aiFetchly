import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";
import { normalizedCookieSchema } from "@/schemas/accountCookies";
import {
  MANAGED_BROWSER_ACTION_LIMITS,
  MANAGED_BROWSER_MESSAGE_LIMITS,
  MANAGED_BROWSER_OBSERVATION_BUDGETS,
  MANAGED_BROWSER_PROTOCOL_VERSION,
} from "@/config/managedBrowser";

/**
 * Managed-browser worker protocol (technical design §8).
 *
 * TWO schemas: inbound (main → worker) and outbound (worker → main), both
 * strict discriminated unions validated with `safeParse` at the receiving
 * boundary (convention from `schemas/worker/_shared.ts`). Malformed messages
 * are DROPPED and counted; three drops stop the session with
 * `worker_protocol_violation`.
 *
 * SECRET RULES
 *  - `START_SESSION.cookies` and `REFRESHED_COOKIES.cookies` are the ONLY
 *    cookie-bearing messages. Validation errors for these messages must never
 *    be echoed raw to the renderer/LLM (their input could contain cookie
 *    values).
 *  - Proxy credentials appear only inside START_SESSION.proxy.
 *
 * Every message carries protocolVersion, sessionId, requestId, and a
 * monotonic sequence (FR-RUNTIME-003). For spontaneous worker events the
 * requestId is a worker-generated `evt-…` identifier.
 */

// ---------------------------------------------------------------------------
// Shared field schemas
// ---------------------------------------------------------------------------

const protocolVersionSchema = z.literal(MANAGED_BROWSER_PROTOCOL_VERSION);

const sessionIdSchema = z
  .string()
  .min(8)
  .max(64)
  .regex(/^mb_[A-Za-z0-9_-]+$/, "sessionId must be an opaque mb_ token");

const requestIdSchema = z.string().min(4).max(96);

const sequenceSchema = z.number().int().nonnegative();

const messageBase = {
  protocolVersion: protocolVersionSchema,
  sessionId: sessionIdSchema,
  requestId: requestIdSchema,
  sequence: sequenceSchema,
} as const;

const executableDescriptorSchema = z.strictObject({
  path: z.string().min(1).max(1024),
  source: z.enum(["managed", "configured", "system"]),
  product: z.literal("chrome"),
  version: z.string().min(1).max(32),
  majorVersion: z.number().int().positive(),
  architecture: z.string().min(1).max(32),
});

const launchPolicySchema = z.strictObject({
  headless: z.literal(false),
  locale: z.string().min(2).max(35).nullable(),
  timezoneId: z.string().min(3).max(64).nullable(),
  viewport: z.strictObject({
    width: z.number().int().positive().max(16384),
    height: z.number().int().positive().max(16384),
  }),
  windowSize: z.strictObject({
    width: z.number().int().positive().max(16384),
    height: z.number().int().positive().max(16384),
  }),
  userAgentOverride: z.string().min(1).max(512).nullable(),
  enabledStealthEvasions: z.array(z.string().min(1).max(64)).max(32),
  extraArgs: z.array(z.string().min(1).max(256)).max(64),
});

const storagePolicySchema = z.strictObject({
  temporaryProfilePath: z.string().min(1).max(1024),
  persistentCache: z.discriminatedUnion("enabled", [
    z.strictObject({
      enabled: z.literal(false),
      reasonCode: z.string().min(1).max(64),
    }),
    z.strictObject({
      enabled: z.literal(true),
      cachePath: z.string().min(1).max(1024),
      scopeToken: z.string().min(8).max(128),
      namespace: z.string().min(3).max(128),
    }),
  ]),
});

const platformDefinitionSchema = z.strictObject({
  platformId: z.number().int().positive(),
  platformName: z.string().min(1).max(64),
  loginUrl: z.string().url().max(2048),
  verificationUrl: z.string().url().max(2048),
  allowedDomainSuffixes: z.array(z.string().min(3).max(253)).min(1).max(32),
});

const proxyConfigSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("direct") }),
  z.strictObject({
    mode: z.enum(["http", "https"]),
    host: z.string().min(1).max(253),
    port: z.number().int().min(1).max(65535),
    username: z.string().min(1).max(256).optional(),
    // SECRET: same no-log rule as cookies. Never echoed in errors/logs.
    password: z.string().min(1).max(256).optional(),
  }),
]);

const handoffReasonSchema = z.enum([
  "login_required",
  "login_expired",
  "captcha_sensitive_flow",
  "mfa_prompt",
  "passkey_prompt",
  "password_field",
  "recovery_flow",
  "account_selection_ambiguous",
  "browser_permission_prompt",
  "destructive_action_unclear",
  "repeated_action_failure",
  "user_requested",
  "challenge_unresolved",
]);

const sessionStateSchema = z.enum([
  "starting",
  "validating_fingerprint",
  "applying_session",
  "verifying_login",
  "login_required",
  "user_login_in_progress",
  "verifying_manual_login",
  "ready",
  "running",
  "awaiting_approval",
  "challenge_detected",
  "challenge_resolving",
  "handoff",
  "stopping",
  "stopped",
  "failed",
]);

const errorCodeSchema = z.enum([
  "ai_disabled",
  "managed_browser_disabled",
  "account_not_found",
  "account_in_use",
  "global_session_limit",
  "session_cookie_missing",
  "browser_dependency_missing",
  "browser_incompatible",
  "fingerprint_mismatch",
  "proxy_unavailable",
  "navigation_blocked",
  "authentication_required",
  "challenge_requires_handoff",
  "challenge_provider_not_authorized",
  "challenge_provider_unavailable",
  "challenge_provider_timeout",
  "challenge_resolution_failed",
  "stale_page_reference",
  "action_not_allowed",
  "approval_required",
  "approval_expired",
  "script_rejected",
  "script_timeout",
  "result_too_large",
  "worker_protocol_violation",
  "worker_start_timeout",
  "worker_unresponsive",
  "chrome_disconnected",
  "worker_exited",
  "cancelled",
  "stop_timeout",
  "cookie_refresh_failed",
  "cookie_persistence_failed",
  "cache_disabled",
  "cache_incompatible",
  "cache_scope_active",
  "cache_clear_deferred",
  "cache_path_invalid",
  "cache_maintenance_failed",
  "cache_limit_invalid",
  "internal_error",
]);

const challengeKindSchema = z.enum([
  "captcha_image",
  "captcha_invisible",
  "robot_verification",
  "otp",
  "passkey",
  "password",
  "recovery",
  "ambiguous",
]);

const authenticationAssessmentSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("authenticated"),
    evidenceCodes: z.array(z.string().min(1).max(64)).max(16),
  }),
  z.strictObject({
    state: z.literal("unauthenticated"),
    evidenceCodes: z.array(z.string().min(1).max(64)).max(16),
  }),
  z.strictObject({
    state: z.literal("challenge"),
    challenge: challengeKindSchema,
  }),
  z.strictObject({
    state: z.literal("unknown"),
    reasonCode: z.string().min(1).max(64),
  }),
]);

const processIdentitySchema = z.strictObject({
  sessionId: sessionIdSchema,
  sessionNonce: z.string().min(8).max(64),
  workerPid: z.number().int().positive(),
  browserPid: z.number().int().positive(),
  executableSha256: z.string().length(64),
  executableVersion: z.string().min(1).max(32),
  launchedAtEpochMs: z.number().int().positive(),
});

// ---------------------------------------------------------------------------
// Structured action program (design §15.1 — P0 action set)
// ---------------------------------------------------------------------------

const elementRefSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(/^e_[A-Za-z0-9]+$/, "element ref must be an opaque e_ token");

export const browserActionSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("navigate"),
    url: z.string().url().max(2048),
  }),
  z.strictObject({
    type: z.literal("click"),
    ref: elementRefSchema,
    pageRevision: z.number().int().positive(),
  }),
  z.strictObject({
    type: z.literal("fill"),
    ref: elementRefSchema,
    pageRevision: z.number().int().positive(),
    value: z.string().max(4096),
  }),
  z.strictObject({
    type: z.literal("select"),
    ref: elementRefSchema,
    pageRevision: z.number().int().positive(),
    values: z.array(z.string().max(512)).min(1).max(32),
  }),
  z.strictObject({
    type: z.literal("press_key"),
    key: z.string().min(1).max(32),
  }),
  z.strictObject({
    type: z.literal("scroll"),
    direction: z.enum(["up", "down", "left", "right"]),
    amount: z.number().int().min(1).max(10000),
  }),
  z.strictObject({
    type: z.literal("wait_for"),
    condition: z.enum(["element", "navigation", "url", "text", "networkidle"]),
    ref: elementRefSchema.optional(),
    url: z.string().max(2048).optional(),
    text: z.string().max(256).optional(),
    timeoutMs: z
      .number()
      .int()
      .min(100)
      .max(MANAGED_BROWSER_ACTION_LIMITS.programWallTimeMs),
  }),
  z.strictObject({
    type: z.literal("extract"),
    refs: z
      .array(elementRefSchema)
      .min(1)
      .max(MANAGED_BROWSER_ACTION_LIMITS.maxExtractedItems),
  }),
]);

export const browserActionProgramSchema = z.strictObject({
  actions: z
    .array(browserActionSchema)
    .min(1)
    .max(MANAGED_BROWSER_ACTION_LIMITS.maxActionsPerProgram),
  /** Optional human-readable intent for audit (bounded, sanitized). */
  intent: z.string().max(300).optional(),
});

export type BrowserAction = z.infer<typeof browserActionSchema>;
export type BrowserActionProgram = z.infer<typeof browserActionProgramSchema>;

// ---------------------------------------------------------------------------
// Inbound union (main → worker)
// ---------------------------------------------------------------------------

const startSessionMessageSchema = z.strictObject({
  ...messageBase,
  type: z.literal("START_SESSION"),
  executable: executableDescriptorSchema,
  launchPolicy: launchPolicySchema,
  storagePolicy: storagePolicySchema,
  platform: platformDefinitionSchema,
  proxy: proxyConfigSchema.nullable(),
  /** SECRET payload: allowlisted, domain-filtered cookies. */
  cookies: z.array(normalizedCookieSchema).max(3000),
});

const observeMessageSchema = z.strictObject({
  ...messageBase,
  type: z.literal("OBSERVE"),
});

const runActionsMessageSchema = z.strictObject({
  ...messageBase,
  type: z.literal("RUN_ACTIONS"),
  program: browserActionProgramSchema,
});

const captureScreenshotMessageSchema = z.strictObject({
  ...messageBase,
  type: z.literal("CAPTURE_SCREENSHOT"),
});

const beginHandoffMessageSchema = z.strictObject({
  ...messageBase,
  type: z.literal("BEGIN_HANDOFF"),
  reason: handoffReasonSchema,
});

const resumeHandoffMessageSchema = z.strictObject({
  ...messageBase,
  type: z.literal("RESUME_HANDOFF"),
});

const verifyManualLoginMessageSchema = z.strictObject({
  ...messageBase,
  type: z.literal("VERIFY_MANUAL_LOGIN"),
});

const cancelRequestMessageSchema = z.strictObject({
  ...messageBase,
  type: z.literal("CANCEL_REQUEST"),
  targetRequestId: requestIdSchema.nullable(),
});

const stopSessionMessageSchema = z.strictObject({
  ...messageBase,
  type: z.literal("STOP_SESSION"),
  reason: z.enum(["user_stop", "cancelled", "shutdown", "error"]),
});

export const managedBrowserInboundSchema = lazySchema(() =>
  z.discriminatedUnion("type", [
    startSessionMessageSchema,
    observeMessageSchema,
    runActionsMessageSchema,
    captureScreenshotMessageSchema,
    beginHandoffMessageSchema,
    resumeHandoffMessageSchema,
    verifyManualLoginMessageSchema,
    cancelRequestMessageSchema,
    stopSessionMessageSchema,
  ])
);

export type ManagedBrowserInboundMessage = z.infer<
  ReturnType<typeof managedBrowserInboundSchema>
>;

// ---------------------------------------------------------------------------
// Observation result payload (design §14.1)
// ---------------------------------------------------------------------------

const elementSummarySchema = z.strictObject({
  ref: elementRefSchema,
  role: z.string().min(1).max(48),
  name: z
    .string()
    .max(MANAGED_BROWSER_OBSERVATION_BUDGETS.maxAccessibleNameChars),
  valueSummary: z
    .string()
    .max(MANAGED_BROWSER_OBSERVATION_BUDGETS.maxValueSummaryChars)
    .optional(),
  disabled: z.boolean(),
  checked: z.boolean().optional(),
  selected: z.boolean().optional(),
  hrefOrigin: z.string().max(512).optional(),
});

const observationSchema = z.strictObject({
  sessionId: sessionIdSchema,
  pageRevision: z.number().int().positive(),
  url: z.string().max(2048),
  origin: z.string().max(512),
  title: z.string().max(300),
  state: z.enum(["ready", "loading", "dialog", "handoff"]),
  elements: z
    .array(elementSummarySchema)
    .max(MANAGED_BROWSER_OBSERVATION_BUDGETS.maxInteractiveElements),
  visibleText: z
    .string()
    .max(MANAGED_BROWSER_OBSERVATION_BUDGETS.maxVisibleTextChars),
  notices: z
    .array(
      z.strictObject({
        code: z.enum([
          "untrusted_content",
          "dialog_open",
          "download_blocked",
          "popup_blocked",
          "sensitive_field_visible",
          "truncated",
        ]),
      })
    )
    .max(16),
  truncated: z.boolean(),
});

// ---------------------------------------------------------------------------
// Outbound union (worker → main)
// ---------------------------------------------------------------------------

const workerReadyMessageSchema = z.strictObject({
  protocolVersion: protocolVersionSchema,
  type: z.literal("WORKER_READY"),
  sessionId: sessionIdSchema,
  requestId: requestIdSchema,
  sequence: sequenceSchema,
  workerPid: z.number().int().positive(),
});

const workerHeartbeatMessageSchema = z.strictObject({
  protocolVersion: protocolVersionSchema,
  type: z.literal("WORKER_HEARTBEAT"),
  sessionId: sessionIdSchema,
  requestId: requestIdSchema,
  sequence: sequenceSchema,
  state: sessionStateSchema,
  lagBucket: z.enum(["low", "medium", "high"]),
  ts: z.number().int().nonnegative(),
});

const sessionStateChangedMessageSchema = z.strictObject({
  ...messageBase,
  type: z.literal("SESSION_STATE_CHANGED"),
  state: sessionStateSchema,
  reasonCode: z.string().min(1).max(64).nullable(),
});

const sessionReadyMessageSchema = z.strictObject({
  ...messageBase,
  type: z.literal("SESSION_READY"),
  fingerprintResult: z.enum(["pass", "fail"]),
  fingerprintReasonCodes: z.array(z.string().min(1).max(64)).max(16),
  appliedCookieCount: z.number().int().nonnegative(),
  rejectedCookieCount: z.number().int().nonnegative(),
  assessment: authenticationAssessmentSchema,
  identity: processIdentitySchema,
});

const loginRequiredMessageSchema = z.strictObject({
  ...messageBase,
  type: z.literal("LOGIN_REQUIRED"),
  reasonCode: z.string().min(1).max(64),
});

const observationResultMessageSchema = z.strictObject({
  ...messageBase,
  type: z.literal("OBSERVATION_RESULT"),
  observation: observationSchema,
});

const actionProgressMessageSchema = z.strictObject({
  ...messageBase,
  type: z.literal("ACTION_PROGRESS"),
  phase: z.enum([
    "starting",
    "observing",
    "acting",
    "waiting",
    "handoff",
    "stopping",
  ]),
  completedSteps: z.number().int().nonnegative(),
  totalSteps: z.number().int().positive().nullable(),
  messageCode: z.string().min(1).max(64),
});

const actionResultMessageSchema = z.strictObject({
  ...messageBase,
  type: z.literal("ACTION_RESULT"),
  effect: z.enum(["known", "unknown"]),
  pageRevision: z.number().int().positive(),
  results: z
    .array(
      z.strictObject({
        actionIndex: z.number().int().nonnegative(),
        type: z.string().min(1).max(32),
        success: z.boolean(),
        errorCode: errorCodeSchema.nullable(),
        elementFound: z.boolean().nullable(),
        urlAfter: z.string().max(2048).nullable(),
      })
    )
    .max(MANAGED_BROWSER_ACTION_LIMITS.maxActionsPerProgram),
  observation: observationSchema.nullable(),
});

const screenshotResultMessageSchema = z.strictObject({
  ...messageBase,
  type: z.literal("SCREENSHOT_RESULT"),
  mimeType: z.enum(["image/jpeg", "image/png"]),
  // 8 MiB binary ≈ 11 M base64 chars; keep a safe ceiling (design §8.1).
  base64: z.string().max(12_000_000),
});

const handoffRequiredMessageSchema = z.strictObject({
  ...messageBase,
  type: z.literal("HANDOFF_REQUIRED"),
  reason: handoffReasonSchema,
  challenge: z
    .strictObject({
      challengeId: z.string().min(8).max(64),
      kind: challengeKindSchema,
      evidenceCodes: z.array(z.string().min(1).max(64)).max(16),
    })
    .nullable(),
});

const challengeDetectedMessageSchema = z.strictObject({
  ...messageBase,
  type: z.literal("CHALLENGE_DETECTED"),
  challengeId: z.string().min(8).max(64),
  origin: z.string().max(512),
  kind: challengeKindSchema,
  flowClassification: z.enum([
    "login",
    "security",
    "payment",
    "content_action",
    "read_navigation",
    "unknown",
  ]),
  evidenceCodes: z.array(z.string().min(1).max(64)).max(16),
  providerInputAvailable: z.boolean(),
});

const refreshedCookiesMessageSchema = z.strictObject({
  ...messageBase,
  type: z.literal("REFRESHED_COOKIES"),
  /** SECRET payload: the only other cookie-bearing message. */
  cookies: z.array(normalizedCookieSchema).max(3000),
});

const sessionStoppedMessageSchema = z.strictObject({
  ...messageBase,
  type: z.literal("SESSION_STOPPED"),
  terminalState: z.enum(["completed", "cancelled", "failed"]),
  reasonCode: z.string().min(1).max(64).nullable(),
});

const workerErrorMessageSchema = z.strictObject({
  ...messageBase,
  type: z.literal("WORKER_ERROR"),
  code: errorCodeSchema,
  message: z.string().max(300),
});

const cacheOpenedMessageSchema = z.strictObject({
  ...messageBase,
  type: z.literal("CACHE_OPENED"),
  scopeToken: z.string().min(8).max(128),
  namespace: z.string().min(3).max(128),
});

const cacheReleasedMessageSchema = z.strictObject({
  ...messageBase,
  type: z.literal("CACHE_RELEASED"),
  scopeToken: z.string().min(8).max(128),
  namespace: z.string().min(3).max(128),
});

export const managedBrowserOutboundSchema = lazySchema(() =>
  z.discriminatedUnion("type", [
    workerReadyMessageSchema,
    workerHeartbeatMessageSchema,
    sessionStateChangedMessageSchema,
    sessionReadyMessageSchema,
    loginRequiredMessageSchema,
    observationResultMessageSchema,
    actionProgressMessageSchema,
    actionResultMessageSchema,
    screenshotResultMessageSchema,
    handoffRequiredMessageSchema,
    challengeDetectedMessageSchema,
    refreshedCookiesMessageSchema,
    sessionStoppedMessageSchema,
    workerErrorMessageSchema,
    cacheOpenedMessageSchema,
    cacheReleasedMessageSchema,
  ])
);

export type ManagedBrowserOutboundMessage = z.infer<
  ReturnType<typeof managedBrowserOutboundSchema>
>;

// ---------------------------------------------------------------------------
// Size-limit helpers (design §8.1)
// ---------------------------------------------------------------------------

/** Serialized byte size of a message payload (approximation for ASCII-safe JSON). */
export function serializedMessageBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

/**
 * Whether a serialized payload fits its bound. Screenshot responses use the
 * dedicated 8 MiB limit; everything else the general 2 MiB limit.
 */
export function isWithinWorkerMessageLimit(
  value: unknown,
  kind: "general" | "screenshot" = "general"
): boolean {
  const limit =
    kind === "screenshot"
      ? MANAGED_BROWSER_MESSAGE_LIMITS.maxScreenshotBytes
      : MANAGED_BROWSER_MESSAGE_LIMITS.maxMessageBytes;
  return serializedMessageBytes(value) <= limit;
}
