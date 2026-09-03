import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

/**
 * Managed-browser IPC input schemas (technical design §22.1).
 *
 * The renderer may send account ids, session ids, UI decisions, and
 * confirmation tokens — NEVER cookie values, cache filesystem paths, worker
 * handles, or proxy credentials. All objects are strict so unknown fields
 * (e.g. a smuggled `path`) are rejected at the boundary.
 *
 * Event payload schemas mirror the safe renderer types from
 * `src/entityTypes/managedBrowserTypes.ts`.
 */

/** Opaque session id used by most requests. */
const sessionIdSchema = z
  .string()
  .min(8)
  .max(64)
  .regex(/^mb_[A-Za-z0-9_-]+$/, "sessionId must be an opaque mb_ token");

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

export const listEligibleAccountsInputSchema = lazySchema(() =>
  z.strictObject({})
);

export const managedBrowserStartInputSchema = lazySchema(() =>
  z.strictObject({
    accountId: z.number().int().positive(),
    purpose: z.string().min(1).max(300),
    requestedStartUrl: z.string().url().max(2048).optional(),
    conversationId: z.string().min(1).max(96).optional(),
  })
);

export const managedBrowserStatusInputSchema = lazySchema(() =>
  z.strictObject({
    sessionId: sessionIdSchema,
  })
);

export const managedBrowserHandoffInputSchema = lazySchema(() =>
  z.strictObject({
    sessionId: sessionIdSchema,
    reason: z.string().min(1).max(64).optional(),
  })
);

export const managedBrowserVerifyManualLoginInputSchema = lazySchema(() =>
  z.strictObject({
    sessionId: sessionIdSchema,
  })
);

export const managedBrowserResumeInputSchema = lazySchema(() =>
  z.strictObject({
    sessionId: sessionIdSchema,
  })
);

export const managedBrowserStopInputSchema = lazySchema(() =>
  z.strictObject({
    sessionId: sessionIdSchema,
    reason: z.enum(["user_stop", "cancelled", "shutdown"]),
  })
);

export const managedBrowserApproveInputSchema = lazySchema(() =>
  z.strictObject({
    sessionId: sessionIdSchema,
    requestId: z.string().min(4).max(96),
    decision: z.enum(["approve", "deny"]),
  })
);

export const managedBrowserExtendHandoffInputSchema = lazySchema(() =>
  z.strictObject({
    sessionId: sessionIdSchema,
    extendMinutes: z.number().int().min(1).max(30),
  })
);

export const managedBrowserGetEffectiveSettingsInputSchema = lazySchema(() =>
  z.strictObject({})
);

export const managedBrowserGetCacheStatusInputSchema = lazySchema(() =>
  z
    .strictObject({
      scope: z.enum(["account", "all"]),
      accountId: z.number().int().positive().optional(),
    })
    .refine(
      (v) => v.scope !== "account" || typeof v.accountId === "number",
      { message: "accountId is required for account scope" }
    )
);

/**
 * Clear-cache request (design §13.8). Accepts ONLY scope/account id/decision/
 * confirmationId — a caller-supplied `path` must fail validation.
 */
export const managedBrowserClearCacheInputSchema = lazySchema(() =>
  z.discriminatedUnion("scope", [
    z.strictObject({
      scope: z.literal("account"),
      accountId: z.number().int().positive(),
      activeSessionDecision: z.enum(["stop_and_clear", "defer", "cancel"]),
      confirmationId: z.string().min(8).max(96),
    }),
    z.strictObject({
      scope: z.literal("all"),
      activeSessionDecision: z.enum(["stop_and_clear", "skip_active", "cancel"]),
      confirmationId: z.string().min(8).max(96),
    }),
  ])
);

// ---------------------------------------------------------------------------
// Event payload schemas (main → renderer pushes)
// ---------------------------------------------------------------------------

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

const safeStatusSchema = z.strictObject({
  sessionId: sessionIdSchema,
  accountId: z.number().int().positive(),
  platformId: z.number().int().positive(),
  state: sessionStateSchema,
  currentOrigin: z.string().max(512).nullable(),
  pageTitle: z.string().max(300).nullable(),
  pageRevision: z.number().int().positive(),
  authenticated: z.boolean().nullable(),
  handoffReason: z.string().max(64).nullable(),
  lastErrorCode: z.string().max(64).nullable(),
});

export const statusChangedEventSchema = lazySchema(() => safeStatusSchema);

export const browserProgressEventSchema = lazySchema(() =>
  z.strictObject({
    sessionId: sessionIdSchema,
    requestId: z.string().min(4).max(96),
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
  })
);

export const approvalRequiredEventSchema = lazySchema(() =>
  z.strictObject({
    sessionId: sessionIdSchema,
    requestId: z.string().min(4).max(96),
    riskClass: z.enum([
      "read",
      "reversible_write",
      "consequential_write",
      "credential_or_security",
      "local_data_delete",
      "privileged_script",
    ]),
    /** Localized preview fields — never cookies/hidden values. */
    messageKey: z.string().min(1).max(96),
    contentSummary: z.string().max(600).nullable(),
  })
);

export const chatNoticeEventSchema = lazySchema(() =>
  z.strictObject({
    eventId: z.string().min(8).max(96),
    sessionId: sessionIdSchema,
    type: z.string().min(1).max(64),
    messageKey: z.string().min(1).max(96),
    severity: z.enum(["info", "warning", "success", "error"]),
    requiresUserAction: z.boolean(),
    createdAt: z.string().min(8).max(40),
    messageArgs: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  })
);

export const cacheProgressEventSchema = lazySchema(() =>
  z.strictObject({
    scope: z.enum(["account", "all"]),
    phase: z.enum(["scanning", "deleting", "done", "failed"]),
    approximateBytes: z.number().int().nonnegative(),
    reasonCode: z.string().max(64).nullable(),
  })
);

export type StatusChangedEvent = z.infer<
  ReturnType<typeof statusChangedEventSchema>
>;
export type BrowserProgressEvent = z.infer<
  ReturnType<typeof browserProgressEventSchema>
>;
export type ApprovalRequiredEvent = z.infer<
  ReturnType<typeof approvalRequiredEventSchema>
>;
export type ChatNoticeEvent = z.infer<
  ReturnType<typeof chatNoticeEventSchema>
>;
export type CacheProgressEvent = z.infer<
  ReturnType<typeof cacheProgressEventSchema>
>;
