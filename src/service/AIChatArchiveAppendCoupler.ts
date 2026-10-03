/**
 * AIChatArchiveAppendCoupler — live-append coupling between the V2 message
 * save path and the archive index (technical-design §5.1 line 149: "Existing
 * message append and archive-state update must share one transaction for
 * newly enabled conversations"; §15.6 tail replay).
 *
 * The archive index is the source-of-truth for history search (§7.1) and the
 * high-water boundary the compaction coordinator snapshots (§11.2). Without a
 * state row, a live conversation is invisible to both. The coupler:
 *
 *   1. ensureState(conversationId) — idempotently mints the archive state row
 *      the first time a v2 conversation receives a message while archive reads
 *      are enabled. The state row is what listIncomplete/search/compaction read.
 *   2. markStale(conversationId) — when the index was complete, a new append
 *      is a tail above the cursor; mark stale so the next walk replays it
 *      (§15.6: "Ordinary append while backfill runs is tracked above the
 *      captured index watermark; replay the new tail").
 *   3. fire-and-forget runToCompletion — kick a bounded, yielding backfill so
 *      the index catches up without blocking the renderer. For a small turn
 *      this completes within one batch; for a huge legacy conversation the
 *      per-walk safety cap bounds the work and the next sweep finishes it.
 *
 * Flag-gated (stage 1, §18): when archive reads are off, the coupler is a
 * no-op so the legacy adapter serves history unchanged and no archive rows are
 * written. Fail-closed: an unreadable Token store keeps the coupler dormant.
 *
 * No AI calls. Runs in the main process. Never throws out of coupleAppend —
 * a storage hiccup must not break the chat save path; the next startup sweep
 * recovers.
 */
import { BaseModule } from "@/modules/baseModule";
import { AIChatArchiveStateModel } from "@/model/AIChatArchiveState.model";
import { AIChatArchiveIndexer } from "@/service/AIChatArchiveIndexer";
import { AI_CHAT_RECOVERABLE_DEFAULTS } from "@/service/AIChatRecoverableDefaults";
import { isArchiveReadsEnabled } from "@/config/featureFlags";
import type { ArchiveIndexState } from "@/entityTypes/aiChatArchiveTypes";

/** Outcome of one coupling call (telemetry/log; never includes content). */
export interface CoupleAppendResult {
  readonly coupled: boolean;
  readonly indexState: ArchiveIndexState | "absent";
}

export class AIChatArchiveAppendCoupler extends BaseModule {
  private readonly stateModel: AIChatArchiveStateModel;
  private readonly indexer: AIChatArchiveIndexer;

  constructor() {
    super();
    this.stateModel = new AIChatArchiveStateModel(this.dbpath);
    this.indexer = new AIChatArchiveIndexer();
  }

  /**
   * Couple a V2 message append to the archive index. Call AFTER the message
   * row is committed so the source-of-truth read sees it.
   *
   * Returns immediately with a no-op result when archive reads are disabled
   * (fail-closed) or the DB is not initialized. Never throws — logs and
   * defers to the next startup sweep on storage failure.
   */
  async coupleAppend(conversationId: string): Promise<CoupleAppendResult> {
    if (!isArchiveReadsEnabled()) {
      return { coupled: false, indexState: "absent" };
    }

    try {
      await this.ensureConnection();
    } catch {
      // DB not ready: defer to the next startup sweep. Never break the save.
      return { coupled: false, indexState: "absent" };
    }

    try {
      // 1. Idempotently mint the state row (§5.1 line 149). Returns the
      //    existing row if already present (no mutation).
      const state = await this.stateModel.ensureState(conversationId);

      // 2. Tail replay (§15.6): a complete index with a new append has rows
      //    above the cursor — mark stale so the next walk replays the tail.
      if (state.indexState === "complete") {
        await this.indexer.markStale(conversationId);
      }

      // 3. Fire-and-forget bounded catch-up. runToCompletion yields between
      //    batches so renderer interaction is never blocked. Errors are
      //    logged (the state stays stale/incomplete → next sweep resumes).
      void this.indexer
        .runToCompletion(conversationId, {
          batchRows: AI_CHAT_RECOVERABLE_DEFAULTS.metadataPageRows,
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          // eslint-disable-next-line no-console
          console.warn(
            `[archive-coupler] catch-up failed for ${conversationId}: ${msg}`
          );
        });

      return {
        coupled: true,
        indexState: state.indexState as ArchiveIndexState,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn(
        `[archive-coupler] couple failed for ${conversationId}: ${msg}`
      );
      return { coupled: false, indexState: "absent" };
    }
  }
}
