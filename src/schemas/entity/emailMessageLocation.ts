import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

/**
 * Write-boundary schema for {@link EmailMessageLocationEntity}.
 * Non-strict so `parseAndStrip` drops unknown fields before persistence.
 */
export const emailMessageLocationWriteSchema = lazySchema(() =>
  z.object({
    messageId: z.number().int().positive(),
    emailServiceId: z.number().int().positive(),
    protocol: z.enum(["imap", "pop3"]),
    folderPath: z.string().min(1).max(255).nullable().optional(),
    uidValidity: z.string().max(64).nullable().optional(),
    providerUid: z.string().min(1).max(255),
    state: z.enum(["verified", "legacy_unverified", "stale", "missing"]),
    version: z.number().int().positive().optional(),
    lastVerifiedAt: z.coerce.date().nullable().optional(),
    lastOperationId: z.string().max(64).nullable().optional(),
  })
);
