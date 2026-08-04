import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { AiMessageTaskEntity } from "@/entity/AiMessageTask.entity";
import { assertNotWorker } from "@/model/workerDbGuard";
import type { CreateChatScheduledTaskRecord } from "@/entityTypes/aiChatScheduledLoopTypes";

export class AiMessageTaskModel extends BaseDb {
  private repository: Repository<AiMessageTaskEntity>;

  constructor(filepath: string) {
    super(filepath);
    this.repository =
      this.sqliteDb.connection.getRepository(AiMessageTaskEntity);
  }

  async create(entity: Partial<AiMessageTaskEntity>): Promise<number> {
    const saved = await this.repository.save(entity);
    return saved.id;
  }

  async update(id: number, data: Partial<AiMessageTaskEntity>): Promise<void> {
    await this.repository.update(id, data);
  }

  async getById(id: number): Promise<AiMessageTaskEntity | null> {
    return this.repository.findOne({ where: { id } });
  }

  async list(
    page = 1,
    limit = 50
  ): Promise<{ items: AiMessageTaskEntity[]; total: number }> {
    const [items, total] = await this.repository.findAndCount({
      where: { status: "active" },
      order: { id: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, total };
  }

  async deleteById(id: number): Promise<void> {
    await this.repository.update(id, { status: "deleted" });
  }

  async updateLastRun(
    id: number,
    resultSummary: string | null,
    errorMessage: string | null
  ): Promise<void> {
    await this.repository.update(id, {
      last_run_time: new Date(),
      last_result_summary: resultSummary ?? undefined,
      last_error_message: errorMessage ?? undefined,
    });
  }

  // ----- Chat-bound scheduled-loop task operations (technical-design §10.2) -----

  /**
   * Create a chat-bound scheduled AI message task. Requires a v2-* conversation
   * and never generates a fallback conversation id (unlike the standalone
   * schedule-page path).
   */
  async createChatScheduledTask(
    input: CreateChatScheduledTaskRecord
  ): Promise<number> {
    assertNotWorker("createChatScheduledTask");
    const entity = new AiMessageTaskEntity();
    entity.name = input.name;
    entity.message = input.message;
    entity.system_prompt = "";
    entity.model = input.model ?? "auto";
    entity.conversation_id = input.conversationId;
    entity.allowed_tools_json = JSON.stringify(input.allowedTools);
    entity.auto_approve_tools = input.autoApproveTools;
    entity.max_tool_calls = input.maxToolCalls;
    entity.max_runtime_ms = input.maxRuntimeMs;
    entity.max_continue_calls = input.maxContinueCalls;
    entity.status = "active";
    entity.source_type = input.sourceType;
    const saved = await this.repository.save(entity);
    return saved.id;
  }

  /** Find a chat-bound scheduled task by id. */
  async findChatScheduledTask(id: number): Promise<AiMessageTaskEntity | null> {
    assertNotWorker("findChatScheduledTask");
    return this.repository.findOne({ where: { id } });
  }

  /** Mark a chat-bound scheduled task inactive (history kept). */
  async deactivateChatScheduledTask(id: number): Promise<void> {
    assertNotWorker("deactivateChatScheduledTask");
    await this.repository.update(id, { status: "inactive" });
  }
}
