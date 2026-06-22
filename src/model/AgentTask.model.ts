// src/model/AgentTask.model.ts
import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { AgentTaskEntity } from "@/entity/AgentTask.entity";
import { AgentTaskMessageEntity } from "@/entity/AgentTaskMessage.entity";
import type {
  AgentResult,
  AgentTaskMessageRecord,
  AgentTaskPacket,
  AgentTaskSnapshot,
  AgentTaskStatus,
} from "@/entityTypes/agentTypes";

export class AgentTaskModel extends BaseDb {
  public repository: Repository<AgentTaskEntity>;
  private readonly msgRepo: Repository<AgentTaskMessageEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository = this.sqliteDb.connection.getRepository(AgentTaskEntity);
    this.msgRepo = this.sqliteDb.connection.getRepository(
      AgentTaskMessageEntity
    );
  }

  /**
   * Returns completed agent tasks ordered by most-recent first. Used by the
   * auto-dream source collector to find recent transcripts for consolidation.
   * `since` is optional; when omitted, returns the most recent tasks overall.
   */
  async listFinishedAfter(
    since: Date | null,
    limit: number
  ): Promise<AgentTaskEntity[]> {
    const qb = this.repository.createQueryBuilder("t");
    qb.where("t.status = :status", { status: "completed" });
    if (since) {
      qb.andWhere("(t.finishedAt > :since OR t.updatedAt > :since)", {
        since,
      });
    }
    qb.orderBy("t.finishedAt", "DESC", "NULLS LAST").take(
      Math.max(1, Math.min(limit, 100))
    );
    return qb.getMany();
  }

  async create(input: {
    agentTaskId: string;
    workflowRunId?: string;
    parentTaskId?: string;
    parentConversationId?: string;
    agentConversationId: string;
    agentId: string;
    agentVersion: number;
    prompt: string;
    taskPacket: AgentTaskPacket;
  }): Promise<void> {
    await this.repository.save({
      agentTaskId: input.agentTaskId,
      workflowRunId: input.workflowRunId ?? null,
      parentTaskId: input.parentTaskId ?? null,
      parentConversationId: input.parentConversationId ?? null,
      agentConversationId: input.agentConversationId,
      agentId: input.agentId,
      agentVersion: input.agentVersion,
      status: "queued",
      prompt: input.prompt,
      taskPacket: input.taskPacket as unknown as Record<string, unknown>,
      result: null,
      errorMessage: null,
      toolCallsCount: 0,
      startedAt: null,
      finishedAt: null,
    } as Partial<AgentTaskEntity>);
  }

  async setStatus(
    agentTaskId: string,
    status: AgentTaskStatus,
    extra?: { errorMessage?: string; startedAt?: Date; finishedAt?: Date }
  ): Promise<void> {
    await this.repository.update(
      { agentTaskId },
      {
        status,
        ...(extra?.errorMessage !== undefined
          ? { errorMessage: extra.errorMessage }
          : {}),
        ...(extra?.startedAt ? { startedAt: extra.startedAt } : {}),
        ...(extra?.finishedAt ? { finishedAt: extra.finishedAt } : {}),
      }
    );
  }

  async saveResult(agentTaskId: string, result: AgentResult): Promise<void> {
    const task = await this.repository.findOne({ where: { agentTaskId } });
    if (!task) {
      throw new Error(`Agent task not found: ${agentTaskId}`);
    }
    task.result = result as unknown as Record<string, unknown>;
    await this.repository.save(task);
  }

  async incrementToolCalls(agentTaskId: string): Promise<void> {
    await this.repository.increment({ agentTaskId }, "toolCallsCount", 1);
  }

  async getSnapshot(agentTaskId: string): Promise<AgentTaskSnapshot | null> {
    const e = await this.repository.findOne({ where: { agentTaskId } });
    if (!e) return null;
    return {
      agentTaskId: e.agentTaskId,
      agentId: e.agentId,
      agentVersion: e.agentVersion,
      workflowRunId: e.workflowRunId ?? undefined,
      parentConversationId: e.parentConversationId ?? undefined,
      status: e.status as AgentTaskStatus,
      startedAt: e.startedAt?.toISOString(),
      finishedAt: e.finishedAt?.toISOString(),
      toolCallsCount: e.toolCallsCount,
      errorMessage: e.errorMessage ?? undefined,
      result: (e.result as unknown as AgentResult) ?? undefined,
    };
  }

  async appendMessage(record: AgentTaskMessageRecord): Promise<void> {
    await this.msgRepo.save({
      agentTaskId: record.agentTaskId,
      role: record.role,
      content: record.content,
      toolCallId: record.toolCallId ?? null,
      metadata: record.metadata ?? null,
    } as Partial<AgentTaskMessageEntity>);
  }

  async listMessages(agentTaskId: string): Promise<AgentTaskMessageRecord[]> {
    const rows = await this.msgRepo.find({
      where: { agentTaskId },
      order: { id: "ASC" },
    });
    return rows.map((r) => ({
      agentTaskId: r.agentTaskId,
      role: r.role as AgentTaskMessageRecord["role"],
      content: r.content,
      toolCallId: r.toolCallId ?? undefined,
      metadata: r.metadata ?? undefined,
    }));
  }
}
