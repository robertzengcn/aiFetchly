/**
 * Zod schemas for the recoverable large tool results boundary (technical
 * design §4.2, §8, §11.1).
 *
 * These are the runtime validation boundary for:
 *   - model-supplied `tool_result_read` / `tool_result_search` arguments
 *   - renderer IPC payloads
 *   - anything read back out of a receipt or the artifact registry
 *
 * The active conversation, agent, and epoch are NEVER model arguments: they
 * come from trusted context. `output_id` here is a reference, not an
 * authorization credential — the Module re-validates owner/grant/epoch on
 * every access.
 */
import { z } from "zod/v4";

/** Current receipt schema version. Readers reject anything newer (design §13.2). */
export const TOOL_RESULT_RECEIPT_SCHEMA_VERSION = 1;

const OUTPUT_ID_PATTERN = /^out_[0-9a-f]{32}$/;

/** A generated output id. Cryptographically random, no user/tool/path names. */
export const toolOutputIdSchema = z
  .string()
  .max(64)
  .regex(OUTPUT_ID_PATTERN, "output_id is not a well-formed output id");

const operationStatusSchema = z.enum([
  "success",
  "error",
  "partial",
  "cancelled",
  "blocked",
  "pending",
  "permission_required",
  "unknown",
]);

const sourceCompletenessSchema = z.enum(["complete", "partial", "unknown"]);

const outputFormatSchema = z.enum(["text", "json", "jsonl", "binary"]);

/** Public descriptor for one preserved output stream. */
export const storedToolOutputRefSchema = z.object({
  outputId: toolOutputIdSchema,
  revision: z.number().int().min(1).max(1000),
  storageBackend: z.enum(["file", "legacy_message"]),
  format: outputFormatSchema,
  mediaType: z.string().max(200),
  capturedBytes: z.number().int().min(0),
  originalBytes: z.number().int().min(0).optional(),
  sha256: z
    .string()
    .max(64)
    .regex(/^[0-9a-f]{64}$/, "sha256 must be lowercase hex")
    .optional(),
  preservation: z.enum(["complete", "partial"]),
  sourceCompleteness: sourceCompletenessSchema,
  incompleteReason: z.string().max(200).optional(),
});

export type StoredToolOutputRefInput = z.infer<typeof storedToolOutputRefSchema>;

/** Bounded receipt, as persisted and as sent to the model/renderer. */
export const toolResultReceiptSchema = z.object({
  schemaVersion: z.literal(TOOL_RESULT_RECEIPT_SCHEMA_VERSION),
  toolCallId: z.string().max(200),
  toolName: z.string().max(200),
  operationStatus: operationStatusSchema,
  success: z.boolean(),
  executionTimeMs: z.number().int().min(0).max(24 * 60 * 60 * 1000),
  summary: z.string().max(2000).optional(),
  // Validated + bounded at construction; re-bounded here so a hand-edited row
  // cannot smuggle a bulk payload into the model projection.
  control: z.record(z.string().max(200), z.unknown()).default({}),
  outputs: z.array(storedToolOutputRefSchema).max(8).default([]),
  preview: z.string().max(8192).default(""),
  previewComplete: z.boolean().default(false),
  storageErrorCode: z.string().max(100).optional(),
});

export type ToolResultReceiptInput = z.infer<typeof toolResultReceiptSchema>;

/**
 * `tool_result_read` arguments.
 *
 * `max_tokens` is a REQUEST for a smaller page, never a way to exceed the
 * configured read ceiling — the retrieval service clamps it.
 */
export const toolResultReadInputSchema = z.object({
  output_id: toolOutputIdSchema,
  cursor: z.string().max(2048).optional(),
  max_tokens: z.number().int().min(1).max(32000).optional(),
});

export type ToolResultReadInput = z.infer<typeof toolResultReadInputSchema>;

/**
 * `tool_result_search` arguments.
 *
 * The query is LITERAL text, never a regular expression, and is length-bounded
 * before it reaches the scanner.
 */
export const toolResultSearchInputSchema = z.object({
  output_id: toolOutputIdSchema,
  query: z
    .string()
    .min(1, "query must be non-empty")
    .max(200, "query must be at most 200 characters"),
  cursor: z.string().max(2048).optional(),
  max_matches: z.number().int().min(1).max(20).optional(),
});

export type ToolResultSearchInput = z.infer<typeof toolResultSearchInputSchema>;

/** Renderer `AI_TOOL_RESULT_GET` payload. */
export const toolResultGetInputSchema = z.object({
  conversationId: z.string().max(100),
  outputId: toolOutputIdSchema,
});

/**
 * Renderer read/search payload.
 *
 * `page` is a UI byte budget, distinct from the model's token page budget. The
 * service clamps it to the smaller of the two.
 */
export const toolResultReadRequestSchema = z.object({
  conversationId: z.string().max(100),
  outputId: toolOutputIdSchema,
  cursor: z.string().max(2048).optional(),
  page: z.number().int().min(256).max(32 * 1024).optional(),
  query: z.string().min(1).max(200).optional(),
});

export type ToolResultReadRequest = z.infer<typeof toolResultReadRequestSchema>;

/** Renderer `AI_TOOL_RESULT_EXPORT` payload. */
export const toolResultExportInputSchema = z.object({
  conversationId: z.string().max(100),
  outputId: toolOutputIdSchema,
});
