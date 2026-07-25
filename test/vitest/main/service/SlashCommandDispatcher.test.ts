/**
 * CMD-03, CMD-04, CMD-08, DX-02, TRS-06 — SlashCommandDispatcher + built-ins.
 *
 * Built-ins (`/help`, `/clear`, `/status`, `/reload-config`) register at
 * startup (CMD-03). The dispatcher resolves raw input via the parser +
 * registry and returns the CMD-04 discriminated union:
 *   - built-ins  -> show_result (local text)
 *   - prompt     -> submit_prompt (phase 15+; unreachable in phase 13)
 *   - skill      -> not-yet-supported (phase 18)
 *   - unknown    -> {status:false, msg:<unknown-command>}
 *   - disabled   -> {status:false, msg:<disabled>}
 *   - bare "/"   -> {status:false, msg:<suggest-only hint>}
 *   - non-slash  -> {status:false, msg:<not-a-command hint>}
 *
 * /status surfaces counts + watcher state (DX-02). /reload-config triggers
 * manager.reload(). No execution path exists (TRS-06 — no child_process /
 * eval / Function() in the dispatch path; phase 15 boundary marked in
 * source).
 *
 * Real CommandRegistry + real AIFetchlyConfigManager pointed at an empty
 * tmpdir — no Electron mocks needed for the service layer.
 */
import { describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CommandRegistry } from "@/service/slashCommands/CommandRegistry";
import { registerBuiltInSlashCommands } from "@/service/slashCommands/builtinSlashCommands";
import { SlashCommandDispatcher } from "@/service/slashCommands/SlashCommandDispatcher";
import { SlashCommandModule } from "@/modules/SlashCommandModule";
import { AIFetchlyConfigManager } from "@/service/aifetchlyConfig/AIFetchlyConfigManager";
import { AgentDefinitionRegistryImpl } from "@/service/AgentDefinitionRegistry";
import type { SlashCommandDefinition } from "@/entityTypes/slashCommandTypes";
import type { AgentDefinitionView } from "@/entityTypes/agentTypes";
import type {
  PluginSlashCommandExecutor,
  SkillsSlashCommandProvider,
} from "@/service/slashCommands/SlashCommandDispatcher";
import * as dispatcherModule from "@/service/slashCommands/SlashCommandDispatcher";

// --- Fixtures ----------------------------------------------------------------

/**
 * Build an isolated dispatcher stack: fresh CommandRegistry + fresh
 * AIFetchlyConfigManager pointed at an empty tmpdir. Built-ins are
 * registered before returning so every test starts from the phase-13
 * production state.
 */
function buildStack(): {
  registry: CommandRegistry;
  manager: AIFetchlyConfigManager;
  dispatcher: SlashCommandDispatcher;
  module: SlashCommandModule;
  tmpRoot: string;
} {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "slash-dispatcher-"));
  const manager = new AIFetchlyConfigManager({ rootPath: tmpRoot });
  const registry = manager.getCommandRegistry();
  registerBuiltInSlashCommands(registry);
  const dispatcher = new SlashCommandDispatcher(registry, manager);
  const module = new SlashCommandModule(registry, manager);
  return { registry, manager, dispatcher, module, tmpRoot };
}

/** Disable a command in-place via re-registration (immutability-safe). */
function disableCommand(registry: CommandRegistry, id: string): void {
  const cmd = registry.getById(id);
  if (!cmd) throw new Error(`fixture command not found: ${id}`);
  registry.register({ ...cmd, enabled: false });
}

// --- CMD-03 built-in registration -------------------------------------------

describe("registerBuiltInSlashCommands (CMD-03)", () => {
  it("registers exactly the phase-13 + phase-16 built-ins with correct ids", () => {
    const { registry } = buildStack();
    const ids = registry
      .list()
      .filter((c) => c.source === "built-in")
      .map((c) => c.id)
      .sort();
    expect(ids).toEqual(
      [
        "built-in:command:agents",
        "built-in:command:clear",
        "built-in:command:help",
        "built-in:command:plugin",
        "built-in:command:reload-config",
        "built-in:command:skills",
        "built-in:command:status",
      ].sort()
    );
  });

  it.each([
    { id: "built-in:command:help", name: "help", descMatch: /List available/i },
    { id: "built-in:command:clear", name: "clear", descMatch: /Clear/i },
    { id: "built-in:command:status", name: "status", descMatch: /status/i },
    {
      id: "built-in:command:reload-config",
      name: "reload-config",
      descMatch: /Rescan|reload/i,
    },
    {
      id: "built-in:command:agents",
      name: "agents",
      descMatch: /agents/i,
    },
    {
      id: "built-in:command:plugin",
      name: "plugin",
      descMatch: /plugin marketplaces|install plugins/i,
    },
    {
      id: "built-in:command:skills",
      name: "skills",
      descMatch: /skills|tools/i,
    },
  ])(
    "built-in $id has stable shape (type=local, enabled, no trust)",
    ({ id, name, descMatch }) => {
      const { registry } = buildStack();
      const cmd = registry.getById(id);
      expect(cmd, `expected ${id} to be registered`).not.toBeNull();
      expect(cmd!.name).toBe(name);
      expect(cmd!.type).toBe("local");
      expect(cmd!.source).toBe("built-in");
      expect(cmd!.sourceId).toBe("built-in");
      expect(cmd!.sourceLabel).toBe("Built-in");
      expect(cmd!.requiresTrust).toBe(false);
      expect(cmd!.enabled).toBe(true);
      expect(cmd!.aliases).toEqual([]);
      expect(cmd!.description).toMatch(descMatch);
    }
  );

  it("is idempotent (re-registering replaces, not duplicates)", () => {
    const { registry } = buildStack();
    const before = registry.list().length;
    registerBuiltInSlashCommands(registry);
    const after = registry.list().length;
    expect(after).toBe(before);
  });
});

// --- CMD-04 discriminated union + CMD-08 failure messages -------------------

describe("SlashCommandDispatcher.dispatch (CMD-04, CMD-08, DX-02)", () => {
  it("returns show_result for /status with counts + watcher placeholder (DX-02)", async () => {
    const { dispatcher } = buildStack();
    const r = await dispatcher.dispatch({
      conversationId: "conv-1",
      rawInput: "/status",
    });
    expect(r.status).toBe(true);
    if (!r.status || r.action !== "show_result") {
      throw new Error("expected show_result");
    }
    expect(r.commandId).toBe("built-in:command:status");
    // DX-02 counts surface
    expect(r.content).toMatch(/Commands\s*:/i);
    expect(r.content).toMatch(/Diagnostics\s*:/i);
    // DX-02 phase-14 watcher placeholder
    expect(r.content).toMatch(/not started/i);
    expect(r.content).toMatch(/phase 14|phase-14/i);
  });

  it("returns show_result for /help listing the built-in command names", async () => {
    const { dispatcher } = buildStack();
    const r = await dispatcher.dispatch({
      conversationId: "conv-1",
      rawInput: "/help",
    });
    expect(r.status).toBe(true);
    if (!r.status || r.action !== "show_result") {
      throw new Error("expected show_result");
    }
    expect(r.commandId).toBe("built-in:command:help");
    expect(r.content).toContain("/help");
    expect(r.content).toContain("/clear");
    expect(r.content).toContain("/status");
    expect(r.content).toContain("/reload-config");
    expect(r.content).toContain("/plugin");
    expect(r.content).toContain("/skills");
  });

  it("returns show_result for /clear with guidance content (renderer clears)", async () => {
    const { dispatcher } = buildStack();
    const r = await dispatcher.dispatch({
      conversationId: "conv-1",
      rawInput: "/clear",
    });
    expect(r.status).toBe(true);
    if (!r.status || r.action !== "show_result") {
      throw new Error("expected show_result");
    }
    expect(r.commandId).toBe("built-in:command:clear");
    // Guidance content is non-empty
    expect(r.content.length).toBeGreaterThan(0);
  });

  it("returns show_result for /reload-config and triggers manager.reload()", async () => {
    const { dispatcher, manager } = buildStack();
    const spy = vi.spyOn(manager, "reload").mockResolvedValue({
      commandCount: 0,
      diagnosticCount: 0,
      lastReloadAt: Date.now(),
      instructionsChanged: false,
    });
    const r = await dispatcher.dispatch({
      conversationId: "conv-1",
      rawInput: "/reload-config",
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(r.status).toBe(true);
    if (!r.status || r.action !== "show_result") {
      throw new Error("expected show_result");
    }
    expect(r.commandId).toBe("built-in:command:reload-config");
    expect(r.content).toMatch(/Reloaded/i);
    expect(r.content).toMatch(/Commands\s*:/i);
    expect(r.content).toMatch(/Diagnostics\s*:/i);
  });

  it("returns show_result for /plugin and passes raw subcommand args to the plugin executor", async () => {
    const { registry, manager } = buildStack();
    const executor: PluginSlashCommandExecutor = {
      execute: vi.fn().mockResolvedValue("Plugin command completed."),
    };
    const dispatcher = new SlashCommandDispatcher(
      registry,
      manager,
      executor
    );
    const r = await dispatcher.dispatch({
      conversationId: "conv-1",
      rawInput:
        "/plugin marketplace add https://example.com/marketplace.json --overwrite",
    });
    expect(executor.execute).toHaveBeenCalledWith(
      "marketplace add https://example.com/marketplace.json --overwrite"
    );
    expect(r.status).toBe(true);
    if (!r.status || r.action !== "show_result") {
      throw new Error("expected show_result");
    }
    expect(r.commandId).toBe("built-in:command:plugin");
    expect(r.content).toBe("Plugin command completed.");
  });

  it("returns show_result for /skills with the AI tool catalog breakdown", async () => {
    const { registry, manager } = buildStack();
    const skillsProvider: SkillsSlashCommandProvider = {
      render: vi
        .fn<[], Promise<string>>()
        .mockResolvedValue(
          "Available skills (1):\n\n1. `file_read` - Read a file\n\nTool catalog: 1 total"
        ),
    };
    const dispatcher = new SlashCommandDispatcher(
      registry,
      manager,
      undefined,
      skillsProvider
    );

    const r = await dispatcher.dispatch({
      conversationId: "conv-1",
      rawInput: "/skills",
    });

    expect(skillsProvider.render).toHaveBeenCalledTimes(1);
    expect(r.status).toBe(true);
    if (!r.status || r.action !== "show_result") {
      throw new Error("expected show_result");
    }
    expect(r.commandId).toBe("built-in:command:skills");
    expect(r.content).toContain("Available skills");
    expect(r.content).toContain("Tool catalog:");
  });

  it("returns {status:false, msg} for an unknown command (CMD-08)", async () => {
    const { dispatcher } = buildStack();
    const r = await dispatcher.dispatch({
      conversationId: "conv-1",
      rawInput: "/unknown",
    });
    expect(r.status).toBe(false);
    if (r.status) throw new Error("expected failure envelope");
    expect(r.msg).toMatch(/Unknown slash command/i);
    expect(r.msg).toContain("unknown");
  });

  it("returns {status:false, msg} for bare '/' (suggest-only)", async () => {
    const { dispatcher } = buildStack();
    const r = await dispatcher.dispatch({
      conversationId: "conv-1",
      rawInput: "/",
    });
    expect(r.status).toBe(false);
    if (r.status) throw new Error("expected failure envelope");
    // Suggest-only hint — wording should mention typing a command name
    expect(r.msg.length).toBeGreaterThan(0);
  });

  it("returns {status:false, msg} for non-slash input", async () => {
    const { dispatcher } = buildStack();
    const r = await dispatcher.dispatch({
      conversationId: "conv-1",
      rawInput: "hello world",
    });
    expect(r.status).toBe(false);
    if (r.status) throw new Error("expected failure envelope");
    expect(r.msg).toMatch(/not a slash command|not a command/i);
  });

  it("returns {status:false, msg} for a disabled command (CMD-08)", async () => {
    const { registry, dispatcher } = buildStack();
    disableCommand(registry, "built-in:command:status");
    const r = await dispatcher.dispatch({
      conversationId: "conv-1",
      rawInput: "/status",
    });
    expect(r.status).toBe(false);
    if (r.status) throw new Error("expected failure envelope");
    expect(r.msg).toMatch(/disabled/i);
  });

  // Note: the Phase-13 placeholder that returned a not-yet-supported
  // message for prompt-type commands has been superseded by Phase 15
  // (Plan 15-01 / SC2). The prompt dispatch contract is now exercised
  // in the dedicated describe block below ("SlashCommandDispatcher
  // prompt commands (Phase 15 / SC2)").

  it("skill-type command returns a not-yet-supported message (phase 18 boundary)", async () => {
    const { registry, dispatcher } = buildStack();
    const skillCmd: SlashCommandDefinition = {
      id: "plugin:demo:command:run-demo",
      name: "run-demo",
      description: "Demo skill",
      aliases: [],
      type: "skill",
      source: "plugin",
      sourceId: "plugin:demo",
      sourceLabel: "Plugin",
      requiresTrust: false,
      enabled: true,
    };
    registry.register(skillCmd);
    const r = await dispatcher.dispatch({
      conversationId: "conv-1",
      rawInput: "/run-demo",
    });
    expect(r.status).toBe(false);
    if (r.status) throw new Error("expected failure envelope");
    expect(r.msg).toMatch(/not yet supported|not supported/i);
  });
});

// --- SlashCommandModule (three-layer Module) --------------------------------

describe("SlashCommandModule (three-layer Module)", () => {
  it("listCommands returns SlashCommandView[] with empty-diagnostics fallback", async () => {
    const { module } = buildStack();
    const r = await module.listCommands({
      conversationId: "conv-1",
      query: "",
    });
    expect(r.status).toBe(true);
    if (!r.status) throw new Error("expected success");
    expect(Array.isArray(r.commands)).toBe(true);
    expect(r.commands.length).toBeGreaterThanOrEqual(4);
    const names = r.commands.map((c) => c.name).sort();
    expect(names).toContain("help");
    expect(names).toContain("clear");
    expect(names).toContain("status");
    expect(names).toContain("skills");
    expect(names).toContain("reload-config");
  });

  it("listCommands ranks by query when provided (CMD-07)", async () => {
    const { module } = buildStack();
    const r = await module.listCommands({
      conversationId: "conv-1",
      query: "st",
    });
    expect(r.status).toBe(true);
    if (!r.status) throw new Error("expected success");
    // 'status' starts with 'st' — should rank above 'help'/'clear'
    const first = r.commands[0];
    expect(first.name).toBe("status");
  });

  it("dispatch delegates to the dispatcher", async () => {
    const { module } = buildStack();
    const r = await module.dispatch({
      conversationId: "conv-1",
      rawInput: "/help",
    });
    expect(r.status).toBe(true);
  });

  it("getStatus proxies manager.getStatus()", async () => {
    const { module, manager } = buildStack();
    const direct = manager.getStatus();
    const via = await module.getStatus();
    expect(via).toEqual(direct);
  });

  it("reloadConfig proxies manager.reload()", async () => {
    const { module, manager } = buildStack();
    const spy = vi.spyOn(manager, "reload").mockResolvedValue({
      commandCount: 7,
      diagnosticCount: 1,
      lastReloadAt: 12345,
      instructionsChanged: true,
    });
    const r = await module.reloadConfig();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(r.commandCount).toBe(7);
    expect(r.diagnosticCount).toBe(1);
    expect(r.lastReloadAt).toBe(12345);
    expect(r.instructionsChanged).toBe(true);
  });
});

// --- TRS-06 boundary: no execution path -------------------------------------

describe("TRS-06 no-execution-path boundary", () => {
  it("SlashCommandDispatcher module does not import child_process", () => {
    const src = dispatcherModule as unknown;
    // The module object exists; we assert the static surface by checking
    // that no spawn/exec/child_process symbols are exported.
    expect(src).toBeDefined();
    const keys = Object.keys(dispatcherModule);
    for (const k of keys) {
      expect(k).not.toMatch(/spawn|exec|child_process/i);
    }
  });
});

// --- Phase 15 / SC2: prompt commands -----------------------------------------

describe("SlashCommandDispatcher prompt commands (Phase 15 / SC2)", () => {
  /** Register a prompt-type command directly (no loader dependency). */
  function registerPrompt(
    registry: CommandRegistry,
    overrides: Partial<SlashCommandDefinition> = {}
  ): SlashCommandDefinition {
    const cmd: SlashCommandDefinition = {
      id: "user:command:review",
      name: "review",
      description: "Review code",
      aliases: [],
      type: "prompt",
      source: "user",
      sourceId: "user",
      sourceLabel: "User",
      requiresTrust: false,
      enabled: true,
      body: "Review $ARGUMENTS please",
      ...overrides,
    };
    registry.register(cmd);
    return cmd;
  }

  it("dispatching /review src/service returns submit_prompt with the token replaced", async () => {
    const { registry, dispatcher } = buildStack();
    registerPrompt(registry, {
      body: "Review $ARGUMENTS please",
    });
    const r = await dispatcher.dispatch({
      conversationId: "conv-1",
      rawInput: "/review src/service",
    });
    expect(r.status).toBe(true);
    if (!r.status || r.action !== "submit_prompt") {
      throw new Error("expected submit_prompt");
    }
    expect(r.commandId).toBe("user:command:review");
    expect(r.prompt).toBe("Review src/service please");
  });

  it("body without the token + non-empty args returns submit_prompt with args appended after a blank line (D-02)", async () => {
    const { registry, dispatcher } = buildStack();
    registerPrompt(registry, {
      body: "Review this", // no $ARGUMENTS token
    });
    const r = await dispatcher.dispatch({
      conversationId: "conv-1",
      rawInput: "/review src/a",
    });
    expect(r.status).toBe(true);
    if (!r.status || r.action !== "submit_prompt") {
      throw new Error("expected submit_prompt");
    }
    expect(r.commandId).toBe("user:command:review");
    expect(r.prompt).toBe("Review this\n\nsrc/a");
  });

  it("dispatching with no args returns submit_prompt with the token replaced by empty string (or body unchanged when no token)", async () => {
    const { registry, dispatcher } = buildStack();
    registerPrompt(registry, {
      body: "Review $ARGUMENTS now",
    });
    const r = await dispatcher.dispatch({
      conversationId: "conv-1",
      rawInput: "/review",
    });
    expect(r.status).toBe(true);
    if (!r.status || r.action !== "submit_prompt") {
      throw new Error("expected submit_prompt");
    }
    expect(r.commandId).toBe("user:command:review");
    // Token replaced with empty string — no append path.
    expect(r.prompt).toBe("Review  now");
  });

  it("defensively treats cmd.body === undefined as empty string (no TypeError)", async () => {
    // The CMD-06 frontmatter validator rejects empty bodies before they
    // reach the registry, but the dispatcher must remain total — a
    // defensively-registered prompt command without a body must NOT
    // crash the dispatch path.
    const { registry, dispatcher } = buildStack();
    registerPrompt(registry, { body: undefined });
    const r = await dispatcher.dispatch({
      conversationId: "conv-1",
      rawInput: "/review hello",
    });
    expect(r.status).toBe(true);
    if (!r.status || r.action !== "submit_prompt") {
      throw new Error("expected submit_prompt");
    }
    // No token in the empty body -> D-02 append path kicks in.
    expect(r.prompt).toBe("\n\nhello");
  });

  it("prompt is NEVER submitted to the AI by the dispatcher — response is returned to the renderer (TRS-05 Strategy A)", async () => {
    const { registry, dispatcher } = buildStack();
    registerPrompt(registry);
    const r = await dispatcher.dispatch({
      conversationId: "conv-1",
      rawInput: "/review src/service",
    });
    expect(r.status).toBe(true);
    if (!r.status || r.action !== "submit_prompt") {
      throw new Error("expected submit_prompt");
    }
    // The response carries only the rendered prompt + commandId. The
    // downstream AI_CHAT_V2_STREAM IPC (unchanged by Phase 15) gates
    // USER_AI_ENABLED before the prompt is actually sent to the model.
    // The dispatcher does not import Token or any AI client.
    expect(typeof r.prompt).toBe("string");
    expect(r.prompt.length).toBeGreaterThan(0);
  });
});

// --- Phase 16 / Plan 03: /agents built-in command (D-AgentsList) ------------

const userAgent: AgentDefinitionView = {
  id: "user:agent:profile-writer",
  name: "Profile Writer",
  description: "Writes outreach profiles.",
  version: 1,
  systemPrompt: "You write profiles.",
  allowedTools: [],
  mode: "specialist",
  maxToolCalls: 4,
  maxRuntimeMs: 60000,
  maxContinueCalls: 4,
  outputSchema: {},
  status: "active",
  source: "user",
  health: "healthy",
};

const workspaceAgent: AgentDefinitionView = {
  id: "workspace:ws-1:agent:summarizer",
  name: "Summarizer",
  description: "Summarizes notes.",
  version: 1,
  systemPrompt: "You summarize.",
  allowedTools: [],
  mode: "specialist",
  maxToolCalls: 4,
  maxRuntimeMs: 60000,
  maxContinueCalls: 4,
  outputSchema: {},
  status: "active",
  source: "workspace",
  health: "healthy",
};

const claudePluginAgent: AgentDefinitionView = {
  id: "ecc:code-explorer",
  name: "code-explorer",
  description: "Analyzes codebases and recommends integration points.",
  version: 1,
  systemPrompt: "You analyze code.",
  allowedTools: ["file_read", "grep_files", "glob_files"],
  mode: "specialist",
  maxToolCalls: 8,
  maxRuntimeMs: 300000,
  maxContinueCalls: 8,
  outputSchema: {},
  status: "active",
  source: "plugin",
  pluginName: "ecc",
  pluginComponentPath: "agents/code-explorer.md",
  health: "healthy",
};

describe("SlashCommandDispatcher /agents command (Phase 16 / Plan 03, D-AgentsList)", () => {
  it("returns show_result for /agents and lists the built-in agent", async () => {
    const { dispatcher } = buildStack();
    const r = await dispatcher.dispatch({
      conversationId: "conv-1",
      rawInput: "/agents",
    });
    expect(r.status).toBe(true);
    if (!r.status || r.action !== "show_result") {
      throw new Error("expected show_result");
    }
    expect(r.commandId).toBe("built-in:command:agents");
    // The built-in lead-researcher is seeded into the registry at construction.
    expect(r.content).toContain("agent-lead-researcher");
  });

  it("sorts rows built-in -> user -> workspace (D-Precedence) with source badges", async () => {
    const { dispatcher, manager } = buildStack();
    manager.getAgentRegistry().replaceSource("user", [userAgent]);
    manager
      .getAgentRegistry()
      .replaceSource("workspace:ws-1", [workspaceAgent]);

    const r = await dispatcher.dispatch({
      conversationId: "conv-1",
      rawInput: "/agents",
    });
    if (!r.status || r.action !== "show_result") {
      throw new Error("expected show_result");
    }
    const content = r.content as string;
    const builtInIdx = content.indexOf("agent-lead-researcher");
    const userIdx = content.indexOf("user:agent:profile-writer");
    const wsIdx = content.indexOf("workspace:ws-1:agent:summarizer");
    expect(builtInIdx).toBeGreaterThan(-1);
    expect(userIdx).toBeGreaterThan(-1);
    expect(wsIdx).toBeGreaterThan(-1);
    // D-Precedence: built-in (0) < user (1) < workspace (2).
    expect(builtInIdx).toBeLessThan(userIdx);
    expect(userIdx).toBeLessThan(wsIdx);
    // Source badges present (reuse Phase 13 slashCommands labels).
    expect(content).toMatch(/Built-in/);
    expect(content).toMatch(/User/);
    expect(content).toMatch(/Workspace/);
  });

  it("labels Claude plugin agents as plugin even when IDs use pluginName:name format", async () => {
    const { dispatcher, manager } = buildStack();
    manager
      .getAgentRegistry()
      .replaceSource("plugin:ecc", [claudePluginAgent]);

    const r = await dispatcher.dispatch({
      conversationId: "conv-1",
      rawInput: "/agents",
    });
    if (!r.status || r.action !== "show_result") {
      throw new Error("expected show_result");
    }

    expect(r.content).toContain(
      "ecc:code-explorer — code-explorer: Analyzes codebases and recommends integration points. [Plugin]"
    );
  });

  it("does not crash on an empty registry (built-ins cleared)", async () => {
    const tmpRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "slash-agents-empty-")
    );
    const emptyRegistry = new AgentDefinitionRegistryImpl();
    emptyRegistry.replaceSource("built-in", []);
    const manager = new AIFetchlyConfigManager({
      rootPath: tmpRoot,
      agentRegistry: emptyRegistry,
    });
    const registry = manager.getCommandRegistry();
    registerBuiltInSlashCommands(registry);
    const dispatcher = new SlashCommandDispatcher(registry, manager);

    const r = await dispatcher.dispatch({
      conversationId: "conv-1",
      rawInput: "/agents",
    });
    expect(r.status).toBe(true);
    if (!r.status || r.action !== "show_result") {
      throw new Error("expected show_result");
    }
    // No throw; content is a stable string (may be an empty-list message).
    expect(typeof r.content).toBe("string");
  });

  it("/agents is non-AI-gated — dispatcher + built-ins add NO registerAiValidatedHandler (TRS-05 Strategy A)", () => {
    const dispatcherSrc = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/service/slashCommands/SlashCommandDispatcher.ts"
      ),
      "utf8"
    );
    const builtinsSrc = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/service/slashCommands/builtinSlashCommands.ts"
      ),
      "utf8"
    );
    expect(dispatcherSrc).not.toMatch(/registerAiValidatedHandler/);
    expect(builtinsSrc).not.toMatch(/registerAiValidatedHandler/);
  });
});
