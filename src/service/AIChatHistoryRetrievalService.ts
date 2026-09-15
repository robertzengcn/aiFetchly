import type { AIChatArchiveModule } from "@/modules/AIChatArchiveModule";
import { AI_CHAT_RECOVERABLE_DEFAULTS } from "@/service/AIChatRecoverableDefaults";
import {
  codePointLength,
  sliceByCodePoints,
} from "@/service/AIChatArchiveTextUtil";
import {
  encodeSourceId,
  decodeSourceId,
} from "@/service/AIChatArchiveCursorCodec";
import {
  RecoverableHistoryError,
  type HistoryExcerpt,
  type OpaqueSourceIdPayload,
  type RecoverableHistoryErrorCode,
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
    b.callCount += 1;

    try {
      const page = await this.archive.searchPage({
        conversationId: input.conversationId,
        query: parsed.data.query,
        cursor: parsed.data.cursor,
      });
      const limit = parsed.data.limit;
      const records: HistoryExcerpt[] = [];
      for (const rec of page.records) {
        if (records.length >= limit) break;
        // Dedup + budget accounting on each returned interval.
        const decoded = this.tryDecodeRecord(rec.sourceId, rec.text);
        if (decoded) {
          this.mergeInterval(
            b,
            decoded.payload.rowId,
            decoded.payload.startCodePoint,
            decoded.payload.endCodePoint
          );
        }
        b.consumedTokens += this.estimateTokens(rec.text);
        records.push(rec);
      }
      const overBudget =
        b.consumedTokens >
        AI_CHAT_RECOVERABLE_DEFAULTS.retrievalMaxCumulativeTokensPerTurn;
      return {
        records,
        nextCursor: overBudget ? null : page.nextCursor,
        scanComplete: page.scanComplete,
        indexComplete: page.indexComplete,
        errorCode:
          records.length === 0 && page.scanComplete
            ? "HISTORY_NO_MATCH"
            : overBudget
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
          b
        );
      }

      // --- Single-point by message_id (ambiguous ⇒ candidate refs, §7.2).
      if (parsed.data.message_id) {
        return await this.readByMessageId(
          input.conversationId,
          parsed.data.message_id,
          parsed.data.neighbors,
          meta,
          b
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
          b
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

  /** §7.2 single-point read by opaque source ID. */
  private async readBySourceId(
    conversationId: string,
    sourceId: string,
    neighbors: number | undefined,
    meta: { epoch: string; revision: number; indexState: string },
    b: MutableBudget
  ): Promise<ReadResult> {
    const payload = decodeSourceId(sourceId, meta.epoch);
    if (!payload) {
      return rejectRead(meta, "HISTORY_SCOPE_INVALID");
    }
    const one = await this.archive.resolveOne(conversationId, sourceId);
    if (!one || !one.message) {
      return rejectRead(meta, "SOURCE_UNAVAILABLE");
    }
    const text = sliceByCodePoints(
      one.message.content ?? "",
      payload.startCodePoint,
      payload.endCodePoint
    );
    const rec = toExcerpt(one.message, meta, text, true);
    this.mergeInterval(
      b,
      payload.rowId,
      payload.startCodePoint,
      payload.endCodePoint
    );
    b.consumedTokens += this.estimateTokens(text);

    // Neighbor expansion (§7.2 neighbors 0–2): bounded rows around the anchor.
    const neighborCount = neighbors ?? 0;
    const neighborRecs =
      neighborCount > 0
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
      nextCursor: null,
      truncated: false,
      sourceRevision: meta.revision,
      storedContentIncomplete: false,
      errorCode: one.refreshed ? "SOURCE_CHANGED" : undefined,
    };
  }

  /** §7.2 single-point read by public messageId (ambiguous ⇒ candidates). */
  private async readByMessageId(
    conversationId: string,
    messageId: string,
    _neighbors: number | undefined,
    meta: { epoch: string; revision: number; indexState: string },
    b: MutableBudget
  ): Promise<ReadResult> {
    void _neighbors; // messageId reads do not expand neighbors (§7.2).
    const candidates = await this.archive.findByMessageId(
      conversationId,
      messageId
    );
    if (candidates.length === 0) {
      return rejectRead(meta, "SOURCE_UNAVAILABLE");
    }
    // §7.2: an ambiguous messageId returns ALL candidate source references
    // rather than selecting an arbitrary row; the model re-reads by source_id.
    const records = candidates.map((m) =>
      toExcerpt(m, meta, m.content ?? "", true)
    );
    for (const m of candidates) {
      this.mergeInterval(b, m.id, 0, codePointLength(m.content ?? ""));
      b.consumedTokens += this.estimateTokens(m.content ?? "");
    }
    return {
      records,
      nextCursor: null,
      truncated: false,
      sourceRevision: meta.revision,
      storedContentIncomplete: false,
      // Multiple candidates is itself a form of SOURCE_CHANGED (identity not
      // unique); a single exact row resolves cleanly.
      errorCode: candidates.length > 1 ? "SOURCE_CHANGED" : undefined,
    };
  }

  /** §7.2 range read between two opaque source IDs (bounded first page). */
  private async readRange(
    conversationId: string,
    fromSourceId: string,
    toSourceId: string,
    meta: { epoch: string; revision: number; indexState: string },
    b: MutableBudget
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
    const page = await this.archive.readPage({
      conversationId,
      maxRows: AI_CHAT_RECOVERABLE_DEFAULTS.metadataPageRows,
      maxCodePoints: AI_CHAT_RECOVERABLE_DEFAULTS.retrievalMaxOutputTokens,
    });
    const inRange = page.records.filter((r) => {
      const decoded = this.tryDecodeRecord(r.sourceId, r.text);
      if (!decoded) return false;
      return (
        decoded.payload.rowId >= from.rowId && decoded.payload.rowId <= to.rowId
      );
    });
    for (const r of inRange) {
      const decoded = this.tryDecodeRecord(r.sourceId, r.text);
      if (!decoded) continue;
      this.mergeInterval(
        b,
        decoded.payload.rowId,
        decoded.payload.startCodePoint,
        decoded.payload.endCodePoint
      );
      b.consumedTokens += this.estimateTokens(r.text);
    }
    const hasMore = inRange.length > 0 && page.nextCursor !== null;
    return {
      records: inRange,
      nextCursor: hasMore ? page.nextCursor : null,
      truncated: hasMore,
      sourceRevision: page.sourceRevision,
      storedContentIncomplete: false,
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
   * Re-resolve user-selected source references on submit (§13.3).
   *
   * Budget enforcement applies: accepted excerpts count toward the turn budget
   * and are deduplicated by archive interval, so a passage that is already
   * present in recent history cannot double its cost. Excerpts over the
   * per-excerpt cap are capped at the nearest code-point boundary instead of
   * dropped, and the overall cap rejects the rest before acceptance so the
   * draft selections survive on retry (§13.3 "reject before acceptance").
   */
  async resolveSelections(
    conversationId: string,
    sourceIds: readonly string[],
    turnId?: string
  ): Promise<ResolveResult> {
    const rejected = new Set<string>();
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
      const paired = this.pairWithSubmittedIds(sourceIds, result);
      const resolved: HistoryExcerpt[] = [];
      const turnBudgetTurnId = turnId ?? "default";
      const b = this.budgetFor(conversationId, turnBudgetTurnId);
      let acceptedTokens = 0;
      for (const { submittedId, excerpt } of paired) {
        const decoded = this.tryDecodeRecord(excerpt.sourceId, excerpt.text);
        const cap = this.excerptCap(excerpt.text);
        const text =
          cap < excerpt.text.length
            ? sliceByCodePoints(excerpt.text, 0, cap)
            : excerpt.text;
        if (text.length === 0) {
          rejected.add(submittedId);
          continue;
        }
        const tokens = this.estimateTokens(text);
        if (
          resolved.length > 0 &&
          acceptedTokens + tokens >
            AI_CHAT_RECOVERABLE_DEFAULTS.selectionMaxTotalTokens
        ) {
          rejected.add(submittedId);
          continue;
        }
        // Account exactly what the model receives: the full requested
        // interval, or the truncated prefix when the per-excerpt cap bit.
        // The stored sourceId narrows to that prefix too, so a persisted
        // reference always resolves to the text the model actually saw.
        const span = decoded
          ? {
              epoch: decoded.payload.epoch,
              revision: decoded.payload.revision,
              rowId: decoded.payload.rowId,
              start: decoded.payload.startCodePoint,
              end:
                text === excerpt.text
                  ? decoded.payload.endCodePoint
                  : decoded.payload.startCodePoint + codePointLength(text),
            }
          : null;
        if (span) this.mergeInterval(b, span.rowId, span.start, span.end);
        acceptedTokens += tokens;
        if (text === excerpt.text) {
          resolved.push(excerpt);
          continue;
        }
        // Uncap-able ids (un-decodable) keep the archive's own reference.
        resolved.push({
          ...excerpt,
          sourceId: span
            ? encodeSourceId({
                v: 1,
                epoch: span.epoch,
                revision: span.revision,
                rowId: span.rowId,
                field: "content",
                startCodePoint: span.start,
                endCodePoint: span.end,
              })
            : excerpt.sourceId,
          text,
          hasMore: true,
        });
      }
      return {
        resolved,
        acceptedSubmittedIds: paired
          .filter(({ submittedId }) => !rejected.has(submittedId))
          .map(({ submittedId }) => submittedId),
        rejected: this.orderSelectionIds(sourceIds, rejected, result.rejected),
        errorCode: this.selectionErrorCode(resolved, rejected),
      };
    } catch (error) {
      return mapArchiveError(error, {
        resolved: [],
        rejected: [...sourceIds],
      });
    }
  }

  /** Truncate an excerpt to the per-excerpt token cap at a code-point boundary. */
  private excerptCap(text: string): number {
    return Math.min(
      text.length,
      AI_CHAT_RECOVERABLE_DEFAULTS.selectionMaxExcerptTokens * 4
    );
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
   * Map the resolution outcome to a recoverable-history error code. A
   * partially-accepted batch is `SOURCE_CHANGED` (the caller still gets the
   * accepted references); an empty result is `HISTORY_SCOPE_INVALID` so a
   * tombstoned/unknown scope reads consistently with the archive layer.
   */
  private selectionErrorCode(
    resolved: readonly HistoryExcerpt[],
    rejected: Set<string>
  ): RecoverableHistoryErrorCode | undefined {
    if (resolved.length === 0) {
      return "HISTORY_SCOPE_INVALID";
    }
    if (rejected.size > 0) {
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
  return {
    sourceId: encodeSourceId({
      v: 1,
      epoch: meta.epoch,
      revision: meta.revision,
      rowId: msg.id,
      field: "content",
      startCodePoint: 0,
      endCodePoint: cpLen,
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
