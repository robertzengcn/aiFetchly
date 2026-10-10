import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";
import { MANAGED_BROWSER_PROTOCOL_VERSION } from "@/config/managedBrowser";

/**
 * Managed-browser CACHE maintenance worker protocol (technical design §13.9).
 *
 * The cache worker is a SHARED SINGLETON (forked once, no session argv
 * contract) that performs every large cache scan/delete/eviction-plan —
 * the main process never recurses the cache tree itself.
 *
 * Differences from the session-worker protocol (`managedBrowser.ts`):
 *  - NO sessionId: messages are process-scoped, not session-scoped.
 *  - NO heartbeat: every operation is bounded by a request timeout.
 *  - Results carry ONLY aggregate counts, duration buckets, opaque scope
 *    tokens, and safe reason codes — never filenames, paths, or URLs.
 *
 * Every message carries protocolVersion, requestId, and a monotonic
 * sequence. Correlated replies reuse the request's requestId.
 */

// ---------------------------------------------------------------------------
// Shared field schemas
// ---------------------------------------------------------------------------

const protocolVersionSchema = z.literal(MANAGED_BROWSER_PROTOCOL_VERSION);

const requestIdSchema = z.string().min(4).max(96);

const sequenceSchema = z.number().int().nonnegative();

const messageBase = {
  protocolVersion: protocolVersionSchema,
  requestId: requestIdSchema,
  sequence: sequenceSchema,
} as const;

/** Opaque per-account scope directory name (24-char lowercase hex). */
const scopeTokenSchema = z
  .string()
  .length(24)
  .regex(/^[0-9a-f]{24}$/, "scope token must be 24-char lowercase hex");

const managedRootSchema = z.string().min(1).max(1024);

const scopePathSchema = z.string().min(1).max(1024);

/** Deletion-queue entry names under `<managedRoot>/deleting/`. */
const queueEntryNameSchema = z
  .string()
  .min(8)
  .max(64)
  .regex(/^[a-z0-9-]{8,64}$/, "queue entry must match the deletion grammar");

const queuePathSchema = z.string().min(1).max(1024);

/** Coarse operation duration bucket — never a precise timing oracle. */
const durationBucketSchema = z.enum([
  "under_1s",
  "under_5s",
  "under_20s",
  "over_20s",
]);

/** Safe reason codes surfaced in results/WORKER_ERROR (§13.4: no paths). */
export const cacheWorkerReasonCodes = [
  "cache_root_invalid",
  "cache_path_invalid",
  "cache_symlink_rejected",
  "cache_scan_failed",
  "cache_delete_failed",
  "cache_plan_invalid",
  "worker_protocol_violation",
  "internal_error",
] as const;

const reasonCodeSchema = z.enum(cacheWorkerReasonCodes);

// ---------------------------------------------------------------------------
// Result payload shapes (worker → main)
// ---------------------------------------------------------------------------

const scanScopeOutcomeSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("ok"),
    approximateBytes: z.number().int().nonnegative(),
    fileCount: z.number().int().nonnegative(),
    durationBucket: durationBucketSchema,
    truncated: z.boolean(),
  }),
  z.strictObject({
    status: z.literal("error"),
    reasonCode: reasonCodeSchema,
  }),
]);

const scanAllOutcomeSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("ok"),
    scopes: z
      .array(
        z.strictObject({
          scopeToken: scopeTokenSchema,
          approximateBytes: z.number().int().nonnegative(),
          fileCount: z.number().int().nonnegative(),
          lastModifiedEpochMs: z.number().int().nonnegative(),
        })
      )
      .max(4096),
    truncated: z.boolean(),
    durationBucket: durationBucketSchema,
  }),
  z.strictObject({
    status: z.literal("error"),
    reasonCode: reasonCodeSchema,
  }),
]);

const deleteQueuedOutcomeSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("ok"),
    approximateDeletedBytes: z.number().int().nonnegative(),
    fileCount: z.number().int().nonnegative(),
    durationBucket: durationBucketSchema,
  }),
  z.strictObject({
    status: z.literal("error"),
    reasonCode: reasonCodeSchema,
  }),
]);

const planEvictionOutcomeSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("ok"),
    planId: z
      .string()
      .min(11)
      .max(37)
      .regex(/^plan-[a-z0-9-]{6,32}$/, "planId must be an opaque plan token"),
    plannedBytes: z.number().int().nonnegative(),
    entries: z
      .array(z.strictObject({ scopeToken: scopeTokenSchema }))
      .max(1024),
    durationBucket: durationBucketSchema,
  }),
  z.strictObject({
    status: z.literal("error"),
    reasonCode: reasonCodeSchema,
  }),
]);

const cancelOutcomeSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("ok"),
    cancelled: z.boolean(),
  }),
  z.strictObject({
    status: z.literal("error"),
    reasonCode: reasonCodeSchema,
  }),
]);

// ---------------------------------------------------------------------------
// Inbound union (main → worker)
// ---------------------------------------------------------------------------

const scanScopeMessageSchema = z.strictObject({
  ...messageBase,
  type: z.literal("SCAN_SCOPE"),
  managedRoot: managedRootSchema,
  scopePath: scopePathSchema,
});

const scanAllMessageSchema = z.strictObject({
  ...messageBase,
  type: z.literal("SCAN_ALL"),
  managedRoot: managedRootSchema,
});

const deleteQueuedScopeMessageSchema = z.strictObject({
  ...messageBase,
  type: z.literal("DELETE_QUEUED_SCOPE"),
  managedRoot: managedRootSchema,
  queuePath: queuePathSchema,
});

const planEvictionMessageSchema = z.strictObject({
  ...messageBase,
  type: z.literal("PLAN_EVICTION"),
  managedRoot: managedRootSchema,
  maxTotalBytes: z.number().int().positive(),
  perScopeTargetBytes: z.number().int().positive(),
  inactiveRetentionDays: z.number().int().min(0).max(3650),
  /** Scopes with a live Chrome — the worker refuses to plan them. */
  activeScopeTokens: z.array(scopeTokenSchema).max(4096),
});

const cancelBeforeDeleteMessageSchema = z.strictObject({
  ...messageBase,
  type: z.literal("CANCEL_BEFORE_DELETE"),
  planId: z.string().min(11).max(37),
});

const shutdownMessageSchema = z.strictObject({
  ...messageBase,
  type: z.literal("SHUTDOWN"),
});

export const managedBrowserCacheInboundSchema = lazySchema(() =>
  z.discriminatedUnion("type", [
    scanScopeMessageSchema,
    scanAllMessageSchema,
    deleteQueuedScopeMessageSchema,
    planEvictionMessageSchema,
    cancelBeforeDeleteMessageSchema,
    shutdownMessageSchema,
  ])
);

export type ManagedBrowserCacheInboundMessage = z.infer<
  ReturnType<typeof managedBrowserCacheInboundSchema>
>;

// ---------------------------------------------------------------------------
// Outbound union (worker → main)
// ---------------------------------------------------------------------------

const cacheWorkerReadyMessageSchema = z.strictObject({
  protocolVersion: protocolVersionSchema,
  type: z.literal("WORKER_READY"),
  requestId: requestIdSchema,
  sequence: sequenceSchema,
  workerPid: z.number().int().positive(),
});

const scanScopeResultMessageSchema = z.strictObject({
  ...messageBase,
  type: z.literal("SCAN_SCOPE_RESULT"),
  result: scanScopeOutcomeSchema,
});

const scanAllResultMessageSchema = z.strictObject({
  ...messageBase,
  type: z.literal("SCAN_ALL_RESULT"),
  result: scanAllOutcomeSchema,
});

const deleteQueuedScopeResultMessageSchema = z.strictObject({
  ...messageBase,
  type: z.literal("DELETE_QUEUED_SCOPE_RESULT"),
  result: deleteQueuedOutcomeSchema,
});

const planEvictionResultMessageSchema = z.strictObject({
  ...messageBase,
  type: z.literal("PLAN_EVICTION_RESULT"),
  result: planEvictionOutcomeSchema,
});

const cancelBeforeDeleteResultMessageSchema = z.strictObject({
  ...messageBase,
  type: z.literal("CANCEL_BEFORE_DELETE_RESULT"),
  result: cancelOutcomeSchema,
});

const cacheShutdownAckMessageSchema = z.strictObject({
  ...messageBase,
  type: z.literal("SHUTDOWN_ACK"),
});

const cacheWorkerErrorMessageSchema = z.strictObject({
  ...messageBase,
  type: z.literal("WORKER_ERROR"),
  code: reasonCodeSchema,
  message: z.string().max(300),
});

export const managedBrowserCacheOutboundSchema = lazySchema(() =>
  z.discriminatedUnion("type", [
    cacheWorkerReadyMessageSchema,
    scanScopeResultMessageSchema,
    scanAllResultMessageSchema,
    deleteQueuedScopeResultMessageSchema,
    planEvictionResultMessageSchema,
    cancelBeforeDeleteResultMessageSchema,
    cacheShutdownAckMessageSchema,
    cacheWorkerErrorMessageSchema,
  ])
);

export type ManagedBrowserCacheOutboundMessage = z.infer<
  ReturnType<typeof managedBrowserCacheOutboundSchema>
>;

/** Bucket an elapsed duration (ms) into the coarse wire bucket. */
export function bucketForDurationMs(elapsedMs: number): z.infer<
  typeof durationBucketSchema
> {
  if (elapsedMs < 1_000) {
    return "under_1s";
  }
  if (elapsedMs < 5_000) {
    return "under_5s";
  }
  if (elapsedMs < 20_000) {
    return "under_20s";
  }
  return "over_20s";
}
