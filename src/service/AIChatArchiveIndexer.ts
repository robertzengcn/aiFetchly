/**
 * AIChatArchiveIndexer — bounded resumable backfill of derived index projections
 * (technical-design §15.5: "Backfill archive state, turn/entry projections, and
 * search fragments in resumable batches").
 *
 * For one conversation, the indexer walks ai_chat_messages in (timestamp, id)
 * ASC order above a resume cursor, and for each row projects:
 *   - an Entry (lightweight ordering + turn/tool metadata, §5.2)
 *   - a SearchFragment set (bounded overlapping slices for literal search, §5.6)
 * Turn projections are upserted from inferred boundaries (legacy rows lack a
 * native turnId; the indexer groups rows by ordered user-message starts).
 *
 * Resumability: after each bounded batch the indexer persists
 *   - indexCursorJson  (the next (timestamp, rowId) to resume from)
 *   - highWater         (end of the last *complete* turn — the compaction
 *                         snapshot boundary / retained-suffix start, §11.2)
 *   - indexState        (indexing → complete)
 * to the archive state row atomically, so a crash mid-backfill resumes from
 * the last fully-processed row. "Never mark an index complete merely because
 * one batch ended" (§15.6) — complete is only set when no rows remain.
 *
 * Incremental tail replay (§15.6): "Ordinary append while backfill runs is
 * tracked above the captured index watermark; replay the new tail after the
 * older snapshot." Because the resume cursor is persisted per batch, a later
 * run re-enters readBatchAboveCursor at the cursor and replays the new tail.
 * Revision changes (the coordinator bumps sourceRevision on tombstone/clear)
 * invalidate the index: a stale index is re-walked from the cursor (the epoch
 * is unchanged unless the conversation was tombstoned, in which case ensureState
 * minted a fresh epoch and the index starts absent again).
 *
 * No AI calls. No full-conversation in-memory load. Bounded by batchRows and
 * the per-row search-fragment cap. Worker-process safety is NOT required here:
 * the indexer runs in the main process (it reads the authoritative source
 * table directly), but it never holds a long DB transaction across batches.
 */

import { BaseModule } from "@/modules/baseModule";
import { AIChatArchiveStateModel } from "@/model/AIChatArchiveState.model";
import { AIChatMessageArchiveModel } from "@/model/AIChatMessageArchive.model";
import { AIChatArchiveEntryModel } from "@/model/AIChatArchiveEntry.model";
import { AIChatArchiveTurnModel } from "@/model/AIChatArchiveTurn.model";
import { AIChatArchiveSearchFragmentModel } from "@/model/AIChatArchiveSearchFragment.model";
import { AI_CHAT_RECOVERABLE_DEFAULTS } from "@/service/AIChatRecoverableDefaults";
import { codePointLength } from "@/service/AIChatArchiveTextUtil";
import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageMetadata } from "@/entityTypes/aiChatV2Types";
import type { ArchiveIndexState } from "@/entityTypes/aiChatArchiveTypes";
import type { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";

/** Persisted resume cursor for the indexer (opaque JSON in indexCursorJson). */
export interface IndexResumeCursor {
  readonly v: 1;
  readonly lastTimestampMs: number;
  readonly lastRowId: number;
}

/** Result of one backfill batch (or a full walk to completion). */
export interface IndexBatchResult {
  readonly conversationId: string;
  readonly rowsProjected: number;
  readonly hasMore: boolean;
  readonly indexState: ArchiveIndexState;
  readonly remaining: number;
}

/** Configurable batch size (defaults to the metadata page cap). */
export interface IndexOptions {
  readonly batchRows?: number;
  /** Max rows per full walk before yielding (background safety valve). */
  readonly maxRowsPerWalk?: number;
}

const DEFAULT_BATCH_ROWS = AI_CHAT_RECOVERABLE_DEFAULTS.metadataPageRows;
const DEFAULT_MAX_ROWS_PER_WALK = 4_096;

export class AIChatArchiveIndexer extends BaseModule {
  private readonly stateModel: AIChatArchiveStateModel;
  private readonly msgModel: AIChatMessageArchiveModel;
  private readonly entryModel: AIChatArchiveEntryModel;
  private readonly turnModel: AIChatArchiveTurnModel;
  private readonly fragModel: AIChatArchiveSearchFragmentModel;

  constructor() {
    super();
    this.stateModel = new AIChatArchiveStateModel(this.dbpath);
    this.msgModel = new AIChatMessageArchiveModel(this.dbpath);
    this.entryModel = new AIChatArchiveEntryModel(this.dbpath);
    this.turnModel = new AIChatArchiveTurnModel(this.dbpath);
    this.fragModel = new AIChatArchiveSearchFragmentModel(this.dbpath);
  }

  /**
   * Run ONE bounded backfill batch for a conversation. Reads source rows above
   * the persisted resume cursor, projects entries/turns/fragments, and
   * atomically advances the cursor + index state. Returns hasMore so the
   * caller (startup bootstrap or a scheduled tick) can loop or yield.
   *
   * Idempotent: re-projecting an already-indexed row is a safe upsert
   * overwrite (the unique keys are stable). A tombstoned conversation yields
   * {rowsProjected:0, hasMore:false, indexState:"absent"}.
   */
  async runBatch(
    conversationId: string,
    options: IndexOptions = {}
  ): Promise<IndexBatchResult> {
    await this.ensureConnection();
    const batchRows = options.batchRows ?? DEFAULT_BATCH_ROWS;

    const state = await this.stateModel.getState(conversationId);
    if (!state || state.deletedAt) {
      return {
        conversationId,
        rowsProjected: 0,
        hasMore: false,
        indexState: "absent",
        remaining: 0,
      };
    }
    const epoch = state.epoch;
    const revision = state.sourceRevision;

    // Decode the resume cursor (absent → start from (0, 0)).
    const cursor = decodeResumeCursor(state.indexCursorJson);
    const afterTimestampMs = cursor?.lastTimestampMs ?? 0;
    const afterRowId = cursor?.lastRowId ?? 0;

    // Transition to indexing on the first batch (absent/indexing/stale → indexing).
    if (state.indexState !== "indexing") {
      await this.stateModel.setIndexState(conversationId, "indexing");
    }

    const { rows, hasMore } = await this.msgModel.readBatchAboveCursor({
      conversationId,
      afterTimestampMs,
      afterRowId,
      batchRows,
    });

    if (rows.length === 0) {
      // No more rows: the index is complete. Persist the final cursor + state.
      await this.stateModel.updateIndexProgress(conversationId, {
        indexCursorJson: encodeResumeCursor(afterTimestampMs, afterRowId),
        highWaterTimestampMs: state.highWaterTimestampMs,
        highWaterRowId: state.highWaterRowId,
        indexState: "complete",
      });
      return {
        conversationId,
        rowsProjected: 0,
        hasMore: false,
        indexState: "complete",
        remaining: 0,
      };
    }

    // Track turn boundaries as we walk. A turn starts at the first user
    // message (or any message lacking a prior turn) and ends at the next
    // user-message start (legacy inference) or at a native turnId boundary.
    let currentTurnId = cursor?.lastTurnId ?? "";
    let turnStartTs = cursor?.turnStartTimestampMs ?? 0;
    let turnStartRowId = cursor?.turnStartRowId ?? 0;
    // The high-water mark advances to the end of the last COMPLETE turn.
    // We can only know a turn is complete once the next turn starts (or the
    // walk ends with no more rows). Track the last row processed so that on
    // a boundary we can close the previous turn at its actual last row.
    let prevRowTs = afterTimestampMs;
    let prevRowId = afterRowId;
    let lastCompleteTurnEndTs = state.highWaterTimestampMs;
    let lastCompleteTurnEndRowId = state.highWaterRowId;

    for (const row of rows) {
      const meta = parseRowMetadata(row.metadata);
      const nativeTurnId = meta?.turnId;

      // Detect a turn boundary: a native turnId change, OR (for legacy rows
      // with no turnId) a new user message after we already have an open turn.
      const isUserStart = row.role === "user";
      const hasOpenTurn = currentTurnId.length > 0;
      const boundary =
        (nativeTurnId !== undefined && nativeTurnId !== currentTurnId) ||
        (nativeTurnId === undefined && isUserStart && hasOpenTurn);

      if (boundary) {
        // The previous turn is now complete: close it at the previous row
        // (the last row that belonged to the closing turn).
        if (hasOpenTurn) {
          lastCompleteTurnEndTs = prevRowTs;
          lastCompleteTurnEndRowId = prevRowId;
          await this.turnModel.upsertTurn({
            conversationId,
            epoch,
            turnId: currentTurnId,
            firstTimestampMs: turnStartTs,
            firstRowId: turnStartRowId,
            lastTimestampMs: prevRowTs,
            lastRowId: prevRowId,
            status: "completed",
            confidence: nativeTurnId !== undefined ? "native" : "inferred",
          });
        }
        // Start a new turn.
        currentTurnId = nativeTurnId ?? inferTurnId(conversationId, row);
        turnStartTs = row.timestamp.getTime();
        turnStartRowId = row.id;
      } else if (!hasOpenTurn) {
        // First row of the conversation with no prior turn: open one.
        currentTurnId = nativeTurnId ?? inferTurnId(conversationId, row);
        turnStartTs = row.timestamp.getTime();
        turnStartRowId = row.id;
      }

      // Project the entry + search fragments for this row.
      await this.projectRow(row, epoch, revision, currentTurnId, meta);

      // Advance the previous-row cursor so the next boundary closes the
      // turn at this row (the last row that belonged to the closing turn).
      prevRowTs = row.timestamp.getTime();
      prevRowId = row.id;
    }

    // If the walk is complete (no more rows), close the final turn.
    if (!hasMore && currentTurnId.length > 0) {
      const lastRow = rows[rows.length - 1];
      lastCompleteTurnEndTs = lastRow.timestamp.getTime();
      lastCompleteTurnEndRowId = lastRow.id;
      await this.turnModel.upsertTurn({
        conversationId,
        epoch,
        turnId: currentTurnId,
        firstTimestampMs: turnStartTs,
        firstRowId: turnStartRowId,
        lastTimestampMs: lastRow.timestamp.getTime(),
        lastRowId: lastRow.id,
        status: "completed",
        confidence: rows.some(
          (r) => parseRowMetadata(r.metadata)?.turnId !== undefined
        )
          ? "native"
          : "inferred",
      });
    } else if (currentTurnId.length > 0) {
      // More rows remain: the current turn is still open (live). Persist it
      // as "open" so the coordinator's compactable-prefix query excludes it.
      const lastRow = rows[rows.length - 1];
      await this.turnModel.upsertTurn({
        conversationId,
        epoch,
        turnId: currentTurnId,
        firstTimestampMs: turnStartTs,
        firstRowId: turnStartRowId,
        lastTimestampMs: lastRow.timestamp.getTime(),
        lastRowId: lastRow.id,
        status: "open",
        confidence: rows.some(
          (r) => parseRowMetadata(r.metadata)?.turnId !== undefined
        )
          ? "native"
          : "inferred",
      });
    }

    const lastRow = rows[rows.length - 1];
    const nextTs = lastRow.timestamp.getTime();
    const nextRowId = lastRow.id;

    // Persist progress: advance the cursor + high-water, set index state.
    // The high-water only advances to the end of the last COMPLETE turn —
    // never into the live (open) turn (§4.3, §11.2).
    const newIndexState: ArchiveIndexState = hasMore ? "indexing" : "complete";
    await this.stateModel.updateIndexProgress(conversationId, {
      indexCursorJson: encodeResumeCursorWithTurn(
        nextTs,
        nextRowId,
        currentTurnId,
        turnStartTs,
        turnStartRowId
      ),
      highWaterTimestampMs: lastCompleteTurnEndTs,
      highWaterRowId: lastCompleteTurnEndRowId,
      indexState: newIndexState,
    });

    const remaining = hasMore
      ? await this.msgModel.countAboveCursor({
          conversationId,
          afterTimestampMs: nextTs,
          afterRowId: nextRowId,
        })
      : 0;

    return {
      conversationId,
      rowsProjected: rows.length,
      hasMore,
      indexState: newIndexState,
      remaining,
    };
  }

  /**
   * Walk a conversation to completion in bounded batches, yielding between
   * batches. Used by the startup bootstrap for lazy/background backfill.
   * Stops early if maxRowsPerWalk is reached (safety valve so a single
   * huge legacy conversation does not monopolize startup).
   */
  async runToCompletion(
    conversationId: string,
    options: IndexOptions = {}
  ): Promise<{ rowsProjected: number; complete: boolean; remaining: number }> {
    const maxRowsPerWalk = options.maxRowsPerWalk ?? DEFAULT_MAX_ROWS_PER_WALK;
    let totalProjected = 0;
    let result = await this.runBatch(conversationId, options);
    totalProjected += result.rowsProjected;
    while (result.hasMore && totalProjected < maxRowsPerWalk) {
      // Yield to the event loop between batches (§10.5: "Bounded pagination
      // ... must not block renderer interaction or hold long db transactions").
      await yieldToEventLoop();
      result = await this.runBatch(conversationId, options);
      totalProjected += result.rowsProjected;
    }
    return {
      rowsProjected: totalProjected,
      complete: !result.hasMore,
      remaining: result.remaining,
    };
  }

  /**
   * Mark an index stale when the source revision changes under it (§15.6:
   * "Revision changes invalidate/restart affected backfill work"). The next
   * runBatch re-walks from the cursor; the epoch is unchanged so existing
   * references remain resolvable until the re-walk completes.
   */
  async markStale(conversationId: string): Promise<void> {
    await this.ensureConnection();
    await this.stateModel.setIndexState(conversationId, "stale");
  }

  /**
   * Project one source row into an entry + search fragments. Tool-call and
   * tool-result rows get their toolCallId + paired row recorded for the
   * indexed getToolPair lookup (§5.2). The entry stores contentCodePointLength
   * so the packer can budget without re-reading full text.
   */
  private async projectRow(
    row: AIChatMessageEntity,
    epoch: string,
    revision: number,
    turnId: string,
    meta: ChatV2MessageMetadata | null
  ): Promise<void> {
    const contentLen = codePointLength(row.content ?? "");
    const toolCallId = meta?.toolCallId;

    // Resolve the paired tool row id (call↔result) if this is a tool message.
    // The forward walk projects a tool_call before its tool_result exists, so
    // when we reach the result we resolve forward (result→call) here AND
    // backfill the earlier call entry with the result's row id via a targeted
    // update (the call was upserted with pairedSourceRowId=undefined).
    let pairedSourceRowId: number | undefined;
    if (toolCallId && row.messageType) {
      const { callEntry, resultEntry } = await this.entryModel.findByToolCallId(
        row.conversationId,
        epoch,
        toolCallId
      );
      if (row.messageType === MessageType.TOOL_CALL && resultEntry) {
        pairedSourceRowId = resultEntry.sourceRowId;
      } else if (row.messageType === MessageType.TOOL_RESULT && callEntry) {
        pairedSourceRowId = callEntry.sourceRowId;
        // Backfill the call entry's backward link now that the result exists.
        await this.entryModel.setPairedSourceRowId(
          row.conversationId,
          epoch,
          callEntry.sourceRowId,
          row.id
        );
      }
    }

    await this.entryModel.upsertEntry({
      conversationId: row.conversationId,
      epoch,
      sourceRowId: row.id,
      timestampMs: row.timestamp.getTime(),
      sourceRevision: revision,
      turnId,
      messageType: row.messageType,
      toolCallId,
      pairedSourceRowId,
      contentCodePointLength: contentLen,
      messageId: row.messageId,
    });

    // Index the content for literal search (§5.6). Only "content" field for
    // text messages; tool receipts could be indexed separately but the first
    // version indexes content only (the search-fragment model supports a
    // "tool_receipt" field for a future enhancement).
    await this.fragModel.indexSourceContent(
      row.conversationId,
      row.id,
      "content",
      row.content ?? ""
    );
  }
}

// --- Helpers -----------------------------------------------------------------

function parseRowMetadata(
  raw: string | null | undefined
): ChatV2MessageMetadata | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as ChatV2MessageMetadata;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Infer a turnId for legacy rows that lack native turn metadata (§15: "legacy
 * rows ... backfill groups by ordered user-message boundaries"). The inferred
 * id is deterministic and stable across re-runs so upserts are idempotent.
 */
function inferTurnId(conversationId: string, row: AIChatMessageEntity): string {
  return `legacy:${conversationId}:${row.timestamp.getTime()}:${row.id}`;
}

function encodeResumeCursor(
  lastTimestampMs: number,
  lastRowId: number
): string {
  return JSON.stringify({
    v: 1,
    lastTimestampMs,
    lastRowId,
  } as IndexResumeCursor);
}

function encodeResumeCursorWithTurn(
  lastTimestampMs: number,
  lastRowId: number,
  lastTurnId: string,
  turnStartTimestampMs: number,
  turnStartRowId: number
): string {
  return JSON.stringify({
    v: 1,
    lastTimestampMs,
    lastRowId,
    lastTurnId,
    turnStartTimestampMs,
    turnStartRowId,
  });
}

interface IndexResumeCursorWithTurn extends IndexResumeCursor {
  readonly lastTurnId?: string;
  readonly turnStartTimestampMs?: number;
  readonly turnStartRowId?: number;
}

function decodeResumeCursor(
  raw: string | null | undefined
): IndexResumeCursorWithTurn | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const p = parsed as Record<string, unknown>;
      if (
        typeof p.lastTimestampMs === "number" &&
        typeof p.lastRowId === "number"
      ) {
        return {
          v: 1,
          lastTimestampMs: p.lastTimestampMs as number,
          lastRowId: p.lastRowId as number,
          lastTurnId:
            typeof p.lastTurnId === "string" ? p.lastTurnId : undefined,
          turnStartTimestampMs:
            typeof p.turnStartTimestampMs === "number"
              ? p.turnStartTimestampMs
              : undefined,
          turnStartRowId:
            typeof p.turnStartRowId === "number" ? p.turnStartRowId : undefined,
        };
      }
    }
  } catch {
    return null;
  }
  return null;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
