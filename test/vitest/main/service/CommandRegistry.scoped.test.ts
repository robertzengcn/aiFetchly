/**
 * Scoped registry accessors (plugin/workspace slash commands — FR-1..FR-3,
 * AC-1, AC-2, AC-7, AC-8, AC-9).
 *
 * listScoped / listScopedViews / getByLookupNameScoped filter commands by an
 * allowed-source set BEFORE applying the existing built-in > workspace > user
 * > plugin precedence. A workspace command only resolves inside chats whose
 * approved workspace matches; it never leaks to another conversation.
 *
 * Pure unit tests — no mocks, no IPC, no Electron.
 */
import { describe, expect, it } from "vitest";
import type { CommandRegistryScope } from "@/entityTypes/slashCommandTypes";
import type { SlashCommandDefinition } from "@/entityTypes/slashCommandTypes";
import {
  CommandRegistry,
  DEFAULT_NON_WORKSPACE_SCOPE,
} from "@/service/slashCommands/CommandRegistry";

// --- Fixtures ----------------------------------------------------------------

function makeCmd(
  overrides: Partial<SlashCommandDefinition> &
    Pick<SlashCommandDefinition, "id" | "name" | "source" | "sourceId">
): SlashCommandDefinition {
  return {
    description: `${overrides.name} command`,
    aliases: [],
    type: "prompt",
    sourceLabel: overrides.source ?? "User",
    requiresTrust: false,
    enabled: true,
    body: `body for ${overrides.id}`,
    metadata: { note: "fixture" },
    ...overrides,
  };
}

const builtinReview = makeCmd({
  id: "built-in:command:review",
  name: "review",
  source: "built-in",
  sourceId: "built-in",
  sourceLabel: "Built-in",
});
const workspaceReviewA = makeCmd({
  id: "workspace:1:command:review",
  name: "review",
  source: "workspace",
  sourceId: "workspace:1",
  sourceLabel: "Workspace A",
});
const workspaceReviewB = makeCmd({
  id: "workspace:2:command:review",
  name: "review",
  source: "workspace",
  sourceId: "workspace:2",
  sourceLabel: "Workspace B",
});
const userReview = makeCmd({
  id: "user:command:review",
  name: "review",
  source: "user",
  sourceId: "user",
  sourceLabel: "User",
});
const pluginReview = makeCmd({
  id: "plugin:demo:command:review",
  name: "review",
  source: "plugin",
  sourceId: "plugin:demo",
  sourceLabel: "Plugin",
});
// A plugin command that also exposes an alias "rev".
const pluginWithAlias = makeCmd({
  id: "plugin:demo:command:research",
  name: "research",
  aliases: ["rev"],
  source: "plugin",
  sourceId: "plugin:demo",
  sourceLabel: "Plugin",
});

const scopeA: CommandRegistryScope = {
  allowedExactSourceIds: new Set(["built-in", "user", "workspace:1"]),
  allowPluginSources: true,
};
const scopeB: CommandRegistryScope = {
  allowedExactSourceIds: new Set(["built-in", "user", "workspace:2"]),
  allowPluginSources: true,
};

// --- listScopedViews: workspace commands do not leak across chats (AC-1) -----

describe("CommandRegistry.listScopedViews (FR-1, AC-1)", () => {
  it("excludes every workspace source when no workspace is in scope", () => {
    const r = new CommandRegistry();
    r.register(workspaceReviewA);
    r.register(userReview);
    const views = r.listScopedViews(DEFAULT_NON_WORKSPACE_SCOPE);
    const ids = views.map((v) => v.id);
    expect(ids).not.toContain("workspace:1:command:review");
    expect(ids).toContain("user:command:review");
  });

  it("includes exactly the scoped workspace source and excludes other workspaces", () => {
    const r = new CommandRegistry();
    r.register(workspaceReviewA);
    r.register(workspaceReviewB);
    const idsA = r.listScopedViews(scopeA).map((v) => v.id);
    const idsB = r.listScopedViews(scopeB).map((v) => v.id);
    expect(idsA).toContain("workspace:1:command:review");
    expect(idsA).not.toContain("workspace:2:command:review");
    expect(idsB).toContain("workspace:2:command:review");
    expect(idsB).not.toContain("workspace:1:command:review");
  });

  it("includes built-in, user, and plugin sources under a normal chat scope", () => {
    const r = new CommandRegistry();
    r.register(builtinReview);
    r.register(userReview);
    r.register(pluginReview);
    const ids = r.listScopedViews(DEFAULT_NON_WORKSPACE_SCOPE).map((v) => v.id);
    expect(ids).toContain("built-in:command:review");
    expect(ids).toContain("user:command:review");
    expect(ids).toContain("plugin:demo:command:review");
  });

  it("omits body and metadata from every scoped view entry (AC-9 / T-13-Leak)", () => {
    const r = new CommandRegistry();
    r.register(userReview);
    r.register(pluginReview);
    const views = r.listScopedViews(DEFAULT_NON_WORKSPACE_SCOPE);
    for (const v of views) {
      expect("body" in v).toBe(false);
      expect("metadata" in v).toBe(false);
    }
  });

  it("returns defensive copies — mutating a scoped view does not affect the registry", () => {
    const r = new CommandRegistry();
    r.register(userReview);
    const list1 = r.listScopedViews(DEFAULT_NON_WORKSPACE_SCOPE);
    (list1[0] as { name?: string }).name = "EVIL";
    const list2 = r.listScopedViews(DEFAULT_NON_WORKSPACE_SCOPE);
    expect(list2[0].name).toBe("review");
  });
});

// --- getByLookupNameScoped: scoped winner selection (FR-2, AC-2/7/8) ---------

describe("CommandRegistry.getByLookupNameScoped (FR-2, AC-2, AC-7, AC-8)", () => {
  it("returns null when the only matching command is a workspace outside scope (AC-2)", () => {
    const r = new CommandRegistry();
    r.register(workspaceReviewA);
    expect(
      r.getByLookupNameScoped("review", DEFAULT_NON_WORKSPACE_SCOPE)
    ).toBeNull();
  });

  it("resolves the workspace command when its workspace is in scope", () => {
    const r = new CommandRegistry();
    r.register(workspaceReviewA);
    expect(r.getByLookupNameScoped("review", scopeA)?.id).toBe(
      "workspace:1:command:review"
    );
  });

  it("does not resolve workspace A's command under workspace B's scope", () => {
    const r = new CommandRegistry();
    r.register(workspaceReviewA);
    expect(r.getByLookupNameScoped("review", scopeB)).toBeNull();
  });

  it("built-in beats workspace/user/plugin even inside a workspace scope (AC-7)", () => {
    const r = new CommandRegistry();
    r.register(pluginReview);
    r.register(workspaceReviewA);
    r.register(userReview);
    r.register(builtinReview);
    expect(r.getByLookupNameScoped("review", scopeA)?.id).toBe(
      "built-in:command:review"
    );
  });

  it("workspace beats user and plugin only when the workspace is in scope (AC-8)", () => {
    const r = new CommandRegistry();
    r.register(pluginReview);
    r.register(userReview);
    r.register(workspaceReviewA);
    // In workspace A's chat -> workspace wins.
    expect(r.getByLookupNameScoped("review", scopeA)?.id).toBe(
      "workspace:1:command:review"
    );
    // In a no-workspace chat -> user beats plugin (workspace excluded).
    expect(
      r.getByLookupNameScoped("review", DEFAULT_NON_WORKSPACE_SCOPE)?.id
    ).toBe("user:command:review");
  });

  it("user beats plugin under a non-workspace scope", () => {
    const r = new CommandRegistry();
    r.register(pluginReview);
    r.register(userReview);
    expect(
      r.getByLookupNameScoped("review", DEFAULT_NON_WORKSPACE_SCOPE)?.id
    ).toBe("user:command:review");
  });

  it("plugin commands are excluded when allowPluginSources is false", () => {
    const r = new CommandRegistry();
    r.register(pluginReview);
    const noPlugins: CommandRegistryScope = {
      allowedExactSourceIds: new Set(["built-in", "user"]),
      allowPluginSources: false,
    };
    expect(r.getByLookupNameScoped("review", noPlugins)).toBeNull();
    expect(r.listScopedViews(noPlugins)).toHaveLength(0);
  });

  it("alias lookup follows source precedence; a primary-name match beats an alias match at the same source", () => {
    const r = new CommandRegistry();
    // Two plugin commands: one named "rev" (primary), one aliased to "rev".
    const pluginRev = makeCmd({
      id: "plugin:demo:command:rev",
      name: "rev",
      source: "plugin",
      sourceId: "plugin:demo",
    });
    r.register(pluginWithAlias); // aliases ["rev"]
    r.register(pluginRev); // primary "rev"
    // Same source rank (plugin) -> primary-name match wins.
    expect(
      r.getByLookupNameScoped("rev", DEFAULT_NON_WORKSPACE_SCOPE)?.id
    ).toBe("plugin:demo:command:rev");
  });

  it("disabled commands are still found scoped (dispatcher surfaces the disabled result)", () => {
    const r = new CommandRegistry();
    r.register({ ...userReview, enabled: false });
    // Found (so the dispatcher can return a readable disabled message, PRD §9.3)
    // even though enabled is false — mirrors getByName semantics.
    expect(
      r.getByLookupNameScoped("review", DEFAULT_NON_WORKSPACE_SCOPE)?.id
    ).toBe("user:command:review");
  });

  it("returns a defensive copy", () => {
    const r = new CommandRegistry();
    r.register(userReview);
    const a = r.getByLookupNameScoped("review", DEFAULT_NON_WORKSPACE_SCOPE);
    const b = r.getByLookupNameScoped("review", DEFAULT_NON_WORKSPACE_SCOPE);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
