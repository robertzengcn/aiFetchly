import { describe, expect, it, vi } from "vitest";
import { AIWorkspaceMemoryService } from "@/service/AIWorkspaceMemoryService";
import type { WorkspaceMemoryContextResolver } from "@/service/WorkspaceMemoryContextResolver";
import type { AIWorkspaceMemoryModule } from "@/modules/AIWorkspaceMemoryModule";
import type {
  AIWorkspaceMemoryCreateInput,
  AIWorkspaceMemoryUpdateInput,
} from "@/entityTypes/aiWorkspaceMemoryTypes";

const TRUSTED_CONTEXT = {
  conversationId: "conv-1",
  workspaceId: 7,
  workspaceKey: "ws_trustedtrustedtrustedtrustedtru",
  workspaceRoot: "/trusted/repo",
  displayName: "Trusted Repo",
};

function makeService() {
  const resolveForConversation = vi.fn().mockResolvedValue(TRUSTED_CONTEXT);
  const listMemories = vi.fn().mockResolvedValue([]);
  const createMemory = vi.fn().mockResolvedValue({ memoryId: "wmem-1" });
  const updateMemory = vi.fn().mockResolvedValue({ memoryId: "wmem-1" });
  const archiveMemory = vi.fn().mockResolvedValue(undefined);
  const deleteMemory = vi.fn().mockResolvedValue(1);

  const resolver = {
    resolveForConversation,
  } as unknown as WorkspaceMemoryContextResolver;
  const module = {
    listMemories,
    createMemory,
    updateMemory,
    archiveMemory,
    deleteMemory,
  } as unknown as AIWorkspaceMemoryModule;

  return {
    service: new AIWorkspaceMemoryService(resolver, module),
    resolveForConversation,
    listMemories,
    createMemory,
    updateMemory,
    archiveMemory,
    deleteMemory,
  };
}

describe("AIWorkspaceMemoryService", () => {
  it("rejects operations when no approved workspace context exists", async () => {
    const s = makeService();
    s.resolveForConversation.mockResolvedValue(null);

    await expect(
      s.service.list({ conversationId: "conv-without-workspace" })
    ).rejects.toThrow(/approved workspace/i);
    expect(s.listMemories).not.toHaveBeenCalled();
  });

  it("lists using the main-process resolved workspace scope, not renderer hints", async () => {
    const s = makeService();
    const input = {
      conversationId: "conv-1",
      query: "sqlite",
      status: "active",
      workspaceKey: "ws_forged_by_renderer",
    } as unknown as Parameters<AIWorkspaceMemoryService["list"]>[0];

    await s.service.list(input);

    expect(s.resolveForConversation).toHaveBeenCalledWith("conv-1");
    expect(s.listMemories).toHaveBeenCalledWith(TRUSTED_CONTEXT, {
      query: "sqlite",
      status: "active",
    });
  });

  it("forces manual source kind when creating through the manual service path", async () => {
    const s = makeService();
    const input = {
      conversationId: "conv-1",
      type: "decision",
      title: "Use SQLite",
      content: "Store workspace memory in SQLite.",
      sourceKind: "auto_dream",
      workspaceKey: "ws_forged_by_renderer",
    } as AIWorkspaceMemoryCreateInput & { workspaceKey: string };

    await s.service.createManualMemory(input);

    expect(s.createMemory).toHaveBeenCalledWith(
      TRUSTED_CONTEXT,
      expect.objectContaining({
        type: "decision",
        title: "Use SQLite",
        content: "Store workspace memory in SQLite.",
        sourceKind: "manual",
      })
    );
  });

  it("updates, archives, and deletes only after resolving the trusted conversation scope", async () => {
    const s = makeService();
    const update = {
      conversationId: "conv-1",
      memoryId: "wmem-1",
      content: "Updated rule.",
      workspaceKey: "ws_forged_by_renderer",
    } as AIWorkspaceMemoryUpdateInput & { workspaceKey: string };

    await s.service.update(update);
    await s.service.archive("conv-1", "wmem-1");
    await s.service.delete("conv-1", "wmem-1");

    expect(s.updateMemory).toHaveBeenCalledWith(
      TRUSTED_CONTEXT,
      expect.objectContaining({ memoryId: "wmem-1", content: "Updated rule." })
    );
    expect(s.archiveMemory).toHaveBeenCalledWith(TRUSTED_CONTEXT, "wmem-1");
    expect(s.deleteMemory).toHaveBeenCalledWith(TRUSTED_CONTEXT, "wmem-1");
    expect(s.resolveForConversation).toHaveBeenCalledTimes(3);
  });
});
