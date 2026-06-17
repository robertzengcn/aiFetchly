import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { PluginManifestService } from "@/service/PluginManifestService";
import {
  PLUGIN_NAME_REGEX,
  PLUGIN_SEMVER_REGEX,
} from "@/entityTypes/pluginTypes";

function writeDir(root: string, files: Record<string, string>): void {
  fs.mkdirSync(root, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf-8");
  }
}

describe("PluginManifestService", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-manifest-"));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("loads a valid manifest from .aifetchly-plugin/plugin.json", async () => {
    const pluginDir = path.join(tmpRoot, "my-plugin");
    writeDir(pluginDir, {
      ".aifetchly-plugin/plugin.json": JSON.stringify({
        name: "lead-tools",
        version: "1.2.3",
        description: "Lead enrichment tooling",
        skills: ["skills/lead-enrichment/manifest.json"],
      }),
      "skills/lead-enrichment/manifest.json": "{}",
    });

    const result = await PluginManifestService.loadFromDirectory(pluginDir);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.manifest.name).toBe("lead-tools");
      expect(result.manifest.version).toBe("1.2.3");
      expect(result.manifest.skills).toEqual([
        "skills/lead-enrichment/manifest.json",
      ]);
      expect(result.manifestPath).toBe(
        path.join(pluginDir, ".aifetchly-plugin", "plugin.json")
      );
    }
  });

  it("returns a failure when manifest is missing", async () => {
    const pluginDir = path.join(tmpRoot, "empty-plugin");
    writeDir(pluginDir, { "README.md": "no manifest here" });

    const result = await PluginManifestService.loadFromDirectory(pluginDir);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]!.code).toBe("manifest-not-found");
    }
  });

  it("returns a failure when manifest JSON is invalid", async () => {
    const pluginDir = path.join(tmpRoot, "bad-json");
    writeDir(pluginDir, {
      ".aifetchly-plugin/plugin.json": "{ not valid json",
    });

    const result = await PluginManifestService.loadFromDirectory(pluginDir);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0]!.code).toBe("manifest-invalid-json");
    }
  });

  it("rejects invalid semver", () => {
    const result = PluginManifestService.validateManifest(
      {
        name: "semver-bad",
        version: "1.2",
        description: "d",
        skills: ["skills/x/manifest.json"],
      },
      tmpRoot
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0]!.code).toBe("plugin-version-invalid");
    }
  });

  it("rejects names that violate the name regex", () => {
    expect(PLUGIN_NAME_REGEX.test("1bad")).toBe(false);
    expect(PLUGIN_NAME_REGEX.test("good-name_1")).toBe(true);
    expect(PLUGIN_SEMVER_REGEX.test("1.0.0")).toBe(true);
    expect(PLUGIN_SEMVER_REGEX.test("v1")).toBe(false);

    const result = PluginManifestService.validateManifest(
      {
        name: "Bad Name",
        version: "1.0.0",
        description: "d",
        skills: ["skills/x/manifest.json"],
      },
      tmpRoot
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0]!.code).toBe("manifest-schema-invalid");
    }
  });

  it("rejects when both skills and mcpServers are empty", () => {
    const result = PluginManifestService.validateManifest(
      { name: "empty-comp", version: "1.0.0", description: "d" },
      tmpRoot
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.errors.some((e) => e.code === "manifest-schema-invalid")
      ).toBe(true);
    }
  });

  it("rejects skill paths that escape the plugin directory", () => {
    const result = PluginManifestService.validateManifest(
      {
        name: "escape-plugin",
        version: "1.0.0",
        description: "d",
        skills: ["../escape/manifest.json"],
      },
      tmpRoot
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.code === "path-outside-plugin")).toBe(
        true
      );
    }
  });

  it("rejects descriptions longer than 500 characters", () => {
    const result = PluginManifestService.validateManifest(
      {
        name: "long-desc",
        version: "1.0.0",
        description: "x".repeat(501),
        skills: ["skills/x/manifest.json"],
      },
      tmpRoot
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.errors.some((e) => e.code === "manifest-schema-invalid")
      ).toBe(true);
    }
  });

  it("accepts unknown top-level fields without failing", () => {
    const result = PluginManifestService.validateManifest(
      {
        name: "unknown-fields",
        version: "1.0.0",
        description: "d",
        skills: ["skills/x/manifest.json"],
        customField: { anything: true },
        homepage: "https://example.com",
      } as Record<string, unknown>,
      tmpRoot
    );
    expect(result.success).toBe(true);
  });

  it("falls back to root plugin.json when .aifetchly-plugin/ is absent", async () => {
    const pluginDir = path.join(tmpRoot, "legacy-plugin");
    writeDir(pluginDir, {
      "plugin.json": JSON.stringify({
        name: "legacy",
        version: "0.1.0",
        description: "legacy layout",
        mcpServers: ["mcp/servers.json"],
      }),
      "mcp/servers.json": "{}",
    });

    const result = await PluginManifestService.loadFromDirectory(pluginDir);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.manifest.name).toBe("legacy");
    }
  });
});
