import { z } from "zod/v4";
import type { OpaqueSourceIdPayload } from "@/entityTypes/aiChatArchiveTypes";

/**
 * Versioned opaque cursor codec. Cursors are NOT authorization credentials:
 * decode with strict length/schema bounds, validate epoch/revision + query
 * hash + snapshot bounds against trusted context, and reject unknown
 * versions. A caller-modified cursor must never widen conversation scope.
 * Source text is never embedded in cursor payloads.
 */

const CURSOR_VERSION = 1;

const cursorPayloadSchema = z.object({
  v: z.literal(CURSOR_VERSION),
  conversationId: z.string().max(100),
  epoch: z.string().max(64),
  revision: z.number().int().nonnegative(),
  queryHash: z.string().max(64).optional(),
  lastTimestampMs: z.number().int().nonnegative(),
  lastRowId: z.number().int().nonnegative(),
  direction: z.enum(["forward", "reverse"]).default("forward"),
});

export type CursorPayload = z.infer<typeof cursorPayloadSchema>;

export function encodeCursor(payload: CursorPayload): string {
  const json = JSON.stringify(payload);
  // Base64-URL so the cursor is opaque to the model; not encrypted.
  return Buffer.from(json, "utf8").toString("base64url");
}

export function decodeCursor(
  raw: unknown,
  expectedConversationId: string,
  expectedEpoch: string,
  expectedRevision?: number
): CursorPayload | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 1024) {
    return null;
  }
  let json: string;
  try {
    json = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const result = cursorPayloadSchema.safeParse(parsed);
  if (!result.success) return null;
  const data = result.data;
  // Strict scope: cursor must reference the same conversation + epoch +
  // revision (P2-5, FR-01). A stale-revision cursor cannot resume after source
  // changes. Revision is optional for legacy callers that already validated it
  // via epoch rotation; new callers must pass it.
  if (
    data.conversationId !== expectedConversationId ||
    data.epoch !== expectedEpoch
  ) {
    return null;
  }
  if (expectedRevision !== undefined && data.revision !== expectedRevision) {
    return null;
  }
  return data;
}

/** Encode an opaque source ID (used in retrieval results). */
export function encodeSourceId(payload: OpaqueSourceIdPayload): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json, "utf8").toString("base64url");
}

const sourceIdPayloadSchema = z.object({
  v: z.literal(CURSOR_VERSION),
  epoch: z.string().max(64),
  revision: z.number().int().nonnegative(),
  rowId: z.number().int().positive(),
  field: z.enum(["content", "tool_receipt"]),
  startCodePoint: z.number().int().nonnegative(),
  endCodePoint: z.number().int().nonnegative(),
});

export function decodeSourceId(
  raw: unknown,
  expectedEpoch: string
): OpaqueSourceIdPayload | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) {
    return null;
  }
  let json: string;
  try {
    json = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const result = sourceIdPayloadSchema.safeParse(parsed);
  if (!result.success) return null;
  if (result.data.epoch !== expectedEpoch) return null;
  if (result.data.endCodePoint < result.data.startCodePoint) return null;
  return result.data;
}
