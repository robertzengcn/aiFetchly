/**
 * Local AI Runtime — compatibility selection.
 *
 * Selects the best catalog entry for a runtime id + running target. Selection
 * requires an exact runtime ID / platform / architecture / Node-module-ABI
 * match and an in-range app version. The service never silently falls back to
 * another architecture, Rosetta target, or older ABI (design §4.6, §11.3).
 */
import semver from "semver";
import {
  LocalAiRuntimeError,
  type LocalAiRuntimeCatalog,
  type LocalAiRuntimeCatalogEntry,
  type LocalAiRuntimeId,
  type LocalAiRuntimeTarget,
} from "@/entityTypes/localAiRuntimeTypes";

export class LocalAiRuntimeCompatibilityService {
  /**
   * True iff `entry` matches `target` exactly (platform/arch/ABI) and the app
   * version is inside the declared range.
   */
  isCompatible(entry: LocalAiRuntimeCatalogEntry, target: LocalAiRuntimeTarget): boolean {
    if (entry.platform !== target.platform) return false;
    if (entry.arch !== target.arch) return false;
    if (entry.nodeModuleAbi !== target.nodeModuleAbi) return false;
    if (semver.lt(target.appVersion, entry.minAppVersion)) return false;
    if (entry.maxAppVersion && semver.gt(target.appVersion, entry.maxAppVersion)) {
      return false;
    }
    return true;
  }

  /**
   * Select the highest compatible runtime version for the target. Throws
   * `runtime_catalog_target_missing` when no entry matches.
   */
  selectEntry(
    catalog: LocalAiRuntimeCatalog,
    runtimeId: LocalAiRuntimeId,
    target: LocalAiRuntimeTarget,
  ): LocalAiRuntimeCatalogEntry {
    const compatible = catalog.runtimes
      .filter((entry) => entry.runtimeId === runtimeId)
      .filter((entry) => this.isCompatible(entry, target))
      .sort((a, b) => semver.rcompare(a.runtimeVersion, b.runtimeVersion));

    if (compatible.length === 0) {
      throw new LocalAiRuntimeError(
        "runtime_catalog_target_missing",
        `No catalog entry for ${runtimeId} on ${target.platform}/${target.arch} ABI ${target.nodeModuleAbi}.`,
      );
    }
    return compatible[0];
  }

  /**
   * Find the highest compatible entry without throwing. Returns null when none
   * matches — useful for update checks and offline status.
   */
  findCompatibleEntry(
    catalog: LocalAiRuntimeCatalog,
    runtimeId: LocalAiRuntimeId,
    target: LocalAiRuntimeTarget,
  ): LocalAiRuntimeCatalogEntry | null {
    try {
      return this.selectEntry(catalog, runtimeId, target);
    } catch (error) {
      if (error instanceof LocalAiRuntimeError) return null;
      throw error;
    }
  }
}
