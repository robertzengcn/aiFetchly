# Downloadable Local AI Runtimes - Product Requirements Document

## Document Information

| Field | Value |
| --- | --- |
| Document version | v1.0 |
| Status | Proposed |
| Created | 2026-07-30 |
| Owner | AiFetchly engineering |
| Product areas | Desktop release, local embedding, local voice, runtime management |
| Target platforms | Windows x64, macOS x64, macOS arm64 |
| Related PRDs | `local-xenova-embedding-model-prd.md`, `local-sherpa-onnx-voice-chat-prd.md` |
| Primary release workflow | `.github/workflows/release.yml` |

## 1. Summary

AiFetchly currently includes local AI inference engines in every Windows and macOS installer, even when a user only uses hosted AI services. These engines contain large JavaScript, WebAssembly, native Node, ONNX Runtime, image-processing, and platform-specific binary files. They increase download time, installation time, disk use, release upload time, and update bandwidth for every user.

AiFetchly should move the optional local embedding and local voice inference engines into versioned runtime packages that are built and published automatically by GitHub Actions. The base application will download a compatible runtime only after the user chooses a local feature and consents to the stated download size.

The runtime packages are separate from model files:

| Layer | Embedding | Voice | Distribution policy |
| --- | --- | --- | --- |
| Base application | Provider interfaces, IPC contracts, runtime manager, UI | Voice controls, IPC contracts, runtime manager, UI | Included in every installer |
| Inference runtime | Transformers.js, ONNX Runtime, Sharp, compiled embedding worker | sherpa-onnx Node package and one platform binary | Downloaded once on demand |
| Model data | MiniLM model/tokenizer files | Whisper and Piper/VITS model files | Downloaded on demand and cached |

GitHub Actions must produce, validate, checksum, and publish the following release assets without manual packaging:

```text
embedding-runtime-win32-x64-<runtime-version>.zip
embedding-runtime-darwin-x64-<runtime-version>.zip
embedding-runtime-darwin-arm64-<runtime-version>.zip

voice-runtime-win32-x64-<runtime-version>.zip
voice-runtime-darwin-x64-<runtime-version>.zip
voice-runtime-darwin-arm64-<runtime-version>.zip

local-ai-runtimes.json
local-ai-runtimes.json.sha256
```

The application must never run `npm install` or compile native dependencies on an end user's machine. Runtime archives must be immutable, prebuilt release artifacts created by trusted CI jobs.

## 2. Problem

### 2.1 Every user pays for optional features

The Forge package configuration currently keeps and unpacks these dependencies in the application bundle:

- `@xenova/transformers`
- `onnxruntime-node`
- `onnxruntime-common`
- `sharp`
- `sherpa-onnx-node`
- sherpa-onnx platform packages for macOS, Windows, and Linux

Local measurements show that the embedding runtime dependencies alone occupy roughly 150 MB uncompressed. Native dependency compression varies, but the cost remains material in installers and installed application directories.

Users who never select local embedding or local voice receive no value from those files.

### 2.2 Runtime and model delivery are inconsistent

Voice model files are already downloaded with user consent into `userData/voice-models`. Embedding model files are already downloaded and cached by Transformers.js. However, the engines that execute those models are still permanently bundled.

This creates an incomplete optional-feature design:

```text
Current voice delivery
  Base installer: voice runtime
  First use:      voice model

Current embedding delivery
  Base installer: embedding runtime
  First use:      embedding model

Target delivery
  Base installer: feature integration only
  First use:      compatible runtime + selected model
```

### 2.3 Native dependencies have a compatibility lifecycle

Native Node modules may depend on:

- Operating system
- CPU architecture
- Electron version
- Node module ABI
- Native library linkage
- macOS signing and hardened-runtime behavior

A generic runtime ZIP is not safe. AiFetchly needs an explicit compatibility contract and separate artifacts for each supported target.

### 2.4 Manual runtime publishing would not scale

Building and uploading runtime archives by hand would be error-prone and difficult to reproduce. Runtime packaging must be part of the same automated release pipeline that produces the desktop installers.

## 3. Goals

1. Reduce the base Windows and macOS installer sizes by excluding optional local embedding and voice runtimes.
2. Build runtime packages automatically in GitHub Actions for each supported platform and architecture.
3. Publish runtime packages, checksums, and a runtime catalog as GitHub Release assets or to a configured release storage endpoint.
4. Download a runtime only after explicit user action and informed consent.
5. Verify platform, architecture, version compatibility, archive size, and SHA-256 before installation.
6. Install runtimes atomically into a versioned application-owned directory.
7. Load downloaded native dependencies and worker entry points from explicit absolute paths.
8. Preserve existing local embedding vector compatibility and local voice behavior.
9. Support runtime repair, update, rollback, and uninstall without reinstalling AiFetchly.
10. Keep remote AI features fully usable when local runtimes are absent or broken.
11. Ensure the release pipeline fails before publishing when a runtime archive is incomplete or cannot pass a smoke test.
12. Provide complete UI translations for English, Chinese, Spanish, French, German, and Japanese.

## 4. Non-Goals

1. Do not download or execute arbitrary npm packages at runtime.
2. Do not run `npm install`, `yarn install`, `node-gyp`, or a compiler on the user's machine.
3. Do not create a general-purpose third-party native plugin system in v1.
4. Do not move required database dependencies such as `better-sqlite3` or `sqlite-vec` out of the base installer.
5. Do not change the SQLite database format or the vector index format.
6. Do not combine voice and embedding into one mandatory runtime archive.
7. Do not silently download a runtime as part of remote embedding fallback.
8. Do not require a hosted AI entitlement merely to install or execute an already-supported local runtime.
9. Do not support Linux runtime packages in v1 unless a Linux desktop release is added to the production release workflow.
10. Do not guarantee that a runtime built for one Electron ABI works after an Electron major-version upgrade.
11. Do not delete user model caches automatically when uninstalling only a runtime.
12. Do not introduce a second database for runtime state; use a manifest on disk and existing settings where persistence is needed.

## 5. Definitions

| Term | Meaning |
| --- | --- |
| Base application | The AiFetchly installer and installed app without optional local AI engines. |
| Runtime | Executable code and native libraries needed to run one local AI capability. |
| Runtime package | A platform-specific, versioned ZIP containing one runtime and its manifest. |
| Model | Weights, tokenizer files, vocabulary files, or related data consumed by a runtime. |
| Runtime catalog | Signed-release metadata describing every downloadable runtime artifact. |
| Runtime ID | Stable capability identifier: `embedding-xenova` or `voice-sherpa`. |
| Runtime version | Version of AiFetchly's packaged runtime contract, independent of the app version. |
| Node module ABI | Native module ABI expected by the Electron runtime. |
| Active runtime | Installed runtime version currently selected after validation and health check. |
| Staged runtime | Downloaded/extracted version that has not yet passed activation checks. |
| Repair | Re-download and replace the same runtime version after corruption or missing files. |

## 6. Current State

### 6.1 Local embedding

The local embedding worker is registered as a Forge/Vite worker and statically imports `@xenova/transformers`. `LocalEmbeddingWorkerClient` resolves the compiled worker from locations inside the packaged application and starts it through Electron `utilityProcess.fork()`.

Transformers.js already supports configurable model cache directories, local model paths, offline mode, and remote model hosts. Model weights do not need to be added to the runtime package.

The current remote-to-local fallback may select the local Xenova model after remote embedding retries fail. Runtime separation must change this flow so missing local components never trigger a hidden large download.

### 6.2 Local voice

The local voice implementation dynamically loads `sherpa-onnx-node`, so it can already report that the native runtime is unavailable. Voice STT and TTS models are listed through `VoiceModelCatalogService` and downloaded into `app.getPath("userData")/voice-models` through `VoiceModelDownloadService`.

This is close to the target product behavior. The missing layer is installation and explicit path-based loading of the sherpa runtime itself.

### 6.3 Release workflow

The release workflow currently:

1. Runs on pushes to `master`.
2. Builds on `windows-latest` and `macos-latest`.
3. Installs all dependencies and rebuilds native modules.
4. Creates Windows and macOS installers.
5. Uploads complete `out/make` directories as workflow artifacts.
6. Downloads all build artifacts into a Linux release job.
7. Publishes every prepared file through `softprops/action-gh-release`.

The workflow does not currently build separate architecture-specific local AI runtime archives or a runtime catalog.

## 7. Product Principles

### 7.1 Optional means optional

The base application must start and provide remote embedding, remote chat, database, scraping, and non-local-voice features without either local AI runtime installed.

### 7.2 Ask before large downloads

The app must show the runtime and model download sizes before downloading. Consent for a runtime does not imply consent for every model.

### 7.3 Fail closed for executable content

If metadata, platform compatibility, checksum verification, extraction validation, or a health check fails, the runtime must not become active.

### 7.4 Keep runtime and model lifecycles separate

Updating the voice runtime must not force a 610 MB Whisper model to be downloaded again. Removing a model must not remove the runtime unless the user requests both.

### 7.5 Remote features remain a recovery path

A local runtime failure must not prevent remote AI operation. Error handling should explain that the local feature is unavailable while leaving remote choices usable.

## 8. Target Users and User Stories

### 8.1 Hosted-AI-only user

As a user who only uses hosted AI, I want a smaller installer and updates so that I do not download local inference engines I never use.

### 8.2 Local embedding user

As a knowledge-library user, I want to install local embedding when I choose the local model so that my documents can be embedded on-device.

### 8.3 Local voice user

As a voice-chat user, I want AiFetchly to install the compatible voice engine and selected speech model with clear progress so that local STT/TTS works without manual setup.

### 8.4 Offline user

As an offline user, I want AiFetchly to detect an already-installed runtime and model without contacting GitHub so that local functionality continues to work.

### 8.5 Release engineer

As a release engineer, I want GitHub Actions to build and verify runtime packages automatically so that releases are reproducible and do not require manual uploads.

### 8.6 Support engineer

As a support engineer, I want runtime diagnostics that identify version, platform, integrity, and loading failures without exposing user documents, transcripts, or audio.

## 9. Supported Targets

### 9.1 Version 1 matrix

| Platform | Architecture | Embedding runtime | Voice runtime | Requirement |
| --- | --- | --- | --- | --- |
| Windows | x64 | Required | Required | Release gate |
| macOS | x64 | Required | Required | Release gate |
| macOS | arm64 | Required | Required | Release gate |
| Windows | ia32 | Not supported | Not supported | Must show unsupported state |
| Linux | x64/arm64 | Deferred | Deferred | No catalog entry in v1 |

The CI configuration must use runner labels that actually provide the target architecture. Detecting the architecture of a single `macos-latest` runner is insufficient for producing both macOS artifacts.

### 9.2 Runtime package names

Package names must be deterministic:

```text
<runtime-id>-runtime-<platform>-<arch>-<runtime-version>.zip
```

Canonical v1 runtime IDs and filenames:

```text
embedding-runtime-win32-x64-1.0.0.zip
embedding-runtime-darwin-x64-1.0.0.zip
embedding-runtime-darwin-arm64-1.0.0.zip
voice-runtime-win32-x64-1.0.0.zip
voice-runtime-darwin-x64-1.0.0.zip
voice-runtime-darwin-arm64-1.0.0.zip
```

The voice package may contain `sherpa-onnx-node` version `1.13.4`, but the package's own runtime version should start at `1.0.0`. This allows AiFetchly to change wrappers or manifests without pretending the complete package is identical to the upstream dependency version.

## 10. User Experience Requirements

### 10.1 Runtime states

The app must represent at least these states:

```typescript
type LocalAiRuntimeState =
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
```

`missing_model` remains a separate feature/model state. A ready runtime with no model must not be reported as a runtime failure.

### 10.2 Local embedding selection

When the user selects `local-xenova:Xenova/all-MiniLM-L6-v2`:

1. Check local runtime status without network access.
2. If absent, fetch the runtime catalog.
3. Display the runtime name, compressed download size, expected installed size, and model download size when known.
4. Ask the user to install or cancel.
5. Download and activate the runtime after consent.
6. Download/cache the model through the existing Transformers.js path after separate or combined clearly-stated consent.
7. Run a health check before saving the model as ready for new embedding jobs.

If the user cancels, preserve the previous embedding model selection.

### 10.3 Remote embedding fallback

When remote embedding fails after retry:

- If the local runtime and model are already installed and healthy, the existing local fallback may proceed.
- If either component is missing, the app must not download it automatically.
- The operation must return a recoverable result that lets the UI offer local installation, retry remote embedding, or leave the document pending.
- Partial vectors from one embedding space must never be mixed with another embedding space.

### 10.4 Voice enablement

When the user enables local voice or presses the microphone while the runtime is absent:

1. Show the runtime installation prompt.
2. Install and health-check the voice runtime after consent.
3. Continue to the existing model catalog and model download flow.
4. Do not request microphone permission until the user starts recording.

The UI must distinguish:

- Voice runtime not installed
- Voice runtime incompatible
- STT model not installed
- TTS model not installed
- Microphone permission denied
- Runtime/model load failed

### 10.5 Download progress and cancellation

The UI must show:

- Runtime/model display name
- Current phase
- Bytes downloaded and total bytes when known
- Percentage when content length is known
- Cancel action during download
- Retry action after recoverable failure

Canceling a download must remove temporary files and preserve the active runtime.

### 10.6 Runtime management

System Settings must provide a Local AI Components section with:

- Installed runtime name and version
- Platform and architecture
- Installed size
- Status and last health-check result
- Check for update action
- Repair action
- Remove runtime action
- Separate model list and model removal actions

Removing a runtime must warn that the associated local feature will become unavailable. Model data should be retained by default, with a separate option to remove downloaded models.

### 10.7 Internationalization and accessibility

All user-facing text must be added to all supported language files:

- `src/views/lang/en.ts`
- `src/views/lang/zh.ts`
- `src/views/lang/es.ts`
- `src/views/lang/fr.ts`
- `src/views/lang/de.ts`
- `src/views/lang/ja.ts`

Runtime controls must be keyboard accessible. Progress and error state must not rely only on color. Icon-only actions must have localized labels and tooltips.

## 11. Functional Requirements

### FR-1: Runtime catalog

The release must publish one `local-ai-runtimes.json` catalog containing all supported runtime artifacts.

The catalog must include:

- Schema version
- Catalog version and publication timestamp
- Application release tag
- Runtime ID and runtime version
- Platform and architecture
- Download URL
- Compressed and installed sizes
- SHA-256 digest
- Electron version range or exact build version
- Node module ABI
- Package dependencies and versions
- Entry point or entry module
- Required files
- Minimum compatible AiFetchly version
- Optional maximum compatible AiFetchly version

The application must reject unknown catalog schema versions.

### FR-2: Runtime package manifest

Every ZIP must contain `manifest.json` at its root. The package manifest must repeat security-critical identity and compatibility fields so the app can compare the downloaded archive with the catalog.

Example:

```json
{
  "schemaVersion": 1,
  "runtimeId": "voice-sherpa",
  "runtimeVersion": "1.0.0",
  "platform": "win32",
  "arch": "x64",
  "electronVersion": "35.7.5",
  "nodeModuleAbi": "135",
  "entryModule": "sherpa-onnx-node",
  "dependencies": {
    "sherpa-onnx-node": "1.13.4",
    "sherpa-onnx-win-x64": "1.13.4"
  },
  "requiredFiles": [
    "package.json",
    "node_modules/sherpa-onnx-node/package.json",
    "node_modules/sherpa-onnx-win-x64/package.json"
  ]
}
```

The final ABI value must be generated by CI from the Electron build environment. It must not be maintained manually in documentation or source code.

### FR-3: Runtime storage

Runtime files must live under an application-owned user data directory:

```text
<userData>/local-ai-runtimes/
  catalog-cache.json
  embedding-xenova/
    active.json
    1.0.0/
      manifest.json
      worker.js
      node_modules/
  voice-sherpa/
    active.json
    1.0.0/
      manifest.json
      package.json
      node_modules/
```

Temporary files must use a sibling staging directory, not an active version directory.

### FR-4: Local-first discovery

Runtime status checks must inspect installed manifests and required files before making network requests. Existing installed runtimes must continue working offline.

Catalog fetching is required only for installation, update checks, or repair.

### FR-5: Catalog source configuration

The application must support a configurable catalog URL resolved at build time or through the existing update-server configuration.

Recommended precedence:

1. Dedicated `AIFETCHLY_RUNTIME_CATALOG_URL` build configuration
2. Runtime catalog endpoint derived from `UPDATESERVER`
3. Public GitHub Release URL for public distributions

Private GitHub repository tokens must never be embedded in the desktop application. Private distributions must mirror artifacts to authenticated update infrastructure appropriate for desktop clients.

### FR-6: Download controls

The runtime downloader must enforce:

- HTTPS by default
- Explicit host allowlist or trusted catalog origin
- Redirect limit
- Connection/request timeout
- Maximum archive size from local policy
- Streamed file writes rather than buffering the entire archive in memory
- Download to a randomly named staging directory
- Cancellation support
- Cleanup after cancel or failure

### FR-7: Integrity verification

Before extraction, the app must calculate the downloaded file's SHA-256 digest and compare it with the catalog.

After extraction, it must verify:

- Package manifest identity matches catalog identity
- Platform and architecture match the running process
- Electron/ABI compatibility matches
- Every required file exists
- Extracted files stay within the staging root
- No symlink escapes the staging root
- Actual extracted size does not exceed policy limits

Checksum verification is mandatory for every runtime. Unlike the current voice model catalog's optional checksum field, runtime checksums may not be omitted.

### FR-8: Safe extraction

ZIP extraction must use a structured archive library and validate each entry path before writing it. The implementation must reject:

- Absolute paths
- `..` traversal
- Windows drive prefixes
- UNC paths
- Symlinks or hard links that escape the runtime root
- Duplicate entries with conflicting types
- Excessive entry count or expanded size

The app must not shell out to a package-manager install command.

### FR-9: Atomic activation

Installation must follow this sequence:

```text
download
  -> checksum
  -> extract to staging
  -> validate manifest/files
  -> runtime smoke test
  -> rename staging to version directory
  -> atomically replace active.json
  -> retain previous known-good version temporarily
```

A crash or power loss before `active.json` is replaced must leave the previous runtime active.

### FR-10: Health checks

Each runtime must define a bounded smoke test.

Embedding health check:

- Start the downloaded embedding worker.
- Load the configured local model from cache when present, or run a runtime-only module-load check before model download.
- For a full readiness check, embed a short fixed string.
- Confirm exactly 384 finite dimensions for MiniLM.
- Stop the test worker.

Voice health check:

- Resolve `sherpa-onnx-node` from the downloaded runtime root.
- Confirm required constructors are exported.
- When a model is installed, initialize the selected STT/TTS engine with bounded timeout.
- Do not record microphone audio during health checks.

### FR-11: Explicit runtime resolution

Runtime modules must be loaded from explicit paths. The implementation must not depend on global `NODE_PATH` mutation.

Voice loading should create a scoped `require` from the active runtime directory and load `sherpa-onnx-node` through that resolver.

Embedding loading should start the worker entry point stored inside the active embedding runtime package. The downloaded worker should resolve its colocated `node_modules` dependencies normally.

### FR-12: Worker boundaries

Downloaded workers remain subject to existing worker rules:

- Worker entry points and worker-specific source live under `src/childprocess/` before compilation.
- Workers perform inference only.
- Workers never access SQLite, TypeORM, Models, or Modules.
- Workers receive bounded text/audio requests through validated IPC messages.
- Main process owns database and vector-store updates.
- Worker failures reject pending requests and allow clean restart.

### FR-13: Runtime updates

The runtime manager must support installing a newer compatible runtime while the current version remains usable.

- Never overwrite an active runtime in place.
- Activate only after validation and health checks.
- Roll back automatically if activation fails.
- Do not auto-update while a local inference worker is active.
- A background update check may report availability, but v1 should require user confirmation before downloading large updates.

### FR-14: Repair

Repair must re-download and reinstall the same catalog version. It must not trust files from a corrupted version directory.

### FR-15: Removal

Runtime removal must:

- Stop the related worker first.
- Refuse removal while a non-cancelable job is active.
- Remove only the selected runtime version after resolving an explicit path beneath the runtime root.
- Update `active.json` atomically.
- Preserve voice and embedding model data by default.
- Return clear partial-failure diagnostics if files remain locked on Windows.

### FR-16: Base installer exclusions

After runtime delivery is operational, Forge must exclude these packages from the base application unless code audit proves another feature needs them:

- `@xenova/transformers`
- `onnxruntime-node`
- `onnxruntime-common`
- `sharp`
- `sherpa-onnx-node`
- `sherpa-onnx-darwin-arm64`
- `sherpa-onnx-darwin-x64`
- `sherpa-onnx-linux-arm64`
- `sherpa-onnx-linux-x64`
- `sherpa-onnx-win-ia32`
- `sherpa-onnx-win-x64`

The embedding and voice TypeScript source may retain development dependencies needed to build runtime packages. Production Forge packaging must not copy them into the base app.

### FR-17: Backward compatibility

During rollout, the runtime resolver may support the old bundled location as a temporary fallback. Precedence must be:

1. Compatible downloaded active runtime
2. Compatible bundled runtime during migration releases only
3. Unavailable state

The bundled fallback must be removed after at least one stable release has validated runtime delivery.

### FR-18: Diagnostics

Diagnostics may include:

- Runtime ID/version
- Platform/architecture
- App/Electron/ABI versions
- Catalog URL host
- Download phase and HTTP status
- Expected and actual checksum prefixes
- Required-file validation failures
- Worker exit code and sanitized load errors

Diagnostics must not include:

- Document text
- Generated embeddings
- Raw audio
- Voice transcripts
- Authentication tokens
- Full signed download URLs containing credentials

## 12. Runtime Data Contracts

### 12.1 Catalog shape

```typescript
export interface LocalAiRuntimeCatalog {
  schemaVersion: 1;
  catalogVersion: string;
  releaseTag: string;
  publishedAt: string;
  runtimes: LocalAiRuntimeCatalogEntry[];
}

export interface LocalAiRuntimeCatalogEntry {
  runtimeId: "embedding-xenova" | "voice-sherpa";
  runtimeVersion: string;
  platform: "win32" | "darwin";
  arch: "x64" | "arm64";
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

All downloaded JSON must be parsed as `unknown` and validated with Zod before use. Type assertions alone are insufficient at the network boundary.

### 12.2 Installed state

```typescript
export interface InstalledLocalAiRuntime {
  runtimeId: "embedding-xenova" | "voice-sherpa";
  runtimeVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  installPath: string;
  installedAt: string;
  lastVerifiedAt: string;
  sha256: string;
  health: "ready" | "incompatible" | "corrupted" | "error";
  healthMessage?: string;
}
```

Installed state must be reconstructed from validated on-disk manifests when settings are missing. Settings are an index, not the authority for executable-file integrity.

### 12.3 Download events

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
  runtimeId: "embedding-xenova" | "voice-sherpa";
  runtimeVersion: string;
  phase: LocalAiRuntimeDownloadPhase;
  downloadedBytes?: number;
  totalBytes?: number;
  percent?: number;
  errorCode?: string;
  errorMessage?: string;
}
```

## 13. Target Architecture

### 13.1 Component flow

```text
Renderer
  Local AI settings / embedding selector / voice controls
        |
        | typed contextBridge IPC
        v
Main process
  LocalAiRuntimeModule
    - policy and orchestration
    - status/update/install/remove/repair
        |
        +--> LocalAiRuntimeCatalogService
        |      - fetch and Zod validation
        |      - target/compatibility selection
        |
        +--> LocalAiRuntimeDownloadService
        |      - bounded HTTPS download
        |      - checksum and safe extraction
        |
        +--> LocalAiRuntimeStateStore
        |      - on-disk manifest/state access
        |
        +--> LocalAiRuntimeHealthService
               - runtime-specific smoke tests
               - activation/rollback decision
                        |
                        v
Worker process
  embedding worker OR voice worker
  - explicit runtime path
  - inference only
  - no database access
```

Database access is not required for v1 runtime installation. If runtime audit persistence is later added to SQLite, it must follow the Model/Module architecture and remain in the main process.

### 13.2 Suggested source ownership

```text
src/entityTypes/localAiRuntimeTypes.ts
src/schemas/localAiRuntime.ts
src/modules/LocalAiRuntimeModule.ts
src/service/localAiRuntime/
  LocalAiRuntimeCatalogService.ts
  LocalAiRuntimeDownloadService.ts
  LocalAiRuntimeHealthService.ts
  LocalAiRuntimePathService.ts
  LocalAiRuntimeResolver.ts
  LocalAiRuntimeStateStore.ts
src/main-process/communication/local-ai-runtime-ipc.ts
src/childprocess/embedding/LocalEmbeddingWorker.ts
src/childprocess/ai-chat-voice/AiChatVoiceWorker.ts
scripts/build-local-ai-runtime.js
scripts/verify-local-ai-runtime.js
```

`LocalAiRuntimeStateStore.ts` owns on-disk manifest and active-version state. It must not create a separate SQLite access path. If persistent database records are later required, they must use the repository's Model/Module architecture through the main process.

### 13.3 Suggested IPC channels

```text
local-ai-runtime:list
local-ai-runtime:status
local-ai-runtime:install
local-ai-runtime:cancel-install
local-ai-runtime:check-update
local-ai-runtime:repair
local-ai-runtime:remove
local-ai-runtime:progress
```

IPC handlers must validate all renderer input and call `LocalAiRuntimeModule`. They must not implement filesystem installation logic directly.

## 14. GitHub Actions Requirements

### 14.1 Workflow ownership

`.github/workflows/release.yml` must orchestrate runtime packaging. Cross-platform runtime creation must execute on the target operating system, not on the final Ubuntu release job.

### 14.2 Job matrix

The target workflow should contain logically equivalent jobs:

```text
build-windows-app
build-macos-app
build-local-ai-runtimes
  matrix:
    - win32 / x64
    - darwin / x64
    - darwin / arm64
verify-release-assets
create-release
```

The project may combine app and runtime packaging on the same OS runner to reduce duplicate dependency installation. The release contract matters more than exact job names.

### 14.3 Runtime build procedure

For each target, CI must:

1. Check out the exact release commit.
2. Install dependencies from the locked dependency graph.
3. Build the runtime worker with production settings.
4. Rebuild native modules for the target Electron version and architecture when required.
5. Copy only the runtime's transitive production files into a clean staging root.
6. Remove source maps, tests, docs, caches, unrelated platform binaries, and package-manager metadata when not required at runtime.
7. Generate `manifest.json` from observed build values.
8. Run the runtime verification script against the staging root.
9. Sign native macOS content as required by the application's hardened-runtime policy.
10. Create a deterministic ZIP.
11. Calculate SHA-256, compressed size, and expanded size.
12. Upload the ZIP and metadata as workflow artifacts.

### 14.4 Platform pruning

The voice runtime archive must contain exactly one sherpa platform package matching the matrix target. For example, the Windows x64 archive must not contain macOS, Linux, Windows ia32, or other architecture packages.

The embedding runtime must similarly exclude ONNX Runtime or Sharp binaries for unrelated targets.

### 14.5 Runtime catalog generation

The release verification job must collect all six runtime metadata files and generate `local-ai-runtimes.json`. Catalog generation must fail when:

- A required target is missing
- Filenames do not match metadata
- Runtime IDs or versions are inconsistent
- SHA-256 is missing or malformed
- A download URL cannot be derived
- Duplicate platform/architecture entries exist
- A package contains unexpected platform binaries

### 14.6 Publishing

`create-release` must publish:

- Selected end-user installers and updater assets
- Six runtime ZIPs
- Runtime catalog
- Runtime catalog checksum
- Optional software bill of materials and license notices

Runtime assets should use the same immutable release tag as the application release that generated them. A catalog may point to older compatible runtime assets to avoid rebuilding unchanged runtimes, but v1 may publish all packages on each release for simplicity.

### 14.7 Public and private repositories

For a public repository, catalog URLs may point directly to GitHub Release assets.

For a private repository, GitHub's authenticated release URLs are not suitable for a consumer desktop application unless the application already has a secure backend-mediated download flow. In that case, CI should upload or mirror runtime assets to the configured update server or object storage, and the catalog should use those URLs.

### 14.8 CI security

- Pin third-party GitHub Actions to reviewed versions; commit SHA pinning is preferred for security-sensitive publishing steps.
- Grant `contents: write` only to the release job that needs it.
- Runtime build jobs should use read-only repository permissions.
- Do not expose signing credentials to pull-request workflows from forks.
- Never print signing keys, tokens, authenticated artifact URLs, or secret environment values.
- Generate an SBOM or dependency inventory for each runtime package.

## 15. Packaging Requirements

### 15.1 Embedding runtime contents

Expected logical contents:

```text
manifest.json
package.json
worker.js
node_modules/
  @xenova/transformers/
  onnxruntime-common/
  onnxruntime-node/
  sharp/
  <required transitive dependencies only>
```

The package must not include MiniLM model weights. Those remain in the Transformers cache.

### 15.2 Voice runtime contents

Expected logical contents:

```text
manifest.json
package.json
node_modules/
  sherpa-onnx-node/
  sherpa-onnx-<matching-platform-arch>/
```

The package must not include Whisper or Piper/VITS model weights. Those remain under `userData/voice-models`.

### 15.3 Dependency closure

The packaging script must derive and verify the dependency closure instead of maintaining a fragile hand-written list of every transitive file. A small explicit allowlist for top-level runtime packages is acceptable, but CI must prove that a clean extracted archive can load without the repository's root `node_modules` directory.

### 15.4 Licensing

Each runtime package must include required third-party license notices. CI must fail or require review when dependency licenses change to an unapproved category.

## 16. Security and Trust Boundaries

### 16.1 Trust model

```text
Trusted at build time
  Repository source + lockfile + approved registries + GitHub Actions

Untrusted at runtime until verified
  Runtime catalog response
  Runtime ZIP bytes
  Archive paths and manifests

Trusted after verification
  Versioned runtime directory matching checksum, manifest, and health checks
```

### 16.2 Executable package policy

Runtime packages contain executable native code. Therefore:

- SHA-256 is necessary but not sufficient if the catalog itself can be replaced.
- HTTPS and a trusted catalog origin are mandatory.
- A future catalog-signing key is recommended before supporting third-party mirrors.
- The app must never activate a package solely because its internal manifest claims compatibility.
- Catalog identity, internal manifest identity, running platform, and local policy must all agree.

### 16.3 macOS requirements

Downloaded `.node` and `.dylib` files must be tested with the signed and notarized production application under hardened runtime. CI must validate both Intel and Apple Silicon packages on their target architecture.

If macOS policy prevents safely loading post-install native libraries, the fallback product option is a separately signed optional component installer or a Lite/Full application distribution. This must be resolved before declaring macOS runtime delivery generally available.

### 16.4 Windows requirements

The application must handle antivirus scanning delays and locked native files. Activation should retry bounded file operations and preserve the previous runtime when replacement cannot complete.

## 17. Reliability and Recovery

### 17.1 Failure behavior

| Failure | Required behavior |
| --- | --- |
| Catalog unavailable | Keep installed runtime usable; show update/install unavailable |
| Unsupported platform | Do not offer download; keep remote features available |
| Interrupted download | Remove temporary file or allow verified resume in a future release |
| Checksum mismatch | Delete staged archive; mark security/integrity error; do not retry indefinitely |
| Unsafe archive entry | Abort extraction and delete staging directory |
| Health check failure | Keep prior runtime active and report failure |
| Worker crash | Reject pending requests and permit one clean restart |
| App update changes ABI | Mark old runtime incompatible and offer compatible update |
| Runtime removal fails | Keep state truthful and report locked files |

### 17.2 Startup behavior

Application startup must not block on network runtime checks. It may validate active manifests lazily on first local feature use or in a low-priority background task.

### 17.3 Rollback retention

Keep at most one previous known-good version after successful activation. Remove older inactive versions during bounded maintenance, never through an unvalidated broad recursive path.

## 18. Performance and Size Requirements

1. Base installer compressed size must decrease by at least 15% compared with the baseline release, or the release report must explain why the target was missed.
2. CI must record base installer size and each runtime compressed/expanded size as a build summary.
3. Runtime status checks using local manifests should complete within 200 ms on a typical supported machine, excluding health checks.
4. Catalog fetch timeout must not block local runtime use.
5. Downloads must stream to disk and remain within a bounded memory footprint.
6. Runtime installation must require enough free disk space for the archive, staging extraction, and one retained prior version.
7. Worker startup regression should remain within 20% of the bundled-runtime baseline after model cache warm-up.

The exact baseline must be captured from the last release before Forge exclusions are merged.

## 19. Privacy Requirements

1. Runtime download requests may reveal app version, platform, architecture, and requested capability through the asset URL. They must not include user document or conversation identifiers.
2. Runtime diagnostics must not contain document text, embeddings, audio, or transcripts.
3. Runtime installation must not read the knowledge database.
4. Runtime workers retain the current no-database-access rule.
5. Download analytics are out of scope unless covered by the application's user-facing telemetry consent.

## 20. Testing Requirements

### 20.1 Unit tests

Test at minimum:

- Catalog schema validation
- Target selection by platform/architecture
- App/Electron/ABI compatibility decisions
- SHA-256 success and mismatch
- Redirect and size limits
- Unsafe ZIP path rejection
- Required-file validation
- Atomic active-state replacement
- Repair and rollback behavior
- Runtime path containment
- Runtime removal with locked-file failure
- Progress event state transitions
- Missing runtime versus missing model distinction
- No automatic download during embedding fallback

### 20.2 Integration tests

On each target runner:

- Extract the produced runtime ZIP into a clean temporary directory.
- Run verification without access to repository `node_modules`.
- Load the runtime module or start the runtime worker.
- Confirm no unrelated platform binary packages exist.
- Confirm catalog and internal manifest values match.
- Confirm a corrupted archive cannot activate.

### 20.3 End-to-end tests

Test these product flows:

1. Fresh base app with no runtime can use remote AI.
2. User selects local embedding, consents, installs runtime/model, and embeds a document.
3. User cancels runtime download and previous selection remains active.
4. User enables local voice, installs runtime/model, and runs STT/TTS.
5. App restarts offline and uses installed local features.
6. Compatible runtime update activates successfully.
7. Failed runtime update rolls back to previous version.
8. Runtime removal disables only the local feature and preserves models by default.

### 20.4 Release tests

The release job must fail unless:

- All six required runtime assets exist
- Every asset checksum matches
- Catalog validation passes
- Target smoke tests pass
- Base installers do not contain excluded runtime dependencies
- Release asset names are unique
- Installer and runtime sizes are printed in the job summary

## 21. Success Metrics

### 21.1 Primary metrics

- At least 15% reduction in compressed base installer size on Windows and each macOS target.
- Zero runtime packages built or uploaded manually.
- At least 99% successful runtime activations among completed, non-canceled downloads in internal/beta testing.
- Zero cases where a failed runtime update removes the previous working runtime.
- Zero automatic large downloads initiated by remote embedding fallback.

### 21.2 Operational metrics

- Runtime package build time per target
- Runtime compressed and expanded size
- Catalog validation failures
- Download failure category counts, only when telemetry consent permits
- Health-check failure category counts, without user content
- Support incidents caused by ABI or signing incompatibility

## 22. Rollout Plan

### Phase 0: Baseline and feasibility

1. Record current Windows and macOS installer sizes and packaged dependency sizes.
2. Confirm which macOS architectures are currently released.
3. Prove downloaded native modules can load from a signed/notarized macOS application.
4. Confirm GitHub Release visibility or select update-server storage.

Exit criteria:

- Measured baseline exists.
- macOS post-install native loading decision is documented.
- Artifact hosting decision is documented.

### Phase 1: CI runtime artifacts

1. Add cross-platform runtime packaging and verification scripts.
2. Build six runtime archives through the target matrix.
3. Generate manifests, checksums, size reports, SBOM/license inventory, and catalog.
4. Publish assets to prereleases without changing the base installer.

Exit criteria:

- Two consecutive CI runs produce complete, loadable artifacts.
- Archives contain only target-specific native files.

### Phase 2: Runtime manager and voice pilot

1. Implement runtime catalog, download, validation, install, health, and removal services.
2. Change sherpa loading to resolve from the active runtime root.
3. Add runtime management UI and i18n.
4. Keep bundled voice runtime as a migration fallback for one beta release.

Voice is the first pilot because its loader is already dynamic and its models are already consent-gated downloads.

Exit criteria:

- Voice install/use/restart/update/remove flows pass on all v1 targets.
- Signed/notarized macOS production builds pass.

### Phase 3: Embedding runtime

1. Package the compiled embedding worker with its runtime dependencies.
2. Resolve the active downloaded worker in `LocalEmbeddingWorkerClient`.
3. Add explicit install flow to local model selection.
4. Change remote fallback behavior to avoid silent downloads.
5. Keep bundled embedding runtime as a migration fallback for one beta release.

Exit criteria:

- Existing local vector generation and search remain compatible.
- No mixed embedding spaces are introduced.
- Offline restart works after runtime/model installation.

### Phase 4: Remove runtimes from base installer

1. Remove runtime dependencies from Forge external dependency and ASAR unpack lists.
2. Verify the base package does not contain them.
3. Remove temporary bundled-runtime fallback after stable rollout.
4. Enforce installer-size regression thresholds in CI.

Exit criteria:

- Size target is met or exception is approved with evidence.
- Remote-only app behavior passes without downloaded runtimes.

### Phase 5: Optional improvements

- Differential runtime updates
- Resumable downloads
- Signed catalog independent of hosting TLS
- Linux runtimes
- Enterprise offline runtime import
- Lite and Full installer variants
- CDN mirroring and regional endpoints

## 23. Suggested Implementation Order

1. Add runtime types and Zod schemas.
2. Add deterministic path and compatibility services.
3. Add CI packaging and standalone verification scripts.
4. Add runtime catalog generation and release artifact checks.
5. Add download, checksum, safe extraction, and atomic activation services.
6. Add IPC Module and renderer API contracts.
7. Add settings UI, progress events, i18n, repair, and removal.
8. Integrate downloaded runtime resolution with voice.
9. Complete target-platform voice tests and macOS signing validation.
10. Integrate downloaded worker resolution with embedding.
11. Change embedding fallback consent behavior.
12. Remove runtime dependencies from the base installer.
13. Add package-size regression gates.

## 24. Acceptance Criteria

The feature is complete when all of the following are true:

- [ ] GitHub Actions builds Windows x64, macOS x64, and macOS arm64 embedding runtime ZIPs.
- [ ] GitHub Actions builds Windows x64, macOS x64, and macOS arm64 voice runtime ZIPs.
- [ ] No runtime ZIP is built or uploaded manually.
- [ ] Every ZIP has a valid internal manifest, SHA-256, size metadata, and dependency inventory.
- [ ] One catalog describes all six required artifacts and validates against a versioned schema.
- [ ] CI smoke-tests every runtime on its target operating system and architecture.
- [ ] Runtime downloads require informed user consent.
- [ ] Runtime downloads stream to disk, support cancellation, and enforce size/time/redirect limits.
- [ ] Unsafe archives and checksum mismatches cannot activate.
- [ ] Runtime installation and activation are atomic and preserve a prior working version.
- [ ] Voice loads `sherpa-onnx-node` from the active downloaded runtime.
- [ ] Embedding starts its worker from the active downloaded runtime.
- [ ] Runtime workers do not access SQLite or TypeORM.
- [ ] Missing runtimes do not prevent remote AI features from working.
- [ ] Remote embedding fallback never silently downloads local components.
- [ ] Voice and embedding model files remain separate from runtime archives.
- [ ] Runtime repair, update, rollback, and removal work on all v1 targets.
- [ ] Installed local features continue to work while offline.
- [ ] macOS downloaded native files work in signed and notarized production builds.
- [ ] All new UI text exists in six supported language files.
- [ ] Base installers no longer contain the optional runtime dependency trees.
- [ ] Base installer size is reduced by at least 15% against the recorded baseline, or an evidence-backed exception is approved.

## 25. Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| macOS rejects downloaded native libraries | Local features fail after production signing | Complete feasibility test in Phase 0; use signed optional component or Lite/Full fallback if needed |
| Electron update changes native ABI | Existing runtime cannot load | Catalog compatibility fields, health check, side-by-side update, clear incompatible state |
| Catalog or archive is tampered with | Arbitrary native code execution | Trusted HTTPS origin, mandatory SHA-256, strict manifests, safe extraction, future signed catalog |
| Runtime ZIP misses a transitive dependency | Worker fails only on user machines | Verify from clean extracted archive without repository `node_modules` |
| Wrong-platform packages increase size | Size benefit is reduced | Matrix-specific install/pruning and CI assertions |
| Download interrupted or disk full | Broken installation | Staging directory, free-space check, cleanup, atomic activation |
| GitHub repository is private | Desktop cannot download release assets safely | Mirror to update server/object storage; never embed GitHub token |
| Runtime release and app release drift | Incompatible package selected | Catalog app/Electron/ABI constraints and deterministic target selection |
| Local fallback triggers unexpected download | User trust and bandwidth impact | Explicit consent requirement and recoverable pending-document state |
| Runtime removal deletes models unexpectedly | Large re-download and user frustration | Separate runtime/model lifecycle; preserve models by default |

## 26. Alternatives Considered

### 26.1 Keep everything bundled

Advantages:

- Simplest runtime loading
- Fully offline immediately after app installation
- No runtime update infrastructure

Disadvantages:

- Every user continues paying the size and update cost
- Wrong-platform optional dependencies may be packaged
- Runtime fixes require complete application releases

Decision: rejected as the long-term default because local AI features are optional.

### 26.2 Lite and Full installers

Advantages:

- Avoids post-install executable downloads
- Simpler native signing model
- Full installer can be immediately offline-ready

Disadvantages:

- Two user-facing installer choices
- Larger release matrix and support surface
- Upgrading Lite to Full requires another application installation

Decision: retained as fallback, especially if macOS hardened runtime blocks downloadable native components.

### 26.3 Install npm dependencies on the user's machine

Advantages:

- Less custom CI packaging

Disadvantages:

- Requires package manager, network registry access, and possibly compilers
- Non-reproducible and exposes a large supply-chain surface
- Native build failures are common on end-user machines

Decision: prohibited.

### 26.4 One combined local AI runtime

Advantages:

- One archive and one installer flow

Disadvantages:

- Voice-only and embedding-only users download unrelated engines
- Updates are coupled
- Package size remains unnecessarily large

Decision: rejected for v1.

### 26.5 Runtime plugin through the general plugin system

Advantages:

- Reuses some installation concepts

Disadvantages:

- Existing plugins are not designed as trusted native executable packages
- Native runtime trust, ABI compatibility, signing, and activation need stricter policy

Decision: use a dedicated first-party runtime manager. Shared low-level download utilities may be reused after security review.

## 27. Open Questions

1. Are production GitHub Release assets public, or must CI mirror them to `UPDATESERVER` infrastructure?
2. Which exact runner labels will provide macOS x64 and arm64 for this repository?
3. Will runtime packages be rebuilt on every app release or only when runtime dependencies change?
4. Should catalog authenticity use a detached public-key signature in v1 or follow after the trusted-host MVP?
5. What installer-size baselines and target thresholds are realistic after measuring compressed artifacts?
6. Does any feature outside local embedding use `sharp` directly, requiring it to remain in the base installer?
7. Should the first local embedding selection use one combined consent dialog for runtime plus model, or two sequential dialogs?
8. How long should the previous known-good runtime be retained before cleanup?
9. Should enterprise users be able to import runtime ZIPs from disk for offline deployment?
10. If macOS blocks post-install native loading under the production security model, should AiFetchly ship Lite/Full builds or a separately signed component installer?

## 28. Related Implementation Areas

- `.github/workflows/release.yml`
- `forge.config.js`
- `package.json`
- `src/childprocess/embedding/LocalEmbeddingWorker.ts`
- `src/childprocess/embedding/LocalTransformersEnvironment.ts`
- `src/service/embedding/LocalEmbeddingWorkerClient.ts`
- `src/service/embedding/EmbeddingProviderFactory.ts`
- `src/service/aiChatVoice/SherpaOnnxNative.ts`
- `src/service/aiChatVoice/VoiceModelCatalogService.ts`
- `src/service/aiChatVoice/VoiceModelDownloadService.ts`
- `src/modules/AiChatVoiceModule.ts`
- `src/main-process/communication/ai-chat-v2-voice-ipc.ts`
- `docs/prd/local-xenova-embedding-model-prd.md`
- `docs/prd/local-xenova-embedding-model-technical-design.md`
- `docs/prd/local-sherpa-onnx-voice-chat-prd.md`
- `docs/prd/local-sherpa-onnx-voice-chat-technical-design.md`
