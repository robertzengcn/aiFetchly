/**
 * Local AI Runtime — path service.
 *
 * The ONLY component allowed to construct runtime installation paths
 * (design §9). Every path is built from fixed, validated segments and checked
 * against the runtime root so archive contents or bad version strings can never
 * escape the application-owned directory.
 */
import path from "node:path";
import semver from "semver";
import {
  LOCAL_AI_RUNTIME_IDS,
  LocalAiRuntimeError,
  type LocalAiRuntimeId,
} from "@/entityTypes/localAiRuntimeTypes";

export const LOCAL_AI_RUNTIME_DIR_NAME = "local-ai-runtimes";
const DOWNLOADS_DIR = ".downloads";
const STAGING_DIR = ".staging";
const CATALOG_CACHE_FILE = "catalog-cache.json";
const CATALOG_CACHE_META_FILE = "catalog-cache.meta.json";
const ACTIVE_STATE_FILE = "active.json";
const PACKAGE_MANIFEST_FILE = "manifest.json";

/** Operation IDs are locally-generated UUIDs; never renderer-supplied. */
const OPERATION_ID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface LocalAiRuntimePaths {
  /** <userData>/local-ai-runtimes */
  runtimeRoot: string;
  /** <runtimeRoot>/<runtimeId> */
  runtimeDir: string;
  /** <runtimeDir>/<version> */
  versionRoot: string;
  /** <runtimeDir>/active.json */
  activeStatePath: string;
  /** <versionRoot>/manifest.json */
  packageManifestPath: string;
}

/**
 * Resolve `segments` beneath `root`, throwing if the result escapes `root`.
 * The canonical containment guard (design §6.4).
 */
export function resolveContainedPath(
  root: string,
  ...segments: readonly string[]
): string {
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, ...segments);
  const prefix = `${resolvedRoot}${path.sep}`;
  if (candidate !== resolvedRoot && !candidate.startsWith(prefix)) {
    throw new LocalAiRuntimeError(
      "runtime_path_outside_root",
      "Runtime path is outside the configured root."
    );
  }
  return candidate;
}

function assertRuntimeId(
  runtimeId: string
): asserts runtimeId is LocalAiRuntimeId {
  if (!(LOCAL_AI_RUNTIME_IDS as readonly string[]).includes(runtimeId)) {
    throw new LocalAiRuntimeError(
      "runtime_unknown_error",
      `Unknown runtime id: ${runtimeId}`
    );
  }
}

function assertRuntimeVersion(version: string): void {
  if (typeof version !== "string" || semver.valid(version) === null) {
    throw new LocalAiRuntimeError(
      "runtime_manifest_invalid",
      `Invalid runtime version: ${String(version)}`
    );
  }
}

function assertOperationId(operationId: string): void {
  if (!OPERATION_ID_PATTERN.test(operationId)) {
    throw new LocalAiRuntimeError(
      "runtime_unknown_error",
      "Invalid operation id."
    );
  }
}

export class LocalAiRuntimePathService {
  constructor(private readonly userDataRoot: string) {}

  /** <userData>/local-ai-runtimes — the runtime root. */
  get runtimeRoot(): string {
    return path.join(this.userDataRoot, LOCAL_AI_RUNTIME_DIR_NAME);
  }

  get catalogCachePath(): string {
    return path.join(this.runtimeRoot, CATALOG_CACHE_FILE);
  }

  get catalogCacheMetaPath(): string {
    return path.join(this.runtimeRoot, CATALOG_CACHE_META_FILE);
  }

  get downloadsRoot(): string {
    return path.join(this.runtimeRoot, DOWNLOADS_DIR);
  }

  get stagingRoot(): string {
    return path.join(this.runtimeRoot, STAGING_DIR);
  }

  /** Directory holding all versions of one runtime id. */
  getRuntimeDir(runtimeId: LocalAiRuntimeId): string {
    assertRuntimeId(runtimeId);
    return resolveContainedPath(this.runtimeRoot, runtimeId);
  }

  /** <runtimeDir>/active.json — version-independent per-runtime pointer. */
  getActiveStatePath(runtimeId: LocalAiRuntimeId): string {
    assertRuntimeId(runtimeId);
    return resolveContainedPath(
      this.getRuntimeDir(runtimeId),
      ACTIVE_STATE_FILE
    );
  }

  getRuntimePaths(
    runtimeId: LocalAiRuntimeId,
    runtimeVersion: string
  ): LocalAiRuntimePaths {
    assertRuntimeId(runtimeId);
    assertRuntimeVersion(runtimeVersion);
    const runtimeDir = resolveContainedPath(this.runtimeRoot, runtimeId);
    const versionRoot = resolveContainedPath(runtimeDir, runtimeVersion);
    return {
      runtimeRoot: this.runtimeRoot,
      runtimeDir,
      versionRoot,
      activeStatePath: resolveContainedPath(runtimeDir, ACTIVE_STATE_FILE),
      packageManifestPath: resolveContainedPath(
        versionRoot,
        PACKAGE_MANIFEST_FILE
      ),
    };
  }

  /**
   * Download archive + extraction staging paths for one operation. Both live
   * in sibling hidden directories, never inside an active version directory.
   */
  createOperationPaths(operationId: string): {
    archivePath: string;
    stagingRoot: string;
  } {
    assertOperationId(operationId);
    return {
      archivePath: resolveContainedPath(
        this.downloadsRoot,
        `${operationId}.zip.part`
      ),
      stagingRoot: resolveContainedPath(this.stagingRoot, operationId),
    };
  }

  /** True when `target` is equal to or beneath the runtime root. */
  isBeneathRuntimeRoot(target: string): boolean {
    const resolvedRoot = path.resolve(this.runtimeRoot);
    const resolvedTarget = path.resolve(target);
    const prefix = `${resolvedRoot}${path.sep}`;
    return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(prefix);
  }
}
