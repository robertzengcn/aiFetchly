import { BaseDb } from "@/model/Basedb";
import { PromptSkillInvocationEntity } from "@/entity/PromptSkillInvocation.entity";
import { Repository } from "typeorm";

export interface PromptSkillInvocationSaveInput {
  readonly conversationId: string;
  readonly agentScope: string;
  readonly runtimeId: string;
  readonly contentHash: string;
  readonly contextRevision: number;
  readonly normalizedInstructions: string;
  readonly tokenEstimate: number;
  readonly invocationArgumentsJson: string;
  readonly invocationSource: "explicit" | "model" | "legacy-adapter";
  readonly invokedAt: Date;
}

export class PromptSkillInvocationModel extends BaseDb {
  public repository: Repository<PromptSkillInvocationEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository = this.sqliteDb.connection.getRepository(
      PromptSkillInvocationEntity
    );
  }

  async findByIdentity(
    conversationId: string,
    agentScope: string,
    runtimeId: string,
    contentHash: string
  ): Promise<PromptSkillInvocationEntity | null> {
    return this.repository.findOne({
      where: {
        conversationId,
        agentScope,
        runtimeId,
        contentHash,
      },
    });
  }

  async findActive(
    conversationId: string,
    agentScope: string
  ): Promise<PromptSkillInvocationEntity[]> {
    return this.repository.find({
      where: { conversationId, agentScope, active: true },
      order: { invokedAt: "ASC", id: "ASC" },
    });
  }

  /**
   * Save one invocation and deactivate any other active record for the same
   * runtime id in the same scope (a changed content hash creates a new
   * context revision; the old hash is superseded, not deleted — recovery may
   * still read historical snapshots).
   */
  async saveInvocation(
    input: PromptSkillInvocationSaveInput
  ): Promise<PromptSkillInvocationEntity> {
    return this.sqliteDb.connection.transaction(async (manager) => {
      const repo = manager.getRepository(PromptSkillInvocationEntity);
      // Same-hash duplicate → idempotent no-op.
      const existing = await repo.findOne({
        where: {
          conversationId: input.conversationId,
          agentScope: input.agentScope,
          runtimeId: input.runtimeId,
          contentHash: input.contentHash,
        },
      });
      if (existing) return existing;

      // Different hash for the same runtime id → new revision; supersede.
      const priorActives = await repo.find({
        where: {
          conversationId: input.conversationId,
          agentScope: input.agentScope,
          runtimeId: input.runtimeId,
          active: true,
        },
      });
      for (const prior of priorActives) {
        await repo.update({ id: prior.id }, { active: false });
      }

      const entity = new PromptSkillInvocationEntity();
      entity.conversationId = input.conversationId;
      entity.agentScope = input.agentScope;
      entity.runtimeId = input.runtimeId;
      entity.contentHash = input.contentHash;
      entity.contextRevision = input.contextRevision;
      entity.normalizedInstructions = input.normalizedInstructions;
      entity.tokenEstimate = input.tokenEstimate;
      entity.invocationArgumentsJson = input.invocationArgumentsJson;
      entity.invocationSource = input.invocationSource;
      entity.active = true;
      entity.invokedAt = input.invokedAt;
      return repo.save(entity);
    });
  }

  async deactivate(
    conversationId: string,
    agentScope: string,
    runtimeId: string
  ): Promise<number> {
    const rows = await this.repository.find({
      where: { conversationId, agentScope, runtimeId, active: true },
    });
    let affected = 0;
    for (const row of rows) {
      await this.repository.update({ id: row.id }, { active: false });
      affected += 1;
    }
    return affected;
  }

  async deleteByConversation(conversationId: string): Promise<number> {
    const r = await this.repository.delete({ conversationId });
    return r.affected ?? 0;
  }
}
