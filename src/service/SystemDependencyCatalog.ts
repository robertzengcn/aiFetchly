/**
 * Loads and validates the shipped dependency catalog.
 *
 * The catalog maps normalized `dependency_id` strings to per-platform
 * install information (package manager + package name + probe binary).
 * It is the single source of truth for which dependencies aiFetchly
 * can auto-install.
 */

import type {
  DependencyCatalog,
  DependencyCatalogEntry,
  DependencyPlatform,
  PlatformCandidate,
} from "@/entityTypes/systemDependencyTypes";

/** Allowed package manager values (defense-in-depth). */
const ALLOWED_MANAGERS = new Set(["brew", "apt", "winget"]);

/** Package names must be conservative alphanumeric + safe chars. */
const PACKAGE_NAME_RE = /^[a-zA-Z0-9._-]+$/;

/**
 * Validates the raw JSON structure and returns a typed object.
 *
 * @throws Error if version is unsupported or entries are malformed.
 */
export function loadCatalogFromConfig(raw: unknown): DependencyCatalog {
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("version" in raw) ||
    !("dependencies" in raw)
  ) {
    throw new Error("Invalid catalog: missing version or dependencies");
  }

  const catalog = raw as DependencyCatalog;

  if (catalog.version !== 1) {
    throw new Error(`Unsupported catalog version: ${String(catalog.version)}`);
  }

  for (const [id, entry] of Object.entries(catalog.dependencies)) {
    if (typeof entry.probe !== "string" || entry.probe.length === 0) {
      throw new Error(
        `Invalid catalog entry "${id}": probe must be a non-empty string`
      );
    }
    if (
      typeof entry.description !== "string" ||
      entry.description.length === 0
    ) {
      throw new Error(
        `Invalid catalog entry "${id}": description must be a non-empty string`
      );
    }
    if (!entry.platforms || Object.keys(entry.platforms).length === 0) {
      throw new Error(
        `Invalid catalog entry "${id}": must have at least one platform`
      );
    }
    // Validate each platform entry's manager and package (H-1 defense-in-depth)
    for (const [platform, candidate] of Object.entries(entry.platforms)) {
      if (!ALLOWED_MANAGERS.has(candidate.manager)) {
        throw new Error(
          `Invalid catalog entry "${id}": platform "${platform}" has unsupported manager "${candidate.manager}"`
        );
      }
      if (
        typeof candidate.package !== "string" ||
        !PACKAGE_NAME_RE.test(candidate.package)
      ) {
        throw new Error(
          `Invalid catalog entry "${id}": platform "${platform}" has invalid package name "${candidate.package}"`
        );
      }
    }
  }

  return catalog;
}

/**
 * Runtime catalog service. Wraps a validated catalog and provides
 * fast lookups by dependency_id, probe binary, or platform.
 */
export class SystemDependencyCatalog {
  private readonly byId: Map<string, DependencyCatalogEntry>;
  private readonly byProbe: Map<string, DependencyCatalogEntry>;

  constructor(catalog: DependencyCatalog) {
    this.byId = new Map();
    this.byProbe = new Map();

    for (const [id, entry] of Object.entries(catalog.dependencies)) {
      const full: DependencyCatalogEntry = {
        dependency_id: id,
        probe: entry.probe,
        description: entry.description,
        platforms: entry.platforms,
      };
      this.byId.set(id, full);
      this.byProbe.set(entry.probe, full);
    }
  }

  /** Look up a dependency by its normalized ID. */
  getById(dependencyId: string): DependencyCatalogEntry | undefined {
    return this.byId.get(dependencyId);
  }

  /** Look up a dependency by the binary it installs (probe command). */
  getByProbe(probe: string): DependencyCatalogEntry | undefined {
    return this.byProbe.get(probe);
  }

  /** Get the platform-specific install candidate for a dependency. */
  getPlatformCandidate(
    dependencyId: string,
    platform: string
  ): PlatformCandidate | undefined {
    const entry = this.byId.get(dependencyId);
    if (!entry) return undefined;
    return entry.platforms[platform as DependencyPlatform];
  }

  /** Get all known dependency IDs. */
  getAllIds(): string[] {
    return Array.from(this.byId.keys());
  }
}
