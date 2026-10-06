import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

/**
 * Write-boundary schema for {@link EmailReplyGuardEntity}.
 *
 * `parseAndStrip` (src/service/parseAndStrip.ts) strips any entity key not in
 * the matching write schema, so every persisted column MUST appear here. The
 * guard table is created by `synchronize: true` (SqliteDb.ts) and written
 * exclusively through `EmailReplyGuardModel` under `runReplyTxn`.
 */
export const emailReplyGuardWriteSchema = lazySchema(() =>
  z.object({
    id: z.number().int().optional(),
    emailServiceId: z.number().int(),
    replyKey: z.string().min(1).max(80),
    messageId: z.number().int(),
    phase: z.enum([
      "idle",
      "generating",
      "draft_ready",
      "sending",
      "sent",
      "delivery_unknown",
      "conflict",
    ]),
    ownerToken: z.string().nullable().optional(),
    leaseExpiresAt: z.coerce.date().nullable().optional(),
    activeDraftId: z.number().int().nullable().optional(),
    activeAttemptId: z.number().int().nullable().optional(),
  }),
);
