import { describe, expect, it, beforeEach, vi } from "vitest";
import { SqliteDb } from "@/config/SqliteDb";
import { PluginManagementModule } from "@/modules/PluginManagementModule";
import { AgentDefinitionModule } from "@/modules/AgentDefinitionModule";
import type {
  AgentDefinitionView,
  ParsedPluginAgentDefinition,
} from "@/entityTypes/agentTypes";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-agent-runtime-list");

beforeEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
  process.env.AIFETCHLY_TEST_DBPATH = tmpDir;
  SqliteDb.getInstance(tmpDir);
});

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue() {
      return process.env.AIFETCHLY_TEST_DBPATH ?? tmpDir;
    }
  },
}));

function pluginAgent(
  pluginName: string,
  name: string
): ParsedPluginAgentDefinition {
  const definition: AgentDefinitionView = {
    id: `${pluginName}:${name}`,
    name,
    description: `${name} agent`,
    version: 1,
    systemPrompt: `You are ${name}.`,
    allowedTools: [],
    mode: "specialist",
    maxToolCalls: 8,
    maxRuntimeMs: 300000,
    maxContinueCalls: 8,
    outputSchema: {},
    status: "active",
    source: "plugin",
    pluginName,
    pluginComponentPath: `agents/${name}.md`,
    manifest: {},
    health: "healthy",
  };
  return {
    definition,
    pluginName,
    componentPath: `agents/${name}.md`,
    manifest: {},
    warnings: [],
  };
}

async function createPluginRow(name: string, enabled: boolean): Promise<void> {
  const pm = new PluginManagementModule();
  await pm.createPlugin({
    name,
    version: "1.0.0",
    description: `${name} plugin`,
    source: "local",
    installPath: path.join(tmpDir, name),
    manifestJson: JSON.stringify({ name, version: "1.0.0", description: "" }),
    enabled: enabled ? 1 : 0,
  });
}

describe("runtime active-catalog filtering", () => {
  it("excludes agents of a disabled plugin and disabled agents; includes built-in, manual, enabled-plugin", async () => {
    await SqliteDb.ensureInitialized();
    const m = new AgentDefinitionModule();
    await m.ensureBuiltIns();

    await createPluginRow("enabled-plug", true);
    await createPluginRow("disabled-plug", false);
    await m.upsertPluginAgents("enabled-plug", [pluginAgent("enabled-plug", "e")]);
    await m.upsertPluginAgents("disabled-plug", [
      pluginAgent("disabled-plug", "d"),
    ]);
    await m.createManualAgent({
      idSlug: "manual",
      name: "Manual",
      description: "d",
      systemPrompt: "p",
      allowedTools: [],
      mode: "specialist",
      maxToolCalls: 8,
      maxRuntimeMs: 300000,
      maxContinueCalls: 8,
    });

    const active = await m.listActiveForRuntime();
    const ids = new Set(active.map((a) => a.id));
    expect(ids.has("agent-lead-researcher")).toBe(true); // built-in
    expect(ids.has("user:manual")).toBe(true); // manual enabled
    expect(ids.has("enabled-plug:e")).toBe(true); // enabled-plugin agent
    expect(ids.has("disabled-plug:d")).toBe(false); // disabled-plugin agent
  });

  it("getActiveById returns null for a disabled-plugin agent and non-null for an enabled one", async () => {
    await SqliteDb.ensureInitialized();
    const m = new AgentDefinitionModule();
    await createPluginRow("enabled-plug", true);
    await createPluginRow("disabled-plug", false);
    await m.upsertPluginAgents("enabled-plug", [pluginAgent("enabled-plug", "e")]);
    await m.upsertPluginAgents("disabled-plug", [
      pluginAgent("disabled-plug", "d"),
    ]);

    expect(await m.getActiveById("disabled-plug:d")).toBeNull();
    expect(await m.getActiveById("enabled-plug:e")).not.toBeNull();
  });

  it("toggling an enabled-plugin agent off removes it from the runtime list", async () => {
    await SqliteDb.ensureInitialized();
    const m = new AgentDefinitionModule();
    await createPluginRow("enabled-plug", true);
    await m.upsertPluginAgents("enabled-plug", [pluginAgent("enabled-plug", "e")]);

    expect(await m.getActiveById("enabled-plug:e")).not.toBeNull();
    await m.toggleAgent("enabled-plug:e", false);
    expect(await m.getActiveById("enabled-plug:e")).toBeNull();

    const active = await m.listActiveForRuntime();
    expect(active.some((a) => a.id === "enabled-plug:e")).toBe(false);
  });

  it("re-enabling a disabled plugin restores its previously-enabled agents", async () => {
    await SqliteDb.ensureInitialized();
    const m = new AgentDefinitionModule();
    const pm = new PluginManagementModule();
    await createPluginRow("toggle-plug", false);
    await m.upsertPluginAgents("toggle-plug", [
      pluginAgent("toggle-plug", "t"),
    ]);

    // Plugin disabled → agent not in runtime catalog.
    expect(await m.getActiveById("toggle-plug:t")).toBeNull();

    // Re-enable the plugin (component-level agent status stays active).
    await pm.togglePlugin("toggle-plug", true);
    expect(await m.getActiveById("toggle-plug:t")).not.toBeNull();
  });
});
