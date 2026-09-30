import "reflect-metadata";
import { TOOL_RESULT_CONFIG } from "@/config/toolResultConfig";
import type {
  ToolOutputFormat,
  ToolResultErrorCode,
  ToolResultReadPage,
  ToolResultSearchMatch,
  ToolResultSearchPage,
} from "@/entityTypes/toolResultTypes";
import {
  decodeToolResultCursor,
  digestSearchQuery,
  encodeToolResultCursor,
} from "@/service/toolResult/ToolResultCursorCodec";
import { utf8ByteLength } from "@/service/ToolResultTextUtil";
import type { ToolResultStorageService } from "@/service/toolResult/ToolResultStorageService";

/**
 * Authorized, bounded, incremental read and literal search over a preserved
 * output (technical design §8).
 *
 * The reader is deliberately INDEPENDENT of `FileToolService`: that service
 * rejects a file over 2 MB before applying offset/limit, loads whole files,
 * and has workspace-trust restrictions, so it cannot implement reliable
 * recovery from an arbitrarily large saved output.
 *
 * Two properties are load-bearing and easy to get wrong:
 *
 *  - `scan_complete: true` means every byte of the CAPTURED representation was
 *    examined. It never means the producer's own output was complete: a
 *    producer that truncated upstream leaves an incomplete capture that can be
 *    fully scanned and still not prove absence from the original.
 *  - A partial search with no matches is a valid result. "No matches in this
 *    page" is not "no matches in the output", and the envelope says which one
 *    the caller is looking at.
 */

/** What the caller is allowed to know about the target. */
export interface RetrievalTarget {
  readonly outputId: string;
  readonly revision: number;
  readonly storageKey: string;
  readonly format: ToolOutputFormat;
  readonly capturedBytes: number;
  readonly sourceCompleteness: "complete" | "partial" | "unknown";
}

/** Trusted identity the authorization layer already validated. */
export interface RetrievalIdentity {
  readonly profileId: string;
  readonly conversationId: string;
  readonly agentId?: string;
  readonly turnId: string;
}

/** Read outcome, or a bounded reason it could not be produced. */
export type ReadOutcome =
  | { readonly ok: true; readonly page: ToolResultReadPage }
  | { readonly ok: false; readonly code: ToolResultErrorCode };

/** Search outcome, or a bounded reason it could not be produced. */
export type SearchOutcome =
  | { readonly ok: true; readonly page: ToolResultSearchPage }
  | { readonly ok: false; readonly code: ToolResultErrorCode };

/** Cooperative yield hook so scanning does not stall the event loop. */
export type RetrievalYield = () => void | Promise<void>;

export class ToolResultRetrievalService {
  private readonly storage: ToolResultStorageService;
  private readonly onYield?: RetrievalYield;

  constructor(storage: ToolResultStorageService, onYield?: RetrievalYield) {
    this.storage = storage;
    this.onYield = onYield;
  }

  /**
   * Read one bounded page, resuming from an optional cursor.
   *
   * The page is bounded by BYTES and by the model TOKEN allowance including
   * the envelope. A caller-requested `maxTokens` can only make the page
   * smaller; it can never widen the configured ceiling.
   */
  async read(input: {
    readonly target: RetrievalTarget;
    readonly cursor?: string;
    /** Model page budget in tokens; clamped to the configured maximum. */
    readonly maxTokens?: number;
    /** Renderer page budget in bytes; clamped to the UI maximum. */
    readonly maxBytes?: number;
  }): Promise<ReadOutcome> {
    const config = TOOL_RESULT_CONFIG;
    if (input.target.format === "binary") {
      // Never inline base64. The user can still export the artifact.
      return { ok: false, code: "OUTPUT_FORMAT_UNSUPPORTED" };
    }

    let startByte = 0;
    let revision = input.target.revision;
    if (input.cursor) {
      const decoded = decodeToolResultCursor(input.cursor, {
        outputId: input.target.outputId,
        mode: "read",
        revision: input.target.revision,
      });
      if (!decoded.ok) return { ok: false, code: decoded.code };
      startByte = decoded.payload.position;
      revision = decoded.payload.revision;
    }
    if (revision !== input.target.revision) {
      return { ok: false, code: "OUTPUT_CHANGED" };
    }

    // Byte ceiling: the smaller of the model page and the UI page.
    const byteCeiling = Math.min(
      input.maxBytes ?? config.readMaxBytes,
      config.uiReadMaxBytes,
      config.readMaxBytes
    );
    // Token ceiling, converted to a conservative byte bound.
    const tokenCeiling = Math.min(
      input.maxTokens ?? config.readMaxTokens,
      config.readMaxTokens
    );
    const tokenByteCeiling = Math.max(
      1,
      Math.floor((tokenCeiling * 0.8) / 1)
    );
    const maxBytes = Math.max(1, Math.min(byteCeiling, tokenByteCeiling));

    let window: { buffer: Buffer; totalBytes: number };
    try {
      window = await this.storage.readWindow({
        storageKey: input.target.storageKey,
        startByte,
        maxBytes,
      });
    } catch {
      return { ok: false, code: "OUTPUT_NOT_AVAILABLE" };
    }

    if (startByte > 0 && startByte >= window.totalBytes) {
      // The artifact changed or shrank under this cursor. Serving an empty page
      // marked complete would certify a full read that never happened.
      return { ok: false, code: "OUTPUT_CHANGED" };
    }
    const text = decodeUtf8Window(window.buffer, startByte);
    const endByte = startByte + Buffer.byteLength(text, "utf8");
    const complete = endByte >= window.totalBytes;
    const nextCursor = complete
      ? null
      : encodeToolResultCursor({
          outputId: input.target.outputId,
          revision: input.target.revision,
          mode: "read",
          position: endByte,
        });

    return {
      ok: true,
      page: {
        outputId: input.target.outputId,
        text,
        startByte,
        endByte,
        totalBytes: window.totalBytes,
        nextCursor,
        complete,
      },
    };
  }

  /**
   * Search the captured bytes for a LITERAL substring.
   *
   * The scan is bounded by BYTES and by TIME per call. A query that spans an
   * internal buffer boundary is not lost: `queryByteLength - 1` bytes of
   * overlap are carried forward, and a match whose start is at or before the
   * last committed match end is suppressed so a boundary match is reported
   * exactly once.
   */
  async search(input: {
    readonly target: RetrievalTarget;
    readonly query: string;
    readonly cursor?: string;
    readonly maxMatches?: number;
  }): Promise<SearchOutcome> {
    const config = TOOL_RESULT_CONFIG;
    if (input.target.format === "binary") {
      return { ok: false, code: "OUTPUT_FORMAT_UNSUPPORTED" };
    }
    if (input.query.length === 0 || input.query.length > config.searchQueryMaxChars) {
      return { ok: false, code: "INVALID_OUTPUT_CURSOR" as ToolResultErrorCode };
    }

    const queryDigest = digestSearchQuery(input.query);
    const queryBytes = Buffer.from(input.query, "utf8");
    const overlap = Math.max(0, queryBytes.byteLength - 1);

    let position = 0;
    let lastMatchEnd = 0;
    if (input.cursor) {
      const decoded = decodeToolResultCursor(input.cursor, {
        outputId: input.target.outputId,
        mode: "search",
        revision: input.target.revision,
        queryDigest,
      });
      if (!decoded.ok) return { ok: false, code: decoded.code };
      position = decoded.payload.position;
      lastMatchEnd = decoded.payload.lastMatchEnd ?? 0;
    }

    const maxMatches = Math.min(
      input.maxMatches ?? config.searchDefaultMaxMatches,
      config.searchMaxMatches
    );
    const scanCeiling = config.searchMaxScanBytes;
    const deadline = Date.now() + config.searchMaxMs;

    const matches: ToolResultSearchMatch[] = [];
    let scanned = 0;
    let scanComplete = false;
    // Explicitly typed: `combined.subarray()` widens to Buffer<ArrayBufferLike>,
    // which is not assignable to the default Buffer<ArrayBuffer>.
    let carry: Buffer = Buffer.alloc(0);
    // Absolute offset of carry[0].
    let carryStart = position;
    let cursorPosition = position;

    while (scanned < scanCeiling) {
      if (Date.now() >= deadline) break;
      const budget = Math.min(64 * 1024, scanCeiling - scanned);
      let window: { buffer: Buffer; totalBytes: number };
      try {
        window = await this.storage.readWindow({
          storageKey: input.target.storageKey,
          startByte: cursorPosition,
          maxBytes: budget,
        });
      } catch {
        return { ok: false, code: "OUTPUT_NOT_AVAILABLE" };
      }
      if (window.buffer.byteLength === 0) {
        scanComplete = true;
        break;
      }

      const combined =
        carry.byteLength > 0
          ? Buffer.concat([carry, window.buffer])
          : window.buffer;
      const searchFrom = 0;
      let offset = combined.indexOf(queryBytes, searchFrom);
      while (offset >= 0) {
        const absolute = carryStart + offset;
        // Suppress a match that a previous call already committed, which is
        // what a query spanning a buffer boundary would otherwise duplicate.
        if (absolute >= lastMatchEnd) {
          matches.push(
            buildMatch({
              outputId: input.target.outputId,
              revision: input.target.revision,
              combined,
              // `combined` starts at absolute offset carryStart, so a match's
              // index INSIDE the buffer is absolute - carryStart. Slicing with
              // the absolute offset would read past the end of the window.
              indexInBuffer: absolute - carryStart,
              absolute,
              queryBytes,
            })
          );
          lastMatchEnd = absolute + queryBytes.byteLength;
          if (matches.length >= maxMatches) break;
        }
        offset = combined.indexOf(queryBytes, offset + 1);
      }

      scanned += window.buffer.byteLength;
      cursorPosition += window.buffer.byteLength;
      if (matches.length >= maxMatches) break;
      if (cursorPosition >= window.totalBytes) {
        // Only here is it true that EVERY byte of the captured representation
        // was examined.
        scanComplete = true;
        break;
      }
      // Carry the overlap so a match crossing the boundary is still found.
      carry = combined.subarray(Math.max(0, combined.byteLength - overlap));
      carryStart = cursorPosition - carry.byteLength;
      await this.onYield?.();
    }

    const nextCursor = scanComplete
      ? null
      : // A continuation is REQUIRED whenever the scan stopped early, including
        // when it stopped because the match budget filled up. Returning null
        // there would tell the model "no more matches exist" when in fact the
        // rest of the output was never examined - the exact overclaim AC-16/17
        // exist to prevent. `position` resumes at the first unexamined byte.
        encodeToolResultCursor({
          outputId: input.target.outputId,
          revision: input.target.revision,
          mode: "search",
          position: cursorPosition,
          queryDigest,
          lastMatchEnd,
        });

    return {
      ok: true,
      page: {
        outputId: input.target.outputId,
        matches,
        scanComplete,
        nextCursor,
        // Deliberately the PRODUCER's completeness, not the scan's: a fully
        // scanned incomplete capture still cannot prove absence upstream.
        sourceCompleteness: input.target.sourceCompleteness,
      },
    };
  }
}

/** Build a bounded excerpt plus a read cursor anchored at the match. */
function buildMatch(input: {
  outputId: string;
  revision: number;
  combined: Buffer;
  /** Index of the match WITHIN `combined`. */
  indexInBuffer: number;
  /** Index of the match in the whole captured output. */
  absolute: number;
  queryBytes: Buffer;
}): ToolResultSearchMatch {
  const context = 120;
  const start = Math.max(0, input.indexInBuffer - context);
  const end = Math.min(
    input.combined.byteLength,
    input.indexInBuffer + input.queryBytes.byteLength + context
  );
  const slice = input.combined.subarray(start, end);
  // Snap the excerpt to text boundaries so a multi-byte character is never cut.
  const excerpt = decodeUtf8Window(slice, input.absolute - (input.indexInBuffer - start));
  return {
    startByte: input.absolute,
    endByte: input.absolute + input.queryBytes.byteLength,
    excerpt,
    readCursor: encodeToolResultCursor({
      outputId: input.outputId,
      revision: input.revision,
      mode: "read",
      position: input.absolute - (input.indexInBuffer - start),
    }),
  };
}

/**
 * Decode a byte window as UTF-8 without producing replacement characters at
 * the window edges.
 *
 * A raw Buffer.toString() on an arbitrary slice turns a split multi-byte
 * sequence into U+FFFD, which is exactly the "broken character" failure the
 * design forbids. Instead the incomplete trailing sequence is trimmed and the
 * remainder is replaced with the continuation marker, and a leading partial
 * sequence is dropped.
 */
export function decodeUtf8Window(buffer: Buffer, absoluteStart: number): string {
  let start = 0;
  let end = buffer.byteLength;

  // Trim a partial sequence at the END.
  let i = end - 1;
  while (i >= 0 && (buffer[i] & 0xc0) === 0x80) i -= 1;
  if (i >= 0) {
    const lead = buffer[i];
    const needed =
      lead < 0x80 ? 1 : (lead & 0xe0) === 0xc0 ? 2 : (lead & 0xf0) === 0xe0 ? 3 : (lead & 0xf8) === 0xf0 ? 4 : 1;
    if (end - i < needed) end = i;
  }

  // Drop a partial sequence at the START (a continuation byte with no lead).
  if (absoluteStart > 0 && start < end && (buffer[start] & 0xc0) === 0x80) {
    start += 1;
    while (start < end && (buffer[start] & 0xc0) === 0x80) start += 1;
  }

  const text = buffer.subarray(start, end).toString("utf8");
  return utf8ByteLength(text) > 0 ? text : "";
}