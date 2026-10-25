/**
 * B06 — overwrite update rollback: rows AND files restored TOGETHER.
 *
 * Injects failures at every post-teardown seam (plugin row write, skill
 * write, MCP discovery smoke test, agent write) and asserts the previous
 * generation — plugin row, owned skills, MCP servers, agents, install
 * files — is restored exactly (B06 Done-when, design §14.2).
 *
 * Harness mirrors test/vitest/utilitycode/pluginImportService.test.ts.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import AdmZip from "adm-zip";
import { SqliteDb } from "@/config/SqliteDb";
import { SkillRegistry } from "@/config/skillsRegistry";

// B06 state shared with the vi.mock factories below (hoisted safely).
const b06State = vi.hoisted(() => ({
  discoverMode: "resolve" as "resolve" | "reject",
  reset(): void {
    b06State.discoverMode = "resolve";
  },
}));

// Mock MCPToolService so plugin import persists rows without live
// connectivity and so the discovery smoke test can be FAILED on demand.
// Note: restore paths never call MCPToolService, so a rejected discovery
// exercises the B06 compensating restore, not the mock's internals.
vi.mock("@/service/MCPToolService", () => ({
  MCPToolService: class {
    setTrust() {
      return undefined;
    }
    async discoverTools() {
      if (b06State.discoverMode === "reject") {
        throw new Error("injected discovery failure");
      }
      return [];
    }
  },
}));

// Isolated per-run DB path under parallel vitest workers.
const mockTokenStore = vi.hoisted(() => new Map<string, string>());
vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(key: string): string {
      return mockTokenStore.get(key) ?? "";
    }
    setValue(key: string, value: string): void {
      mockTokenStore.set(key, value);
    }
    deleteValue(key: string): void {
      mockTokenStore.delete(key);
    }
    hasValue(key: string): boolean {
      return (
        mockTokenStore.has(key) && (mockTokenStore.get(key)?.length ?? 0) > 0
      );
    }
  },
}));

import { PluginImportService } from "@/service/PluginImportService";
import { PluginManagementModule } from "@/modules/PluginManagementModule";
import { SkillManagementModule } from "@/modules/SkillManagementModule";
import { MCPToolModule } from "@/modules/MCPToolModule";
import { AgentDefinitionModule } from "@/modules/AgentDefinitionModule";
import { getPluginInstallRoot } from "@/service/pluginPaths";

const PLUGIN = "rollback-plugin";
let tmp = "";
let dbpath = "";

const SKILL_MANIFEST = (name: string) => ({
  name,
  version: "1.0.0",
  description: `${name} skill`,
  runtime: "javascript",
  entry: "main.js",
  parameters: { type: "object", properties: {} },
  permissions: [],
});

const agentMd = (name: string, desc: string) =>
  `---\nname: ${name}\ndescription: ${desc}\n---\nYou are the ${name} agent.`;

function buildPluginZip(
  zipPath: string,
  files: Record<string, string | Buffer>
): void {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) {
    zip.addFile(
      name,
      Buffer.isBuffer(content) ? content : Buffer.from(content, "utf-8")
    );
  }
  zip.writeZip(zipPath);
}

function buildV1Zip(zipPath: string, withMcp: boolean): void {
  buildPluginZip(zipPath, {
    ".aifetchly-plugin/plugin.json": JSON.stringify({
      name: PLUGIN,
      version: "1.0.0",
      description: "v1",
      agents: ["agents/reviewer.md"],
      ...(withMcp ? { mcpServers: ["mcp/servers.json"] } : {}),
    }),
    "agents/reviewer.md": agentMd("reviewer", "v1 reviewer"),
    ...(withMcp
      ? {
          "mcp/servers.json": JSON.stringify({
            mcpServers: {
              scrape: { transport: "stdio", command: "noop", args: [] },
            },
          }),
        }
      : {}),
  });
}

async function installV1(withMcp: boolean): Promise<void> {
  buildV1Zip(path.join(tmp, "v1.zip"), withMcp);
  const result = await PluginImportService.importFromZip({
    zipPath: path.join(tmp, "v1.zip"),
  });
  if (!result.success) {
    throw new Error(`v1 install failed: ${JSON.stringify(result.errors)}`);
  }
}

function removeAllPath(target: string): void {
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

/** Remove all on-disk leftovers for the rollback plugin. */
function rmPluginDirs(): void {
  const root = path.dirname(getPluginInstallRoot(PLUGIN));
  if (!fs.existsSync(root)) return;
  for (const name of fs.readdirSync(root)) {
    if (name.startsWith(PLUGIN)) {
      removeAllPath(path.join(root, name));
    }
  }
}

describe("B06 overwrite rollback", () => {
  beforeAll(async () => {
    dbpath = path.join(os.tmpdir(), `aifetchly-b06-rollback-${Date.now()}`);
    fs.mkdirSync(dbpath, { recursive: true });
    mockTokenStore.set("USERSDBPATH", dbpath);
    await SqliteDb.resetInstance(dbpath);
    await SqliteDb.ensureInitialized();
  });

  afterAll(async () => {
    await SqliteDb.destroyInstance();
    rmPluginDirs();
    try {
      fs.rmSync(dbpath, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b06-rollback-"));
    rmPluginDirs();
    b06State.reset();
  });

  afterEach(async () => {
    // Rows first (plugin row owns skill/MCP/agent rows), then files.
    const pluginModule = new PluginManagementModule();
    if (await pluginModule.getPluginByName(PLUGIN)) {
      await pluginModule.uninstallPlugin(PLUGIN);
    }
    rmPluginDirs();
    b06State.reset();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function buildV2LocalRoot(kind: "agents" | "skills" | "agentsMcp"): string {
    const localRoot = path.join(tmp, "v2-root");
    const manifest = path.join(localRoot, ".aifetchly-plugin");
    fs.mkdirSync(manifest, { recursive: true });
    const agentsDir = path.join(localRoot, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, "reviewer.md"),
      agentMd("reviewer", "v2 reviewer"),
      "utf-8"
    );
    const manifestJson: Record<string, unknown> = {
      name: PLUGIN,
      version: "2.0.0",
      description: "v2",
      agents: ["agents/reviewer.md"],
    };
    if (kind === "skills") {
      for (const name of ["alpha", "beta"]) {
        const dir = path.join(localRoot, "skills", name);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          path.join(dir, "manifest.json"),
          JSON.stringify(SKILL_MANIFEST(name)),
          "utf-8"
        );
        fs.writeFileSync(
          path.join(dir, "main.js"),
          "setResult({ success: true });",
          "utf-8"
        );
      }
      manifestJson.skills = ["skills/alpha/manifest.json", "skills/beta/manifest.json"];
    }
    if (kind === "agentsMcp") {
      const mcpDir = path.join(localRoot, "mcp");
      fs.mkdirSync(mcpDir, { recursive: true });
      fs.writeFileSync(
        path.join(mcpDir, "servers.json"),
        JSON.stringify({
          mcpServers: {
            crawl: { transport: "stdio", command: "noop", args: [] },
          },
        }),
        "utf-8"
      );
      manifestJson.mcpServers = ["mcp/servers.json"];
    }
    fs.writeFileSync(
      path.join(manifest, "plugin.json"),
      JSON.stringify(manifestJson),
      "utf-8"
    );
    return localRoot;
  }

  it("restores the old plugin row, agents and files when the row write fails", async () => {
    await installV1(false);
    // Disable the old agent so enablement preferences must survive.
    const agentModule = new AgentDefinitionModule();
    const before = await agentModule.findAgentsByPluginName(PLUGIN);
    expect(before.length).toBe(1);
    await agentModule.toggleAgent(before[0].id, false);

    // Fail exactly the NEW generation's row write (restore's own createPlugin
    // call goes through the real implementation).
    const spy = vi
      .spyOn(PluginManagementModule.prototype, "createPlugin")
      .mockRejectedValueOnce(new Error("row write exploded"));
    try {
      const result = await PluginImportService.installFromLocalRoot(
        buildV2LocalRoot("agents"),
        { overwrite: true }
      );
      expect(result.success).toBe(false);
      if (result.success) throw new Error("expected failure result");
      expect(result.errors[0]?.message).toMatch(/persist plugin row/);
      // Two calls total: the failed NEW row write + the restore re-create.
      expect(spy).toHaveBeenCalledTimes(2);
      // The restore re-creates the PREVIOUS row exactly.
      expect((spy.mock.calls[1]?.[0] as unknown as { version: string }).version).toBe("1.0.0");

      // Old plugin row restored exactly (v2 never replaced it).
      const row = await new PluginManagementModule().getPluginByName(PLUGIN);
      expect(row).not.toBeNull();
      expect(row?.version).toBe("1.0.0");
      expect(row?.health).toBe("healthy");
      expect(row?.enabled).toBe(1);

      // Files restored TOGETHER with rows (v1 agent content back on disk).
      const installPath = getPluginInstallRoot(PLUGIN);
      const agentFile = fs.readFileSync(
        path.join(installPath, "agents", "reviewer.md"),
        "utf-8"
      );
      expect(agentFile).toContain("You are the reviewer agent.");

      // Agents restored — including the user-disabled preference.
      const after = await agentModule.findAgentsByPluginName(PLUGIN);
      expect(after.length).toBe(1);
      expect(after[0].status).toBe("disabled");

      // No leftover backup/staging directories.
      const leftovers = fs
        .readdirSync(path.dirname(installPath))
        .filter((n) => n.startsWith(PLUGIN));
      expect(leftovers).toEqual([PLUGIN]);
    } finally {
      spy.mockRestore();
    }
  });

  it("restores old skill rows when the new skill write fails mid-way", async () => {
    await installV1(false);
    // A pre-existing plugin-owned skill row for the old generation.
    await new SkillManagementModule().installSkill({
      name: "v1-skill",
      version: "1.0.0",
      source: "user",
      manifest_json: "{}",
      permissions_json: "[]",
      enabled: 1,
      pluginName: PLUGIN,
      pluginComponentPath: "skills/v1/SKILL.md",
    });

    // First (alpha) succeeds, second (beta) explodes; the later restore
    // calls go through the real implementation.
    const spy = vi
      .spyOn(SkillManagementModule.prototype, "installSkill")
      .mockRejectedValueOnce(new Error("skill write exploded"));
    try {
      const result = await PluginImportService.installFromLocalRoot(
        buildV2LocalRoot("skills"),
        { overwrite: true }
      );
      expect(result.success).toBe(false);
      if (result.success) throw new Error("expected failure result");
      expect(result.errors[0]?.code).toBe("skill-import-failed");
      expect(result.errors[0]?.message).toMatch(/persist plugin skills/);

      // Old skill rows restored; failed-generation rows removed.
      const restored = await new SkillManagementModule().findSkillsByPluginName(
        PLUGIN
      );
      expect(restored.map((s) => s.name).sort()).toEqual(["v1-skill"]);
      expect(restored[0]?.enabled).toBe(1);

      const row = await new PluginManagementModule().getPluginByName(PLUGIN);
      expect(row?.version).toBe("1.0.0");
    } finally {
      spy.mockRestore();
    }
  });

  it("restores old MCP servers (same row id) when discovery fails", async () => {
    await installV1(true);
    const mcpModule = new MCPToolModule();
    const oldMcp = await mcpModule.findMcpByPluginName(PLUGIN);
    expect(oldMcp.length).toBe(1);
    const oldId = oldMcp[0].id;

    // New generation: discovery smoke test now fails.
    b06State.discoverMode = "reject";
    const result = await PluginImportService.installFromLocalRoot(
      buildV2LocalRoot("agentsMcp"),
      { overwrite: true }
    );
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure result");
    expect(result.errors[0]?.code).toBe("mcp-discovery-failed");

    // Old MCP server restored with its ORIGINAL id (trust mapping survives).
    const restored = await mcpModule.findMcpByPluginName(PLUGIN);
    expect(restored.length).toBe(1);
    expect(restored[0].id).toBe(oldId);
    expect(restored[0].serverName).toBe("scrape");

    const row = await new PluginManagementModule().getPluginByName(PLUGIN);
    expect(row?.version).toBe("1.0.0");

    // Failed generation's doc-skill registration is unregistered.
    expect(SkillRegistry.isRegistered("alpha")).toBe(false);
  });

  it("restores old agents when the new agent write fails", async () => {
    await installV1(false);
    const agentModule = new AgentDefinitionModule();
    const before = await agentModule.findAgentsByPluginName(PLUGIN);
    expect(before.length).toBe(1);

    const spy = vi
      .spyOn(AgentDefinitionModule.prototype, "upsertPluginAgents")
      .mockRejectedValueOnce(new Error("agent write exploded"));
    try {
      const result = await PluginImportService.installFromLocalRoot(
        buildV2LocalRoot("agents"),
        { overwrite: true }
      );
      expect(result.success).toBe(false);
      if (result.success) throw new Error("expected failure result");
      expect(result.errors[0]?.message).toMatch(/persist plugin agents/);

      const after = await agentModule.findAgentsByPluginName(PLUGIN);
      expect(after.length).toBe(1);
      expect(after[0].description).toBe("v1 reviewer");

      const row = await new PluginManagementModule().getPluginByName(PLUGIN);
      expect(row?.version).toBe("1.0.0");
    } finally {
      spy.mockRestore();
    }
  });

  it("retains the old working version when a policy-validated update is blocked", async () => {
    await installV1(false);
    // v2 declares an activation-gate-breaking tool policy (invalid timeout
    // class). The overwrite must be abandoned with the old version intact.
    const localRoot = buildV2LocalRoot("agents");
    const manifestPath = path.join(
      localRoot,
      ".aifetchly-plugin",
      "plugin.json"
    );
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as
      | Record<string, unknown>
      | null;
    if (manifest === null) throw new Error("manifest parse failed");
    manifest.toolPolicies = {
      "mcp-server/scrape": {
        contractVersion: 1,
        timeoutClass: "not-a-class",
        maxRunMs: 30_000,
        cancellable: true,
        maxConcurrentPerConversation: 1,
      },
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest), "utf-8");

    const result = await PluginImportService.installFromLocalRoot(localRoot, {
      overwrite: true,
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure result");
    expect(result.errors[0]?.code).toBe("dependency-unsatisfied");
    expect(result.errors[0]?.message).toContain("previous working version");

    // Old version still installed, healthy, and on disk.
    const row = await new PluginManagementModule().getPluginByName(PLUGIN);
    expect(row?.version).toBe("1.0.0");
    expect(row?.health).toBe("healthy");
    const agentModule = new AgentDefinitionModule();
    const after = await agentModule.findAgentsByPluginName(PLUGIN);
    expect(after.length).toBe(1);
    expect(after[0].description).toBe("v1 reviewer");
  });
});
