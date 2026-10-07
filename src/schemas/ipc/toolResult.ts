import { z } from "zod";

/**
 * IPC payload schemas for preserved tool outputs (technical design §11.1).
 *
 * These use the repo's `zod` (v3) entrypoint because the validated-handler
 * wrapper is typed against it; the model-facing schemas in
 * `@/schemas/toolResult` use `zod/v4` alongside the tool definitions.
 *
 * The renderer supplies `conversationId` for scoping, but it is NOT trusted for
 * authorization: every handler re-checks the output's owner, grant, and live
 * epoch in `ToolResultModule` before reading a byte.
 */

const OUTPUT_ID_PATTERN = /^out_[0-9a-f]{32}$/;

export const toolResultGetIpcSchema = z.object({
  conversationId: z.string().max(100),
  outputId: z.string().max(64).regex(OUTPUT_ID_PATTERN),
});

/**
 * One request shape serves read and search; a `query` selects search. The
 * renderer never supplies a page larger than the UI ceiling, and the service
 * clamps it again server-side.
 */
export const toolResultReadIpcSchema = z.object({
  conversationId: z.string().max(100),
  outputId: z.string().max(64).regex(OUTPUT_ID_PATTERN),
  cursor: z.string().max(2048).optional(),
  page: z.number().int().min(256).max(32 * 1024).optional(),
  query: z.string().min(1).max(200).optional(),
});

export const toolResultExportIpcSchema = z.object({
  conversationId: z.string().max(100),
  outputId: z.string().max(64).regex(OUTPUT_ID_PATTERN),
});
