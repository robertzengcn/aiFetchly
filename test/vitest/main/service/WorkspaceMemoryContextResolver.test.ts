import { describe, expect, it, vi } from "vitest";
import { WorkspaceMemoryContextResolver } from "@/service/WorkspaceMemoryContextResolver";
import type { WorkspaceResolver } from "@/service/WorkspaceResolver";
import type { WorkspaceMemoryScopeResolver } from "@/service/WorkspaceMemoryScopeResolver";

function makeResolver(
  resolveWithKey: ReturnType<typeof vi.fn>
): WorkspaceResolver {
  return { resolveWithKey } as unknown as WorkspaceResolver;
}

function makeScopeResolver(
  resolveForWorkspace: ReturnType<typeof vi.fn>
): WorkspaceMemoryScopeResolver {
  return {
    resolveForWorkspace,
  } as unknown as WorkspaceMemoryScopeResolver;
}

describe("WorkspaceMemoryContextResolver", () => {
  it("returns null without calling WorkspaceResolver when conversationId is empty", async () => {
    const resolveWithKey = vi.fn();
    const resolver = new WorkspaceMemoryContextResolver(
      makeResolver(resolveWithKey),
      makeScopeResolver(vi.fn())
    );

    await expect(resolver.resolveForConversation("")).resolves.toBeNull();
    expect(resolveWithKey).not.toHaveBeenCalled();
  });

  it("returns null when the conversation has no approved keyed workspace", async () => {
    const resolveWithKey = vi.fn().mockResolvedValue(null);
    const resolver = new WorkspaceMemoryContextResolver(
      makeResolver(resolveWithKey),
      makeScopeResolver(vi.fn())
    );

    await expect(
      resolver.resolveForConversation("conv-pending")
    ).resolves.toBeNull();
    expect(resolveWithKey).toHaveBeenCalledWith("conv-pending");
  });

  it("maps an approved workspace into the memory context with its internal scope id", async () => {
    const resolveWithKey = vi.fn().mockResolvedValue({
      workspaceId: 42,
      conversationId: "conv-1",
      rootPath: "/selected/app",
      canonicalRootPath: "/repo",
      workspaceKey: "ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      displayName: "Repo",
    });
    const resolveForWorkspace = vi.fn().mockResolvedValue({
      scopeId: "wscope-legacy-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      workspaceKey: "ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      workspaceRoot: "/repo",
      displayName: "Repo",
      portableEnabled: false,
      importPolicy: "review-new",
    });
    const resolver = new WorkspaceMemoryContextResolver(
      makeResolver(resolveWithKey),
      makeScopeResolver(resolveForWorkspace)
    );

    await expect(resolver.resolveForConversation("conv-1")).resolves.toEqual({
      conversationId: "conv-1",
      workspaceId: 42,
      workspaceKey: "ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      workspaceRoot: "/repo",
      displayName: "Repo",
      scopeId: "wscope-legacy-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    expect(resolveForWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceKey: "ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      })
    );
  });

  it("still resolves the legacy context when scope resolution fails", async () => {
    const resolveWithKey = vi.fn().mockResolvedValue({
      workspaceId: 42,
      conversationId: "conv-1",
      rootPath: "/selected/app",
      canonicalRootPath: "/repo",
      workspaceKey: "ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      displayName: "Repo",
    });
    const resolveForWorkspace = vi.fn().mockRejectedValue(new Error("db down"));
    const resolver = new WorkspaceMemoryContextResolver(
      makeResolver(resolveWithKey),
      makeScopeResolver(resolveForWorkspace)
    );

    await expect(resolver.resolveForConversation("conv-1")).resolves.toEqual({
      conversationId: "conv-1",
      workspaceId: 42,
      workspaceKey: "ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      workspaceRoot: "/repo",
      displayName: "Repo",
      scopeId: undefined,
    });
  });
});
