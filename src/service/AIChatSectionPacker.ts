/**
 * AIChatSectionPacker — bounded source-stream packing for incremental
 * compaction (technical-design §9).
 *
 * Obtains completed turns strictly after published/staged coverage and before
 * the frozen retained suffix. Reads metadata pages first (via the archive
 * Module's bounded readPage), then bounded source slices. Emits a
 * deterministic coverage manifest:
 *
 *   - Text fragments: role + opaque source reference + exact bounded text +
 *     exact `[start, end)` code-point offsets.
 *   - Tool receipts: tool-call ID, operation, status, bounded arguments/result
 *     summary, source references. An interrupted exchange (call with no paired
 *     result) is marked `interrupted`, never `successful`.
 *
 * The packer, not the model, owns the coverage ledger: fragments have
 * contiguous coverage with no omitted code points. An exclusion boundary is
 * published only when every representation in a complete terminal turn is
 * covered. Original source text is preserved during retries; reducing capacity
 * may split an unsaved fragment further (§9.2).
 */

import { BaseModule } from "@/modules/baseModule";
import { AIChatArchiveModule } from "@/modules/AIChatArchiveModule";
import {
  codePointLength,
  sliceByCodePoints,
} from "@/service/AIChatArchiveTextUtil";
import { encodeSourceId } from "@/service/AIChatArchiveCursorCodec";
import { AIChatArchiveStateModel } from "@/model/AIChatArchiveState.model";
import { AIChatMessageArchiveModel } from "@/model/AIChatMessageArchive.model";
import type { HistoryExcerpt } from "@/entityTypes/aiChatArchiveTypes";

/** A packed text fragment with exact code-point coverage. */
export interface PackedTextFragment {
  /** Opaque source ID encoding [start, end) for this fragment. */
  readonly sourceId: string;
  readonly messageId: string;
  readonly role: string;
  readonly timestamp: string;
  readonly text: string;
  readonly startCodePoint: number;
  readonly endCodePoint: number;
  /** True only for verified original text slices (§10). */
  readonly exact: boolean;
  /** Underlying archive row id (for the coverage ledger). */
  readonly sourceRowId: number;
}

/** A packed tool-exchange receipt. */
export interface PackedToolReceipt {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly status: "successful" | "error" | "interrupted";
  readonly argumentsSummary: string;
  readonly resultSummary: string;
  readonly sourceRowId: number;
}

/** The coverage manifest for one packed section. */
export interface SectionPackResult {
  readonly fragments: readonly PackedTextFragment[];
  readonly receipts: readonly PackedToolReceipt[];
  /** True when all eligible rows in the snapshot are fully covered. */
  readonly coverageComplete: boolean;
  /**
   * Published exclusion boundary (timestamp, rowId) once a complete terminal
   * turn is fully covered. Undefined while coverage is partial (§9.2).
   */
  readonly exclusionBoundary?:
    | { timestampMs: number; rowId: number }
    | undefined;
  /** Continuation cursor for the next section batch (null at end of stream). */
  readonly nextCursor: string | null;
  /** Source revision at pack time (for §4.2 invalidation). */
  readonly sourceRevision: number;
}

/** Input to a single pack operation. */
export interface SectionPackInput {
  readonly conversationId: string;
  /** Source-token capacity from the budget service (§8.3). */
  readonly sourceCapacityTokens: number;
  /** Snapshot end: rows strictly after this (timestamp, rowId) are retained. */
  readonly endSnapshotTimestampMs: number;
  readonly endSnapshotRowId: number;
  /** Continuation cursor from a prior partial pack (undefined for a fresh run). */
  readonly startCursor?: string;
}

/** Approx bytes-per-token for the conservative budget (mirrors §8.2). */
const BYTES_PER_TOKEN = 4;
/** Metadata rows per page (§9.3 — bounded). */
const METADATA_PAGE_ROWS = 64;

interface ToolCallMeta {
  id: string;
  name: string;
}

/** Parse tool_calls from a message's metadata JSON (if present). */
function parseToolCalls(metadata: string | null | undefined): ToolCallMeta[] {
  if (!metadata) return [];
  try {
    const parsed = JSON.parse(metadata) as unknown;
    if (typeof parsed !== "object" || parsed === null) return [];
    const calls = (parsed as { tool_calls?: unknown }).tool_calls;
    if (!Array.isArray(calls)) return [];
    const out: ToolCallMeta[] = [];
    for (const c of calls) {
      if (typeof c !== "object" || c === null) continue;
      const id = (c as { id?: unknown }).id;
      const fn = (c as { function?: { name?: unknown } }).function;
      if (typeof id === "string" && fn && typeof fn.name === "string") {
        out.push({ id, name: fn.name });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Find a split point at a paragraph/sentence boundary at or before the
 * preferred byte budget, falling back to a code-point boundary (§9.2).
 * Returns the code-point index at which to cut (exclusive end of the prefix).
 */
function findSplitPoint(text: string, maxCodePoints: number): number {
  const total = codePointLength(text);
  if (total <= maxCodePoints) return total;
  // Prefer paragraph break, then sentence break, within the budget window.
  const window = sliceByCodePoints(text, 0, maxCodePoints);
  let cut = -1;
  const para = window.lastIndexOf("\n\n");
  if (para >= 0) cut = para;
  if (cut < 0) {
    const sentence = Math.max(
      window.lastIndexOf(". "),
      window.lastIndexOf("! "),
      window.lastIndexOf("? ")
    );
    if (sentence >= 0) cut = sentence + 2;
  }
  if (cut < 0) {
    const newline = window.lastIndexOf("\n");
    if (newline >= 0) cut = newline + 1;
  }
  if (cut < 0) {
    // Fall back to a hard code-point boundary (never split a surrogate pair).
    cut = maxCodePoints;
  }
  return Math.max(1, Math.min(cut, maxCodePoints));
}

/**
 * Pack a sequence of message excerpts into bounded text fragments + tool
 * receipts, owning the coverage ledger. Pure: no DB access; reads excerpts via
 * the injected archive Module.
 */
function packExcerpts(
  excerpts: readonly HistoryExcerpt[],
  messages: ReadonlyMap<number, { metadata?: string | null; content: string }>,
  epoch: string,
  revision: number,
  maxCodePoints: number
): { fragments: PackedTextFragment[]; receipts: PackedToolReceipt[] } {
  const fragments: PackedTextFragment[] = [];
  const receipts: PackedToolReceipt[] = [];

  for (const ex of excerpts) {
    // Derive rowId from the source ID's payload (the excerpt encodes [0, len)).
    // The toExcerpt helper stamps endCodePoint = content length, so the
    // excerpt text is the full message content.
    const rowId = parseRowIdFromSourceId(ex.sourceId);
    const meta = rowId >= 0 ? messages.get(rowId) : undefined;
    const toolCalls = parseToolCalls(meta?.metadata);

    if (
      toolCalls.length > 0 &&
      (ex.text.length === 0 || ex.text.trim() === "")
    ) {
      // Pure tool-call row → emit a receipt, no text fragment.
      for (const tc of toolCalls) {
        // Status is interrupted unless we find a paired result later; the
        // coordinator's save transaction reconciles final status. Here, with
        // only the call row visible and no result, the exchange is interrupted.
        receipts.push({
          toolCallId: tc.id,
          toolName: tc.name,
          status: "interrupted",
          argumentsSummary: "",
          resultSummary: "",
          sourceRowId: rowId >= 0 ? rowId : 0,
        });
      }
      continue;
    }

    // Text content: split into contiguous fragments within the budget.
    const totalCp = codePointLength(ex.text);
    let start = 0;
    while (start < totalCp) {
      const slice = sliceByCodePoints(
        ex.text,
        start,
        Math.min(start + maxCodePoints, totalCp)
      );
      const end = start + findSplitPoint(slice, maxCodePoints);
      const fragText = sliceByCodePoints(ex.text, start, end);
      fragments.push({
        sourceId: encodeSourceId({
          v: 1,
          epoch,
          revision,
          rowId: rowId >= 0 ? rowId : 0,
          field: "content",
          startCodePoint: start,
          endCodePoint: end,
        }),
        messageId: ex.messageId,
        role: ex.role,
        timestamp: ex.timestamp,
        text: fragText,
        startCodePoint: start,
        endCodePoint: end,
        exact: true,
        sourceRowId: rowId >= 0 ? rowId : 0,
      });
      start = end;
    }
  }
  return { fragments, receipts };
}

/** Best-effort rowId decode from an opaque source ID (no epoch check). */
function parseRowIdFromSourceId(sourceId: string): number {
  try {
    const decoded = JSON.parse(
      Buffer.from(sourceId, "base64").toString("utf8")
    ) as unknown;
    if (
      typeof decoded === "object" &&
      decoded !== null &&
      typeof (decoded as { rowId?: unknown }).rowId === "number"
    ) {
      return (decoded as { rowId: number }).rowId;
    }
  } catch {
    // Not a JSON-base64 source id; fall through.
  }
  return -1;
}

export class AIChatSectionPacker extends BaseModule {
  private readonly archive: AIChatArchiveModule;

  constructor() {
    super();
    // AIChatArchiveModule extends BaseModule and reads the same Token dbpath
    // in its own constructor, so both share the resolved path.
    this.archive = new AIChatArchiveModule();
  }

  /**
   * Pack one bounded section of source. Reads metadata pages first, then
   * bounded source slices, emits a deterministic coverage manifest, and
   * publishes an exclusion boundary only when a complete terminal turn is
   * fully covered (§9.2).
   */
  async pack(input: SectionPackInput): Promise<SectionPackResult> {
    await this.ensureConnection();

    const stateModel = new AIChatArchiveStateModel(this.dbpath);
    const state = await stateModel.getState(input.conversationId);
    if (!state || state.deletedAt) {
      return {
        fragments: [],
        receipts: [],
        coverageComplete: false,
        nextCursor: null,
        sourceRevision: 0,
      };
    }

    const epoch = state.epoch;
    const revision = state.sourceRevision;

    // Convert the token budget to a conservative code-point budget (§8.2 —
    // UTF-8 bytes, ~4 bytes/token). Round down to stay within budget.
    const maxCodePoints = Math.max(
      64,
      Math.floor((input.sourceCapacityTokens * BYTES_PER_TOKEN) / 1)
    );

    // Read a metadata page of excerpts up to the snapshot end. The archive
    // Module's readPage already bounds by rows + decoded-text allowance and
    // returns excerpts with encoded source IDs.
    const page = await this.archive.readPage({
      conversationId: input.conversationId,
      cursor: input.startCursor,
      maxRows: METADATA_PAGE_ROWS,
      maxCodePoints,
    });

    // Filter to rows strictly before the retained suffix (snapshot end).
    // When endSnapshotTimestampMs is 0, there is no retained suffix — keep all.
    const hasSnapshotEnd = input.endSnapshotTimestampMs > 0;
    const eligible = page.records.filter((r) => {
      const ts = Date.parse(r.timestamp);
      if (Number.isNaN(ts)) return false;
      if (!hasSnapshotEnd) return true;
      if (ts >= input.endSnapshotTimestampMs) return false;
      // Within the same timestamp, retain rows at/after the snapshot rowId.
      if (ts === input.endSnapshotTimestampMs && input.endSnapshotRowId > 0) {
        const rowId = parseRowIdFromSourceId(r.sourceId);
        if (rowId >= input.endSnapshotRowId) return false;
      }
      return true;
    });

    // Load metadata for each eligible row (for tool-call detection).
    const msgModel = new AIChatMessageArchiveModel(this.dbpath);
    const messages = new Map<
      number,
      { metadata?: string | null; content: string }
    >();
    for (const ex of eligible) {
      const rowId = parseRowIdFromSourceId(ex.sourceId);
      if (rowId < 0) continue;
      // Conversation-scoped: a forged source ID must never pull another
      // conversation's row into this section's coverage (AC-12).
      const msg = await msgModel.readMessageInConversation(
        input.conversationId,
        rowId
      );
      if (msg) {
        messages.set(rowId, {
          metadata: msg.metadata,
          content: msg.content ?? "",
        });
      }
    }

    // Pack fragments + receipts within the per-message code-point budget.
    // Each message is bounded individually so one oversized message can't
    // starve the rest (§9.2 — an oversized turn spans multiple sections).
    const perMessageBudget = Math.max(64, maxCodePoints);
    const { fragments, receipts } = packExcerpts(
      eligible,
      messages,
      epoch,
      revision,
      perMessageBudget
    );

    // Coverage is complete only when we consumed the whole page with no
    // truncation AND there is no continuation (all eligible rows covered).
    const noTruncation = !page.truncated && page.nextCursor === null;
    // Even with no continuation cursor, partial splits within messages mean
    // coverage is complete only if every fragment ended at its message end.
    // Heuristic: coverage complete when the page wasn't truncated and every
    // eligible message produced fragments ending at their full code-point
    // length (no mid-message split was forced by the budget).
    const allMessagesFullyCovered = eligible.every((ex) => {
      const total = codePointLength(ex.text);
      const frags = fragments.filter((f) => f.messageId === ex.messageId);
      if (frags.length === 0) return true; // tool-only row → covered by receipt
      return frags[frags.length - 1].endCodePoint === total;
    });
    const coverageComplete = noTruncation && allMessagesFullyCovered;

    // Publish an exclusion boundary only when coverage is complete for the
    // terminal turn in this batch (§9.2).
    let exclusionBoundary: { timestampMs: number; rowId: number } | undefined;
    if (coverageComplete && fragments.length > 0) {
      const last = fragments[fragments.length - 1];
      const ts = Date.parse(last.timestamp);
      if (!Number.isNaN(ts)) {
        exclusionBoundary = {
          timestampMs: ts,
          rowId: last.sourceRowId,
        };
      }
    }

    return {
      fragments,
      receipts,
      coverageComplete,
      exclusionBoundary,
      nextCursor: page.nextCursor,
      sourceRevision: revision,
    };
  }
}
