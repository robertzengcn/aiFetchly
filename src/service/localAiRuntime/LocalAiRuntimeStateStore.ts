/**
 * Local AI Runtime — on-disk state store.
 *
 * Owns reads/writes of catalog cache metadata, package manifests, and the
 * atomic active pointer (design §10). Performs NO network operations and NO
 * runtime loading. Readers parse as `unknown`, validate with Zod, and return
 * null for missing/corrupted state so callers can reconcile.
 */
import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import semver from "semver";
import writeFileAtomic from "write-file-atomic";
import {
  localAiRuntimeActiveStateSchema,
  localAiRuntimePackageManifestSchema,
} from "@/schemas/localAiRuntime";
import { localAiRuntimeCatalogSchema } from "@/schemas/localAiRuntime";
import type {
  LocalAiRuntimeActiveState,
  LocalAiRuntimeId,
  LocalAiRuntimePackageManifest,
  LocalAiRuntimeCatalog,
} from "@/entityTypes/localAiRuntimeTypes";
import type { LocalAiRuntimePathService } from "./LocalAiRuntimePathService";

async function readJsonOrNull(filePath: string): Promise<unknown | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as unknown;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    // Corrupt JSON — treat as missing so callers reconcile.
    return null;
  }
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export interface CatalogCacheMeta {
  fetchedAt: string;
  etag?: string;
  lastModified?: string;
}

export class LocalAiRuntimeStateStore {
  constructor(private readonly paths: LocalAiRuntimePathService) {}

  // ---- active.json ----

  async readActive(
    runtimeId: LocalAiRuntimeId
  ): Promise<LocalAiRuntimeActiveState | null> {
    const activePath = this.paths.getActiveStatePath(runtimeId);
    const parsed = await readJsonOrNull(activePath);
    if (parsed === null) return null;
    const result = localAiRuntimeActiveStateSchema.safeParse(parsed);
    if (!result.success) return null;
    return result.data;
  }

  async writeActive(state: LocalAiRuntimeActiveState): Promise<void> {
    const runtimeDir = this.paths.getRuntimeDir(state.runtimeId);
    await ensureDir(runtimeDir);
    await writeFileAtomic(
      this.paths.getActiveStatePath(state.runtimeId),
      JSON.stringify(state, null, 2),
      { mode: 0o600 }
    );
  }

  async clearActive(runtimeId: LocalAiRuntimeId): Promise<void> {
    await fs.rm(this.paths.getActiveStatePath(runtimeId), { force: true });
  }

  // ---- package manifest ----

  async readPackageManifest(
    runtimeId: LocalAiRuntimeId,
    version: string
  ): Promise<LocalAiRuntimePackageManifest | null> {
    const { packageManifestPath } = this.paths.getRuntimePaths(
      runtimeId,
      version
    );
    const parsed = await readJsonOrNull(packageManifestPath);
    if (parsed === null) return null;
    const result = localAiRuntimePackageManifestSchema.safeParse(parsed);
    if (!result.success) return null;
    return result.data;
  }

  async writePackageManifest(
    runtimeId: LocalAiRuntimeId,
    version: string,
    manifest: LocalAiRuntimePackageManifest
  ): Promise<void> {
    const { versionRoot, packageManifestPath } = this.paths.getRuntimePaths(
      runtimeId,
      version
    );
    await ensureDir(versionRoot);
    await writeFileAtomic(
      packageManifestPath,
      JSON.stringify(manifest, null, 2),
      {
        mode: 0o600,
      }
    );
  }

  async listInstalledVersions(runtimeId: LocalAiRuntimeId): Promise<string[]> {
    const runtimeDir = this.paths.getRuntimeDir(runtimeId);
    let entries: Dirent[];
    try {
      entries = await fs.readdir(runtimeDir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const versions: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (semver.valid(entry.name) === null) continue;
      // A version is "installed" only if its manifest is present and valid.
      const manifest = await this.readPackageManifest(runtimeId, entry.name);
      if (manifest) versions.push(entry.name);
    }
    return versions.sort((a, b) => semver.rcompare(a, b));
  }

  // ---- catalog cache ----

  async readCatalogCache(): Promise<LocalAiRuntimeCatalog | null> {
    const parsed = await readJsonOrNull(this.paths.catalogCachePath);
    if (parsed === null) return null;
    const result = localAiRuntimeCatalogSchema.safeParse(parsed);
    if (!result.success) return null;
    return result.data;
  }

  async writeCatalogCache(catalog: LocalAiRuntimeCatalog): Promise<void> {
    await ensureDir(this.paths.runtimeRoot);
    await writeFileAtomic(
      this.paths.catalogCachePath,
      JSON.stringify(catalog, null, 2),
      { mode: 0o600 }
    );
  }

  async readCatalogCacheMeta(): Promise<CatalogCacheMeta | null> {
    const parsed = await readJsonOrNull(this.paths.catalogCacheMetaPath);
    if (parsed === null) return null;
    const result = catalogCacheMetaSafeParse(parsed);
    return result ? result : null;
  }

  async writeCatalogCacheMeta(meta: CatalogCacheMeta): Promise<void> {
    await ensureDir(this.paths.runtimeRoot);
    await writeFileAtomic(
      this.paths.catalogCacheMetaPath,
      JSON.stringify(meta, null, 2),
      { mode: 0o600 }
    );
  }
}

function catalogCacheMetaSafeParse(value: unknown): CatalogCacheMeta | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.fetchedAt !== "string") return null;
  const meta: CatalogCacheMeta = { fetchedAt: obj.fetchedAt };
  if (typeof obj.etag === "string") meta.etag = obj.etag;
  if (typeof obj.lastModified === "string")
    meta.lastModified = obj.lastModified;
  return meta;
}
