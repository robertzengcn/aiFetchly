import { describe, expect, it, beforeEach, vi } from "vitest";
import { SqliteDb } from "@/config/SqliteDb";
import { PluginManagementModule } from "@/modules/PluginManagementModule";
import { AgentDefinitionModule } from "@/modules/AgentDefinitionModule";
import { PluginAgentImportService } from "@/service/PluginAgentImportService";
import type { PluginManifest } from "@/entityTypes/pluginTypes";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-plugin-agent-lifecycle");

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

/** Build a temp plugin root with a native manifest + agents/*.md files. */
function buildNativePlugin(
  name: string,
  agents: Array<{ file: string; body: string }>
): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-"));
  fs.mkdirSync(path.join(root, ".aifetchly-plugin"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".aifetchly-plugin", "plugin.json"),
    JSON.stringify({
      name,
      version: "1.0.0",
      description: `${name} test plugin`,
      agents: agents.map((a) => a.file),
    }),
    "utf-8"
  );
  for (const a of agents) {
    const full = path.join(root, a.file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, a.body, "utf-8");
  }
  return root;
}

const AGENT_MD = (n: string, d: string) =>
  `---\nname: ${n}\ndescription: ${d}\n---\nYou are ${n}.`;

async function createPluginRow(name: string): Promise<void> {
  const pm = new PluginManagementModule();
  await pm.createPlugin({
    name,
    version: "1.0.0",
    description: `${name} test plugin`,
    source: "local",
    installPath: path.join(tmpDir, name),
    manifestJson: JSON.stringify({ name, version: "1.0.0", description: "" }),
  });
}

describe("plugin agent lifecycle (DB-backed)", () => {
  it("parses + persists plugin agents with namespaced IDs and source=plugin", async () => {
    await SqliteDb.ensureInitialized();
    const root = buildNativePlugin("lead-pack", [
      { file: "agents/reviewer.md", body: AGENT_MD("reviewer", "reviews") },
      { file: "agents/optimizer.md", body: AGENT_MD("optimizer", "optimizes") },
    ]);
    const manifest = {
      name: "lead-pack",
      version: "1.0.0",
      description: "x",
      agents: ["agents/reviewer.md", "agents/optimizer.md"],
    } as unknown as PluginManifest;

    const parsed = PluginAgentImportService.parsePluginAgents({
      pluginRoot: root,
      manifest,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    await createPluginRow("lead-pack");
    const agentModule = new AgentDefinitionModule();
    await agentModule.upsertPluginAgents("lead-pack", parsed.agents);

    const stored = await agentModule.findAgentsByPluginName("lead-pack");
    expect(stored).toHaveLength(2);
    const ids = stored.map((a) => a.id).sort();
    expect(ids).toEqual(["lead-pack:optimizer", "lead-pack:reviewer"]);
    for (const a of stored) {
      expect(a.source).toBe("plugin");
      expect(a.pluginName).toBe("lead-pack");
      expect(a.health).toBe("healthy");
      expect(a.status).toBe("active");
    }
  });

  it("preserves a user-disabled agent across overwrite (upsert preserves status)", async () => {
    await SqliteDb.ensureInitialized();
    const root1 = buildNativePlugin("ovr", [
      { file: "agents/a.md", body: AGENT_MD("a", "d") },
    ]);
    const manifest = {
      name: "ovr",
      version: "1.0.0",
      description: "x",
      agents: ["agents/a.md"],
    } as unknown as PluginManifest;
    const parsed = PluginAgentImportService.parsePluginAgents({
      pluginRoot: root1,
      manifest,
    });
    if (!parsed.ok) return;

    await createPluginRow("ovr");
    const agentModule = new AgentDefinitionModule();
    await agentModule.upsertPluginAgents("ovr", parsed.agents);

    // User disables the agent.
    await agentModule.toggleAgent("ovr:a", false);
    const afterDisable = await agentModule.findAgentsByPluginName("ovr");
    expect(afterDisable[0].status).toBe("disabled");

    // Re-import (overwrite) with the disabled id preserved.
    await agentModule.upsertPluginAgents(
      "ovr",
      parsed.agents,
      new Set(["ovr:a"])
    );
    const afterOverwrite = await agentModule.findAgentsByPluginName("ovr");
    expect(afterOverwrite[0].status).toBe("disabled");
  });

  it("uninstallPlugin removes the plugin's agent rows and reports removedAgentIds", async () => {
    await SqliteDb.ensureInitialized();
    const root = buildNativePlugin("rm-agents", [
      { file: "agents/r1.md", body: AGENT_MD("r1", "d") },
      { file: "agents/r2.md", body: AGENT_MD("r2", "d") },
    ]);
    const manifest = {
      name: "rm-agents",
      version: "1.0.0",
      description: "x",
      agents: ["agents/r1.md", "agents/r2.md"],
    } as unknown as PluginManifest;
    const parsed = PluginAgentImportService.parsePluginAgents({
      pluginRoot: root,
      manifest,
    });
    if (!parsed.ok) return;

    await createPluginRow("rm-agents");
    const agentModule = new AgentDefinitionModule();
    await agentModule.upsertPluginAgents("rm-agents", parsed.agents);
    expect(await agentModule.findAgentsByPluginName("rm-agents")).toHaveLength(
      2
    );

    const pm = new PluginManagementModule();
    const result = await pm.uninstallPlugin("rm-agents");
    expect(result.removedPlugin).toBe(true);
    expect([...result.removedAgentIds].sort()).toEqual([
      "rm-agents:r1",
      "rm-agents:r2",
    ]);

    const remaining = await agentModule.findAgentsByPluginName("rm-agents");
    expect(remaining).toHaveLength(0);
  });
});
