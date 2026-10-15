import type { MCPToolCallContent } from "@/modules/MCPClient";

/**
 * MCP tool-result normalization (plugin PRD §14, design §10.4).
 *
 * Precedence (table, authoritative):
 *   1. `isError: true` → FAILURE. Safe structured diagnostics are preserved;
 *      a contradictory nested `success: true` is rejected — isError can
 *      never become success.
 *   2. Valid domain envelope (structuredContent, or the first JSON text
 *      block, with a boolean `success`) → its `success` wins.
 *   3. Anything else → legacy generic success with the existing extraction.
 *
 * Transport/JSON-RPC failures never reach this module — they reject the SDK
 * call and are mapped to sanitized fatal errors by the executor.
 */

/** Model-facing bound on any stringified diagnostics (PRD §14.3). */
const MAX_ERROR_TEXT_CHARS = 8_192;

export interface NormalizedMcpToolOutcome {
  readonly success: boolean;
  readonly payload: Record<string, unknown>;
  readonly isDomainEnvelope: boolean;
}

function isRecordWithBooleanSuccess(
  value: unknown
): value is Record<string, unknown> & { success: boolean } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).success === "boolean"
  );
}

function firstText(call: MCPToolCallContent): string | null {
  for (const block of call.content) {
    if (block.type === "text" && block.text.length > 0) {
      return block.text;
    }
  }
  return null;
}

/** Extract a domain envelope from structuredContent or a JSON text block. */
function extractDomainEnvelope(
  call: MCPToolCallContent
): (Record<string, unknown> & { success: boolean }) | null {
  if (isRecordWithBooleanSuccess(call.structuredContent)) {
    return call.structuredContent;
  }
  const text = firstText(call);
  if (text !== null) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (isRecordWithBooleanSuccess(parsed)) {
        return parsed;
      }
    } catch {
      // Not JSON — not a domain envelope.
    }
  }
  return null;
}

/**
 * Build a bounded, safe error payload for an `isError: true` result.
 * Prefers validated structured diagnostics; falls back to a capped text
 * block; never stringifies unbounded content arrays.
 */
function safeErrorPayload(call: MCPToolCallContent): {
  error: string;
  diagnostics?: Record<string, unknown>;
} {
  const structured = call.structuredContent;
  if (
    structured &&
    typeof structured === "object" &&
    Object.keys(structured).length > 0
  ) {
    const cloned: Record<string, unknown> = { ...structured };
    // A contradictory success flag inside an isError result is dropped —
    // the transport-level failure verdict wins (design §10.4 row 3).
    delete cloned.success;
    return {
      error: typeof cloned.message === "string" ? cloned.message : "MCP tool reported an error",
      diagnostics: cloned,
    };
  }
  const text = firstText(call);
  if (text !== null) {
    return { error: text.slice(0, MAX_ERROR_TEXT_CHARS) };
  }
  return { error: "MCP tool reported an error" };
}

/** Legacy generic extraction (mirrors MCPClient.callTool's success path). */
function legacyExtract(call: MCPToolCallContent): Record<string, unknown> {
  if (call.structuredContent) {
    return call.structuredContent;
  }
  const text = firstText(call);
  if (text !== null) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return { result: text };
    }
    return { result: text };
  }
  const data = call.content.find(
    (b): b is Extract<typeof b, { type: "image" | "audio" }> =>
      b.type === "image" || b.type === "audio"
  );
  if (data) {
    return { data: data.data, mimeType: data.mimeType };
  }
  return { content: call.content };
}

/** Normalize a complete MCP tool-call content union (see module docs). */
export function normalizeMcpToolOutcome(
  call: MCPToolCallContent
): NormalizedMcpToolOutcome {
  // Rule 1: isError wins over any contradictory nested success claim.
  if (call.isError) {
    return {
      success: false,
      payload: safeErrorPayload(call),
      isDomainEnvelope: false,
    };
  }
  // Rule 2: a valid domain envelope carries its own success semantics.
  const envelope = extractDomainEnvelope(call);
  if (envelope) {
    return { success: envelope.success, payload: envelope, isDomainEnvelope: true };
  }
  // Rule 3: legacy generic success.
  return {
    success: true,
    payload: legacyExtract(call),
    isDomainEnvelope: false,
  };
}
