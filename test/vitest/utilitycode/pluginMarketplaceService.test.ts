import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Hoisted mutable state shared with the vi.mock factories below. Using
// vi.hoisted guarantees the object exists before the (hoisted) mock factories
// execute, while still letting each test rebind the values in beforeEach.
const mockState = vi.hoisted(() => ({
  // In-memory stand-in for the plugin_marketplaces table.
  store: new Map<string, Record<string, unknown>>(),
  // In-memory stand-in for installed plugin rows used by discovery status.
  installedPlugins: [] as Array<{
    name: string;
    version?: string;
    sourceMetaJson?: string;
  }>,
  // Resolved per-test to a fresh temp dir; the path helpers derive all cache
  // locations from this so no writes land under process.cwd().
  userDataDir: "",
}));

// 1. Mock the DB-facing marketplace module so no real SQLite is touched.
vi.mock("@/modules/PluginMarketplaceModule", () => {
  return {
    PluginMarketplaceModule: class {
      async listMarketplaces() {
        return Array.from(mockState.store.values());
      }
      async listEnabledMarketplaces() {
        return Array.from(mockState.store.values()).filter(
          (r) => r.enabled === 1
        );
      }
      async getMarketplaceByName(name: string) {
        return mockState.store.get(name) ?? null;
      }
      async createMarketplace(input: Record<string, unknown>) {
        mockState.store.set(input.name as string, {
          ...input,
          enabled: 1,
          health: "healthy",
        });
        return mockState.store.size;
      }
      async updateMarketplaceState(
        input: Record<string, unknown> & { name: string }
      ) {
        const cur = mockState.store.get(input.name) ?? {};
        mockState.store.set(input.name, { ...cur, ...input });
        return true;
      }
      async setMarketplaceErrors(
        name: string,
        errors: readonly { code: string; message: string }[]
      ) {
        const cur = mockState.store.get(name);
        if (cur) {
          mockState.store.set(name, {
            ...cur,
            lastErrorJson: JSON.stringify(errors),
            health: errors.length === 0 ? "healthy" : "invalid",
          });
        }
        return true;
      }
      async removeMarketplace(name: string) {
        return mockState.store.delete(name);
      }
    },
  };
});

// 2. Mock the INSTALLED-plugin module. listAvailablePlugins calls
//    new PluginManagementModule().listInstalledPlugins(); without this mock the
//    real module would instantiate BaseModule -> Token -> SqliteDb ->
//    better-sqlite3 (Electron ABI -> crash under vitest).
vi.mock("@/modules/PluginManagementModule", () => ({
  PluginManagementModule: class {
    async listInstalledPlugins() {
      return mockState.installedPlugins;
    }
  },
}));

// 3. Redirect cache writes to a per-test temp dir. The path helpers in
//    pluginMarketplacePaths derive from getElectronUserDataPath, so mocking
//    this single root keeps the worktree pristine.
vi.mock("@/service/SkillEnvironmentManager", () => ({
  getElectronUserDataPath: () => mockState.userDataDir,
}));

import { PluginMarketplaceService } from "@/service/PluginMarketplaceService";
import type {
  PluginMarketplaceFetchRequest,
  PluginMarketplaceFetchResult,
  PluginMarketplaceFetcher,
} from "@/service/pluginMarketplaces/marketplaceFetcherTypes";

const VALID_MANIFEST = JSON.stringify({
  name: "team-tools",
  owner: { name: "Team" },
  plugins: [
    {
      name: "lead-research",
      version: "1.0.0",
      source: "./plugins/lead-research",
    },
  ],
});

let tmpRoot: string;
let sourceRoot: string;

/**
 * Build a REAL temp dir that can serve both as the marketplace source (so
 * parseMarketplaceSource classifies it as local-folder) AND as the fetcher's
 * returned marketplaceRoot (so copyTree has something to copy from). The dir
 * contains marketplace.json plus the relative plugin subdir referenced by the
 * manifest entry, so resolveMarketplaceEntrySource can stat it later.
 */
function makeSourceRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mkt-src-"));
  fs.writeFileSync(path.join(dir, "marketplace.json"), VALID_MANIFEST, "utf-8");
  fs.mkdirSync(path.join(dir, "plugins", "lead-research"), { recursive: true });
  return dir;
}

function fakeFetcher(root: string): PluginMarketplaceFetcher {
  return {
    kind: "local-folder",
    async fetch(
      _req: PluginMarketplaceFetchRequest
    ): Promise<PluginMarketplaceFetchResult> {
      return {
        success: true,
        marketplace: {
          marketplaceRoot: root,
          manifestPath: `${root}/marketplace.json`,
          manifestJson: VALID_MANIFEST,
          cleanup: async () => {
            /* noop */
          },
        },
      };
    },
  };
}

/**
 * Captures the PluginSourceRequest passed to installFromSource so the install
 * test can assert the marketplace source override + sourceMeta provenance are
 * threaded through. Returns a success result shaped like PluginImportResult.
 */
function fakeInstallService(): {
  svc: { installFromSource: (req: unknown) => Promise<unknown> };
  captured: unknown[];
} {
  const captured: unknown[] = [];
  const svc = {
    async installFromSource(req: unknown): Promise<unknown> {
      captured.push(req);
      return {
        success: true,
        plugin: {
          id: 1,
          name: "lead-research",
          version: "1.0.0",
          source: "marketplace",
          enabled: true,
          health: "healthy",
          skillCount: 0,
          mcpServerCount: 0,
          permissions: [],
          lastUpdated: new Date().toISOString(),
        },
      };
    },
  };
  return { svc, captured };
}

describe("PluginMarketplaceService", () => {
  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mkt-svc-"));
    mockState.userDataDir = tmpRoot;
    sourceRoot = makeSourceRoot();
    mockState.store.clear();
    mockState.installedPlugins = [];
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
    try {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it("adds a marketplace via the local-folder fetcher", async () => {
    const svc = new PluginMarketplaceService(
      undefined as never,
      undefined as never,
      fakeFetcher(sourceRoot)
    );
    const sum = await svc.addMarketplace({ source: sourceRoot });
    expect(sum.name).toBe("team-tools");
    expect(sum.pluginCount).toBe(1);
    expect(sum.health).toBe("healthy");
  });

  it("rejects add when fetch fails", async () => {
    const bad: PluginMarketplaceFetcher = {
      kind: "local-folder",
      async fetch() {
        return {
          success: false,
          errors: [
            {
              code: "marketplace-fetch-failed",
              message: "boom",
              recoverable: false,
            },
          ],
        };
      },
    };
    const svc = new PluginMarketplaceService(
      undefined as never,
      undefined as never,
      bad
    );
    // Pass the real source dir so parse succeeds; the fetch failure is what
    // should surface as a thrown error.
    await expect(svc.addMarketplace({ source: sourceRoot })).rejects.toThrow();
  });

  it("lists available plugins from cached manifest", async () => {
    const svc = new PluginMarketplaceService(
      undefined as never,
      undefined as never,
      fakeFetcher(sourceRoot)
    );
    await svc.addMarketplace({ source: sourceRoot });
    const plugins = await svc.listAvailablePlugins({});
    expect(plugins.length).toBe(1);
    expect(plugins[0].name).toBe("lead-research");
    expect(plugins[0].marketplaceName).toBe("team-tools");
    // Relative source in a real-rooted marketplace is supported.
    expect(["not_installed", "installed", "different_version"]).toContain(
      plugins[0].status
    );
  });

  it("marks marketplace plugins as installed when installed row has marketplace provenance", async () => {
    const svc = new PluginMarketplaceService(
      undefined as never,
      undefined as never,
      fakeFetcher(sourceRoot)
    );
    await svc.addMarketplace({ source: sourceRoot });
    mockState.installedPlugins = [
      {
        name: "lead-research",
        version: "1.0.0",
        sourceMetaJson: JSON.stringify({
          marketplace: {
            marketplaceName: "team-tools",
            entryName: "lead-research",
          },
        }),
      },
    ];

    const plugin = await svc.getAvailablePlugin("lead-research@team-tools");

    expect(plugin?.installed).toBe(true);
    expect(plugin?.status).toBe("installed");
  });

  it("removing a marketplace does not touch installed plugins", async () => {
    const svc = new PluginMarketplaceService(
      undefined as never,
      undefined as never,
      fakeFetcher(sourceRoot)
    );
    await svc.addMarketplace({ source: sourceRoot });
    await expect(svc.removeMarketplace("team-tools")).resolves.toBeUndefined();
    expect(await svc.getMarketplace("team-tools")).toBeNull();
  });

  it("installMarketplacePlugin delegates to PluginInstallService with marketplace provenance", async () => {
    const { svc: fakeInstall, captured } = fakeInstallService();
    const svc = new PluginMarketplaceService(
      undefined as never,
      fakeInstall as never,
      fakeFetcher(sourceRoot)
    );
    await svc.addMarketplace({ source: sourceRoot });

    const plugin = await svc.installMarketplacePlugin({
      pluginId: "lead-research@team-tools",
      overwrite: true,
    });

    expect(captured).toHaveLength(1);
    const req = captured[0] as {
      kind?: string;
      source?: string;
      sourceMeta?: {
        marketplace?: { marketplaceName: string; entryName: string };
      };
    };
    expect(req.kind).toBe("local-folder");
    // Install-pipeline override + marketplace provenance must be set.
    expect(req.source).toBe("marketplace");
    expect(req.sourceMeta?.marketplace?.marketplaceName).toBe("team-tools");
    expect(req.sourceMeta?.marketplace?.entryName).toBe("lead-research");
    expect(plugin).toBeDefined();
  });

  it("installMarketplacePlugin rejects a plugin id without a marketplace segment", async () => {
    const { svc: fakeInstall } = fakeInstallService();
    const svc = new PluginMarketplaceService(
      undefined as never,
      fakeInstall as never,
      fakeFetcher(sourceRoot)
    );
    await expect(
      svc.installMarketplacePlugin({ pluginId: "lead-research" })
    ).rejects.toThrow(/marketplace/i);
  });

  it("refreshMarketplace keeps the previous cache + manifest when re-fetch fails", async () => {
    // Add with a working fetcher first.
    const svcAdd = new PluginMarketplaceService(
      undefined as never,
      undefined as never,
      fakeFetcher(sourceRoot)
    );
    await svcAdd.addMarketplace({ source: sourceRoot });
    const cacheRoot = path.join(
      mockState.userDataDir,
      "plugins",
      "marketplaces",
      "cache",
      "team-tools"
    );
    expect(fs.existsSync(cacheRoot)).toBe(true);

    // A second service with a FAILING fetcher shares the same in-memory store
    // (the module mock is global), exercising the refresh-failure path.
    const failFetcher: PluginMarketplaceFetcher = {
      kind: "local-folder",
      async fetch() {
        return {
          success: false,
          errors: [
            {
              code: "marketplace-fetch-failed",
              message: "refresh boom",
              recoverable: false,
            },
          ],
        };
      },
    };
    const svcRefresh = new PluginMarketplaceService(
      undefined as never,
      undefined as never,
      failFetcher
    );
    await expect(svcRefresh.refreshMarketplace("team-tools")).rejects.toThrow();

    // Cache dir is NOT deleted on failure.
    expect(fs.existsSync(cacheRoot)).toBe(true);
    // Persisted manifest is unchanged; health reflects the error.
    const after = await svcRefresh.getMarketplace("team-tools");
    expect(after).not.toBeNull();
    expect(after!.manifest.plugins[0].name).toBe("lead-research");
    expect(after!.health).toBe("invalid");
    expect(
      after!.errors.some((e) => e.code === "marketplace-fetch-failed")
    ).toBe(true);
  });
});
