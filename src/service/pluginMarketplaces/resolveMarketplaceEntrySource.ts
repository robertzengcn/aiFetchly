import * as fs from "fs";
import * as path from "path";
import type { PluginSourceKind } from "@/entityTypes/pluginTypes";
import type { PluginSourceRequest } from "@/service/pluginSources/pluginSourceTypes";
import type {
  MarketplaceInstallMeta,
  PluginMarketplaceEntry,
  PluginMarketplaceError,
  PluginMarketplaceMetadata,
  PluginMarketplaceSource,
} from "@/entityTypes/pluginMarketplaceTypes";
import { assertPathInsideBase } from "./pluginMarketplacePaths";

export interface MarketplaceEntryResolutionContext {
  readonly marketplaceName: string;
  readonly marketplaceRoot: string;
  readonly marketplaceSource: PluginMarketplaceSource;
  readonly marketplaceVersion?: string;
  readonly metadata?: PluginMarketplaceMetadata;
}

export interface ResolvedMarketplacePluginSource {
  readonly request: PluginSourceRequest;
  readonly meta: MarketplaceInstallMeta;
  readonly warnings: readonly PluginMarketplaceError[];
}

export type ResolveResult =
  | { success: true; resolved: ResolvedMarketplacePluginSource }
  | { success: false; errors: PluginMarketplaceError[] };

function err(
  code: PluginMarketplaceError["code"],
  message: string,
  pluginName?: string
): PluginMarketplaceError {
  return { code, message, recoverable: false, ...(pluginName ? { pluginName } : {}) };
}

/** metadata.pluginRoot may relocate the plugin root within the marketplace. */
function resolvePluginRoot(marketplaceRoot: string, pluginRoot?: string): string {
  if (!pluginRoot) return marketplaceRoot;
  const candidate = path.resolve(marketplaceRoot, pluginRoot);
  try {
    assertPathInsideBase(marketplaceRoot, candidate);
  } catch {
    return marketplaceRoot;
  }
  return candidate;
}

export function resolveMarketplaceEntrySource(
  entry: PluginMarketplaceEntry,
  context: MarketplaceEntryResolutionContext
): ResolveResult {
  const baseRoot = resolvePluginRoot(context.marketplaceRoot, context.metadata?.pluginRoot);
  const resolvedAt = new Date().toISOString();
  const buildMeta = (resolved: {
    resolvedSourceKind: PluginSourceKind;
    resolvedSourceUri?: string;
    resolvedSourceRef?: string;
  }): MarketplaceInstallMeta => ({
    marketplaceName: context.marketplaceName,
    marketplaceSource: context.marketplaceSource,
    ...(context.marketplaceVersion ? { marketplaceVersion: context.marketplaceVersion } : {}),
    entryName: entry.name,
    ...(entry.version ? { entryVersion: entry.version } : {}),
    entrySource: entry.source,
    ...resolved,
    resolvedAt,
  });

  // Relative string source -> local-folder, must stay inside root AND exist.
  if (typeof entry.source === "string") {
    if (!context.marketplaceSource || context.marketplaceSource.kind === "url") {
      return {
        success: false,
        errors: [err("marketplace-plugin-source-unsupported", "Relative plugin sources require a marketplace repository root.", entry.name)],
      };
    }
    try {
      const candidate = path.resolve(baseRoot, entry.source);
      assertPathInsideBase(baseRoot, candidate);
      if (!fs.existsSync(candidate)) {
        return { success: false, errors: [err("marketplace-plugin-source-outside-root", `Plugin path does not exist: ${entry.source}`, entry.name)] };
      }
      const realBase = fs.realpathSync(baseRoot);
      const realCandidate = fs.existsSync(candidate) ? fs.realpathSync(candidate) : candidate;
      assertPathInsideBase(realBase, realCandidate);
      const request: PluginSourceRequest = {
        kind: "local-folder",
        folderPath: realCandidate,
        source: "marketplace",
      };
      return {
        success: true,
        resolved: {
          request,
          meta: buildMeta({ resolvedSourceKind: "local-folder", resolvedSourceUri: realCandidate }),
          warnings: [],
        },
      };
    } catch {
      return { success: false, errors: [err("marketplace-plugin-source-outside-root", `Plugin source escapes marketplace root: ${entry.source}`, entry.name)] };
    }
  }

  // Object sources.
  switch (entry.source.source) {
    case "github": {
      const ref = entry.source.sha ?? entry.source.ref;
      const uri = `https://github.com/${entry.source.repo}`;
      const request: PluginSourceRequest = {
        kind: "github",
        uri,
        ...(ref ? { ref } : {}),
        source: "marketplace",
      };
      return {
        success: true,
        resolved: {
          request,
          meta: buildMeta({ resolvedSourceKind: "github", resolvedSourceUri: uri, resolvedSourceRef: ref }),
          warnings: [],
        },
      };
    }
    case "url": {
      const url = entry.source.url;
      const ref = entry.source.sha ?? entry.source.ref;
      const isGit = url.endsWith(".git") || url.startsWith("git@") || url.startsWith("ssh://");
      const isGithub = /^https:\/\/github\.com\//i.test(url);
      const kind: PluginSourceKind = isGithub ? "github" : isGit ? "git" : "url";
      const request: PluginSourceRequest = { kind, uri: url, ...(ref ? { ref } : {}), source: "marketplace" };
      return {
        success: true,
        resolved: {
          request,
          meta: buildMeta({ resolvedSourceKind: kind, resolvedSourceUri: url, resolvedSourceRef: ref }),
          warnings: [],
        },
      };
    }
    case "npm": {
      const request: PluginSourceRequest = {
        kind: "npm",
        npmPackage: entry.source.package,
        ...(entry.source.version ? { npmVersion: entry.source.version } : {}),
        ...(entry.source.registry ? { npmRegistry: entry.source.registry } : {}),
        source: "marketplace",
      };
      return {
        success: true,
        resolved: {
          request,
          meta: buildMeta({
            resolvedSourceKind: "npm",
            resolvedSourceUri: entry.source.package,
            resolvedSourceRef: entry.source.version,
          }),
          warnings: [],
        },
      };
    }
    case "git-subdir":
      return {
        success: false,
        errors: [err("marketplace-plugin-source-unsupported", "git-subdir plugin sources are not supported in MVP.", entry.name)],
      };
    default:
      return { success: false, errors: [err("marketplace-plugin-source-unsupported", "Unrecognized plugin entry source.", entry.name)] };
  }
}
