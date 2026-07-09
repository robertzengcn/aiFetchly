import { AIWorkspaceMemoryModule } from "@/modules/AIWorkspaceMemoryModule";
import { WorkspaceMemoryContextResolver } from "@/service/WorkspaceMemoryContextResolver";
import type {
  AIWorkspaceMemoryCreateInput,
  AIWorkspaceMemoryUpdateInput,
  AIWorkspaceMemorySearchInput,
  AIWorkspaceMemoryView,
} from "@/entityTypes/aiWorkspaceMemoryTypes";

const NO_WORKSPACE_MESSAGE =
  "Choose an approved workspace before using workspace memory.";

/**
 * Renderer-facing, conversation-aware facade over the workspace-memory module.
 *
 * Every public method resolves the workspace from the input `conversationId`
 * via {@link WorkspaceMemoryContextResolver} (main-process only) and then
 * delegates to the module with the trusted scope. A renderer-supplied
 * `workspaceKey` is never used for memory access.
 */
export class AIWorkspaceMemoryService {
  private readonly resolver: WorkspaceMemoryContextResolver;
  private readonly memoryModule: AIWorkspaceMemoryModule;

  constructor(
    resolver: WorkspaceMemoryContextResolver = new WorkspaceMemoryContextResolver(),
    memoryModule: AIWorkspaceMemoryModule = new AIWorkspaceMemoryModule()
  ) {
    this.resolver = resolver;
    this.memoryModule = memoryModule;
  }

  async list(
    input: AIWorkspaceMemorySearchInput
  ): Promise<AIWorkspaceMemoryView[]> {
    const ctx = await this.requireContext(input.conversationId);
    const { conversationId: _conversationId, ...rest } = input;
    void _conversationId;
    return this.memoryModule.listMemories(ctx, rest);
  }

  async createManualMemory(
    input: AIWorkspaceMemoryCreateInput
  ): Promise<AIWorkspaceMemoryView> {
    const ctx = await this.requireContext(input.conversationId);
    const { conversationId: _conversationId, ...rest } = input;
    void _conversationId;
    return this.memoryModule.createMemory(ctx, {
      ...rest,
      sourceKind: "manual",
    });
  }

  async update(
    input: AIWorkspaceMemoryUpdateInput
  ): Promise<AIWorkspaceMemoryView> {
    const ctx = await this.requireContext(input.conversationId);
    const { conversationId: _conversationId, ...rest } = input;
    void _conversationId;
    return this.memoryModule.updateMemory(ctx, rest);
  }

  async archive(conversationId: string, memoryId: string): Promise<void> {
    const ctx = await this.requireContext(conversationId);
    return this.memoryModule.archiveMemory(ctx, memoryId);
  }

  async delete(conversationId: string, memoryId: string): Promise<number> {
    const ctx = await this.requireContext(conversationId);
    return this.memoryModule.deleteMemory(ctx, memoryId);
  }

  private async requireContext(conversationId: string) {
    const ctx = await this.resolver.resolveForConversation(conversationId);
    if (!ctx) {
      throw new Error(NO_WORKSPACE_MESSAGE);
    }
    return ctx;
  }
}
