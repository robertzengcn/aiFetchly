import { z } from "zod/v4";

/**
 * Strict Zod v4 schemas for the ai-chat-workspace:* IPC boundary
 * (technical-design §11.1). Every renderer payload is parsed here before the
 * IPC handler or coordinator touches it.
 */

/** Conversation ids are `v2-` + uuid-ish; accept a conservative charset. */
const conversationIdSchema = z
  .string()
  .min(3)
  .max(100)
  .regex(/^[a-zA-Z0-9-_]+$/, "conversationId has invalid characters");

const runIdSchema = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-zA-Z0-9-_]+$/, "runId has invalid characters");

const isoTimestampSchema = z.string().datetime({ offset: true });

// ---------------------------------------------------------------------------
// bootstrap / select / history
// ---------------------------------------------------------------------------

export const workspaceBootstrapRequestSchema = z.object({}).strict();

export const selectConversationRequestSchema = z
  .object({
    conversationId: conversationIdSchema.nullable(),
    generation: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export const unsubscribeDetailRequestSchema = z.object({}).strict();

export const historyCursorSchema = z
  .object({
    timestamp: isoTimestampSchema,
    messageId: z.string().min(1).max(100),
  })
  .strict();

export const historyPageRequestSchema = z
  .object({
    conversationId: conversationIdSchema,
    limit: z.number().int().min(20).max(100),
    before: historyCursorSchema.optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// run lifecycle
// ---------------------------------------------------------------------------

const clientRequestIdSchema = z
  .string()
  .min(8)
  .max(64)
  .regex(/^[a-zA-Z0-9-_]+$/, "clientRequestId has invalid characters");

const messageTextSchema = z.string().min(1).max(100_000);

export const startChatRunRequestSchema = z
  .object({
    conversationId: conversationIdSchema,
    clientRequestId: clientRequestIdSchema,
    message: messageTextSchema,
    model: z.string().max(200).optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().min(1).max(1_000_000).optional(),
    systemPrompt: z.string().max(100_000).optional(),
    mode: z.enum(["chat", "plan"]).optional(),
    showReasoning: z.boolean().optional(),
    reasoning: z
      .object({
        enabled: z.boolean(),
        effort: z.enum(["low", "medium", "high"]).optional(),
        summary: z.enum(["auto", "concise", "detailed"]).optional(),
      })
      .strict()
      .optional(),
    toolApprovalMode: z
      .enum(["ask_for_approval", "approve_for_me", "full_access"])
      .optional(),
    resourceClass: z.literal("general").optional(),
  })
  .strict();

export const cancelChatRunRequestSchema = z
  .object({
    conversationId: conversationIdSchema,
    runId: runIdSchema.optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// read markers / rename / activity
// ---------------------------------------------------------------------------

export const markConversationReadRequestSchema = z
  .object({
    conversationId: conversationIdSchema,
    observedThrough: isoTimestampSchema,
  })
  .strict();

export const renameConversationRequestSchema = z
  .object({
    conversationId: conversationIdSchema,
    title: z.string().min(1).max(200),
  })
  .strict();

export const workspaceActivityRequestSchema = z
  .object({
    conversationId: conversationIdSchema,
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

export type WorkspaceBootstrapRequest = z.infer<
  typeof workspaceBootstrapRequestSchema
>;
export type SelectConversationRequestPayload = z.infer<
  typeof selectConversationRequestSchema
>;
export type HistoryPageRequestPayload = z.infer<
  typeof historyPageRequestSchema
>;
export type StartChatRunRequestPayload = z.infer<
  typeof startChatRunRequestSchema
>;
export type CancelChatRunRequestPayload = z.infer<
  typeof cancelChatRunRequestSchema
>;
export type MarkConversationReadRequestPayload = z.infer<
  typeof markConversationReadRequestSchema
>;
export type RenameConversationRequestPayload = z.infer<
  typeof renameConversationRequestSchema
>;
export type WorkspaceActivityRequestPayload = z.infer<
  typeof workspaceActivityRequestSchema
>;
