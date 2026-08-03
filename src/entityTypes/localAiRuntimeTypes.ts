/**
 * Local AI Runtime — strict type contracts.
 *
 * First-party, compile-time-fixed runtime identities. No runtime ID received
 * from the network may select an arbitrary package name or entry point; every
 * catalog/manifest value is matched against the constants declared here.
 *
 * See docs/prd/downloadable-local-ai-runtimes-technical-design.md §4.1, §7.
 */

/** Compiled allowlist of supported first-party runtime IDs. */
export const LOCAL_AI_RUNTIME_IDS = [
  "embedding-xenova",
  "voice-sherpa",
] as const;

export type LocalAiRuntimeId = (typeof LOCAL_AI_RUNTIME_IDS)[number];

/**
 * Artifact filename prefix per runtime ID. Preserves the PRD filename contract
 * (`embedding-runtime-*`, `voice-runtime-*`) without weakening the more
 * specific internal runtime IDs.
 */
export const LOCAL_AI_RUNTIME_ARTIFACT_PREFIX: Record<
  LocalAiRuntimeId,
  "embedding" | "voice"
> = {
  "embedding-xenova": "embedding",
  "voice-sherpa": "voice",
};

/** Platforms supported by v1 runtime packages. */
export type LocalAiRuntimePlatform = "win32" | "darwin";

/** Architectures supported by v1 runtime packages. */
export type LocalAiRuntimeArch = "x64" | "arm64";

/** The running process target used for compatibility selection. */
export interface LocalAiRuntimeTarget {
  platform: NodeJS.Platform;
  arch: string;
  electronVersion: string;
  nodeModuleAbi: string;
  appVersion: string;
}

/** Catalog entry download URL host policy. */
export interface RuntimeCatalogSourceConfig {
  catalogUrl: string;
  allowedHosts: readonly string[];
  cacheTtlMs: number;
}

/** Published catalog describing every downloadable runtime artifact. */
export interface LocalAiRuntimeCatalog {
  schemaVersion: 1;
  catalogVersion: string;
  releaseTag: string;
  publishedAt: string;
  runtimes: LocalAiRuntimeCatalogEntry[];
}

/** One platform/architecture-specific runtime artifact in the catalog. */
export interface LocalAiRuntimeCatalogEntry {
  runtimeId: LocalAiRuntimeId;
  runtimeVersion: string;
  platform: LocalAiRuntimePlatform;
  arch: LocalAiRuntimeArch;
  downloadUrl: string;
  archiveFileName: string;
  archiveSizeBytes: number;
  installedSizeBytes: number;
  sha256: string;
  electronVersion: string;
  nodeModuleAbi: string;
  minAppVersion: string;
  maxAppVersion?: string;
  entryPoint?: string;
  entryModule?: string;
  requiredFiles: string[];
  dependencies: Record<string, string>;
}

/** manifest.json stored at the root of every runtime archive. */
export interface LocalAiRuntimePackageManifest {
  schemaVersion: 1;
  runtimeId: LocalAiRuntimeId;
  runtimeVersion: string;
  platform: LocalAiRuntimePlatform;
  arch: LocalAiRuntimeArch;
  electronVersion: string;
  nodeModuleAbi: string;
  entryPoint?: string;
  entryModule?: string;
  requiredFiles: string[];
  dependencies: Record<string, string>;
  build: {
    commit: string;
    workflowRunId: string;
    builtAt: string;
  };
}

/** active.json — atomic pointer to the validated active runtime version. */
export interface LocalAiRuntimeActiveState {
  schemaVersion: 1;
  runtimeId: LocalAiRuntimeId;
  runtimeVersion: string;
  activatedAt: string;
  packageSha256: string;
  previousVersion?: string;
}

/** Renderer-facing runtime lifecycle state. */
export type LocalAiRuntimeState =
  | "not_installed"
  | "checking"
  | "download_required"
  | "downloading"
  | "verifying"
  | "installing"
  | "ready"
  | "update_available"
  | "incompatible"
  | "corrupted"
  | "error";

/** Renderer-facing status snapshot. No internal filesystem path is exposed. */
export interface LocalAiRuntimeStatus {
  runtimeId: LocalAiRuntimeId;
  state: LocalAiRuntimeState;
  installedVersion?: string;
  availableVersion?: string;
  platform: NodeJS.Platform;
  arch: string;
  installedSizeBytes?: number;
  archiveSizeBytes?: number;
  lastVerifiedAt?: string;
  errorCode?: LocalAiRuntimeErrorCode;
  errorMessage?: string;
}

/** Download/install progress phase reported to the renderer. */
export type LocalAiRuntimeDownloadPhase =
  | "resolving"
  | "downloading"
  | "verifying"
  | "extracting"
  | "testing"
  | "activating"
  | "done"
  | "cancelled"
  | "error";

export interface LocalAiRuntimeDownloadProgress {
  operationId: string;
  runtimeId: LocalAiRuntimeId;
  runtimeVersion: string;
  phase: LocalAiRuntimeDownloadPhase;
  downloadedBytes?: number;
  totalBytes?: number;
  percent?: number;
  errorCode?: LocalAiRuntimeErrorCode;
  errorMessage?: string;
}

/** Stable, localized error codes used across status, progress, and diagnostics. */
export type LocalAiRuntimeErrorCode =
  | "runtime_not_supported"
  | "runtime_catalog_unavailable"
  | "runtime_catalog_invalid"
  | "runtime_catalog_target_missing"
  | "runtime_download_denied"
  | "runtime_download_failed"
  | "runtime_download_cancelled"
  | "runtime_download_too_large"
  | "runtime_checksum_mismatch"
  | "runtime_archive_invalid"
  | "runtime_archive_unsafe"
  | "runtime_manifest_invalid"
  | "runtime_incompatible"
  | "runtime_required_file_missing"
  | "runtime_health_check_failed"
  | "runtime_activation_failed"
  | "runtime_busy"
  | "runtime_remove_failed"
  | "runtime_path_outside_root"
  | "runtime_disk_space_insufficient"
  | "runtime_unknown_error";

/** Typed error thrown by runtime services. Carries a stable code + recoverability. */
export class LocalAiRuntimeError extends Error {
  readonly code: LocalAiRuntimeErrorCode;
  readonly recoverable: boolean;

  constructor(
    code: LocalAiRuntimeErrorCode,
    message: string,
    recoverable = false,
  ) {
    super(message);
    this.name = "LocalAiRuntimeError";
    this.code = code;
    this.recoverable = recoverable;
  }
}

/** Offer returned by prepareInstall; sizes are shown to the user for consent. */
export interface LocalAiRuntimeInstallOffer {
  operationId: string;
  runtimeId: LocalAiRuntimeId;
  runtimeVersion: string;
  archiveSizeBytes: number;
  installedSizeBytes: number;
  consentToken: string;
  expiresAt: string;
}

/** Installer request validated against the expiring consent token. */
export interface LocalAiRuntimeInstallRequest {
  operationId: string;
  runtimeId: LocalAiRuntimeId;
  expectedRuntimeVersion: string;
  consentToken: string;
}

export interface LocalAiRuntimeInstallResult {
  operationId: string;
  runtimeId: LocalAiRuntimeId;
  runtimeVersion: string;
  activated: boolean;
}

/** Update availability offer (no download until user consent). */
export interface LocalAiRuntimeUpdateOffer {
  runtimeId: LocalAiRuntimeId;
  installedVersion: string;
  availableVersion: string;
  archiveSizeBytes: number;
}

export interface LocalAiRuntimeRemoveRequest {
  runtimeId: LocalAiRuntimeId;
  removeModels: boolean;
}

/** Main-process/worker-internal resolved runtime. Never sent to the renderer. */
export interface ResolvedLocalAiRuntime {
  runtimeId: LocalAiRuntimeId;
  runtimeVersion: string;
  runtimeRoot: string;
  manifest: LocalAiRuntimePackageManifest;
  entryPath?: string;
  moduleRequirePath?: string;
}

/** Operation lease held by the operation coordinator. */
export interface RuntimeOperationLease {
  operationId: string;
  runtimeId: LocalAiRuntimeId;
  controller: AbortController;
  startedAt: number;
}
