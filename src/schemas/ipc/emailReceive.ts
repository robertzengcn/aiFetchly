import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";
import { itemSearchParamSchema, sortBySchema } from "@/schemas/ipc/_shared/pagination";

/** Email service id — positive integer. */
export const emailServiceIdSchema = lazySchema(() =>
  z.strictObject({
    emailServiceId: z.number().int().positive("Email service id is required"),
  }),
);

/** Manual receive sync. NOT AI-gated (plain fetch). */
export const emailReceiveSyncInputSchema = lazySchema(() =>
  z.strictObject({
    emailServiceId: z.number().int().positive("Email service id is required"),
    limit: z.number().int().min(1).max(50).optional(),
    unreadOnly: z.boolean().optional(),
    since: z.string().datetime().optional(),
  }),
);

/** Receive connection test. */
export const emailReceiveConnectionTestInputSchema = lazySchema(() =>
  z
    .strictObject({
      emailServiceId: z.number().int().nonnegative("Email service id is required"),
      settings: z
        .strictObject({
          protocol: z.enum(["imap", "pop3"]),
          host: z.string().min(1),
          port: z.number().int().min(1).max(65535),
          ssl: z.boolean(),
          username: z.string().min(1),
          password: z.string().min(1).optional(),
          folder: z.string().min(1),
        })
        .optional(),
    })
    .superRefine((input, ctx) => {
      if (input.emailServiceId === 0 && !input.settings) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["emailServiceId"],
          message: "Email service id is required",
        });
      }
    }),
);

/** Received message list with filters + pagination. */
export const emailReceiveMessageListInputSchema = lazySchema(() =>
  z.strictObject({
    emailServiceId: z.number().int().positive("Email service id is required"),
    page: z.number().int().nonnegative().optional(),
    size: z.number().int().positive().optional(),
    where: z.string().optional(),
    search: z.string().optional(),
    sortby: sortBySchema().optional(),
    unreadOnly: z.boolean().optional(),
    replyStatus: z.string().optional(),
    classification: z.string().optional(),
  }),
);

/** Single received message detail. */
export const emailReceiveMessageDetailInputSchema = lazySchema(() =>
  z.strictObject({
    id: z.number().int().positive("Message id is required"),
    includeBody: z.boolean().optional(),
  }),
);

/** Mark a received message processed/skipped/blocked/failed. */
export const emailReplyMarkProcessedInputSchema = lazySchema(() =>
  z.strictObject({
    messageId: z.number().int().positive("Message id is required"),
    status: z.enum(["skipped", "blocked", "failed", "needs_human_review"]),
    reason: z.string().max(500).optional(),
  }),
);

/** Pagination-only list (e.g. listing receive-enabled services summary). */
export const emailReceiveInboxListInputSchema = itemSearchParamSchema;
