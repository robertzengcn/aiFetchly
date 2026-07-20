import * as fs from "fs";
import * as path from "path";
import { PluginMarketplaceModule } from "@/modules/PluginMarketplaceModule";
import { PluginManagementModule } from "@/modules/PluginManagementModule";
import { PluginInstallService } from "@/service/PluginInstallService";
import { redactMessage } from "@/service/pluginSources/pluginSourceRedact";
import type { PluginSummary } from "@/entityTypes/pluginTypes";
import type {
  AddPluginMarketplaceRequest,
  InstallMarketplacePluginRequest,
  MarketplaceInstallMeta,
  PluginMarketplaceCapabilitySummary,
  PluginMarketplaceDetail,
  PluginMarketplaceError,
  PluginMarketplaceHealth,
  PluginMarketplaceManifest,
  PluginMarketplacePluginDetail,
  PluginMarketplacePluginFilter,
  PluginMarketplacePluginSummary,
  PluginMarketplaceSource,
  PluginMarketplaceSourceKind,
  PluginMarketplaceSummary,
} from "@/entityTypes/pluginMarketplaceTypes";
import { parseMarketplaceSource } from "@/service/pluginMarketplaces/parseMarketplaceSource";
import { validateMarketplaceManifest } from "@/service/pluginMarketplaces/pluginMarketplaceValidation";
import {
  createDefaultMarketplaceFetcherRegistry,
  PluginMarketplaceFetcherRegistry,
} from "@/service/pluginMarketplaces/PluginMarketplaceFetcherRegistry";
import type { PluginMarketplaceFetcher } from "@/service/pluginMarketplaces/marketplaceFetcherTypes";
import { resolveMarketplaceEntrySource } from "@/service/pluginMarketplaces/resolveMarketplaceEntrySource";
import { parsePluginIdentifier } from "@/service/pluginMarketplaces/parsePluginIdentifier";
import { getPluginMarketplaceCacheRoot } from "@/service/pluginMarketplaces/pluginMarketplacePaths";

/**
 * Orchestrates marketplace add/list/get/refresh/remove/discover/install.
 * All DB access goes through PluginMarketplaceModule. All installs delegate
 * to PluginInstallService. Never accesses TypeORM repositories directly.
 */
export class PluginMarketplaceService {
  constructor(
    private readonly marketplaceModule: PluginMarketplaceModule = new PluginMarketplaceModule(),
    private readonly installService: PluginInstallService = new PluginInstallService(),
    private readonly fetcher: PluginMarketplaceFetcher = createDefaultFetcherForService()
  ) {}

  // --- marketplace lifecycle ---

  async addMarketplace(
    req: AddPluginMarketplaceRequest
  ): Promise<PluginMarketplaceSummary> {
    const parsed = parseMarketplaceSource(req.source, req.ref);
    if (!parsed.success) {
      throw new Error(parsed.errors.map((e) => e.message).join("; "));
    }
    const fetched = await this.fetcher.fetch({ source: parsed.source });
    if (!fetched.success) {
      throw new Error(fetched.errors.map((e) => e.message).join("; "));
    }

    const validation = validateMarketplaceManifest(
      fetched.marketplace.manifestJson
    );
    if (!validation.success) {
      await fetched.marketplace.cleanup();
      throw new Error(validation.errors.map((e) => e.message).join("; "));
    }
    const manifest = validation.manifest;

    const existing = await this.marketplaceModule.getMarketplaceByName(
      manifest.name
    );
    if (existing && !req.overwrite) {
      await fetched.marketplace.cleanup();
      throw new Error(
        `Marketplace "${manifest.name}" already exists. Use overwrite to replace it.`
      );
    }

    // Atomic cache write under cache/<manifest.name>.
    const cacheRoot = getPluginMarketplaceCacheRoot(manifest.name);
    const next = `${cacheRoot}.next-${Date.now()}`;
    fs.mkdirSync(next, { recursive: true });
    try {
      copyTree(fetched.marketplace.marketplaceRoot, next);
      // Ensure a marketplace.json sits at the cache root for URL-style lookups.
      const rootManifest = path.join(next, "marketplace.json");
      if (!fs.existsSync(rootManifest)) {
        fs.writeFileSync(
          rootManifest,
          fetched.marketplace.manifestJson,
          "utf-8"
        );
      }
      // Swap: move old aside, rename next into place, drop old.
      const old = `${cacheRoot}.old`;
      try {
        fs.rmSync(old, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      if (fs.existsSync(cacheRoot)) fs.renameSync(cacheRoot, old);
      fs.mkdirSync(path.dirname(cacheRoot), { recursive: true });
      fs.renameSync(next, cacheRoot);
      try {
        fs.rmSync(old, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    } catch (e: unknown) {
      fs.rmSync(next, { recursive: true, force: true });
      await fetched.marketplace.cleanup();
      throw new Error(
        e instanceof Error ? e.message : "Failed to write marketplace cache."
      );
    } finally {
      await fetched.marketplace.cleanup();
    }

    const redactedUri = redactMessage(parsed.source.uri);
    const input = {
      name: manifest.name,
      displayName: manifest.owner?.name,
      ownerName: manifest.owner?.name ?? "unknown",
      ownerEmail: manifest.owner?.email,
      ownerUrl: manifest.owner?.url,
      description: manifest.description,
      version: manifest.version,
      sourceKind: parsed.source.kind as PluginMarketplaceEntitySourceKind,
      sourceUri: redactedUri,
      sourceRef: parsed.source.ref,
      installPath: cacheRoot,
      manifestJson: fetched.marketplace.manifestJson,
      pluginCount: manifest.plugins.length,
      enabled: 1,
      autoUpdate: 0,
      health: "healthy" as PluginMarketplaceHealth,
      lastFetchedAt: new Date(),
      sourceMetaJson: JSON.stringify({ rawSourceKind: parsed.source.kind }),
    };

    if (existing) {
      await this.marketplaceModule.updateMarketplaceState(input);
    } else {
      try {
        await this.marketplaceModule.createMarketplace(input);
      } catch (e: unknown) {
        // Race: a concurrent add won the unique-name race between our
        // getMarketplaceByName check and this insert. The unique index is the
        // real guard; surface a clean conflict instead of a raw constraint error.
        if (e instanceof Error && /UNIQUE constraint/i.test(e.message)) {
          throw new Error(
            `Marketplace "${manifest.name}" already exists. Use overwrite to replace it.`
          );
        }
        throw e;
      }
    }
    const row = await this.marketplaceModule.getMarketplaceByName(
      manifest.name
    );
    return toSummary(row!);
  }

  async listMarketplaces(): Promise<PluginMarketplaceSummary[]> {
    const rows = await this.marketplaceModule.listMarketplaces();
    return rows.map(toSummary);
  }

  async getMarketplace(name: string): Promise<PluginMarketplaceDetail | null> {
    const row = await this.marketplaceModule.getMarketplaceByName(name);
    if (!row) return null;
    return toDetail(row);
  }

  async refreshMarketplace(name: string): Promise<PluginMarketplaceSummary> {
    const existing = await this.marketplaceModule.getMarketplaceByName(name);
    if (!existing) throw new Error(`Marketplace "${name}" not found.`);
    // Re-fetch using the stored source.
    const source: PluginMarketplaceSource = {
      kind: existing.sourceKind as PluginMarketplaceSourceKind,
      uri: existing.sourceUri,
      ...(existing.sourceRef ? { ref: existing.sourceRef } : {}),
    };
    const fetched = await this.fetcher.fetch({ source });
    if (!fetched.success) {
      // Keep previous good cache.
      await this.marketplaceModule.setMarketplaceErrors(name, fetched.errors);
      throw new Error(fetched.errors.map((e) => e.message).join("; "));
    }
    const validation = validateMarketplaceManifest(
      fetched.marketplace.manifestJson
    );
    if (!validation.success || validation.manifest.name !== name) {
      await fetched.marketplace.cleanup();
      await this.marketplaceModule.setMarketplaceErrors(
        name,
        validation.success
          ? [
              {
                code: "marketplace-name-conflict",
                message: "Refreshed marketplace name changed.",
                recoverable: false,
              },
            ]
          : validation.errors
      );
      throw new Error(
        "Refreshed marketplace is invalid or renamed; previous cache retained."
      );
    }
    // Re-run the add flow's cache write + persist by delegating back through addMarketplace.
    await fetched.marketplace.cleanup();
    return this.addMarketplace({
      source: source.uri,
      ref: source.ref,
      overwrite: true,
    });
  }

  async removeMarketplace(name: string): Promise<void> {
    const existing = await this.marketplaceModule.getMarketplaceByName(name);
    if (!existing) return;
    await this.marketplaceModule.removeMarketplace(name);
    // Best-effort cache removal. Installed plugins are LEFT intact (MVP).
    try {
      fs.rmSync(getPluginMarketplaceCacheRoot(name), {
        recursive: true,
        force: true,
      });
    } catch {
      /* best-effort */
    }
  }

  // --- discover ---

  async listAvailablePlugins(
    filter: PluginMarketplacePluginFilter = {}
  ): Promise<PluginMarketplacePluginSummary[]> {
    const marketplaces = await this.marketplaceModule.listEnabledMarketplaces();
    const installedRows =
      await new PluginManagementModule().listInstalledPlugins();
    const installedByEntry = new Map<string, { version?: string }>();
    for (const row of installedRows) {
      try {
        const meta = JSON.parse(row.sourceMetaJson || "{}") as {
          marketplace?: { marketplaceName?: string; entryName?: string };
        };
        if (meta.marketplace?.marketplaceName && meta.marketplace?.entryName) {
          installedByEntry.set(
            `${meta.marketplace.entryName}@${meta.marketplace.marketplaceName}`,
            {
              version: row.version,
            }
          );
        }
      } catch {
        /* ignore */
      }
    }

    const out: PluginMarketplacePluginSummary[] = [];
    for (const mp of marketplaces) {
      let manifest: PluginMarketplaceManifest;
      try {
        manifest = JSON.parse(mp.manifestJson);
      } catch {
        continue;
      }
      for (const entry of manifest.plugins ?? []) {
        const resolution = resolveMarketplaceEntrySource(entry, {
          marketplaceName: mp.name,
          marketplaceRoot: mp.installPath ?? "",
          marketplaceSource: {
            kind: mp.sourceKind as PluginMarketplaceSourceKind,
            uri: mp.sourceUri,
            ...(mp.sourceRef ? { ref: mp.sourceRef } : {}),
          },
          ...(mp.version ? { marketplaceVersion: mp.version } : {}),
          ...(manifest.metadata ? { metadata: manifest.metadata } : {}),
        });
        const key = `${entry.name}@${mp.name}`;
        const inst = installedByEntry.get(key);
        const status = !resolution.success
          ? resolution.errors.some(
              (e) => e.code === "marketplace-plugin-source-unsupported"
            )
            ? "unsupported"
            : "error"
          : !inst
          ? "not_installed"
          : inst.version && entry.version && inst.version !== entry.version
          ? "different_version"
          : "installed";
        out.push({
          pluginId: key,
          name: entry.name,
          ...(entry.displayName ? { displayName: entry.displayName } : {}),
          marketplaceName: mp.name,
          ...(mp.displayName ? { marketplaceDisplayName: mp.displayName } : {}),
          ...(entry.version ? { version: entry.version } : {}),
          ...(entry.description ? { description: entry.description } : {}),
          ...(entry.author
            ? {
                author:
                  typeof entry.author === "string"
                    ? entry.author
                    : entry.author.name,
              }
            : {}),
          ...(entry.category ? { category: entry.category } : {}),
          tags: entry.tags ?? [],
          sourceKind:
            typeof entry.source === "string" ? "relative" : entry.source.source,
          capabilitySummary: summarizeCapabilities(entry),
          installed: !!inst,
          ...(inst?.version ? { installedVersion: inst.version } : {}),
          status,
          errors: resolution.success ? [] : resolution.errors,
        });
      }
    }

    return applyFilterAndSort(out, filter);
  }

  async getAvailablePlugin(
    pluginId: string
  ): Promise<PluginMarketplacePluginDetail | null> {
    const parsed = parsePluginIdentifier(pluginId);
    if (!parsed.ok || !parsed.value.marketplace) return null;
    const { name, marketplace } = parsed.value;
    const mp = await this.marketplaceModule.getMarketplaceByName(marketplace);
    if (!mp) return null;
    let manifest: PluginMarketplaceManifest;
    try {
      manifest = JSON.parse(mp.manifestJson);
    } catch {
      return null;
    }
    const entry = (manifest.plugins ?? []).find((p) => p.name === name);
    if (!entry) return null;
    const summaries = await this.listAvailablePlugins({
      marketplaceName: marketplace,
    });
    const summary = summaries.find((s) => s.pluginId === pluginId);
    if (!summary) return null;
    const resolution = resolveMarketplaceEntrySource(entry, {
      marketplaceName: mp.name,
      marketplaceRoot: mp.installPath ?? "",
      marketplaceSource: {
        kind: mp.sourceKind as PluginMarketplaceSourceKind,
        uri: mp.sourceUri,
        ...(mp.sourceRef ? { ref: mp.sourceRef } : {}),
      },
      ...(mp.version ? { marketplaceVersion: mp.version } : {}),
      ...(manifest.metadata ? { metadata: manifest.metadata } : {}),
    });
    return {
      ...summary,
      ...(entry.homepage ? { homepage: entry.homepage } : {}),
      ...(entry.repository ? { repository: entry.repository } : {}),
      ...(entry.license ? { license: entry.license } : {}),
      entry,
      ...(resolution.success
        ? {
            resolvedSourceKind: resolution.resolved.meta.resolvedSourceKind,
            resolvedSourceUri: resolution.resolved.meta.resolvedSourceUri,
            resolvedSourceRef: resolution.resolved.meta.resolvedSourceRef,
            pinnedToCommit:
              typeof entry.source === "object" &&
              !!(entry.source as { sha?: string }).sha,
          }
        : { pinnedToCommit: false }),
    };
  }

  async installMarketplacePlugin(
    req: InstallMarketplacePluginRequest
  ): Promise<PluginSummary> {
    const parsed = parsePluginIdentifier(req.pluginId);
    if (!parsed.ok || !parsed.value.marketplace) {
      throw new Error(
        "Invalid plugin identifier. Use plugin-name@marketplace-name."
      );
    }
    const { name, marketplace } = parsed.value;
    const mp = await this.marketplaceModule.getMarketplaceByName(marketplace);
    if (!mp) throw new Error(`Marketplace "${marketplace}" not found.`);
    let manifest: PluginMarketplaceManifest;
    try {
      manifest = JSON.parse(mp.manifestJson);
    } catch {
      throw new Error("Marketplace manifest is corrupt.");
    }
    const entry = (manifest.plugins ?? []).find((p) => p.name === name);
    if (!entry)
      throw new Error(
        `Plugin "${name}" not found in marketplace "${marketplace}".`
      );

    const resolution = resolveMarketplaceEntrySource(entry, {
      marketplaceName: mp.name,
      marketplaceRoot: mp.installPath ?? "",
      marketplaceSource: {
        kind: mp.sourceKind as PluginMarketplaceSourceKind,
        uri: mp.sourceUri,
        ...(mp.sourceRef ? { ref: mp.sourceRef } : {}),
      },
      ...(mp.version ? { marketplaceVersion: mp.version } : {}),
      ...(manifest.metadata ? { metadata: manifest.metadata } : {}),
    });
    if (!resolution.success) {
      throw new Error(resolution.errors.map((e) => e.message).join("; "));
    }

    const meta: MarketplaceInstallMeta = resolution.resolved.meta;
    const result = await this.installService.installFromSource({
      ...resolution.resolved.request,
      ...(req.overwrite !== undefined ? { overwrite: req.overwrite } : {}),
      ...(req.npmAuthToken ? { npmAuthToken: req.npmAuthToken } : {}),
      source: "marketplace",
      sourceMeta: { marketplace: meta },
    });
    if (!result.success) {
      throw new Error(result.errors.map((e) => e.message).join("; "));
    }
    return result.plugin;
  }
}

// --- helpers ---

type PluginMarketplaceEntitySourceKind = PluginMarketplaceSourceKind;

function createDefaultFetcherForService(): PluginMarketplaceFetcher {
  // Wrap the registry: pick the fetcher matching the parsed source kind at call time.
  const registry: PluginMarketplaceFetcherRegistry =
    createDefaultMarketplaceFetcherRegistry();
  return {
    kind: "local-folder",
    async fetch(req) {
      return registry.get(req.source.kind).fetch(req);
    },
  };
}

function toSummary(row: {
  id: number;
  name: string;
  displayName?: string | null;
  ownerName: string;
  description?: string | null;
  version?: string | null;
  sourceKind: string;
  sourceUri: string;
  sourceRef?: string | null;
  pluginCount: number;
  enabled: number;
  autoUpdate: number;
  health: string;
  lastFetchedAt?: Date | null;
  updatedAt?: Date | null;
}): PluginMarketplaceSummary {
  return {
    id: row.id,
    name: row.name,
    ...(row.displayName ? { displayName: row.displayName } : {}),
    ownerName: row.ownerName,
    ...(row.description ? { description: row.description } : {}),
    ...(row.version ? { version: row.version } : {}),
    sourceKind: row.sourceKind as PluginMarketplaceSourceKind,
    sourceUri: row.sourceUri,
    ...(row.sourceRef ? { sourceRef: row.sourceRef } : {}),
    pluginCount: row.pluginCount,
    enabled: row.enabled === 1,
    autoUpdate: row.autoUpdate === 1,
    health: row.health as PluginMarketplaceHealth,
    ...(row.lastFetchedAt
      ? { lastFetchedAt: new Date(row.lastFetchedAt).toISOString() }
      : {}),
    ...(row.updatedAt
      ? { updatedAt: new Date(row.updatedAt).toISOString() }
      : {}),
  };
}

function toDetail(
  row: Parameters<typeof toSummary>[0] & {
    ownerEmail?: string | null;
    ownerUrl?: string | null;
    installPath?: string | null;
    manifestJson: string;
    lastErrorJson: string;
    sourceMetaJson: string;
  }
): PluginMarketplaceDetail {
  let manifest: PluginMarketplaceManifest = {
    name: row.name,
    owner: { name: row.ownerName },
    plugins: [],
  };
  try {
    manifest = JSON.parse(row.manifestJson);
  } catch {
    /* keep default */
  }
  let errors: PluginMarketplaceError[] = [];
  try {
    errors = JSON.parse(row.lastErrorJson);
  } catch {
    /* keep default */
  }
  let sourceMeta: Record<string, unknown> = {};
  try {
    sourceMeta = JSON.parse(row.sourceMetaJson);
  } catch {
    /* keep default */
  }
  return {
    ...toSummary(row),
    ...(row.ownerEmail ? { ownerEmail: row.ownerEmail } : {}),
    ...(row.ownerUrl ? { ownerUrl: row.ownerUrl } : {}),
    manifest,
    errors,
    ...(row.installPath ? { installPath: row.installPath } : {}),
    sourceMeta,
  };
}

function summarizeCapabilities(entry: {
  skills?: unknown;
  commands?: unknown;
  agents?: unknown;
  hooks?: unknown;
  mcpServers?: unknown;
  lspServers?: unknown;
  outputStyles?: unknown;
  experimental?: unknown;
}): PluginMarketplaceCapabilitySummary {
  const has = (v: unknown) => (Array.isArray(v) ? v.length > 0 : !!v);
  return {
    hasSkills: has(entry.skills),
    hasCommands: has(entry.commands),
    hasAgents: has(entry.agents),
    hasHooks: has(entry.hooks),
    hasMcpServers: has(entry.mcpServers),
    hasLspServers: has(entry.lspServers),
    hasOutputStyles: has(entry.outputStyles),
    hasMonitors: has(
      (entry.experimental as { monitors?: unknown } | undefined)?.monitors
    ),
  };
}

function applyFilterAndSort(
  items: PluginMarketplacePluginSummary[],
  filter: PluginMarketplacePluginFilter
): PluginMarketplacePluginSummary[] {
  let out = items.slice();
  if (filter.search) {
    const q = filter.search.toLowerCase();
    out = out.filter((p) =>
      [
        p.name,
        p.displayName ?? "",
        p.description ?? "",
        p.author ?? "",
        p.category ?? "",
        p.marketplaceName,
        ...p.tags,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }
  if (filter.marketplaceName)
    out = out.filter((p) => p.marketplaceName === filter.marketplaceName);
  if (filter.category) out = out.filter((p) => p.category === filter.category);
  if (filter.installed !== undefined)
    out = out.filter((p) => p.installed === filter.installed);
  if (filter.hasSkills) out = out.filter((p) => p.capabilitySummary.hasSkills);
  if (filter.hasMcpServers)
    out = out.filter((p) => p.capabilitySummary.hasMcpServers);
  if (filter.hasHooks) out = out.filter((p) => p.capabilitySummary.hasHooks);
  out.sort((a, b) => {
    const ea = a.errors.length > 0 ? 1 : 0;
    const eb = b.errors.length > 0 ? 1 : 0;
    if (ea !== eb) return ea - eb;
    const ia = a.installed ? 1 : 0;
    const ib = b.installed ? 1 : 0;
    if (ia !== ib) return ia - ib;
    if (a.marketplaceName !== b.marketplaceName)
      return a.marketplaceName.localeCompare(b.marketplaceName);
    return (a.displayName || a.name).localeCompare(b.displayName || b.name);
  });
  return out;
}

function copyTree(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyTree(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}
