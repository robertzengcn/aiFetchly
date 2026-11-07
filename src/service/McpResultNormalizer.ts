import type { MCPToolCallContent } from "@/modules/MCPClient";

/**
 * MCP tool-result normalization (plugin PRD §14, design §10.4).
 *
 * Precedence (table, authoritative):
 *   1. `isError: true` → FAILURE. Validated structured are preserved —
 *      the original structured error object keeps its code/strategies for the
 *      recovery path (B02) — with redaction and byte bounds.
 *   2. Versioned domain envelope v1 (structuredContent preferred; the bounded
 *      JSON text representation is a fallback only when structuredContent is
 *      absent). An envelope whose `schemaVersion` is not 1, or a
 *      structured/text pair whose `success` flags disagree, is a stable
 *      invalid-result failure — never success.
 *   3. Anything else → legacy generic success with the existing extraction,
 *      with no new interpretation of arbitrary nested fields.
 *
 * Transport/JSON-RPC failures never reach this module — they reject the SDK
 * call and are mapped to sanitized fatal errors by the executor.
 */

/** Model-facing bound on any error message text (PRD §14.3). */
const MAX_ERROR_TEXT_CHARS = 8_192;
/** Bound for serialized structured diagnostics (B02). */
const MAX_DIAGNOSTIC_BYTES = 8_192;
const MAX_DIAGNOSTIC_FIELD_CHARS = 256;
const MAX_DIAGNOSTIC_LIST = 16;
const MAX_DIAGNOSTIC_KEYS = 24;
/** Parse bound for a stray text block probed as the JSON contract copy. */
const MAX_ENVELOPE_TEXT_CHARS = 262_144;

/** The only supported domain result version (design §10.4). */
const SUPPORTED_RESULT_SCHEMA_VERSION = 1;

/** Keys whose string values are redacted before diagnostics persist. */
const SENSITIVE_KEY_PATTERN =
  /token|secret|password|authorization|cookie|api[-_]?key|access[-_]?token|refresh[-_]?token/i;

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

type EnvelopeVerdict =
  | { kind: "envelope"; envelope: Record<string, unknown> & { success: boolean } }
  | { kind: "not-envelope" }
  | { kind: "invalid"; reason: string };

/**
 * Classify a value as a versioned domain envelope (§10.4). Any object that
 * claims success semantics is held to the v1 contract: a missing or
 * unsupported schemaVersion is a stable invalid-result failure, not legacy
 * content (B02).
 */
function classifyEnvelope(value: unknown): EnvelopeVerdict {
  if (!isRecordWithBooleanSuccess(value)) return { kind: "not-envelope" };
  const version = (value as Record<string, unknown>).schemaVersion;
  if (version !== SUPPORTED_RESULT_SCHEMA_VERSION) {
    return {
      kind: "invalid",
      reason:
        typeof version === "number"
          ? `unsupported result schemaVersion ${version}`
          : "result envelope is missing schemaVersion 1",
    };
  }
  return {
    kind: "envelope",
    envelope: value as Record<string, unknown> & { success: boolean },
  };
}

function clipDiagnosticsValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > MAX_DIAGNOSTIC_FIELD_CHARS
      ? `${value.slice(0, MAX_DIAGNOSTIC_FIELD_CHARS)}…`
      : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_DIAGNOSTIC_LIST).map((v) => clipDiagnosticsValue(v));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    let kept = 0;
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (kept >= MAX_DIAGNOSTIC_KEYS) {
        out.diagnosticsTruncated = true;
        break;
      }
      // Sensitive keys blank the string value AND drop the key name,
      // keeping schema shape for consumers while leaking nothing (B02).
      out[SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : key] =
        SENSITIVE_KEY_PATTERN.test(key) &&
        (typeof entry === "string" || entry === null || entry === undefined)
          ? "[redacted]"
          : clipDiagnosticsValue(entry);
      kept += 1;
    }
    return out;
  }
  return value;
}

/**
 * Bound+redact structured diagnostics before they can persist or reach the
 * model (B02): sensitive string fields redacted, lists/maps clipped, the
 * whole payload hard-capped at 8 KiB with a truncation marker replacement.
 */
function boundedDiagnostics(value: unknown, maxBytes = MAX_DIAGNOSTIC_BYTES): unknown {
  const clipped = clipDiagnosticsValue(value);
  try {
    const encoded = JSON.stringify(clipped);
    if (Buffer.byteLength(encoded, "utf8") <= maxBytes) return clipped;
  } catch {
    /* circular or non-serializable — fall through to the marker */
  }
  return { diagnosticsTruncated: true };
}

/**
 * Build a bounded, safe error payload for an `isError: true` result.
 * The ORIGINAL structured error object is preserved (bounded+redacted) so
 * the query-loop recovery path keeps its code/strategies (B02); the spare
 * diagnostics stay bounded and the message text stays capped.
 */
function safeErrorPayload(call: MCPToolCallContent): {
  error: unknown;
  message?: string;
  diagnostics?: Record<string, unknown>;
} {
  const structured = call.structuredContent;
  if (
    structured &&
    typeof structured === "object" &&
    !Array.isArray(structured) &&
    Object.keys(structured).length > 0
  ) {
    const cloned: Record<string, unknown> = { ...structured };
    // A contradictory success flag inside an isError result is dropped —
    // the transport-level failure verdict wins (design §10.4 row 3).
    delete cloned.success;
    const originalError = cloned.error;
    let error: unknown;
    let message: string;
    if (
      originalError &&
      typeof originalError === "object" &&
      !Array.isArray(originalError) &&
      typeof (originalError as Record<string, unknown>).code === "string"
    ) {
      error = boundedDiagnostics(originalError);
      message =
        typeof (originalError as Record<string, unknown>).message === "string"
          ? ((originalError as Record<string, unknown>).message as string).slice(
              0,
              MAX_ERROR_TEXT_CHARS
            )
          : "MCP tool reported an error";
    } else {
      error =
        typeof cloned.message === "string"
          ? (cloned.message as string).slice(0, MAX_ERROR_TEXT_CHARS)
          : "MCP tool reported an error";
      message = typeof error === "string" ? error : "MCP tool reported an error";
    }
    return {
      error,
      message,
      diagnostics: boundedDiagnostics(cloned) as Record<string, unknown>,
    };
  }
  const text = firstText(call);
  if (text !== null) {
    const capped = text.slice(0, MAX_ERROR_TEXT_CHARS);
    return { error: capped, message: capped };
  }
  return { error: "MCP tool reported an error", message: "MCP tool reported an error" };
}

/**
 * Parse the first text block as the bounded JSON contract copy (falls back).
 * Non-JSON text is NOT a domain envelope — arbitrary prose is never parsed
 * as one (design §10.4). Oversized text is probed from its initial slice.
 */
function textEnvelopeCandidate(call: MCPToolCallContent): EnvelopeVerdict {
  const text = firstText(call);
  if (text === null) return { kind: "not-envelope" };
  const slice = text.slice(0, MAX_ENVELOPE_TEXT_CHARS);
  try {
    const parsed: unknown = JSON.parse(slice);
    return classifyEnvelope(parsed);
  } catch {
    return { kind: "not-envelope" };
  }
}

/**
 * Decide the versioned-contract outcome for a normal (non-isError) result:
 *   - structuredContent present and envelope-claiming → it is authoritative;
 *     its version must be supported and it must agree with the text copy.
 *   - structuredContent present but not claiming → classifyEnvelope's
 *     invalid-vs-legacy split (missing version with undefined BUT non-null
 *     structured is not the contract; keep legacy semantics).
 *   - structuredContent absent → the text JSON is the fallback.
 * Returns null when the call carries no contract claim (legacy semantics).
 */
function decideContractOutcome(
  call: MCPToolCallContent
): NormalizedMcpToolOutcome | null {
  const structured = call.structuredContent;
  const structuredPresent =
    structured !== undefined && structured !== null && typeof structured === "object" &&
    !Array.isArray(structured);
  if (structuredPresent) {
    const verdict = classifyEnvelope(structured);
    if (verdict.kind === "not-envelope") return null; // legacy, no new interpretation
    if (verdict.kind === "invalid") {
      return {
        success: false,
        payload: { error: verdict.reason, invalidResult: true },
        isDomainEnvelope: false,
      };
    }
    // Contradiction check: the text copy must not disagree with the
    // structured envelope (§10.4 "different consumers ... different results").
    const copy = textEnvelopeCandidate(call);
    if (copy.kind === "envelope" && copy.envelope.success !== verdict.envelope.success) {
      return {
        success: false,
        payload: {
          error:
            "contradictory structured and text result envelopes (the contract v1 copy may not disagree with structuredContent)",
          invalidResult: true,
        },
        isDomainEnvelope: false,
      };
    }
    if (copy.kind === "invalid") {
      return {
        success: false,
        payload: { error: copy.reason, invalidResult: true },
        isDomainEnvelope: false,
      };
    }
    return {
      success: verdict.envelope.success,
      payload: verdict.envelope,
      isDomainEnvelope: true,
    };
  }
  // structuredContent absent → text JSON fallback only.
  const textVerdict = textEnvelopeCandidate(call);
  if (textVerdict.kind === "envelope") {
    return {
      success: textVerdict.envelope.success,
      payload: textVerdict.envelope,
      isDomainEnvelope: true,
    };
  }
  if (textVerdict.kind === "invalid") {
    return {
      success: false,
      payload: { error: textVerdict.reason, invalidResult: true },
      isDomainEnvelope: false,
    };
  }
  return null;
}

/** Legacy generic extraction (mirrors MCPClient.callTool's success path). */
function legacyExtract(call: MCPToolCallContent): Record<string, unknown> {
  if (call.structuredContent && typeof call.structuredContent === "object") {
    return call.structuredContent as Record<string, unknown>;
  }
  const text = firstText(call);
  if (text !== null) {
    try {
      const parsed: unknown = JSON.parse(text.slice(0, MAX_ENVELOPE_TEXT_CHARS));
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
  // Rule 2: a versioned domain envelope carries its own success semantics,
  // with stable safe failures for unsupported versions and contradictions.
  const contract = decideContractOutcome(call);
  if (contract) return contract;
  // Rule 3: legacy generic success.
  return {
    success: true,
    payload: legacyExtract(call),
    isDomainEnvelope: false,
  };
}
