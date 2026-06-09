import { BaseModule } from "./baseModule";
import { AiMessageTaskRunModel } from "@/model/AiMessageTaskRun.model";
import { AiMessageTaskRunEntity } from "@/entity/AiMessageTaskRun.entity";
import type {
  AiMessageTaskRunStatus,
  BlockedToolCallRecord,
} from "@/entityTypes/aiMessageTaskTypes";

export class AiMessageTaskRunModule extends BaseModule {
  private model: AiMessageTaskRunModel;

  constructor() {
    super();
    this.model = new AiMessageTaskRunModel(this.dbpath);
  }

  async createRun(params: {
    taskId: number;
    scheduleId?: number;
    conversationId?: string;
  }): Promise<number> {
    await this.ensureConnection();

    const entity: Partial<AiMessageTaskRunEntity> = {
      task_id: params.taskId,
      schedule_id: params.scheduleId ?? undefined,
      conversation_id: params.conversationId ?? undefined,
      status: "pending",
      started_at: new Date(),
      tool_calls_count: 0,
      blocked_tool_calls_json: "[]",
    };

    return this.model.create(entity);
  }

  async updateRunStatus(
    runId: number,
    status: AiMessageTaskRunStatus,
    data?: Partial<AiMessageTaskRunEntity>
  ): Promise<void> {
    await this.ensureConnection();
    await this.model.updateStatus(runId, status, data);
  }

  async completeRun(
    runId: number,
    params: {
      assistantFinalMessage: string;
      toolCallsCount: number;
      blockedToolCalls: BlockedToolCallRecord[];
      metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    await this.ensureConnection();

    const now = new Date();
    const run = await this.model.getById(runId);
    const startedAt = run?.started_at ?? now;
    const durationMs = now.getTime() - new Date(startedAt).getTime();

    await this.model.updateStatus(runId, "completed", {
      finished_at: now,
      duration_ms: durationMs,
      assistant_final_message: params.assistantFinalMessage,
      tool_calls_count: params.toolCallsCount,
      blocked_tool_calls_json: JSON.stringify(params.blockedToolCalls),
      metadata_json: params.metadata
        ? JSON.stringify(params.metadata)
        : undefined,
    });
  }

  async failRun(
    runId: number,
    errorMessage: string,
    params?: {
      toolCallsCount?: number;
      blockedToolCalls?: BlockedToolCallRecord[];
      metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    await this.ensureConnection();

    const now = new Date();
    const run = await this.model.getById(runId);
    const startedAt = run?.started_at ?? now;
    const durationMs = now.getTime() - new Date(startedAt).getTime();

    await this.model.updateStatus(runId, "failed", {
      finished_at: now,
      duration_ms: durationMs,
      error_message: errorMessage,
      tool_calls_count: params?.toolCallsCount ?? 0,
      blocked_tool_calls_json: JSON.stringify(params?.blockedToolCalls ?? []),
      metadata_json: params?.metadata
        ? JSON.stringify(params.metadata)
        : undefined,
    });
  }

  async getRun(runId: number): Promise<AiMessageTaskRunEntity | null> {
    await this.ensureConnection();
    return this.model.getById(runId);
  }

  async listRunsByTask(
    taskId: number,
    page = 1,
    limit = 20
  ): Promise<{ items: AiMessageTaskRunEntity[]; total: number }> {
    await this.ensureConnection();
    return this.model.listByTask(taskId, page, limit);
  }

  async listRunsBySchedule(
    scheduleId: number,
    page = 1,
    limit = 20
  ): Promise<{ items: AiMessageTaskRunEntity[]; total: number }> {
    await this.ensureConnection();
    return this.model.listBySchedule(scheduleId, page, limit);
  }

  async getLatestRun(taskId: number): Promise<AiMessageTaskRunEntity | null> {
    await this.ensureConnection();
    return this.model.getLatestByTask(taskId);
  }
}
