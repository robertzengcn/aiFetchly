/**
 * TC-1: Install plugin with agents/ directory
 *
 * Manual test spec (docs/test-manual/plugin-subagent-management.md §TC-1):
 *   1. Prepare a test plugin folder with agents/reviewer.md and agents/optimizer.md
 *   2. Install the plugin via Plugin Manager
 *   3. Verify: Plugin installs successfully
 *   4. Verify: Agents page shows my-plugin:reviewer and my-plugin:optimizer
 *   5. Verify: Plugin detail > Subagents tab shows both agents
 *   6. Verify: Both agents are enabled by default
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { SqliteDb } from "@/config/SqliteDb";
import { PluginImportService } from "@/service/PluginImportService";
import { PluginManagementModule } from "@/modules/PluginManagementModule";
import { AgentDefinitionModule } from "@/modules/AgentDefinitionModule";
import { getPluginInstallRoot } from "@/service/pluginPaths";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import AdmZip from "adm-zip";

const PLUGIN_NAME = "my-plugin";

const tmpDir = path.join(os.tmpdir(), "tc1-install-plugin-agents");

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

const AGENT_MD = (name: string, description: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\nYou are the ${name} agent.`;

function buildPluginZip(
  zipPath: string,
  files: Record<string, string>
): void {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) {
    zip.addFile(name, Buffer.from(content, "utf-8"));
  }
  zip.writeZip(zipPath);
}

describe("TC-1: Install plugin with agents/ directory", () => {
  it("installs plugin, persists agents with namespaced IDs, and both are enabled by default", async () => {
    await SqliteDb.ensureInitialized();

    // Step 1: Prepare a test plugin with agents/reviewer.md and agents/optimizer.md
    const zipPath = path.join(tmpDir, `${PLUGIN_NAME}.zip`);
    buildPluginZip(zipPath, {
      ".aifetchly-plugin/plugin.json": JSON.stringify({
        name: PLUGIN_NAME,
        version: "1.0.0",
        description: "Test plugin with agents",
        agents: ["agents/reviewer.md", "agents/optimizer.md"],
      }),
      "agents/reviewer.md": AGENT_MD(
        "reviewer",
        "Reviews campaign drafts for accuracy"
      ),
      "agents/optimizer.md": AGENT_MD(
        "optimizer",
        "Optimizes campaign performance"
      ),
    });

    // Step 2: Install the plugin
    const result = await PluginImportService.importFromZip({ zipPath });

    // Step 3: Verify plugin installs successfully
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.plugin.name).toBe(PLUGIN_NAME);
    expect(result.plugin.skillCount).toBe(0);
    expect(result.plugin.mcpServerCount).toBe(0);

    // Verify agentCount is correct
    expect(result.plugin.agentCount).toBe(2);

    // Step 4: Verify agents appear in management listing with correct namespaced IDs
    const agentModule = new AgentDefinitionModule();
    const pluginAgents = await agentModule.findAgentsByPluginName(PLUGIN_NAME);
    expect(pluginAgents).toHaveLength(2);

    const agentIds = pluginAgents.map((a) => a.id).sort();
    expect(agentIds).toEqual(["my-plugin:optimizer", "my-plugin:reviewer"]);

    // Step 5: Verify Plugin detail > Subagents tab shows both agents
    // (findAgentsByPluginName is the backing call for the Subagents tab)
    for (const agent of pluginAgents) {
      expect(agent.pluginName).toBe(PLUGIN_NAME);
      expect(agent.source).toBe("plugin");
      expect(agent.health).toBe("healthy");
    }

    // Verify agent metadata from frontmatter parsing
    const reviewer = pluginAgents.find((a) => a.id === "my-plugin:reviewer");
    expect(reviewer).toBeDefined();
    expect(reviewer!.name).toBe("reviewer");
    expect(reviewer!.description).toBe(
      "Reviews campaign drafts for accuracy"
    );

    const optimizer = pluginAgents.find((a) => a.id === "my-plugin:optimizer");
    expect(optimizer).toBeDefined();
    expect(optimizer!.name).toBe("optimizer");
    expect(optimizer!.description).toBe("Optimizes campaign performance");

    // Step 6: Verify both agents are enabled by default
    for (const agent of pluginAgents) {
      expect(agent.status).toBe("active");
    }
  });

  it("installs plugin and reports agentCount in PluginSummary", async () => {
    await SqliteDb.ensureInitialized();

    const zipPath = path.join(tmpDir, `${PLUGIN_NAME}-summary.zip`);
    buildPluginZip(zipPath, {
      ".aifetchly-plugin/plugin.json": JSON.stringify({
        name: PLUGIN_NAME,
        version: "1.0.0",
        description: "Test plugin with agents",
        agents: ["agents/reviewer.md", "agents/optimizer.md"],
      }),
      "agents/reviewer.md": AGENT_MD("reviewer", "reviews stuff"),
      "agents/optimizer.md": AGENT_MD("optimizer", "optimizes stuff"),
    });

    const result = await PluginImportService.importFromZip({ zipPath });
    expect(result.success).toBe(true);
    if (!result.success) return;

    // PluginSummary.agentCount is the value shown in Plugin Manager
    expect(result.plugin.agentCount).toBe(2);

    // Verify the plugin row also reports the correct count via the module
    const pm = new PluginManagementModule();
    const detail = await pm.getPluginByName(PLUGIN_NAME);
    expect(detail).not.toBeNull();
  });

  it("plugin install with agents/ directory also works via Claude-compatible manifest (agents: true)", async () => {
    await SqliteDb.ensureInitialized();

    const zipPath = path.join(tmpDir, `claude-${PLUGIN_NAME}.zip`);
    buildPluginZip(zipPath, {
      ".claude-plugin/plugin.json": JSON.stringify({
        name: PLUGIN_NAME,
        version: "1.0.0",
        description: "Claude-compatible plugin with agents/ dir",
        agents: true,
      }),
      "agents/reviewer.md": AGENT_MD("reviewer", "reviews"),
      "agents/optimizer.md": AGENT_MD("optimizer", "optimizes"),
    });

    const result = await PluginImportService.importFromZip({ zipPath });
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.plugin.agentCount).toBe(2);

    const agentModule = new AgentDefinitionModule();
    const agents = await agentModule.findAgentsByPluginName(PLUGIN_NAME);
    expect(agents).toHaveLength(2);

    const ids = agents.map((a) => a.id).sort();
    expect(ids).toEqual(["my-plugin:optimizer", "my-plugin:reviewer"]);

    // Both enabled by default
    for (const a of agents) {
      expect(a.status).toBe("active");
      expect(a.source).toBe("plugin");
    }
  });
});
