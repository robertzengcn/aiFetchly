import { BaseModule } from "./baseModule";
import { AiMessageTaskModel } from "@/model/AiMessageTask.model";
import { AiMessageTaskEntity } from "@/entity/AiMessageTask.entity";
import {
  AI_MESSAGE_TASK_DEFAULTS,
  type CreateAiMessageTaskRequest,
  type UpdateAiMessageTaskRequest,
  type AiMessageTaskStatus,
} from "@/entityTypes/aiMessageTaskTypes";

function generateConversationId(): string {
  return `ai-msg-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
}

export class AiMessageTaskModule extends BaseModule {
  private model: AiMessageTaskModel;

  constructor() {
    super();
    this.model = new AiMessageTaskModel(this.dbpath);
  }

  async createTask(
    request: CreateAiMessageTaskRequest
  ): Promise<number> {
    await this.ensureConnection();

    if (!request.message || request.message.trim().length === 0) {
      throw new Error("Message is required");
    }
    if (!request.name || request.name.trim().length === 0) {
      throw new Error("Name is required");
    }

    const allowedTools = request.allowedTools ?? AI_MESSAGE_TASK_DEFAULTS.allowedTools;

    const entity: Partial<AiMessageTaskEntity> = {
      name: request.name.trim(),
      description: request.description?.trim() ?? null,
      message: request.message.trim(),
      system_prompt: request.systemPrompt?.trim() ?? null,
      model: request.model ?? null,
      conversation_id: request.conversationId || generateConversationId(),
      allowed_tools_json: JSON.stringify(allowedTools),
      auto_approve_tools:
        request.autoApproveTools ?? AI_MESSAGE_TASK_DEFAULTS.autoApproveTools,
      max_tool_calls:
        request.maxToolCalls ?? AI_MESSAGE_TASK_DEFAULTS.maxToolCalls,
      max_runtime_ms:
        request.maxRuntimeMs ?? AI_MESSAGE_TASK_DEFAULTS.maxRuntimeMs,
      max_continue_calls:
        request.maxContinueCalls ?? AI_MESSAGE_TASK_DEFAULTS.maxContinueCalls,
      status: "active",
    };

    return this.model.create(entity);
  }

  async updateTask(request: UpdateAiMessageTaskRequest): Promise<void> {
    await this.ensureConnection();

    const existing = await this.model.getById(request.id);
    if (!existing) {
      throw new Error(`AI message task ${request.id} not found`);
    }

    const updates: Partial<AiMessageTaskEntity> = {};

    if (request.name !== undefined) updates.name = request.name.trim();
    if (request.description !== undefined)
      updates.description = request.description?.trim() ?? null;
    if (request.message !== undefined) updates.message = request.message.trim();
    if (request.systemPrompt !== undefined)
      updates.system_prompt = request.systemPrompt?.trim() ?? null;
    if (request.model !== undefined) updates.model = request.model;
    if (request.conversationId !== undefined)
      updates.conversation_id = request.conversationId;
    if (request.allowedTools !== undefined)
      updates.allowed_tools_json = JSON.stringify(request.allowedTools);
    if (request.autoApproveTools !== undefined)
      updates.auto_approve_tools = request.autoApproveTools;
    if (request.maxToolCalls !== undefined)
      updates.max_tool_calls = request.maxToolCalls;
    if (request.maxRuntimeMs !== undefined)
      updates.max_runtime_ms = request.maxRuntimeMs;
    if (request.maxContinueCalls !== undefined)
      updates.max_continue_calls = request.maxContinueCalls;
    if (request.status !== undefined) updates.status = request.status;

    await this.model.update(request.id, updates);
  }

  async getTask(id: number): Promise<AiMessageTaskEntity | null> {
    await this.ensureConnection();
    return this.model.getById(id);
  }

  async listTasks(
    page = 1,
    limit = 50
  ): Promise<{ items: AiMessageTaskEntity[]; total: number }> {
    await this.ensureConnection();
    return this.model.list(page, limit);
  }

  async deleteTask(id: number): Promise<void> {
    await this.ensureConnection();

    const existing = await this.model.getById(id);
    if (!existing) {
      throw new Error(`AI message task ${id} not found`);
    }

    await this.model.deleteById(id);
  }

  async updateLastRunResult(
    id: number,
    resultSummary: string | null,
    errorMessage: string | null
  ): Promise<void> {
    await this.ensureConnection();
    await this.model.updateLastRun(id, resultSummary, errorMessage);
  }

  /** Parse and return the allowed tools list from JSON. */
  parseAllowedTools(task: AiMessageTaskEntity): readonly string[] {
    try {
      return JSON.parse(task.allowed_tools_json ?? "[]") as string[];
    } catch {
      return [];
    }
  }
}
