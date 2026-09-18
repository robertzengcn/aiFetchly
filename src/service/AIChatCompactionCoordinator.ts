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

import { createHash } from "node:crypto";
import { BaseModule } from "@/modules/baseModule";
import { AIChatCompactionModule } from "@/modules/AIChatCompactionModule";
import { AIChatArchiveModule } from "@/modules/AIChatArchiveModule";
import { AIChatArchiveStateModel } from "@/model/AIChatArchiveState.model";
import { AIChatArchiveTurnModel } from "@/model/AIChatArchiveTurn.model";
import { AIChatSectionPacker } from "@/service/AIChatSectionPacker";
import type {
  PackedTextFragment,
  PackedToolReceipt,
} from "@/service/AIChatSectionPacker";
import { AIChatSummaryValidator } from "@/service/AIChatSummaryValidator";
import { AIChatCompactionPromptBuilder } from "@/service/AIChatCompactionPromptBuilder";
import { AIChatRequestBudgetService } from "@/service/AIChatRequestBudgetService";
import { encodeCursor, decodeCursor } from "@/service/AIChatArchiveCursorCodec";
import { AI_CHAT_RECOVERABLE_DEFAULTS } from "@/service/AIChatRecoverableDefaults";
import {
  RecoverableHistoryError,
  type SectionSummaryV1,
} from "@/entityTypes/aiChatArchiveTypes";

/** A summarize callback: (systemPrompt, userPrompt) => raw JSON string. */
export type SummarizeFn = (
  systemPrompt: string,
  userPrompt: string,
  model?: string
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
  readonly state:
    | "completed"
    | "paused"
    | "cancelled"
    | "failed"
    | "skipped"
    | "joined";
  readonly generationId?: string;
  readonly sectionsPacked: number;
  readonly runId: string;
}

/** Status snapshot for getStatus. */
export interface CompactionStatusSnapshot {
  readonly state: string;
  readonly runId?: string;
  readonly generationId?: string;
  readonly sectionsPacked?: number;
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
    const promise = this.runCompaction(conversationId, {
      ...input,
      summarize: (systemPrompt, userPrompt): Promise<string> =>
        input.summarize(systemPrompt, userPrompt, input.model),
    }).finally(() => {
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
    let sourceCapacityTokens =
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

    // 2. Terminal-turn snapshot excluding the retained recent suffix (§4.3,
    // FR-05/FR-09). Retain two completed turns when they fit plus the
    // in-progress turn; the snapshot end is the retained suffix start, never
    // the raw high-water mark. Snapshot is frozen at the durable claim
    // (P2-1, §11.3): compute optimistically, claim, then recompute and take
    // the earlier composite bound so messages appended between compute and
    // claim cannot slip inside the compactable prefix past the retention
    // boundary.
    const preSnapshot = await this.computeSnapshotEnd(
      conversationId,
      state.highWaterTimestampMs ?? 0,
      state.highWaterRowId ?? 0
    );
    const retainedStartTimestampMs = preSnapshot.snapshotEndTimestampMs;
    const retainedStartRowId = preSnapshot.snapshotEndRowId;

    // 3. Durable claim (§11.3).
    const claim = await this.module.claimRun({
      conversationId,
      epoch,
      revision,
      trigger: input.trigger,
      model: input.model,
      leaseOwner,
      snapshotEndTimestampMs: preSnapshot.snapshotEndTimestampMs,
      snapshotEndRowId: preSnapshot.snapshotEndRowId,
      retainedStartTimestampMs,
      retainedStartRowId,
      baseGenerationId: state.activeGenerationId,
    });

    if (claim.joinedExisting) {
      // Another owner's run is active — join it (COMPACTION_BUSY), never
      // report completed for work we did not do (AC-08, §11.2 states).
      return {
        state: "joined",
        runId: claim.runId,
        sectionsPacked: 0,
      };
    }

    let fence = claim.fence;
    const runId = claim.runId;
    const postSnapshot = await this.computeSnapshotEnd(
      conversationId,
      state.highWaterTimestampMs ?? 0,
      state.highWaterRowId ?? 0
    );
    const snapshotEndTimestampMs =
      postSnapshot.snapshotEndTimestampMs < preSnapshot.snapshotEndTimestampMs ||
      (postSnapshot.snapshotEndTimestampMs === preSnapshot.snapshotEndTimestampMs &&
        postSnapshot.snapshotEndRowId < preSnapshot.snapshotEndRowId)
        ? postSnapshot.snapshotEndTimestampMs
        : preSnapshot.snapshotEndTimestampMs;
    const snapshotEndRowId =
      postSnapshot.snapshotEndTimestampMs < preSnapshot.snapshotEndTimestampMs ||
      (postSnapshot.snapshotEndTimestampMs === preSnapshot.snapshotEndTimestampMs &&
        postSnapshot.snapshotEndRowId < preSnapshot.snapshotEndRowId)
        ? postSnapshot.snapshotEndRowId
        : preSnapshot.snapshotEndRowId;

    // 4. Resume from committed coverage + persisted staged checkpoints (§11,
    // FR-07/FR-09, AC-05/AC-07). Load existing sections for this epoch/
    // revision and the prior published overview so a restart reuses saved
    // sections without duplicate coverage and a new turn processes only new
    // sources.
    const resume = await this.loadResumeState(
      conversationId,
      epoch,
      revision,
      state.activeGenerationId
    );
    let cursor: string | undefined = resume.startCursor;
    let ordinal = resume.maxOrdinal;
    let mergedOrdinal = resume.mergedThroughOrdinal;
    let rollingOverview: SectionSummaryV1 | null = resume.priorOverview;
    // Ordered summaries of sections represented by the rolling overview
    // (prior published chain + newly merged), for final validation.
    let representedCount = resume.priorRepresentedCount;
    let sectionsPacked = 0;
    let lastCoveredThroughTs = resume.coveredThroughTs;
    let lastCoveredThroughRowId = resume.coveredThroughRowId;
    let sectionStartTs = resume.coveredThroughTs;
    let sectionStartRowId = resume.coveredThroughRowId;
    // Source IDs already represented (for overview reference chain + proving
    // no resend of committed raw sections in normal incremental work).
    const representedSourceIds = new Set<string>(resume.representedSourceIds);

    try {
      // 5. Pack + summarize sections, bounded by the batch budget.
      let yielded = false;
      while (sectionsPacked < maxSectionsPerBatch) {
        // Cancellation check before each expensive operation.
        if (input.signal?.aborted) {
          await this.module.cancelRun({
            conversationId,
            runId,
            epoch,
            expectedFence: fence,
          });
          return { state: "cancelled", runId, sectionsPacked };
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

        // Pack one section with the §8.3 capacity allocated BEFORE packing:
        // sourceCapacity = min(capacity, C − Osection − M − promptOverhead −
        // stateInputCost). Allocating first keeps small-window models from
        // burning reduction retries on oversized packs and caps the prompt
        // overhead to the conservative scaffold estimate + rolling overview.
        const preflight = this.budgetService.allocateSectionCapacity({
          model: input.model,
          sectionOutputReserve:
            AI_CHAT_RECOVERABLE_DEFAULTS.sectionOutputCapTokens,
          promptOverhead: this.estimateSectionPromptOverheadTokens(
            rollingOverview
          ),
          stateInputCost: 0,
        });
        if (preflight.errorCode) {
          throw new RecoverableHistoryError(
            "COMPACTION_CONTEXT_REJECTED",
            `section for model ${input.model ?? "unknown"} has no source capacity (context ${preflight.sourceCapacity})`
          );
        }
        sourceCapacityTokens = Math.min(
          sourceCapacityTokens,
          preflight.sourceCapacity
        );
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

        // Determine the section's fragment extent vs the compactable
        // checkpoint (P1-1, FR-05/FR-07/AC-06). The section manifest always
        // records the actual packed fragments; the checkpoint advances ONLY to
        // the packer's exclusionBoundary (complete terminal turn). When the
        // boundary is absent (mid-turn cut, truncated page, oversized fragment
        // without terminal completion), staged progress is kept without
        // advancing the published/compactable checkpoint.
        const hasBoundary = packResult.exclusionBoundary !== undefined;
        const coveredThroughTs = hasBoundary
          ? packResult.exclusionBoundary.timestampMs
          : sectionStartTs;
        const coveredThroughRowId = hasBoundary
          ? packResult.exclusionBoundary.rowId
          : sectionStartRowId;

        // Deterministic work identity (§11, FR-09): epoch/revision, source
        // range + fragments, schema version. Retry of a saved section reuses
        // it instead of duplicating coverage.
        const workKey = this.computeWorkKey({
          epoch,
          revision,
          startTs: sectionStartTs,
          startRowId: sectionStartRowId,
          endTs: coveredThroughTs,
          endRowId: coveredThroughRowId,
          fragments: packResult.fragments,
          receipts: packResult.receipts,
        });

        // Reuse check: an identical saved section (same workKey) from this or
        // a prior run is reused without another model call.
        const reused = resume.sectionsByWorkKey.get(workKey);
        if (reused) {
          const reuseParsed = this.safeJsonParse(reused.summaryJson);
          const reuseValid = this.validator.validate(
            reuseParsed,
            new Set(
              packResult.fragments.map((f) => f.sourceId)
            ),
            AI_CHAT_RECOVERABLE_DEFAULTS.sectionOutputCapTokens
          );
          if (reuseValid.ok && reuseValid.summary) {
            cursor = packResult.nextCursor ?? undefined;
            ordinal = Math.max(ordinal, reused.ordinal);
            const reusePrior = rollingOverview;
            const reuseMerged = await this.mergeOverview({
              prior: reusePrior,
              section: reuseValid.summary,
              summarize: input.summarize,
              signal: input.signal,
            });
            const reuseSucceeded = reusePrior === null || reuseMerged !== reusePrior;
            rollingOverview = reuseMerged;
            for (const f of packResult.fragments) {
              representedSourceIds.add(f.sourceId);
            }
            if (reuseSucceeded) {
              representedCount += 1;
              mergedOrdinal = Math.max(mergedOrdinal, reused.ordinal);
            }
            lastCoveredThroughTs = coveredThroughTs;
            lastCoveredThroughRowId = coveredThroughRowId;
            sectionStartTs = coveredThroughTs;
            sectionStartRowId = coveredThroughRowId;
            sectionsPacked += 1;
            if (packResult.coverageComplete && !packResult.nextCursor) {
              break;
            }
            continue;
          }
          // Saved section failed revalidation — fall through and rebuild it
          // with the same bounded algorithm (explicit repair path).
        }

        const nextOrdinal = ordinal + 1;
        const sectionId = `sec-${runId}-${nextOrdinal}`;
        const prompt = this.promptBuilder.buildSectionPrompt({
          fragments: packResult.fragments,
          receipts: packResult.receipts,
          sectionLabel: `section-${nextOrdinal}`,
          priorSynopsis: rollingOverview?.synopsis,
        });

        // §8.3: capacity was allocated BEFORE pack (above); the packer bounds
        // source + framing to sourceCapacityTokens, so the serialized prompt
        // is Osection + overhead + margin ≤ C by construction.

        // Bounded model attempts per section per run (§16): at most 4 total,
        // including ≤2 source-size reductions and ≤1 structured-output repair.
        // No all-history fallback on exhaustion.
        const sectionSummary = await this.summarizeSectionBounded({
          prompt,
          summarize: input.summarize,
          signal: input.signal,
          timeoutMs:
            AI_CHAT_RECOVERABLE_DEFAULTS.providerTimeoutSeconds * 1000,
          onReduceCapacity: (reduced) => {
            sourceCapacityTokens = reduced;
          },
          getCapacity: () => sourceCapacityTokens,
        });

        // Save section + checkpoint atomically (§11.4) with accurate range
        // boundaries (never zero-stamped).
        const saved = await this.module.saveSectionAndCheckpoint({
          conversationId,
          runId,
          epoch,
          revision,
          expectedFence: fence,
          section: {
            sectionId,
            workKey,
            ordinal: nextOrdinal,
            sourceStartTimestampMs: sectionStartTs,
            sourceStartRowId: sectionStartRowId,
            sourceEndTimestampMs: coveredThroughTs,
            sourceEndRowId: coveredThroughRowId,
            sourceManifestJson: JSON.stringify({
              fragments: packResult.fragments.map((f) => ({
                sourceId: f.sourceId,
                start: f.startCodePoint,
                end: f.endCodePoint,
              })),
            }),
            summaryJson: JSON.stringify(sectionSummary),
            model: input.model,
          },
          stagedCursorJson: packResult.nextCursor ?? "",
        });
        fence = saved.fence;
        ordinal = nextOrdinal;
        sectionsPacked += 1;
        cursor = packResult.nextCursor ?? undefined;

        // Bounded overview merge: prior overview + this new section only
        // (never concatenate every historical section — §8.3). Persist the
        // working overview + merged ordinal so a restart resumes the merge
        // instead of rebuilding it (§5.3). On merge failure the counters must
        // NOT advance (P2-3, FR-07/AC-14): the section stays staged without
        // being reflected in the rolling overview.
        const mergePrior = rollingOverview;
        const merged = await this.mergeOverview({
          prior: mergePrior,
          section: sectionSummary,
          summarize: input.summarize,
          signal: input.signal,
        });
        const mergeSucceeded = mergePrior === null || merged !== mergePrior;
        rollingOverview = merged;
        for (const f of packResult.fragments) {
          representedSourceIds.add(f.sourceId);
        }
        lastCoveredThroughTs = coveredThroughTs;
        lastCoveredThroughRowId = coveredThroughRowId;
        sectionStartTs = coveredThroughTs;
        sectionStartRowId = coveredThroughRowId;
        if (mergeSucceeded) {
          representedCount += 1;
          mergedOrdinal = ordinal;
          await this.module.saveWorkingOverview({
            conversationId,
            runId,
            epoch,
            expectedFence: fence,
            workingOverviewJson: JSON.stringify(rollingOverview),
            mergedThroughOrdinal: ordinal,
            stagedCursorJson: packResult.nextCursor ?? "",
          });
        }

        // If coverage is complete and there's no continuation, we're done.
        if (packResult.coverageComplete && !packResult.nextCursor) {
          break;
        }
        if (sectionsPacked >= maxSectionsPerBatch) {
          yielded = true;
          break;
        }
      }

      // 6. Yield resumably at the batch limit (§11.2, AC-04/AC-07): when a
      // continuation remains, pause — never report completed prematurely.
      // The staged cursor + working overview are already persisted above.
      const continuationRemains = cursor !== undefined && cursor !== "";
      if (yielded && continuationRemains) {
        await this.module.pauseRun({
          conversationId,
          runId,
          epoch,
          expectedFence: fence,
        });
        return { state: "paused", runId, sectionsPacked };
      }

      if (sectionsPacked === 0 && representedCount === resume.priorRepresentedCount) {
        // Nothing new was packed and no prior coverage to publish — the
        // eligible snapshot is empty (e.g. everything is retained recent
        // context). Complete without publication rather than reporting a
        // misleading pause with no continuation.
        await this.module.completeRun({
          conversationId,
          runId,
          epoch,
          expectedFence: fence,
        });
        return { state: "completed", runId, sectionsPacked };
      }

      // 7. Publish a generation via CAS (§11.5) with the validated cumulative
      // overview (prior overview + consecutive new sections). Preserve the
      // prior active generation when synthesis or publication fails.
      if (!rollingOverview) {
        await this.module.pauseRun({
          conversationId,
          runId,
          epoch,
          expectedFence: fence,
        });
        return { state: "paused", runId, sectionsPacked };
      }
      const generationId = `gen-${runId}`;
      const overviewJson = JSON.stringify(rollingOverview);
      const continuationStateJson = this.buildContinuationState(
        rollingOverview,
        representedSourceIds
      );

      const published = await this.module.publishGeneration({
        conversationId,
        runId,
        epoch,
        expectedFence: fence,
        generationId,
        parentGenerationId: state.activeGenerationId,
        representedSectionOrdinal: mergedOrdinal,
        coveredThroughTimestampMs: lastCoveredThroughTs,
        coveredThroughRowId: lastCoveredThroughRowId,
        overviewJson,
        continuationStateJson,
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
      // Cancel the run on any error (§11.6), preserving committed work and
      // the last valid active generation.
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

  /**
   * Terminal-turn snapshot excluding the retained recent suffix (§4.3, FR-05).
   * Retains two completed turns when they fit plus the in-progress turn, with
   * tool exchanges. Reads authoritative turn projections directly — the
   * retained suffix starts at the earliest retained turn's first
   * (timestamp, rowId), never approximated from decoded excerpt source IDs.
   * Falls back to the high-water mark only when no turn projections exist yet.
   */
  private async computeSnapshotEnd(
    conversationId: string,
    highWaterTs: number,
    highWaterRowId: number
  ): Promise<{ snapshotEndTimestampMs: number; snapshotEndRowId: number }> {
    const fallback = {
      snapshotEndTimestampMs: highWaterTs,
      snapshotEndRowId: highWaterRowId,
    };
    try {
      const state = await this.module.getState(conversationId);
      if (!state) return fallback;
      const turnModel = new AIChatArchiveTurnModel(this.dbpath);
      const turns = await turnModel.readRecentCompleteTurns(
        conversationId,
        state.epoch,
        AI_CHAT_RECOVERABLE_DEFAULTS.minRetainedCompleteTurns,
        AI_CHAT_RECOVERABLE_DEFAULTS.minRetainedCompleteTurns + 1
      );
      if (turns.length === 0) return fallback;
      // Turn-count retention (FR-05): the retained suffix starts at the
      // earliest of the newest minRetainedCompleteTurns complete turns. This
      // intentionally differs from the assembler's token-budgeted verbatim
      // window (P2-15 ruling): compacted turns remain available via the
      // published overview + archive reads, while the assembler keeps up to
      // its token budget verbatim in context. Extending compaction retention
      // to the full token budget would make AC-01's five-turn conversation a
      // correct no-op and stall incremental coverage.
      // Turns are chronological; the retained suffix starts at the earliest
      // retained turn's first row. The live turn is excluded upstream
      // (readRecentCompleteTurns only returns completed turns).
      const earliest = turns[0];
      const earliestTs = Number(earliest.firstTimestampMs);
      const earliestRowId = earliest.firstRowId;
      if (!Number.isFinite(earliestTs) || earliestRowId <= 0) return fallback;
      // Snapshot end is the last packed row: step back one rowId at the
      // same timestamp, or to (ts-1ms, MAX) when rowId is 1. The packer
      // uses an inclusive composite bound, so rows at (earliestTs,
      // earliestRowId) and after stay in the retained suffix (AC-09).
      if (earliestRowId > 1) {
        return {
          snapshotEndTimestampMs: earliestTs,
          snapshotEndRowId: earliestRowId - 1,
        };
      }
      return {
        snapshotEndTimestampMs: earliestTs - 1,
        snapshotEndRowId: Number.MAX_SAFE_INTEGER,
      };
    } catch {
      return fallback;
    }
  }

  /**
   * Load committed coverage + staged checkpoints + prior overview (§11, AC-05,
   * AC-07). Returns the resume cursor, max ordinal, prior overview, and a
   * workKey→section map for duplicate-free reuse.
   */
  private async loadResumeState(
    conversationId: string,
    epoch: string,
    revision: number,
    activeGenerationId: string | undefined
  ): Promise<{
    startCursor?: string;
    maxOrdinal: number;
    mergedThroughOrdinal: number;
    priorOverview: SectionSummaryV1 | null;
    priorRepresentedCount: number;
    coveredThroughTs: number;
    coveredThroughRowId: number;
    representedSourceIds: string[];
    sectionsByWorkKey: Map<string, { ordinal: number; summaryJson: string }>;
  }> {
    const sections = await this.module.listSections(conversationId, epoch);
    const sectionsByWorkKey = new Map<
      string,
      { ordinal: number; summaryJson: string }
    >();
    let maxOrdinal = 0;
    let coveredThroughTs = 0;
    let coveredThroughRowId = 0;
    const representedSourceIds: string[] = [];
    for (const s of sections) {
      if (s.revision !== revision) continue;
      if (s.status !== "staged" && s.status !== "published") continue;
      sectionsByWorkKey.set(s.workKey, {
        ordinal: s.ordinal,
        summaryJson: s.summaryJson,
      });
      if (s.ordinal > maxOrdinal) maxOrdinal = s.ordinal;
      if (
        s.sourceEndTimestampMs > coveredThroughTs ||
        (s.sourceEndTimestampMs === coveredThroughTs &&
          s.sourceEndRowId > coveredThroughRowId)
      ) {
        coveredThroughTs = s.sourceEndTimestampMs;
        coveredThroughRowId = s.sourceEndRowId;
      }
      try {
        const manifest = JSON.parse(s.sourceManifestJson) as {
          fragments?: Array<{ sourceId?: string }>;
        };
        for (const f of manifest.fragments ?? []) {
          if (typeof f.sourceId === "string") {
            representedSourceIds.push(f.sourceId);
          }
        }
      } catch {
        // Corrupt manifest — coverage position still advances; the section
        // itself will be revalidated on reuse.
      }
    }

    let priorOverview: SectionSummaryV1 | null = null;
    let priorRepresentedCount = 0;
    if (activeGenerationId) {
      const gen = await this.module.getActiveGeneration(
        conversationId,
        epoch
      );
      if (gen && gen.generationId === activeGenerationId) {
        const parsed = this.safeJsonParse(gen.overviewJson);
        const valid = this.validator.validate(
          parsed,
          new Set(representedSourceIds),
          AI_CHAT_RECOVERABLE_DEFAULTS.overviewOutputTargetTokens
        );
        if (valid.ok && valid.summary) {
          priorOverview = valid.summary;
          priorRepresentedCount = gen.representedSectionOrdinal ?? 0;
          // Published coverage is the resume floor when no staged sections
          // extend beyond it.
          if (
            Number(gen.coveredThroughTimestampMs) > coveredThroughTs ||
            (Number(gen.coveredThroughTimestampMs) === coveredThroughTs &&
              gen.coveredThroughRowId > coveredThroughRowId)
          ) {
            coveredThroughTs = Number(gen.coveredThroughTimestampMs);
            coveredThroughRowId = gen.coveredThroughRowId;
          }
        }
      }
    }

    let mergedThroughOrdinal = 0;
    let stagedCursor: string | undefined;
    try {
      const activeRun = await this.module.getActiveRun(conversationId);
      if (
        activeRun &&
        activeRun.epoch === epoch &&
        activeRun.revision === revision &&
        (activeRun.state === "running" || activeRun.state === "paused")
      ) {
        const merged = Number(activeRun.mergedThroughOrdinal) || 0;
        if (merged > 0) {
          mergedThroughOrdinal = merged;
          if (merged > maxOrdinal) {
            maxOrdinal = merged;
          }
        }
        if (activeRun.workingOverviewJson) {
          const parsed = this.safeJsonParse(activeRun.workingOverviewJson);
          const valid = this.validator.validate(
            parsed,
            new Set(representedSourceIds),
            AI_CHAT_RECOVERABLE_DEFAULTS.overviewOutputTargetTokens
          );
          if (valid.ok && valid.summary) {
            priorOverview = valid.summary;
            priorRepresentedCount = Math.max(priorRepresentedCount, mergedThroughOrdinal);
            const mergedSections = sections.filter(
              (s) =>
                s.revision === revision &&
                (s.status === "staged" || s.status === "published") &&
                s.ordinal <= mergedThroughOrdinal
            );
            let mergedTs = 0;
            let mergedRowId = 0;
            for (const s of mergedSections) {
              if (
                s.sourceEndTimestampMs > mergedTs ||
                (s.sourceEndTimestampMs === mergedTs && s.sourceEndRowId > mergedRowId)
              ) {
                mergedTs = s.sourceEndTimestampMs;
                mergedRowId = s.sourceEndRowId;
              }
            }
            if (mergedTs > 0 || mergedRowId > 0) {
              coveredThroughTs = mergedTs;
              coveredThroughRowId = mergedRowId;
            }
          }
        }
        if (activeRun.stagedCursorJson) {
          const decoded = decodeCursor(
            activeRun.stagedCursorJson,
            conversationId,
            epoch,
            revision
          );
          if (decoded) {
            stagedCursor = activeRun.stagedCursorJson;
          }
        }
      }
    } catch {
      stagedCursor = undefined;
    }

    let startCursor: string | undefined = stagedCursor;
    if (!startCursor && (coveredThroughTs > 0 || coveredThroughRowId > 0)) {
      startCursor = encodeCursor({
        v: 1,
        conversationId,
        epoch,
        revision,
        lastTimestampMs: coveredThroughTs,
        lastRowId: coveredThroughRowId,
        direction: "forward",
      });
    }
    return {
      startCursor,
      maxOrdinal,
      mergedThroughOrdinal,
      priorOverview,
      priorRepresentedCount,
      coveredThroughTs,
      coveredThroughRowId,
      representedSourceIds,
      sectionsByWorkKey,
    };
  }

  /**
   * Deterministic section-work identity (FR-09): epoch/revision, source range
   * + fragments, schema version. Changing provider retry attempt never creates
   * a duplicate identity.
   */
  private computeWorkKey(input: {
    epoch: string;
    revision: number;
    startTs: number;
    startRowId: number;
    endTs: number;
    endRowId: number;
    fragments: readonly PackedTextFragment[];
    receipts: readonly PackedToolReceipt[];
  }): string {
    const fragIds = input.fragments
      .map((f) => `${f.sourceRowId}:${f.startCodePoint}:${f.endCodePoint}`)
      .join(",");
    const receiptIds = input.receipts
      .map((r) => `${r.sourceRowId}:${r.toolCallId}`)
      .join(",");
    const hash = createHash("sha256")
      .update(
        [
          input.epoch,
          input.revision,
          input.startTs,
          input.startRowId,
          input.endTs,
          input.endRowId,
          fragIds,
          receiptIds,
          "v1",
        ].join("|")
      )
      .digest("hex")
      .slice(0, 40);
    return `v1-${hash}`;
  }

  /**
   * Bounded section summarization (§16, FR-08/FR-11): at most 4 model attempts
   * per section per run — ≤2 source-size reductions on context rejection plus
   * ≤1 structured-output repair. Provider output caps are enforced locally
   * (rejected, never blindly cut). No all-history fallback on exhaustion.
   */
  private async summarizeSectionBounded(input: {
    prompt: { systemPrompt: string; userPrompt: string; suppliedSourceIds: readonly string[] };
    summarize: SummarizeFn;
    signal?: AbortSignal;
    timeoutMs: number;
    onReduceCapacity: (reduced: number) => void;
    getCapacity: () => number;
  }): Promise<SectionSummaryV1> {
    const maxAttempts =
      AI_CHAT_RECOVERABLE_DEFAULTS.maxModelAttemptsPerSectionPerRun;
    const maxReductions =
      AI_CHAT_RECOVERABLE_DEFAULTS.maxContextReductionRetriesPerSection;
    let attempts = 0;
    let reductions = 0;
    let repaired = false;
    let lastErrors: string[] = [];
    let systemPrompt = input.prompt.systemPrompt;
    const userPrompt = input.prompt.userPrompt;

    while (attempts < maxAttempts) {
      attempts += 1;
      let raw: string;
      try {
        raw = await this.callWithTimeout(
          input.summarize(systemPrompt, userPrompt),
          input.timeoutMs,
          input.signal
        );
      } catch (err) {
        if (this.isContextRejection(err) && reductions < maxReductions) {
          reductions += 1;
          const reduced = Math.max(
            64,
            Math.floor(input.getCapacity() / 2)
          );
          input.onReduceCapacity(reduced);
          lastErrors = [`context rejected; reduced capacity to ${reduced}`];
          continue;
        }
        throw err instanceof RecoverableHistoryError
          ? err
          : new RecoverableHistoryError(
              "COMPACTION_CONTEXT_REJECTED",
              `section summarize attempt ${attempts} failed: ${(err as Error).message}`
            );
      }

      // Explicit summary output cap (§8.3): reject oversized output rather
      // than cutting JSON or factual text.
      const rawTokens = Math.ceil(Buffer.byteLength(raw, "utf8") / 4);
      if (
        rawTokens >
        AI_CHAT_RECOVERABLE_DEFAULTS.sectionOutputCapTokens * 2
      ) {
        lastErrors = [
          `summary output ${rawTokens} tokens exceeds provider cap`,
        ];
        if (!repaired) {
          repaired = true;
          systemPrompt = `${input.prompt.systemPrompt}\nYour previous output was too long. Return a SHORTER valid JSON object within the schema caps.`;
          continue;
        }
        throw new RecoverableHistoryError(
          "COMPACTION_OUTPUT_INVALID",
          lastErrors.join("; ")
        );
      }

      const validation = this.validator.validate(
        this.safeJsonParse(raw),
        new Set(input.prompt.suppliedSourceIds),
        AI_CHAT_RECOVERABLE_DEFAULTS.sectionOutputCapTokens
      );
      if (validation.ok && validation.summary) {
        return validation.summary;
      }
      lastErrors = [...validation.errors];
      if (!repaired) {
        // One structured-output repair within the attempt ceiling (§16).
        repaired = true;
        systemPrompt = `${input.prompt.systemPrompt}\nYour previous output was invalid (${lastErrors.join("; ")}). Return valid JSON matching the schema exactly, referencing only supplied source IDs.`;
        continue;
      }
      // Repair already used — if the error looks like oversized input and we
      // still have reduction budget, shrink and retry.
      if (reductions < maxReductions) {
        reductions += 1;
        const reduced = Math.max(64, Math.floor(input.getCapacity() / 2));
        input.onReduceCapacity(reduced);
        continue;
      }
      break;
    }
    throw new RecoverableHistoryError(
      "COMPACTION_OUTPUT_INVALID",
      `section summary failed after ${attempts} bounded attempts: ${lastErrors.join("; ")}`
    );
  }

  /** True when a provider error signals context-length rejection (§16). */
  private isContextRejection(err: unknown): boolean {
    const msg =
      err instanceof Error ? err.message : typeof err === "string" ? err : "";
    return /context|too large|max_tokens|token limit|context_length|input too long/i.test(
      msg
    );
  }

  /**
   * Conservative §8.3 prompt-overhead estimate for one section call: the
   * fixed system scaffold + framing lines of an EMPTY section prompt (the
   * packed source itself is bounded by sourceCapacityTokens) + the rolling
   * overview carried as prior-synopsis context. Allocated before pack so a
   * small-window model overrides the 12,000-token target downward.
   */
  private estimateSectionPromptOverheadTokens(
    rollingOverview: SectionSummaryV1 | null
  ): number {
    const scaffold = this.promptBuilder.buildSectionPrompt({
      fragments: [],
      receipts: [],
      sectionLabel: "section-x",
    });
    const overviewBytes = rollingOverview
      ? Buffer.byteLength(JSON.stringify(rollingOverview), "utf8")
      : 0;
    return Math.ceil(
      (Buffer.byteLength(
        scaffold.systemPrompt + scaffold.userPrompt,
        "utf8"
      ) +
        overviewBytes) /
        4
    );
  }

  /**
   * Bounded source-linked continuation state (FR-06, AC-03, §10/§12): derived
   * ONLY from the validated rolling overview + represented source IDs — never
   * inferred memory, never permission grants (facts already passed the section
   * validator which rejects permission-grant patterns). Bounded: goal and
   * next step are slices, fact lists capped, artifact refs from tool outcomes.
   */
  private buildContinuationState(
    overview: SectionSummaryV1,
    representedSourceIds: ReadonlySet<string>
  ): string {
    const cleanFacts = (
      facts: readonly { text: string; status: string; sourceIds: readonly string[] }[],
      max: number,
      maxChars: number
    ): Array<{ text: string; status: string; sourceIds: string[] }> => {
      const out: Array<{ text: string; status: string; sourceIds: string[] }> = [];
      for (const f of facts) {
        if (out.length >= max) break;
        const refs = f.sourceIds.filter((s) => representedSourceIds.has(s));
        out.push({
          text: f.text.slice(0, maxChars),
          status: f.status,
          sourceIds: refs.slice(0, 4),
        });
      }
      return out;
    };
    const pending = cleanFacts(overview.pending, 10, 200);
    const state = {
      version: 1,
      goal: overview.synopsis.slice(0, 500),
      constraints: cleanFacts(overview.constraints, 10, 200),
      decisions: cleanFacts(overview.decisions, 10, 200),
      pending,
      nextStep: pending.length > 0 ? pending[0].text : "",
      artifactRefs: cleanFacts(overview.toolOutcomes, 10, 200),
      topics: overview.topics.slice(0, 20),
    };
    const json = JSON.stringify(state);
    return json.length > 8_000 ? json.slice(0, 8_000) : json;
  }

  /**
   * Bounded overview merge (§8.3/§10/§11.5): prior bounded overview + one new
   * section only — never concatenate every historical section. Validates
   * references against the prior overview + new section chain and the output
   * budget. On merge failure the caller keeps the last valid overview (never
   * publishes coverage beyond represented turns).
   */
  private async mergeOverview(input: {
    prior: SectionSummaryV1 | null;
    section: SectionSummaryV1;
    summarize: SummarizeFn;
    signal?: AbortSignal;
  }): Promise<SectionSummaryV1> {
    if (!input.prior) return input.section;
    const facts: Array<{ category: string; text: string; status: string }> = [];
    for (const [category, list] of [
      ["decisions", input.section.decisions],
      ["constraints", input.section.constraints],
      ["pending", input.section.pending],
      ["toolOutcomes", input.section.toolOutcomes],
    ] as const) {
      for (const f of list) {
        facts.push({ category, text: f.text, status: f.status });
      }
    }
    const prompt = this.promptBuilder.buildOverviewPrompt({
      newSectionSynopsis: input.section.synopsis,
      newSectionFacts: facts,
      priorOverviewSynopsis: input.prior.synopsis,
    });
    const allowed = new Set<string>();
    for (const list of [
      input.prior.decisions,
      input.prior.constraints,
      input.prior.pending,
      input.prior.toolOutcomes,
      input.section.decisions,
      input.section.constraints,
      input.section.pending,
      input.section.toolOutcomes,
    ]) {
      for (const f of list) {
        for (const sid of f.sourceIds) allowed.add(sid);
      }
    }
    const timeoutMs =
      AI_CHAT_RECOVERABLE_DEFAULTS.providerTimeoutSeconds * 1000;
    let attempts = 0;
    let lastErrors: string[] = [];
    while (attempts < 2) {
      attempts += 1;
      let raw: string;
      try {
        raw = await this.callWithTimeout(
          input.summarize(prompt.systemPrompt, prompt.userPrompt),
          timeoutMs,
          input.signal
        );
      } catch (err) {
        lastErrors = [`overview merge call failed: ${(err as Error).message}`];
        continue;
      }
      // Overview outputs omit the section version tag — normalize it.
      const parsed = this.safeJsonParse(raw);
      const normalized =
        typeof parsed === "object" && parsed !== null && !("version" in parsed)
          ? { ...(parsed as Record<string, unknown>), version: 1 }
          : parsed;
      const validation = this.validator.validate(
        normalized,
        allowed,
        AI_CHAT_RECOVERABLE_DEFAULTS.overviewOutputTargetTokens
      );
      if (validation.ok && validation.summary) {
        return validation.summary;
      }
      lastErrors = [...validation.errors];
    }
    // Merge failed within budget — keep the last valid overview so earlier
    // continuation facts never disappear from the active overview (AC-21).
    // The new section itself stays staged for a later merge retry.
    console.error(
      `[compaction] overview merge failed after ${attempts} attempts, keeping prior overview: ${lastErrors.join("; ")}`
    );
    return input.prior;
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
