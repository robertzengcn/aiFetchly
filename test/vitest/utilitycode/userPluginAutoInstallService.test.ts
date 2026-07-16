import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { UserPluginAutoInstallService } from "@/service/UserPluginAutoInstallService";
import type { PluginImportResult } from "@/service/PluginImportService";

const VALID_PLUGIN_MANIFEST = {
  name: "drop-in-plugin",
  version: "1.0.0",
  description: "Plugin dropped into the user plugin folder",
  agents: ["agents/helper.md"],
};

function writePluginManifest(pluginRoot: string, name = "drop-in-plugin"): void {
  fs.mkdirSync(path.join(pluginRoot, ".aifetchly-plugin"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(pluginRoot, ".aifetchly-plugin", "plugin.json"),
    JSON.stringify({ ...VALID_PLUGIN_MANIFEST, name }),
    "utf-8"
  );
}

describe("UserPluginAutoInstallService", () => {
  let tmp: string;
  let installedNames: Set<string>;
  let importedRoots: string[];

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "user-plugin-sync-"));
    installedNames = new Set<string>();
    importedRoots = [];
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function buildService(): UserPluginAutoInstallService {
    return new UserPluginAutoInstallService(
      {
        async getPluginByName(
          name: string
        ): Promise<{ readonly name: string } | null> {
          return installedNames.has(name) ? { name } : null;
        },
      },
      async (localRoot: string): Promise<PluginImportResult> => {
        importedRoots.push(localRoot);
        return {
          success: true,
          plugin: {
            id: 1,
            name: path.basename(localRoot),
            version: "1.0.0",
            source: "local",
            enabled: true,
            health: "healthy",
            skillCount: 0,
            mcpServerCount: 0,
            agentCount: 1,
            permissions: [],
            lastUpdated: new Date("2026-07-15T00:00:00.000Z").toISOString(),
          },
        };
      }
    );
  }

  it("imports a manifest-bearing folder from the user plugin root", async () => {
    const pluginRoot = path.join(tmp, "drop-in-plugin");
    writePluginManifest(pluginRoot);

    const result = await buildService().syncFromUserPluginsRoot(tmp);

    expect(result).toMatchObject({
      scanned: 1,
      installed: 1,
      skipped: 0,
    });
    expect(result.errors).toHaveLength(0);
    expect(importedRoots).toEqual([pluginRoot]);
  });

  it("ignores options-only folders under the user plugin root", async () => {
    const optionsRoot = path.join(tmp, "drop-in-plugin");
    fs.mkdirSync(optionsRoot, { recursive: true });
    fs.writeFileSync(
      path.join(optionsRoot, "options.json"),
      JSON.stringify({}),
      "utf-8"
    );

    const result = await buildService().syncFromUserPluginsRoot(tmp);

    expect(result).toMatchObject({
      scanned: 1,
      installed: 0,
      skipped: 1,
    });
    expect(result.errors).toHaveLength(0);
    expect(importedRoots).toHaveLength(0);
  });

  it("skips plugin names that are already installed", async () => {
    installedNames.add("drop-in-plugin");
    writePluginManifest(path.join(tmp, "drop-in-plugin"));

    const result = await buildService().syncFromUserPluginsRoot(tmp);

    expect(result).toMatchObject({
      scanned: 1,
      installed: 0,
      skipped: 1,
    });
    expect(importedRoots).toHaveLength(0);
  });

  it("continues after one invalid plugin folder", async () => {
    const invalidRoot = path.join(tmp, "invalid-plugin");
    fs.mkdirSync(path.join(invalidRoot, ".aifetchly-plugin"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(invalidRoot, ".aifetchly-plugin", "plugin.json"),
      "{ invalid json",
      "utf-8"
    );
    writePluginManifest(path.join(tmp, "drop-in-plugin"));

    const result = await buildService().syncFromUserPluginsRoot(tmp);

    expect(result.installed).toBe(1);
    expect(result.errors.some((e) => e.code === "manifest-invalid-json")).toBe(
      true
    );
    expect(importedRoots).toEqual([path.join(tmp, "drop-in-plugin")]);
  });
});
