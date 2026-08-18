# Plugin Hub Managed Installation - Technical Design

## Document Information

| Field | Value |
| --- | --- |
| Version | 1.0 |
| Status | Proposed |
| Date | 2026-08-09 |
| Repository | `/home/robertzeng/project/aiFetchly` |
| Product requirements | `docs/prd/plugin-hub-managed-installation-prd.md` |
| Hub counterpart | `/home/robertzeng/project/aifetchly-hub-go/docs/plugin-hub-managed-distribution-technical-design.md` |

## 1. Purpose

This design adds a first-party Plugin Hub acquisition path to the Electron desktop application. It installs canonical plugin ZIPs plus managed CPython, pinned Python environments, and immutable model snapshots without requiring Git, npm, Python, pip, or compilers on the customer computer.

The implementation extends the existing plugin manager, `PluginImportService`, and downloadable local-runtime services. It does not replace marketplace installation. Hub and marketplace discovery remain separate; both converge only after a trusted package has been acquired and validated locally.

All interfaces marked **proposed** do not exist yet. Existing code anchors are named explicitly so implementation work does not mistake this document for current behavior.

## 2. Design Goals

1. Keep catalog reads small and detail reads rich.
2. Use stable Hub plugin and version UUIDs.
3. Resolve author declarations into Hub-approved downloads; never trust package-authored URLs.
4. Install managed Python plugins with no system Python.
5. Reuse exact Python environments and model bytes across plugins.
6. Evaluate compatibility per plugin version and target.
7. Gate protected downloads in the Hub, not in renderer UI.
8. Preserve the existing local import, rollback, component registration, and broadcast flow.
9. Keep executable paths, signed URLs, bearer credentials, and absolute model paths out of the renderer.
10. Make cancellation, crash recovery, repair, update, uninstall, and resource cleanup deterministic.

## 3. Existing Anchors

| Existing component | Reuse |
| --- | --- |
| `PluginManager.vue` | Hosts Installed, Plugin Hub, Marketplaces, and Errors tabs |
| `PluginImportService.installFromLocalRoot()` | Final manifest, skill, MCP, agent, file-copy, persistence, and rollback pipeline |
| `PluginInstallService` | Marketplace and direct-source acquisition only |
| `PluginMarketplaceService` | Marketplace discovery and source resolution only |
| `PluginArchiveService` | Safe plugin ZIP extraction primitives |
| `src/service/localAiRuntime/*` | Download, checksum, path containment, side-by-side activation, state, health, and progress patterns |
| `InstalledPlugin.sourceMetaJson` | Human-readable Hub provenance summary |
| `registerValidatedHandler` | Schema-validated, non-AI-gated IPC |
| `broadcastAifetchlyConfigChanged` | Refreshes plugin consumers after activation |

The current `LOCAL_AI_RUNTIME_IDS` allowlist is compile-time fixed to voice and embedding. Managed plugin resources therefore use a parallel generalized subsystem. They may reuse implementations, but must not weaken the first-party runtime allowlist.

## 4. Target Architecture

```text
Renderer
  PluginHubTab / PluginHubDetailPage / InstallDialog / ResourceStoragePage
      |
      | validated IPC, renderer-safe DTOs
      v
Electron main process
  PluginHubModule
    + PluginHubClient
    + PluginHubInstallCoordinator
    + ManagedPluginResourceModule
    + PluginHubEntitlementService
    + PluginImportService
      |
      +-- HTTPS JSON --> Plugin Hub API
      +-- HTTPS bytes -> CDN/object storage/ticket endpoint
      +-- filesystem -> staging, runtimes, environments, model cache
      +-- Model/Module -> SQLite provenance and resource bindings
      +-- spawn(shell:false) -> managed MCP
```

The renderer requests actions and displays sanitized results. The main process owns network authentication, target detection, consent binding, paths, downloads, verification, extraction, activation, process launch, and persistence.

## 5. Proposed Source Layout

```text
src/entityTypes/pluginHubTypes.ts
src/schemas/pluginHub.ts
src/schemas/ipc/pluginHub.ts
src/config/pluginHub.ts

src/entity/PluginHubInstallation.entity.ts
src/entity/InstalledPluginResourceBinding.entity.ts
src/model/PluginHubInstallation.model.ts
src/model/InstalledPluginResourceBinding.model.ts
src/modules/PluginHubModule.ts
src/modules/ManagedPluginResourceModule.ts

src/service/pluginHub/PluginHubClient.ts
src/service/pluginHub/PluginHubDeviceProfileService.ts
src/service/pluginHub/PluginHubInstallCoordinator.ts
src/service/pluginHub/PluginHubConsentStore.ts
src/service/pluginHub/PluginHubEntitlementService.ts
src/service/pluginHub/PluginHubPackageInstaller.ts
src/service/pluginHub/ManagedResourcePathService.ts
src/service/pluginHub/ManagedResourceStateStore.ts
src/service/pluginHub/ManagedResourceDownloadService.ts
src/service/pluginHub/ManagedResourceExtractor.ts
src/service/pluginHub/ManagedPythonLauncher.ts
src/service/pluginHub/ModelCacheService.ts
src/service/pluginHub/ResourceLeaseService.ts

src/main-process/communication/plugin-hub-ipc.ts
src/views/api/pluginHub.ts
src/views/components/plugins/PluginHubTab.vue
src/views/components/plugins/PluginHubDetailPage.vue
src/views/components/plugins/PluginHubInstallDialog.vue
src/views/components/plugins/PluginResourceStorageDialog.vue

test/vitest/main/plugin-hub-ipc.test.ts
test/modules/PluginHubModule.test.ts
test/modules/ManagedPluginResourceModule.test.ts
test/vitest/utilitycode/pluginHubSchemas.test.ts
```

Database access stays in Model and Module classes. IPC handlers call `PluginHubModule` only.

## 6. Configuration and Trust Roots

`src/config/pluginHub.ts` provides compiled defaults:

```typescript
export interface PluginHubConfig {
  readonly apiBaseUrl: string;
  readonly allowedApiHosts: readonly string[];
  readonly allowedDownloadHosts: readonly string[];
  readonly requestTimeoutMs: number;
  readonly catalogCacheTtlMs: number;
  readonly planCacheTtlMs: number;
  readonly maxPluginArchiveBytes: number;
  readonly maxResourceArchiveBytes: number;
}
```

Resolution order:

1. Signed/build-time production configuration.
2. Development-only `AIFETCHLY_PLUGIN_HUB_URL` override when the application is not packaged.
3. No package manifest override.

The package declares logical runtime and model identities in `mcp/servers.json`. The Hub install plan supplies approved artifact identities, hashes, sizes, and download grants. Package-authored `downloadUrl`, executable, absolute path, or storage-key fields are rejected.

## 7. Network Contracts

### 7.1 Catalog

```http
GET /api/v1/plugins/catalog?search=&category=&tags=&limit=30&offset=0
```

The main process validates a lean response containing `id`, `currentVersionId`, display metadata, tags, access state, and stats. It caches anonymous and authenticated segments separately. The renderer never calls the Hub directly.

### 7.2 ID detail

```http
GET /api/v1/plugins/by-id/:pluginId
```

Detail includes public capabilities, permissions, target matrix, runtime/model summaries, hardware guidance, access policy, required plans, and current version. The readable name endpoint remains a web compatibility route, not an installation identity.

### 7.3 Read-only plan

```http
GET /api/v1/plugins/by-id/:pluginId/versions/:versionId/install-plan
    ?platform=win32&arch=x64&accelerator=cpu&appVersion=1.0.0
```

The plan contains immutable resource IDs, type, version, archive and installed sizes, SHA-256, target, reuse identity, access state, expiry, and `planDigest`. It contains no protected bearer grant.

Proposed shared types:

```typescript
type PluginHubResourceType = "plugin" | "runtime" | "environment" | "model";

interface PluginHubPlanResource {
  readonly type: PluginHubResourceType;
  readonly resourceId: string;
  readonly artifactId: string;
  readonly version: string;
  readonly archiveSizeBytes: number;
  readonly installedSizeBytes: number;
  readonly sha256: string;
  readonly reuseKey: string;
  readonly required: boolean;
}

interface PluginHubInstallPlan {
  readonly schemaVersion: 1;
  readonly pluginId: string;
  readonly versionId: string;
  readonly planDigest: string;
  readonly target: {
    readonly platform: "win32" | "darwin" | "linux";
    readonly arch: "x64" | "arm64";
    readonly accelerator: "none" | "cpu" | "cuda" | "mps";
  };
  readonly compatible: boolean;
  readonly resources: readonly PluginHubPlanResource[];
  readonly access: {
    readonly status: "allowed" | "login_required" | "subscription_required" | "forbidden";
    readonly installMode: "public" | "ticket";
  };
  readonly expiresAt: string;
}
```

### 7.4 Authorized preparation

```http
POST /api/v1/plugins/by-id/:pluginId/versions/:versionId/prepare-install
```

The request sends the plan digest, target, app version, and bounded anonymous install ID. The Hub rechecks publication, version ownership, target, artifact state, and subscription. The response contains short-lived download paths or public artifact descriptors.

Each prepared resource repeats resource ID, artifact ID, SHA-256, and expected byte count. It adds either a relative `downloadPath` or an approved public `downloadUrl`. The main process rejects duplicate/missing resources, an identity mismatch with the plan, an absolute ticket path, or an expiry later than the install session.

### 7.5 Ticket download

```http
GET /api/v1/downloads/:ticket
```

The main process follows only the prepared relative path, sends required desktop authentication only to the Hub origin, and applies the same redirect, host, size, timeout, and checksum controls as public resource downloads.

### 7.6 Error envelope

```typescript
interface PluginHubErrorEnvelope {
  readonly data: null;
  readonly error:
    | "invalid_request"
    | "unauthenticated"
    | "subscription_required"
    | "forbidden"
    | "not_found"
    | "target_unsupported"
    | "resource_build_pending"
    | "resource_unavailable"
    | "artifact_revoked"
    | "plan_expired"
    | "plan_stale"
    | "entitlement_unavailable"
    | "rate_limited"
    | "internal_error";
  readonly requestId: string;
  readonly requiredPlans?: readonly string[];
  readonly upgradeUrl?: string;
}
```

Unknown response keys may be ignored only at explicitly extensible objects. Security-sensitive objects use strict schemas.

## 8. Authentication

`PluginHubClient` obtains the existing marketing access token from the main-process token service. It sets `Authorization: Bearer` only for the configured Hub origin and never follows an authorization-bearing redirect across origins.

Anonymous catalog/detail reads are allowed. Authenticated reads add viewer access state. Prepare-install for protected content fails closed if the token is missing, expired, or the Hub cannot establish entitlement.

Tokens, tickets, signed URLs, cookies, and absolute paths are redacted from logs. Ticket download paths remain in the main process.

## 9. Device Profile and Compatibility

`PluginHubDeviceProfileService` returns:

```typescript
interface PluginHubDeviceProfile {
  readonly platform: "win32" | "darwin" | "linux";
  readonly arch: "x64" | "arm64";
  readonly accelerator: "none" | "cpu" | "cuda" | "mps";
  readonly appVersion: string;
  readonly electronVersion: string;
  readonly nodeModuleAbi: string;
  readonly memoryBytes: number;
  readonly availableDiskBytes: number;
}
```

Electron/Node ABI participates only when an artifact contains Node-native modules. Accelerator detection is best effort; CPU is chosen only when the plan declares CPU support. Raw GPU identifiers and local paths never leave the main process.

Compatibility is recalculated before preparation. A catalog/detail badge is advisory; it never authorizes a download.

## 10. Plugin Declaration

`mcp/servers.json` is the author-owned logical declaration:

```json
{
  "mcpServers": {
    "showui": {
      "transport": "stdio",
      "runtime": {
        "type": "managed-python",
        "runtimeId": "python-cpython",
        "version": "3.11"
      },
      "entry": "mcp/showui_server.py",
      "environment": {"lockfile": "mcp/requirements.lock"},
      "models": [{
        "modelId": "huggingface:showlab/showui-2b",
        "revision": "exact-immutable-revision",
        "format": "huggingface-snapshot",
        "mountEnv": "AIFETCHLY_MODEL_PATH"
      }]
    }
  }
}
```

The desktop revalidates this declaration after extraction and compares it to the Hub plan. A missing server, changed entry, lockfile digest mismatch, unexpected model, or target mismatch aborts installation.

## 11. Local Persistence

### 11.1 `PluginHubInstallation`

| Column | Purpose |
| --- | --- |
| `id` | Local primary key |
| `pluginName` | Unique installed plugin name |
| `hubPluginId` | Stable Hub UUID |
| `hubVersionId` | Installed Hub version UUID |
| `version` | Display semver |
| `planDigest` | Prepared plan identity |
| target fields | Platform, architecture, accelerator |
| `enforcementMode` | `install_only` or `runtime` |
| `offlineGraceSeconds` | Disclosed runtime grace |
| `lastEntitlementCheckAt` | Runtime policy state |
| `status` | staging, active, repair_required, disabled |
| timestamps | Lifecycle |

### 11.2 `InstalledPluginResourceBinding`

| Column | Purpose |
| --- | --- |
| `pluginName` | Installed owner |
| `resourceType` | plugin, runtime, environment, model |
| `resourceKey` | Validated local resource identity |
| `hubResourceId` | Hub identity |
| `expectedSha256` | Integrity anchor |
| `leasePolicy` | Shared or plugin-private |

Unique key: `(pluginName, resourceType, resourceKey)`.

TypeORM entities are accessed only by matching Models and Modules. Worker processes receive resolved launch data over IPC and never access SQLite.

Both entities must be registered in `src/config/SqliteDb.ts` and initialized through the repository's existing schema-upgrade path. The Module owns a transaction that writes installation provenance and resource bindings only after the existing plugin import succeeds.

### 11.3 Filesystem state

Resource byte state remains in atomic JSON beside resources. SQLite records ownership and policy, not absolute paths. Startup reconciliation repairs disagreement between state files, active pointers, bindings, and installed plugins.

## 12. On-Disk Layout

```text
<userData>/managed-plugin-resources/
  operations/<operation-id>.json
  downloads/<operation-id>/<resource-id>.part
  staging/<operation-id>/
  runtimes/python-cpython/<platform>/<arch>/<version>/
  environments/<environment-key>/<format-version>/
  models/
    blobs/sha256/ab/cdef...
    snapshots/<provider>/<namespace>/<model>/<revision>/manifest.json
  state/resources/<resource-key>.json
  trash/<timestamp>-<resource-key>/
```

Every segment is reconstructed from validated IDs. No Hub string is joined directly to a path. Activation uses atomic rename or an atomic pointer file. Deletion first moves a validated resource root into `trash`, then removes it after lease and reference checks.

## 13. Resource Identity

### 13.1 Runtime

`runtimeId + exact version + platform + arch`.

### 13.2 Python environment

```text
SHA256(
  normalized hashed lock bytes
  + exact runtime release
  + platform
  + arch
  + accelerator
  + environment format version
)
```

Only identical keys share an environment. Different CUDA, MPS, CPU, Python patch, lock hash, or format produces isolation.

### 13.3 Model snapshot

Logical snapshot identity is canonical model ID, exact revision, format, and file-manifest digest. Individual files are blobs keyed by SHA-256, allowing snapshots and plugins to share bytes safely.

Cache presence never grants plugin entitlement.

## 14. Install Coordinator

### 14.1 States

```text
idle -> planning -> awaiting_consent -> preparing
     -> downloading -> verifying -> extracting
     -> health_checking -> importing -> binding -> active
     -> cancelling | failed | rollback_required
```

One operation per plugin ID runs at a time. Resource downloads with the same resource key use one shared promise and bounded concurrency.

### 14.2 Consent binding

`PluginHubConsentStore` creates a random, one-time, five-minute token bound to plugin ID, version ID, target, plan digest, displayed incremental bytes, and operation ID. The renderer returns only that token. Changed plan or sizes require new consent.

### 14.3 Sequence

1. Fetch and validate plan.
2. Compare resources with verified local state.
3. Check disk space including temporary and rollback overhead.
4. Return sanitized consent offer.
5. Claim consent and call prepare-install.
6. Stream missing resources into operation staging.
7. Verify byte count and SHA-256 before extraction.
8. Validate archive manifest and safe paths.
9. Health-check runtime, imports, model files, and MCP initialization.
10. Import the staged plugin with `PluginImportService.installFromLocalRoot()`.
11. Persist installation and bindings in one Module transaction where possible.
12. Activate resources and broadcast plugin configuration change.
13. Delete staging and emit best-effort telemetry.

The existing import service receives provenance `sourceKind: "plugin-hub"` and bounded source metadata. It never receives a signed URL.

### 14.4 Rollback

Before plugin import, rollback removes staging only. After import, rollback uninstalls newly created plugin rows/files, removes new bindings, restores the prior plugin version when an overwrite snapshot exists, and retains shared verified resources. Failure to complete rollback marks `repair_required`.

## 15. Downloads and Extraction

Downloads use HTTPS, connect/read/total timeouts, bounded redirects, no credentials in URLs, response size caps, streamed writes, cancellation, and SHA-256 verification. A redirect may cross only to a compiled approved host and must drop authorization unless the ticket contract explicitly uses the same trusted origin.

Archive extraction rejects absolute paths, drive prefixes, `..`, NUL, symlink/hardlink escape, device files, excessive entries, per-file overflow, total expansion overflow, and duplicate normalized paths. Executable bits are restored only from the signed package manifest allowlist.

Partial files never become active.

## 16. Managed Python Launch

`ManagedPythonLauncher` resolves:

- managed CPython executable;
- environment site-packages or verified offline environment;
- plugin-contained entry;
- model snapshot paths;
- approved environment variables;
- plugin working directory and granted permissions.

It launches with `spawn(executable, args, {shell: false})`. The renderer and plugin cannot choose the executable.

Required model variables:

```text
AIFETCHLY_MODEL_PATH=<validated snapshot path>
HF_HUB_OFFLINE=1
TRANSFORMERS_OFFLINE=1
```

Plugin code must call `from_pretrained(AIFETCHLY_MODEL_PATH, local_files_only=True)` or equivalent. Startup network downloads are treated as a plugin validation defect.

## 17. Health Checks

Health checks run in a restricted child process under `src/childprocess/`:

1. CPython version and target.
2. Environment import probe for declared top-level modules.
3. Model manifest and blob hash sampling/full verification policy.
4. Plugin entry containment.
5. MCP initialize/list-tools handshake with timeout.
6. No unexpected network access during offline probe.

The child process sends results to the main process. It never accesses SQLite.

## 18. Entitlement Enforcement

`install_only` blocks new install, update, and protected repair after cancellation, but permits an already installed local launch. `runtime` asks `PluginHubEntitlementService` for a main-process decision before activation and applies the disclosed offline grace.

Runtime checks cache only signed/Hub-returned decisions with an expiry. Clock rollback, corrupt state, or expired grace fails closed for premium activation. Shared runtimes, environments, and models remain reusable by other authorized plugins.

## 19. Update, Repair, Uninstall, and Cleanup

- **Update:** plan the current Hub version, install side by side, preserve disabled component preferences, then atomically switch.
- **Repair:** reverify bound resources; fetch only missing or corrupt protected bytes after a fresh grant.
- **Uninstall:** deactivate plugin, stop MCP, remove plugin rows/files through the existing Module, delete bindings, retain referenced resources.
- **Cleanup:** calculate references from bindings, honor active leases, show reclaimable size, require explicit user action for large shared models.
- **Revocation:** disable affected plugin/resource and show remediation; never silently execute revoked bytes.

## 20. IPC Contract

Proposed channels:

| Channel | Input | Result |
| --- | --- | --- |
| `plugin-hub:catalog` | filter | catalog page |
| `plugin-hub:detail` | plugin UUID | detail DTO |
| `plugin-hub:prepare-offer` | plugin/version UUID | consent offer |
| `plugin-hub:install` | operation + consent token | operation result |
| `plugin-hub:cancel` | operation ID | cancellation result |
| `plugin-hub:update` | plugin name | offer/result |
| `plugin-hub:repair` | plugin name | result |
| `plugin-hub:resources` | none | storage DTO |
| `plugin-hub:remove-unused-resource` | resource key + consent | result |
| `plugin-hub:progress` | main-to-renderer only | sanitized progress |

All invoke inputs use strict Zod schemas with UUID, enum, length, and control-character limits. These are plugin-management operations, so use `registerValidatedHandler`, not the AI request gate. Actual MCP inference handlers still follow the existing AI-enable policy.

## 21. Renderer Design

Tabs become `Installed | Plugin Hub | Marketplaces | Errors`. The Plugin Hub tab supports search, category, access and compatibility badges, pagination, and retry. Selecting a card opens a route/dialog keyed by plugin UUID.

The detail page shows capabilities, permissions, version, author, platform targets, runtime, model/license, hardware, download size, installed reuse, subscription policy, and Install/Upgrade/Unsupported states.

The install dialog separates new downloads, reused resources, total temporary/installed disk, warnings, and cancellation behavior. It never renders signed URLs or paths.

All new text uses `t()` with English fallback and matching keys in `en.ts`, `zh.ts`, `es.ts`, `fr.ts`, `de.ts`, and `ja.ts`.

## 22. Security Boundaries

| Boundary | Rule |
| --- | --- |
| Renderer to main | Strict IPC schemas; no URL/path/executable authority |
| Main to Hub | Fixed base origin, bounded input, authenticated only when needed |
| Hub to object host | Only Hub-granted paths and compiled hosts |
| Archive to filesystem | Containment and expansion limits |
| Plugin to runtime | Declared entry and approved environment only |
| Plugin to model | Read-only validated snapshot path |
| Worker to database | No direct database access |
| Premium cache to entitlement | Bytes and authorization remain independent |

Diagnostics redact secrets and report only stable codes, IDs, phases, sizes, and hashes where safe.

## 23. Failure Recovery

| Failure | Behavior |
| --- | --- |
| Catalog unavailable | Show cached catalog as stale; disable new preparation |
| Plan stale | Refetch plan and request consent again |
| Subscription required | Show upgrade action; download nothing |
| Disk becomes full | Cancel, delete partial staging, preserve active version |
| Hash mismatch | Quarantine bytes, fail resource, never extract |
| Crash during extraction | Startup removes orphan staging |
| Crash after import | Reconcile installation/bindings and complete or roll back |
| MCP health timeout | Stop child, fail activation, preserve prior version |
| Resource revoked | Disable use and require update/remediation |
| Cleanup race | Lease prevents removal; retry after process exit |

## 24. Observability

Local structured events include operation ID, plugin/version/resource IDs, target, phase, duration, byte counts, reuse, stable error code, and Hub request ID. They exclude token, ticket, URL query, model path, source credentials, and raw hardware IDs.

Best-effort Hub telemetry records install/update/uninstall only after local state transition. Telemetry failure never rolls back a valid install.

## 25. Test Strategy

### 25.1 Unit

- Strict network and IPC schemas.
- Target selection and compatibility.
- Consent expiry, replay, and plan mismatch.
- Runtime/environment/model identity.
- Path construction and containment.
- Model blob deduplication.
- Reference counting and leases.
- entitlement policy and offline grace.

### 25.2 Main-process integration

- Catalog/detail/plan/prepare with an HTTP stub.
- Redirect/token stripping.
- Interrupted and resumed downloads.
- ZIP traversal, links, bombs, duplicate paths, and hash mismatch.
- Full install into temporary userData and SQLite.
- Rollback at every coordinator phase.
- Repair/update/uninstall with shared resources.

### 25.3 Worker

- Managed Python and import probe.
- MCP initialization timeout and process cleanup.
- Prove no worker database access.

### 25.4 Renderer

- Loading, empty, retry, free, premium, unsupported, update, progress, and cancellation states.
- Keyboard/focus behavior and large-size formatting.
- Translation key parity for all six languages.

### 25.5 Contract

Pin shared JSON fixtures in both repositories. CI validates the same catalog, detail, plan, prepare, error, resource-manifest, and ticket shapes. Breaking changes require a schema-version increment.

## 26. Implementation Sequence

1. Add types, schemas, config, Hub client, and contract fixtures.
2. Add ID catalog/detail IPC and Plugin Hub UI without installation.
3. Add local persistence, path/state, resource identity, and reconciliation.
4. Add canonical plugin artifact download and import.
5. Add managed CPython and Python environment installation.
6. Add content-addressed model cache and launcher mounting.
7. Add consent, prepare-install, subscription handling, and tickets.
8. Add update, repair, uninstall, storage management, leases, and runtime enforcement.
9. Add fault injection, end-to-end tests, metrics, and staged rollout.

Each phase remains behind `pluginHubManagedInstallEnabled` until its contract tests pass.

## 27. PRD Traceability

| PRD area | Design sections |
| --- | --- |
| Community tab/detail | 7, 20, 21 |
| Stable ID flow | 7, 11 |
| No Git/npm/Python | 4, 14-17 |
| `mcp/servers.json` | 6, 10 |
| Platform targeting | 9, 13 |
| Shared environment/model cache | 11-13, 19 |
| Subscription gating | 7, 8, 18 |
| Hub vs marketplace | 1, 3, 14 |
| Security | 6-8, 15-18, 22 |
| Recovery and lifecycle | 14, 19, 23 |

## 28. Related Documents

- `docs/prd/plugin-hub-managed-installation-prd.md`
- `docs/prd/community-plugin-page-technical-design.md`
- `docs/prd/plugin-marketplace-support-technical-design.md`
- `docs/prd/downloadable-local-ai-runtimes-technical-design.md`
- `docs/skills/Plugin_Management_System_Technical_Design.md`
