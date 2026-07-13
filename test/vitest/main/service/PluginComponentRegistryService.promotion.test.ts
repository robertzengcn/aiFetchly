/**
 * SKL-02 (Phase 18 / Plan 02 Task 2) — PluginComponentRegistryService promotion tests.
 *
 * Verifies that plugin `commands/*.md` + `agents/*.md` are promoted into the
 * native CommandRegistry / AgentDefinitionRegistry under sourceId `plugin:<name>`
 * (D-PluginBadge) at rank 3 (lowest — T-plugin-poison / T-18-05), that
 * disabled / uninstalled / missing-install-dir plugins reconcile to [] (no
 * stale entries), and that applyLoadedPlugins clears the cache AND delegates to
 * promotion (criterion: "applyLoadedPlugins still clears the cache AND promotes").
 *
 * The promotion core is exercised directly with fresh CommandRegistry /
 * AgentDefinitionRegistryImpl instances + real tmp plugin install dirs (no DB,
 * no singleton) so the file-scan → restricted-frontmatter → builder →
 * replaceSource pipeline is covered end-to-end. Mirrors the Phase-17/18 sibling
 * tests (LocalSkillSourceAdapter.test.ts, AIFetchlyRuntimeRegistrySync.skills).
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { SlashCommandDefinition } from "@/entityTypes/slashCommandTypes";
import type { PluginManifest } from "@/entityTypes/pluginTypes";
import { CommandRegistry } from "@/service/slashCommands/CommandRegistry";
import { AgentDefinitionRegistryImpl } from "@/service/AgentDefinitionRegistry";
import {
  PluginComponentRegistryService,
} from "@/service/PluginComponentRegistryService";
import { PluginLoaderService } from "@/service/PluginLoaderService";
import { PluginRuntimeCache } from "@/service/PluginRuntimeCache";
import type { LoadedPlugin } from "@/service/PluginLoaderService";

const tmpRoots: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-plugin-promo-"));
  tmpRoots.push(dir);
  return dir;
}

function writeFile(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

function makePlugin(opts: {
  name: string;
  installPath: string;
  enabled?: boolean;
}): LoadedPlugin {
  return {
    name: opts.name,
    displayName: opts.name,
    version: "1.0.0",
    source: "local",
    enabled: opts.enabled ?? true,
    installPath: opts.installPath,
    manifest: { name: opts.name, version: "1.0.0" } as PluginManifest,
    skills: [],
    mcpServers: [],
    errors: [],
  };
}

const VALID_COMMAND_MD = `---
name: review
description: Review code
type: prompt
---
Please review the following:

$ARGUMENTS
`;

const VALID_AGENT_MD = `---
name: researcher
description: Research helper
---
You are a careful researcher.
`;

describe("PluginComponentRegistryService.promotePluginCommandsAndAgents (SKL-02)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("promotes an enabled plugin's commands and agents under plugin:<name> (D-PluginBadge)", async () => {
    const install = makeTmpDir();
    writeFile(install, "commands/review.md", VALID_COMMAND_MD);
    writeFile(install, "agents/researcher.md", VALID_AGENT_MD);

    const commandRegistry = new CommandRegistry();
    const agentRegistry = new AgentDefinitionRegistryImpl();
    const cmdSpy = vi.spyOn(commandRegistry, "replaceSource");
    const agentSpy = vi.spyOn(agentRegistry, "replaceSource");

    const { diagnostics } =
      await PluginComponentRegistryService.promotePluginCommandsAndAgents(
        commandRegistry,
        agentRegistry,
        [makePlugin({ name: "demo", installPath: install })]
      );

    expect(diagnostics).toHaveLength(0);
    // SKL-02 SC2: commands promoted under plugin:<name> with plugin badge.
    expect(cmdSpy).toHaveBeenCalledWith(
      "plugin:demo",
      expect.arrayContaining([
        expect.objectContaining({
          name: "review",
          source: "plugin",
          sourceId: "plugin:demo",
        }),
      ])
    );
    const review = commandRegistry.getByName("review");
    expect(review).not.toBeNull();
    expect(review?.source).toBe("plugin");
    expect(review?.sourceId).toBe("plugin:demo");
    // SKL-02 SC2: agents promoted under plugin:<name>.
    expect(agentSpy).toHaveBeenCalledWith(
      "plugin:demo",
      expect.arrayContaining([
        expect.objectContaining({ name: "researcher" }),
      ])
    );
    const agents = agentRegistry.list();
    expect(agents.some((a) => a.name === "researcher")).toBe(true);
  });

  it("reconciles a disabled plugin to [] for both registries (no stale entries)", async () => {
    const commandRegistry = new CommandRegistry();
    const agentRegistry = new AgentDefinitionRegistryImpl();
    const cmdSpy = vi.spyOn(commandRegistry, "replaceSource");
    const agentSpy = vi.spyOn(agentRegistry, "replaceSource");

    await PluginComponentRegistryService.promotePluginCommandsAndAgents(
      commandRegistry,
      agentRegistry,
      [makePlugin({ name: "off", installPath: "/ignored", enabled: false })]
    );

    expect(cmdSpy).toHaveBeenCalledWith("plugin:off", []);
    expect(agentSpy).toHaveBeenCalledWith("plugin:off", []);
  });

  it("skips a plugin whose install dir is missing without throwing (Pitfall 5)", async () => {
    const commandRegistry = new CommandRegistry();
    const agentRegistry = new AgentDefinitionRegistryImpl();
    const cmdSpy = vi.spyOn(commandRegistry, "replaceSource");
    const agentSpy = vi.spyOn(agentRegistry, "replaceSource");

    await expect(
      PluginComponentRegistryService.promotePluginCommandsAndAgents(
        commandRegistry,
        agentRegistry,
        [
          makePlugin({
            name: "ghost",
            installPath: path.join(os.tmpdir(), "aifetchly-no-such-plugin-xyz"),
          }),
        ]
      )
    ).resolves.toBeDefined();

    expect(cmdSpy).toHaveBeenCalledWith("plugin:ghost", []);
    expect(agentSpy).toHaveBeenCalledWith("plugin:ghost", []);
  });

  it("T-plugin-poison: a plugin command colliding with a built-in loses (SOURCE_RANK)", async () => {
    const commandRegistry = new CommandRegistry();
    const builtinReview: SlashCommandDefinition = {
      id: "built-in:command:review",
      name: "review",
      description: "Built-in review",
      aliases: [],
      type: "local",
      source: "built-in",
      sourceId: "built-in",
      sourceLabel: "Built-in",
      requiresTrust: false,
      enabled: true,
    };
    commandRegistry.register(builtinReview);

    const install = makeTmpDir();
    writeFile(install, "commands/review.md", VALID_COMMAND_MD);

    await PluginComponentRegistryService.promotePluginCommandsAndAgents(
      commandRegistry,
      new AgentDefinitionRegistryImpl(),
      [makePlugin({ name: "p", installPath: install })]
    );

    // Plugin rank 3 loses to built-in rank 0 — the resolved command is built-in.
    const winner = commandRegistry.getByName("review");
    expect(winner?.source).toBe("built-in");
    // The plugin entry is still registered by id (replaceSource kept it), it
    // just loses the name collision — structural mitigation, no extra code.
    expect(commandRegistry.getById("plugin:p:command:review")).not.toBeNull();
  });

  it("collects a diagnostic for a malformed command but still promotes valid siblings", async () => {
    const install = makeTmpDir();
    // Missing required `type: prompt` → builder returns a diagnostic.
    writeFile(install, "commands/bad.md", "---\nname: bad\ndescription: ok\n---\nbody\n");
    writeFile(
      install,
      "commands/good.md",
      VALID_COMMAND_MD.replace("review", "good").replace("Review code", "Good command")
    );

    const commandRegistry = new CommandRegistry();
    const { diagnostics } =
      await PluginComponentRegistryService.promotePluginCommandsAndAgents(
        commandRegistry,
        new AgentDefinitionRegistryImpl(),
        [makePlugin({ name: "p", installPath: install })]
      );

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].sourceId).toBe("plugin:p");
    expect(commandRegistry.getByName("good")).not.toBeNull();
    expect(commandRegistry.getByName("bad")).toBeNull();
  });

  it("treats a plugin with no commands/ or agents/ dir as the happy path (empty, no diagnostic)", async () => {
    const install = makeTmpDir(); // no commands/ or agents/ subdir

    const commandRegistry = new CommandRegistry();
    const agentRegistry = new AgentDefinitionRegistryImpl();

    const { diagnostics } =
      await PluginComponentRegistryService.promotePluginCommandsAndAgents(
        commandRegistry,
        agentRegistry,
        [makePlugin({ name: "empty", installPath: install })]
      );

    expect(diagnostics).toEqual([]);
    expect(commandRegistry.list().some((c) => c.source === "plugin")).toBe(false);
  });
});

describe("PluginComponentRegistryService.applyLoadedPlugins / unregister (SKL-02)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("applyLoadedPlugins clears the runtime cache AND delegates to promotion", async () => {
    const clearSpy = vi.spyOn(PluginRuntimeCache, "clear");
    const promoteSpy = vi
      .spyOn(PluginComponentRegistryService, "promotePluginCommandsAndAgents")
      .mockResolvedValue({ diagnostics: [] });
    const loadSpy = vi
      .spyOn(PluginLoaderService, "loadAllPlugins")
      .mockResolvedValue({ enabled: [], disabled: [], errors: [] });

    await PluginComponentRegistryService.applyLoadedPlugins();

    expect(clearSpy).toHaveBeenCalledWith("apply-loaded-plugins");
    expect(loadSpy).toHaveBeenCalled();
    expect(promoteSpy).toHaveBeenCalledTimes(1);
  });

  it("unregisterPluginCapabilities reconciles the plugin's commands/agents to [] on both registries", async () => {
    const { getAIFetchlyConfigManager } = await import(
      "@/service/aifetchlyConfig/AIFetchlyConfigManager"
    );
    const manager = getAIFetchlyConfigManager();
    const cmdSpy = vi.spyOn(manager.getCommandRegistry(), "replaceSource");
    const agentSpy = vi.spyOn(manager.getAgentRegistry(), "replaceSource");

    await PluginComponentRegistryService.unregisterPluginCapabilities("gone");

    expect(cmdSpy).toHaveBeenCalledWith("plugin:gone", []);
    expect(agentSpy).toHaveBeenCalledWith("plugin:gone", []);
  });
});

afterAll(() => {
  for (const dir of tmpRoots) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});
