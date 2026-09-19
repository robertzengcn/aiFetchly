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
import { PluginLoaderService } from "@/service/PluginLoaderService";
import { PluginImportService } from "@/service/PluginImportService";
import { PluginManagementModule } from "@/modules/PluginManagementModule";
import { getPluginInstallRoot } from "@/service/pluginPaths";

// The import/loader path constructs modules that resolve their dbpath via
// Token.getValue(USERSDBPATH) -> BaseModule fallback to the shared
// `aifetchly-test` dir. Under parallel vitest workers, two workers running
// TypeORM synchronize() DDL against that shared file throw SQLITE_BUSY. Mock
// Token so USERSDBPATH points at an isolated per-run temp path, then reset
// the SqliteDb singleton onto it. Mirrors EmailReplyRecovery.model.test.ts.
const mockTokenStore = vi.hoisted(() => new Map<string, string>());
vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: vi
      .fn()
      .mockImplementation((key: string) => mockTokenStore.get(key) ?? ""),
    setValue: vi
      .fn()
      .mockImplementation((key: string, value: string) =>
        mockTokenStore.set(key, value)
      ),
    deleteValue: vi
      .fn()
      .mockImplementation((key: string) => mockTokenStore.delete(key)),
    hasValue: vi
      .fn()
      .mockImplementation(
        (key: string) =>
          mockTokenStore.has(key) && (mockTokenStore.get(key)?.length ?? 0) > 0
      ),
  })),
}));

function buildPluginZip(zipPath: string, files: Record<string, string>): void {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) {
    zip.addFile(name, Buffer.from(content, "utf-8"));
  }
  zip.writeZip(zipPath);
}

const SKILL_MANIFEST = {
  name: "lead-enrichment",
  version: "1.0.0",
  description: "Lead enrichment",
  runtime: "javascript",
  entry: "main.js",
  parameters: { type: "object", properties: {} },
  permissions: [],
};

describe("PluginLoaderService", () => {
  let tmp: string;
  let dbpath: string;
  let pluginModule: PluginManagementModule;
  const created: string[] = [];

  beforeAll(async () => {
    dbpath = path.join(os.tmpdir(), `aifetchly-plugin-loader-${Date.now()}`);
    fs.mkdirSync(dbpath, { recursive: true });
    mockTokenStore.set("USERSDBPATH", dbpath);
    await SqliteDb.resetInstance(dbpath);
    await SqliteDb.ensureInitialized();
  });

  afterAll(async () => {
    await SqliteDb.destroyInstance();
    try {
      fs.rmSync(dbpath, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-loader-"));
    pluginModule = new PluginManagementModule();
    PluginLoaderService.clearCache();
  });

  afterEach(async () => {
    for (const name of created) {
      const existing = await pluginModule.getPluginByName(name);
      if (existing) {
        await pluginModule.uninstallPlugin(name);
        try {
          fs.rmSync(getPluginInstallRoot(name), {
            recursive: true,
            force: true,
          });
        } catch {
          // ignore
        }
      }
    }
    created.length = 0;
    fs.rmSync(tmp, { recursive: true, force: true });
    PluginLoaderService.clearCache();
  });

  it("splits enabled and disabled plugins", async () => {
    // Plugin A: enabled
    const zipA = path.join(tmp, "plugin-a.zip");
    buildPluginZip(zipA, {
      ".aifetchly-plugin/plugin.json": JSON.stringify({
        name: "loader-plugin-a",
        version: "1.0.0",
        description: "a",
        skills: ["skills/a/manifest.json"],
      }),
      "skills/a/manifest.json": JSON.stringify({
        ...SKILL_MANIFEST,
        name: "a-skill",
      }),
      "skills/a/main.js": "setResult({});",
    });
    const resA = await PluginImportService.importFromZip({ zipPath: zipA });
    expect(resA.success).toBe(true);
    created.push("loader-plugin-a");

    // Plugin B: import then disable
    const zipB = path.join(tmp, "plugin-b.zip");
    buildPluginZip(zipB, {
      ".aifetchly-plugin/plugin.json": JSON.stringify({
        name: "loader-plugin-b",
        version: "1.0.0",
        description: "b",
        skills: ["skills/b/manifest.json"],
      }),
      "skills/b/manifest.json": JSON.stringify({
        ...SKILL_MANIFEST,
        name: "b-skill",
      }),
      "skills/b/main.js": "setResult({});",
    });
    const resB = await PluginImportService.importFromZip({ zipPath: zipB });
    expect(resB.success).toBe(true);
    created.push("loader-plugin-b");
    await pluginModule.togglePlugin("loader-plugin-b", false);
    PluginLoaderService.clearCache();

    const result = await PluginLoaderService.loadAllPlugins();
    const enabledNames = result.enabled.map((p) => p.name);
    const disabledNames = result.disabled.map((p) => p.name);
    expect(enabledNames).toContain("loader-plugin-a");
    expect(disabledNames).toContain("loader-plugin-b");
    expect(enabledNames).not.toContain("loader-plugin-b");
  });

  it("reports missing_files when install dir is removed", async () => {
    const zip = path.join(tmp, "broken.zip");
    buildPluginZip(zip, {
      ".aifetchly-plugin/plugin.json": JSON.stringify({
        name: "loader-broken",
        version: "1.0.0",
        description: "x",
        skills: ["skills/x/manifest.json"],
      }),
      "skills/x/manifest.json": JSON.stringify({
        ...SKILL_MANIFEST,
        name: "x-skill",
      }),
      "skills/x/main.js": "setResult({});",
    });
    const res = await PluginImportService.importFromZip({ zipPath: zip });
    expect(res.success).toBe(true);
    created.push("loader-broken");

    // Simulate files deleted out-of-band.
    fs.rmSync(getPluginInstallRoot("loader-broken"), {
      recursive: true,
      force: true,
    });
    PluginLoaderService.clearCache();

    const result = await PluginLoaderService.loadAllPlugins();
    const target = [...result.enabled, ...result.disabled].find(
      (p) => p.name === "loader-broken"
    );
    if (!target) throw new Error("loader-broken plugin not found in result");
    expect(target.errors.some((e) => e.code === "missing_files")).toBe(true);
  });

  it("memoizes: second load returns cached result", async () => {
    const zip = path.join(tmp, "cache.zip");
    buildPluginZip(zip, {
      ".aifetchly-plugin/plugin.json": JSON.stringify({
        name: "loader-cache",
        version: "1.0.0",
        description: "c",
        skills: ["skills/c/manifest.json"],
      }),
      "skills/c/manifest.json": JSON.stringify({
        ...SKILL_MANIFEST,
        name: "c-skill",
      }),
      "skills/c/main.js": "setResult({});",
    });
    await PluginImportService.importFromZip({ zipPath: zip });
    created.push("loader-cache");
    PluginLoaderService.clearCache();

    const first = await PluginLoaderService.loadAllPlugins();
    const second = await PluginLoaderService.loadAllPlugins();
    // Memoized: same reference.
    expect(second).toBe(first);
  });
});
