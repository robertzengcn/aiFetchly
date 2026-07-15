import { describe, expect, it, beforeEach, vi } from "vitest";
import { SqliteDb } from "@/config/SqliteDb";
import { AgentDefinitionModule } from "@/modules/AgentDefinitionModule";
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
    await expect(
      m.deleteManualAgent("agent-lead-researcher")
    ).rejects.toThrow(/Built-in/);
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
