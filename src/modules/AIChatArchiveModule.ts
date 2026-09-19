import { BaseModule } from "@/modules/baseModule";
import { AIChatMessageArchiveModel } from "@/model/AIChatMessageArchive.model";
import { AIChatArchiveStateModel } from "@/model/AIChatArchiveState.model";
import { AIChatArchiveEntryModel } from "@/model/AIChatArchiveEntry.model";
import { AIChatArchiveTurnModel } from "@/model/AIChatArchiveTurn.model";
import { AIChatArchiveSearchFragmentModel } from "@/model/AIChatArchiveSearchFragment.model";
import {
  encodeCursor,
  encodeSourceId,
  decodeSourceId,
} from "@/service/AIChatArchiveCursorCodec";
import {
  codePointLength,
  sliceByCodePoints,
} from "@/service/AIChatArchiveTextUtil";
import { AI_CHAT_RECOVERABLE_DEFAULTS } from "@/service/AIChatRecoverableDefaults";
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import {
  RecoverableHistoryError,
  type ArchiveReadPage,
  type ArchivePageRequest,
  type HistoryExcerpt,
  type RefreshedSelection,
} from "@/entityTypes/aiChatArchiveTypes";

/**
 * Archive business logic (technical-design §6). Delegates to five Models:
 *   - StateModel     : epoch/revision/high-water/lease
 *   - MessageArchive : bounded keyset reads + substrings over ai_chat_messages
 *   - EntryModel     : lightweight source-row index projections + getToolPair
 *   - TurnModel      : turn ranges + recent complete turns + compactable prefix
 *   - SearchFragment : bounded overlapping fragments for literal search
 *
 * Never touches repositories directly (three-layer architecture). Maps
 * entities → HistoryExcerpt with opaque source IDs. All reads are bounded by a
 * metadata row cap + a decoded-text byte allowance (§6 operational limits).
 *
 * Turn materialization follows page continuations past the 64-row metadata
 * page (up to TURN_READ_MAX_PAGES) and reports completeness, so a tool-heavy
 * turn is never silently truncated (FR-05).
 */
/** Rows per turn-materialization page (matches the metadata page cap). */
const TURN_READ_PAGE_ROWS = 64;
/** Page-follow cap per turn/tail read: 16 × 64 = 1,024 rows, then receipt. */
const TURN_READ_MAX_PAGES = 16;

export class AIChatArchiveModule extends BaseModule {
  /**
   * Bounded forward page read in (timestamp, id) ASC order. Honors an opaque
   * cursor continuation, a metadata row cap, and a decoded-text byte allowance.
   * Returns empty + revision 0 for unknown/tombstoned conversations.
   */
  async readPage(request: ArchivePageRequest): Promise<ArchiveReadPage> {
    await this.ensureConnection();
    const stateModel = new AIChatArchiveStateModel(this.dbpath);
    const state = await stateModel.getState(request.conversationId);
    if (!state || state.deletedAt) {
      return {
        records: [],
        nextCursor: null,
        truncated: false,
        sourceRevision: 0,
      };
    }
    const msgModel = new AIChatMessageArchiveModel(this.dbpath);
    const page = await msgModel.readPageForward({
      conversationId: request.conversationId,
      cursor: request.cursor,
      maxRows: request.maxRows,
      maxCodePoints: request.maxCodePoints,
      snapshotTimestampMs: request.snapshotTimestampMs,
      snapshotRowId: request.snapshotRowId,
    });
    const records: HistoryExcerpt[] = page.records.map((r) =>
      this.toExcerpt(r, state.epoch, state.sourceRevision, r.content, false)
    );
    return {
      records,
      nextCursor: page.nextCursor,
      truncated: page.truncated,
      sourceRevision: state.sourceRevision,
    };
  }

  /**
   * Bounded entity read for one turn range, inclusive of both ends
   * (§4.3, FR-05). Returns raw rows (all message types, so tool exchanges
   * stay with their turn) in chronological order, following page continuations
   * until the turn end bound — never a conversation scan. `complete` is false
   * when the turn exceeds the page cap (callers must take the receipt path,
   * never cost a truncated page as a complete turn).
   */
  async readTurnRows(
    conversationId: string,
    firstTimestampMs: number,
    firstRowId: number,
    lastTimestampMs: number,
    lastRowId: number,
    maxCodePoints: number
  ): Promise<{ rows: AIChatMessageEntity[]; complete: boolean }> {
    await this.ensureConnection();
    const stateModel = new AIChatArchiveStateModel(this.dbpath);
    const state = await stateModel.getState(conversationId);
    if (!state || state.deletedAt) return { rows: [], complete: true };
    const msgModel = new AIChatMessageArchiveModel(this.dbpath);
    const rows: AIChatMessageEntity[] = [];
    let cursor: string | undefined;
    for (let pages = 0; pages < TURN_READ_MAX_PAGES; pages++) {
      const page = await msgModel.readPageForward({
        conversationId,
        cursor,
        maxRows: TURN_READ_PAGE_ROWS,
        maxCodePoints,
        // First page keysets from the turn start; later pages continue from
        // the opaque cursor (strictly after the last returned row).
        ...(cursor
          ? {}
          : {
              startTimestampMs: firstTimestampMs,
              startRowId: firstRowId,
            }),
        snapshotTimestampMs: lastTimestampMs,
        snapshotRowId: lastRowId,
      });
      rows.push(...page.records);
      if (!page.nextCursor) return { rows, complete: true };
      cursor = page.nextCursor;
    }
    return { rows, complete: false };
  }

  /**
   * Bounded entity read of rows strictly after a (timestamp, rowId) position
   * — the live/in-progress tail past the last completed turn (§4.3). Keysets
   * strictly after the anchor (no page slot wasted on it) and follows page
   * continuations up to the cap. Returns raw rows in chronological order.
   */
  async readRowsAfter(
    conversationId: string,
    afterTimestampMs: number,
    afterRowId: number,
    maxCodePoints: number
  ): Promise<{ rows: AIChatMessageEntity[]; complete: boolean }> {
    await this.ensureConnection();
    const stateModel = new AIChatArchiveStateModel(this.dbpath);
    const state = await stateModel.getState(conversationId);
    if (!state || state.deletedAt) return { rows: [], complete: true };
    const msgModel = new AIChatMessageArchiveModel(this.dbpath);
    // Exclusive anchor cursor: rows strictly after the position, so every
    // page slot carries live-tail content (FR-05, AC-03).
    let cursor: string | undefined = encodeCursor({
      v: 1,
      conversationId,
      epoch: state.epoch,
      revision: state.sourceRevision,
      lastTimestampMs: afterTimestampMs,
      lastRowId: afterRowId,
      direction: "forward",
    });
    const rows: AIChatMessageEntity[] = [];
    for (let pages = 0; pages < TURN_READ_MAX_PAGES; pages++) {
      const page = await msgModel.readPageForward({
        conversationId,
        cursor,
        maxRows: TURN_READ_PAGE_ROWS,
        maxCodePoints,
      });
      rows.push(...page.records);
      if (!page.nextCursor) return { rows, complete: true };
      cursor = page.nextCursor;
    }
    return { rows, complete: false };
  }

  /**
   * Bounded literal substring search over indexed search fragments (§5.6,
   * §7.1). Walks fragments in (sourceRowId, startCodePoint) ASC order with a
   * 500-fragment / 100-ms per-page budget, then returns a continuation cursor.
   * Verifies each fragment hit against the original source text and merges
   * overlap duplicates. No-match is final only when scanComplete is true.
   *
   * Returns scan_complete + index_complete flags; index_complete reflects the
   * archive state's indexState (absent/indexing/complete/stale).
   */
  async searchPage(request: {
    conversationId: string;
    query: string;
    cursor?: string;
    maxFragments?: number;
    maxMs?: number;
  }): Promise<
    ArchiveReadPage & {
      scanComplete: boolean;
      indexComplete: boolean;
    }
  > {
    await this.ensureConnection();
    const stateModel = new AIChatArchiveStateModel(this.dbpath);
    const state = await stateModel.getState(request.conversationId);
    if (!state || state.deletedAt) {
      return {
        records: [],
        nextCursor: null,
        truncated: false,
        sourceRevision: 0,
        scanComplete: true,
        indexComplete: false,
      };
    }
    // Decode the continuation cursor (scoped to conversation + epoch, bound
    // to this query/filter + revision — §§4.2, 7). A changed query, stale
    // revision, or foreign cursor fails closed without exposing content.
    let afterRowId = 0;
    let afterStart = 0;
    if (request.cursor) {
      const decoded = decodeScanCursor(
        request.cursor,
        request.conversationId,
        state.epoch,
        hashQuery(request.query),
        state.sourceRevision
      );
      if (!decoded) {
        // A modified/foreign cursor must not widen scope — reject loudly
        // (§7.1: "A caller-modified cursor must never widen conversation
        // scope") so the retrieval service maps HISTORY_SCOPE_INVALID.
        throw new RecoverableHistoryError(
          "HISTORY_SCOPE_INVALID",
          "search cursor failed scope validation (conversation/epoch/query/revision mismatch or malformed payload)"
        );
      }
      afterRowId = decoded.lastSourceRowId;
      afterStart = decoded.lastStartCodePoint;
    }

    const fragModel = new AIChatArchiveSearchFragmentModel(this.dbpath);
    const msgModel = new AIChatMessageArchiveModel(this.dbpath);
    const scan = await fragModel.scanLiteral(
      request.conversationId,
      request.query,
      afterRowId,
      afterStart,
      request.maxFragments,
      request.maxMs
    );

    // Verify each hit against the original source + merge overlap duplicates.
    // Offsets are preserved exactly (code points, not UTF-16 units): a hit
    // later in a message resolves to the displayed passage, never the prefix
    // (FR-01–03, AC-01/AC-18). Verification checks the returned fragment
    // itself — a match elsewhere in the message is insufficient.
    const seen = new Set<string>();
    const records: HistoryExcerpt[] = [];
    for (const hit of scan.hits) {
      const dedupKey = `${hit.sourceRowId}:${hit.field}:${hit.startCodePoint}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      const msg = await msgModel.readMessageInConversation(
        request.conversationId,
        hit.sourceRowId
      );
      if (!msg) continue; // SOURCE_UNAVAILABLE — skip, don't fabricate.
      // Verify the fragment slice itself contains the query (handles edits);
      // cross-fragment phrase matches were validated at index time via the
      // 128-code-point overlap (§7.1).
      const fragText = sliceByCodePoints(
        msg.content ?? "",
        hit.startCodePoint,
        hit.endCodePoint
      );
      const verify = fragText.includes(request.query);
      records.push(
        this.toExcerptWithSpan(
          msg,
          state.epoch,
          state.sourceRevision,
          fragText,
          hit.field === "tool_receipt" ? "tool_receipt" : "content",
          hit.startCodePoint,
          hit.endCodePoint,
          verify
        )
      );
    }

    const nextCursor =
      scan.hasMore && scan.lastRowId >= 0
        ? encodeScanCursor({
            v: 1,
            conversationId: request.conversationId,
            epoch: state.epoch,
            revision: state.sourceRevision,
            queryHash: hashQuery(request.query),
            lastSourceRowId: scan.lastRowId,
            lastStartCodePoint: scan.lastStart,
          })
        : null;

    return {
      records,
      nextCursor,
      truncated: false,
      sourceRevision: state.sourceRevision,
      scanComplete: !scan.hasMore,
      indexComplete: state.indexState === "complete",
    };
  }

  /**
   * Bounded substring read of a single message by code-point offsets (§6).
   * Returns null when the row no longer exists (caller maps to
   * SOURCE_UNAVAILABLE). Does not normalize exact read text.
   *
   * Conversation-scoped overload below is required for all new callers
   * (AC-12): the row-ID-only form is retained for coordinator-internal reads
   * where the conversation was already validated.
   */
  async readSourceSlice(
    rowId: number,
    startCodePoint: number,
    endCodePoint: number
  ): Promise<string | null> {
    await this.ensureConnection();
    const msgModel = new AIChatMessageArchiveModel(this.dbpath);
    return msgModel.readSourceSlice(rowId, startCodePoint, endCodePoint);
  }

  /**
   * Conversation-scoped bounded substring read (AC-12). Rejects rows from
   * another conversation without exposing content.
   */
  async readSourceSliceInConversation(
    conversationId: string,
    rowId: number,
    startCodePoint: number,
    endCodePoint: number
  ): Promise<string | null> {
    await this.ensureConnection();
    const msgModel = new AIChatMessageArchiveModel(this.dbpath);
    return msgModel.readSourceSliceInConversation(
      conversationId,
      rowId,
      startCodePoint,
      endCodePoint
    );
  }

  /**
   * Archive metadata for the retrieval service: epoch, revision, and index
   * state. Null when the conversation was never archived.
   */
  async getArchiveMeta(
    conversationId: string
  ): Promise<{ epoch: string; revision: number; indexState: string } | null> {
    await this.ensureConnection();
    const stateModel = new AIChatArchiveStateModel(this.dbpath);
    const state = await stateModel.getState(conversationId);
    if (!state || state.deletedAt) return null;
    return {
      epoch: state.epoch,
      revision: state.sourceRevision,
      indexState: state.indexState,
    };
  }

  /**
   * Look up messages by public messageId (§7.2). An ambiguous messageId
   * returns ALL candidate rows — the retrieval service decides between
   * returning candidate source references (ambiguity) vs a single read.
   */
  async findByMessageId(
    conversationId: string,
    messageId: string
  ): Promise<AIChatMessageEntity[]> {
    await this.ensureConnection();
    const msgModel = new AIChatMessageArchiveModel(this.dbpath);
    return msgModel.findByMessageId(conversationId, messageId);
  }

  /**
   * Bounded neighbor read around a (timestamp, rowId) anchor (§7.2). Up to
   * `before` rows strictly before the anchor and `after` rows strictly after
   * it, chronological order, excluding the anchor itself. The caller already
   * holds the anchor row.
   */
  async readNeighbors(
    conversationId: string,
    anchorTimestampMs: number,
    anchorRowId: number,
    before: number,
    after: number
  ): Promise<AIChatMessageEntity[]> {
    await this.ensureConnection();
    const msgModel = new AIChatMessageArchiveModel(this.dbpath);
    return msgModel.readNeighbors(
      conversationId,
      anchorTimestampMs,
      anchorRowId,
      before,
      after
    );
  }

  /**
   * Resolve one opaque source ID against the current epoch/revision.
   * Returns the message row (or null when the row is gone) plus whether the
   * reference was refreshed (revision changed — SOURCE_CHANGED per §4.2).
   *
   * Conversation-scoped (AC-12): the row is re-read with the conversation ID
   * so a forged reference to another conversation's row fails closed without
   * leaking foreign content — checking only the supplied epoch is not enough
   * because source IDs are editable base64 data.
   */
  async resolveOne(
    conversationId: string,
    sourceId: string
  ): Promise<{
    message: AIChatMessageEntity | null;
    refreshed: boolean;
    epoch: string;
    revision: number;
  } | null> {
    await this.ensureConnection();
    const stateModel = new AIChatArchiveStateModel(this.dbpath);
    const state = await stateModel.getState(conversationId);
    if (!state || state.deletedAt) return null;
    const payload = decodeSourceId(sourceId, state.epoch);
    if (!payload) return null;
    const msgModel = new AIChatMessageArchiveModel(this.dbpath);
    const message = await msgModel.readMessageInConversation(
      conversationId,
      payload.rowId
    );
    return {
      message,
      refreshed: payload.revision !== state.sourceRevision,
      epoch: state.epoch,
      revision: state.sourceRevision,
    };
  }

  /**
   * Boundary keys of recent complete turns (the retained suffix), newest-last
   * chronological order, live turn excluded (§4.3). Used by context assembly
   * to materialize whole turns by token cost. Empty when no turn projections
   * exist yet (callers fall back to bounded recent rows — §15).
   */
  async getRecentTurnRanges(
    conversationId: string,
    maxCount: number
  ): Promise<
    Array<{
      turnId: string;
      firstTimestampMs: number;
      firstRowId: number;
      lastTimestampMs: number;
      lastRowId: number;
    }>
  > {
    await this.ensureConnection();
    const stateModel = new AIChatArchiveStateModel(this.dbpath);
    const state = await stateModel.getState(conversationId);
    if (!state || state.deletedAt) return [];
    const turnModel = new AIChatArchiveTurnModel(this.dbpath);
    const turns = await turnModel.readRecentCompleteTurns(
      conversationId,
      state.epoch,
      AI_CHAT_RECOVERABLE_DEFAULTS.minRetainedCompleteTurns,
      maxCount
    );
    return turns.map((t) => ({
      turnId: t.turnId,
      firstTimestampMs: Number(t.firstTimestampMs),
      firstRowId: t.firstRowId,
      lastTimestampMs: Number(t.lastTimestampMs),
      lastRowId: t.lastRowId,
    }));
  }

  // NOTE: a previous `getRecentTurns` excerpt helper was removed (2026-09-17).
  // It had no callers or tests worktree-wide, and its single-page materialize
  // silently truncated turns past 64 rows. Live consumers: `getRecentTurnRanges`
  // + `readTurnRows` / `readRowsAfter` (paged, completeness-reporting), and the
  // assembler's `loadTurnBackedRows` (receipts incomplete/oversized turns).


  /**
   * Indexed tool-call/tool-result pair lookup (§5.2, §7.3). Replaces the
   * legacy full-history loader. Returns the paired message rows (call/result)
   * for a toolCallId, without loading all tool metadata. Either may be null
   * for legacy/interrupted exchanges.
   */
  async getToolPair(
    conversationId: string,
    toolCallId: string
  ): Promise<{
    callMessage: AIChatMessageEntity | null;
    resultMessage: AIChatMessageEntity | null;
    epoch: string;
    revision: number;
  } | null> {
    await this.ensureConnection();
    const stateModel = new AIChatArchiveStateModel(this.dbpath);
    const state = await stateModel.getState(conversationId);
    if (!state || state.deletedAt) return null;

    const entryModel = new AIChatArchiveEntryModel(this.dbpath);
    const { callEntry, resultEntry } = await entryModel.findByToolCallId(
      conversationId,
      state.epoch,
      toolCallId
    );
    const msgModel = new AIChatMessageArchiveModel(this.dbpath);
    const callMessage = callEntry
      ? await msgModel.readMessageInConversation(
          conversationId,
          callEntry.sourceRowId
        )
      : null;
    const resultMessage = resultEntry
      ? await msgModel.readMessageInConversation(
          conversationId,
          resultEntry.sourceRowId
        )
      : null;
    return {
      callMessage,
      resultMessage,
      epoch: state.epoch,
      revision: state.sourceRevision,
    };
  }

  /**
   * Re-resolve user-selected source references on submit (§13.3, FR-10).
   * Validates epoch/revision against the current source. Every returned
   * excerpt preserves its exact requested `[start, end)` span in the opaque
   * source ID, so a mid-message hit round-trips without becoming the message
   * prefix (FR-01–03, AC-01/AC-18). A revision mismatch rejects the stale
   * reference and offers a refreshed one for explicit user confirmation —
   * stale offsets are never quoted into the turn (§4.2, AC-18). Budget
   * enforcement lives in the retrieval service (§7.4).
   */
  async resolveSelections(
    conversationId: string,
    sourceIds: readonly string[]
  ): Promise<{
    resolved: HistoryExcerpt[];
    rejected: string[];
    refreshed: RefreshedSelection[];
    errorCode?: string;
  }> {
    await this.ensureConnection();
    const stateModel = new AIChatArchiveStateModel(this.dbpath);
    const state = await stateModel.getState(conversationId);
    if (!state || state.deletedAt) {
      return {
        resolved: [],
        rejected: [...sourceIds],
        refreshed: [],
        errorCode: "HISTORY_SCOPE_INVALID",
      };
    }
    const msgModel = new AIChatMessageArchiveModel(this.dbpath);
    const resolved: HistoryExcerpt[] = [];
    const rejected: string[] = [];
    const refreshed: RefreshedSelection[] = [];
    for (const sid of sourceIds) {
      const payload = decodeSourceId(sid, state.epoch);
      if (!payload) {
        rejected.push(sid);
        continue;
      }
      // Conversation-scoped read (AC-12): forged cross-conversation row IDs
      // fail closed here even when the epoch matches.
      const msg = await msgModel.readMessageInConversation(
        conversationId,
        payload.rowId
      );
      if (!msg) {
        rejected.push(sid);
        continue;
      }
      // Revision mismatch ⇒ SOURCE_CHANGED (§4.2). The stale reference is
      // rejected (never quoted). The confirmation preview is the CURRENT
      // message text with a reset span — never the stale interval sliced
      // onto changed content — and `exact: false`, because the user's
      // selected offsets no longer describe this text. Oversized messages
      // preview bounded with hasMore so the confirmation stays small.
      if (payload.revision !== state.sourceRevision) {
        rejected.push(sid);
        const current = msg.content ?? "";
        const currentLen = codePointLength(current);
        const previewLen = Math.min(
          currentLen,
          AI_CHAT_RECOVERABLE_DEFAULTS.searchFragmentMaxCodePoints
        );
        const preview = sliceByCodePoints(current, 0, previewLen);
        const previewExcerpt = this.toExcerptWithSpan(
          msg,
          state.epoch,
          state.sourceRevision,
          preview,
          payload.field,
          0,
          previewLen,
          false
        );
        refreshed.push({
          submittedId: sid,
          excerpt:
            previewLen < currentLen
              ? { ...previewExcerpt, hasMore: true }
              : previewExcerpt,
        });
        continue;
      }
      const text = sliceByCodePoints(
        msg.content ?? "",
        payload.startCodePoint,
        payload.endCodePoint
      );
      resolved.push(
        this.toExcerptWithSpan(
          msg,
          state.epoch,
          state.sourceRevision,
          text,
          payload.field,
          payload.startCodePoint,
          payload.endCodePoint,
          true
        )
      );
    }
    const errorCode =
      refreshed.length > 0
        ? "SOURCE_CHANGED"
        : rejected.length > 0 && resolved.length === 0
          ? "SOURCE_UNAVAILABLE"
          : rejected.length > 0
            ? "SOURCE_CHANGED"
            : undefined;
    return { resolved, rejected, refreshed, errorCode };
  }

  /**
   * Map a source message row to a HistoryExcerpt with an opaque source ID
   * covering the whole content (start 0, end = code-point length). `exact`
   * reflects whether the excerpt text was verified against the original.
   */
  private toExcerpt(
    msg: AIChatMessageEntity,
    epoch: string,
    revision: number,
    text: string,
    exact: boolean
  ): HistoryExcerpt {
    const cpLen = codePointLength(text);
    return {
      sourceId: encodeSourceId({
        v: 1,
        epoch,
        revision,
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

  /**
   * Map a verified source slice to a HistoryExcerpt whose opaque source ID
   * carries the exact [start, end) code-point interval (FR-01–03). A nonzero
   * offset round-trips: search → read → select returns the same exact text.
   */
  private toExcerptWithSpan(
    msg: AIChatMessageEntity,
    epoch: string,
    revision: number,
    text: string,
    field: "content" | "tool_receipt",
    startCodePoint: number,
    endCodePoint: number,
    exact: boolean
  ): HistoryExcerpt {
    return {
      sourceId: encodeSourceId({
        v: 1,
        epoch,
        revision,
        rowId: msg.id,
        field,
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
}

// --- Search-cursor codec (scoped, versioned, opaque) -------------------------
// A search cursor carries the last scanned (sourceRowId, startCodePoint) plus a
// query hash so a modified query/filter cannot widen scope. Not an
// authorization credential — decoded against trusted epoch/revision.

interface ScanCursorPayload {
  v: 1;
  conversationId: string;
  epoch: string;
  revision: number;
  queryHash: string;
  lastSourceRowId: number;
  lastStartCodePoint: number;
}

function hashQuery(query: string): string {
  // FNV-1a 32-bit — deterministic, dependency-free, good enough for cursor
  // binding (we only need to detect a changed query, not cryptographic strength).
  let h = 0x811c9dc5;
  for (let i = 0; i < query.length; i++) {
    h ^= query.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function encodeScanCursor(payload: ScanCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeScanCursor(
  raw: string,
  expectedConversationId: string,
  expectedEpoch: string,
  expectedQueryHash?: string,
  expectedRevision?: number
): ScanCursorPayload | null {
  if (raw.length === 0 || raw.length > 1024) return null;
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
  if (p.conversationId !== expectedConversationId) return null;
  if (p.epoch !== expectedEpoch) return null;
  if (typeof p.queryHash !== "string") return null;
  if (typeof p.lastSourceRowId !== "number") return null;
  if (typeof p.lastStartCodePoint !== "number") return null;
  // Bind the cursor to the active query/filter + revision (§§4.2, 7): a
  // changed query or stale revision fails closed, never widens scope. A
  // cursor without a revision field (pre-binding issuance or hand-crafted)
  // is rejected whenever a revision is expected — no silent grandfathering.
  if (
    expectedQueryHash !== undefined &&
    p.queryHash !== expectedQueryHash
  ) {
    return null;
  }
  if (expectedRevision !== undefined) {
    if (typeof p.revision !== "number" || p.revision !== expectedRevision) {
      return null;
    }
  }
  return {
    v: 1,
    conversationId: p.conversationId as string,
    epoch: p.epoch as string,
    revision: typeof p.revision === "number" ? p.revision : 0,
    queryHash: p.queryHash as string,
    lastSourceRowId: p.lastSourceRowId as number,
    lastStartCodePoint: p.lastStartCodePoint as number,
  };
}
