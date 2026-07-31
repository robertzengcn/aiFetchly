/**
 * SlashCommandScopeResolver (FR-1..FR-3, design §6).
 *
 * Maps conversationId -> approved workspace -> allowed source ids. Workspace
 * commands are included only when the conversation has that approved
 * workspace; otherwise the scope is built-in + user + plugin only.
 *
 * The workspace lookup is injected, so these are pure unit tests — no DB.
 */
import { describe, expect, it } from "vitest";
import type { WorkspaceRecord } from "@/entityTypes/workspaceTypes";
import {
  WorkspaceSlashCommandScopeResolver,
  nonWorkspaceSlashCommandScopeResolver,
} from "@/service/slashCommands/SlashCommandScopeResolver";

function workspaceRecord(id: number, rootPath = `/tmp/ws-${id}`): WorkspaceRecord {
  return {
    id,
    conversationId: "conv-1",
    rootPath,
    label: null,
    approvalState: "approved",
    createdAt: "2026-01-01T00:00:00.000Z",
    approvedAt: "2026-01-01T00:00:00.000Z",
    revokedAt: null,
  };
}

describe("WorkspaceSlashCommandScopeResolver", () => {
  it("returns a non-workspace scope when conversationId is absent", async () => {
    const resolver = new WorkspaceSlashCommandScopeResolver(async () => null);
    const res = await resolver.resolve(undefined);
    expect(res.commandScope.allowedExactSourceIds.has("built-in")).toBe(true);
    expect(res.commandScope.allowedExactSourceIds.has("user")).toBe(true);
    expect(res.commandScope.allowPluginSources).toBe(true);
    // No workspace source.
    expect(
      [...res.commandScope.allowedExactSourceIds].some((s) =>
        s.startsWith("workspace:")
      )
    ).toBe(false);
    expect(res.activeWorkspaceId).toBeUndefined();
  });

  it("returns a non-workspace scope when conversationId is empty", async () => {
    const resolver = new WorkspaceSlashCommandScopeResolver(async () =>
      workspaceRecord(99)
    );
    const res = await resolver.resolve("");
    expect(
      [...res.commandScope.allowedExactSourceIds].some((s) =>
        s.startsWith("workspace:")
      )
    ).toBe(false);
  });

  it("returns a non-workspace scope when no workspace is approved (null)", async () => {
    const resolver = new WorkspaceSlashCommandScopeResolver(async () => null);
    const res = await resolver.resolve("conv-1");
    expect(
      [...res.commandScope.allowedExactSourceIds].some((s) =>
        s.startsWith("workspace:")
      )
    ).toBe(false);
    expect(res.activeWorkspaceId).toBeUndefined();
  });

  it("includes exactly the approved workspace source plus built-in/user", async () => {
    const resolver = new WorkspaceSlashCommandScopeResolver(async () =>
      workspaceRecord(42, "/projects/alpha")
    );
    const res = await resolver.resolve("conv-1");
    expect(res.commandScope.allowedExactSourceIds.has("workspace:42")).toBe(true);
    expect(res.commandScope.allowedExactSourceIds.has("workspace:1")).toBe(false);
    expect(res.commandScope.allowPluginSources).toBe(true);
    expect(res.activeWorkspaceId).toBe("42");
    expect(res.activeWorkspaceRoot).toBe("/projects/alpha");
  });

  it("fails closed (non-workspace scope) when the workspace lookup throws", async () => {
    const resolver = new WorkspaceSlashCommandScopeResolver(async () => {
      throw new Error("DB unavailable");
    });
    const res = await resolver.resolve("conv-1");
    expect(
      [...res.commandScope.allowedExactSourceIds].some((s) =>
        s.startsWith("workspace:")
      )
    ).toBe(false);
  });

  it("each conversation resolves against its own workspace id (no cross-conversation leak)", async () => {
    const byConv = new Map<string, WorkspaceRecord>([
      ["conv-A", workspaceRecord(1)],
      ["conv-B", workspaceRecord(2)],
    ]);
    const resolver = new WorkspaceSlashCommandScopeResolver(
      async (id) => byConv.get(id) ?? null
    );
    const a = await resolver.resolve("conv-A");
    const b = await resolver.resolve("conv-B");
    expect(a.commandScope.allowedExactSourceIds.has("workspace:1")).toBe(true);
    expect(a.commandScope.allowedExactSourceIds.has("workspace:2")).toBe(false);
    expect(b.commandScope.allowedExactSourceIds.has("workspace:2")).toBe(true);
    expect(b.commandScope.allowedExactSourceIds.has("workspace:1")).toBe(false);
  });
});

describe("nonWorkspaceSlashCommandScopeResolver (module default)", () => {
  it("always returns a non-workspace scope regardless of conversationId", async () => {
    const a = await nonWorkspaceSlashCommandScopeResolver.resolve("conv-1");
    const b = await nonWorkspaceSlashCommandScopeResolver.resolve(undefined);
    expect(
      [...a.commandScope.allowedExactSourceIds].some((s) =>
        s.startsWith("workspace:")
      )
    ).toBe(false);
    expect(
      [...b.commandScope.allowedExactSourceIds].some((s) =>
        s.startsWith("workspace:")
      )
    ).toBe(false);
    expect(a.commandScope.allowPluginSources).toBe(true);
  });
});
