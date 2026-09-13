import { BaseModule } from "@/modules/baseModule";
import { AIChatCompactionRunModel } from "@/model/AIChatCompactionRun.model";
import { AIChatCompactionSectionModel } from "@/model/AIChatCompactionSection.model";
import { AIChatContextGenerationModel } from "@/model/AIChatContextGeneration.model";
import { AIChatArchiveStateModel } from "@/model/AIChatArchiveState.model";
import type { AIChatCompactionRunEntity } from "@/entity/AIChatCompactionRun.entity";
import type { AIChatContextGenerationEntity } from "@/entity/AIChatContextGeneration.entity";

/**
 * Business-logic layer for incremental compaction (technical-design §11).
 * Wraps the three compaction Models in transactional operations and exposes
 * them to the coordinator + IPC handlers. Never touches repositories directly
 * (three-layer architecture: Model → Module → IPC).
 *
 * Extends BaseModule for dbpath resolution + connection management.
 */
export class AIChatCompactionModule extends BaseModule {
  private get runModel(): AIChatCompactionRunModel {
    return new AIChatCompactionRunModel(this.dbpath);
  }
  private get sectionModel(): AIChatCompactionSectionModel {
    return new AIChatCompactionSectionModel(this.dbpath);
  }
  private get generationModel(): AIChatContextGenerationModel {
    return new AIChatContextGenerationModel(this.dbpath);
  }
  private get stateModel(): AIChatArchiveStateModel {
    return new AIChatArchiveStateModel(this.dbpath);
  }

  /** Durable claim (§11.3). Delegates to the run model. */
  async claimRun(input: Parameters<AIChatCompactionRunModel["claimRun"]>[0]) {
    await this.ensureConnection();
    return this.runModel.claimRun(input);
  }

  /** Renew the lease (§11.3). */
  async renewLease(
    input: Parameters<AIChatCompactionRunModel["renewLease"]>[0]
  ) {
    await this.ensureConnection();
    return this.runModel.renewLease(input);
  }

  /** Save a section + checkpoint atomically (§11.4). */
  async saveSectionAndCheckpoint(
    input: Parameters<AIChatCompactionRunModel["saveSectionAndCheckpoint"]>[0]
  ) {
    await this.ensureConnection();
    return this.runModel.saveSectionAndCheckpoint(input);
  }

  /** Publish a generation via CAS (§11.5). */
  async publishGeneration(
    input: Parameters<AIChatCompactionRunModel["publishGeneration"]>[0]
  ) {
    await this.ensureConnection();
    return this.runModel.publishGeneration(input);
  }

  /** Pause a run after a batch budget yield (§11.2). */
  async pauseRun(input: Parameters<AIChatCompactionRunModel["pauseRun"]>[0]) {
    await this.ensureConnection();
    return this.runModel.pauseRun(input);
  }

  /** Cancel a run and bump the fence (§11.6). */
  async cancelRun(input: Parameters<AIChatCompactionRunModel["cancelRun"]>[0]) {
    await this.ensureConnection();
    return this.runModel.cancelRun(input);
  }

  /** Read a run by runId. */
  async getRun(runId: string): Promise<AIChatCompactionRunEntity | null> {
    await this.ensureConnection();
    return this.runModel.getRun(runId);
  }

  /** Get the active run for a conversation (if any). */
  async getActiveRun(
    conversationId: string
  ): Promise<AIChatCompactionRunEntity | null> {
    await this.ensureConnection();
    return this.runModel.getActiveRun(conversationId);
  }

  /** List staged + published sections for a conversation (ordinal order). */
  async listSections(conversationId: string, epoch: string) {
    await this.ensureConnection();
    return this.sectionModel.listSections(conversationId, epoch);
  }

  /** Get the active context generation for a conversation. */
  async getActiveGeneration(
    conversationId: string,
    epoch: string
  ): Promise<AIChatContextGenerationEntity | null> {
    await this.ensureConnection();
    return this.generationModel.getActiveGeneration(conversationId, epoch);
  }

  /** Get archive state (epoch/revision/fence) for the coordinator. */
  async getState(conversationId: string) {
    await this.ensureConnection();
    return this.stateModel.getState(conversationId);
  }

  /** Invalidate all compaction records for a conversation (§11.6 clear). */
  async invalidateConversation(conversationId: string): Promise<void> {
    await this.ensureConnection();
    await this.runModel.invalidateConversation(conversationId);
    await this.sectionModel.invalidateConversation(conversationId);
    await this.generationModel.invalidateConversation(conversationId);
  }
}
