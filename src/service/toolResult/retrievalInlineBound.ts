/**
 * Keep `tool_result_read` and `tool_result_search` inside the model message.
 *
 * A retrieval page that is saved as another output forces the model to read a
 * receipt of the page instead of the page. The continuation cursor then sits
 * past the preview cutoff, and the model cannot turn to the next page.
 *
 * These helpers shrink a retrieval envelope until the wrapped tool-result
 * message fits the inline ceiling. They never create an output id.
 */
import { TOOL_RESULT_CONFIG } from "@/config/toolResultConfig";
import {
  countTextTokens,
  truncateUtf8Safe,
  utf8ByteLength,
} from "@/service/ToolResultTextUtil";
import {
  decodeToolResultCursor,
  digestSearchQuery,
  encodeToolResultCursor,
} from "@/service/toolResult/ToolResultCursorCodec";

/**
 * Bytes reserved so the preparation wrapper (status, timing, duplicated
 * `next_cursor`) still fits after the envelope itself has been bounded.
 * Token accounting here is one token per byte.
 */
const WRAP_SLACK_BYTES = 256;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when a serialized tool message is small enough to stay inline. */
export function retrievalSerializedFits(serialized: string): boolean {
  return (
    utf8ByteLength(serialized) <= TOOL_RESULT_CONFIG.inlineMaxBytes &&
    countTextTokens(serialized) <= TOOL_RESULT_CONFIG.inlineMaxTokens
  );
}

/**
 * Approximate the message preparation will wrap around a retrieval body.
 * Used only to decide whether another shrink step is required.
 */
export function simulateRetrievalWrap(output: unknown): string {
  const control: Record<string, unknown> = {};
  if (isRecord(output) && typeof output.next_cursor === "string") {
    control.next_cursor = output.next_cursor;
  }
  return JSON.stringify({
    success: true,
    executionTimeMs: 0,
    result: output,
    ...(Object.keys(control).length > 0 ? { control } : {}),
  });
}

function wrapFits(output: unknown): boolean {
  const serialized = simulateRetrievalWrap(output);
  return (
    utf8ByteLength(serialized) <=
      TOOL_RESULT_CONFIG.inlineMaxBytes - WRAP_SLACK_BYTES &&
    countTextTokens(serialized) <=
      TOOL_RESULT_CONFIG.inlineMaxTokens - WRAP_SLACK_BYTES
  );
}

function revisionFromReadCursor(
  cursor: unknown,
  outputId: string
): number | null {
  if (typeof cursor !== "string" || outputId.length === 0) return null;
  const decoded = decodeToolResultCursor(cursor, { outputId, mode: "read" });
  return decoded.ok ? decoded.payload.revision : null;
}

function revisionFromSearchCursor(
  cursor: unknown,
  outputId: string
): number | null {
  if (typeof cursor !== "string" || outputId.length === 0) return null;
  const decoded = decodeToolResultCursor(cursor, {
    outputId,
    mode: "search",
  });
  return decoded.ok ? decoded.payload.revision : null;
}

function revisionForSearch(record: Record<string, unknown>): number | null {
  const outputId =
    typeof record.output_id === "string" ? record.output_id : "";
  if (typeof record.revision === "number" && Number.isInteger(record.revision)) {
    return record.revision;
  }
  if (Array.isArray(record.matches)) {
    for (const match of record.matches) {
      if (!isRecord(match)) continue;
      const revision = revisionFromReadCursor(match.read_cursor, outputId);
      if (revision !== null) return revision;
    }
  }
  return revisionFromSearchCursor(record.next_cursor, outputId);
}

function revisionForRead(record: Record<string, unknown>): number | null {
  const outputId =
    typeof record.output_id === "string" ? record.output_id : "";
  if (typeof record.revision === "number" && Number.isInteger(record.revision)) {
    return record.revision;
  }
  return revisionFromReadCursor(record.next_cursor, outputId);
}

/**
 * Drop the last search hit and resume the scan at that hit.
 * Returns null when the envelope has no match list to shrink.
 */
function shrinkSearchEnvelope(
  record: Record<string, unknown>
): Record<string, unknown> | null {
  const matches = record.matches;
  if (!Array.isArray(matches) || matches.length === 0) return null;

  if (matches.length > 1) {
    const dropped = matches[matches.length - 1];
    const startByte =
      isRecord(dropped) && typeof dropped.start_byte === "number"
        ? dropped.start_byte
        : null;
    const outputId =
      typeof record.output_id === "string" ? record.output_id : "";
    const query = typeof record.query === "string" ? record.query : "";
    const revision = revisionForSearch(record);
    const nextCursor =
      startByte !== null && outputId.length > 0 && query.length > 0 && revision !== null
        ? encodeToolResultCursor({
            outputId,
            revision,
            mode: "search",
            position: startByte,
            queryDigest: digestSearchQuery(query),
            lastMatchEnd: startByte,
          })
        : null;
    return {
      ...record,
      matches: matches.slice(0, -1),
      scan_complete: false,
      next_cursor: nextCursor,
    };
  }

  const only = matches[0];
  if (!isRecord(only) || typeof only.excerpt !== "string") return null;
  if (utf8ByteLength(only.excerpt) <= 40) return null;
  return {
    ...record,
    matches: [
      {
        ...only,
        excerpt: truncateUtf8Safe(
          only.excerpt,
          Math.floor(utf8ByteLength(only.excerpt) * 0.75)
        ),
      },
    ],
  };
}

/** Shorten a read page and point `next_cursor` at the first omitted byte. */
function shrinkReadEnvelope(
  record: Record<string, unknown>
): Record<string, unknown> | null {
  if (typeof record.text !== "string") return null;
  const text = record.text;
  if (utf8ByteLength(text) <= 1) return null;
  const nextText = truncateUtf8Safe(
    text,
    Math.max(1, Math.floor(utf8ByteLength(text) * 0.75))
  );
  if (nextText === text) return null;

  const start = typeof record.start_byte === "number" ? record.start_byte : 0;
  const end = start + utf8ByteLength(nextText);
  const total =
    typeof record.total_bytes === "number" ? record.total_bytes : end;
  const outputId =
    typeof record.output_id === "string" ? record.output_id : "";
  const revision = revisionForRead(record);
  const complete = end >= total;
  const nextCursor =
    complete || outputId.length === 0 || revision === null
      ? null
      : encodeToolResultCursor({
          outputId,
          revision,
          mode: "read",
          position: end,
        });
  return {
    ...record,
    text: nextText,
    end_byte: end,
    complete,
    next_cursor: complete ? null : nextCursor,
  };
}

function shrinkOnce(
  record: Record<string, unknown>
): Record<string, unknown> | null {
  if (Array.isArray(record.matches)) return shrinkSearchEnvelope(record);
  if (typeof record.text === "string") return shrinkReadEnvelope(record);
  return null;
}

function withoutRevision(record: Record<string, unknown>): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...record };
  delete rest.revision;
  return rest;
}

/**
 * Shrink a retrieval envelope until its wrapped form fits inline.
 *
 * Returns null when the value cannot be shrunk into the ceiling. Callers
 * then return a bounded error instead of saving another output.
 */
export function fitWrappedRetrievalResult(output: unknown): unknown {
  if (typeof output === "string") {
    let text = output;
    while (!wrapFits(text) && text.length > 0) {
      const next = truncateUtf8Safe(text, Math.floor(utf8ByteLength(text) * 0.75));
      if (next === text) break;
      text = next;
    }
    return text;
  }
  if (!isRecord(output)) return output;

  let current: Record<string, unknown> = { ...output };
  for (let attempt = 0; attempt < 48; attempt += 1) {
    if (wrapFits(current)) return withoutRevision(current);
    const next = shrinkOnce(current);
    if (!next) return null;
    current = next;
  }
  return null;
}
