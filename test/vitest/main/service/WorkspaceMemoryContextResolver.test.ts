import { describe, expect, it, vi } from "vitest";
import { WorkspaceMemoryContextResolver } from "@/service/WorkspaceMemoryContextResolver";
import type { WorkspaceResolver } from "@/service/WorkspaceResolver";

function makeResolver(
  resolveWithKey: ReturnType<typeof vi.fn>
): WorkspaceResolver {
  return { resolveWithKey } as unknown as WorkspaceResolver;
}

describe("WorkspaceMemoryContextResolver", () => {
  it("returns null without calling WorkspaceResolver when conversationId is empty", async () => {
    const resolveWithKey = vi.fn();
    const resolver = new WorkspaceMemoryContextResolver(
      makeResolver(resolveWithKey)
    );

    await expect(resolver.resolveForConversation("")).resolves.toBeNull();
    expect(resolveWithKey).not.toHaveBeenCalled();
  });

  it("returns null when the conversation has no approved keyed workspace", async () => {
    const resolveWithKey = vi.fn().mockResolvedValue(null);
    const resolver = new WorkspaceMemoryContextResolver(
      makeResolver(resolveWithKey)
    );

    await expect(
      resolver.resolveForConversation("conv-pending")
    ).resolves.toBeNull();
    expect(resolveWithKey).toHaveBeenCalledWith("conv-pending");
  });

  it("maps an approved workspace into the memory context using canonical root path", async () => {
    const resolveWithKey = vi.fn().mockResolvedValue({
      workspaceId: 42,
      conversationId: "conv-1",
      rootPath: "/selected/app",
      canonicalRootPath: "/repo",
      workspaceKey: "ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      displayName: "Repo",
    });
    const resolver = new WorkspaceMemoryContextResolver(
      makeResolver(resolveWithKey)
    );

    await expect(resolver.resolveForConversation("conv-1")).resolves.toEqual({
      conversationId: "conv-1",
      workspaceId: 42,
      workspaceKey: "ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      workspaceRoot: "/repo",
      displayName: "Repo",
    });
  });
});
