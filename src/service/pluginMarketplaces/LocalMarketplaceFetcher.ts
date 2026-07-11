import * as fs from "fs";
import * as path from "path";
import { applyDirectoryLimits } from "@/service/pluginSources/pluginSourceLimits";
import { getPluginsRoot } from "@/service/pluginPaths";
import {
  getPluginMarketplaceCacheRoot,
  getPluginMarketplaceTempRoot,
} from "./pluginMarketplacePaths";
import { locateMarketplaceManifest } from "./GitMarketplaceFetcher";
import {
  mktErr,
  type PluginMarketplaceFetchResult,
  type PluginMarketplaceFetcher,
  type PluginMarketplaceFetchRequest,
} from "./marketplaceFetcherTypes";

export class LocalMarketplaceFetcher implements PluginMarketplaceFetcher {
  readonly kind = "local-folder" as const; // also handles local-file

  async fetch(
    req: PluginMarketplaceFetchRequest
  ): Promise<PluginMarketplaceFetchResult> {
    const src = req.source.uri;
    if (!src || !fs.existsSync(src)) {
      return {
        success: false,
        errors: [
          mktErr(
            "marketplace-source-invalid",
            `Path not found: ${src ?? "(none)"}`
          ),
        ],
      };
    }

    const stat = fs.statSync(src);
    const resolvedRoot = path.resolve(src);
    const pluginsRoot = path.resolve(getPluginsRoot());
    if (
      resolvedRoot === pluginsRoot ||
      resolvedRoot.startsWith(pluginsRoot + path.sep)
    ) {
      return {
        success: false,
        errors: [
          mktErr(
            "marketplace-source-invalid",
            "Marketplace source must not live inside the plugins cache."
          ),
        ],
      };
    }

    // For local-file, just read the manifest; no repo root => relative entries unsupported.
    if (stat.isFile()) {
      const manifestJson = fs.readFileSync(resolvedRoot, "utf-8");
      return {
        success: true,
        marketplace: {
          marketplaceRoot: path.dirname(resolvedRoot),
          manifestPath: resolvedRoot,
          manifestJson,
          cleanup: async () => {
            /* user-owned file — do not delete */
          },
        },
      };
    }

    // local-folder: enforce limits, then copy into cache.
    const limits = applyDirectoryLimits(resolvedRoot);
    if (!limits.ok) {
      const msg =
        limits.reason === "too-many-files"
          ? `Marketplace folder has too many files (${limits.fileCount}).`
          : `Marketplace folder is too large (${limits.totalBytes.toString()} bytes).`;
      return {
        success: false,
        errors: [mktErr("marketplace-source-invalid", msg)],
      };
    }

    const manifestPath = locateMarketplaceManifest(resolvedRoot);
    if (!manifestPath) {
      return {
        success: false,
        errors: [
          mktErr(
            "marketplace-manifest-not-found",
            "No .claude-plugin/marketplace.json found in folder."
          ),
        ],
      };
    }

    const nameGuess = path.basename(resolvedRoot);
    const dest = path.join(
      getPluginMarketplaceTempRoot(),
      `${nameGuess}-${Date.now()}`
    );
    fs.mkdirSync(dest, { recursive: true });
    try {
      copyDirSync(resolvedRoot, dest);
    } catch (e: unknown) {
      fs.rmSync(dest, { recursive: true, force: true });
      return {
        success: false,
        errors: [
          mktErr(
            "marketplace-fetch-failed",
            e instanceof Error
              ? e.message
              : "Failed to copy marketplace folder."
          ),
        ],
      };
    }

    const copiedManifest =
      locateMarketplaceManifest(dest) ?? path.join(dest, "marketplace.json");
    const manifestJson = fs.readFileSync(copiedManifest, "utf-8");
    return {
      success: true,
      marketplace: {
        marketplaceRoot: dest,
        manifestPath: copiedManifest,
        manifestJson,
        cleanup: async () => {
          try {
            fs.rmSync(dest, { recursive: true, force: true });
          } catch {
            /* best-effort */
          }
        },
      },
    };
  }
}

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}
