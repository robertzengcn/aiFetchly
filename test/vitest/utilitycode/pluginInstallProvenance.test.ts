/**
 * Trusted-provenance persistence integration (git-free GitHub plugin
 * installation PRD FR-13/FR-14, §16, US-06): a mocked archive install
 * through the REAL PluginImportService must persist sourceKind, canonical
 * URL, requested ref, and resolvedCommitSha on the plugin row — with no
 * credentials or signed URLs anywhere in the stored metadata.
 */
import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PluginInstallService } from "@/service/PluginInstallService";
import { PluginSourceRegistry } from "@/service/pluginSources/PluginSourceRegistry";
import { PluginManagementModule } from "@/modules/PluginManagementModule";
import { getPluginInstallRoot } from "@/service/pluginPaths";

const PLUGIN_NAME = "provenance-fixture";
const SHA = "0123456789abcdef0123456789abcdef01234567";

function buildFixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prov-fixture-"));
  fs.mkdirSync(path.join(root, ".aifetchly-plugin"), { recursive: true });
  fs.mkdirSync(path.join(root, "skills", "demo"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".aifetchly-plugin", "plugin.json"),
    JSON.stringify({
      name: PLUGIN_NAME,
      version: "1.0.0",
      description: "Provenance fixture",
      skills: ["skills/demo/manifest.json"],
    }),
    "utf-8"
  );
  fs.writeFileSync(
    path.join(root, "skills", "demo", "manifest.json"),
    JSON.stringify({
      name: "demo",
      version: "1.0.0",
      description: "demo skill",
      runtime: "javascript",
      entry: "main.js",
      parameters: { type: "object", properties: {} },
      permissions: [],
    }),
    "utf-8"
  );
  fs.writeFileSync(
    path.join(root, "skills", "demo", "main.js"),
    "// demo\n"
  );
  return root;
}

function removePath(p: string): void {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

describe("PluginInstallService — trusted provenance persistence (GF-6)", () => {
  const createdRoots: string[] = [];
  const pluginModule = new PluginManagementModule();

  afterEach(async () => {
    const existing = await pluginModule.getPluginByName(PLUGIN_NAME);
    if (existing) {
      await pluginModule.uninstallPlugin(PLUGIN_NAME);
      removePath(getPluginInstallRoot(PLUGIN_NAME));
    }
    for (const root of createdRoots.splice(0)) {
      removePath(root);
    }
  });

  it("persists fetcher-generated provenance and never the spoofable request values", async () => {
    const fixture = buildFixtureRoot();
    createdRoots.push(fixture);

    // The fetcher is the TRUSTED side: it resolved ref v1 to an immutable
    // SHA and reports the canonical URL. The REQUEST carries a spoofer's
    // values (a .git URL, a fake resolvedCommitSha, a signed-looking URL).
    const reg = new PluginSourceRegistry();
    reg.register({
      kind: "github",
      acquire: async () => ({
        success: true as const,
        source: {
          localRoot: fixture,
          cleanup: async () => undefined,
          provenance: {
            sourceKind: "github",
            sourceUri: "https://github.com/browser-use/video-use",
            sourceRef: "v1",
            sourceMeta: {
              acquisition: "github-archive",
              resolvedCommitSha: SHA,
              repositoryHost: "github.com",
            },
          },
        },
      }),
    });
    const svc = new PluginInstallService(reg);
    const result = await svc.installFromSource({
      kind: "github",
      uri: "https://github.com/browser-use/video-use.git?token=SPOOFED",
      ref: "v1",
      overwrite: true,
      sourceMeta: {
        resolvedCommitSha: "f".repeat(40), // renderer spoof attempt
        acquisition: "github-release-asset", // renderer spoof attempt
      },
    });
    if (!result.success) {
      throw new Error("install failed: " + JSON.stringify(result.errors));
    }
    expect(result.success).toBe(true);

    const row = await pluginModule.getPluginByName(PLUGIN_NAME);
    expect(row).not.toBeNull();
    if (!row) return;
    // Fetcher keys win over request keys (design §10.3).
    expect(row.sourceKind).toBe("github");
    expect(row.sourceUri).toBe("https://github.com/browser-use/video-use");
    expect(row.sourceRef).toBe("v1");
    const meta = JSON.parse(row.sourceMetaJson ?? "{}") as Record<
      string,
      unknown
    >;
    expect(meta).toEqual({
      acquisition: "github-archive",
      resolvedCommitSha: SHA,
      repositoryHost: "github.com",
    });
    // No credentials or signed URL material anywhere in the stored row.
    const stored = JSON.stringify({
      uri: row.sourceUri,
      ref: row.sourceRef,
      meta,
    });
    expect(stored).not.toContain("token=");
    expect(stored).not.toContain("sig=");
    expect(stored).not.toContain("SPOOFED");
    expect(stored).not.toContain("f".repeat(40));
  });
});
