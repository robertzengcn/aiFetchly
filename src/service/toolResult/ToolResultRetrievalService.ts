import "reflect-metadata";
import { TOOL_RESULT_CONFIG } from "@/config/toolResultConfig";
import type {
  ToolOutputFormat,
  ToolResultErrorCode,
  ToolResultReadPage,
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
  /** Which backend holds the captured representation. */
  readonly backend?: "file" | "legacy_message";
  /**
   * Source row identity, required for the `legacy_message` backend. Absent for
   * file artifacts, whose bytes live under `storageKey`.
   */
  readonly sourceRowKey?: string;
  readonly storageKey: string;
  readonly format: ToolOutputFormat;
  readonly capturedBytes: number;
  readonly sourceCompleteness: "complete" | "partial" | "unknown";
  /**
   * Manifest subset the caller (which holds the output row) forwards for the
   * cheap identity+size check on open (technical design §8.4). Absent for
   * artifacts that predate manifests — those are unverified, not corrupt — and
   * never applied to a `legacy_message` reference (§10.2: it has no checksum
   * and must not be given a fabricated one).
   */
  readonly manifest?: { readonly sha256: string; readonly capturedBytes: number };
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

/**
 * Backend-agnostic bounded reader.
 *
 * Both backends expose the SAME contract - scope, page, and budget are
 * identical (technical design §10.2) - so a caller cannot accidentally give a
 * legacy row looser limits than a file artifact.
 */
export interface BoundedSourceReader {
  read(input: {
    target: RetrievalTarget;
    startByte: number;
    maxBytes: number;
  }): Promise<{ buffer: Buffer; totalBytes: number }>;
}

/** The default: bytes come from the app-managed file. */
function defaultFileSourceReader(
  storage: ToolResultStorageService
): BoundedSourceReader {
  return {
    read: (input) =>
      storage.readWindow({
        storageKey: input.target.storageKey,
        startByte: input.startByte,
        maxBytes: input.maxBytes,
      }),
  };
}

/**
 * Reader for the `legacy_message` backend.
 *
 * The source row is a historical tool-result message whose full text still
 * lives in `ai_chat_messages`. Slicing is pushed into SQL so a page never
 * materializes the whole row, and no file quota is charged because no bytes are
 * copied (technical design §10.2).
 */
export function legacySourceReader(input: {
  readSlice: (args: {
    sourceRowKey: string;
    offsetBytes: number;
    lengthBytes: number;
  }) => Promise<{ text: string; totalBytes: number } | null>;
}): BoundedSourceReader {
  return {
    async read({ target, startByte, maxBytes }) {
      if (target.backend !== "legacy_message" || !target.sourceRowKey) {
        throw new Error("legacy reader asked for a non-legacy target");
      }
      const slice = await input.readSlice({
        sourceRowKey: target.sourceRowKey,
        offsetBytes: startByte,
        lengthBytes: maxBytes,
      });
      if (!slice) throw new Error("legacy source row is missing");
      return { buffer: Buffer.from(slice.text, "utf8"), totalBytes: slice.totalBytes };
    },
  };
}

/**
 * Dispatch by backend so ONE service can serve both representations.
 *
 * `ToolResultRetrievalService` already speaks one paging/budget contract for
 * both backends (technical design §10.2); only the byte SOURCE differs. A
 * caller that injects a single reader therefore commits every target to that
 * one backend - which is why passing the file reader alone made every
 * file-backed output unreadable in the model path, and passing the legacy
 * reader alone made every legacy row unreadable.
 *
 * This factory picks per target instead, so a caller cannot get it wrong.
 */
export function dispatchingSourceReader(input: {
  file: BoundedSourceReader;
  legacy: BoundedSourceReader;
}): BoundedSourceReader {
  return {
    async read(request) {
      const reader =
        request.target.backend === "legacy_message" ? input.legacy : input.file;
      return await reader.read(request);
    },
  };
}

/**
 * Build the production retrieval service for a conversation.
 *
 * Both backends are wired here, once, from trusted main-process state:
 *
 *  - `file`      reads the app-managed artifact under `storageKey`.
 *  - `legacy`    slices a historical tool-result message row in SQL, through
 *                the Module so the retrieval service never touches a repository.
 *
 * A legacy target without a `sourceRowKey`, or a file target without a
 * `storageKey`, is a registry inconsistency and is reported as
 * `OUTPUT_NOT_AVAILABLE` rather than being read from a wrong source.
 */
export function createToolResultRetrievalService(input: {
  readonly storage: ToolResultStorageService;
  readonly module: {
    readLegacySourceSlice(args: {
      sourceRowKey: string;
      offsetBytes: number;
      lengthBytes: number;
    }): Promise<{ buffer: Buffer; totalBytes: number } | null>;
  };
  readonly onYield?: RetrievalYield;
}): ToolResultRetrievalService {
  const file = defaultFileSourceReader(input.storage);
  const legacy: BoundedSourceReader = {
    async read({ target, startByte, maxBytes }) {
      if (!target.sourceRowKey) {
        // Never fall back to the file reader for a legacy row: there are no
        // file bytes, and guessing a key could read an unrelated artifact.
        throw new Error("legacy target has no source row key");
      }
      const slice = await input.module.readLegacySourceSlice({
        sourceRowKey: target.sourceRowKey,
        offsetBytes: startByte,
        lengthBytes: maxBytes,
      });
      if (!slice) throw new Error("legacy source row is missing");
      // Use the raw bytes directly — no string round-trip. A slice that ends
      // mid-multibyte-sequence keeps its partial bytes so `decodeUtf8Window`
      // can re-sync; a toString("utf8")→Buffer.from round-trip would replace
      // the partial sequence with U+FFFD's bytes and corrupt the window.
      return {
        buffer: slice.buffer,
        totalBytes: slice.totalBytes,
      };
    },
  };
  return new ToolResultRetrievalService(
    input.storage,
    dispatchingSourceReader({ file, legacy }),
    input.onYield
  );
}

export class ToolResultRetrievalService {
  private readonly storage: ToolResultStorageService;
  private readonly onYield?: RetrievalYield;

  /** Reads a bounded BYTE window of whatever backend holds the output. */
  readonly readSource: BoundedSourceReader;

  constructor(
    storage: ToolResultStorageService,
    readSource?: BoundedSourceReader,
    onYield?: RetrievalYield
  ) {
    this.storage = storage;
    this.readSource = readSource ?? defaultFileSourceReader(storage);
    this.onYield = onYield;
  }

  /** True when this target is served from a historical source row. */
  private isLegacy(target: RetrievalTarget): boolean {
    return target.backend === "legacy_message" && !!target.sourceRowKey;
  }

  /**
   * Cheap identity+size check on open (technical design §8.4).
   *
   * The file backend reports the artifact's actual on-disk size as
   * `totalBytes`, so comparing it against the manifest's recorded
   * `capturedBytes` catches a shrunken or replaced payload with NO extra I/O.
   * The full cryptographic checksum stays on sealing/recovery/export — never a
   * re-hash per paged read. Skipped for the `legacy_message` backend (§10.2: a
   * source row has no checksum and must not be judged by a fabricated one) and
   * when the caller passed no manifest (pre-manifest artifacts are unverified,
   * not corrupt).
   */
  private identityMismatch(target: RetrievalTarget, totalBytes: number): boolean {
    if (target.backend === "legacy_message") return false;
    const manifest = target.manifest;
    if (!manifest) return false;
    return totalBytes !== manifest.capturedBytes;
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

    // Page budget by caller, per TD §557/§563: the user viewer uses the 32 KiB
    // UI page budget and does NOT consume model retrieval-work tokens; a
    // model-triggered read uses the stricter model page budget. The caller is
    // identified by which field it passes: the IPC renderer path passes
    // `maxBytes` (a UI byte request), the model tool passes `maxTokens`. So a
    // byte-only request is bounded ONLY by the UI byte ceiling, never by the
    // model page (`readMaxBytes`) or token ceilings; a token request is also
    // bounded by both model budgets. Applying the model budgets to a byte-only
    // request collapsed the 32 KiB UI page to 8 KiB (readMaxBytes) and then to
    // ~1600 bytes (tokenByteCeiling), making a fact planted a few KiB in
    // unreachable on page one (T18).
    let maxBytes: number;
    if (input.maxTokens !== undefined) {
      // Model path: token budget + model byte budget, both enforced.
      const tokenCeiling = Math.min(input.maxTokens, config.readMaxTokens);
      const tokenByteCeiling = Math.max(1, Math.floor((tokenCeiling * 0.8) / 1));
      maxBytes = Math.max(
        1,
        Math.min(
          tokenByteCeiling,
          input.maxBytes ?? config.readMaxBytes,
          config.readMaxBytes
        )
      );
    } else {
      // UI path: bounded only by the requested page (clamped to the UI ceiling).
      // The model byte/token budgets do not apply.
      maxBytes = Math.max(
        1,
        Math.min(input.maxBytes ?? config.uiReadMaxBytes, config.uiReadMaxBytes)
      );
    }

    let window: { buffer: Buffer; totalBytes: number };
    try {
      window = await this.readSource.read({
        target: input.target,
        startByte,
        maxBytes,
      });
    } catch {
      return { ok: false, code: "OUTPUT_NOT_AVAILABLE" };
    }

    if (this.identityMismatch(input.target, window.totalBytes)) {
      // The payload on disk no longer matches what the manifest recorded, so
      // the bytes just fetched are not the evidence the registry claims.
      return { ok: false, code: "OUTPUT_INTEGRITY_FAILED" };
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
    // True once THIS call has committed at least one match.
    //
    // `lastMatchEnd` is only a meaningful resume point after a match was
    // actually committed. While it is still 0 (no match found yet) it must NOT
    // be used to rewind, or a document larger than the scan ceiling whose first
    // window contains no match would resume at byte 0 forever.
    let committedAnyMatch = false;
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
      // A prior page committed matches, so its end is a valid rewind point.
      committedAnyMatch = lastMatchEnd > 0;
    }

    const maxMatches = Math.min(
      input.maxMatches ?? config.searchDefaultMaxMatches,
      config.searchMaxMatches
    );
    const scanCeiling = config.searchMaxScanBytes;
    const deadline = Date.now() + config.searchMaxMs;

    const matches: FoldedSearchMatch[] = [];
    // Set when the next hit would open a window past `maxMatches`. The
    // continuation cursor starts AT that hit so the next page shows new text.
    let resumePosition: number | null = null;
    let scanned = 0;
    let scanComplete = false;
    // Explicitly typed: `combined.subarray()` widens to Buffer<ArrayBufferLike>,
    // which is not assignable to the default Buffer<ArrayBuffer>.
    let carry: Buffer = Buffer.alloc(0);
    // Absolute offset of carry[0].
    let carryStart = position;
    let cursorPosition = position;

    scan: while (scanned < scanCeiling) {
      if (Date.now() >= deadline) break;
      const budget = Math.min(64 * 1024, scanCeiling - scanned);
      let window: { buffer: Buffer; totalBytes: number };
      try {
        window = await this.readSource.read({
          target: input.target,
          startByte: cursorPosition,
          maxBytes: budget,
        });
      } catch {
        return { ok: false, code: "OUTPUT_NOT_AVAILABLE" };
      }
      if (this.identityMismatch(input.target, window.totalBytes)) {
        // Same gate as `read`: a payload that no longer matches its manifest is
        // not evidence, and scanning it would report matches against bytes the
        // registry never wrote.
        return { ok: false, code: "OUTPUT_INTEGRITY_FAILED" };
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
          const previous = matches[matches.length - 1];
          if (previous && absolute < previous.excerptEndByte) {
            // Same window of text. Counting the hit is enough; another
            // excerpt would repeat the prefix the model already has.
            previous.matchCountInWindow += 1;
            lastMatchEnd = absolute + queryBytes.byteLength;
          } else if (matches.length >= maxMatches) {
            resumePosition = absolute;
            break scan;
          } else {
            const folded = buildMatch({
              outputId: input.target.outputId,
              revision: input.target.revision,
              combined,
              // `combined` starts at absolute offset carryStart, so a match's
              // index INSIDE the buffer is absolute - carryStart. Slicing with
              // the absolute offset would read past the end of the window.
              indexInBuffer: absolute - carryStart,
              absolute,
              queryBytes,
            });
            matches.push(folded);
            lastMatchEnd = absolute + queryBytes.byteLength;
            committedAnyMatch = true;
          }
        }
        offset = combined.indexOf(queryBytes, offset + 1);
      }

      scanned += window.buffer.byteLength;
      cursorPosition += window.buffer.byteLength;

      // Carry the overlap BEFORE any break so it is correct for every exit
      // path, not just the fall-through one.
      //
      // The continuation must resume at the START of the overlap, not at
      // `cursorPosition`: a match that begins a few bytes before the end of
      // this window and extends past it cannot be found here (its tail has not
      // been read yet) and would never be found on a continuation that resumes
      // at `cursorPosition`, because its START is already behind the cursor.
      // Resuming at `carryStart` re-reads at most `queryBytes.byteLength - 1`
      // bytes, and `lastMatchEnd` suppresses anything already committed, so the
      // overlap is exactly the idempotent window.
      carry = combined.subarray(Math.max(0, combined.byteLength - overlap));
      carryStart = cursorPosition - carry.byteLength;

      if (cursorPosition >= window.totalBytes) {
        // Only here is it true that EVERY byte of the captured representation
        // was examined.
        scanComplete = true;
        break;
      }
      await this.onYield?.();
    }

    const nextCursor = scanComplete
      ? null
      : encodeToolResultCursor({
          outputId: input.target.outputId,
          revision: input.target.revision,
          mode: "search",
          // Resume at the first byte that could still begin an UNCOMMITTED
          // match, NOT at the end of the last window.
          //
          // Three stop reasons need three positions:
          //
          //  - Match budget filled: `resumePosition` is the first hit that
          //    would open another excerpt window. Hits inside the returned
          //    windows were counted, so the next page starts at new text.
          //  - Ceiling/deadline: the whole window WAS examined, so only the
          //    trailing overlap can still begin an uncommitted match, and
          //    resuming at `carryStart` avoids re-scanning megabytes.
          //  - A match was committed and the scan stopped for another reason:
          //    resume at `lastMatchEnd`, never past bytes that were not read.
          //
          // Clamped so the cursor is MONOTONIC when nothing was committed: with no
          // match in this page, `lastMatchEnd` is still 0 and using it would
          // rewind to the very start, re-scanning the same bytes forever.
          position:
            resumePosition !== null
              ? resumePosition
              : committedAnyMatch
                ? Math.min(lastMatchEnd, carryStart)
                : carryStart,
          queryDigest,
          lastMatchEnd: resumePosition !== null ? resumePosition : lastMatchEnd,
        });

    return {
      ok: true,
      page: {
        outputId: input.target.outputId,
        matches: matches.map((match) => ({
          startByte: match.startByte,
          endByte: match.endByte,
          excerpt: match.excerpt,
          readCursor: match.readCursor,
          matchCountInWindow: match.matchCountInWindow,
        })),
        scanComplete,
        nextCursor,
        // Deliberately the PRODUCER's completeness, not the scan's: a fully
        // scanned incomplete capture still cannot prove absence upstream.
        sourceCompleteness: input.target.sourceCompleteness,
      },
    };
  }
}

/** A search hit plus the absolute end of its excerpt, used to fold neighbors. */
interface FoldedSearchMatch {
  startByte: number;
  endByte: number;
  excerpt: string;
  readCursor: string;
  matchCountInWindow: number;
  excerptEndByte: number;
}

/** Build a bounded excerpt plus a read cursor anchored at the match byte. */
function buildMatch(input: {
  outputId: string;
  revision: number;
  combined: Buffer;
  /** Index of the match WITHIN `combined`. */
  indexInBuffer: number;
  /** Index of the match in the whole captured output. */
  absolute: number;
  queryBytes: Buffer;
}): FoldedSearchMatch {
  const context = 120;
  const start = Math.max(0, input.indexInBuffer - context);
  const end = Math.min(
    input.combined.byteLength,
    input.indexInBuffer + input.queryBytes.byteLength + context
  );
  const slice = input.combined.subarray(start, end);
  // Snap the excerpt to text boundaries so a multi-byte character is never cut.
  const excerpt = decodeUtf8Window(slice, input.absolute - (input.indexInBuffer - start));
  const excerptStartAbsolute = input.absolute - (input.indexInBuffer - start);
  return {
    startByte: input.absolute,
    endByte: input.absolute + input.queryBytes.byteLength,
    excerpt,
    matchCountInWindow: 1,
    excerptEndByte: excerptStartAbsolute + (end - start),
    readCursor: encodeToolResultCursor({
      outputId: input.outputId,
      revision: input.revision,
      mode: "read",
      position: input.absolute,
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