/**
 * AIChatArchiveRecoveryStartup — idempotent, non-blocking startup recovery for
 * the archive index (technical-design §15.5 + §15.6).
 *
 * On application startup (after SqliteDb is initialized), the recovery
 * bootstrap lists archive states whose index is not yet complete (absent /
 * indexing / stale) and resumes backfill for each conversation in bounded
 * batches. It is:
 *
 *   - Idempotent: re-running on every startup is safe. The indexer persists a
 *     resume cursor per batch, so a conversation that was already completed
 *     yields zero rows and is skipped. A crash mid-backfill resumes from the
 *     last fully-processed row on the next startup.
 *   - Non-blocking: the walk is fire-and-forget. It yields to the event loop
 *     between batches so renderer interaction is never blocked. A single huge
 *     legacy conversation is bounded by the per-walk safety cap; the remaining
 *     tail is left for the next scheduled tick or the next startup.
 *   - Flag-gated: only runs when archive reads are enabled (stage 1 of the
 *     staged rollout, §18). When the flag is off, the new code path is dormant
 *     and the legacy adapter continues to serve history unchanged.
 *
 * Tail replay (§15.6: "Ordinary append while backfill runs is tracked above
 * the captured index watermark; replay the new tail after the older
 * snapshot"): because the resume cursor is persisted per batch, a later
 * startup re-enters readBatchAboveCursor at the cursor and replays the new
 * tail. Revision changes (the coordinator bumps sourceRevision on
 * tombstone/clear) set indexState="stale"; the recovery bootstrap re-walks
 * stale conversations from their cursor (the epoch is unchanged unless the
 * conversation was tombstoned, in which case ensureState minted a fresh epoch
 * and the index starts absent again).
 *
 * No AI calls. No full-conversation in-memory load. Runs in the main process.
 */
import { BaseModule } from "@/modules/baseModule";
import { AIChatArchiveStateModel } from "@/model/AIChatArchiveState.model";
import { AIChatArchiveIndexer } from "@/service/AIChatArchiveIndexer";
import { AI_CHAT_RECOVERABLE_DEFAULTS } from "@/service/AIChatRecoverableDefaults";
import { isArchiveReadsEnabled } from "@/config/featureFlags";

/** Bounded sweep of incomplete indexes per startup invocation. */
const STARTUP_MAX_CONVERSATIONS = 50;

/**
 * Result of one recovery sweep. Used for telemetry/log lines; never includes
 * conversation content (§18: "Exclude source content").
 */
export interface RecoverySweepResult {
  readonly conversationsScanned: number;
  readonly conversationsCompleted: number;
  readonly rowsProjected: number;
  readonly flagEnabled: boolean;
}

export class AIChatArchiveRecoveryStartup extends BaseModule {
  private readonly stateModel: AIChatArchiveStateModel;
  private readonly indexer: AIChatArchiveIndexer;

  constructor() {
    super();
    this.stateModel = new AIChatArchiveStateModel(this.dbpath);
    this.indexer = new AIChatArchiveIndexer();
  }

  /**
   * Run one bounded recovery sweep: list incomplete archive states and resume
   * backfill for each. Fire-and-forget callers (startup) can ignore the
   * returned result; tests and telemetry consumers can await it.
   *
   * Returns immediately with a no-op result when the archive-reads flag is off
   * (the new code path is dormant) or the DB is not initialized.
   */
  async runRecoverySweep(): Promise<RecoverySweepResult> {
    if (!isArchiveReadsEnabled()) {
      return {
        conversationsScanned: 0,
        conversationsCompleted: 0,
        rowsProjected: 0,
        flagEnabled: false,
      };
    }

    try {
      await this.ensureConnection();
    } catch {
      // DB not ready: defer to the next startup/tick. Never throw out of the
      // bootstrap — a storage hiccup must not block app startup.
      return {
        conversationsScanned: 0,
        conversationsCompleted: 0,
        rowsProjected: 0,
        flagEnabled: true,
      };
    }

    const incomplete = await this.stateModel.listIncomplete(
      STARTUP_MAX_CONVERSATIONS
    );

    let completed = 0;
    let totalRows = 0;
    for (const state of incomplete) {
      try {
        const result = await this.indexer.runToCompletion(
          state.conversationId,
          {
            batchRows: AI_CHAT_RECOVERABLE_DEFAULTS.metadataPageRows,
          }
        );
        totalRows += result.rowsProjected;
        if (result.complete) completed++;
      } catch (err) {
        // One conversation's backfill failure must not abort the sweep. The
        // indexState stays at "indexing" (or "stale") so the next startup
        // resumes from the persisted cursor. Log and continue.
        this.logRecoveryError(state.conversationId, err);
      }
    }

    return {
      conversationsScanned: incomplete.length,
      conversationsCompleted: completed,
      rowsProjected: totalRows,
      flagEnabled: true,
    };
  }

  private logRecoveryError(conversationId: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    // Best-effort console log; the main process logger may not be wired in
    // unit-test contexts. Never includes conversation content.
    // eslint-disable-next-line no-console
    console.warn(
      `[archive-recovery] backfill failed for conversation ${conversationId}: ${message}`
    );
  }
}
