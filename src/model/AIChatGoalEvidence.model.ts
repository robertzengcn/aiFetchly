import { BaseDb } from "@/model/Basedb";
import { AIChatGoalEvidenceEntity } from "@/entity/AIChatGoalEvidence.entity";
import { Repository } from "typeorm";
import type { GoalEvidenceSourceKind } from "@/entityTypes/aiChatGoalTypes";

/** Data-access layer for ai_chat_goal_evidence. Repository operations only. */
export class AIChatGoalEvidenceModel extends BaseDb {
  public repository: Repository<AIChatGoalEvidenceEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository = this.sqliteDb.connection.getRepository(
      AIChatGoalEvidenceEntity
    );
  }

  async append(input: {
    evidenceId: string;
    goalId: string;
    runId?: string;
    iteration?: number;
    criterionId?: string;
    sourceKind: GoalEvidenceSourceKind;
    state: "pass" | "fail" | "pending";
    sourceRevision?: string;
    contentHash?: string;
    resultMetadata?: string;
    excerpt?: string;
    timestamp: Date;
  }): Promise<AIChatGoalEvidenceEntity> {
    const entity = new AIChatGoalEvidenceEntity();
    entity.evidenceId = input.evidenceId;
    entity.goalId = input.goalId;
    entity.runId = input.runId;
    entity.iteration = input.iteration;
    entity.criterionId = input.criterionId;
    entity.sourceKind = input.sourceKind;
    entity.state = input.state;
    entity.sourceRevision = input.sourceRevision;
    entity.contentHash = input.contentHash;
    entity.resultMetadata = input.resultMetadata;
    entity.excerpt = input.excerpt;
    entity.timestamp = input.timestamp;
    return await this.repository.save(entity);
  }

  async listByRun(
    goalId: string,
    runId?: string
  ): Promise<AIChatGoalEvidenceEntity[]> {
    return await this.repository.find({
      where: runId ? { goalId, runId } : { goalId },
      order: { createdAt: "DESC" },
    });
  }

  async listByCriterion(
    goalId: string,
    criterionId: string
  ): Promise<AIChatGoalEvidenceEntity[]> {
    return await this.repository.find({
      where: { goalId, criterionId },
      order: { createdAt: "DESC" },
    });
  }
}
