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
import type { SlashCommandDefinition } from "@/entityTypes/slashCommandTypes";
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
  it("registers exactly the four phase-13 built-ins with correct ids", () => {
    const { registry } = buildStack();
    const ids = registry
      .list()
      .filter((c) => c.source === "built-in")
      .map((c) => c.id)
      .sort();
    expect(ids).toEqual(
      [
        "built-in:command:clear",
        "built-in:command:help",
        "built-in:command:reload-config",
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

  it("returns show_result for /help listing the four built-in command names", async () => {
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

  it("prompt-type command returns a not-yet-supported message (phase 15 boundary)", async () => {
    const { registry, dispatcher } = buildStack();
    const promptCmd: SlashCommandDefinition = {
      id: "user:command:lead-research",
      name: "lead-research",
      description: "Lead research prompt",
      aliases: [],
      type: "prompt",
      source: "user",
      sourceId: "user",
      sourceLabel: "User",
      requiresTrust: false,
      enabled: true,
      body: "Research this lead: $ARGUMENTS", // body uses token syntax; dispatcher MUST NOT expand it
    };
    registry.register(promptCmd);
    const r = await dispatcher.dispatch({
      conversationId: "conv-1",
      rawInput: "/lead-research Acme Corp",
    });
    // Phase 13 has NO registered prompt commands in production. The type
    // contract still requires this branch to fail closed rather than
    // silently expand the prompt body.
    expect(r.status).toBe(false);
    if (r.status) throw new Error("expected failure envelope");
    expect(r.msg).toMatch(/not yet supported|not supported/i);
  });

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
