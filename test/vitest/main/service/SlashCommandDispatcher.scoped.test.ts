/**
 * SlashCommandDispatcher scoped dispatch (plugin/workspace slash commands —
 * FR-2, AC-2, AC-8, and scoped /help per design §8.4).
 *
 * Verifies that dispatch + /help honor the conversation scope: a workspace
 * command resolves only inside its workspace's scope and is reported unknown
 * elsewhere; plugin commands resolve under the default non-workspace scope;
 * aliases resolve scoped.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type {
  CommandRegistryScope,
  SlashCommandDefinition,
} from "@/entityTypes/slashCommandTypes";
import { CommandRegistry } from "@/service/slashCommands/CommandRegistry";
import { DEFAULT_NON_WORKSPACE_SCOPE } from "@/service/slashCommands/CommandRegistry";
import { registerBuiltInSlashCommands } from "@/service/slashCommands/builtinSlashCommands";
import { SlashCommandDispatcher } from "@/service/slashCommands/SlashCommandDispatcher";
import { AIFetchlyConfigManager } from "@/service/aifetchlyConfig/AIFetchlyConfigManager";

function buildDispatcher(): {
  registry: CommandRegistry;
  dispatcher: SlashCommandDispatcher;
  tmpRoot: string;
} {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "slash-scoped-"));
  const manager = new AIFetchlyConfigManager({ rootPath: tmpRoot });
  const registry = manager.getCommandRegistry();
  registerBuiltInSlashCommands(registry);
  const dispatcher = new SlashCommandDispatcher(registry, manager);
  return { registry, dispatcher, tmpRoot };
}

function workspaceReview(): SlashCommandDefinition {
  return {
    id: "workspace:7:command:review",
    name: "review",
    description: "Review workspace changes",
    aliases: ["code-review"],
    type: "prompt",
    source: "workspace",
    sourceId: "workspace:7",
    sourceLabel: "Workspace",
    requiresTrust: false,
    enabled: true,
    body: "Review the workspace changes: $ARGUMENTS",
  };
}

function pluginShip(): SlashCommandDefinition {
  return {
    id: "plugin:demo:command:ship",
    name: "ship",
    description: "Ship it",
    aliases: [],
    type: "prompt",
    source: "plugin",
    sourceId: "plugin:demo",
    sourceLabel: "Plugin",
    requiresTrust: false,
    enabled: true,
    body: "Ship: $ARGUMENTS",
  };
}

const workspaceScope: CommandRegistryScope = {
  allowedExactSourceIds: new Set(["built-in", "user", "workspace:7"]),
  allowPluginSources: true,
};

describe("SlashCommandDispatcher scoped dispatch (FR-2, AC-2, AC-8)", () => {
  it("a workspace prompt command is UNKNOWN outside its workspace scope (AC-2)", async () => {
    const { registry, dispatcher } = buildDispatcher();
    registry.register(workspaceReview());
    const r = await dispatcher.dispatch(
      { conversationId: "conv-1", rawInput: "/review src/a" },
      { scope: DEFAULT_NON_WORKSPACE_SCOPE }
    );
    expect(r.status).toBe(false);
    if (r.status) throw new Error("expected failure");
    expect(r.msg).toMatch(/Unknown/i);
  });

  it("a workspace prompt command expands to submit_prompt inside its workspace scope", async () => {
    const { registry, dispatcher } = buildDispatcher();
    registry.register(workspaceReview());
    const r = await dispatcher.dispatch(
      { conversationId: "conv-1", rawInput: "/review src/a" },
      { scope: workspaceScope }
    );
    expect(r.status).toBe(true);
    if (!r.status || r.action !== "submit_prompt") {
      throw new Error("expected submit_prompt");
    }
    expect(r.commandId).toBe("workspace:7:command:review");
    expect(r.prompt).toBe("Review the workspace changes: src/a");
  });

  it("dispatch with no context falls back to the safe non-workspace scope", async () => {
    const { registry, dispatcher } = buildDispatcher();
    registry.register(workspaceReview());
    // No context arg -> default non-workspace scope -> workspace cmd unknown.
    const r = await dispatcher.dispatch({
      conversationId: "conv-1",
      rawInput: "/review x",
    });
    expect(r.status).toBe(false);
  });

  it("a plugin command resolves under the default non-workspace scope (allowPluginSources)", async () => {
    const { registry, dispatcher } = buildDispatcher();
    registry.register(pluginShip());
    const r = await dispatcher.dispatch({
      conversationId: "conv-1",
      rawInput: "/ship v1",
    });
    expect(r.status).toBe(true);
    if (!r.status || r.action !== "submit_prompt") {
      throw new Error("expected submit_prompt");
    }
    expect(r.commandId).toBe("plugin:demo:command:ship");
    expect(r.prompt).toBe("Ship: v1");
  });

  it("a built-in still resolves inside a workspace scope (AC-7)", async () => {
    const { dispatcher } = buildDispatcher();
    const r = await dispatcher.dispatch(
      { conversationId: "conv-1", rawInput: "/clear" },
      { scope: workspaceScope }
    );
    expect(r.status).toBe(true);
  });

  it("an alias resolves scoped to the workspace command inside its scope", async () => {
    const { registry, dispatcher } = buildDispatcher();
    registry.register(workspaceReview()); // aliases: ["code-review"]
    const r = await dispatcher.dispatch(
      { conversationId: "conv-1", rawInput: "/code-review src/b" },
      { scope: workspaceScope }
    );
    expect(r.status).toBe(true);
    if (!r.status || r.action !== "submit_prompt") {
      throw new Error("expected submit_prompt");
    }
    expect(r.commandId).toBe("workspace:7:command:review");
  });

  it("the alias does NOT resolve outside the workspace scope", async () => {
    const { registry, dispatcher } = buildDispatcher();
    registry.register(workspaceReview());
    const r = await dispatcher.dispatch(
      { conversationId: "conv-1", rawInput: "/code-review src/b" },
      { scope: DEFAULT_NON_WORKSPACE_SCOPE }
    );
    expect(r.status).toBe(false);
  });
});

describe("SlashCommandDispatcher scoped /help (design §8.4)", () => {
  it("/help lists the workspace command only inside its workspace scope", async () => {
    const { registry, dispatcher } = buildDispatcher();
    registry.register(workspaceReview());

    const inScope = await dispatcher.dispatch(
      { conversationId: "conv-1", rawInput: "/help" },
      { scope: workspaceScope }
    );
    if (!inScope.status || inScope.action !== "show_result") {
      throw new Error("expected show_result");
    }
    expect(inScope.content).toContain("/review");

    const outOfScope = await dispatcher.dispatch(
      { conversationId: "conv-1", rawInput: "/help" },
      { scope: DEFAULT_NON_WORKSPACE_SCOPE }
    );
    if (!outOfScope.status || outOfScope.action !== "show_result") {
      throw new Error("expected show_result");
    }
    expect(outOfScope.content).not.toContain("workspace:7");
  });
});
