/**
 * LocalAiRuntimeModule — orchestrates runtime lifecycle use cases
 * (design §20). Coordinates catalog, compatibility, download, extraction,
 * health, state, resolver, and the operation coordinator. Holds in-memory
 * one-time consent grants (design §14.2). All install filesystem work goes
 * through the path service + state store; this module never constructs raw
 * runtime paths.
 */
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import semver from "semver";
import {
  LOCAL_AI_MODEL_RUNTIME_IDS,
  LOCAL_AI_RUNTIME_GROUPS,
} from "@/entityTypes/localAiRuntimeTypes";
import type {
  LocalAiRuntimeCatalogEntry,
  LocalAiRuntimeDownloadPhase,
  LocalAiRuntimeDownloadProgress,
  LocalAiRuntimeId,
  LocalAiRuntimeInstallOffer,
  LocalAiRuntimeInstallRequest,
  LocalAiRuntimeInstallResult,
  LocalAiRuntimeRemoveRequest,
  LocalAiRuntimeGroupId,
  LocalAiRuntimeInstallSetOffer,
  LocalAiRuntimeInstallSetRequest,
  LocalAiRuntimeInstallSetResult,
  LocalAiRuntimeStatus,
  LocalAiRuntimeTarget,
  LocalAiRuntimeUpdateOffer,
  ModelCatalogEntryV2,
  NativeRuntimeCatalogEntryV2,
  ResolvedLocalAiRuntime,
} from "@/entityTypes/localAiRuntimeTypes";
import { LocalAiRuntimeError } from "@/entityTypes/localAiRuntimeTypes";
import type { LocalAiRuntimePathService } from "@/service/localAiRuntime/LocalAiRuntimePathService";
import { groundingModelManifestSchema } from "@/schemas/localAiRuntime";
import type { LocalAiRuntimeStateStore } from "@/service/localAiRuntime/LocalAiRuntimeStateStore";
import type { LocalAiRuntimeCatalogService } from "@/service/localAiRuntime/LocalAiRuntimeCatalogService";
import type { LocalAiRuntimeCompatibilityService } from "@/service/localAiRuntime/LocalAiRuntimeCompatibilityService";
import type { LocalAiRuntimeDownloadService } from "@/service/localAiRuntime/LocalAiRuntimeDownloadService";
import type { LocalAiRuntimeResolver } from "@/service/localAiRuntime/LocalAiRuntimeResolver";
import type { LocalAiRuntimeOperationCoordinator } from "@/service/localAiRuntime/LocalAiRuntimeOperationCoordinator";
import type { LocalAiRuntimeHealthService } from "@/service/localAiRuntime/LocalAiRuntimeHealthService";
import {
  extractRuntimeArchive,
  validateExtractedPackage,
} from "@/service/localAiRuntime/LocalAiRuntimeExtractor";
import { renameWithRetry } from "@/service/localAiRuntime/renameWithRetry";
import { RUNTIME_CONSENT_TTL_MS } from "@/service/localAiRuntime/localAiRuntimeConstants";

interface SetConsentGrant {
  operationId: string;
  entries: readonly {
    runtimeId: LocalAiRuntimeId;
    runtimeVersion: string;
    identityHash: string;
  }[];
  consentToken: string;
  expiresAt: number;
}

interface ConsentGrant {
  operationId: string;
  runtimeId: LocalAiRuntimeId;
  runtimeVersion: string;
  entrySha256: string;
  consentToken: string;
  expiresAt: number;
}

export interface LocalAiRuntimeModuleDeps {
  paths: LocalAiRuntimePathService;
  state: LocalAiRuntimeStateStore;
  catalog: LocalAiRuntimeCatalogService;
  compatibility: LocalAiRuntimeCompatibilityService;
  download: LocalAiRuntimeDownloadService;
  resolver: LocalAiRuntimeResolver;
  coordinator: LocalAiRuntimeOperationCoordinator;
  health: LocalAiRuntimeHealthService;
  target: LocalAiRuntimeTarget;
  publishProgress: (progress: LocalAiRuntimeDownloadProgress) => void;
  /** Dispose an idle worker so a new active version can take over. */
  disposeIdleWorker?: (runtimeId: LocalAiRuntimeId) => Promise<void>;
  /** Resolve model directories to optionally remove with a runtime. */
  getModelDirs?: (runtimeId: LocalAiRuntimeId) => string[];
  /** Health-check timeout for install/repair smoke tests. */
  healthCheckTimeoutMs?: number;
  /** v2 catalog accessor (computer-use §7.3); required for install sets. */
  getCatalogV2?: () => Promise<import("@/entityTypes/localAiRuntimeTypes").LocalAiRuntimeCatalogV2>;
  /** Resumable model file-set downloader (§7.5); required for model installs. */
  fileSetDownload?: LocalAiRuntimeFileSetDownloadServiceLike;
  /** Total system memory probe (§7.8); defaults to os.totalmem. */
  totalMemoryBytes?: () => number;
}

/** Structural seam over LocalAiRuntimeFileSetDownloadService. */
export interface LocalAiRuntimeFileSetDownloadServiceLike {
  download(request: {
    operationId: string;
    entry: ModelCatalogEntryV2;
    stagingRoot: string;
    signal: AbortSignal;
    onProgress: (progress: LocalAiRuntimeDownloadProgress) => void;
  }): Promise<{ totalBytes: number; files: readonly { path: string; sha256: string; sizeBytes: number }[] }>;
}

export class LocalAiRuntimeModule {
  private readonly grants = new Map<string, ConsentGrant>();
  private readonly setGrants = new Map<string, SetConsentGrant>();

  constructor(private readonly deps: LocalAiRuntimeModuleDeps) {}

  // ---- status ----

  async listStatuses(group?: LocalAiRuntimeGroupId): Promise<LocalAiRuntimeStatus[]> {
    const ids: LocalAiRuntimeId[] = group
      ? ([...LOCAL_AI_RUNTIME_GROUPS[group]] as LocalAiRuntimeId[])
      : (["embedding-xenova", "voice-sherpa"] as LocalAiRuntimeId[]);
    return Promise.all(ids.map((id) => this.getStatus(id)));
  }

  async getStatus(runtimeId: LocalAiRuntimeId): Promise<LocalAiRuntimeStatus> {
    const diagnosis = await this.deps.resolver.diagnose(runtimeId);
    const base: LocalAiRuntimeStatus = {
      runtimeId,
      state: diagnosis.state,
      installedVersion: diagnosis.installedVersion,
      platform: this.deps.target.platform,
      arch: this.deps.target.arch,
    };
    if (diagnosis.state === "ready" && diagnosis.manifest) {
      base.lastVerifiedAt = new Date().toISOString();
    }
    // For not-installed runtimes, report an available version if the catalog
    // has one (best-effort; catalog failure is non-fatal for status).
    if (diagnosis.state === "not_installed") {
      try {
        const catalog = await this.deps.catalog.getCatalog();
        const entry = this.deps.compatibility.findCompatibleEntry(
          catalog,
          runtimeId,
          this.deps.target
        );
        if (entry) {
          base.state = "download_required";
          base.availableVersion = entry.runtimeVersion;
          base.archiveSizeBytes = entry.archiveSizeBytes;
        }
      } catch {
        // catalog unavailable: stay not_installed; remote features still work
      }
    }
    if (diagnosis.state === "ready") {
      // Check for a newer compatible version (non-blocking best-effort).
      try {
        const catalog = await this.deps.catalog.getCatalog();
        const entry = this.deps.compatibility.findCompatibleEntry(
          catalog,
          runtimeId,
          this.deps.target
        );
        if (
          entry &&
          semver.gt(entry.runtimeVersion, diagnosis.installedVersion ?? "0.0.0")
        ) {
          base.state = "update_available";
          base.availableVersion = entry.runtimeVersion;
          base.archiveSizeBytes = entry.archiveSizeBytes;
        }
      } catch {
        // ignore
      }
    }
    return base;
  }

  // ---- prepare / consent ----

  async prepareInstall(
    runtimeId: LocalAiRuntimeId
  ): Promise<LocalAiRuntimeInstallOffer> {
    const catalog = await this.deps.catalog.getCatalog();
    const entry = this.deps.compatibility.selectEntry(
      catalog,
      runtimeId,
      this.deps.target
    );
    const operationId = randomUUID();
    const consentToken = randomUUID();
    const expiresAt = Date.now() + RUNTIME_CONSENT_TTL_MS;
    this.grants.set(operationId, {
      operationId,
      runtimeId,
      runtimeVersion: entry.runtimeVersion,
      entrySha256: entry.sha256,
      consentToken,
      expiresAt,
    });
    return {
      operationId,
      runtimeId,
      runtimeVersion: entry.runtimeVersion,
      archiveSizeBytes: entry.archiveSizeBytes,
      installedSizeBytes: entry.installedSizeBytes,
      consentToken,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  // ---- install ----

  async install(
    input: LocalAiRuntimeInstallRequest
  ): Promise<LocalAiRuntimeInstallResult> {
    const grant = this.validateGrant(input);
    const lease = this.deps.coordinator.acquire(
      grant.runtimeId,
      grant.operationId
    );
    try {
      const catalog = await this.deps.catalog.getCatalog();
      const entry = this.deps.compatibility.selectEntry(
        catalog,
        grant.runtimeId,
        this.deps.target
      );
      if (
        entry.runtimeVersion !== grant.runtimeVersion ||
        entry.sha256 !== grant.entrySha256
      ) {
        throw new LocalAiRuntimeError(
          "runtime_manifest_invalid",
          "Catalog changed between consent and install."
        );
      }
      await this.runPipeline(entry, grant.operationId, lease);
      this.grants.delete(grant.operationId);
      return {
        operationId: grant.operationId,
        runtimeId: grant.runtimeId,
        runtimeVersion: entry.runtimeVersion,
        activated: true,
      };
    } finally {
      this.deps.coordinator.release(grant.operationId);
    }
  }

  cancelInstall(operationId: string): boolean {
    return this.deps.coordinator.cancel(operationId);
  }

  // ---- repair ----

  async repair(
    runtimeId: LocalAiRuntimeId
  ): Promise<LocalAiRuntimeInstallResult> {
    const operationId = randomUUID();
    const lease = this.deps.coordinator.acquire(runtimeId, operationId);
    try {
      const catalog = await this.deps.catalog.getCatalog();
      const entry = this.deps.compatibility.selectEntry(
        catalog,
        runtimeId,
        this.deps.target
      );
      await this.runPipeline(entry, operationId, lease);
      return {
        operationId,
        runtimeId,
        runtimeVersion: entry.runtimeVersion,
        activated: true,
      };
    } finally {
      this.deps.coordinator.release(operationId);
    }
  }

  // ---- update check ----

  async checkForUpdate(
    runtimeId: LocalAiRuntimeId
  ): Promise<LocalAiRuntimeUpdateOffer | null> {
    const diagnosis = await this.deps.resolver.diagnose(runtimeId);
    if (!diagnosis.installedVersion) return null;
    const catalog = await this.deps.catalog.getCatalog();
    const entry = this.deps.compatibility.findCompatibleEntry(
      catalog,
      runtimeId,
      this.deps.target
    );
    if (
      !entry ||
      !semver.gt(entry.runtimeVersion, diagnosis.installedVersion)
    ) {
      return null;
    }
    return {
      runtimeId,
      installedVersion: diagnosis.installedVersion,
      availableVersion: entry.runtimeVersion,
      archiveSizeBytes: entry.archiveSizeBytes,
    };
  }

  // ---- remove ----

  async remove(input: LocalAiRuntimeRemoveRequest): Promise<void> {
    const { runtimeId, removeModels } = input;
    const operationId = randomUUID();
    // Acquire serializes this remove against concurrent install/health-check
    // ops on the same runtime; the returned lease isn't needed here because
    // release is keyed by operationId in the finally block below.
    const _lease = this.deps.coordinator.acquire(runtimeId, operationId);
    try {
      const diagnosis = await this.deps.resolver.diagnose(runtimeId);
      if (diagnosis.state === "not_installed") return;
      const version = diagnosis.installedVersion;
      if (
        version &&
        this.deps.coordinator.isVersionLeased(runtimeId, version)
      ) {
        throw new LocalAiRuntimeError(
          "runtime_busy",
          `Cannot remove ${runtimeId}: a worker is using version ${version}.`,
          true
        );
      }
      await this.deps.disposeIdleWorker?.(runtimeId);
      await this.deps.state.clearActive(runtimeId);
      if (version) {
        const { versionRoot } = this.deps.paths.getRuntimePaths(
          runtimeId,
          version
        );
        if (this.deps.paths.isBeneathRuntimeRoot(versionRoot)) {
          await fs.rm(versionRoot, { recursive: true, force: true });
        }
      }
      if (removeModels && this.deps.getModelDirs) {
        for (const dir of this.deps.getModelDirs(runtimeId)) {
          await fs
            .rm(dir, { recursive: true, force: true })
            .catch(() => undefined);
        }
      }
    } finally {
      this.deps.coordinator.release(operationId);
    }
  }

  // ---- internals ----

  private validateGrant(input: LocalAiRuntimeInstallRequest): ConsentGrant {
    const grant = this.grants.get(input.operationId);
    if (!grant) {
      throw new LocalAiRuntimeError(
        "runtime_download_denied",
        "Unknown or expired install offer."
      );
    }
    if (Date.now() > grant.expiresAt) {
      this.grants.delete(input.operationId);
      throw new LocalAiRuntimeError(
        "runtime_download_denied",
        "Install offer expired."
      );
    }
    if (
      grant.runtimeId !== input.runtimeId ||
      grant.runtimeVersion !== input.expectedRuntimeVersion ||
      grant.consentToken !== input.consentToken
    ) {
      throw new LocalAiRuntimeError(
        "runtime_download_denied",
        "Install request does not match offer."
      );
    }
    return grant;
  }

  private emit(
    operationId: string,
    entry: LocalAiRuntimeCatalogEntry,
    phase: LocalAiRuntimeDownloadPhase,
    extra?: Partial<LocalAiRuntimeDownloadProgress>
  ): void {
    this.deps.publishProgress({
      operationId,
      runtimeId: entry.runtimeId,
      runtimeVersion: entry.runtimeVersion,
      phase,
      ...extra,
    });
  }

  private async runPipeline(
    entry: LocalAiRuntimeCatalogEntry,
    operationId: string,
    lease: { controller: AbortController }
  ): Promise<void> {
    await this.deps.paths.ensureOperationDirectories();
    const { archivePath, stagingRoot } =
      this.deps.paths.createOperationPaths(operationId);
    const onProgress = (progress: LocalAiRuntimeDownloadProgress): void => {
      this.deps.publishProgress(progress);
    };

    try {
      this.emit(operationId, entry, "resolving");
      // Ensure sibling operation roots exist before download/extract (first install).
      await fs.mkdir(this.deps.paths.downloadsRoot, { recursive: true });
      await fs.mkdir(path.dirname(stagingRoot), { recursive: true });
      this.emit(operationId, entry, "downloading");
      await this.deps.download.download({
        operationId,
        entry,
        destinationPath: archivePath,
        signal: lease.controller.signal,
        onProgress,
      });

      this.emit(operationId, entry, "extracting");
      const extracted = await extractRuntimeArchive(
        archivePath,
        stagingRoot,
        lease.controller.signal
      );

      this.emit(operationId, entry, "verifying");
      const validation = await validateExtractedPackage(
        stagingRoot,
        entry,
        this.deps.target,
        extracted.totalBytes
      );
      if (!validation.ok) {
        throw new LocalAiRuntimeError(validation.code, validation.message);
      }

      this.emit(operationId, entry, "testing");
      const stagedRuntime: ResolvedLocalAiRuntime = {
        runtimeId: entry.runtimeId,
        runtimeVersion: entry.runtimeVersion,
        runtimeRoot: stagingRoot,
        manifest: validation.manifest,
        entryPath: validation.manifest.entryPoint
          ? path.join(stagingRoot, validation.manifest.entryPoint)
          : undefined,
        moduleRequirePath: validation.manifest.entryModule
          ? path.join(stagingRoot, "package.json")
          : undefined,
      };
      const health = await this.deps.health.check({
        runtime: stagedRuntime,
        mode: "runtime_only",
        timeoutMs: this.deps.healthCheckTimeoutMs ?? 30_000,
      });
      if (!health.ok) {
        throw new LocalAiRuntimeError(
          "runtime_health_check_failed",
          health.errorMessage ?? "Health check failed."
        );
      }

      this.emit(operationId, entry, "activating");
      await this.activate(entry, stagingRoot, validation);

      this.emit(operationId, entry, "done");
    } catch (error) {
      // Best-effort cleanup of staging on any failure; previous runtime stays active.
      await fs
        .rm(stagingRoot, { recursive: true, force: true })
        .catch(() => undefined);
      await fs.rm(archivePath, { force: true }).catch(() => undefined);
      throw error instanceof LocalAiRuntimeError
        ? error
        : new LocalAiRuntimeError(
            "runtime_unknown_error",
            (error as Error).message
          );
    } finally {
      await fs.rm(archivePath, { force: true }).catch(() => undefined);
    }
  }

  private async activate(
    entry: LocalAiRuntimeCatalogEntry,
    stagingRoot: string,
    validation: { manifest: ResolvedLocalAiRuntime["manifest"] }
  ): Promise<void> {
    const { versionRoot, runtimeDir } = this.deps.paths.getRuntimePaths(
      entry.runtimeId,
      entry.runtimeVersion
    );
    await fs.mkdir(runtimeDir, { recursive: true });

    // If the target version exists, ensure it isn't leased, then replace it.
    if (
      this.deps.coordinator.isVersionLeased(
        entry.runtimeId,
        entry.runtimeVersion
      )
    ) {
      throw new LocalAiRuntimeError(
        "runtime_busy",
        "Target version is in use by a worker.",
        true
      );
    }
    await fs.rm(versionRoot, { recursive: true, force: true });
    // Atomic on the same filesystem (both beneath runtimeRoot). The voice
    // runtime's native addon is loaded in a disposable probe WORKER (never this
    // main process), so no in-process file lock blocks the rename; the bounded
    // retry handles transient AV/indexer locks on freshly extracted files.
    await renameWithRetry(stagingRoot, versionRoot);

    // Persist the manifest inside the version dir (extraction already wrote it,
    // but ensure the state store index matches) and flip the active pointer.
    await this.deps.state.writePackageManifest(
      entry.runtimeId,
      entry.runtimeVersion,
      validation.manifest
    );

    const previous = await this.deps.state.readActive(entry.runtimeId);
    await this.deps.state.writeActive({
      schemaVersion: 1,
      runtimeId: entry.runtimeId,
      runtimeVersion: entry.runtimeVersion,
      activatedAt: new Date().toISOString(),
      packageSha256: entry.sha256,
      previousVersion: previous?.runtimeVersion,
    });

    // Dispose an idle worker so the next start resolves the new version.
    await this.deps.disposeIdleWorker?.(entry.runtimeId).catch(() => undefined);
  }

  /** Test/diagnostics helper: access the resolved runtime without activating. */
  async resolveForUse(
    runtimeId: LocalAiRuntimeId
  ): Promise<ResolvedLocalAiRuntime | null> {
    return this.deps.resolver.resolve(runtimeId);
  }

  /** Coordinator accessor for worker clients to register version leases. */
  getOperationCoordinator(): LocalAiRuntimeOperationCoordinator {
    return this.deps.coordinator;
  }

  // ---- install sets (computer-use design §7.8, CU-INST-13) ----

  /**
   * One consent covering the grounding runtime and a model: selects entries
   * (runtime first, then model), checks target + memory + requiresRuntime,
   * and returns a single offer with combined sizes.
   */
  async prepareInstallSet(
    runtimeIds: readonly LocalAiRuntimeId[]
  ): Promise<LocalAiRuntimeInstallSetOffer> {
    if (!this.deps.getCatalogV2) {
      throw new LocalAiRuntimeError(
        "runtime_catalog_unavailable",
        "The v2 runtime catalog is not configured in this build."
      );
    }
    const catalog = await this.deps.getCatalogV2();
    const modelIds = runtimeIds.filter((id) =>
      (LOCAL_AI_MODEL_RUNTIME_IDS as readonly string[]).includes(id)
    );
    const nativeIds = runtimeIds.filter((id) => !modelIds.includes(id));

    const entries: Array<NativeRuntimeCatalogEntryV2 | ModelCatalogEntryV2> = [];
    for (const id of nativeIds) {
      entries.push(this.selectNativeV2(catalog, id));
    }
    for (const id of modelIds) {
      const model = this.selectModelV2(catalog, id);
      // requiresRuntime: an active grounding runtime of >= minVersion must
      // be installable in the same set or already active.
      const runtimeId = model.requiresRuntime.runtimeId;
      const runtimeInSet = nativeIds.includes(runtimeId)
        ? this.selectNativeV2(catalog, runtimeId)
        : null;
      const active = await this.deps.state.readActive(runtimeId).catch(() => null);
      const runtimeVersion = runtimeInSet
        ? runtimeInSet.runtimeVersion
        : active?.runtimeVersion ?? null;
      if (
        !runtimeVersion ||
        semver.lt(runtimeVersion, model.requiresRuntime.minVersion)
      ) {
        throw new LocalAiRuntimeError(
          "runtime_dependency_missing",
          `${id} requires ${runtimeId} >= ${model.requiresRuntime.minVersion}; include the runtime in the same install set.`
        );
      }
      // Memory floor (CU-INST-18).
      const totalMemory = (this.deps.totalMemoryBytes ?? os.totalmem)();
      if (totalMemory < model.minSystemMemoryBytes) {
        throw new LocalAiRuntimeError(
          "runtime_insufficient_memory",
          `${id} requires at least ${model.minSystemMemoryBytes} bytes of system memory.`
        );
      }
      entries.push(model);
    }

    const operationId = randomUUID();
    const consentToken = randomUUID();
    const expiresAt = Date.now() + RUNTIME_CONSENT_TTL_MS;
    this.setGrants.set(operationId, {
      operationId,
      entries: entries.map((entry) => ({
        runtimeId: entry.runtimeId,
        runtimeVersion: entry.runtimeVersion,
        identityHash:
          entry.packageKind === "model" ? entry.manifestSha256 : entry.sha256,
      })),
      consentToken,
      expiresAt,
    });
    const offers = entries.map((entry) => ({
      runtimeId: entry.runtimeId,
      runtimeVersion: entry.runtimeVersion,
      downloadSizeBytes:
        entry.packageKind === "model"
          ? entry.downloadSizeBytes
          : entry.archiveSizeBytes,
      installedSizeBytes: entry.installedSizeBytes,
      identityHash:
        entry.packageKind === "model" ? entry.manifestSha256 : entry.sha256,
    }));
    return {
      operationId,
      entries: offers,
      totalDownloadBytes: offers.reduce((s, o) => s + o.downloadSizeBytes, 0),
      totalInstalledBytes: offers.reduce((s, o) => s + o.installedSizeBytes, 0),
      consentToken,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  /**
   * Install a consented set: runtime first, then model, each pipeline under
   * its own coordinator operation. If the runtime fails the model is not
   * attempted; if the model fails the runtime stays installed for reuse.
   */
  async installSet(
    input: LocalAiRuntimeInstallSetRequest
  ): Promise<LocalAiRuntimeInstallSetResult> {
    const grant = this.validateSetGrant(input);
    const installed: Array<{
      runtimeId: LocalAiRuntimeId;
      runtimeVersion: string;
      activated: boolean;
    }> = [];
    for (const entryGrant of grant.entries) {
      const lease = this.deps.coordinator.acquire(
        entryGrant.runtimeId,
        grant.operationId
      );
      try {
        if ((LOCAL_AI_MODEL_RUNTIME_IDS as readonly string[]).includes(entryGrant.runtimeId)) {
          await this.runModelPipeline(
            entryGrant.runtimeId,
            entryGrant.runtimeVersion,
            grant.operationId,
            lease
          );
        } else {
          const catalog = await this.deps.catalog.getCatalog();
          const entry = this.deps.compatibility.selectEntry(
            catalog,
            entryGrant.runtimeId,
            this.deps.target
          );
          if (entry.runtimeVersion !== entryGrant.runtimeVersion) {
            throw new LocalAiRuntimeError(
              "runtime_manifest_invalid",
              "Catalog changed between consent and install."
            );
          }
          await this.runPipeline(entry, grant.operationId, lease);
        }
        installed.push({
          runtimeId: entryGrant.runtimeId,
          runtimeVersion: entryGrant.runtimeVersion,
          activated: true,
        });
      } catch (error) {
        this.setGrants.delete(grant.operationId);
        return {
          operationId: grant.operationId,
          installed,
          failedRuntimeId: entryGrant.runtimeId,
          errorCode:
            error instanceof LocalAiRuntimeError
              ? error.code
              : "runtime_unknown_error",
        };
      } finally {
        this.deps.coordinator.release(grant.operationId);
      }
    }
    this.setGrants.delete(grant.operationId);
    return { operationId: grant.operationId, installed };
  }

  /** Delete every model version that is neither active, leased, nor pending. */
  async pruneInactiveVersions(runtimeId: LocalAiRuntimeId): Promise<number> {
    const active = await this.deps.state.readActive(runtimeId).catch(() => null);
    const versions = await this.deps.state.listInstalledVersions(runtimeId).catch(() => []);
    let pruned = 0;
    for (const version of versions) {
      if (active?.runtimeVersion === version) continue;
      if (this.deps.coordinator.isVersionLeased(runtimeId, version)) continue;
      const { versionRoot } = this.deps.paths.getRuntimePaths(runtimeId, version);
      if (this.deps.paths.isBeneathRuntimeRoot(versionRoot)) {
        await fs.rm(versionRoot, { recursive: true, force: true }).catch(() => undefined);
        pruned += 1;
      }
    }
    return pruned;
  }

  private selectNativeV2(
    catalog: import("@/entityTypes/localAiRuntimeTypes").LocalAiRuntimeCatalogV2,
    runtimeId: LocalAiRuntimeId
  ): NativeRuntimeCatalogEntryV2 {
    const entry = catalog.runtimes.find(
      (e) => e.runtimeId === runtimeId && e.packageKind === "native_runtime"
    );
    if (!entry || entry.packageKind !== "native_runtime") {
      throw new LocalAiRuntimeError(
        "runtime_catalog_target_missing",
        `No compatible ${runtimeId} entry in the v2 catalog.`
      );
    }
    return entry;
  }

  private selectModelV2(
    catalog: import("@/entityTypes/localAiRuntimeTypes").LocalAiRuntimeCatalogV2,
    runtimeId: LocalAiRuntimeId
  ): ModelCatalogEntryV2 {
    const entry = catalog.runtimes.find(
      (e) => e.runtimeId === runtimeId && e.packageKind === "model"
    );
    if (!entry || entry.packageKind !== "model") {
      throw new LocalAiRuntimeError(
        "runtime_catalog_target_missing",
        `No ${runtimeId} model entry in the v2 catalog.`
      );
    }
    return entry;
  }

  private validateSetGrant(
    input: LocalAiRuntimeInstallSetRequest
  ): SetConsentGrant {
    const grant = this.setGrants.get(input.operationId);
    if (!grant) {
      throw new LocalAiRuntimeError(
        "runtime_download_denied",
        "Unknown or expired install-set offer."
      );
    }
    // Expiry limits when the install may START, not how long a multi-GB
    // download may take (§7.8).
    if (Date.now() > grant.expiresAt) {
      this.setGrants.delete(input.operationId);
      throw new LocalAiRuntimeError(
        "runtime_download_denied",
        "Install-set offer expired."
      );
    }
    if (grant.consentToken !== input.consentToken) {
      throw new LocalAiRuntimeError(
        "runtime_download_denied",
        "Install-set request does not match the offer."
      );
    }
    return grant;
  }

  /** Model pipeline (§7.5): manifest-first file-set download → validate → activate. */
  private async runModelPipeline(
    runtimeId: LocalAiRuntimeId,
    runtimeVersion: string,
    operationId: string,
    lease: { controller: AbortController }
  ): Promise<void> {
    if (!this.deps.getCatalogV2 || !this.deps.fileSetDownload) {
      throw new LocalAiRuntimeError(
        "runtime_catalog_unavailable",
        "Model installs are not configured in this build."
      );
    }
    const catalog = await this.deps.getCatalogV2();
    const entry = this.selectModelV2(catalog, runtimeId);
    if (entry.runtimeVersion !== runtimeVersion) {
      throw new LocalAiRuntimeError(
        "runtime_manifest_invalid",
        "Catalog changed between consent and install."
      );
    }
    await this.deps.paths.ensureOperationDirectories();
    const { stagingRoot } = this.deps.paths.createOperationPaths(operationId);
    try {
      const result = await this.deps.fileSetDownload.download({
        operationId,
        entry,
        stagingRoot,
        signal: lease.controller.signal,
        onProgress: (progress) => this.deps.publishProgress(progress),
      });
      if (result.files.length !== entry.files.length) {
        throw new LocalAiRuntimeError(
          "runtime_manifest_invalid",
          "Downloaded file set does not match the catalog entry."
        );
      }
      // Validate the producer manifest from staging.
      const manifestPath = path.join(stagingRoot, "manifest.json");
      const manifestRaw = JSON.parse(
        await fs.readFile(manifestPath, "utf8")
      ) as unknown;
      const manifest = groundingModelManifestSchema.parse(manifestRaw);
      if (
        manifest.runtimeId !== entry.runtimeId ||
        manifest.runtimeVersion !== entry.runtimeVersion ||
        manifest.groundingAdapterId !== entry.groundingAdapterId ||
        manifest.preprocessingRevision !== entry.preprocessingRevision ||
        manifest.decodingRevision !== entry.decodingRevision ||
        manifest.calibrationRevision !== entry.calibrationRevision
      ) {
        throw new LocalAiRuntimeError(
          "runtime_model_manifest_invalid",
          "Model manifest does not match the catalog entry identity."
        );
      }
      // Activate: atomic rename into the version root + active.json flip.
      const { versionRoot, runtimeDir } = this.deps.paths.getRuntimePaths(
        entry.runtimeId,
        entry.runtimeVersion
      );
      await fs.mkdir(runtimeDir, { recursive: true });
      if (this.deps.coordinator.isVersionLeased(entry.runtimeId, entry.runtimeVersion)) {
        throw new LocalAiRuntimeError(
          "runtime_busy",
          "Target model version is in use by a worker.",
          true
        );
      }
      await fs.rm(versionRoot, { recursive: true, force: true });
      await renameWithRetry(stagingRoot, versionRoot);
      await this.deps.state.writePackageManifest(
        entry.runtimeId,
        entry.runtimeVersion,
        manifest as unknown as ResolvedLocalAiRuntime["manifest"]
      );
      const previous = await this.deps.state.readActive(entry.runtimeId);
      await this.deps.state.writeActive({
        schemaVersion: 1,
        runtimeId: entry.runtimeId,
        runtimeVersion: entry.runtimeVersion,
        activatedAt: new Date().toISOString(),
        packageSha256: entry.manifestSha256,
        previousVersion: previous?.runtimeVersion,
      });
      // Superseded model versions are pruned after a successful update
      // (§7.8): rollback means downloading again.
      await this.pruneInactiveVersions(entry.runtimeId).catch(() => undefined);
    } catch (error) {
      await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
      throw error instanceof LocalAiRuntimeError
        ? error
        : new LocalAiRuntimeError("runtime_unknown_error", (error as Error).message);
    }
  }

}
