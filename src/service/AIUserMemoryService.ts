import { AIUserMemoryModule } from "@/modules/AIUserMemoryModule";
import type {
  AIUserMemoryCreateInput,
  AIUserMemoryUpdateInput,
  AIUserMemorySearchInput,
  AIUserMemoryView,
  AIUserMemoryType,
} from "@/entityTypes/aiUserMemoryTypes";

export interface AIUserMemoryServiceDeps {
  isAIEnabled?: () => boolean;
}

export class AIUserMemoryService {
  private readonly memoryModule: AIUserMemoryModule;
  private readonly isAIEnabled: () => boolean;

  constructor(deps?: AIUserMemoryServiceDeps) {
    this.memoryModule = new AIUserMemoryModule();
    this.isAIEnabled =
      deps?.isAIEnabled ??
      (() => {
        // Lazy require so tests don't need Electron settings.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Token } = require("@/modules/token") as {
          Token: new () => { getValue: (k: string) => string };
        };
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { USER_AI_ENABLED } = require("@/config/usersetting") as {
          USER_AI_ENABLED: string;
        };
        return new Token().getValue(USER_AI_ENABLED) === "true";
      });
  }

  async createManualMemory(
    input: AIUserMemoryCreateInput
  ): Promise<AIUserMemoryView> {
    return this.memoryModule.createMemory({ ...input, sourceKind: "manual" });
  }

  async rememberFromAssistant(input: {
    title: string;
    content: string;
    type?: AIUserMemoryType;
    conversationId?: string;
    sourceMessageIds?: string[];
  }): Promise<AIUserMemoryView> {
    if (!this.isAIEnabled()) {
      throw new Error("AI is not enabled");
    }
    return this.memoryModule.createMemory({
      type: input.type ?? "preference",
      title: input.title,
      content: input.content,
      sourceKind: "chat_v2",
      sourceConversationId: input.conversationId,
      sourceMessageIds: input.sourceMessageIds,
    });
  }

  async list(
    input: AIUserMemorySearchInput
  ): Promise<AIUserMemoryView[]> {
    return this.memoryModule.listMemories(input);
  }

  async update(
    input: AIUserMemoryUpdateInput
  ): Promise<AIUserMemoryView> {
    return this.memoryModule.updateMemory(input);
  }

  async archive(memoryId: string): Promise<void> {
    return this.memoryModule.archiveMemory(memoryId);
  }

  async delete(memoryId: string): Promise<number> {
    return this.memoryModule.deleteMemory(memoryId);
  }
}
