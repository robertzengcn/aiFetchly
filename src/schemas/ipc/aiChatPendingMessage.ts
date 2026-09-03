import { z } from "zod/v4";
import { lazySchema } from "@/utils/lazySchema";
import { aiChatV2PastedContentsSchema } from "@/schemas/aiChatV2PastedText";

/**
 * Strict request schemas for the pending-message queue IPC surface
 * (message-queue technical design §13.2). Renderer-supplied status,
 * sequence, timestamps, and ownership fields are never accepted — only
 * what the main process cannot derive itself.
 */

const idField = z
  .string()
  .min(1, "id is required")
  .max(100, "id must be at most 100 characters");

const conversationIdField = z
  .string()
  .max(100)
  .refine(
    (value) => value === "" || value.startsWith("v2-"),
    "conversationId must be a v2- conversation id"
  );

/** Bounded uploaded-file shape; byte-level validation happens in the Module. */
const uploadedFileSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(120),
  sizeBytes: z.number().int().positive().max(5 * 1024 * 1024),
  contentBase64: z.string().min(1),
  kind: z.enum(["document", "image"]),
});

const streamRequestSchema = z.strictObject({
  message: z.string().max(32_000),
  conversationId: conversationIdField.optional(),
  model: z.string().max(200).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  systemPrompt: z.string().max(100_000).optional(),
  mode: z.enum(["chat", "plan"]).optional(),
  showReasoning: z.boolean().optional(),
  reasoning: z
    .strictObject({
      enabled: z.boolean(),
      effort: z.enum(["low", "medium", "high"]).optional(),
      summary: z.enum(["auto", "concise", "detailed"]).optional(),
    })
    .optional(),
  toolApprovalMode: z
    .enum(["ask_for_approval", "approve_for_me", "full_access"])
    .optional(),
  uploadedFiles: z.array(uploadedFileSchema).max(3).optional(),
  pastedContents: aiChatV2PastedContentsSchema.optional(),
  generatedImageReferences: z
    .array(
      z.strictObject({
        messageId: idField,
        imageIndex: z.number().int().min(0),
      })
    )
    .max(3)
    .optional(),
});

/** AI_CHAT_V2_PENDING_CREATE */
export const aiChatPendingCreateInputSchema = lazySchema(() =>
  z.strictObject({
    clientRequestId: idField,
    request: streamRequestSchema,
  })
);

/** AI_CHAT_V2_PENDING_LIST */
export const aiChatPendingListInputSchema = lazySchema(() =>
  z.strictObject({
    conversationId: z.string().min(1).max(100),
  })
);

/** AI_CHAT_V2_PENDING_STEER */
export const aiChatPendingSteerInputSchema = lazySchema(() =>
  z.strictObject({
    conversationId: idField,
    pendingMessageId: idField,
  })
);

/** AI_CHAT_V2_PENDING_CANCEL */
export const aiChatPendingCancelInputSchema = lazySchema(() =>
  z.strictObject({
    conversationId: idField,
    pendingMessageId: idField,
  })
);

/** AI_CHAT_V2_PENDING_RESUME */
export const aiChatPendingResumeInputSchema = lazySchema(() =>
  z.strictObject({
    conversationId: idField,
  })
);
