import * as path from "path";
import { getElectronUserDataPath } from "@/service/SkillEnvironmentManager";

/**
 * Marketplace cache layout lives under <userData>/plugins/marketplaces/.
 * Marketplace files are NOT installed plugins (those live under .../installed/).
 */
export function getPluginMarketplacesRoot(): string {
  return path.join(getElectronUserDataPath(), "plugins", "marketplaces");
}

export function getPluginMarketplaceCacheRoot(name: string): string {
  return path.join(getPluginMarketplacesRoot(), "cache", name);
}

export function getPluginMarketplaceTempRoot(): string {
  return path.join(getPluginMarketplacesRoot(), "tmp");
}

/** git / local-folder style manifest location. */
export function getPluginMarketplaceManifestPath(name: string): string {
  return path.join(getPluginMarketplaceCacheRoot(name), ".claude-plugin", "marketplace.json");
}

/** direct URL download manifest location. */
export function getPluginMarketplaceDownloadedManifestPath(name: string): string {
  return path.join(getPluginMarketplaceCacheRoot(name), "marketplace.json");
}

/**
 * Resolve a relative entry source against the marketplace root and verify it
 * stays inside. Throws when the path escapes. Mirrors resolvePluginRelativePath
 * but operates against the marketplace root.
 */
export function assertPathInsideBase(base: string, target: string): void {
  const rel = path.relative(base, target);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) return;
  throw new Error("Path escapes marketplace root.");
}
