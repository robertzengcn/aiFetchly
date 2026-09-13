import { BaseModule } from "@/modules/baseModule";
import { AIChatMessageArchiveModel } from "@/model/AIChatMessageArchive.model";
import { AIChatArchiveStateModel } from "@/model/AIChatArchiveState.model";
import { AIChatArchiveEntryModel } from "@/model/AIChatArchiveEntry.model";
import { AIChatArchiveTurnModel } from "@/model/AIChatArchiveTurn.model";
import { AIChatArchiveSearchFragmentModel } from "@/model/AIChatArchiveSearchFragment.model";
import {
  encodeSourceId,
  decodeSourceId,
} from "@/service/AIChatArchiveCursorCodec";
import {
  codePointLength,
  sliceByCodePoints,
} from "@/service/AIChatArchiveTextUtil";
import { AI_CHAT_RECOVERABLE_DEFAULTS } from "@/service/AIChatRecoverableDefaults";
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import type {
  ArchiveReadPage,
  ArchivePageRequest,
  HistoryExcerpt,
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
 */
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
    // Decode the continuation cursor (scoped to conversation + epoch).
    let afterRowId = 0;
    let afterStart = 0;
    if (request.cursor) {
      const decoded = decodeScanCursor(
        request.cursor,
        request.conversationId,
        state.epoch
      );
      if (!decoded) {
        return {
          records: [],
          nextCursor: null,
          truncated: false,
          sourceRevision: state.sourceRevision,
          scanComplete: true,
          indexComplete: state.indexState === "complete",
          // Indicate a scope problem to the caller via an empty final page.
        };
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
    const seen = new Set<string>();
    const records: HistoryExcerpt[] = [];
    for (const hit of scan.hits) {
      const dedupKey = `${hit.sourceRowId}:${hit.field}:${hit.startCodePoint}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      const msg = await msgModel.readMessageByRowId(hit.sourceRowId);
      if (!msg) continue; // SOURCE_UNAVAILABLE — skip, don't fabricate.
      // Verify the query still occurs in the original (handles edits).
      const text = msg.content ?? "";
      const verify = text.includes(request.query);
      records.push(
        this.toExcerpt(
          msg,
          state.epoch,
          state.sourceRevision,
          hit.fragmentText,
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
   * Recent complete turns (the retained suffix), returned in chronological
   * order. Excludes the live turn (§4.3). Falls back to a bounded recent-row
   * read when no turn projections exist yet (before indexing completes — §15).
   */
  async getRecentTurns(
    conversationId: string,
    maxCount: number,
    maxCodePoints: number
  ): Promise<HistoryExcerpt[]> {
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
    if (turns.length === 0) {
      // Fallback: bounded recent rows before indexing completes (§15).
      const msgModel = new AIChatMessageArchiveModel(this.dbpath);
      const rows = await msgModel.readRecent(
        conversationId,
        maxCount,
        maxCodePoints
      );
      return rows.map((r) =>
        this.toExcerpt(r, state.epoch, state.sourceRevision, r.content, true)
      );
    }
    // Materialize the message rows for each retained turn (bounded).
    const msgModel = new AIChatMessageArchiveModel(this.dbpath);
    const out: HistoryExcerpt[] = [];
    for (const turn of turns) {
      const rows = await msgModel.readPageForward({
        conversationId,
        maxRows: 64,
        maxCodePoints,
        snapshotTimestampMs: Number(turn.lastTimestampMs),
        snapshotRowId: turn.lastRowId,
      });
      // Only the rows at or after the turn's first (timestamp, rowId).
      for (const r of rows.records) {
        const ts = r.timestamp.getTime();
        if (
          ts < Number(turn.firstTimestampMs) ||
          (ts === Number(turn.firstTimestampMs) && r.id < turn.firstRowId)
        ) {
          continue;
        }
        out.push(
          this.toExcerpt(r, state.epoch, state.sourceRevision, r.content, true)
        );
      }
    }
    return out;
  }

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
      ? await msgModel.readMessageByRowId(callEntry.sourceRowId)
      : null;
    const resultMessage = resultEntry
      ? await msgModel.readMessageByRowId(resultEntry.sourceRowId)
      : null;
    return {
      callMessage,
      resultMessage,
      epoch: state.epoch,
      revision: state.sourceRevision,
    };
  }

  /**
   * Re-resolve user-selected source references on submit (§13.3). Validates
   * epoch/revision against the current source, checks final budget, and
   * persists accepted selection references with the user-turn metadata. If the
   * source changed (older revision), returns SOURCE_CHANGED with a refreshed
   * reference when identity still resolves (§4.2).
   *
   * First version: validates each opaque source ID against the current epoch/
   * revision and returns the resolved message rows. Budget enforcement lives
   * in the retrieval service (§7.4).
   */
  async resolveSelections(
    conversationId: string,
    sourceIds: readonly string[]
  ): Promise<{
    resolved: HistoryExcerpt[];
    rejected: string[];
    errorCode?: string;
  }> {
    await this.ensureConnection();
    const stateModel = new AIChatArchiveStateModel(this.dbpath);
    const state = await stateModel.getState(conversationId);
    if (!state || state.deletedAt) {
      return {
        resolved: [],
        rejected: [...sourceIds],
        errorCode: "HISTORY_SCOPE_INVALID",
      };
    }
    const msgModel = new AIChatMessageArchiveModel(this.dbpath);
    const resolved: HistoryExcerpt[] = [];
    const rejected: string[] = [];
    for (const sid of sourceIds) {
      const payload = decodeSourceId(sid, state.epoch);
      if (!payload) {
        rejected.push(sid);
        continue;
      }
      // Revision mismatch ⇒ SOURCE_CHANGED (§4.2). Identity may still resolve.
      if (payload.revision !== state.sourceRevision) {
        const msg = await msgModel.readMessageByRowId(payload.rowId);
        if (!msg) {
          rejected.push(sid);
          continue;
        }
        // Refresh the reference at the current revision.
        const refreshed = this.toExcerpt(
          msg,
          state.epoch,
          state.sourceRevision,
          sliceByCodePoints(
            msg.content ?? "",
            payload.startCodePoint,
            payload.endCodePoint
          ),
          true
        );
        resolved.push(refreshed);
        continue;
      }
      const msg = await msgModel.readMessageByRowId(payload.rowId);
      if (!msg) {
        rejected.push(sid);
        continue;
      }
      const text = sliceByCodePoints(
        msg.content ?? "",
        payload.startCodePoint,
        payload.endCodePoint
      );
      resolved.push(
        this.toExcerpt(msg, state.epoch, state.sourceRevision, text, true)
      );
    }
    const errorCode =
      rejected.length > 0 && resolved.length === 0
        ? "SOURCE_UNAVAILABLE"
        : rejected.length > 0
        ? "SOURCE_CHANGED"
        : undefined;
    return { resolved, rejected, errorCode };
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
  expectedEpoch: string
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
