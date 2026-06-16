import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import AdmZip from "adm-zip";
import { PluginImportService } from "@/service/PluginImportService";
import { PluginManagementModule } from "@/modules/PluginManagementModule";
import { SkillManagementModule } from "@/modules/SkillManagementModule";
import { MCPToolModule } from "@/modules/MCPToolModule";
import { getPluginInstallRoot } from "@/service/pluginPaths";

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

const VALID_SKILL_MANIFEST = {
  name: "lead-enrichment",
  version: "1.0.0",
  description: "Lead enrichment skill",
  runtime: "javascript",
  entry: "main.js",
  parameters: { type: "object", properties: {} },
  permissions: [],
};

describe("PluginImportService", () => {
  let tmp: string;
  let pluginModule: PluginManagementModule;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-import-"));
    pluginModule = new PluginManagementModule();
  });

  afterEach(async () => {
    // Clean up any plugins created during the test by name.
    const names = [
      "lead-tools",
      "conflict-plugin",
      "broken-skill",
      "bad-mcp",
    ];
    for (const n of names) {
      const existing = await pluginModule.getPluginByName(n);
      if (existing) {
        await pluginModule.uninstallPlugin(n);
        removePath(getPluginInstallRoot(n));
      }
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function removePath(p: string) {
    try {
      fs.rmSync(p, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  it("imports a valid skill-only plugin", async () => {
    const zipPath = path.join(tmp, "lead-tools.zip");
    buildPluginZip(zipPath, {
      ".aifetchly-plugin/plugin.json": JSON.stringify({
        name: "lead-tools",
        version: "1.0.0",
        description: "Lead tools plugin",
        skills: ["skills/lead-enrichment/manifest.json"],
      }),
      "skills/lead-enrichment/manifest.json": JSON.stringify(
        VALID_SKILL_MANIFEST
      ),
      "skills/lead-enrichment/main.js": "setResult({ success: true });",
    });

    const result = await PluginImportService.importFromZip({ zipPath });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.plugin.name).toBe("lead-tools");
      expect(result.plugin.skillCount).toBe(1);
    }

    // InstalledPlugin row exists and is enabled.
    const row = await pluginModule.getPluginByName("lead-tools");
    expect(row).to.not.equal(null);
    expect(row?.enabled).toBe(1);

    // Plugin-owned skill row exists.
    const skillModule = new SkillManagementModule();
    const skill = await skillModule.getSkillByName("lead-enrichment");
    expect(skill?.pluginName).toBe("lead-tools");

    // Install path exists on disk.
    expect(fs.existsSync(getPluginInstallRoot("lead-tools"))).toBe(true);
  });

  it("rejects a duplicate plugin name without overwrite", async () => {
    const zipPath = path.join(tmp, "conflict.zip");
    buildPluginZip(zipPath, {
      ".aifetchly-plugin/plugin.json": JSON.stringify({
        name: "conflict-plugin",
        version: "1.0.0",
        description: "d",
        skills: ["skills/x/manifest.json"],
      }),
      "skills/x/manifest.json": JSON.stringify(VALID_SKILL_MANIFEST),
      "skills/x/main.js": "setResult({});",
    });

    const first = await PluginImportService.importFromZip({ zipPath });
    expect(first.success).toBe(true);

    const second = await PluginImportService.importFromZip({ zipPath });
    expect(second.success).toBe(false);
    if (!second.success) {
      expect(second.errors.some((e) => e.code === "plugin-name-conflict")).toBe(
        true
      );
    }
  });

  it("rolls back when a declared skill entry file is missing", async () => {
    const zipPath = path.join(tmp, "broken-skill.zip");
    buildPluginZip(zipPath, {
      ".aifetchly-plugin/plugin.json": JSON.stringify({
        name: "broken-skill",
        version: "1.0.0",
        description: "d",
        skills: ["skills/missing-entry/manifest.json"],
      }),
      // manifest references main.js but it is not packaged
      "skills/missing-entry/manifest.json": JSON.stringify({
        ...VALID_SKILL_MANIFEST,
        name: "missing-entry",
      }),
    });

    const result = await PluginImportService.importFromZip({ zipPath });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.errors.some(
          (e) => e.code === "component-not-found" || e.code === "skill-manifest-invalid"
        )
      ).toBe(true);
    }

    // Rollback: no plugin row should exist.
    const row = await pluginModule.getPluginByName("broken-skill");
    expect(row).to.equal(null);
    expect(fs.existsSync(getPluginInstallRoot("broken-skill"))).toBe(false);
  });

  it("rejects path-traversal in a declared skill manifest path", async () => {
    const zipPath = path.join(tmp, "escape.zip");
    buildPluginZip(zipPath, {
      ".aifetchly-plugin/plugin.json": JSON.stringify({
        name: "lead-tools",
        version: "1.0.0",
        description: "d",
        skills: ["../escape/manifest.json"],
      }),
    });

    const result = await PluginImportService.importFromZip({ zipPath });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.code === "path-outside-plugin")).toBe(
        true
      );
    }
  });

  it("rejects a malformed MCP servers.json", async () => {
    const zipPath = path.join(tmp, "bad-mcp.zip");
    buildPluginZip(zipPath, {
      ".aifetchly-plugin/plugin.json": JSON.stringify({
        name: "bad-mcp",
        version: "1.0.0",
        description: "d",
        mcpServers: ["mcp/servers.json"],
      }),
      "mcp/servers.json": "{ not valid json",
    });

    const result = await PluginImportService.importFromZip({ zipPath });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.code === "mcp-config-invalid")).toBe(
        true
      );
    }
    expect(await pluginModule.getPluginByName("bad-mcp")).to.equal(null);
  });

  it("imports an MCP-only plugin with stdio command", async () => {
    const zipPath = path.join(tmp, "mcp-plugin.zip");
    buildPluginZip(zipPath, {
      ".aifetchly-plugin/plugin.json": JSON.stringify({
        name: "lead-tools",
        version: "1.0.0",
        description: "MCP plugin",
        mcpServers: ["mcp/servers.json"],
      }),
      "mcp/servers.json": JSON.stringify({
        mcpServers: {
          "linkedin-browser": {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-foo"],
            env: { API_TOKEN: "${user:API_TOKEN}" },
          },
        },
      }),
    });

    const result = await PluginImportService.importFromZip({ zipPath });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.plugin.mcpServerCount).toBe(1);
    }

    // MCP row persisted with stdio command fields.
    const mcpModule = new MCPToolModule();
    const all = await mcpModule.getAllMCPTools();
    const found = all.find(
      (m) => m.serverName === "linkedin-browser" && m.pluginName === "lead-tools"
    );
    expect(found).toBeDefined();
    expect(found?.command).toBe("npx");
    expect(found?.origin).toBe("plugin");
  });
});
