import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

/**
 * Write-boundary schemas for the email organization operation tables.
 * Non-strict objects so `parseAndStrip` drops unknown fields.
 */

export const emailOrganizationOperationWriteSchema = lazySchema(() =>
  z.object({
    operationId: z.string().min(8).max(64),
    kind: z.enum(["forward", "trash", "restore"]),
    emailServiceId: z.number().int().positive(),
    origin: z.enum(["direct_request", "ui_review", "ui_action", "tool_confirmation"]),
    conversationId: z.number().int().nullable().optional(),
    sourceUserMessageId: z.string().max(255).nullable().optional(),
    payloadHash: z.string().length(64),
    idempotencyKey: z.string().min(8).max(160),
    status: z
      .enum([
        "prepared",
        "awaiting_approval",
        "authorized",
        "running",
        "succeeded",
        "partially_succeeded",
        "failed",
        "cancelled",
        "needs_reconciliation",
      ])
      .optional(),
    draftId: z.number().int().nullable().optional(),
    completedCount: z.number().int().optional(),
    failedCount: z.number().int().optional(),
    unknownCount: z.number().int().optional(),
    pendingCount: z.number().int().optional(),
    cancelledCount: z.number().int().optional(),
    errorCode: z.string().max(50).nullable().optional(),
    policyVersion: z.string().max(30).nullable().optional(),
    requestedAt: z.coerce.date(),
    startedAt: z.coerce.date().nullable().optional(),
    completedAt: z.coerce.date().nullable().optional(),
    cancelRequestedAt: z.coerce.date().nullable().optional(),
  })
);

export const emailOrganizationOperationItemWriteSchema = lazySchema(() =>
  z.object({
    operationId: z.string().min(8).max(64),
    messageId: z.number().int().positive(),
    beforeLocationVersion: z.number().int().nullable().optional(),
    beforeFolderPath: z.string().max(255).nullable().optional(),
    beforeUidValidity: z.string().max(64).nullable().optional(),
    beforeProviderUid: z.string().max(255).nullable().optional(),
    destinationFolderPath: z.string().max(255).nullable().optional(),
    status: z
      .enum([
        "pending",
        "claimed",
        "succeeded",
        "partially_succeeded",
        "noop",
        "failed",
        "cancelled",
        "outcome_unknown",
      ])
      .optional(),
    acceptedRecipientsJson: z.string().nullable().optional(),
    rejectedRecipientsJson: z.string().nullable().optional(),
    unknownRecipientsJson: z.string().nullable().optional(),
    resultJson: z.string().nullable().optional(),
    errorCode: z.string().max(50).nullable().optional(),
    sanitizedError: z.string().nullable().optional(),
    claimedAt: z.coerce.date().nullable().optional(),
    completedAt: z.coerce.date().nullable().optional(),
  })
);

export const emailOrganizationAttemptWriteSchema = lazySchema(() =>
  z.object({
    itemId: z.number().int().positive(),
    operationId: z.string().min(8).max(64),
    attemptNumber: z.number().int().positive(),
    claimTokenHash: z.string().length(64),
    phase: z.enum(["claimed", "dispatched", "resolved"]).optional(),
    dispatchedAt: z.coerce.date().nullable().optional(),
    leaseExpiresAt: z.coerce.date(),
    providerMessageId: z.string().max(998).nullable().optional(),
    resultJson: z.string().nullable().optional(),
    resolvedAt: z.coerce.date().nullable().optional(),
  })
);

export const emailOrganizationAuthorizationWriteSchema = lazySchema(() =>
  z.object({
    operationId: z.string().max(64).nullable().optional(),
    draftId: z.number().int().nullable().optional(),
    revisionId: z.number().int().nullable().optional(),
    payloadHash: z.string().length(64),
    origin: z.enum(["direct_request", "ui_review", "ui_action", "tool_confirmation"]),
    userTurnId: z.string().max(255).nullable().optional(),
    expiresAt: z.coerce.date(),
    consumedAt: z.coerce.date().nullable().optional(),
    revokedAt: z.coerce.date().nullable().optional(),
    invalidReason: z.string().nullable().optional(),
  })
);

export const emailOrganizationAuditWriteSchema = lazySchema(() =>
  z.object({
    operationId: z.string().max(64).nullable().optional(),
    itemId: z.number().int().nullable().optional(),
    messageId: z.number().int().nullable().optional(),
    emailServiceId: z.number().int().nullable().optional(),
    actor: z.string().max(20).optional(),
    action: z.string().min(1).max(50),
    status: z.string().max(30).nullable().optional(),
    reasonCode: z.string().max(50).nullable().optional(),
    detailJson: z.string().nullable().optional(),
  })
);
