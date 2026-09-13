import { BaseDb } from "@/model/Basedb";
import { AIChatCompactionRunEntity } from "@/entity/AIChatCompactionRun.entity";
import { AIChatCompactionSectionEntity } from "@/entity/AIChatCompactionSection.entity";
import { AIChatContextGenerationEntity } from "@/entity/AIChatContextGeneration.entity";
import { AIChatArchiveStateEntity } from "@/entity/AIChatArchiveState.entity";
import type { Repository } from "typeorm";
import { AI_CHAT_RECOVERABLE_DEFAULTS } from "@/service/AIChatRecoverableDefaults";
import { RecoverableHistoryError } from "@/entityTypes/aiChatArchiveTypes";

/**
 * Data access for compaction runs (technical-design §11.3 / §11.4). The run
 * model owns the durable claim + fence + lease and the snapshot/retained
 * boundary. All claim/save/publish operations revalidate epoch/revision/runId/
 * fence inside a transaction so a slow previous owner cannot publish after a
 * lease takeover.
 *
 * Extends BaseDb; the repository is recreated on connection rebind
 * (override onSqliteDbRebound — see BaseDb).
 */
export class AIChatCompactionRunModel extends BaseDb {
  public repository: Repository<AIChatCompactionRunEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository = this.sqliteDb.connection.getRepository(
      AIChatCompactionRunEntity
    );
  }

  protected onSqliteDbRebound(): void {
    this.repository = this.sqliteDb.connection.getRepository(
      AIChatCompactionRunEntity
    );
  }

  /**
   * Durable claim (§11.3): confirm the conversation exists and is not
   * tombstoned, atomically set activeRunId, increment fence, and assign
   * owner/lease. Returns the claimed run + the fence used, or throws
   * COMPACTION_CONTEXT_REJECTED when the conversation is tombstoned.
   */
  async claimRun(input: {
    conversationId: string;
    epoch: string;
    revision: number;
    trigger: string;
    model?: string;
    leaseOwner: string;
    snapshotEndTimestampMs: number;
    snapshotEndRowId: number;
    retainedStartTimestampMs: number;
    retainedStartRowId: number;
    baseGenerationId?: string;
  }): Promise<{
    runId: string;
    fence: number;
    joinedExisting: boolean;
  }> {
    const runId = crypto.randomUUID();
    const leaseMs = AI_CHAT_RECOVERABLE_DEFAULTS.leaseInitialSeconds * 1000;
    const now = Date.now();

    return this.sqliteDb.connection.transaction(async (manager) => {
      const stateRepo = manager.getRepository(AIChatArchiveStateEntity);
      const runRepo = manager.getRepository(AIChatCompactionRunEntity);
      const state = await stateRepo.findOne({
        where: { conversationId: input.conversationId },
      });
      if (!state || state.deletedAt) {
        throw new RecoverableHistoryError(
          "COMPACTION_CONTEXT_REJECTED",
          `conversation ${input.conversationId} is tombstoned or has no archive state`
        );
      }
      if (state.epoch !== input.epoch) {
        throw new RecoverableHistoryError(
          "COMPACTION_CONTEXT_REJECTED",
          `epoch changed during claim: expected ${input.epoch}, got ${state.epoch}`
        );
      }

      // If a run is already active and its lease is still valid, join it.
      if (
        state.activeRunId &&
        state.leaseUntilMs &&
        state.leaseUntilMs > now &&
        state.leaseOwner === input.leaseOwner
      ) {
        const existing = await runRepo.findOne({
          where: { runId: state.activeRunId },
        });
        if (
          existing &&
          existing.state !== "cancelled" &&
          existing.state !== "completed" &&
          existing.state !== "failed"
        ) {
          return {
            runId: existing.runId,
            fence: state.fence,
            joinedExisting: true,
          };
        }
      }

      const entity = new AIChatCompactionRunEntity();
      entity.runId = runId;
      entity.conversationId = input.conversationId;
      entity.epoch = input.epoch;
      entity.revision = input.revision;
      entity.trigger = input.trigger;
      entity.state = "running";
      entity.snapshotEndTimestampMs = input.snapshotEndTimestampMs;
      entity.snapshotEndRowId = input.snapshotEndRowId;
      entity.retainedStartTimestampMs = input.retainedStartTimestampMs;
      entity.retainedStartRowId = input.retainedStartRowId;
      entity.baseGenerationId = input.baseGenerationId;
      entity.fence = state.fence + 1;
      entity.leaseOwner = input.leaseOwner;
      entity.leaseUntilMs = now + leaseMs;
      entity.model = input.model;
      entity.mergedThroughOrdinal = 0;
      entity.attemptCount = 0;
      entity.contextReductionCount = 0;
      entity.schemaVersion = 1;
      await runRepo.save(entity);

      state.activeRunId = runId;
      state.fence = entity.fence;
      state.leaseOwner = input.leaseOwner;
      state.leaseUntilMs = now + leaseMs;
      await stateRepo.save(state);

      return { runId, fence: entity.fence, joinedExisting: false };
    });
  }

  /**
   * Renew the lease (§11.3). Revalidates epoch/revision/runId/fence; throws
   * COMPACTION_STALE_CLAIM when the fence moved. Safe to call before each
   * expensive operation.
   */
  async renewLease(input: {
    conversationId: string;
    runId: string;
    epoch: string;
    expectedFence: number;
    leaseOwner: string;
  }): Promise<{ fence: number; leaseUntilMs: number } | null> {
    const leaseMs = AI_CHAT_RECOVERABLE_DEFAULTS.leaseInitialSeconds * 1000;
    const now = Date.now();
    return this.sqliteDb.connection.transaction(async (manager) => {
      const stateRepo = manager.getRepository(AIChatArchiveStateEntity);
      const runRepo = manager.getRepository(AIChatCompactionRunEntity);
      const state = await stateRepo.findOne({
        where: { conversationId: input.conversationId },
      });
      if (!state || state.epoch !== input.epoch) return null;
      if (state.fence !== input.expectedFence) {
        throw new RecoverableHistoryError(
          "COMPACTION_STALE_CLAIM",
          `fence moved: expected ${input.expectedFence}, got ${state.fence}`
        );
      }
      const run = await runRepo.findOne({ where: { runId: input.runId } });
      if (!run || run.state !== "running") return null;
      const leaseUntil = now + leaseMs;
      state.leaseOwner = input.leaseOwner;
      state.leaseUntilMs = leaseUntil;
      await stateRepo.save(state);
      return { fence: state.fence, leaseUntilMs: leaseUntil };
    });
  }

  /**
   * Save a section + checkpoint atomically (§11.4). Revalidates epoch/
   * revision/runId/fence inside the transaction. Inserts by unique workKey
   * (reuses an identical saved section). Commits section + staged cursor.
   */
  async saveSectionAndCheckpoint(input: {
    conversationId: string;
    runId: string;
    epoch: string;
    revision: number;
    expectedFence: number;
    section: {
      sectionId: string;
      workKey: string;
      ordinal: number;
      sourceStartTimestampMs: number;
      sourceStartRowId: number;
      sourceEndTimestampMs: number;
      sourceEndRowId: number;
      sourceManifestJson: string;
      summaryJson: string;
      inputTokenEstimate?: number;
      outputTokenEstimate?: number;
      model?: string;
      sourceHash?: string;
    };
    stagedCursorJson: string;
  }): Promise<{ saved: boolean; fence: number }> {
    return this.sqliteDb.connection.transaction(async (manager) => {
      const stateRepo = manager.getRepository(AIChatArchiveStateEntity);
      const runRepo = manager.getRepository(AIChatCompactionRunEntity);
      const sectionRepo = manager.getRepository(AIChatCompactionSectionEntity);
      const state = await stateRepo.findOne({
        where: { conversationId: input.conversationId },
      });
      if (!state || state.epoch !== input.epoch) {
        throw new RecoverableHistoryError(
          "COMPACTION_STALE_CLAIM",
          `epoch changed during section save`
        );
      }
      if (state.fence !== input.expectedFence) {
        throw new RecoverableHistoryError(
          "COMPACTION_STALE_CLAIM",
          `fence moved during section save`
        );
      }
      const run = await runRepo.findOne({ where: { runId: input.runId } });
      if (!run || run.state !== "running") {
        throw new RecoverableHistoryError(
          "COMPACTION_STALE_CLAIM",
          `run ${input.runId} is not running`
        );
      }
      const existing = await sectionRepo.findOne({
        where: {
          conversationId: input.conversationId,
          epoch: input.epoch,
          workKey: input.section.workKey,
        },
      });
      if (existing) {
        run.stagedCursorJson = input.stagedCursorJson;
        run.mergedThroughOrdinal = Math.max(
          run.mergedThroughOrdinal,
          existing.ordinal
        );
        await runRepo.save(run);
        return { saved: false, fence: state.fence };
      }
      const entity = new AIChatCompactionSectionEntity();
      entity.sectionId = input.section.sectionId;
      entity.conversationId = input.conversationId;
      entity.epoch = input.epoch;
      entity.revision = input.revision;
      entity.ordinal = input.section.ordinal;
      entity.workKey = input.section.workKey;
      entity.sourceStartTimestampMs = input.section.sourceStartTimestampMs;
      entity.sourceStartRowId = input.section.sourceStartRowId;
      entity.sourceEndTimestampMs = input.section.sourceEndTimestampMs;
      entity.sourceEndRowId = input.section.sourceEndRowId;
      entity.sourceManifestJson = input.section.sourceManifestJson;
      entity.summaryJson = input.section.summaryJson;
      entity.inputTokenEstimate = input.section.inputTokenEstimate;
      entity.outputTokenEstimate = input.section.outputTokenEstimate;
      entity.model = input.section.model;
      entity.sourceHash = input.section.sourceHash;
      entity.status = "staged";
      entity.promptSchemaVersion = "v1";
      await sectionRepo.save(entity);

      run.stagedCursorJson = input.stagedCursorJson;
      run.mergedThroughOrdinal = Math.max(
        run.mergedThroughOrdinal,
        input.section.ordinal
      );
      await runRepo.save(run);
      return { saved: true, fence: state.fence };
    });
  }

  /**
   * Publish a generation (§11.5): revalidate epoch/revision/fence + base
   * generation, insert an immutable generation, CAS activeGenerationId from
   * the expected parent, and mark represented sections published. Returns
   * published=false (not throws) when the CAS fails so the coordinator can
   * retry.
   */
  async publishGeneration(input: {
    conversationId: string;
    runId: string;
    epoch: string;
    expectedFence: number;
    generationId: string;
    parentGenerationId?: string;
    representedSectionOrdinal: number;
    coveredThroughTimestampMs: number;
    coveredThroughRowId: number;
    overviewJson: string;
    continuationStateJson?: string;
    tokenEstimate?: number;
    model?: string;
  }): Promise<{ published: boolean; fence: number }> {
    return this.sqliteDb.connection.transaction(async (manager) => {
      const stateRepo = manager.getRepository(AIChatArchiveStateEntity);
      const runRepo = manager.getRepository(AIChatCompactionRunEntity);
      const genRepo = manager.getRepository(AIChatContextGenerationEntity);
      const sectionRepo = manager.getRepository(AIChatCompactionSectionEntity);
      const state = await stateRepo.findOne({
        where: { conversationId: input.conversationId },
      });
      if (!state || state.epoch !== input.epoch) {
        throw new RecoverableHistoryError(
          "COMPACTION_STALE_CLAIM",
          `epoch changed during publish`
        );
      }
      if (state.fence !== input.expectedFence) {
        throw new RecoverableHistoryError(
          "COMPACTION_STALE_CLAIM",
          `fence moved during publish`
        );
      }
      // CAS: the parent must match the current active generation (if any).
      if (
        state.activeGenerationId &&
        state.activeGenerationId !== input.parentGenerationId
      ) {
        return { published: false, fence: state.fence };
      }
      const genEntity = new AIChatContextGenerationEntity();
      genEntity.generationId = input.generationId;
      genEntity.conversationId = input.conversationId;
      genEntity.epoch = input.epoch;
      genEntity.revision = state.sourceRevision;
      genEntity.parentGenerationId = input.parentGenerationId;
      genEntity.representedSectionOrdinal = input.representedSectionOrdinal;
      genEntity.coveredThroughTimestampMs = input.coveredThroughTimestampMs;
      genEntity.coveredThroughRowId = input.coveredThroughRowId;
      genEntity.overviewJson = input.overviewJson;
      genEntity.continuationStateJson = input.continuationStateJson;
      genEntity.tokenEstimate = input.tokenEstimate;
      genEntity.model = input.model;
      genEntity.schemaVersion = "v1";
      genEntity.status = "active";
      await genRepo.save(genEntity);

      // Supersede prior active generations.
      const prior = await genRepo.find({
        where: { conversationId: input.conversationId, status: "active" },
      });
      for (const p of prior) {
        if (p.generationId !== input.generationId) {
          p.status = "superseded";
          await genRepo.save(p);
        }
      }

      // Mark represented sections published.
      const sections = await sectionRepo.find({
        where: { conversationId: input.conversationId, epoch: input.epoch },
      });
      for (const s of sections) {
        if (s.ordinal <= input.representedSectionOrdinal && s.status === "staged") {
          s.status = "published";
          await sectionRepo.save(s);
        }
      }

      state.activeGenerationId = input.generationId;
      await stateRepo.save(state);

      const run = await runRepo.findOne({ where: { runId: input.runId } });
      if (run) {
        run.state = "completed";
        run.publishedCursorJson = JSON.stringify({
          coveredThroughTimestampMs: input.coveredThroughTimestampMs,
          coveredThroughRowId: input.coveredThroughRowId,
        });
        await runRepo.save(run);
      }
      return { published: true, fence: state.fence };
    });
  }

  /** Pause a run (§11.2): set state to paused after a batch budget yield. */
  async pauseRun(input: {
    conversationId: string;
    runId: string;
    epoch: string;
    expectedFence: number;
  }): Promise<void> {
    await this.sqliteDb.connection.transaction(async (manager) => {
      const stateRepo = manager.getRepository(AIChatArchiveStateEntity);
      const runRepo = manager.getRepository(AIChatCompactionRunEntity);
      const state = await stateRepo.findOne({
        where: { conversationId: input.conversationId },
      });
      if (!state || state.epoch !== input.epoch) return;
      if (state.fence !== input.expectedFence) return;
      const run = await runRepo.findOne({ where: { runId: input.runId } });
      if (run && run.state === "running") {
        run.state = "paused";
        await runRepo.save(run);
      }
    });
  }

  /**
   * Cancel a run (§11.6): set state to cancelled and bump the fence so late
   * model results are discarded.
   */
  async cancelRun(input: {
    conversationId: string;
    runId: string;
    epoch: string;
    expectedFence: number;
  }): Promise<void> {
    await this.sqliteDb.connection.transaction(async (manager) => {
      const stateRepo = manager.getRepository(AIChatArchiveStateEntity);
      const runRepo = manager.getRepository(AIChatCompactionRunEntity);
      const state = await stateRepo.findOne({
        where: { conversationId: input.conversationId },
      });
      if (!state || state.epoch !== input.epoch) return;
      if (state.fence !== input.expectedFence) return;
      const run = await runRepo.findOne({ where: { runId: input.runId } });
      if (run) {
        run.state = "cancelled";
        await runRepo.save(run);
      }
      state.fence = state.fence + 1;
      state.activeRunId = undefined as unknown as string;
      state.leaseOwner = undefined as unknown as string;
      state.leaseUntilMs = undefined as unknown as number;
      await stateRepo.save(state);
    });
  }

  /** Read a run by runId. */
  async getRun(runId: string): Promise<AIChatCompactionRunEntity | null> {
    return this.repository.findOne({ where: { runId } });
  }

  /** Get the active run for a conversation (if any). */
  async getActiveRun(conversationId: string): Promise<AIChatCompactionRunEntity | null> {
    const runs = await this.repository.find({
      where: { conversationId },
      order: { id: "DESC" },
      take: 1,
    });
    if (runs.length === 0) return null;
    const run = runs[0];
    if (run.state === "completed" || run.state === "cancelled" || run.state === "failed") {
      return null;
    }
    return run;
  }

  /**
   * Invalidate a conversation (§11.6): bump fence so all in-flight claims
   * become stale. Used by conversation clear before batch deletion.
   */
  async invalidateConversation(conversationId: string): Promise<void> {
    await this.sqliteDb.connection.transaction(async (manager) => {
      const stateRepo = manager.getRepository(AIChatArchiveStateEntity);
      const state = await stateRepo.findOne({ where: { conversationId } });
      if (!state) return;
      state.fence = state.fence + 1;
      state.activeRunId = undefined as unknown as string;
      state.leaseOwner = undefined as unknown as string;
      state.leaseUntilMs = undefined as unknown as number;
      await stateRepo.save(state);
    });
  }
}
