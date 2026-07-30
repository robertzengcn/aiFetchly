# Downloadable Local AI Runtimes - Technical Design

## Document Information

| Field | Value |
| --- | --- |
| Document version | v1.0 |
| Status | Draft |
| Created | 2026-07-30 |
| Owner | AiFetchly engineering |
| Source PRD | `docs/prd/downloadable-local-ai-runtimes-prd.md` |
| Target platforms | Windows x64, macOS x64, macOS arm64 |
| Primary implementation language | TypeScript 5.x |
| Primary runtime | Electron 35.x / Node.js |

## 1. Purpose

This document translates the Downloadable Local AI Runtimes PRD into an implementation-ready design.

The design removes optional local embedding and voice inference dependencies from the base Electron package and delivers them as first-party, platform-specific runtime archives. GitHub Actions builds the archives on their target operating systems, verifies them in isolation, generates a catalog, and publishes them with the desktop release. The installed application downloads and activates a runtime only after user consent.

The design covers:

- Runtime archive and catalog contracts
- Runtime discovery, compatibility, download, extraction, activation, repair, update, rollback, and removal
- Explicit native dependency resolution for voice
- Downloaded worker resolution for embedding
- Main-process, worker, IPC, renderer, and filesystem ownership boundaries
- GitHub Actions build and release topology
- Forge packaging migration
- Security, signing, diagnostics, and tests

This design does not implement a generic third-party native plugin system. Only runtime IDs compiled into AiFetchly are accepted.

## 2. Requirements Summary

The implementation must preserve these invariants:

1. The base application starts and provides remote AI features with no local runtime installed.
2. Required database dependencies, including `better-sqlite3` and `sqlite-vec`, remain in the base application.
3. A runtime archive is executable content and remains untrusted until catalog, checksum, archive, manifest, compatibility, and health validation all pass.
4. The application never executes `npm install`, `yarn install`, `node-gyp`, or a compiler on an end-user machine.
5. Runtime and model lifecycles remain separate.
6. Local workers never access SQLite, TypeORM, Models, or Modules.
7. IPC handlers validate and delegate; they do not perform filesystem installation logic.
8. A failed install or update never destroys the current known-good runtime.
9. Remote embedding fallback never causes an implicit runtime or model download.
10. All renderer-visible strings are translated in all six supported languages.

## 3. Current System

### 3.1 Forge packaging

`forge.config.js` currently lists these local AI packages in `EXTERNAL_DEPENDENCIES`:

```text
@xenova/transformers
onnxruntime-node
onnxruntime-common
sharp
sherpa-onnx-node
```

The ASAR configuration also unpacks those dependencies and every sherpa platform package. The Forge Vite plugin builds both local AI worker entry points into the application:

```text
src/childprocess/embedding/LocalEmbeddingWorker.ts
src/childprocess/ai-chat-voice/AiChatVoiceWorker.ts
```

The final migration will remove the embedding worker from the base Forge build and remove both inference dependency trees from the package allowlist and ASAR unpack patterns. The lightweight voice worker remains in the base app.

### 3.2 Embedding runtime

`LocalEmbeddingWorker.ts` statically imports `@xenova/transformers`. Its Vite configuration externalizes Transformers.js, ONNX Runtime, and Sharp so Node resolves them from `node_modules` at worker startup.

`LocalEmbeddingWorkerClient` currently searches only bundled/development paths:

```text
<bundle>/childprocess/LocalEmbeddingWorker.js
<bundle>/../childprocess/LocalEmbeddingWorker.js
<cwd>/dist/childprocess/LocalEmbeddingWorker.js
<cwd>/.vite/build/childprocess/LocalEmbeddingWorker.js
```

Because the worker uses a static external import, the clean runtime boundary is to package the compiled worker and its external dependency closure together. Electron then forks the downloaded `worker.js`, whose normal Node resolution finds colocated runtime dependencies.

### 3.3 Voice runtime

`AiChatVoiceWorker.ts` is lightweight. It imports AiFetchly worker logic, while `voiceServices.ts` calls the bundler-opaque `loadSherpaOnnxNative()` helper.

`SherpaOnnxNative.ts` currently creates `require` from its own bundled filename, which resolves `sherpa-onnx-node` from the base application. The loader already returns `null` when the package is absent.

The target voice design keeps the worker in the base app and changes native loading to use a validated active runtime root supplied by the main process.

### 3.4 Model delivery

Voice models already use:

```text
<userData>/voice-models/<model-directory>/
```

Embedding models already use the Transformers.js cache resolved by `LocalTransformersEnvironment.ts`.

Neither model location changes. Runtime removal does not remove these directories by default.

### 3.5 Release workflow

`.github/workflows/release.yml` currently computes the same release version independently in Windows and macOS jobs, hard-codes an Electron rebuild target in one macOS step, and builds one macOS runner architecture. The workflow is also being narrowed to a manual `workflow_dispatch` build with read-only permissions and selected installer artifacts instead of automatically publishing every file under `out/make`.

The target workflow preserves that narrower artifact allowlist and introduces one version job, explicit platform/architecture runtime jobs, isolated runtime verification, and catalog generation. Publishing remains an explicit protected action. It can be a boolean manual-dispatch input and conditional job in the same workflow, or a separate protected publishing workflow that consumes verified build artifacts.

## 4. Key Design Decisions

### 4.1 Two first-party runtime IDs

```typescript
export const LOCAL_AI_RUNTIME_IDS = [
  "embedding-xenova",
  "voice-sherpa",
] as const;

export type LocalAiRuntimeId =
  (typeof LOCAL_AI_RUNTIME_IDS)[number];

export const LOCAL_AI_RUNTIME_ARTIFACT_PREFIX: Record<
  LocalAiRuntimeId,
  "embedding" | "voice"
> = {
  "embedding-xenova": "embedding",
  "voice-sherpa": "voice",
};
```

No runtime ID received from the network may select an arbitrary package name or entry point. Catalog entries are matched against this compiled allowlist.

Artifact prefixes preserve the PRD filename contract (`embedding-runtime-*` and `voice-runtime-*`) without weakening the more specific internal runtime IDs.

### 4.2 Voice worker stays bundled

The voice worker contains request validation, audio conversion, and sherpa service orchestration that belong to the application version. The voice runtime archive contains only the native package closure.

Benefits:

- Voice IPC contracts ship with the application.
- Runtime archives stay smaller.
- The existing worker lifecycle remains intact.
- Native resolution can be changed through one scoped loader.

### 4.3 Embedding worker moves into the runtime

The embedding worker statically imports Transformers.js and is already compiled separately. Packaging it with Transformers.js avoids `NODE_PATH` mutation and avoids converting the worker to an untyped dynamic import.

The runtime package is therefore versioned against both the worker contract and its inference dependencies.

### 4.4 Filesystem state, not SQLite

Runtime state describes executable files on disk. The filesystem is authoritative. `active.json` is a small atomic pointer to a validated version.

No SQLite entity is required in v1. This avoids creating database access for a feature that must work before any local worker starts and must remain independent from worker processes.

### 4.5 Side-by-side versions

Runtime updates install into a new version directory. The application never overwrites a loaded native library or active worker directory.

### 4.6 Exact ABI compatibility

Target selection requires all of the following:

- Exact runtime ID
- Exact `process.platform`
- Exact `process.arch`
- Exact `process.versions.modules`
- AiFetchly version inside the catalog entry range
- Supported catalog and package schema versions

Electron version is retained for diagnostics and build reproducibility. Node module ABI is the primary native compatibility gate.

### 4.7 Structured streaming ZIP implementation

Runtime archives can exceed 100 MB and contain native executable files. The implementation should add:

- `yauzl` as a production dependency for lazy, entry-by-entry extraction
- `yazl` as a development dependency for deterministic archive creation
- Their maintained TypeScript declarations where needed
- `semver` as a direct production dependency for compatibility ranges

The existing `PluginArchiveService` provides useful validation patterns but uses `adm-zip`, which reads the archive into memory and is scoped to smaller plugin packages. Runtime extraction should use a shared lower-level path policy while retaining streaming behavior.

### 4.8 Explicit resolver paths

The implementation must not modify global `NODE_PATH`. Voice uses `createRequire()` scoped to the active voice runtime. Embedding forks the active runtime's absolute worker path.

## 5. Target Architecture

### 5.1 Process and ownership diagram

```text
Renderer
  LocalAiComponentsPanel
  KnowledgeLibrary embedding selector
  AiChat voice controls
       |
       | contextBridge invoke/progress channels
       v
Main process IPC
  local-ai-runtime-ipc.ts
  - Zod input validation
  - CommonMessage envelope
  - no install implementation
       |
       v
LocalAiRuntimeModule
  - operation policy
  - per-runtime lock
  - consent-triggered orchestration
  - worker lease coordination
       |
       +-------------------------------+
       |                               |
       v                               v
Catalog/installer services        Runtime state/resolver
  HTTPS catalog                     active.json
  target selection                  package manifest
  streaming download                required files
  SHA-256                            compatibility
  safe ZIP extraction               health state
  health check
  atomic activation
       |                               |
       +---------------+---------------+
                       |
             +---------+----------+
             |                    |
             v                    v
Embedding utility process     Voice utility process
downloaded worker.js          bundled voice worker
colocated Transformers.js     scoped sherpa require
no database access            no database access
```

### 5.2 Source layout

```text
src/
  entityTypes/
    localAiRuntimeTypes.ts
  schemas/
    localAiRuntime.ts
    ipc/
      localAiRuntime.ts
  modules/
    LocalAiRuntimeModule.ts
  service/
    localAiRuntime/
      LocalAiRuntimeCatalogService.ts
      LocalAiRuntimeCompatibilityService.ts
      LocalAiRuntimeDownloadService.ts
      LocalAiRuntimeExtractor.ts
      LocalAiRuntimeHealthService.ts
      LocalAiRuntimeOperationCoordinator.ts
      LocalAiRuntimePathService.ts
      LocalAiRuntimeResolver.ts
      LocalAiRuntimeStateStore.ts
      LocalAiRuntimeTypesGuard.ts
  main-process/
    communication/
      local-ai-runtime-ipc.ts
  views/
    api/
      localAiRuntime.ts
    components/
      settings/
        LocalAiComponentsPanel.vue
  childprocess/
    embedding/
      LocalEmbeddingWorker.ts
    ai-chat-voice/
      AiChatVoiceWorker.ts

scripts/
  build-local-ai-runtime.mjs
  verify-local-ai-runtime.mjs
  generate-local-ai-runtime-catalog.mjs
  verify-base-package-exclusions.mjs
```

Build-only helpers may live under `scripts/lib/local-ai-runtime/` to keep scripts small and testable.

### 5.3 Dependency direction

```text
IPC -> LocalAiRuntimeModule -> Services -> filesystem/network
                              -> worker clients

EmbeddingProviderFactory -> LocalEmbeddingWorkerClient
                            -> LocalAiRuntimeResolver

AiChatVoiceModule -> SherpaVoiceWorkerClient
                     -> LocalAiRuntimeResolver

Workers -> inference dependencies only
Workers -X-> Module/Model/TypeORM/SQLite
```

## 6. On-Disk Layout

### 6.1 Runtime root

The main-process composition root resolves:

```typescript
const runtimeRoot = path.join(
  app.getPath("userData"),
  "local-ai-runtimes"
);
```

This use of `app.getPath("userData")` is for executable runtime storage, not database access. Database paths continue to use the Token/`USERSDBPATH` architecture.

### 6.2 Directory structure

```text
<userData>/local-ai-runtimes/
  catalog-cache.json
  catalog-cache.meta.json
  .downloads/
    <operation-id>.zip.part
  .staging/
    <operation-id>/
  embedding-xenova/
    active.json
    1.0.0/
      manifest.json
      package.json
      worker.js
      THIRD_PARTY_NOTICES.txt
      node_modules/
  voice-sherpa/
    active.json
    1.0.0/
      manifest.json
      package.json
      THIRD_PARTY_NOTICES.txt
      node_modules/
```

`operation-id` is generated locally with UUID v4. It is never supplied by the renderer or catalog.

### 6.3 Active pointer

```typescript
export interface LocalAiRuntimeActiveState {
  schemaVersion: 1;
  runtimeId: LocalAiRuntimeId;
  runtimeVersion: string;
  activatedAt: string;
  packageSha256: string;
  previousVersion?: string;
}
```

`active.json` is written with `write-file-atomic`, which is already a direct project dependency. The state file contains no absolute path. Paths are always reconstructed through `LocalAiRuntimePathService`.

### 6.4 Path containment

Every path operation must use fixed, validated segments:

```typescript
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
```

Runtime IDs come from the compiled union. Runtime versions must pass strict semver parsing and must not contain path separators.

## 7. Data Contracts

### 7.1 Runtime identity

```typescript
export type LocalAiRuntimeId =
  | "embedding-xenova"
  | "voice-sherpa";

export type LocalAiRuntimePlatform = "win32" | "darwin";
export type LocalAiRuntimeArch = "x64" | "arm64";

export interface LocalAiRuntimeTarget {
  platform: LocalAiRuntimePlatform;
  arch: LocalAiRuntimeArch;
  electronVersion: string;
  nodeModuleAbi: string;
  appVersion: string;
}
```

### 7.2 Runtime catalog

```typescript
export interface LocalAiRuntimeCatalog {
  schemaVersion: 1;
  catalogVersion: string;
  releaseTag: string;
  publishedAt: string;
  runtimes: LocalAiRuntimeCatalogEntry[];
}

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
```

### 7.3 Package manifest

```typescript
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
```

Catalog and package manifest identity fields must match exactly. The package manifest cannot broaden compatibility declared by the catalog.

### 7.4 Runtime state

```typescript
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
```

No internal filesystem path is returned to the renderer.

### 7.5 Progress events

```typescript
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
```

`operationId` lets the renderer ignore stale progress after cancel/retry. It is opaque to the renderer.

### 7.6 Error codes

```typescript
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

export class LocalAiRuntimeError extends Error {
  constructor(
    readonly code: LocalAiRuntimeErrorCode,
    message: string,
    readonly recoverable: boolean = false
  ) {
    super(message);
    this.name = "LocalAiRuntimeError";
  }
}
```

## 8. Zod Validation

### 8.1 Network schemas

All downloaded JSON is parsed as `unknown` and validated before use.

```typescript
import { z } from "zod";

const runtimeIdSchema = z.enum([
  "embedding-xenova",
  "voice-sherpa",
]);

const runtimePlatformSchema = z.enum(["win32", "darwin"]);
const runtimeArchSchema = z.enum(["x64", "arm64"]);
const semverSchema = z.string().refine(
  (value) => semver.valid(value) !== null,
  "Expected a valid semantic version."
);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const relativeRuntimePathSchema = z.string().min(1).refine(
  (value) => isSafeRelativeRuntimePath(value),
  "Expected a safe relative runtime path."
);

export const localAiRuntimeCatalogEntrySchema = z.object({
  runtimeId: runtimeIdSchema,
  runtimeVersion: semverSchema,
  platform: runtimePlatformSchema,
  arch: runtimeArchSchema,
  downloadUrl: z.string().url(),
  archiveFileName: z.string().min(1).max(180),
  archiveSizeBytes: z.number().int().positive(),
  installedSizeBytes: z.number().int().positive(),
  sha256: sha256Schema,
  electronVersion: semverSchema,
  nodeModuleAbi: z.string().regex(/^\d+$/),
  minAppVersion: semverSchema,
  maxAppVersion: semverSchema.optional(),
  entryPoint: relativeRuntimePathSchema.optional(),
  entryModule: z.string().min(1).max(120).optional(),
  requiredFiles: z.array(relativeRuntimePathSchema).min(1).max(5000),
  dependencies: z.record(z.string(), z.string()),
}).strict();
```

Additional refinements enforce:

- `entryPoint` is present only for `embedding-xenova`.
- `entryModule` is present only for `voice-sherpa`.
- `maxAppVersion` is not less than `minAppVersion`.
- Archive filename matches runtime ID, platform, architecture, and version.
- Download URL uses HTTPS outside explicit development/test configuration.

### 8.2 IPC schemas

```typescript
export const runtimeStatusInputSchema = lazySchema(() =>
  z.object({ runtimeId: runtimeIdSchema }).strict()
);

export const runtimeInstallInputSchema = lazySchema(() =>
  z.object({
    operationId: z.string().uuid(),
    runtimeId: runtimeIdSchema,
    expectedRuntimeVersion: semverSchema,
    consentToken: z.string().uuid(),
  }).strict()
);

export const runtimeCancelInputSchema = lazySchema(() =>
  z.object({ operationId: z.string().uuid() }).strict()
);

export const runtimeRemoveInputSchema = lazySchema(() =>
  z.object({
    runtimeId: runtimeIdSchema,
    removeModels: z.boolean().default(false),
  }).strict()
);
```

The operation ID and consent token are created by the main process when it returns install details and expire after a short interval. They bind the later install request to the runtime, version, catalog digest, and offer that the renderer displayed. This prevents version substitution between offer and install; it does not claim to prove human consent if the renderer itself is fully compromised.

## 9. Runtime Path Service

### 9.1 Responsibilities

`LocalAiRuntimePathService` is the only component allowed to construct runtime installation paths.

```typescript
export interface LocalAiRuntimePaths {
  root: string;
  runtimeRoot: string;
  versionRoot: string;
  activeStatePath: string;
  packageManifestPath: string;
}

export class LocalAiRuntimePathService {
  constructor(private readonly root: string) {}

  getRuntimePaths(
    runtimeId: LocalAiRuntimeId,
    runtimeVersion: string
  ): LocalAiRuntimePaths;

  createOperationPaths(operationId: string): {
    archivePath: string;
    stagingRoot: string;
  };
}
```

### 9.2 Deletion policy

Recursive deletion is allowed only for a path returned by the path service after all conditions pass:

- Runtime ID is compiled and valid.
- Runtime version is strict semver.
- Candidate is beneath runtime root.
- Candidate is not the runtime root itself.
- Candidate is not the user data root.
- Candidate is not active while a worker lease exists.

## 10. State Store and Recovery

### 10.1 State store

`LocalAiRuntimeStateStore` reads and writes catalog cache metadata, package manifests, and active pointers. It performs no network operations and no runtime loading.

```typescript
export interface LocalAiRuntimeStateStore {
  readActive(runtimeId: LocalAiRuntimeId):
    Promise<LocalAiRuntimeActiveState | null>;
  writeActive(state: LocalAiRuntimeActiveState): Promise<void>;
  clearActive(runtimeId: LocalAiRuntimeId): Promise<void>;
  readPackageManifest(
    runtimeId: LocalAiRuntimeId,
    version: string
  ): Promise<LocalAiRuntimePackageManifest | null>;
  listInstalledVersions(runtimeId: LocalAiRuntimeId): Promise<string[]>;
}
```

JSON writes use `write-file-atomic`. Readers parse as `unknown`, validate with Zod, and return `null` or a typed error for corrupted state.

### 10.2 Startup reconciliation

On first local runtime status request:

1. Read `active.json`.
2. Validate its schema.
3. Resolve the version directory through the path service.
4. Read and validate `manifest.json`.
5. Verify target compatibility and required files.
6. Return `ready`, `incompatible`, or `corrupted`.

Do not fetch the catalog during this local reconciliation.

### 10.3 Crash recovery

At startup or before installation, remove only stale staging/download entries that:

- Are beneath `.staging` or `.downloads`.
- Match the locally generated operation naming pattern.
- Are older than 24 hours.
- Are not referenced by an in-memory active operation.

Never scan or delete outside the runtime root.

## 11. Catalog Service

### 11.1 Source resolution

```typescript
export interface RuntimeCatalogSourceConfig {
  catalogUrl: string;
  allowedHosts: readonly string[];
  cacheTtlMs: number;
}
```

Recommended source precedence:

1. `AIFETCHLY_RUNTIME_CATALOG_URL` injected into the main-process build.
2. `${UPDATESERVER}/runtime/local-ai-runtimes.json`.
3. Public GitHub Release URL derived from repository and `app.getVersion()`.

Production builds must fail when no approved catalog source can be resolved and runtime downloads are enabled.

### 11.2 Fetch algorithm

```text
getCatalog(forceRefresh)
  if !forceRefresh and valid cache age < TTL:
    return cached catalog

  GET catalog with If-None-Match / If-Modified-Since
  enforce HTTPS, host policy, timeout, redirect policy, max JSON size
  if 304:
    refresh cache metadata and return cached catalog
  parse response as unknown
  validate strict Zod schema
  validate duplicate targets and catalog invariants
  atomically write catalog cache + metadata
  return catalog
```

Suggested defaults:

```typescript
export const RUNTIME_CATALOG_MAX_BYTES = 2 * 1024 * 1024;
export const RUNTIME_CATALOG_TIMEOUT_MS = 15_000;
export const RUNTIME_CATALOG_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const RUNTIME_HTTP_MAX_REDIRECTS = 5;
```

### 11.3 Target selection

```typescript
export class LocalAiRuntimeCompatibilityService {
  selectEntry(
    catalog: LocalAiRuntimeCatalog,
    runtimeId: LocalAiRuntimeId,
    target: LocalAiRuntimeTarget
  ): LocalAiRuntimeCatalogEntry;

  isCompatible(
    entry: LocalAiRuntimeCatalogEntry,
    target: LocalAiRuntimeTarget
  ): boolean;
}
```

Selection order:

1. Filter exact runtime ID/platform/architecture/ABI.
2. Filter app version range.
3. Reject duplicate entries for the same runtime version and target.
4. Select the highest compatible runtime version.
5. Return a typed `runtime_catalog_target_missing` error when none exists.

The service does not silently select another architecture, Rosetta target, or older ABI.

## 12. Download Service

### 12.1 Interface

```typescript
export interface RuntimeDownloadRequest {
  operationId: string;
  entry: LocalAiRuntimeCatalogEntry;
  destinationPath: string;
  signal: AbortSignal;
  onProgress: (progress: LocalAiRuntimeDownloadProgress) => void;
}

export interface RuntimeDownloadResult {
  archivePath: string;
  downloadedBytes: number;
  sha256: string;
}

export class LocalAiRuntimeDownloadService {
  async download(
    request: RuntimeDownloadRequest
  ): Promise<RuntimeDownloadResult>;
}
```

### 12.2 Streaming algorithm

Use Node `https` or a reviewed streaming HTTP client. Do not buffer the archive.

```text
open destination with exclusive create
create SHA-256 hash
request URL
validate status and headers
for each chunk:
  abort if cancelled
  increment byte count
  reject if count > local maximum
  reject if count > catalog size tolerance
  update hash
  write chunk with backpressure
  emit throttled progress
fsync/close stream
compare byte count to expected size
compare SHA-256 to catalog
return result
```

Progress should be throttled to at most 10 events per second to avoid flooding IPC.

### 12.3 Limits

```typescript
export const LOCAL_AI_RUNTIME_LIMITS = {
  maxArchiveBytes: 768 * 1024 * 1024,
  maxExtractedBytes: 2 * 1024 * 1024 * 1024,
  maxEntries: 25_000,
  maxSingleEntryBytes: 1024 * 1024 * 1024,
  timeoutMs: 10 * 60 * 1000,
  maxRedirects: 5,
} as const;
```

Catalog values may be lower but cannot raise local limits.

### 12.4 Redirect policy

Every redirect must:

- Remain HTTPS.
- Resolve to an allowed runtime artifact host.
- Exclude URL credentials.
- Avoid forwarding authorization headers to a different origin.
- Stay within the redirect limit.

GitHub Release deployments must configure the required GitHub-owned asset hosts through build configuration rather than accepting arbitrary redirect hosts.

### 12.5 Disk-space preflight

Before download, require free space for:

```text
archiveSizeBytes
+ installedSizeBytes
+ retainedPreviousVersionSize
+ 10% safety margin
```

Use an injectable disk-space provider for tests. If reliable platform disk-space information is unavailable, continue only after ensuring the runtime root can be created and surface disk-full failures as `runtime_disk_space_insufficient`.

## 13. Safe ZIP Extraction

### 13.1 Entry validation

`LocalAiRuntimeExtractor` opens archives with lazy entries and validates every entry before writing.

Reject an entry when:

- Name is empty or contains NUL.
- Name is absolute.
- Normalized name is `..` or escapes through `../`.
- Name has a Windows drive or UNC prefix.
- Basename is a reserved Windows device name.
- Entry is a symlink, hard link, device, or unsupported special type.
- Duplicate normalized path already exists.
- Entry or aggregate expanded size exceeds limits.
- Entry count exceeds limits.
- Resolved output path leaves the staging root.

### 13.2 Extraction algorithm

```text
mkdir fresh staging root
open ZIP in lazy-entry mode
for each entry:
  validate metadata/path/type/size
  create parent path beneath staging root
  open destination with exclusive create
  stream entry with per-entry and aggregate byte counters
  apply conservative file mode
after all entries:
  validate no unexpected top-level wrapper
  parse manifest.json as unknown
  validate package manifest
  compare catalog and package identity
  validate required files and final expanded size
```

Executable permissions required by packaged native tools are restored from a build-generated mode list in the manifest. Arbitrary archive permission bits are not trusted.

### 13.3 Reuse with plugin extraction

Extract path validation helpers into a neutral utility only when their contracts are identical. Do not weaken runtime limits to match plugin behavior. Plugin imports and first-party runtime installation remain separate trust domains.

## 14. Installation and Activation

### 14.1 Operation coordinator

`LocalAiRuntimeOperationCoordinator` owns one mutable operation per runtime ID.

```typescript
export interface RuntimeOperationLease {
  operationId: string;
  runtimeId: LocalAiRuntimeId;
  controller: AbortController;
  startedAt: number;
}

export class LocalAiRuntimeOperationCoordinator {
  acquire(
    runtimeId: LocalAiRuntimeId,
    operationId: string
  ): RuntimeOperationLease;
  get(runtimeId: LocalAiRuntimeId): RuntimeOperationLease | null;
  cancel(operationId: string): boolean;
  release(operationId: string): void;
}
```

Concurrent install, repair, update, or remove requests for the same runtime return `runtime_busy`. Voice and embedding installs may run concurrently if disk and network policy permit.

### 14.2 Consent binding

Installation uses two IPC calls:

```text
prepareInstall(runtimeId)
  -> target entry + sizes + operationId + short-lived consentToken

install(operationId, runtimeId, expectedRuntimeVersion, consentToken)
  -> validates token binds operation/runtime/version/catalog digest
  -> starts operation
```

The main process stores consent grants in memory for five minutes. A grant is one-time use. A catalog refresh that changes the target version invalidates the grant. Preparing an offer does not acquire the runtime operation lock; the lock is acquired only when installation starts.

### 14.3 Install sequence

```text
acquire runtime operation lock
resolve compatible catalog entry
validate consent grant
create download/staging paths
emit resolving
disk-space preflight
emit downloading
stream archive + SHA-256
emit verifying
verify checksum and archive metadata
emit extracting
extract to fresh staging
validate manifest/required files/dependency policy
emit testing
run runtime-specific health check from staging
emit activating
rename staging -> <runtime>/<version>
atomically write active.json with previousVersion
dispose/restart related idle worker when required
emit done
schedule bounded cleanup
release operation lock
```

If the target version directory already exists and is valid with the same checksum, skip extraction and run health/activation. If it exists but differs, quarantine/remove only that version through the path service before installing.

### 14.4 Activation ordering

The version directory rename occurs before `active.json` replacement. The rename must remain on the same filesystem as the final version directory.

```text
Before activation:
active.json -> 0.9.0
1.0.0 does not exist

After staging rename, before pointer write:
active.json -> 0.9.0
1.0.0 exists but is inactive

After pointer write:
active.json -> 1.0.0, previousVersion=0.9.0
```

A crash in the middle leaves either the previous version active or an inactive validated version that can be reconciled later.

### 14.5 Runtime worker leases

Worker clients acquire a runtime-version lease while a worker is alive. A leased version cannot be removed.

For activation:

- If the related worker is idle, dispose it before switching `active.json`.
- If a job is active, return `runtime_busy` or defer activation.
- New worker starts resolve the new active version.
- Existing loaded native libraries are never replaced in place.

### 14.6 Repair

Repair ignores the current runtime directory contents and re-downloads the same catalog version into a fresh staging area. After health success, it replaces the inactive/corrupted directory only when no worker lease exists.

### 14.7 Rollback

Automatic rollback is allowed when:

- `active.json.previousVersion` exists.
- Previous manifest validates locally.
- Previous target/ABI remains compatible.
- Previous health check passes.

Rollback atomically points `active.json` to the previous version. It never downloads during failure recovery without user consent.

### 14.8 Removal

```text
acquire operation lock
confirm no worker lease / active inference
dispose idle worker
resolve exact active version directory
atomically clear or replace active pointer
delete exact version directory
optionally delete models only after separate explicit confirmation
release lock
```

On Windows, a locked-file failure leaves truthful state and schedules no unbounded background deletion. The UI offers retry after application restart.

## 15. Runtime Resolver

### 15.1 Interface

```typescript
export interface ResolvedLocalAiRuntime {
  runtimeId: LocalAiRuntimeId;
  runtimeVersion: string;
  runtimeRoot: string;
  manifest: LocalAiRuntimePackageManifest;
  entryPath?: string;
  moduleRequirePath?: string;
}

export class LocalAiRuntimeResolver {
  async resolve(
    runtimeId: LocalAiRuntimeId
  ): Promise<ResolvedLocalAiRuntime | null>;
}
```

`runtimeRoot`, `entryPath`, and `moduleRequirePath` remain main-process/worker-internal values. They are never sent to the renderer.

### 15.2 Resolution algorithm

```text
read active pointer
validate pointer
read package manifest
validate manifest
check runtime/platform/arch/ABI/app compatibility
check required files
resolve entry path beneath version root
return resolved runtime
```

The normal resolve path does not hash every installed file because that would add startup cost. Package checksum is verified at install time. Required-file and manifest validation run on each cold resolution; a full health check runs after install, after app/Electron upgrade, after repair, or on explicit diagnostics.

## 16. Voice Integration

### 16.1 Native loader

Change the loader to accept an explicit runtime root:

```typescript
export function loadSherpaOnnxNative(
  runtimeRoot: string
): SherpaOnnxNative | null {
  try {
    const runtimePackageJson = path.join(runtimeRoot, "package.json");
    const runtimeRequire = createRequire(runtimePackageJson);
    return runtimeRequire("sherpa-onnx-node") as SherpaOnnxNative;
  } catch {
    return null;
  }
}
```

Before this call, `runtimeRoot` must come from `LocalAiRuntimeResolver`. The loader must not accept a renderer-provided path.

### 16.2 Worker initialization contract

Extend the main-to-worker initialization message:

```typescript
export interface AiChatVoiceInitializeMessage {
  type: "initialize";
  requestId: string;
  runtimeRoot: string;
  sttModelPath?: string;
  ttsModelPath?: string;
  sttLanguage?: string;
  ttsLanguage?: string;
}
```

The worker schema validates `runtimeRoot` as a non-empty absolute path. Trust still comes from the main process resolver, not the schema alone.

`createVoiceServices()` passes the runtime root to STT and TTS services. Both call the same scoped native loader and cache the returned module for the worker lifetime.

### 16.3 Worker client changes

`SherpaVoiceWorkerClient` receives a resolver dependency:

```typescript
export interface VoiceRuntimeResolver {
  resolveVoiceRuntime(): Promise<ResolvedLocalAiRuntime | null>;
}
```

Before worker initialization:

1. Resolve `voice-sherpa`.
2. Return a typed unavailable error when absent.
3. Add `runtimeRoot` to the initialization key and message.
4. Acquire a lease for the resolved runtime version.
5. Release the lease when the worker exits or is disposed.

### 16.4 Voice status

`AiChatVoiceModule.getRuntimeStatus()` changes from checking bundled package availability to querying runtime status.

Mapping:

| Runtime state | Voice state |
| --- | --- |
| `ready` | Continue model checks |
| `not_installed`, `download_required` | `unavailable` with install action |
| `incompatible` | `unavailable` with update action |
| `corrupted`, `error` | `error` with repair action |
| Runtime ready, model absent | `missing_model` |

### 16.5 Bundled migration fallback

For one beta release, the resolver may fall back to the bundled `sherpa-onnx-node` after downloaded resolution fails. The fallback is enabled by a build-time migration flag and removed before general availability of the slim installer.

## 17. Embedding Integration

### 17.1 Runtime package entry point

The embedding package manifest contains:

```json
{
  "runtimeId": "embedding-xenova",
  "entryPoint": "worker.js"
}
```

`worker.js` is built from `src/childprocess/embedding/LocalEmbeddingWorker.ts` with the existing CommonJS worker Vite configuration. Inference packages remain external so they resolve from the runtime's `node_modules`.

### 17.2 Worker client changes

Replace filesystem candidate search with resolver-first lookup:

```typescript
export interface EmbeddingRuntimeResolver {
  resolveEmbeddingWorker(): Promise<{
    runtimeVersion: string;
    workerPath: string;
  } | null>;
}
```

`resolveWorkerPath()` becomes asynchronous or worker resolution occurs before `startWorker()`:

```text
resolve active embedding runtime
validate worker path from manifest
acquire runtime-version lease
fork downloaded worker path
initialize model
release lease on exit/dispose
```

Tests continue to inject `workerPathOverride` and fake fork functions.

### 17.3 Worker environment

The existing Transformers environment behavior remains:

- Model cache path stays outside runtime version directories.
- Offline environment variables remain supported.
- Remote model hosts remain separately configured.
- `NODE_OPTIONS` is cleared for the utility process.
- Set `WORKER_TYPE=local-embedding` for architecture enforcement and diagnostics.

Do not add the runtime's `node_modules` to global process environment. Normal resolution from downloaded `worker.js` is sufficient.

### 17.4 Forge migration

During migration, Forge may still build the bundled worker as fallback. In the final slim phase:

- Remove `LocalEmbeddingWorker.ts` from Forge Vite plugin build entries.
- Build it only through the runtime packaging script.
- Keep shared worker message types and validation code in the base app bundle as needed by the client.

### 17.5 Embedding model catalog

Local model catalog entries need runtime readiness metadata:

```typescript
export interface EmbeddingModelRuntimeRequirement {
  runtimeId: "embedding-xenova";
  runtimeState: LocalAiRuntimeState;
  runtimeVersion?: string;
  archiveSizeBytes?: number;
}
```

The stable model ID and 384-dimensional vector contract do not change.

## 18. Remote Embedding Fallback

### 18.1 Current behavior to change

`RagSearchModule` may attempt local Xenova after remote retries fail. With downloadable runtimes, provider creation alone must not initiate installation.

### 18.2 Target behavior

```text
remote embedding fails after retry
  |
  v
check local runtime status locally
  |
  +-- ready + model available --> existing local fallback
  |
  +-- absent/incompatible/model missing
        --> return recoverable local-components-required result
        --> document remains pending or failed consistently
        --> renderer offers explicit install/retry action
```

Suggested error:

```typescript
export class LocalEmbeddingComponentsRequiredError extends Error {
  readonly code = "local_embedding_components_required";
  constructor(
    readonly runtimeState: LocalAiRuntimeState,
    readonly modelAvailable: boolean
  ) {
    super("Local embedding components must be installed before fallback.");
  }
}
```

This error carries no document text. IPC maps it to a localized renderer state.

### 18.3 Vector consistency

The existing rules remain mandatory:

- Delete/rollback partial vectors before changing providers.
- Store final model ID and dimensions on the document.
- Generate query vectors with the document group's stored model.
- Never search remote-indexed vectors with local MiniLM vectors.

## 19. Health Checks

### 19.1 Interface

```typescript
export interface RuntimeHealthCheckContext {
  runtime: ResolvedLocalAiRuntime;
  mode: "runtime_only" | "full";
  timeoutMs: number;
}

export interface RuntimeHealthCheckResult {
  ok: boolean;
  runtimeId: LocalAiRuntimeId;
  runtimeVersion: string;
  durationMs: number;
  details: Record<string, string | number | boolean>;
  errorCode?: LocalAiRuntimeErrorCode;
  errorMessage?: string;
}
```

### 19.2 Embedding checks

Runtime-only check:

- Fork staged/downloaded `worker.js` in a clean utility process.
- Confirm initialize request can reach dependency-loading code.
- If the model is not cached and remote model download is not consented, use a dedicated worker `runtime-check` message that imports Transformers.js and reports versions without loading model weights.
- Validate process exits cleanly.

Full check:

- Initialize MiniLM from existing cache or after model consent.
- Embed one fixed short string.
- Require one vector of exactly 384 finite values.
- Require bounded completion.

### 19.3 Voice checks

Runtime-only check:

- Create scoped `require` from staged runtime root.
- Load `sherpa-onnx-node`.
- Verify `OfflineRecognizer`, `OfflineTts`, and `GenerationConfig` exports.

Full check:

- Initialize installed STT/TTS models through the voice worker.
- Do not capture microphone input.
- Optionally synthesize a short fixed phrase and validate non-empty finite PCM output.

### 19.4 Isolation

CI and production health checks must not accidentally resolve runtime dependencies from the repository or base application. CI temporarily moves or masks the root inference packages when verifying extracted archives.

## 20. LocalAiRuntimeModule

### 20.1 Responsibilities

The Module coordinates services and exposes renderer-facing use cases:

```typescript
export class LocalAiRuntimeModule {
  async listStatuses(): Promise<LocalAiRuntimeStatus[]>;
  async getStatus(runtimeId: LocalAiRuntimeId):
    Promise<LocalAiRuntimeStatus>;
  async prepareInstall(runtimeId: LocalAiRuntimeId):
    Promise<LocalAiRuntimeInstallOffer>;
  async install(input: LocalAiRuntimeInstallRequest):
    Promise<LocalAiRuntimeInstallResult>;
  cancelInstall(operationId: string): boolean;
  async checkForUpdate(runtimeId: LocalAiRuntimeId):
    Promise<LocalAiRuntimeUpdateOffer | null>;
  async repair(runtimeId: LocalAiRuntimeId):
    Promise<LocalAiRuntimeInstallResult>;
  async remove(input: LocalAiRuntimeRemoveRequest): Promise<void>;
}
```

### 20.2 Construction

The IPC registration composition root injects:

- Runtime root based on `app.getPath("userData")`
- `app.getVersion()`
- `process.platform`
- `process.arch`
- `process.versions.electron`
- `process.versions.modules`
- Catalog source configuration
- BrowserWindow progress publisher
- Voice and embedding worker lifecycle adapters

Services remain Electron-free where practical, which keeps unit tests independent of Electron.

### 20.3 AI enable gate

Installing or managing a first-party local runtime is a local component-management operation, not a hosted AI request. Runtime status/install/remove IPC handlers use `registerValidatedHandler`, not `registerAiValidatedHandler`.

The existing AI enable gate remains required for hosted AI IPC work. Local embedding entitlement behavior remains governed by its existing product policy; runtime installation itself does not call hosted AI.

## 21. IPC Design

### 21.1 Channels

Add to `src/config/channellist.ts`:

```typescript
export const LOCAL_AI_RUNTIME_LIST = "local-ai-runtime:list";
export const LOCAL_AI_RUNTIME_STATUS = "local-ai-runtime:status";
export const LOCAL_AI_RUNTIME_PREPARE_INSTALL =
  "local-ai-runtime:prepare-install";
export const LOCAL_AI_RUNTIME_INSTALL = "local-ai-runtime:install";
export const LOCAL_AI_RUNTIME_CANCEL_INSTALL =
  "local-ai-runtime:cancel-install";
export const LOCAL_AI_RUNTIME_CHECK_UPDATE =
  "local-ai-runtime:check-update";
export const LOCAL_AI_RUNTIME_REPAIR = "local-ai-runtime:repair";
export const LOCAL_AI_RUNTIME_REMOVE = "local-ai-runtime:remove";
export const LOCAL_AI_RUNTIME_PROGRESS = "local-ai-runtime:progress";
```

Add invoke channels to the preload invoke allowlist and the progress channel to receive/removeListener allowlists.

### 21.2 Handler registration

```typescript
export function registerLocalAiRuntimeIpcHandlers(
  getWindow: () => BrowserWindow | null
): void {
  registerValidatedHandler(
    LOCAL_AI_RUNTIME_STATUS,
    runtimeStatusInputSchema,
    async (input) => getRuntimeModule(getWindow).getStatus(input.runtimeId)
  );

  registerValidatedHandler(
    LOCAL_AI_RUNTIME_INSTALL,
    runtimeInstallInputSchema,
    async (input) => getRuntimeModule(getWindow).install(input)
  );
}
```

All channels return the existing `CommonMessage<T>` envelope.

### 21.3 Progress publishing

`prepareInstall` returns an operation ID before installation starts. The subsequent install invocation may await final completion while emitting progress because the renderer already knows the operation ID and can invoke cancellation concurrently.

Offer contract:

```typescript
export interface LocalAiRuntimeInstallOffer {
  operationId: string;
  runtimeId: LocalAiRuntimeId;
  runtimeVersion: string;
  archiveSizeBytes: number;
  installedSizeBytes: number;
  consentToken: string;
  expiresAt: string;
}
```

Publish progress only to non-destroyed application windows. Renderer APIs register and remove listeners with stable wrapper references, following the existing voice download pattern.

### 21.4 Renderer API

Create `src/views/api/localAiRuntime.ts`:

```typescript
export function listLocalAiRuntimes():
  Promise<LocalAiRuntimeStatus[]>;
export function prepareLocalAiRuntimeInstall(
  runtimeId: LocalAiRuntimeId
): Promise<LocalAiRuntimeInstallOffer>;
export function installLocalAiRuntime(
  input: LocalAiRuntimeInstallRequest
): Promise<LocalAiRuntimeInstallResult>;
export function cancelLocalAiRuntimeInstall(
  operationId: string
): Promise<{ cancelled: boolean }>;
export function onLocalAiRuntimeProgress(
  callback: (progress: LocalAiRuntimeDownloadProgress) => void
): () => void;
```

## 22. Renderer Design

### 22.1 Settings location

Add `LocalAiComponentsPanel.vue` under System Settings. It may be a section in the existing AI Provider page initially, but the component should remain independent because it manages executable components, not provider credentials.

### 22.2 Component state

```typescript
interface RuntimeRowView {
  runtimeId: LocalAiRuntimeId;
  title: string;
  description: string;
  status: LocalAiRuntimeStatus;
  progress?: LocalAiRuntimeDownloadProgress;
  busy: boolean;
}
```

Use:

- Icon buttons for refresh, repair, and remove with tooltips.
- Text/icon action for Install because it is a clear command with size context.
- Progress bar with bytes and phase.
- Confirmation dialog before install/remove.
- Separate controls for runtime and model storage.

Do not nest the panel inside decorative cards if the settings page already provides section framing.

### 22.3 Feature integration

Knowledge Library:

- Selecting local Xenova checks runtime status.
- Missing runtime opens install confirmation.
- Cancel restores previous model.
- Completion refreshes model availability.

AiChat voice:

- Microphone action checks runtime status before model status.
- Missing runtime opens runtime install.
- Runtime completion proceeds to existing model install flow.
- Runtime and model progress remain distinct.

### 22.4 Required translation groups

```text
localAiRuntime.title
localAiRuntime.embedding_title
localAiRuntime.voice_title
localAiRuntime.not_installed
localAiRuntime.ready
localAiRuntime.incompatible
localAiRuntime.corrupted
localAiRuntime.install
localAiRuntime.repair
localAiRuntime.remove
localAiRuntime.check_update
localAiRuntime.download_size
localAiRuntime.installed_size
localAiRuntime.downloading
localAiRuntime.verifying
localAiRuntime.extracting
localAiRuntime.testing
localAiRuntime.activating
localAiRuntime.cancel
localAiRuntime.retry
localAiRuntime.remove_models
localAiRuntime.errors.*
```

Add every key to English, Chinese, Spanish, French, German, and Japanese files in the same implementation commit as the UI.

## 23. Runtime Package Construction

### 23.1 Build script interface

```text
node scripts/build-local-ai-runtime.mjs \
  --runtime embedding-xenova \
  --runtime-version 1.0.0 \
  --platform win32 \
  --arch x64 \
  --electron-version <resolved> \
  --node-module-abi <resolved> \
  --output out/local-ai-runtimes
```

The script fails on unknown runtime ID, host/target mismatch, missing dependencies, missing worker output, or unexpected platform packages.

### 23.2 Dependency closure

The script starts from explicit roots:

Embedding:

```text
@xenova/transformers
onnxruntime-node
onnxruntime-common
sharp
```

Voice:

```text
sherpa-onnx-node
sherpa-onnx-<target-platform-arch>
```

For each root, recursively resolve `dependencies` and only compatible `optionalDependencies` from the installed lockfile-backed `node_modules`. Copy package directories while preserving package-relative paths.

Do not include:

- `devDependencies`
- Tests and fixtures
- Source maps unless needed for support builds
- Markdown documentation except required licenses
- Build caches
- `.git` or package-manager caches
- Native packages for unrelated OS/architecture targets

After pruning, run isolated verification. Pruning must never be accepted solely because the archive was created successfully.

### 23.3 Embedding worker build

Run the local embedding Vite config in production mode and copy:

```text
dist/childprocess/LocalEmbeddingWorker.js -> <staging>/worker.js
```

Do not ship `LocalEmbeddingWorker.js.map` in normal runtime packages. Upload source maps as private CI artifacts when needed for diagnostics.

### 23.4 Package root file

Each runtime contains a minimal package file:

```json
{
  "name": "@aifetchly/runtime-voice-sherpa",
  "private": true,
  "version": "1.0.0",
  "type": "commonjs"
}
```

This file gives `createRequire()` a stable absolute base. It is not published to npm.

### 23.5 Deterministic ZIP

The build script must:

- Sort paths lexicographically.
- Normalize separators to `/`.
- Use one fixed timestamp derived from `SOURCE_DATE_EPOCH` or commit time.
- Use deterministic compression settings.
- Exclude host-specific absolute paths and ownership metadata.
- Generate SHA-256 after closing the archive.

Unsigned archives built from the same source, lockfile, target, toolchain, and `SOURCE_DATE_EPOCH` should produce identical hashes. macOS release signing may add trusted timestamps, so final signed archives are not required to be byte-for-byte identical across separate signing runs. Their dependency inventory, manifest identity, target, and pre-sign build inputs must remain reproducible, and the catalog must hash the final signed archive bytes.

### 23.6 Build metadata

The manifest records:

- Git commit SHA
- GitHub workflow run ID
- Resolved Electron version
- Generated Node ABI
- Runtime dependency versions
- Target platform and architecture
- Build timestamp

No secrets or local paths are written to the package.

## 24. Runtime Verification Script

### 24.1 Command

```text
node scripts/verify-local-ai-runtime.mjs \
  --archive <path> \
  --platform <platform> \
  --arch <arch> \
  --electron-version <version> \
  --node-module-abi <abi>
```

### 24.2 Checks

The script must verify:

1. Archive filename contract.
2. ZIP entry safety and limits.
3. Internal manifest schema.
4. Required files.
5. Exact target identity.
6. Dependency package versions.
7. No unrelated sherpa platform package.
8. No unrelated ONNX/Sharp native target artifacts.
9. No absolute build paths in text metadata.
10. Runtime load from a clean extraction root.
11. Runtime load remains successful when repository inference dependencies are unavailable.
12. License/notice inventory exists.
13. Compressed and expanded sizes are reported.

### 24.3 Native smoke test

Run the smoke test with the Electron binary used by the application, not plain Node, when native ABI matters:

```text
electron scripts/smoke-local-ai-runtime.cjs <runtime-root>
```

The script prints machine-readable JSON and exits nonzero on failure.

## 25. GitHub Actions Design

### 25.0 Trigger and permission model

The workflow may remain manually triggered. Runtime packaging is considered automated when GitHub Actions performs every build, verification, checksum, catalog, and optional release-upload step without a developer assembling archives locally.

Recommended dispatch shape:

```yaml
on:
  workflow_dispatch:
    inputs:
      publish_release:
        description: Publish verified artifacts as a GitHub Release
        type: boolean
        required: true
        default: false

permissions:
  contents: read
```

Build and verification jobs remain read-only. Only the conditional release job receives `contents: write`, and only when `publish_release` is true. A build-only run uploads workflow artifacts but does not emit a production catalog containing URLs for a release that does not exist.

### 25.1 Shared version job

Compute release metadata once:

```yaml
jobs:
  release-metadata:
    runs-on: ubuntu-latest
    outputs:
      app_version: ${{ steps.meta.outputs.app_version }}
      release_tag: ${{ steps.meta.outputs.release_tag }}
      runtime_version: ${{ steps.meta.outputs.runtime_version }}
    steps:
      - uses: actions/checkout@v4
      - id: meta
        shell: bash
        run: node scripts/release-metadata.mjs >> "$GITHUB_OUTPUT"
```

All app and runtime jobs consume these outputs. Do not independently rewrite `package.json` with potentially divergent versions.

### 25.2 Runtime matrix

Runner labels are repository/release-infrastructure choices and must be verified before implementation. The logical matrix is:

```yaml
strategy:
  fail-fast: false
  matrix:
    include:
      - platform: win32
        arch: x64
        runner: <approved-windows-x64-runner>
      - platform: darwin
        arch: x64
        runner: <approved-macos-x64-runner>
      - platform: darwin
        arch: arm64
        runner: <approved-macos-arm64-runner>
```

Each target builds both runtime IDs. Splitting runtime IDs into another matrix dimension is acceptable if build duration or retry isolation warrants six jobs.

### 25.3 Runtime build job skeleton

```yaml
build-local-ai-runtimes:
  needs: release-metadata
  strategy:
    fail-fast: false
    matrix:
      include: <target-matrix>
  runs-on: ${{ matrix.runner }}
  permissions:
    contents: read
  steps:
    - uses: actions/checkout@v4

    - uses: actions/setup-node@v4
      with:
        node-version: 22.14.0
        cache: yarn

    - run: yarn install --frozen-lockfile

    - name: Resolve Electron build metadata
      shell: bash
      run: node scripts/resolve-electron-build-metadata.mjs >> "$GITHUB_ENV"

    - name: Build embedding runtime
      shell: bash
      run: >-
        node scripts/build-local-ai-runtime.mjs
        --runtime embedding-xenova
        --runtime-version "${{ needs.release-metadata.outputs.runtime_version }}"
        --platform "${{ matrix.platform }}"
        --arch "${{ matrix.arch }}"
        --electron-version "$ELECTRON_VERSION"
        --node-module-abi "$ELECTRON_MODULE_ABI"
        --output out/local-ai-runtimes

    - name: Build voice runtime
      shell: bash
      run: >-
        node scripts/build-local-ai-runtime.mjs
        --runtime voice-sherpa
        --runtime-version "${{ needs.release-metadata.outputs.runtime_version }}"
        --platform "${{ matrix.platform }}"
        --arch "${{ matrix.arch }}"
        --electron-version "$ELECTRON_VERSION"
        --node-module-abi "$ELECTRON_MODULE_ABI"
        --output out/local-ai-runtimes

    - name: Verify runtime archives
      shell: bash
      run: node scripts/verify-local-ai-runtime-set.mjs out/local-ai-runtimes

    - uses: actions/upload-artifact@v4
      with:
        name: local-ai-runtimes-${{ matrix.platform }}-${{ matrix.arch }}
        path: |
          out/local-ai-runtimes/*.zip
          out/local-ai-runtimes/*.metadata.json
        if-no-files-found: error
```

### 25.4 Electron metadata

Resolve Electron version from the installed package:

```javascript
const electronPackage = require("electron/package.json");
```

Resolve ABI by executing the installed Electron binary in the target environment and printing `process.versions.modules`. The script must fail if the reported Electron version differs from the installed package version.

Remove hard-coded Electron targets such as `35.7.5` once the shared resolver is in place.

### 25.5 Catalog job

```yaml
generate-runtime-catalog:
  needs:
    - release-metadata
    - build-local-ai-runtimes
  runs-on: ubuntu-latest
  permissions:
    contents: read
  steps:
    - uses: actions/checkout@v4
    - uses: actions/download-artifact@v4
      with:
        pattern: local-ai-runtimes-*
        path: runtime-assets
        merge-multiple: true
    - run: >-
        node scripts/generate-local-ai-runtime-catalog.mjs
        --input runtime-assets
        --release-tag "${{ needs.release-metadata.outputs.release_tag }}"
        --repository "${{ github.repository }}"
        --output runtime-assets/local-ai-runtimes.json
    - run: node scripts/verify-local-ai-runtime-catalog.mjs runtime-assets
    - uses: actions/upload-artifact@v4
      with:
        name: local-ai-runtime-release-assets
        path: runtime-assets
        if-no-files-found: error
```

For a publishing run, the generator derives immutable GitHub Release URLs from release tag and filenames. Private distribution builds use an update-server base URL input instead. A build-only run generates and validates package metadata but either omits the production catalog or marks it as a non-publishable candidate with no production download URLs.

### 25.6 macOS signing gate

For macOS runtime packages:

1. Enumerate `.node`, `.dylib`, and executable Mach-O files.
2. Sign nested native files with the same Team ID/policy required by the host app.
3. Verify signatures with `codesign --verify --deep --strict` where applicable.
4. Build the runtime archive after signing.
5. Install the archive through the production runtime manager in a signed/notarized app test.

Do not expose signing secrets to untrusted pull requests. If production signing is unavailable in normal CI, unsigned pull-request jobs run structural tests while protected release jobs run signing and final native smoke tests.

### 25.7 Release job

The release job downloads:

- Selected Windows installer/updater files
- Selected macOS installer/update files
- `local-ai-runtime-release-assets`

It verifies the final allowlist and publishes only expected patterns. It must not recursively publish every file under all `out/make` directories.

The job condition and permission boundary are explicit:

```yaml
if: ${{ inputs.publish_release }}
permissions:
  contents: write
```

Expected runtime assets:

```text
embedding-runtime-win32-x64-<version>.zip
embedding-runtime-darwin-x64-<version>.zip
embedding-runtime-darwin-arm64-<version>.zip
voice-runtime-win32-x64-<version>.zip
voice-runtime-darwin-x64-<version>.zip
voice-runtime-darwin-arm64-<version>.zip
local-ai-runtimes.json
local-ai-runtimes.json.sha256
```

### 25.8 Job summary

Publish a table to `$GITHUB_STEP_SUMMARY`:

| Asset | Platform | Architecture | Compressed | Expanded | SHA-256 prefix |
| --- | --- | --- | ---: | ---: | --- |

Include base installer sizes and percentage change from a checked-in or release-fetched baseline.

## 26. Forge and Dependency Changes

### 26.1 Migration sequence

Do not remove runtime packages from Forge before downloaded resolution passes on all targets.

Final `EXTERNAL_DEPENDENCIES` removals:

```text
@xenova/transformers
onnxruntime-node
onnxruntime-common
sharp (after confirming no other base feature imports it)
sherpa-onnx-node
```

Final ASAR unpack removals include all inference and sherpa platform package paths. Keep:

```text
better-sqlite3
sqlite-vec
required vec0 native artifacts
other independently required native dependencies
```

### 26.2 Package dependency placement

Inference packages remain available to CI runtime builds. Options:

1. Keep them in `dependencies` but ensure Forge's explicit packaging allowlist excludes them.
2. Move them to `devDependencies` after confirming production runtime build jobs install dev dependencies.
3. Create a workspace/package dedicated to runtime builds in a later cleanup.

Recommended v1: keep current dependency placement while changing Forge packaging. This minimizes lockfile and local-development disruption. Move them to a dedicated build workspace after runtime delivery stabilizes.

### 26.3 Sharp audit

Before excluding `sharp`, run a complete import/require audit outside Transformers.js. If another base feature uses Sharp directly, keep one base copy and ensure the embedding runtime does not rely on resolving that base copy.

### 26.4 Base package verification

`verify-base-package-exclusions.mjs` inspects packaged application files/ASAR and fails if forbidden runtime dependency paths exist. String references in source maps do not count if source maps are not shipped; actual package files do.

## 27. Security Design

### 27.1 Trust boundaries

```text
Renderer input              untrusted -> Zod IPC validation
Catalog response            untrusted -> size/schema/origin validation
Archive bytes               untrusted -> SHA-256 and ZIP validation
Internal manifest           untrusted -> schema + catalog comparison
Extracted files             untrusted -> path/type/size/required-file checks
Staged runtime              untrusted -> native/worker health check
Active version              trusted for execution after all gates pass
```

### 27.2 Catalog authenticity

V1 minimum:

- Catalog fetched over HTTPS from a compiled/configured trusted origin.
- Runtime URLs constrained to approved hosts.
- Every archive hash comes from the validated catalog.
- Catalog checksum published for release auditing.

Recommended hardening:

- Sign canonical catalog bytes with Ed25519 in protected release CI.
- Embed only the public verification key in AiFetchly.
- Publish `local-ai-runtimes.json.sig`.
- Verify signature before accepting catalog entries.
- Support key rotation through a versioned trusted-key set.

A catalog checksum next to the catalog detects accidental corruption but does not authenticate a compromised origin. It is not a substitute for a signature.

### 27.3 Archive attack controls

Protect against:

- Zip Slip/path traversal
- Zip bombs
- Duplicate path confusion
- Symlink and hard-link escapes
- Windows device paths
- Oversized files and archives
- Incomplete/corrupt archives
- Manifest/catalog identity mismatch
- Dependency substitution
- Cross-platform binary substitution

### 27.4 Runtime execution policy

- Only compiled runtime IDs are accepted.
- Entry point/module names must match runtime-specific policy, not merely catalog strings.
- Environment passed to workers is explicitly constructed.
- Clear `NODE_OPTIONS`.
- Do not inherit secrets unrelated to inference where practical.
- Workers cannot access database APIs through application imports.
- Runtime paths never reach renderer code.

### 27.5 Logging

Logs may include runtime ID/version, target, phase, byte counts, HTTP status, checksum prefix, manifest error, and worker exit code.

Logs must redact URL query strings and must not include document text, vectors, audio, transcripts, tokens, cookies, or signing material.

## 28. Failure and Recovery Matrix

| Failure | Detection | State | Recovery |
| --- | --- | --- | --- |
| No catalog network | Fetch timeout/error | Installed runtime unchanged | Use installed runtime; retry update later |
| Catalog schema invalid | Zod failure | `error` for install/update | Keep cache only if previously valid and unexpired |
| No matching target | Compatibility selection | `incompatible` | Offer remote feature; await compatible release |
| User cancels | AbortSignal | `not_installed` or previous state | Delete partial/staging data |
| Disk full | Write/extract error | `error` | Clean staging; show required space |
| SHA mismatch | Final hash compare | `corrupted`/install error | Delete archive; no automatic repeated retry |
| Unsafe ZIP | Entry validation | install error | Delete staging; security diagnostic |
| Required file missing | Post-extract check | `corrupted` | Repair/re-download |
| Runtime smoke test fails | Health service | `error` | Keep previous active runtime |
| Active pointer write fails | Atomic write error | Previous runtime active | Remove inactive new version later |
| Worker crashes | Client exit handler | Runtime remains installed | Reject requests; bounded restart |
| ABI changes after app update | Local reconciliation | `incompatible` | Offer compatible runtime update |
| Remove hits locked file | Filesystem error | State remains truthful | Restart app and retry |

## 29. Diagnostics and Observability

### 29.1 Diagnostic snapshot

Extend the diagnostics report with sanitized data:

```typescript
export interface LocalAiRuntimeDiagnosticEntry {
  runtimeId: LocalAiRuntimeId;
  state: LocalAiRuntimeState;
  installedVersion?: string;
  platform: string;
  arch: string;
  electronVersion: string;
  nodeModuleAbi: string;
  manifestValid: boolean;
  requiredFilesPresent: boolean;
  lastVerifiedAt?: string;
  lastErrorCode?: LocalAiRuntimeErrorCode;
  lastErrorMessage?: string;
}
```

Do not include install paths in user-uploaded diagnostics unless they are normalized to placeholders such as `<userData>/local-ai-runtimes/...`.

### 29.2 Local log events

Use stable event names:

```text
local_ai_runtime.catalog.fetch_started
local_ai_runtime.catalog.fetch_completed
local_ai_runtime.install_started
local_ai_runtime.download_completed
local_ai_runtime.integrity_failed
local_ai_runtime.health_completed
local_ai_runtime.activated
local_ai_runtime.rollback_completed
local_ai_runtime.remove_completed
```

Do not add remote telemetry without existing telemetry consent.

## 30. Test Design

### 30.1 Unit test files

```text
test/vitest/main/service/LocalAiRuntimeCatalogService.test.ts
test/vitest/main/service/LocalAiRuntimeCompatibilityService.test.ts
test/vitest/main/service/LocalAiRuntimeDownloadService.test.ts
test/vitest/main/service/LocalAiRuntimeExtractor.test.ts
test/vitest/main/service/LocalAiRuntimePathService.test.ts
test/vitest/main/service/LocalAiRuntimeResolver.test.ts
test/vitest/main/service/LocalAiRuntimeStateStore.test.ts
test/vitest/main/service/LocalAiRuntimeHealthService.test.ts
test/vitest/main/modules/LocalAiRuntimeModule.test.ts
test/vitest/main/ipc/local-ai-runtime-ipc.test.ts
test/vitest/main/i18n/localAiRuntime.i18n.parity.test.ts
```

### 30.2 Catalog tests

- Reject unknown schema version.
- Reject unknown runtime ID.
- Reject duplicate target/version entry.
- Reject non-HTTPS production URL.
- Reject invalid SHA-256.
- Reject invalid semver range.
- Select highest exact platform/architecture/ABI match.
- Never fall back to another architecture.
- Use valid cache offline.
- Do not replace valid cache with invalid response.

### 30.3 Download tests

- Stream successful response and calculate checksum.
- Enforce redirect limit.
- Reject redirect to disallowed host.
- Reject content-length above local limit before body download.
- Reject streamed body above limit when content-length is missing/wrong.
- Handle backpressure.
- Throttle progress.
- Cancel and delete partial file.
- Timeout stalled response.
- Redact query string in error logs.

### 30.4 Extraction tests

- Reject `../file`, absolute path, drive path, UNC path, and NUL.
- Reject symlink/hard link/device entries.
- Reject duplicate normalized paths.
- Reject too many entries.
- Reject oversized single and aggregate output.
- Reject package missing manifest.
- Reject catalog/manifest mismatch.
- Reject missing required file.
- Extract valid package with bounded memory.

### 30.5 Activation tests

- Previous active pointer survives download failure.
- Previous active pointer survives extraction failure.
- Previous active pointer survives health failure.
- Crash point after version rename but before pointer write is recoverable.
- Atomic pointer update records previous version.
- Concurrent same-runtime install returns busy.
- Cancel releases operation lock.
- Leased runtime cannot be removed.
- Valid previous runtime can roll back.

### 30.6 Worker integration tests

Voice:

- Scoped loader resolves only from supplied runtime root.
- Missing runtime returns unavailable.
- Bundled root is not consulted after migration flag removal.
- Worker lease releases on exit/dispose.

Embedding:

- Client forks downloaded worker path.
- Worker resolves Transformers.js from colocated runtime.
- Root project `node_modules` is unavailable during test.
- Existing initialize/embed/crash/timeout behavior remains.

### 30.7 Renderer tests

- Install offer displays both runtime and model sizes correctly.
- Cancel restores previous embedding model selection.
- Voice distinguishes missing runtime from missing model.
- Progress listeners are removed on unmount.
- Repair/remove confirmations behave correctly.
- All six translation files contain every runtime key.

### 30.8 CI tests

- Six archives are present.
- Catalog contains six unique v1 targets.
- Every archive checksum matches catalog.
- Every archive loads on target runner.
- No unrelated native platform package exists.
- Base package excludes runtime dependencies after migration.
- Size summary and baseline comparison are present.

## 31. Implementation Plan

### Phase 1: Contracts and local state

Files:

```text
src/entityTypes/localAiRuntimeTypes.ts
src/schemas/localAiRuntime.ts
src/schemas/ipc/localAiRuntime.ts
src/service/localAiRuntime/LocalAiRuntimePathService.ts
src/service/localAiRuntime/LocalAiRuntimeStateStore.ts
src/service/localAiRuntime/LocalAiRuntimeCompatibilityService.ts
```

Deliverables:

- Strict types without `any`
- Zod schemas
- Path containment
- Atomic active state
- Compatibility tests

### Phase 2: Build and release artifacts

Files:

```text
scripts/build-local-ai-runtime.mjs
scripts/verify-local-ai-runtime.mjs
scripts/generate-local-ai-runtime-catalog.mjs
.github/workflows/release.yml
package.json
yarn.lock
```

Deliverables:

- Six prerelease runtime archives
- Manifests, hashes, license inventory, and catalog
- Target-runner smoke tests
- No base installer exclusions yet

### Phase 3: Runtime installer

Files:

```text
src/service/localAiRuntime/LocalAiRuntimeCatalogService.ts
src/service/localAiRuntime/LocalAiRuntimeDownloadService.ts
src/service/localAiRuntime/LocalAiRuntimeExtractor.ts
src/service/localAiRuntime/LocalAiRuntimeHealthService.ts
src/service/localAiRuntime/LocalAiRuntimeOperationCoordinator.ts
src/service/localAiRuntime/LocalAiRuntimeResolver.ts
src/modules/LocalAiRuntimeModule.ts
```

Deliverables:

- Prepare/install/cancel/update/repair/remove
- Integrity and safe extraction
- Health and rollback
- Service/module tests

### Phase 4: IPC and UI

Files:

```text
src/config/channellist.ts
src/preload.ts
src/main-process/communication/local-ai-runtime-ipc.ts
src/main-process/communication/index.ts
src/views/api/localAiRuntime.ts
src/views/components/settings/LocalAiComponentsPanel.vue
src/views/pages/systemsetting/ai_provider.vue
src/views/lang/{en,zh,es,fr,de,ja}.ts
```

Deliverables:

- Typed IPC
- Consent offer
- Progress/cancel
- Runtime management settings
- Complete i18n

### Phase 5: Voice pilot

Files:

```text
src/service/aiChatVoice/SherpaOnnxNative.ts
src/service/aiChatVoice/SherpaVoiceWorkerClient.ts
src/childprocess/ai-chat-voice/AiChatVoiceWorkerTypes.ts
src/childprocess/ai-chat-voice/voiceServices.ts
src/modules/AiChatVoiceModule.ts
src/views/components/settings/AiChatVoiceSettingsPanel.vue
```

Deliverables:

- Explicit voice runtime root
- Runtime lease
- Runtime/model state distinction
- Signed/notarized target tests
- Temporary bundled fallback

### Phase 6: Embedding integration

Files:

```text
src/service/embedding/LocalEmbeddingWorkerClient.ts
src/service/embedding/EmbeddingModelCatalogService.ts
src/modules/RagSearchModule.ts
src/views/pages/knowledge/KnowledgeLibrary.vue
src/views/pages/knowledge/DocumentManagement.vue
```

Deliverables:

- Downloaded worker resolution
- Runtime consent on local model selection
- No implicit fallback downloads
- Existing vector compatibility tests

### Phase 7: Slim installer

Files:

```text
forge.config.js
scripts/verify-base-package-exclusions.mjs
.github/workflows/release.yml
```

Deliverables:

- Remove local AI dependency trees from base package
- Remove bundled embedding worker
- Remove migration fallback after beta
- Installer size regression gate

## 32. Migration and Compatibility

### 32.1 Existing users

Existing model files remain in their current locations. The first slim application release checks for a downloaded runtime; if absent, it may use the temporary bundled fallback only when that release still contains it.

The next release removes bundled runtimes after runtime download reliability is proven. Users selecting local features then receive the install offer.

### 32.2 Existing embedding indexes

No migration is needed. The runtime still uses:

```text
local-xenova:Xenova/all-MiniLM-L6-v2
dimensions: 384
mean pooling
L2 normalization
```

Health tests must verify these values before base runtime removal.

### 32.3 App/Electron upgrades

On application version change:

1. Resolve active manifests locally.
2. Compare new app version and ABI.
3. Keep compatible runtimes active.
4. Mark incompatible runtimes without attempting to load native modules.
5. Offer a catalog update after explicit user action or non-blocking background check.

Remote features remain available while local components are incompatible.

## 33. Operational Release Runbook

Before enabling runtime assets in a production release:

1. Confirm all target jobs passed on native target runners.
2. Confirm runtime archive hashes match catalog.
3. Confirm release URLs are immutable and accessible without embedded repository credentials.
4. Confirm macOS native files are signed and tested from the notarized app.
5. Confirm base installers contain required database natives and exclude optional local AI runtimes.
6. Compare installer sizes with baseline.
7. Install each runtime through the production UI on a clean machine/profile.
8. Restart offline and run one local embedding and one voice operation.
9. Test cancellation, repair, update, rollback, and removal.
10. Publish release only after the final asset allowlist passes.

If a published runtime is defective:

- Do not overwrite the release asset in place.
- Publish a new runtime version and catalog/release.
- Keep previous known-good catalog compatibility where safe.
- Document the affected app/Electron target.

## 34. Deferred Enhancements

- Ed25519 catalog signatures and key rotation
- Resumable range downloads
- Delta runtime updates
- Enterprise offline ZIP import
- Linux x64/arm64 runtime packages
- Regional CDN mirrors
- Automatic updates under a separate user preference
- Dedicated runtime build workspace
- Lite and Full installer variants
- Runtime usage telemetry under explicit consent

## 35. Open Technical Decisions

1. Confirm production artifact hosting: public GitHub Releases or update-server storage.
2. Select verified macOS x64 and arm64 runner labels available to the repository.
3. Complete a hardened-runtime feasibility spike for downloaded `.node` and `.dylib` files.
4. Decide whether Ed25519 catalog signatures are required for v1 or the first hardening release.
5. Confirm direct `sharp` usage outside the embedding dependency tree.
6. Select exact ZIP libraries and pin reviewed versions after dependency/security review.
7. Decide the runtime catalog cache TTL and update-check cadence after release operational testing.
8. Decide whether one combined runtime+model consent dialog is preferable to sequential consent.
9. Define the production package size baseline and failure threshold after measuring current release artifacts.

## 36. PRD Acceptance Mapping

| PRD area | Technical implementation |
| --- | --- |
| Automated six-package publishing | Shared version job, target runtime matrix, catalog job, release allowlist |
| Runtime/model separation | Runtime package layouts and unchanged model directories |
| User consent | Prepare/install two-step contract with expiring consent token |
| Integrity | Trusted origin, streamed SHA-256, strict manifest comparison |
| Safe installation | Streaming ZIP policy, staging root, health check, atomic active pointer |
| Compatibility | Exact platform/arch/ABI and app semver selection |
| Voice loading | Bundled worker plus scoped `createRequire(runtimeRoot)` |
| Embedding loading | Downloaded worker entry point with colocated dependencies |
| No worker database access | Existing worker boundary preserved and tested |
| No hidden fallback download | Explicit local-components-required error from RAG flow |
| Update/repair/rollback/remove | Side-by-side versions, operation locks, leases, atomic state |
| Offline operation | Local-first resolver and catalog-independent active runtime |
| macOS production behavior | Protected signing job and notarized-host integration test |
| Installer reduction | Forge exclusions and base package verification script |
| i18n | Local AI runtime translation group in six language files |

## 37. Related Documents and Code

- `docs/prd/downloadable-local-ai-runtimes-prd.md`
- `docs/prd/local-xenova-embedding-model-prd.md`
- `docs/prd/local-xenova-embedding-model-technical-design.md`
- `docs/prd/local-sherpa-onnx-voice-chat-prd.md`
- `docs/prd/local-sherpa-onnx-voice-chat-technical-design.md`
- `.github/workflows/release.yml`
- `forge.config.js`
- `vite.localEmbeddingWorker.config.mjs`
- `vite.aiChatVoiceWorker.config.mjs`
- `src/childprocess/embedding/LocalEmbeddingWorker.ts`
- `src/service/embedding/LocalEmbeddingWorkerClient.ts`
- `src/childprocess/ai-chat-voice/AiChatVoiceWorker.ts`
- `src/childprocess/ai-chat-voice/voiceServices.ts`
- `src/service/aiChatVoice/SherpaOnnxNative.ts`
- `src/service/aiChatVoice/SherpaVoiceWorkerClient.ts`
- `src/service/aiChatVoice/VoiceModelCatalogService.ts`
- `src/service/aiChatVoice/VoiceModelDownloadService.ts`
- `src/modules/AiChatVoiceModule.ts`
- `src/main-process/communication/ai-chat-v2-voice-ipc.ts`
