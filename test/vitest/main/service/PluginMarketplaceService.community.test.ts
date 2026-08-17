import { describe, expect, test, vi, beforeEach } from "vitest";

import { HUB_MARKETPLACE_NAME } from "@/config/pluginHubUrl";
import type { HubManifestPluginEntry } from "@/entityTypes/communityPluginTypes";
import {
  PluginMarketplaceService,
  type InstalledPluginRowRef,
} from "@/service/PluginMarketplaceService";
import type { PluginMarketplaceFetcher } from "@/service/pluginMarketplaces/marketplaceFetcherTypes";

// --- In-memory marketplace module stub --------------------------------------

type Row = {
  id: number;
  name: string;
  displayName?: string;
  ownerName: string;
  sourceKind: string;
  sourceUri: string;
  manifestJson: string;
  pluginCount: number;
  enabled: number;
  autoUpdate: number;
  health: string;
  lastErrorJson: string;
  lastFetchedAt?: Date;
  sourceMetaJson: string;
  installPath?: string;
};

class StubMarketplaceModule {
  rows = new Map<string, Row>();
  private nextId = 1;

  async listMarketplaces() {
    return [...this.rows.values()];
  }
  async listEnabledMarketplaces() {
    return [...this.rows.values()].filter((r) => r.enabled === 1);
  }
  async getMarketplaceByName(name: string) {
    return this.rows.get(name) ?? null;
  }
  async createMarketplace(input: Partial<Row>) {
    const row: Row = {
      id: this.nextId++,
      name: input.name!,
      displayName: input.displayName,
      ownerName: input.ownerName ?? "unknown",
      sourceKind: input.sourceKind ?? "url",
      sourceUri: input.sourceUri ?? "",
      manifestJson: input.manifestJson ?? "{}",
      pluginCount: input.pluginCount ?? 0,
      enabled: input.enabled ?? 1,
      autoUpdate: input.autoUpdate ?? 0,
      health: input.health ?? "healthy",
      lastErrorJson: input.lastErrorJson ?? "[]",
      lastFetchedAt: input.lastFetchedAt,
      sourceMetaJson: input.sourceMetaJson ?? "{}",
    };
    this.rows.set(row.name, row);
    return row.id;
  }
  async updateMarketplaceState(input: Partial<Row> & { name: string }) {
    const row = this.rows.get(input.name);
    if (!row) return false;
    Object.assign(row, input);
    return true;
  }
  async setMarketplaceErrors(name: string, errors: readonly unknown[]) {
    const row = this.rows.get(name);
    if (!row) return false;
    row.lastErrorJson = JSON.stringify(errors);
    row.health = errors.length === 0 ? "healthy" : "invalid";
    return true;
  }
  async removeMarketplace(name: string) {
    return this.rows.delete(name);
  }
}

// --- Hub manifest helpers -----------------------------------------------------

function hubEntry(
  slug: string,
  overrides: Partial<HubManifestPluginEntry> = {}
): HubManifestPluginEntry {
  return {
    name: slug,
    slug,
    displayName: slug.toUpperCase(),
    description: `Description of ${slug}`,
    access: { status: "allowed", installMode: "direct" },
    source: { source: "github", repo: `aifetchly/${slug}` },
    ...overrides,
  } as HubManifestPluginEntry;
}

function hubManifestJson(entries: HubManifestPluginEntry[]): string {
  return JSON.stringify({
    name: HUB_MARKETPLACE_NAME,
    owner: { name: "AiFetchly Plugin Hub" },
    plugins: entries,
  });
}

function makeFetcher(entries: HubManifestPluginEntry[]) {
  return {
    kind: "aifetch-hub" as const,
    fetch: vi.fn(async () => ({
      success: true as const,
      marketplace: {
        marketplaceRoot: "",
        manifestPath: "",
        manifestJson: hubManifestJson(entries),
        cleanup: async () => undefined,
      },
    })),
  };
}

// --- Suite --------------------------------------------------------------------

describe("PluginMarketplaceService community catalog", () => {
  let marketplaceModule: StubMarketplaceModule;
  let installedRows: InstalledPluginRowRef[];
  let installFromSource: ReturnType<typeof vi.fn>;

  function makeService(
    entries: HubManifestPluginEntry[],
    opts: { lastFetchedAt?: Date } = {}
  ) {
    marketplaceModule = new StubMarketplaceModule();
    if (opts.lastFetchedAt) {
      marketplaceModule.rows.set(HUB_MARKETPLACE_NAME, {
        id: 1,
        name: HUB_MARKETPLACE_NAME,
        ownerName: "AiFetchly",
        sourceKind: "aifetch-hub",
        sourceUri: "https://plugins.example.com",
        manifestJson: hubManifestJson(entries),
        pluginCount: entries.length,
        enabled: 1,
        autoUpdate: 0,
        health: "healthy",
        lastErrorJson: "[]",
        lastFetchedAt: opts.lastFetchedAt,
        sourceMetaJson: "{}",
      });
    }
    const fetcher: PluginMarketplaceFetcher = makeFetcher(entries);
    installFromSource = vi.fn(async () => ({
      success: true,
      plugin: { id: 7, name: "pdf-tools", version: "1.2.0" },
    }));
    const service = new PluginMarketplaceService(
      marketplaceModule as never,
      { installFromSource } as never,
      fetcher,
      { listInstalledPlugins: async () => installedRows } as never
    );
    return { service, fetcher: fetcher.fetch };
  }

  beforeEach(() => {
    installedRows = [];
  });

  test("creates the built-in hub row and returns mapped entries on first list", async () => {
    const { service, fetcher } = makeService([
      hubEntry("pdf-tools"),
      hubEntry("pro-seo-suite", {
        access: { status: "subscription_required", installMode: "ticket" },
        source: undefined,
      }),
    ]);

    const entries = await service.listCommunityPlugins();

    expect(fetcher).toHaveBeenCalledTimes(1);
    const row = await marketplaceModule.getMarketplaceByName(
      HUB_MARKETPLACE_NAME
    );
    expect(row).not.toBeNull();
    expect(row!.sourceKind).toBe("aifetch-hub");
    expect(row!.pluginCount).toBe(2);
    expect(row!.health).toBe("healthy");

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      slug: "pdf-tools",
      name: "pdf-tools",
      displayName: "PDF-TOOLS",
      access: { status: "allowed", installMode: "direct" },
      installed: false,
    });
    expect(entries[1].access.status).toBe("subscription_required");
  });

  test("serves the cached manifest within the TTL without re-fetching", async () => {
    const { service, fetcher } = makeService([hubEntry("pdf-tools")], {
      lastFetchedAt: new Date(Date.now() - 60_000),
    });
    const entries = await service.listCommunityPlugins();
    expect(entries).toHaveLength(1);
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("re-fetches when the cache is stale or forceRefresh is set", async () => {
    const stale = { lastFetchedAt: new Date(Date.now() - 11 * 60_000) };
    const a = makeService([hubEntry("pdf-tools")], stale);
    await a.service.listCommunityPlugins();
    expect(a.fetcher).toHaveBeenCalledTimes(1);

    const fresh = { lastFetchedAt: new Date(Date.now() - 30_000) };
    const b = makeService([hubEntry("pdf-tools")], fresh);
    await b.service.listCommunityPlugins({ forceRefresh: true });
    expect(b.fetcher).toHaveBeenCalledTimes(1);
  });

  test("marks entries installed via marketplace sourceMeta cross-reference", async () => {
    installedRows = [
      {
        version: "1.2.0",
        sourceMetaJson: JSON.stringify({
          marketplace: {
            marketplaceName: HUB_MARKETPLACE_NAME,
            entryName: "pdf-tools",
          },
        }),
      },
    ];
    const { service } = makeService(
      [hubEntry("pdf-tools"), hubEntry("other-tool")],
      { lastFetchedAt: new Date() }
    );
    const entries = await service.listCommunityPlugins();
    expect(entries[0].installed).toBe(true);
    expect(entries[1].installed).toBe(false);
  });

  test("applies category and search filters", async () => {
    const { service } = makeService(
      [
        hubEntry("pdf-tools", { category: "productivity" }),
        hubEntry("scraper", { category: "data" }),
      ],
      { lastFetchedAt: new Date() }
    );
    expect(
      await service.listCommunityPlugins({ category: "data" })
    ).toMatchObject([{ slug: "scraper" }]);
    expect(await service.listCommunityPlugins({ search: "PDF" })).toMatchObject(
      [{ slug: "pdf-tools" }]
    );
  });

  test("fetch failure throws (fail-safe) and records errors on the row", async () => {
    marketplaceModule = new StubMarketplaceModule();
    const fetcher: PluginMarketplaceFetcher = {
      kind: "aifetch-hub",
      fetch: vi.fn(async () => ({
        success: false as const,
        errors: [
          {
            code: "marketplace-fetch-failed" as const,
            message: "HTTP 503",
            recoverable: false,
          },
        ],
      })),
    };
    const service = new PluginMarketplaceService(
      marketplaceModule as never,
      {} as never,
      fetcher,
      { listInstalledPlugins: async () => [] } as never
    );

    await expect(service.listCommunityPlugins()).rejects.toThrow(/HTTP 503/);
    const row = await marketplaceModule.getMarketplaceByName(
      HUB_MARKETPLACE_NAME
    );
    expect(row!.health).toBe("invalid");
    expect(row!.lastErrorJson).toContain("HTTP 503");
  });

  test("detail returns the cached row (null for unknown slug)", async () => {
    const { service } = makeService([hubEntry("pdf-tools")], {
      lastFetchedAt: new Date(),
    });
    const detail = await service.getCommunityPluginDetail("pdf-tools");
    expect(detail).toMatchObject({ slug: "pdf-tools" });
    expect(await service.getCommunityPluginDetail("nope")).toBeNull();
  });

  test("install delegates direct entries to PluginInstallService with provenance", async () => {
    const { service } = makeService(
      [hubEntry("pdf-tools", { version: "1.2.0" })],
      { lastFetchedAt: new Date() }
    );
    const plugin = await service.installCommunityPlugin("pdf-tools");
    expect(plugin).toMatchObject({ name: "pdf-tools" });
    expect(installFromSource).toHaveBeenCalledTimes(1);
    const req = installFromSource.mock.calls[0][0] as Record<string, unknown>;
    expect(req.kind).toBe("github");
    expect(req.uri).toBe("https://github.com/aifetchly/pdf-tools");
    expect(req.source).toBe("marketplace");
    const meta = (req.sourceMeta as { marketplace: Record<string, unknown> })
      .marketplace;
    expect(meta.marketplaceName).toBe(HUB_MARKETPLACE_NAME);
    expect(meta.entryName).toBe("pdf-tools");
  });

  test("install rejects ticket/locked plugins and unknown slugs", async () => {
    const { service } = makeService(
      [
        hubEntry("pro-seo-suite", {
          access: { status: "subscription_required", installMode: "ticket" },
          source: undefined,
        }),
      ],
      { lastFetchedAt: new Date() }
    );
    await expect(
      service.installCommunityPlugin("pro-seo-suite")
    ).rejects.toThrow(/subscription/i);
    await expect(service.installCommunityPlugin("ghost")).rejects.toThrow(
      /not found/i
    );
    expect(installFromSource).not.toHaveBeenCalled();
  });

  test("hides the built-in hub row from the Plugin Manager list", async () => {
    const { service } = makeService([hubEntry("pdf-tools")]);
    // Materialize the built-in row (lazily created on first community list).
    await service.listCommunityPlugins();
    marketplaceModule.rows.set("user-added", {
      id: 99,
      name: "user-added",
      ownerName: "Team",
      sourceKind: "url",
      sourceUri: "https://x/marketplace.json",
      manifestJson: "{}",
      pluginCount: 0,
      enabled: 1,
      autoUpdate: 0,
      health: "healthy",
      lastErrorJson: "[]",
      sourceMetaJson: "{}",
    });

    const listed = await service.listMarketplaces();
    expect(listed.map((m) => m.name)).toEqual(["user-added"]);

    await expect(
      service.removeMarketplace(HUB_MARKETPLACE_NAME)
    ).rejects.toThrow(/cannot be removed/i);
    expect(
      await marketplaceModule.getMarketplaceByName(HUB_MARKETPLACE_NAME)
    ).not.toBeNull();
  });

  test("listAvailablePlugins excludes the built-in hub marketplace", async () => {
    const { service } = makeService([hubEntry("pdf-tools")], {
      lastFetchedAt: new Date(),
    });
    marketplaceModule.rows.set("user-added", {
      id: 99,
      name: "user-added",
      ownerName: "Team",
      sourceKind: "url",
      sourceUri: "https://x/m.json",
      manifestJson: JSON.stringify({
        name: "user-added",
        owner: { name: "Team" },
        plugins: [
          {
            name: "lead-research",
            source: { source: "url", url: "https://x/p" },
          },
        ],
      }),
      pluginCount: 1,
      enabled: 1,
      autoUpdate: 0,
      health: "healthy",
      lastErrorJson: "[]",
      sourceMetaJson: "{}",
    });

    const plugins = await service.listAvailablePlugins({});
    expect(plugins.map((p) => p.marketplaceName)).toEqual(["user-added"]);
  });

  test("addMarketplace refuses a manifest claiming the reserved hub name", async () => {
    const { service } = makeService([hubEntry("pdf-tools")]);
    await expect(
      service.addMarketplace({
        source: "https://evil.example.com/marketplace.json",
        overwrite: true,
      })
    ).rejects.toThrow(/reserved/i);
    expect(installFromSource).not.toHaveBeenCalled();
  });

  test("refreshMarketplace routes the hub name through the community path", async () => {
    const { service, fetcher } = makeService(
      [
        hubEntry("pdf-tools"),
        hubEntry("locked", {
          access: { status: "subscription_required", installMode: "ticket" },
          source: undefined,
        }),
      ],
      { lastFetchedAt: new Date() }
    );

    const summary = await service.refreshMarketplace(HUB_MARKETPLACE_NAME);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(summary.name).toBe(HUB_MARKETPLACE_NAME);
    expect(summary.sourceKind).toBe("aifetch-hub");
    const row = await marketplaceModule.getMarketplaceByName(
      HUB_MARKETPLACE_NAME
    );
    expect(row?.health).toBe("healthy");
    expect(row?.pluginCount).toBe(2);
  });

  test("install enforces the hub's access.status decision, not just installMode", async () => {
    const { service } = makeService(
      [
        hubEntry("stale-entitled", {
          access: { status: "subscription_required", installMode: "direct" },
        }),
        hubEntry("anon-only", {
          access: { status: "login_required", installMode: "direct" },
        }),
      ],
      { lastFetchedAt: new Date() }
    );
    await expect(
      service.installCommunityPlugin("stale-entitled")
    ).rejects.toThrow(/subscription/i);
    await expect(service.installCommunityPlugin("anon-only")).rejects.toThrow(
      /sign in/i
    );
    expect(installFromSource).not.toHaveBeenCalled();
  });
});
