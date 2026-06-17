// src/modules/AgentTaskModule.ts
import { BaseModule } from "@/modules/baseModule";
import { AgentTaskModel } from "@/model/AgentTask.model";
import { AgentToolCallModel } from "@/model/AgentToolCall.model";
import type {
  AgentResult,
  AgentTaskMessageRecord,
  AgentTaskPacket,
  AgentTaskSnapshot,
  AgentTaskStatus,
  AgentToolCallRecord,
} from "@/entityTypes/agentTypes";

export class AgentTaskModule extends BaseModule {
  private readonly taskModel: AgentTaskModel;
  private readonly toolCallModel: AgentToolCallModel;

  constructor() {
    super();
    this.taskModel = new AgentTaskModel(this.dbpath);
    this.toolCallModel = new AgentToolCallModel(this.dbpath);
  }

  async createTask(input: {
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
    await this.ensureConnection();
    await this.taskModel.create(input);
  }

  async setStatus(
    agentTaskId: string,
    status: AgentTaskStatus,
    extra?: { errorMessage?: string; startedAt?: Date; finishedAt?: Date }
  ): Promise<void> {
    await this.ensureConnection();
    await this.taskModel.setStatus(agentTaskId, status, extra);
  }

  async saveResult(agentTaskId: string, result: AgentResult): Promise<void> {
    await this.ensureConnection();
    await this.taskModel.saveResult(agentTaskId, result);
  }

  async incrementToolCalls(agentTaskId: string): Promise<void> {
    await this.ensureConnection();
    await this.taskModel.incrementToolCalls(agentTaskId);
  }

  async getSnapshot(agentTaskId: string): Promise<AgentTaskSnapshot | null> {
    await this.ensureConnection();
    return this.taskModel.getSnapshot(agentTaskId);
  }

  async appendMessage(record: AgentTaskMessageRecord): Promise<void> {
    await this.ensureConnection();
    await this.taskModel.appendMessage(record);
  }

  async listMessages(agentTaskId: string): Promise<AgentTaskMessageRecord[]> {
    await this.ensureConnection();
    return this.taskModel.listMessages(agentTaskId);
  }

  async saveToolCall(record: AgentToolCallRecord): Promise<void> {
    await this.ensureConnection();
    await this.toolCallModel.save(record);
  }

  async listToolCalls(agentTaskId: string): Promise<AgentToolCallRecord[]> {
    await this.ensureConnection();
    return this.toolCallModel.listByTask(agentTaskId);
  }
}
