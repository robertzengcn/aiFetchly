/**
 * Local AI Runtime — strict type contracts.
 *
 * First-party, compile-time-fixed runtime identities. No runtime ID received
 * from the network may select an arbitrary package name or entry point; every
 * catalog/manifest value is matched against the constants declared here.
 *
 * See docs/prd/downloadable-local-ai-runtimes-technical-design.md §4.1, §7.
 */

/** Compiled allowlist of runtime IDs published in the v1 catalog. */
export const LOCAL_AI_RUNTIME_IDS = [
  "embedding-xenova",
  "voice-sherpa",
] as const;

/**
 * v2 catalog allowlist (computer-use design §7.3/§7.4): the v1 IDs plus the
 * Computer Use grounding runtime and model configurations. The v1 schema
 * keeps parsing `LOCAL_AI_RUNTIME_IDS` only, so publishing the v2 catalog
 * can never break an older app's v1 parse.
 */
export const LOCAL_AI_RUNTIME_IDS_V2 = [
  ...LOCAL_AI_RUNTIME_IDS,
  "grounding-onnxruntime",
  "grounding-model-gui-actor-2b-int4",
  "grounding-model-gui-actor-2b-fp16",
] as const;

export type LocalAiRuntimeId = (typeof LOCAL_AI_RUNTIME_IDS_V2)[number];

/** Runtime IDs whose package kind is `model` (file set, §7.5). */
export const LOCAL_AI_MODEL_RUNTIME_IDS = [
  "grounding-model-gui-actor-2b-int4",
  "grounding-model-gui-actor-2b-fp16",
] as const;

/** Package kinds in the v2 catalog. */
export const LOCAL_AI_RUNTIME_PACKAGE_KINDS = [
  "native_runtime",
  "model",
] as const;

export type LocalAiRuntimePackageKind =
  (typeof LOCAL_AI_RUNTIME_PACKAGE_KINDS)[number];

/** UI listing groups (§7.4): Settings shows "Computer Use" separately. */
export const LOCAL_AI_RUNTIME_GROUPS = {
  "local-ai": ["embedding-xenova", "voice-sherpa"],
  "computer-use": [
    "grounding-onnxruntime",
    "grounding-model-gui-actor-2b-int4",
    "grounding-model-gui-actor-2b-fp16",
  ],
} as const;

export type LocalAiRuntimeGroupId = keyof typeof LOCAL_AI_RUNTIME_GROUPS;

/**
 * Artifact filename prefix per runtime ID. Preserves the PRD filename contract
 * (`embedding-runtime-*`, `voice-runtime-*`) without weakening the more
 * specific internal runtime IDs.
 */
export const LOCAL_AI_RUNTIME_ARTIFACT_PREFIX: Record<
  LocalAiRuntimeId,
  "embedding" | "voice" | "grounding"
> = {
  "embedding-xenova": "embedding",
  "voice-sherpa": "voice",
  "grounding-onnxruntime": "grounding",
  "grounding-model-gui-actor-2b-int4": "grounding",
  "grounding-model-gui-actor-2b-fp16": "grounding",
};

/** Per-ID entry rules (§7.3): which optional manifest fields each ID permits. */
export const LOCAL_AI_RUNTIME_ENTRY_RULES: Record<
  LocalAiRuntimeId,
  { readonly entryPoint: "required" | "forbidden"; readonly entryModule: "required" | "forbidden" | "optional" }
> = {
  "embedding-xenova": { entryPoint: "required", entryModule: "forbidden" },
  "voice-sherpa": { entryPoint: "forbidden", entryModule: "required" },
  "grounding-onnxruntime": { entryPoint: "forbidden", entryModule: "required" },
  "grounding-model-gui-actor-2b-int4": { entryPoint: "forbidden", entryModule: "forbidden" },
  "grounding-model-gui-actor-2b-fp16": { entryPoint: "forbidden", entryModule: "forbidden" },
};

/** Platforms supported by v1 runtime packages. */
export type LocalAiRuntimePlatform = "win32" | "darwin" | "linux";

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
  | "runtime_dependency_missing"
  | "runtime_insufficient_memory"
  | "runtime_download_stalled"
  | "runtime_model_manifest_invalid"
  | "runtime_unknown_error";

/** Typed error thrown by runtime services. Carries a stable code + recoverability. */
export class LocalAiRuntimeError extends Error {
  readonly code: LocalAiRuntimeErrorCode;
  readonly recoverable: boolean;

  constructor(
    code: LocalAiRuntimeErrorCode,
    message: string,
    recoverable = false
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

/* ------------------------------------------------------------------------- */
/* Catalog v2 (computer-use design §7.3): package-kind union + model entries */
/* ------------------------------------------------------------------------- */

/** Execution provider ids declared by the grounding runtime (§7.6). */
export type GroundingExecutionProviderId = "dml" | "coreml" | "cpu";

/** One file of a model package (§7.5): safe relative path + https URL + hash. */
export interface ModelPackageFile {
  /** Safe relative path inside the model version root. */
  readonly path: string;
  /** HTTPS-only source URL; immutable per release.
   * Externally supplied at runtime via the catalog. */
  readonly url: string;
  readonly sizeBytes: number;
  /** Lowercase SHA-256 hex. */
  readonly sha256: string;
}

/** v2 entry for a native runtime package (ZIP) — extends the v1 shape. */
export interface NativeRuntimeCatalogEntryV2 extends LocalAiRuntimeCatalogEntry {
  readonly packageKind: "native_runtime";
  /** Grounding runtime only: execution providers built into the package. */
  readonly executionProviders?: readonly GroundingExecutionProviderId[];
}

/** v2 entry for a model package (multi-GB resumable file set, §7.5). */
export interface ModelCatalogEntryV2 {
  readonly packageKind: "model";
  readonly runtimeId: LocalAiRuntimeId;
  readonly runtimeVersion: string;
  readonly platform: "any";
  readonly arch: "any";
  readonly minAppVersion: string;
  readonly maxAppVersion?: string;
  /** Equals the sum of file sizes (validated). */
  readonly downloadSizeBytes: number;
  readonly installedSizeBytes: number;
  readonly minSystemMemoryBytes: number;
  readonly groundingContractVersion: number;
  /** Resolved only through the app's built-in adapter registry (§5.9.3). */
  readonly groundingAdapterId: string;
  readonly groundingAdapterVersion: string;
  readonly modelArchitecture: string;
  readonly modelManifestVersion: number;
  readonly preprocessingRevision: string;
  readonly decodingRevision: string;
  readonly calibrationRevision: string;
  readonly requiresRuntime: {
    readonly runtimeId: "grounding-onnxruntime";
    readonly minVersion: string;
  };
  readonly supportedExecutionProviders: readonly GroundingExecutionProviderId[];
  readonly license: {
    readonly model: string;
    readonly baseModel: string;
    readonly baseModelId: string;
  };
  readonly manifestSha256: string;
  readonly files: readonly ModelPackageFile[];
}

export type LocalAiRuntimeCatalogEntryV2 =
  | NativeRuntimeCatalogEntryV2
  | ModelCatalogEntryV2;

/** The v2 catalog document (`local-ai-runtimes.v2.json`). */
export interface LocalAiRuntimeCatalogV2 {
  readonly schemaVersion: 2;
  readonly catalogVersion: string;
  readonly releaseTag: string;
  readonly publishedAt: string;
  readonly runtimes: readonly LocalAiRuntimeCatalogEntryV2[];
}

/** Producer-side model manifest stored at the model version root. */
export interface GroundingModelManifest {
  readonly schemaVersion: number;
  readonly modelArchitecture: string;
  readonly runtimeId: LocalAiRuntimeId;
  readonly runtimeVersion: string;
  readonly modelManifestVersion: number;
  readonly groundingContractVersion: number;
  readonly groundingAdapterId: string;
  readonly groundingAdapterVersion: string;
  readonly preprocessingRevision: string;
  readonly decodingRevision: string;
  readonly calibrationRevision: string;
  readonly files: readonly ModelPackageFile[];
  readonly license: ModelCatalogEntryV2["license"];
}

/* ------------------------------ install sets ------------------------------ */
/* One consent covering the grounding runtime and a model (CU-INST-13).      */

export interface LocalAiRuntimeInstallSetEntryOffer {
  readonly runtimeId: LocalAiRuntimeId;
  readonly runtimeVersion: string;
  readonly downloadSizeBytes: number;
  readonly installedSizeBytes: number;
  /** ZIP sha256 for native packages; manifestSha256 for models. */
  readonly identityHash: string;
}

/** Offer returned by prepareInstallSet; combined sizes shown for consent. */
export interface LocalAiRuntimeInstallSetOffer {
  readonly operationId: string;
  readonly entries: readonly LocalAiRuntimeInstallSetEntryOffer[];
  readonly totalDownloadBytes: number;
  readonly totalInstalledBytes: number;
  readonly consentToken: string;
  readonly expiresAt: string;
}

export interface LocalAiRuntimeInstallSetRequest {
  readonly operationId: string;
  readonly consentToken: string;
}

export interface LocalAiRuntimeInstallSetResult {
  readonly operationId: string;
  readonly installed: readonly {
    runtimeId: LocalAiRuntimeId;
    runtimeVersion: string;
    activated: boolean;
  }[];
  readonly failedRuntimeId?: LocalAiRuntimeId;
  readonly errorCode?: LocalAiRuntimeErrorCode;
}
