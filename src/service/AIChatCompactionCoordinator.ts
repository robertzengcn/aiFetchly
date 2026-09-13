/**
 * AIChatCompactionCoordinator — the single shared entry point for incremental
 * compaction (technical-design §11).
 *
 * `requestCompaction(conversationId, { trigger, model, summarize, signal })`:
 *
 *   1. Synchronously installs an in-process promise before the first awaited
 *      operation, so a second caller joins the same run (§11.1).
 *   2. Attempts a durable claim with fence/lease (§11.3).
 *   3. Snapshots the terminal-turn end key + retained suffix start.
 *   4. Packs bounded sections via AIChatSectionPacker, summarizes each via the
 *      injected `summarize` callback, validates via AIChatSummaryValidator,
 *      and saves section + checkpoint atomically (§11.4).
 *   5. Publishes a generation via CAS (§11.5).
 *   6. Background batches yield after 3 sections (§11.2).
 *
 * Does NOT hold a DB transaction or the turn mutex across AI calls. The
 * `summarize` callback is the only blocking AI contact; the coordinator
 * renews the lease before each call and supports cancellation via the
 * AbortSignal.
 */

import { BaseModule } from "@/modules/baseModule";
import { AIChatCompactionModule } from "@/modules/AIChatCompactionModule";
import { AIChatArchiveModule } from "@/modules/AIChatArchiveModule";
import { AIChatArchiveStateModel } from "@/model/AIChatArchiveState.model";
import { AIChatSectionPacker } from "@/service/AIChatSectionPacker";
import { AIChatSummaryValidator } from "@/service/AIChatSummaryValidator";
import { AIChatCompactionPromptBuilder } from "@/service/AIChatCompactionPromptBuilder";
import { AIChatRequestBudgetService } from "@/service/AIChatRequestBudgetService";
import { AI_CHAT_RECOVERABLE_DEFAULTS } from "@/service/AIChatRecoverableDefaults";
import {
  RecoverableHistoryError,
  type SectionSummaryV1,
} from "@/entityTypes/aiChatArchiveTypes";

/** A summarize callback: (systemPrompt, userPrompt) => raw JSON string. */
export type SummarizeFn = (
  systemPrompt: string,
  userPrompt: string
) => Promise<string>;

/** Optional constructor deps for the coordinator (opt-in pattern). */
export interface AIChatCompactionCoordinatorDeps {
  /**
   * A bound summarize callback delegating to the real AI provider. When set,
   * `requestCompactionForTurn` can trigger compaction without the caller
   * supplying a summarizer each time. Absent in tests / legacy wiring.
   */
  readonly summarize?: SummarizeFn;
}

/** Input to requestCompaction. */
export interface RequestCompactionInput {
  readonly trigger: "auto" | "manual" | "session-memory" | "reactive-overflow";
  readonly model?: string;
  readonly summarize: SummarizeFn;
  readonly signal?: AbortSignal;
  /** Source-token capacity per section (§8.3). Defaults to the section target. */
  readonly sourceCapacityTokens?: number;
  /** Max sections per background batch before yielding (§11.2). Default 3. */
  readonly maxSectionsPerBatch?: number;
}

/** Result of requestCompaction. */
export interface RequestCompactionResult {
  readonly state: "completed" | "paused" | "cancelled" | "failed" | "skipped";
  readonly generationId?: string;
  readonly sectionsPacked: number;
  readonly runId: string;
}

/** Status snapshot for getStatus. */
export interface CompactionStatusSnapshot {
  readonly state: string;
  readonly runId?: string;
  readonly generationId?: string;
}

interface InFlightRun {
  promise: Promise<RequestCompactionResult>;
  runId?: string;
}

export class AIChatCompactionCoordinator extends BaseModule {
  private readonly module: AIChatCompactionModule;
  private readonly archive: AIChatArchiveModule;
  private readonly packer: AIChatSectionPacker;
  private readonly validator: AIChatSummaryValidator;
  private readonly promptBuilder: AIChatCompactionPromptBuilder;
  private readonly budgetService: AIChatRequestBudgetService;
  /** Bound provider-backed summarizer, when injected via deps. */
  private readonly summarizeFn?: SummarizeFn;
  /** In-process promise per conversation (§11.1 dedup). */
  private readonly inFlight = new Map<string, InFlightRun>();

  constructor(deps?: AIChatCompactionCoordinatorDeps) {
    super();
    this.module = new AIChatCompactionModule();
    this.archive = new AIChatArchiveModule();
    this.packer = new AIChatSectionPacker();
    this.validator = new AIChatSummaryValidator();
    this.promptBuilder = new AIChatCompactionPromptBuilder();
    this.budgetService = new AIChatRequestBudgetService();
    this.summarizeFn = deps?.summarize;
  }

  /**
   * Convenience entry for the query engine's post-turn hook (§11). Uses the
   * injected summarize callback so the engine only supplies trigger + model.
   * No-op (resolves to a skipped result) when no summarizer was injected,
   * preserving the opt-in pattern for legacy / test wiring.
   */
  requestCompactionForTurn(
    conversationId: string,
    input: {
      readonly trigger: RequestCompactionInput["trigger"];
      readonly model?: string;
      readonly signal?: AbortSignal;
    }
  ): Promise<RequestCompactionResult> {
    if (!this.summarizeFn) {
      return Promise.resolve({
        state: "skipped" as const,
        sectionsPacked: 0,
        runId: "",
      });
    }
    return this.requestCompaction(conversationId, {
      trigger: input.trigger,
      model: input.model,
      summarize: this.summarizeFn,
      signal: input.signal,
    });
  }

  /**
   * The shared entry point. A second caller for the same conversation while a
   * run is in flight joins that run's promise (§11.1).
   */
  requestCompaction(
    conversationId: string,
    input: RequestCompactionInput
  ): Promise<RequestCompactionResult> {
    const existing = this.inFlight.get(conversationId);
    if (existing) {
      return existing.promise;
    }
    const promise = this.runCompaction(conversationId, input).finally(() => {
      this.inFlight.delete(conversationId);
    });
    this.inFlight.set(conversationId, { promise });
    return promise;
  }

  /** Status snapshot for a conversation (for the UI / IPC). */
  async getStatus(
    conversationId: string
  ): Promise<CompactionStatusSnapshot | null> {
    await this.ensureConnection();
    const state = await this.module.getState(conversationId);
    if (!state) return null;
    const run = await this.module.getActiveRun(conversationId);
    return {
      state: run?.state ?? "queued",
      runId: run?.runId,
      generationId: state.activeGenerationId,
    };
  }

  private async runCompaction(
    conversationId: string,
    input: RequestCompactionInput
  ): Promise<RequestCompactionResult> {
    await this.ensureConnection();
    const leaseOwner = `coordinator-${crypto.randomUUID()}`;
    const maxSectionsPerBatch =
      input.maxSectionsPerBatch ??
      AI_CHAT_RECOVERABLE_DEFAULTS.maxSectionsPerBackgroundBatch;
    const sourceCapacityTokens =
      input.sourceCapacityTokens ??
      AI_CHAT_RECOVERABLE_DEFAULTS.sectionSourceTargetTokens;

    // 1. Read archive state; reject tombstoned / unknown conversations.
    const stateModel = new AIChatArchiveStateModel(this.dbpath);
    const state = await stateModel.getState(conversationId);
    if (!state || state.deletedAt) {
      throw new RecoverableHistoryError(
        "COMPACTION_CONTEXT_REJECTED",
        `conversation ${conversationId} is tombstoned or has no archive state`
      );
    }
    const epoch = state.epoch;
    const revision = state.sourceRevision;

    // 2. Snapshot the terminal-turn end (high-water) + retained suffix start.
    // The retained suffix starts at the high-water mark (recent turns are
    // kept verbatim). The snapshot end is everything before it.
    const snapshotEndTimestampMs = state.highWaterTimestampMs || 0;
    const snapshotEndRowId = state.highWaterRowId || 0;
    // Retained suffix: keep the last N complete turns (§4.3). For the
    // snapshot, retained start = snapshot end (we compact everything strictly
    // before the high-water mark).
    const retainedStartTimestampMs = snapshotEndTimestampMs;
    const retainedStartRowId = snapshotEndRowId;

    // 3. Durable claim (§11.3).
    const claim = await this.module.claimRun({
      conversationId,
      epoch,
      revision,
      trigger: input.trigger,
      model: input.model,
      leaseOwner,
      snapshotEndTimestampMs,
      snapshotEndRowId,
      retainedStartTimestampMs,
      retainedStartRowId,
      baseGenerationId: state.activeGenerationId,
    });

    if (claim.joinedExisting) {
      // Another owner's run is active; return its status.
      return {
        state: "completed",
        runId: claim.runId,
        sectionsPacked: 0,
      };
    }

    let fence = claim.fence;
    const runId = claim.runId;
    let sectionsPacked = 0;
    let cursor: string | undefined = undefined;
    let ordinal = 0;
    let lastSummary: SectionSummaryV1 | null = null;
    let lastCoveredThroughTs = 0;
    let lastCoveredThroughRowId = 0;

    try {
      // 4. Pack + summarize sections, bounded by the batch budget.
      while (sectionsPacked < maxSectionsPerBatch) {
        // Cancellation check before each expensive operation.
        if (input.signal?.aborted) {
          await this.module.cancelRun({
            conversationId,
            runId,
            epoch,
            expectedFence: fence,
          });
          throw new RecoverableHistoryError(
            "COMPACTION_CONTEXT_REJECTED",
            "compaction cancelled by signal"
          );
        }

        // Renew the lease before the expensive pack + summarize (§11.3).
        const renewed = await this.module.renewLease({
          conversationId,
          runId,
          epoch,
          expectedFence: fence,
          leaseOwner,
        });
        if (!renewed) {
          // Run was completed/cancelled out from under us.
          break;
        }
        fence = renewed.fence;

        // Pack one section.
        const packResult = await this.packer.pack({
          conversationId,
          sourceCapacityTokens,
          endSnapshotTimestampMs: snapshotEndTimestampMs,
          endSnapshotRowId: snapshotEndRowId,
          startCursor: cursor,
        });

        if (
          packResult.fragments.length === 0 &&
          packResult.receipts.length === 0
        ) {
          // No more source to pack.
          break;
        }

        ordinal += 1;
        const sectionId = `sec-${runId}-${ordinal}`;
        const workKey = `${epoch}:${ordinal}:${packResult.fragments.length}`;
        const prompt = this.promptBuilder.buildSectionPrompt({
          fragments: packResult.fragments,
          receipts: packResult.receipts,
          sectionLabel: `section-${ordinal}`,
          priorSynopsis: lastSummary?.synopsis,
        });

        // Bounded provider timeout (§11.3).
        const summaryTimeoutMs =
          AI_CHAT_RECOVERABLE_DEFAULTS.providerTimeoutSeconds * 1000;
        const rawSummary = await this.callWithTimeout(
          input.summarize(prompt.systemPrompt, prompt.userPrompt),
          summaryTimeoutMs,
          input.signal
        );

        // Validate the summary locally (§10).
        const validSourceIds = new Set(prompt.suppliedSourceIds);
        const validation = this.validator.validate(
          this.safeJsonParse(rawSummary),
          validSourceIds
        );
        if (!validation.ok || !validation.summary) {
          throw new RecoverableHistoryError(
            "COMPACTION_OUTPUT_INVALID",
            `section ${ordinal} summary validation failed: ${validation.errors.join(
              "; "
            )}`
          );
        }
        lastSummary = validation.summary;

        // Determine the section's covered-through boundary.
        const lastFrag = packResult.fragments[packResult.fragments.length - 1];
        lastCoveredThroughTs =
          packResult.exclusionBoundary?.timestampMs ??
          (lastFrag ? Date.parse(lastFrag.timestamp) : 0);
        lastCoveredThroughRowId =
          packResult.exclusionBoundary?.rowId ??
          (lastFrag ? lastFrag.sourceRowId : 0);

        // Save section + checkpoint atomically (§11.4).
        const saved = await this.module.saveSectionAndCheckpoint({
          conversationId,
          runId,
          epoch,
          revision,
          expectedFence: fence,
          section: {
            sectionId,
            workKey,
            ordinal,
            sourceStartTimestampMs: 0,
            sourceStartRowId: 0,
            sourceEndTimestampMs: lastCoveredThroughTs,
            sourceEndRowId: lastCoveredThroughRowId,
            sourceManifestJson: JSON.stringify({
              fragments: packResult.fragments.map((f) => ({
                sourceId: f.sourceId,
                start: f.startCodePoint,
                end: f.endCodePoint,
              })),
            }),
            summaryJson: JSON.stringify(validation.summary),
            model: input.model,
          },
          stagedCursorJson: packResult.nextCursor ?? "",
        });
        fence = saved.fence;
        sectionsPacked += 1;
        cursor = packResult.nextCursor ?? undefined;

        // If coverage is complete and there's no continuation, we're done.
        if (packResult.coverageComplete && !packResult.nextCursor) {
          break;
        }
      }

      // 5. Publish a generation via CAS (§11.5).
      const generationId = `gen-${runId}`;
      const overviewJson = lastSummary
        ? JSON.stringify(lastSummary)
        : JSON.stringify({
            version: 1,
            synopsis: "",
            decisions: [],
            constraints: [],
            pending: [],
            toolOutcomes: [],
            topics: [],
          });

      const published = await this.module.publishGeneration({
        conversationId,
        runId,
        epoch,
        expectedFence: fence,
        generationId,
        parentGenerationId: state.activeGenerationId,
        representedSectionOrdinal: ordinal,
        coveredThroughTimestampMs: lastCoveredThroughTs,
        coveredThroughRowId: lastCoveredThroughRowId,
        overviewJson,
        model: input.model,
      });

      if (!published.published) {
        // CAS failed — another generation was published concurrently. Pause.
        await this.module.pauseRun({
          conversationId,
          runId,
          epoch,
          expectedFence: fence,
        });
        return {
          state: "paused",
          runId,
          sectionsPacked,
        };
      }

      return {
        state: "completed",
        generationId,
        sectionsPacked,
        runId,
      };
    } catch (error) {
      // Cancel the run on any error (§11.6).
      try {
        await this.module.cancelRun({
          conversationId,
          runId,
          epoch,
          expectedFence: fence,
        });
      } catch {
        // Best-effort cancellation; the original error is what matters.
      }
      if (error instanceof RecoverableHistoryError) throw error;
      throw new RecoverableHistoryError(
        "COMPACTION_CONTEXT_REJECTED",
        `compaction failed: ${(error as Error).message}`
      );
    }
  }

  /** Run a promise with a timeout + cancellation wrapper (§11.3). */
  private async callWithTimeout<T>(
    p: Promise<T>,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new RecoverableHistoryError(
              "COMPACTION_CONTEXT_REJECTED",
              `summarize timed out after ${timeoutMs}ms`
            )
          ),
        timeoutMs
      );
      p.then(
        (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        }
      );
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(
            new RecoverableHistoryError(
              "COMPACTION_CONTEXT_REJECTED",
              "compaction cancelled by signal"
            )
          );
        },
        { once: true }
      );
    });
  }

  /** Parse JSON safely; return null on failure (validator will reject). */
  private safeJsonParse(raw: string): unknown {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }

  /** Unused budgetService getter (kept for §8.3 capacity allocation wiring). */
  getBudgetService(): AIChatRequestBudgetService {
    return this.budgetService;
  }
}
