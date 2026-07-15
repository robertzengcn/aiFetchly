import { describe, expect, it, beforeEach, vi } from "vitest";
import { SqliteDb } from "@/config/SqliteDb";
import { AgentDefinitionModule } from "@/modules/AgentDefinitionModule";
import { AgentDefinitionEntity } from "@/entity/AgentDefinition.entity";
import { getAIFetchlyConfigManager } from "@/service/aifetchlyConfig/AIFetchlyConfigManager";
import type {
  AgentDefinitionView,
  ParsedPluginAgentDefinition,
} from "@/entityTypes/agentTypes";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-agent-def-management");

beforeEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
  process.env.AIFETCHLY_TEST_DBPATH = tmpDir;
  SqliteDb.getInstance(tmpDir);
  getAIFetchlyConfigManager().getAgentRegistry().replaceSource("user", []);
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

function userRuntimeAgent(name: string): AgentDefinitionView {
  return {
    id: `user:agent:${name}`,
    name,
    description: `${name} user config agent`,
    version: 1,
    systemPrompt: `You are ${name}.`,
    allowedTools: [],
    mode: "specialist",
    maxToolCalls: 8,
    maxRuntimeMs: 300000,
    maxContinueCalls: 8,
    outputSchema: {},
    status: "active",
    source: "user",
    manifest: {},
    health: "healthy",
  };
}

describe("AgentDefinitionModule management", () => {
  it("creates a manual user:<slug> agent, enabled by default", async () => {
    await SqliteDb.ensureInitialized();
    const m = new AgentDefinitionModule();
    const view = await m.createManualAgent({
      idSlug: "Local Verifier!",
      name: "Local Verifier",
      description: "Verifies things.",
      systemPrompt: "You verify.",
      allowedTools: ["knowledge_library_search"],
      mode: "verifier",
      maxToolCalls: 8,
      maxRuntimeMs: 300000,
      maxContinueCalls: 8,
    });
    expect(view.id).toBe("user:local-verifier");
    expect(view.source).toBe("user");
    expect(view.status).toBe("active");
    expect(view.health).toBe("healthy");

    const all = await m.listAllForManagement();
    expect(all.some((a) => a.id === "user:local-verifier")).toBe(true);
  });

  it("lists runtime ~/.aifetchly agents with their user source", async () => {
    await SqliteDb.ensureInitialized();
    const runtimeAgent = userRuntimeAgent("runtime-helper");
    getAIFetchlyConfigManager()
      .getAgentRegistry()
      .replaceSource("user", [runtimeAgent]);

    const m = new AgentDefinitionModule();
    const all = await m.listAllForManagement();
    const found = all.find((a) => a.id === runtimeAgent.id);
    expect(found?.source).toBe("user");
    expect(found?.status).toBe("active");
  });

  it("materializes a runtime user agent when toggled off", async () => {
    await SqliteDb.ensureInitialized();
    const runtimeAgent = userRuntimeAgent("toggle-runtime");
    getAIFetchlyConfigManager()
      .getAgentRegistry()
      .replaceSource("user", [runtimeAgent]);

    const m = new AgentDefinitionModule();
    expect(await m.getActiveById(runtimeAgent.id)).not.toBeNull();
    expect(await m.toggleAgent(runtimeAgent.id, false)).toBe(true);

    const managed = await m.getForManagement(runtimeAgent.id);
    expect(managed?.source).toBe("user");
    expect(managed?.status).toBe("disabled");
    expect(await m.getActiveById(runtimeAgent.id)).toBeNull();
  });

  it("normalizes legacy user-scoped rows that stored the built-in default source", async () => {
    await SqliteDb.ensureInitialized();
    const row = new AgentDefinitionEntity();
    row.agentId = "user:agent:legacy-config";
    row.name = "legacy-config";
    row.description = "Legacy config agent";
    row.version = 1;
    row.systemPrompt = "You are legacy-config.";
    row.allowedTools = [];
    row.mode = "specialist";
    row.maxToolCalls = 8;
    row.maxRuntimeMs = 300000;
    row.maxContinueCalls = 8;
    row.outputSchema = {};
    row.status = "active";
    row.source = "built-in";
    row.health = "healthy";
    await SqliteDb.getInstance(tmpDir)
      .connection.getRepository(AgentDefinitionEntity)
      .save(row);

    const m = new AgentDefinitionModule();
    const all = await m.listAllForManagement();
    const found = all.find((a) => a.id === row.agentId);
    expect(found?.source).toBe("user");
  });

  it("rejects a duplicate manual id", async () => {
    await SqliteDb.ensureInitialized();
    const m = new AgentDefinitionModule();
    await m.createManualAgent({
      idSlug: "dup",
      name: "Dup",
      description: "d",
      systemPrompt: "p",
      allowedTools: [],
      mode: "specialist",
      maxToolCalls: 8,
      maxRuntimeMs: 300000,
      maxContinueCalls: 8,
    });
    await expect(
      m.createManualAgent({
        idSlug: "dup",
        name: "Dup2",
        description: "d",
        systemPrompt: "p",
        allowedTools: [],
        mode: "specialist",
        maxToolCalls: 8,
        maxRuntimeMs: 300000,
        maxContinueCalls: 8,
      })
    ).rejects.toThrow(/already exists/);
  });

  it("updates a manual agent and bumps version", async () => {
    await SqliteDb.ensureInitialized();
    const m = new AgentDefinitionModule();
    const created = await m.createManualAgent({
      idSlug: "ed",
      name: "Ed",
      description: "d",
      systemPrompt: "p",
      allowedTools: [],
      mode: "specialist",
      maxToolCalls: 8,
      maxRuntimeMs: 300000,
      maxContinueCalls: 8,
    });
    const updated = await m.updateManualAgent(created.id, {
      description: "updated desc",
      enabled: false,
    });
    expect(updated.version).toBe(created.version + 1);
    expect(updated.description).toBe("updated desc");
    expect(updated.status).toBe("disabled");
  });

  it("refuses to edit a plugin-owned agent", async () => {
    await SqliteDb.ensureInitialized();
    const m = new AgentDefinitionModule();
    await m.upsertPluginAgents("lead-pack", [pluginAgent("lead-pack", "rev")]);
    await expect(
      m.updateManualAgent("lead-pack:rev", { description: "hacked" })
    ).rejects.toThrow(/not user-owned/);
  });

  it("refuses to delete a built-in agent", async () => {
    await SqliteDb.ensureInitialized();
    const m = new AgentDefinitionModule();
    await m.ensureBuiltIns();
    await expect(m.deleteManualAgent("agent-lead-researcher")).rejects.toThrow(
      /Built-in/
    );
  });

  it("refuses to delete a plugin-owned agent directly", async () => {
    await SqliteDb.ensureInitialized();
    const m = new AgentDefinitionModule();
    await m.upsertPluginAgents("lead-pack", [pluginAgent("lead-pack", "rev")]);
    await expect(m.deleteManualAgent("lead-pack:rev")).rejects.toThrow(
      /Plugin-owned/
    );
  });

  it("toggles a plugin-owned agent and deletes a manual agent", async () => {
    await SqliteDb.ensureInitialized();
    const m = new AgentDefinitionModule();
    await m.upsertPluginAgents("lead-pack", [pluginAgent("lead-pack", "rev")]);
    expect(await m.toggleAgent("lead-pack:rev", false)).toBe(true);
    const disabled = await m.getForManagement("lead-pack:rev");
    expect(disabled?.status).toBe("disabled");

    const manual = await m.createManualAgent({
      idSlug: "rm",
      name: "Rm",
      description: "d",
      systemPrompt: "p",
      allowedTools: [],
      mode: "specialist",
      maxToolCalls: 8,
      maxRuntimeMs: 300000,
      maxContinueCalls: 8,
    });
    expect(await m.deleteManualAgent(manual.id)).toBe(true);
    expect(await m.getForManagement(manual.id)).toBeNull();
  });
});
