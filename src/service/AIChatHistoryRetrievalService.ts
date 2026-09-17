import type { AIChatArchiveModule } from "@/modules/AIChatArchiveModule";
import { AI_CHAT_RECOVERABLE_DEFAULTS } from "@/service/AIChatRecoverableDefaults";
import {
  codePointLength,
  sliceByCodePoints,
} from "@/service/AIChatArchiveTextUtil";
import {
  encodeCursor,
  encodeSourceId,
  decodeSourceId,
} from "@/service/AIChatArchiveCursorCodec";
import {
  RecoverableHistoryError,
  type HistoryExcerpt,
  type OpaqueSourceIdPayload,
  type RecoverableHistoryErrorCode,
  type RefreshedSelection,
} from "@/entityTypes/aiChatArchiveTypes";
import {
  conversationHistorySearchInputSchema,
  conversationHistoryReadInputSchema,
} from "@/schemas/aiChatHistoryTools";
import type { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";

/**
 * Retrieval service (technical-design §7.4): result formatting, retrieval
 * budget, source links, deduplication, error mapping.
 *
 * Budget rules (§7.4): 8,000 cumulative serialized tokens and 4 calls per
 * assistant turn; search and read both count; overlapping retrieved source
 * intervals are merged. The active conversation comes from trusted context —
 * never a model argument.
 *
 * A per-turn budget is keyed by (conversationId, turnId). The query loop owns
 * final request preflight; this service refuses/shrinks before execution when
 * even the minimum envelope cannot fit.
 */

/** Request-scoped retrieval accounting state (§7.4 RetrievalBudgetState). */
export interface RetrievalBudgetState {
  readonly consumedTokens: number;
  readonly callCount: number;
  /** Merged [start, end) code-point intervals per source row (dedup). */
  readonly mergedIntervals: ReadonlyMap<
    number,
    ReadonlyArray<readonly [number, number]>
  >;
}

interface MutableBudget {
  consumedTokens: number;
  callCount: number;
  intervals: Map<number, Array<[number, number]>>;
}

export interface SearchResult {
  readonly records: HistoryExcerpt[];
  readonly nextCursor: string | null;
  readonly scanComplete: boolean;
  readonly indexComplete: boolean;
  readonly errorCode?: RecoverableHistoryErrorCode;
}

export interface ReadResult {
  readonly records: HistoryExcerpt[];
  readonly nextCursor: string | null;
  readonly truncated: boolean;
  readonly sourceRevision: number;
  readonly storedContentIncomplete: boolean;
  readonly errorCode?: RecoverableHistoryErrorCode;
}

export interface ResolveResult {
  readonly resolved: HistoryExcerpt[];
  readonly rejected: string[];
  readonly errorCode?: RecoverableHistoryErrorCode;
  /**
   * Submitted reference ids accepted for this turn, in submission order. The
   * archive re-encodes each `resolved[i].sourceId`, so callers that reconcile
   * acceptance back to UI state (§13.3) need this list — `resolved` alone
   * does not map back to what the renderer sent.
   */
  readonly acceptedSubmittedIds?: readonly string[];
  /**
   * Stale submitted references whose source revision moved, each paired with
   * a refreshed excerpt at the current revision (§4.2, AC-18). Refreshed
   * passages are NEVER quoted into the turn — they are offered for explicit
   * user confirmation, and their submitted ids are reported as rejected so
   * drafts survive.
   */
  readonly refreshed?: readonly RefreshedSelection[];
}

/**
 * A resolved excerpt paired with the submitted reference that produced it.
 * The archive layer re-encodes each excerpt's `sourceId` from the interval it
 * actually read, so callers need the ORIGINAL submitted id to reconcile
 * acceptance back to the chips the user drafted (§13.3).
 */
interface SubmittedExcerpt {
  readonly submittedId: string;
  readonly excerpt: HistoryExcerpt;
}

/** Decode outcome for an opaque source ID against a trusted epoch. */
interface DecodedSource {
  readonly payload: OpaqueSourceIdPayload;
}

/**
 * Per-tool-call backend-page walk bounds (design §7.1.5): one search call
 * may consume several 100 ms backend pages so a hit past the first fragment
 * page is returned in ONE call; anything further out is exposed as a cursor.
 */
const SEARCH_CALL_MAX_BACKEND_PAGES = 3;
const SEARCH_CALL_TIME_BUDGET_MS = 400;

export class AIChatHistoryRetrievalService {
  constructor(private readonly archive: AIChatArchiveModule) {}

  private readonly turnBudgets = new Map<string, MutableBudget>();

  /** Estimate serialized tokens for a string (chars/4 heuristic — §7.4). */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private budgetFor(conversationId: string, turnId: string): MutableBudget {
    const key = `${conversationId}:${turnId}`;
    let b = this.turnBudgets.get(key);
    if (!b) {
      b = { consumedTokens: 0, callCount: 0, intervals: new Map() };
      this.turnBudgets.set(key, b);
    }
    return b;
  }

  /** Read-only view of a turn's budget (for tests + query-loop preflight). */
  getBudgetState(conversationId: string, turnId: string): RetrievalBudgetState {
    const b = this.budgetFor(conversationId, turnId);
    return {
      consumedTokens: b.consumedTokens,
      callCount: b.callCount,
      mergedIntervals: b.intervals,
    };
  }

  /**
   * True when [start, end) is fully contained in the turn's merged intervals.
   * Non-mutating counterpart to mergeInterval: used to skip already-returned
   * passages without charging them against the resume offset.
   */
  private isCovered(
    b: MutableBudget,
    rowId: number,
    start: number,
    end: number
  ): boolean {
    const list = b.intervals.get(rowId);
    if (!list || list.length === 0) return false;
    let pos = start;
    for (const [cs, ce] of list) {
      if (ce <= pos) continue;
      if (cs > pos) return false;
      pos = ce;
      if (pos >= end) return true;
    }
    return pos >= end;
  }

  /** Merge a retrieved interval into the dedup set; returns new code-points added. */
  private mergeInterval(
    b: MutableBudget,
    rowId: number,
    start: number,
    end: number
  ): number {
    const list = b.intervals.get(rowId) ?? [];
    let s = start;
    let e = end;
    const kept: Array<[number, number]> = [];
    for (const [cs, ce] of list) {
      if (ce < s || cs > e) {
        kept.push([cs, ce]); // disjoint
        continue;
      }
      // Overlap ⇒ extend the merged interval.
      s = Math.min(s, cs);
      e = Math.max(e, ce);
    }
    kept.push([s, e]);
    kept.sort((a, c) => a[0] - c[0]);
    b.intervals.set(rowId, kept);
    const coveredBefore = list.reduce((acc, [cs, ce]) => acc + (ce - cs), 0);
    const coveredAfter = kept.reduce((acc, [cs, ce]) => acc + (ce - cs), 0);
    return coveredAfter - coveredBefore;
  }

  /**
   * conversation_history_search (§7.1). Query is literal user text (never raw
   * FTS/SQL); the conversation comes from trusted context. No-match is final
   * only when scanComplete is true.
   *
   * Budget-first (§7.4, FR-04): per-call (2,000 tokens) and cumulative-turn
   * (8,000 tokens) allowances are allocated BEFORE returning records. Stops
   * with truncation + continuation when the budget is exhausted instead of
   * appending over-budget records. Overlap intervals are merged and fully
   * duplicated passages are skipped, so repeated reads do not duplicate
   * evidence.
   */
  async search(input: {
    conversationId: string;
    query: string;
    cursor?: string;
    limit?: number;
    turnId?: string;
  }): Promise<SearchResult> {
    const parsed = conversationHistorySearchInputSchema.safeParse({
      query: input.query,
      cursor: input.cursor,
      limit: input.limit,
    });
    if (!parsed.success) {
      return {
        records: [],
        nextCursor: null,
        scanComplete: true,
        indexComplete: false,
        errorCode: "HISTORY_SCOPE_INVALID",
      };
    }
    const turnId = input.turnId ?? "default";
    const b = this.budgetFor(input.conversationId, turnId);
    if (b.callCount >= AI_CHAT_RECOVERABLE_DEFAULTS.retrievalMaxCallsPerTurn) {
      return {
        records: [],
        nextCursor: null,
        scanComplete: true,
        indexComplete: false,
        errorCode: "MODEL_BUDGET_UNAVAILABLE",
      };
    }
    // Pre-allocate: refuse before execution when even the minimum envelope
    // cannot fit the remaining cumulative budget (§7.4).
    if (
      b.consumedTokens >=
      AI_CHAT_RECOVERABLE_DEFAULTS.retrievalMaxCumulativeTokensPerTurn
    ) {
      return {
        records: [],
        nextCursor: input.cursor ?? null,
        scanComplete: false,
        indexComplete: false,
        errorCode: "MODEL_BUDGET_UNAVAILABLE",
      };
    }
    b.callCount += 1;

    try {
      // Unwrap an intra-page resume cursor into its backend cursor + record
      // offset. Unknown formats pass through for archive-side validation
      // (which fails closed on forged/foreign cursors).
      const first = splitSearchCursor(parsed.data.cursor);
      const limit = parsed.data.limit;
      // Per-call response allowance for search (PRD FR-02: 2,000 tokens
      // default, reduced when the active context has less room).
      const perCallCap = 2_000;
      let callTokens = 0;
      let truncatedByBudget = false;
      const records: HistoryExcerpt[] = [];
      // Backend-page walk (design §7.1.5): one tool call may consume several
      // backend pages within its time/output budget, otherwise it exposes a
      // cursor. A hit past the first 100 ms fragment page is therefore
      // returned in ONE call instead of stranding the caller on an empty
      // first page. Bounded by page count + wall clock + token caps.
      const callStartMs = Date.now();
      let backendCursor = first.backendCursor;
      let skip = first.skip;
      let backendComplete = false;
      let indexComplete = false;
      let nextCursor: string | null = null;
      // Last unconsumed native backend position: the fallback continuation
      // when the page cap stops us exactly on a page boundary.
      let pendingBackend: string | null = first.backendCursor ?? null;
      let settled = false;
      for (
        let backendPages = 0;
        backendPages < SEARCH_CALL_MAX_BACKEND_PAGES;
        backendPages++
      ) {
        const page = await this.archive.searchPage({
          conversationId: input.conversationId,
          query: parsed.data.query,
          cursor: backendCursor,
        });
        indexComplete = page.indexComplete;
        // Resume index: first unexamined record of this backend page. Only
        // accepted records advance it past withheld ones — dedup-skipped
        // passages are re-examined (cheap, still skipped same-turn) so a
        // later turn with a fresh budget can still return them.
        let resumeIndex = Math.max(0, Math.min(skip, page.records.length));
        skip = 0;
        for (let i = resumeIndex; i < page.records.length; i++) {
          const rec = page.records[i];
          // Caller's limit reached: the tail stays unexamined and resumable
          // via the intra-page cursor below (never silently dropped).
          if (records.length >= limit) break;
          // Actual deduplication: skip passages whose intervals are already
          // fully covered by this turn's merged set (§7.4, FR-04). Checked
          // without mutating, so a withheld record is never pre-merged into
          // the dedup set before it is actually returned.
          const decoded = this.tryDecodeRecord(rec.sourceId, rec.text);
          if (
            decoded &&
            this.isCovered(
              b,
              decoded.payload.rowId,
              decoded.payload.startCodePoint,
              decoded.payload.endCodePoint
            )
          ) {
            continue;
          }
          const tokens = this.estimateTokens(rec.text);
          if (
            callTokens + tokens > perCallCap ||
            b.consumedTokens + tokens >
              AI_CHAT_RECOVERABLE_DEFAULTS.retrievalMaxCumulativeTokensPerTurn
          ) {
            truncatedByBudget = true;
            break;
          }
          if (decoded) {
            this.mergeInterval(
              b,
              decoded.payload.rowId,
              decoded.payload.startCodePoint,
              decoded.payload.endCodePoint
            );
          }
          callTokens += tokens;
          b.consumedTokens += tokens;
          records.push(rec);
          resumeIndex = i + 1;
        }
        // Intra-page remainder (unexamined records, whether withheld by
        // budget or over the caller's limit) resumes within THIS page — never
        // by echoing the input cursor (which would replay the page forever)
        // and never by jumping to the backend's next page (which would drop
        // the tail). The backend cursor is preserved inside the wrapper, so
        // its query/revision binding still applies on resume.
        if (resumeIndex < page.records.length) {
          nextCursor = encodeSearchResumeCursor(backendCursor, resumeIndex);
          settled = true;
          break;
        }
        if (!page.nextCursor) {
          backendComplete = page.scanComplete;
          nextCursor = null;
          settled = true;
          break;
        }
        if (Date.now() - callStartMs >= SEARCH_CALL_TIME_BUDGET_MS) {
          // Out of call time with backend pages remaining: expose the native
          // backend cursor (skip 0 — this page was fully consumed).
          nextCursor = page.nextCursor;
          settled = true;
          break;
        }
        backendCursor = page.nextCursor;
        pendingBackend = page.nextCursor;
      }
      if (!settled) {
        // Stopped on the backend-page cap exactly on a page boundary with
        // scan remaining: continue from the last unconsumed backend position
        // so no window of the archive is ever skipped.
        nextCursor = pendingBackend;
      }
      const scanComplete = backendComplete && !truncatedByBudget;
      const overBudget =
        b.consumedTokens >=
        AI_CHAT_RECOVERABLE_DEFAULTS.retrievalMaxCumulativeTokensPerTurn;
      return {
        records,
        // Invariant: an empty page with a cursor is NEVER "no match" (FR-02).
        nextCursor,
        scanComplete,
        indexComplete,
        errorCode:
          records.length === 0 && scanComplete && !truncatedByBudget
            ? "HISTORY_NO_MATCH"
            : truncatedByBudget || overBudget
              ? "MODEL_BUDGET_UNAVAILABLE"
              : undefined,
      };
    } catch (error) {
      return mapArchiveError(error, {
        records: [],
        nextCursor: null,
        scanComplete: true,
        indexComplete: false,
      });
    }
  }

  /**
   * conversation_history_read (§7.2). Accepts exactly one of source_id/
   * message_id or from_source_id+to_source_id; neighbors 0–2; bounded output
   * with continuation cursors for large messages/ranges.
   */
  async read(input: {
    conversationId: string;
    args: Record<string, unknown>;
    turnId?: string;
  }): Promise<ReadResult> {
    const parsed = conversationHistoryReadInputSchema.safeParse(input.args);
    if (!parsed.success) {
      return {
        records: [],
        nextCursor: null,
        truncated: false,
        sourceRevision: 0,
        storedContentIncomplete: false,
        errorCode: "HISTORY_SCOPE_INVALID",
      };
    }
    const turnId = input.turnId ?? "default";
    const b = this.budgetFor(input.conversationId, turnId);
    if (b.callCount >= AI_CHAT_RECOVERABLE_DEFAULTS.retrievalMaxCallsPerTurn) {
      return {
        records: [],
        nextCursor: null,
        truncated: false,
        sourceRevision: 0,
        storedContentIncomplete: false,
        errorCode: "MODEL_BUDGET_UNAVAILABLE",
      };
    }
    b.callCount += 1;

    try {
      const meta = await this.archive.getArchiveMeta(input.conversationId);
      if (!meta) {
        return {
          records: [],
          nextCursor: null,
          truncated: false,
          sourceRevision: 0,
          storedContentIncomplete: false,
          errorCode: "SOURCE_UNAVAILABLE",
        };
      }

      // --- Single-point by source_id.
      if (parsed.data.source_id) {
        return await this.readBySourceId(
          input.conversationId,
          parsed.data.source_id,
          parsed.data.neighbors,
          meta,
          b,
          parsed.data.cursor
        );
      }

      // --- Single-point by message_id (ambiguous ⇒ candidate refs, §7.2).
      if (parsed.data.message_id) {
        return await this.readByMessageId(
          input.conversationId,
          parsed.data.message_id,
          parsed.data.neighbors,
          meta,
          b,
          parsed.data.cursor
        );
      }

      // --- Range mode: from_source_id + to_source_id.
      const fromId = parsed.data.from_source_id;
      const toId = parsed.data.to_source_id;
      if (fromId && toId) {
        return await this.readRange(
          input.conversationId,
          fromId,
          toId,
          meta,
          b,
          parsed.data.cursor
        );
      }
      // The schema refine guarantees one mode; reaching here is a logic error.
      return rejectRead(meta, "HISTORY_SCOPE_INVALID");
    } catch (error) {
      return mapArchiveError(error, {
        records: [],
        nextCursor: null,
        truncated: false,
        sourceRevision: 0,
        storedContentIncomplete: false,
      });
    }
  }

  /** §7.2 single-point read by opaque source ID, with offset continuation. */
  private async readBySourceId(
    conversationId: string,
    sourceId: string,
    neighbors: number | undefined,
    meta: { epoch: string; revision: number; indexState: string },
    b: MutableBudget,
    cursor?: string
  ): Promise<ReadResult> {
    const payload = decodeSourceId(sourceId, meta.epoch);
    if (!payload) {
      return rejectRead(meta, "HISTORY_SCOPE_INVALID");
    }
    const one = await this.archive.resolveOne(conversationId, sourceId);
    if (!one || !one.message) {
      return rejectRead(meta, "SOURCE_UNAVAILABLE");
    }
    const fullText = one.message.content ?? "";
    const totalCp = codePointLength(fullText);
    // Resume offset from the read continuation cursor (same row only).
    let startOffset = payload.startCodePoint;
    if (cursor) {
      const resumed = decodeReadCursor(cursor, payload.rowId);
      if (resumed === null) {
        return rejectRead(meta, "HISTORY_SCOPE_INVALID");
      }
      startOffset = resumed;
    }
    if (startOffset < payload.startCodePoint) {
      startOffset = payload.startCodePoint;
    }
    const requestedEnd =
      payload.endCodePoint > 0 ? payload.endCodePoint : totalCp;
    const endBound = Math.min(requestedEnd, totalCp);
    if (startOffset >= endBound) {
      return rejectRead(meta, "SOURCE_UNAVAILABLE");
    }
    // Allocate the serialized output within per-call and cumulative-turn
    // limits BEFORE returning (§7.4, FR-04). Oversized reads recover every
    // fragment across bounded calls via the continuation cursor.
    const remainingCumulative =
      AI_CHAT_RECOVERABLE_DEFAULTS.retrievalMaxCumulativeTokensPerTurn -
      b.consumedTokens;
    const perCallAllowance = Math.min(
      AI_CHAT_RECOVERABLE_DEFAULTS.retrievalDefaultOutputTokens,
      AI_CHAT_RECOVERABLE_DEFAULTS.retrievalMaxOutputTokens
    );
    const allowance = Math.min(perCallAllowance, remainingCumulative);
    if (allowance <= 0) {
      return {
        records: [],
        nextCursor: encodeReadCursor(payload.rowId, startOffset),
        truncated: true,
        sourceRevision: meta.revision,
        storedContentIncomplete: false,
        errorCode: "MODEL_BUDGET_UNAVAILABLE",
      };
    }
    // ~4 chars per token → char budget for this page.
    const charBudget = allowance * 4;
    const sliceEnd = startOffset + charBudget;
    const pageEnd = Math.min(sliceEnd, endBound);
    // Never split in the middle of a surrogate pair: sliceByCodePoints works
    // in code points, and pageEnd is a code-point count.
    const text = sliceByCodePoints(fullText, startOffset, pageEnd);
    const hasMore = pageEnd < endBound;
    const rec = toExcerptWithSpan(
      one.message,
      meta,
      text,
      startOffset,
      pageEnd,
      true
    );
    this.mergeInterval(b, payload.rowId, startOffset, pageEnd);
    b.consumedTokens += this.estimateTokens(text);

    // Neighbor expansion (§7.2 neighbors 0–2): first page only, bounded rows
    // around the anchor.
    const neighborCount = neighbors ?? 0;
    const neighborRecs =
      neighborCount > 0 && !cursor
        ? await this.readNeighbors(
            conversationId,
            one.message,
            meta,
            neighborCount,
            b
          )
        : [];

    return {
      records: [rec, ...neighborRecs],
      nextCursor: hasMore ? encodeReadCursor(payload.rowId, pageEnd) : null,
      truncated: hasMore,
      sourceRevision: meta.revision,
      storedContentIncomplete: false,
      errorCode:
        hasMore && one.refreshed
          ? "SOURCE_CHANGED"
          : hasMore
            ? "HISTORY_PARTIAL_SCAN"
            : one.refreshed
              ? "SOURCE_CHANGED"
              : undefined,
    };
  }

  /** §7.2 single-point read by public messageId (ambiguous ⇒ candidates). */
  private async readByMessageId(
    conversationId: string,
    messageId: string,
    _neighbors: number | undefined,
    meta: { epoch: string; revision: number; indexState: string },
    b: MutableBudget,
    cursor?: string
  ): Promise<ReadResult> {
    void _neighbors; // messageId reads do not expand neighbors (§7.2).
    if (cursor) {
      // Continuation cursors are row-scoped; a message_id cursor is invalid.
      return rejectRead(meta, "HISTORY_SCOPE_INVALID");
    }
    const candidates = await this.archive.findByMessageId(
      conversationId,
      messageId
    );
    if (candidates.length === 0) {
      return rejectRead(meta, "SOURCE_UNAVAILABLE");
    }
    if (candidates.length === 1) {
      // Unambiguous: bounded single read with continuation (same as source_id).
      const only = candidates[0];
      const text = only.content ?? "";
      const totalCp = codePointLength(text);
      const remainingCumulative =
        AI_CHAT_RECOVERABLE_DEFAULTS.retrievalMaxCumulativeTokensPerTurn -
        b.consumedTokens;
      const perCallAllowance = Math.min(
        AI_CHAT_RECOVERABLE_DEFAULTS.retrievalDefaultOutputTokens,
        AI_CHAT_RECOVERABLE_DEFAULTS.retrievalMaxOutputTokens
      );
      const allowance = Math.min(perCallAllowance, remainingCumulative);
      if (allowance <= 0) {
        return {
          records: [],
          nextCursor: encodeReadCursor(only.id, 0),
          truncated: true,
          sourceRevision: meta.revision,
          storedContentIncomplete: false,
          errorCode: "MODEL_BUDGET_UNAVAILABLE",
        };
      }
      const pageEnd = Math.min(totalCp, allowance * 4);
      const pageText = sliceByCodePoints(text, 0, pageEnd);
      const hasMore = pageEnd < totalCp;
      const records = [
        toExcerptWithSpan(only, meta, pageText, 0, pageEnd, true),
      ];
      this.mergeInterval(b, only.id, 0, pageEnd);
      b.consumedTokens += this.estimateTokens(pageText);
      return {
        records,
        nextCursor: hasMore ? encodeReadCursor(only.id, pageEnd) : null,
        truncated: hasMore,
        sourceRevision: meta.revision,
        storedContentIncomplete: false,
        errorCode: hasMore ? "HISTORY_PARTIAL_SCAN" : undefined,
      };
    }
    // §7.2: an ambiguous messageId returns ALL candidate source references
    // rather than selecting an arbitrary row; the model re-reads by source_id.
    // Bounded previews only (500 chars each) so ambiguity can never blow the
    // response budget; full text comes from the follow-up source_id read.
    const records = candidates.slice(0, 20).map((m) => {
      const text = m.content ?? "";
      const preview = sliceByCodePoints(text, 0, 500);
      return toExcerptWithSpan(
        m,
        meta,
        preview,
        0,
        codePointLength(preview),
        true
      );
    });
    for (const r of records) {
      const decoded = this.tryDecodeRecord(r.sourceId, r.text);
      if (decoded) {
        this.mergeInterval(
          b,
          decoded.payload.rowId,
          decoded.payload.startCodePoint,
          decoded.payload.endCodePoint
        );
        b.consumedTokens += this.estimateTokens(r.text);
      }
    }
    return {
      records,
      nextCursor: null,
      truncated: false,
      sourceRevision: meta.revision,
      storedContentIncomplete: false,
      // Multiple candidates is itself a form of SOURCE_CHANGED (identity not
      // unique); a single exact row resolves cleanly.
      errorCode: "SOURCE_CHANGED",
    };
  }

  /**
   * §7.2 range read between two opaque source IDs with stable offset
   * continuation. Starts AT the requested range (not at the conversation
   * head): resolves the `from` row for its timestamp, synthesizes a page
   * cursor just before it, pages forward, and stops at `to`. Later ranges
   * stay reachable via the returned continuation.
   */
  private async readRange(
    conversationId: string,
    fromSourceId: string,
    toSourceId: string,
    meta: { epoch: string; revision: number; indexState: string },
    b: MutableBudget,
    cursor?: string
  ): Promise<ReadResult> {
    const from = decodeSourceId(fromSourceId, meta.epoch);
    const to = decodeSourceId(toSourceId, meta.epoch);
    if (!from || !to) {
      return rejectRead(meta, "HISTORY_SCOPE_INVALID");
    }
    // Validate range direction: from must be at or before to.
    if (from.rowId > to.rowId) {
      return rejectRead(meta, "HISTORY_SCOPE_INVALID");
    }
    // Resume position from the range continuation cursor when supplied.
    let resumeRowId = from.rowId;
    if (cursor) {
      const resumedRange = decodeRangeCursor(cursor, from.rowId, to.rowId);
      if (resumedRange === null) {
        return rejectRead(meta, "HISTORY_SCOPE_INVALID");
      }
      resumeRowId = resumedRange;
    }
    // Resolve the resume row for its timestamp to anchor the page cursor.
    const anchor = await this.archive.resolveOne(
      conversationId,
      resumeRowId === from.rowId
        ? fromSourceId
        : encodeSourceId({
            v: 1,
            epoch: meta.epoch,
            revision: meta.revision,
            rowId: resumeRowId,
            field: "content",
            startCodePoint: 0,
            endCodePoint: 0,
          })
    );
    if (!anchor || !anchor.message) {
      return rejectRead(meta, "SOURCE_UNAVAILABLE");
    }
    const anchorTs = anchor.message.timestamp.getTime();
    // Page cursor just BEFORE the resume row so the page includes it.
    const startCursor =
      resumeRowId > 1
        ? encodeCursor({
            v: 1,
            conversationId,
            epoch: meta.epoch,
            revision: meta.revision,
            lastTimestampMs: anchorTs,
            lastRowId: resumeRowId - 1,
            direction: "forward",
          })
        : encodeCursor({
            v: 1,
            conversationId,
            epoch: meta.epoch,
            revision: meta.revision,
            lastTimestampMs: Math.max(0, anchorTs - 1),
            lastRowId: Number.MAX_SAFE_INTEGER,
            direction: "forward",
          });
    const page = await this.archive.readPage({
      conversationId,
      cursor: startCursor,
      maxRows: AI_CHAT_RECOVERABLE_DEFAULTS.metadataPageRows,
      maxCodePoints: AI_CHAT_RECOVERABLE_DEFAULTS.retrievalMaxOutputTokens,
    });
    const perCallAllowance = Math.min(
      AI_CHAT_RECOVERABLE_DEFAULTS.retrievalDefaultOutputTokens,
      AI_CHAT_RECOVERABLE_DEFAULTS.retrievalMaxOutputTokens
    );
    let callTokens = 0;
    const inRange: HistoryExcerpt[] = [];
    let lastIncludedRowId = resumeRowId - 1;
    let rangeExhausted = false;
    for (const r of page.records) {
      const decoded = this.tryDecodeRecord(r.sourceId, r.text);
      if (!decoded) continue;
      const rowId = decoded.payload.rowId;
      if (rowId < resumeRowId) continue;
      if (rowId > to.rowId) {
        rangeExhausted = true;
        break;
      }
      // Deduplicate repeated/overlapping evidence before charging budget.
      const added = this.mergeInterval(
        b,
        rowId,
        decoded.payload.startCodePoint,
        decoded.payload.endCodePoint
      );
      if (added <= 0) {
        lastIncludedRowId = rowId;
        continue;
      }
      const tokens = this.estimateTokens(r.text);
      if (
        callTokens + tokens > perCallAllowance ||
        b.consumedTokens + tokens >
          AI_CHAT_RECOVERABLE_DEFAULTS.retrievalMaxCumulativeTokensPerTurn
      ) {
        break;
      }
      callTokens += tokens;
      b.consumedTokens += tokens;
      inRange.push(r);
      lastIncludedRowId = rowId;
    }
    const reachedEnd = rangeExhausted || lastIncludedRowId >= to.rowId;
    const backendHasMore = page.nextCursor !== null;
    const hasMore = !reachedEnd && (backendHasMore || lastIncludedRowId < to.rowId);
    return {
      records: inRange,
      nextCursor: hasMore
        ? encodeRangeCursor(from.rowId, to.rowId, lastIncludedRowId + 1)
        : null,
      truncated: hasMore,
      sourceRevision: page.sourceRevision,
      storedContentIncomplete: false,
      errorCode: hasMore ? "HISTORY_PARTIAL_SCAN" : undefined,
    };
  }

  /** Bounded neighbor expansion around an anchor (§7.2 neighbors 0–2). */
  private async readNeighbors(
    conversationId: string,
    anchor: AIChatMessageEntity,
    meta: { epoch: string; revision: number; indexState: string },
    neighbors: number,
    b: MutableBudget
  ): Promise<HistoryExcerpt[]> {
    const count = Math.min(Math.max(neighbors, 0), 2);
    if (count === 0) return [];
    const rows = await this.archive.readNeighbors(
      conversationId,
      anchor.timestamp.getTime(),
      anchor.id,
      count,
      count
    );
    const out: HistoryExcerpt[] = [];
    for (const m of rows) {
      out.push(toExcerpt(m, meta, m.content ?? "", true));
      this.mergeInterval(b, m.id, 0, codePointLength(m.content ?? ""));
      b.consumedTokens += this.estimateTokens(m.content ?? "");
    }
    return out;
  }

  /**
   * Re-resolve user-selected source references on submit (§13.3, FR-10).
   *
   * Rejects (never silently narrows) selections that do not fit: an excerpt
   * over the per-excerpt cap or a batch over the total cap is rejected with
   * an actionable code so the user narrows the selection before sending. The
   * model receives precisely the accepted passage once. Changed sources
   * require re-confirmation — refreshed intervals are rejected, not silently
   * substituted. Draft selections survive rejection for retry.
   */
  async resolveSelections(
    conversationId: string,
    sourceIds: readonly string[],
    turnId?: string
  ): Promise<ResolveResult> {
    const rejected = new Set<string>();
    let oversized = false;
    try {
      const result = await this.archive.resolveSelections(
        conversationId,
        sourceIds
      );
      if (result.errorCode === "HISTORY_SCOPE_INVALID") {
        return {
          resolved: [],
          rejected: [...sourceIds],
          errorCode: "HISTORY_SCOPE_INVALID",
        };
      }
      // Changed-source refreshes are rejections, not substitutions: the
      // refreshed excerpts never enter the budget or the model block. Their
      // submitted ids stay rejected (drafts survive) while the refreshed
      // references travel alongside for explicit user confirmation (§4.2).
      const refreshed = (result.refreshed ?? []).filter((r) =>
        sourceIds.includes(r.submittedId)
      );
      for (const r of refreshed) rejected.add(r.submittedId);
      const paired = this.pairWithSubmittedIds(sourceIds, result);
      const resolved: HistoryExcerpt[] = [];
      const turnBudgetTurnId = turnId ?? "default";
      const b = this.budgetFor(conversationId, turnBudgetTurnId);
      let acceptedTokens = 0;
      for (const { submittedId, excerpt } of paired) {
        const tokens = this.estimateTokens(excerpt.text);
        // Per-excerpt cap: reject oversized passages so the user narrows the
        // selection (PRD FR-10 — do not silently omit or prefix-cut selected
        // content).
        if (
          tokens > AI_CHAT_RECOVERABLE_DEFAULTS.selectionMaxExcerptTokens
        ) {
          rejected.add(submittedId);
          oversized = true;
          continue;
        }
        if (
          acceptedTokens + tokens >
          AI_CHAT_RECOVERABLE_DEFAULTS.selectionMaxTotalTokens
        ) {
          rejected.add(submittedId);
          oversized = true;
          continue;
        }
        const decoded = this.tryDecodeRecord(excerpt.sourceId, excerpt.text);
        if (decoded) {
          this.mergeInterval(
            b,
            decoded.payload.rowId,
            decoded.payload.startCodePoint,
            decoded.payload.endCodePoint
          );
        }
        acceptedTokens += tokens;
        resolved.push(excerpt);
      }
      // Changed-source refreshes are rejections, not silent substitutions:
      // surface them alongside size rejections so the user confirms the
      // changed source before the model sees it.
      const changed =
        result.errorCode === "SOURCE_CHANGED" || refreshed.length > 0;
      return {
        resolved,
        acceptedSubmittedIds: paired
          .filter(({ submittedId }) => !rejected.has(submittedId))
          .map(({ submittedId }) => submittedId),
        rejected: this.orderSelectionIds(sourceIds, rejected, result.rejected),
        refreshed,
        errorCode: this.selectionErrorCode(resolved, rejected, {
          oversized,
          changed,
        }),
      };
    } catch (error) {
      return mapArchiveError(error, {
        resolved: [],
        rejected: [...sourceIds],
      });
    }
  }

  /**
   * Re-attach the submitted reference to each resolved excerpt. The archive
   * layer re-encodes `sourceId` from the interval it read, so the returned
   * ids do NOT match what the renderer submitted — and budget rejection has to
   * be reported against the SUBMITTED ids or the renderer cannot tell which
   * chips were dropped (§13.3).
   */
  private pairWithSubmittedIds(
    sourceIds: readonly string[],
    result: { resolved: HistoryExcerpt[]; rejected: string[] }
  ): SubmittedExcerpt[] {
    const rejectedSet = new Set(result.rejected);
    const submitted: string[] = [];
    for (const id of sourceIds) {
      if (!rejectedSet.has(id)) submitted.push(id);
    }
    return result.resolved.map((excerpt, index) => ({
      submittedId: submitted[index] ?? excerpt.sourceId,
      excerpt,
    }));
  }

  /** Keep the caller's submission order while reporting every rejected id once. */
  private orderSelectionIds(
    sourceIds: readonly string[],
    rejected: Set<string>,
    archiveRejected: readonly string[]
  ): string[] {
    for (const id of archiveRejected) rejected.add(id);
    return sourceIds.filter((id) => rejected.has(id));
  }

  /**
   * Map the resolution outcome to a recoverable-history error code.
   * Oversized rejections are actionable capacity errors (user narrows the
   * selection); changed-source rejections require re-confirmation. An empty
   * result is `HISTORY_SCOPE_INVALID` so a tombstoned/unknown scope reads
   * consistently with the archive layer.
   */
  private selectionErrorCode(
    resolved: readonly HistoryExcerpt[],
    rejected: Set<string>,
    flags?: { oversized?: boolean; changed?: boolean }
  ): RecoverableHistoryErrorCode | undefined {
    if (resolved.length === 0) {
      if (flags?.oversized) return "CONTEXT_REQUIRED_CONTENT_TOO_LARGE";
      if (flags?.changed) return "SOURCE_CHANGED";
      return "HISTORY_SCOPE_INVALID";
    }
    if (flags?.oversized) return "CONTEXT_REQUIRED_CONTENT_TOO_LARGE";
    if (rejected.size > 0 || flags?.changed) {
      return "SOURCE_CHANGED";
    }
    return undefined;
  }

  /** Decode a record's source ID against the trusted epoch (best-effort). */
  private tryDecodeRecord(
    sourceId: string,
    text: string
  ): DecodedSource | null {
    void text;
    // The Module already encoded the sourceId with the current epoch; decode
    // without a second epoch check (the payload's epoch is authoritative for
    // dedup row/offset extraction).
    const payload = decodeSourceIdRaw(sourceId);
    return payload ? { payload } : null;
  }
}

/** Build a rejected ReadResult with the current source revision. */
function rejectRead(
  meta: { epoch: string; revision: number; indexState: string },
  errorCode: RecoverableHistoryErrorCode
): ReadResult {
  return {
    records: [],
    nextCursor: null,
    truncated: false,
    sourceRevision: meta.revision,
    storedContentIncomplete: false,
    errorCode,
  };
}

/** Map a message row to a HistoryExcerpt (whole-content span). */
function toExcerpt(
  msg: AIChatMessageEntity,
  meta: { epoch: string; revision: number },
  text: string,
  exact: boolean
): HistoryExcerpt {
  const cpLen = codePointLength(text);
  return toExcerptWithSpan(msg, meta, text, 0, cpLen, exact);
}

/** Map a verified slice to an excerpt carrying its exact [start, end) span. */
function toExcerptWithSpan(
  msg: AIChatMessageEntity,
  meta: { epoch: string; revision: number },
  text: string,
  startCodePoint: number,
  endCodePoint: number,
  exact: boolean
): HistoryExcerpt {
  return {
    sourceId: encodeSourceId({
      v: 1,
      epoch: meta.epoch,
      revision: meta.revision,
      rowId: msg.id,
      field: "content",
      startCodePoint,
      endCodePoint,
    }),
    messageId: msg.messageId,
    role: msg.role,
    timestamp: msg.timestamp.toISOString(),
    text,
    exact,
    redacted: false,
    hasMore: false,
  };
}

/**
 * Intra-page search resume cursor: pairs the backend scan cursor (which
 * reproduces the current page, preserving its query/revision binding) with a
 * record offset into that page. Lets a budget-truncated or limit-truncated
 * call resume WITHIN the page instead of replaying it forever or dropping
 * its tail. A forged skip only skips records of an already-authorized page —
 * it cannot widen conversation scope; a forged backend cursor still fails
 * closed in archive validation.
 */
function encodeSearchResumeCursor(
  backendCursor: string | undefined,
  skip: number
): string {
  return Buffer.from(
    JSON.stringify({ v: 1, kind: "search-resume", backend: backendCursor ?? null, skip }),
    "utf8"
  ).toString("base64url");
}

/**
 * Split an incoming search cursor into its backend cursor + page offset.
 * Unknown formats (plain backend cursors, garbage) pass through with skip 0
 * so the archive layer validates them as before.
 */
function splitSearchCursor(raw: string | undefined): {
  backendCursor?: string;
  skip: number;
} {
  if (!raw) return { backendCursor: undefined, skip: 0 };
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8")
    ) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return { backendCursor: raw, skip: 0 };
    }
    const p = parsed as Record<string, unknown>;
    if (p.v !== 1 || p.kind !== "search-resume") {
      return { backendCursor: raw, skip: 0 };
    }
    if (typeof p.skip !== "number" || p.skip < 0 || !Number.isFinite(p.skip)) {
      return { backendCursor: raw, skip: 0 };
    }
    if (p.backend !== null && typeof p.backend !== "string") {
      return { backendCursor: raw, skip: 0 };
    }
    return {
      backendCursor: p.backend ?? undefined,
      skip: Math.floor(p.skip),
    };
  } catch {
    return { backendCursor: raw, skip: 0 };
  }
}

/** Single-read offset continuation cursor (row-scoped, opaque). */
function encodeReadCursor(rowId: number, offset: number): string {
  return Buffer.from(
    JSON.stringify({ v: 1, kind: "read", rowId, offset }),
    "utf8"
  ).toString("base64url");
}

/** Decode a single-read continuation; null on mismatch (fails closed). */
function decodeReadCursor(raw: string, expectedRowId: number): number | null {
  if (raw.length === 0 || raw.length > 1024) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8")
    ) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const p = parsed as Record<string, unknown>;
    if (p.v !== 1 || p.kind !== "read") return null;
    if (p.rowId !== expectedRowId) return null;
    if (typeof p.offset !== "number" || p.offset < 0) return null;
    return p.offset;
  } catch {
    return null;
  }
}

/** Range-read continuation cursor (bound to its from/to rows). */
function encodeRangeCursor(
  fromRowId: number,
  toRowId: number,
  resumeRowId: number
): string {
  return Buffer.from(
    JSON.stringify({ v: 1, kind: "range", fromRowId, toRowId, resumeRowId }),
    "utf8"
  ).toString("base64url");
}

/** Decode a range continuation; null on mismatch (fails closed). */
function decodeRangeCursor(
  raw: string,
  expectedFrom: number,
  expectedTo: number
): number | null {
  if (raw.length === 0 || raw.length > 1024) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8")
    ) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const p = parsed as Record<string, unknown>;
    if (p.v !== 1 || p.kind !== "range") return null;
    if (p.fromRowId !== expectedFrom || p.toRowId !== expectedTo) {
      return null;
    }
    if (
      typeof p.resumeRowId !== "number" ||
      p.resumeRowId < expectedFrom ||
      p.resumeRowId > expectedTo
    ) {
      return null;
    }
    return p.resumeRowId;
  } catch {
    return null;
  }
}

/** Decode an opaque source ID without an epoch check (for dedup accounting). */
function decodeSourceIdRaw(raw: string): OpaqueSourceIdPayload | null {
  if (raw.length === 0 || raw.length > 2048) return null;
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
  if (typeof parsed !== "object" || parsed === null) return null;
  const p = parsed as Record<string, unknown>;
  if (p.v !== 1) return null;
  if (typeof p.epoch !== "string") return null;
  if (typeof p.revision !== "number") return null;
  if (typeof p.rowId !== "number") return null;
  if (p.field !== "content" && p.field !== "tool_receipt") return null;
  if (typeof p.startCodePoint !== "number") return null;
  if (typeof p.endCodePoint !== "number") return null;
  if (p.endCodePoint < p.startCodePoint) return null;
  return {
    v: 1,
    epoch: p.epoch,
    revision: p.revision,
    rowId: p.rowId,
    field: p.field,
    startCodePoint: p.startCodePoint,
    endCodePoint: p.endCodePoint,
  };
}

/** Map an archive-layer error to the 12-code contract (§16). */
function mapArchiveError<T extends object>(
  error: unknown,
  fallback: T
): T & { errorCode: RecoverableHistoryErrorCode } {
  if (error instanceof RecoverableHistoryError) {
    return { ...fallback, errorCode: error.code };
  }
  return {
    ...fallback,
    errorCode: "SOURCE_UNAVAILABLE",
  };
}
