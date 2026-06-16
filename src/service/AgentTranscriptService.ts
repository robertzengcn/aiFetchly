// src/service/AgentTranscriptService.ts
import type { AgentTaskModule } from "@/modules/AgentTaskModule";
import type {
  AgentToolCallRecord,
  AgentTaskMessageRecord,
} from "@/entityTypes/agentTypes";

/**
 * Adapter that converts agent runtime events into durable transcript rows.
 * Pure delegation — no branching logic worth unit-testing in isolation.
 */
export class AgentTranscriptService {
  constructor(private readonly taskModule: AgentTaskModule) {}

  async appendAssistantText(
    agentTaskId: string,
    content: string
  ): Promise<void> {
    const record: AgentTaskMessageRecord = {
      agentTaskId,
      role: "assistant",
      content,
    };
    await this.taskModule.appendMessage(record);
  }

  async appendSystemText(agentTaskId: string, content: string): Promise<void> {
    await this.taskModule.appendMessage({
      agentTaskId,
      role: "system",
      content,
    });
  }

  async appendToolMessage(
    agentTaskId: string,
    toolCallId: string,
    content: string
  ): Promise<void> {
    await this.taskModule.appendMessage({
      agentTaskId,
      role: "tool",
      content,
      toolCallId,
    });
  }

  async recordToolCall(record: AgentToolCallRecord): Promise<void> {
    await this.taskModule.saveToolCall(record);
  }
}
