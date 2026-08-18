# AiFetchly Plugin Hub Discovery and Managed Local Installation PRD

## Document Information

| Field | Value |
| --- | --- |
| Document version | v1.0 |
| Status | Proposed |
| Created | 2026-08-09 |
| Owner | AiFetchly Desktop Product and Engineering |
| Primary repository | `/home/robertzeng/project/aiFetchly` |
| Product areas | Plugin Manager, Plugin Hub, managed runtimes, shared model cache, subscriptions |
| Supported desktop targets | Windows, macOS, and Linux targets explicitly published by the Hub |
| Hub counterpart | `/home/robertzeng/project/aifetchly-hub-go/docs/plugin-hub-managed-distribution-prd.md` |

## 1. Summary

AiFetchly must let customers discover and install first-party and community plugins from the AiFetchly Plugin Hub without requiring Git, npm, Python, pip, compilers, or administrator access on the customer computer.

The desktop will add a first-party `Plugin Hub` tab to the existing Plugin Manager. The catalog remains small and optimized for browsing. Selecting a plugin opens a detail surface that loads the Hub's ID-based detail API and explains capabilities, permissions, platform support, managed runtime needs, model sizes, hardware recommendations, subscription access, and installed-resource reuse.

Installation uses a trusted, target-specific plan created by the Hub. The Hub and ordinary marketplaces use separate acquisition paths because their trust, authentication, entitlement, and resource behavior differ. Both acquisition paths converge on the existing local plugin validation, import, activation, diagnostics, persistence, and rollback pipeline.

For Python MCP plugins, AiFetchly owns a managed local runtime. Python environments are isolated but may be shared when their complete environment identity matches. Model data is stored in a content-addressed shared cache so multiple plugins can reuse the same immutable model revision without downloading duplicate bytes.

## 2. Background

AiFetchly already provides:

- Plugin installation from local folders, local ZIP files, GitHub, git, npm, and URL sources.
- Marketplace registration, refresh, discovery, detail, and installation.
- Plugin manifest validation and archive safety checks.
- Installed-plugin persistence, provenance, enable/disable, update, uninstall, diagnostics, and component loading.
- Per-skill Python virtual environments when a suitable system Python already exists.
- Downloadable first-party local AI runtime infrastructure with catalog fetching, target selection, checksums, safe extraction, staging, health checks, atomic activation, repair, and rollback.
- A Community Plugin Stage 1 proposal focused on catalog browsing and tier display.

The remaining product gap is a complete first-party Hub installation path. The current source fetchers can invoke local `git` and `npm` commands, and `SkillEnvironmentManager` searches for `PYTHON_BIN`, `python3`, or `python`. Those assumptions are unsuitable for ordinary customers.

## 3. Problem

### 3.1 Developer tools are not customer prerequisites

Many customer computers do not have Git, npm, Python, pip, build tools, or a configured shell environment. Requiring those tools makes plugin installation fail for reasons unrelated to the plugin.

### 3.2 Python AI plugins carry several independent resources

A plugin such as a ShowUI MCP bridge may need:

- A compatible CPython runtime.
- Python packages such as MCP, PyTorch, Transformers, and Pillow.
- Native packages selected for the operating system and architecture.
- CPU, CUDA, or Apple MPS variants.
- Several gigabytes of model weights and tokenizer/configuration files.
- A plugin package containing the MCP entrypoint and manifest.

Treating all of these as one plugin ZIP prevents reuse, causes duplicate downloads, and makes updates expensive.

### 3.3 Catalog browsing and installation have different data needs

The catalog list needs names, descriptions, categories, ratings, and access state. It does not need lockfile hashes, artifact URLs, model file manifests, or target-specific runtime metadata.

The detail surface needs human-readable requirements. The installer needs exact immutable artifacts for the current device. Combining these shapes makes catalog responses large and risks exposing sensitive or short-lived download information to the renderer.

### 3.4 Subscription access cannot be a UI-only decision

Free members may view a subscription plugin's public detail page but must not receive its private source, artifact URL, install ticket, or managed resource grants. A modified renderer must not bypass server-side entitlement checks.

### 3.5 Platform support belongs to versions and artifacts

A plugin may be Windows-only today and add macOS support in a later release. Python and native packages can also differ across `win32`, `darwin`, `linux`, `x64`, `arm64`, CPU, CUDA, and MPS targets. A single top-level platform field cannot represent this lifecycle.

## 4. Goals

1. Add a first-party Plugin Hub browsing and detail experience inside Plugin Manager.
2. Use stable plugin and version IDs for detail, installation, updates, telemetry, and resource bindings.
3. Install Hub plugins without customer-installed Git, npm, Python, pip, or compilers.
4. Select only Hub-validated artifacts compatible with the running device.
5. Download managed resources only after the user sees sizes, hardware needs, permissions, and grants consent.
6. Share immutable Python environments when their complete environment identity matches.
7. Share immutable model revisions across plugins through a content-addressed cache.
8. Keep Hub acquisition separate from arbitrary marketplace acquisition while reusing one local import and activation core.
9. Enforce subscription access on the Hub and reflect it accurately in the desktop UI.
10. Preserve safe updates, repair, rollback, uninstall, and offline behavior.
11. Keep all network, credential, process, and filesystem operations in the Electron main process or controlled utility processes.
12. Provide complete English, Chinese, Spanish, French, German, and Japanese UI translations.

## 5. Non-Goals

1. Do not run arbitrary package-manager commands supplied by a plugin manifest.
2. Do not install or modify a system-wide Python distribution.
3. Do not modify global `PATH`, `PYTHONPATH`, `NODE_PATH`, pip configuration, or npm configuration.
4. Do not run `npm install`, `npm pack`, `pip install` from the public internet, compilers, plugin setup scripts, or Python package lifecycle code on customer computers.
5. Do not let the renderer provide artifact URLs, executable paths, model paths, or runtime IDs outside validated schemas.
6. Do not allow arbitrary third-party marketplaces to request privileged managed runtimes automatically in the first release.
7. Do not promise that every plugin supports every operating system, architecture, accelerator, or AiFetchly version.
8. Do not guarantee perfect copy protection after premium plugin files reach a customer device.
9. Do not implement hosted inference for heavy plugins as the default path.
10. Do not merge the Plugin Hub tab with user-configured marketplaces.

## 6. Users and Core Use Cases

### 6.1 Free member

- Browses the complete public Hub catalog.
- Opens details for free and subscription plugins.
- Sees required plans and an Upgrade action for locked plugins.
- Installs compatible free plugins.

### 6.2 Subscription member

- Installs entitled plugins through short-lived Hub grants.
- Reuses already-installed runtimes, environments, and models.
- Receives updates only while the relevant entitlement policy permits them.

### 6.3 Offline or privacy-sensitive user

- Uses installed local plugins without hosted inference.
- Sees which resources must be downloaded before installation.
- Can keep shared model data after uninstalling one plugin.
- Can inspect and explicitly clear unused resources.

### 6.4 Power user

- Continues to add and install from custom marketplaces.
- Can import local packages and direct sources through existing workflows.
- Sees source provenance clearly distinguished from Hub provenance.

## 7. Product Principles

### 7.1 Logical declarations, trusted resolution

Plugin packages declare logical needs such as Python 3.11, a pinned lockfile, and a specific model revision. They do not choose trusted download URLs. The Hub resolves declarations into approved artifacts.

### 7.2 Preview, consent, then grant

The detail API provides human-readable requirements. A read-only install plan provides exact compatible sizes and reuse. The main process creates a local one-time consent binding. Only after confirmation does the desktop request download grants.

### 7.3 Shared bytes do not imply shared authorization

The physical presence of a cached model or environment does not grant permission to activate a subscription plugin. Resource reuse and plugin entitlement are separate decisions.

### 7.4 Versioned immutable resources

Plugin packages, runtimes, Python environments, and model revisions are immutable. Updates install alongside the current version, pass health checks, then switch an atomic active pointer or plugin binding.

### 7.5 One local installation core

Hub and marketplace sources acquire bytes differently. Once a verified local plugin root exists, both paths use the same manifest validation, component import, permission, persistence, activation, and rollback behavior.

## 8. Information Architecture

The Plugin Manager will expose:

```text
Installed | Plugin Hub | Marketplaces
```

### 8.1 Installed

Shows locally installed plugins from every source, including provenance, enabled state, version, health, components, and update availability.

### 8.2 Plugin Hub

Shows the official Hub catalog. Recommended user-facing label: `Plugin Hub`. Cards may carry `Community`, `Verified`, `Free`, or `Subscription` badges.

### 8.3 Marketplaces

Retains advanced user-configured marketplace management and direct-source installation. This area remains separate because its trust and compatibility guarantees differ.

## 9. Plugin Hub Catalog Experience

### 9.1 Catalog request

The main process calls:

```http
GET /api/v1/plugins/catalog
```

Supported filters:

- Search text.
- Category.
- Tags.
- Pagination.

The renderer never calls the Hub directly.

### 9.2 Minimum catalog entry

```json
{
  "id": "plugin-uuid",
  "currentVersionId": "version-uuid",
  "name": "showui-bridge",
  "displayName": "ShowUI Bridge",
  "description": "Locate UI elements with ShowUI-2B",
  "version": "1.0.0",
  "author": "showlab",
  "category": "automation",
  "tags": ["vision", "mcp"],
  "access": {
    "status": "allowed"
  },
  "stats": {
    "installs": 120,
    "activeInstalls": 80,
    "rating": 4.8,
    "reviews": 18
  }
}
```

The list does not need runtime artifacts, model manifests, lockfile hashes, or download URLs.

### 9.3 Local-state merge

The main process merges Hub entries with installed-plugin state using the stable Hub plugin ID and version ID. The UI can show:

- Not installed.
- Installed.
- Update available.
- Installed from another source.
- Local files missing.
- Entitlement changed.

## 10. Plugin Detail Experience

### 10.1 Detail request

```http
GET /api/v1/plugins/by-id/:pluginId
```

Name-based routes may remain for websites and backward compatibility, but the desktop uses the immutable ID.

### 10.2 Detail content

The detail surface shows:

- Name, description, author, version, license, homepage, and repository when public.
- Screenshots and release notes when provided.
- Rating, review count, and verified-install reviews.
- Skills, MCP servers, agents, commands, hooks, and permissions.
- Network, filesystem, automation, shell, and device access.
- Supported operating systems, architectures, and accelerator variants.
- Whether this device is compatible.
- Managed runtime name and version.
- Python environment approximate download and installed size.
- Model names, revisions, licenses, approximate sizes, and shared-cache status.
- Minimum memory, recommended memory, disk requirement, and GPU recommendation.
- Access status and required subscription plans.
- Existing resource reuse and the estimated additional download.

### 10.3 Detail access states

| Access status | Primary action |
| --- | --- |
| `allowed` | Install or Update |
| `login_required` | Sign in to install |
| `subscription_required` | Upgrade |
| `forbidden` | Installation unavailable |
| `unavailable` | Unsupported on this device |

The renderer displays the state. It does not calculate entitlement.

## 11. Plugin Package Declaration

Managed execution requirements originate in the plugin package. A Python MCP server should not declare `"command": "python"` because that assumes a system executable.

Example `mcp/servers.json`:

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
      "environment": {
        "lockfile": "mcp/requirements.lock"
      },
      "models": [
        {
          "modelId": "huggingface:showlab/showui-2b",
          "revision": "exact-immutable-revision",
          "format": "huggingface-snapshot",
          "mountEnv": "AIFETCHLY_MODEL_PATH"
        }
      ],
      "hardware": {
        "minMemoryMb": 8192,
        "recommendedMemoryMb": 16384,
        "minDiskMb": 12000,
        "accelerator": "optional",
        "cpuSupported": true
      }
    }
  }
}
```

The plugin package also includes:

```text
.aifetchly-plugin/plugin.json
mcp/servers.json
mcp/showui_server.py
mcp/requirements.lock
```

The lockfile must pin packages and artifact hashes. The Hub validation worker derives the installable resource projection from these files.

## 12. Platform and Device Compatibility

### 12.1 Target vocabulary

- Platforms: `win32`, `darwin`, `linux`.
- Architectures: `x64`, `arm64`.
- Accelerators: `none`, `cpu`, `cuda`, `mps`.

### 12.2 Device profile

The main process creates a renderer-safe compatibility profile from:

- `process.platform`.
- `process.arch`.
- AiFetchly application version.
- Electron and Node ABI only where a selected artifact contains Node-native modules.
- Available memory and disk space.
- Detected accelerator family and supported runtime versions.

Raw hardware identifiers and local paths are not sent to the renderer or Hub.

### 12.3 Compatibility result

```typescript
type PluginHubCompatibilityStatus =
  | "compatible"
  | "compatible_with_warning"
  | "unsupported_platform"
  | "unsupported_arch"
  | "unsupported_accelerator"
  | "insufficient_memory"
  | "insufficient_disk"
  | "incompatible_app_version"
  | "artifact_unavailable";
```

Installation must repeat target selection immediately before granting downloads.

## 13. Install Plan and Consent

### 13.1 Read-only plan

The main process requests:

```http
GET /api/v1/plugins/by-id/:pluginId/versions/:versionId/install-plan
    ?platform=win32
    &arch=x64
    &accelerator=cpu
    &appVersion=1.0.0
```

The response contains immutable IDs, exact versions, sizes, hashes, compatibility, and resource reuse keys. It must not expose private source metadata. For subscription resources it must not expose usable bearer URLs before entitlement preparation.

### 13.2 Consent offer

The main process compares plan resources with installed resources and returns a renderer-safe offer:

```json
{
  "operationId": "local-random-id",
  "pluginId": "plugin-uuid",
  "versionId": "version-uuid",
  "compatible": true,
  "newDownloads": [
    {"type": "runtime", "name": "Python 3.11", "bytes": 35000000},
    {"type": "environment", "name": "ShowUI Python environment", "bytes": 1800000000},
    {"type": "model", "name": "ShowUI-2B", "bytes": 4500000000}
  ],
  "reusedResources": [],
  "requiredDiskBytes": 6400000000,
  "warnings": ["GPU recommended"]
}
```

The operation ID and consent token are created by the main process, expire after five minutes, are one-time use, and bind plugin ID, version ID, target, plan digest, and displayed sizes.

### 13.3 Authorized preparation

After confirmation, the main process calls:

```http
POST /api/v1/plugins/by-id/:pluginId/versions/:versionId/prepare-install
```

The Hub rechecks publication state, target compatibility, artifact revocation, and subscription entitlement, then returns public artifact descriptors or short-lived ticket URLs.

## 14. Hub Acquisition Path

```text
Plugin Hub detail
  -> read-only target plan
  -> local consent
  -> Hub prepare-install
  -> download missing plugin/runtime/environment/model artifacts
  -> verify hashes and signatures
  -> extract into staging
  -> validate package manifests and required files
  -> health-check runtime, imports, model snapshot, and MCP initialization
  -> bind shared resources
  -> common plugin import and activation
  -> persist Hub provenance
  -> best-effort install telemetry
```

Hub downloads must stream to temporary files, enforce expected and maximum sizes, enforce HTTPS and redirect policy, verify SHA-256 before extraction, validate archive paths entry by entry, and activate only after all health checks pass.

## 15. Marketplace Acquisition Path

```text
Marketplace entry
  -> resolve GitHub/git/npm/ZIP/local source
  -> acquire local plugin root
  -> existing source and archive validation
  -> common plugin import and activation
  -> persist marketplace provenance
```

The first release does not allow an arbitrary marketplace manifest to request trusted Hub runtimes or ticketed resources. A future publisher trust system may enable signed third-party resource plans.

## 16. Common Local Installation Core

Both acquisition paths converge on:

- Plugin manifest parsing.
- Plugin name and version conflict handling.
- Path containment and symlink resistance.
- Skill, MCP, agent, command, and hook validation.
- Permission extraction and user approval.
- Database writes through the existing Module and Model layers.
- Component registration.
- Atomic replacement and rollback.
- Diagnostics.
- Enable/disable.
- Uninstall.

The Hub path adds resource bindings and entitlement provenance before activation. It must not duplicate `PluginImportService.installFromLocalRoot()` behavior.

## 17. Managed Python Runtime

### 17.1 Resolution order

For Hub-managed Python plugins:

```text
plugin-bound managed runtime
  -> compatible shared AiFetchly-managed CPython
  -> fail with managed-runtime remediation
```

The Hub path does not silently fall back to arbitrary system Python. Local/user skill workflows may retain an explicitly configured system-Python fallback under their existing policy.

### 17.2 Runtime location

```text
<userData>/managed-plugin-resources/runtimes/
  python-cpython/
    3.11.9/
      win32-x64/
      darwin-arm64/
      linux-x64/
```

Runtime paths are constructed only by a main-process path service using validated ID, semver, platform, and architecture segments.

### 17.3 Runtime lifecycle

States:

```text
not_installed
checking
download_required
downloading
verifying
extracting
health_checking
ready
failed
revoked
```

Updates install side by side. A loaded runtime version cannot be removed until all process leases close.

## 18. Shared Python Environments

### 18.1 Environment identity

The environment key is calculated from:

```text
SHA256(
  normalized requirements lock bytes
  + resolved Python runtime version
  + platform
  + architecture
  + accelerator backend
  + environment artifact format version
)
```

Only exact identity matches may be reused.

### 18.2 Environment location

```text
<userData>/managed-plugin-resources/environments/
  <environment-key>/
    manifest.json
    active.json
    <environment-version>/
```

The environment can be a verified relocatable environment or an offline wheel bundle consumed by the managed runtime installer. The customer machine must never fetch unpinned packages from a public package index.

### 18.3 Environment bindings

Installed-plugin metadata records the environment key, not an arbitrary filesystem path. The main process reconstructs and validates the path.

## 19. Shared Model Cache

### 19.1 Model identity

A reusable model snapshot is identified by:

- Canonical model ID.
- Exact immutable revision.
- Format.
- File manifest digest.

The model name alone is not a safe cache key.

### 19.2 Content-addressed layout

```text
<userData>/managed-plugin-resources/models/
  blobs/
    sha256/
      ab/cdef...
      12/3456...
  snapshots/
    huggingface/
      showlab/
        showui-2b/
          <revision>/
            manifest.json
```

Snapshot manifests map safe relative filenames to immutable blobs. Two snapshots may reuse an identical blob.

### 19.3 Model mounting

The launcher supplies a validated model path through a declared environment variable:

```text
AIFETCHLY_MODEL_PATH=<validated snapshot path>
HF_HUB_OFFLINE=1
TRANSFORMERS_OFFLINE=1
```

Plugin code must load the local path with offline-only behavior. Model downloads must never begin implicitly during MCP startup.

### 19.4 Retention

- Uninstalling a plugin removes its resource binding.
- Shared model bytes remain available while another installed plugin references them.
- The application does not automatically delete model caches when removing only a runtime.
- A storage-management UI lists total, referenced, and unused bytes.
- Users may explicitly remove unused resources.
- Active process leases prevent deletion during use.

## 20. MCP Launch and Isolation

The main process resolves:

- Managed Python executable.
- Plugin-contained entry path.
- Environment/site-package path.
- Model snapshot path.
- Approved environment variables.
- Working directory.

The process launches with `shell: false`. The renderer cannot supply commands or paths. Secrets are resolved at launch and never persisted in plugin-authored configuration.

The MCP receives only permissions granted to the plugin. Network and filesystem permissions remain visible and independently revocable.

## 21. Subscription Access

### 21.1 Public detail, gated installation

Subscription plugins use:

```text
visibility = public
entitlement = subscription
installMode = ticket
```

Free members may view detail metadata but cannot obtain download grants.

### 21.2 Enforcement

The Hub is authoritative. The desktop:

- Displays `access.status`.
- Sends authenticated preparation requests from the main process.
- Treats 401 as sign-in required.
- Treats `subscription_required` as an Upgrade state.
- Never converts cached resource presence into plugin authorization.

### 21.3 Cancellation policy

The minimum launch requirement is installation and update gating. The data contract must also support an admin policy:

- `install_only`: an already-installed plugin continues running.
- `runtime`: activation requires a current entitlement, with a configurable offline grace period.

The detail page must disclose the applicable policy before installation.

## 22. Installed Plugin Provenance

Add a distinct logical source:

```typescript
type PluginSource =
  | "local"
  | "builtin"
  | "marketplace"
  | "hub";
```

Hub provenance includes:

```json
{
  "hub": {
    "pluginId": "plugin-uuid",
    "versionId": "version-uuid",
    "version": "1.0.0",
    "planDigest": "sha256...",
    "target": {
      "platform": "win32",
      "arch": "x64",
      "accelerator": "cuda"
    },
    "resourceBindings": [
      {"type": "runtime", "resourceId": "runtime-release-id"},
      {"type": "environment", "resourceId": "environment-id"},
      {"type": "model", "resourceId": "model-revision-id"}
    ]
  }
}
```

This provenance supports updates, repair, telemetry, entitlement checks, and shared-resource retention.

## 23. Update, Repair, Rollback, and Uninstall

### 23.1 Update

- Compare installed Hub version ID with `currentVersionId`.
- Load new detail and plan.
- Show incremental download size and resource reuse.
- Install the new plugin and resources into staging.
- Keep the old plugin active until health checks pass.
- Switch bindings atomically.
- Retain rollback state until the next successful launch or policy-defined cleanup.

### 23.2 Repair

- Re-resolve the installed version by stable IDs.
- Re-download missing or corrupted resources.
- Verify all hashes and manifests.
- Do not silently move to a new version during repair.

### 23.3 Uninstall

- Stop MCP processes and release leases.
- Remove plugin components and installed-plugin rows through existing modules.
- Release runtime, environment, and model references.
- Preserve resources referenced elsewhere.
- Do not delete shared models automatically.
- Send best-effort Hub uninstall telemetry.

## 24. Offline Behavior

- Installed free plugins may run offline when all required resources are present.
- Install and update require network access.
- A cached detail response never authorizes installation.
- A cached install plan cannot mint new download grants.
- Runtime-entitled plugins follow their disclosed offline grace policy.
- Missing or revoked local resources produce a repair-required state, not an implicit public-network package install.

## 25. Security and Privacy Requirements

1. Hub network calls occur only in the main process.
2. The renderer receives no bearer tokens, signed artifact URLs, private source metadata, absolute resource paths, or executable commands.
3. Every IPC input uses strict Zod validation.
4. Plugin ID, version ID, resource ID, runtime ID, platform, architecture, and accelerator values use bounded allowlists.
5. Every download uses HTTPS, timeouts, redirect limits, maximum sizes, and streamed SHA-256 verification.
6. Archive extraction rejects traversal, absolute paths, unsafe links, duplicate entries, excessive file counts, oversized entries, and decompression bombs.
7. Package manifests are validated before activation.
8. Runtime and model catalogs are trusted only from compiled Hub configuration and approved artifact hosts.
9. Subscription checks occur again at download-grant issuance.
10. Secrets and signed URLs are redacted from logs and diagnostics.
11. Model paths remain internal. The renderer receives model IDs and sizes only.
12. The desktop never executes package installation scripts from a plugin.

## 26. IPC and Main-Process Surface

Proposed channels:

| Channel | Purpose | Renderer-safe output |
| --- | --- | --- |
| `plugin:hub:list` | List catalog entries | Catalog page |
| `plugin:hub:detail` | Load ID-based detail | Detail view |
| `plugin:hub:prepare-offer` | Resolve target plan and local reuse | Consent offer |
| `plugin:hub:install` | Consume local consent binding and install | Progress/result |
| `plugin:hub:cancel-install` | Cancel active operation | Result |
| `plugin:hub:check-update` | Check installed Hub plugin | Update summary |
| `plugin:hub:repair` | Repair installed version | Progress/result |
| `plugin:resource:list` | List shared resource usage | Storage summary |
| `plugin:resource:remove-unused` | User-approved cleanup | Removed byte count |

These handlers are plugin-management functions, not AI inference functions. They use the non-AI-gated validated handler. Subscription enforcement belongs to the Hub install flow.

## 27. UI Requirements

### 27.1 Catalog

- Search, category, tag filters, pagination, refresh.
- Loading skeletons.
- Offline/error/empty states.
- Installed and update badges.
- Free/subscription/verified/community badges.

### 27.2 Detail

- Clear compatibility result for the current device.
- Requirements grouped into plugin, runtime, environment, models, and hardware.
- Permissions shown before install.
- Shared-cache savings shown before consent.
- Upgrade/sign-in actions derived from access status.
- Public review list and verified-install badges.

### 27.3 Installation

- Combined new-download and installed-size estimates.
- Per-resource progress and total progress.
- Cancel action.
- Low-disk and unsupported-device errors before download.
- Clear rollback result if activation fails.
- No hidden multi-gigabyte model download.

### 27.4 Resource storage

- Total managed resource size.
- Runtime, environment, and model breakdown.
- Referenced versus unused state.
- Explicit cleanup.
- Warning before removing resources needed by disabled plugins.

## 28. Internationalization and Accessibility

- Add all new user-facing text to `en.ts`, `zh.ts`, `es.ts`, `fr.ts`, `de.ts`, and `ja.ts`.
- Always provide the English fallback pattern used by the application.
- Progress is announced textually, not by color alone.
- Subscription and compatibility states have labels and icons.
- Install confirmation is keyboard accessible.
- Download sizes use localized units.
- Error messages explain the next action.

## 29. Telemetry and Observability

Desktop logs:

- Operation ID.
- Hub plugin and version IDs.
- Target tuple.
- Resource IDs and phases.
- Byte counts and duration.
- Stable error code.

Never log:

- Access tokens.
- Ticket IDs.
- Signed URLs.
- Private source metadata.
- Absolute user paths.
- Model contents.

Hub telemetry events remain best effort:

- Install after plugin persistence and activation succeed.
- Update after the new version becomes active.
- Uninstall after local removal succeeds.
- Heartbeat according to the existing privacy contract.

## 30. Functional Requirements

| ID | Requirement |
| --- | --- |
| DESK-HUB-001 | Plugin Manager exposes Installed, Plugin Hub, and Marketplaces as distinct surfaces. |
| DESK-HUB-002 | Catalog entries carry stable plugin and current-version IDs. |
| DESK-HUB-003 | Desktop detail requests use plugin ID, not name, as the operational identity. |
| DESK-HUB-004 | Catalog responses remain free of runtime/model artifact details. |
| DESK-HUB-005 | Detail shows human-readable runtime, model, hardware, platform, permission, access, and size requirements. |
| DESK-HUB-006 | Install plan binds plugin ID, version ID, device target, app version, and plan digest. |
| DESK-HUB-007 | Installation cannot begin without explicit consent to the displayed incremental download. |
| DESK-HUB-008 | Hub plugins install without system Git, npm, Python, pip, or compilers. |
| DESK-HUB-009 | Hub and marketplace acquisition use separate providers and one common import/activation core. |
| DESK-HUB-010 | Python runtime selection uses AiFetchly-managed CPython for Hub plugins. |
| DESK-HUB-011 | Exact environment identities are shared across plugins; non-identical targets remain isolated. |
| DESK-HUB-012 | Exact model revisions use a content-addressed cache shared across plugins. |
| DESK-HUB-013 | Model loading is offline-only from a verified local snapshot. |
| DESK-HUB-014 | Platform compatibility is evaluated per plugin version and resource target. |
| DESK-HUB-015 | Subscription state is rendered from the Hub and enforced again during preparation. |
| DESK-HUB-016 | Cached resources do not bypass plugin entitlement. |
| DESK-HUB-017 | Updates are staged and activated atomically with rollback. |
| DESK-HUB-018 | Uninstall releases bindings without deleting still-referenced resources. |
| DESK-HUB-019 | Shared model caches are not deleted automatically with runtime or single-plugin removal. |
| DESK-HUB-020 | Renderer never receives credentials, private artifact URLs, or executable paths. |
| DESK-HUB-021 | Every user-facing string is translated into all supported languages. |
| DESK-HUB-022 | Installation progress, cancellation, repair, and typed remediation errors are available. |

## 31. Error Contract

Required stable desktop errors include:

- `hub_unavailable`
- `hub_auth_required`
- `hub_subscription_required`
- `hub_plugin_not_found`
- `hub_version_changed`
- `hub_version_not_published`
- `hub_target_unsupported`
- `hub_artifact_unavailable`
- `hub_artifact_revoked`
- `hub_plan_expired`
- `hub_consent_invalid`
- `managed_resource_busy`
- `managed_resource_download_failed`
- `managed_resource_checksum_mismatch`
- `managed_resource_archive_unsafe`
- `managed_resource_manifest_invalid`
- `managed_resource_health_failed`
- `managed_resource_disk_insufficient`
- `plugin_activation_failed`
- `plugin_rollback_failed`

Errors returned to the renderer are sanitized and actionable.

## 32. Testing Requirements

### 32.1 Unit tests

- Catalog/detail schema parsing.
- Stable-ID validation.
- Device target detection.
- Compatibility selection.
- Consent token binding and expiration.
- Environment-key calculation.
- Model snapshot and blob path containment.
- Shared resource reference counting.
- Hub versus marketplace routing.
- Subscription UI-state mapping.

### 32.2 Main-process integration tests

- Catalog to detail to offer.
- Free Hub install with all resources missing.
- Install reusing runtime and model.
- Subscription install allowed and denied.
- Unsupported Windows/macOS/Linux target.
- Version changes between detail and prepare.
- Hash mismatch and unsafe archive rejection.
- Health-check failure with old plugin retained.
- Cancellation during each download phase.
- Repair of a missing environment or model.
- Uninstall with shared and unshared resources.

### 32.3 Packaged application tests

- Windows x64 managed Python MCP startup.
- macOS arm64 managed Python MCP startup.
- Every released target advertised by the Hub.
- No dependence on system `git`, `npm`, `python`, or `pip`.
- No network access during offline-only model initialization.

### 32.4 UI tests

- Catalog filters and pagination.
- ID-based detail navigation.
- All access states.
- Compatibility warnings.
- Shared-cache size calculation.
- Install confirmation and cancellation.
- Progress recovery after reopening the detail surface.
- Six-language rendering and missing-key detection.

## 33. Rollout Plan

### Phase 1: Hub detail and stable IDs

- Add Plugin Hub tab.
- Consume catalog with plugin/version IDs.
- Add ID-based detail.
- Merge local installed state.
- Display access and compatibility summaries.

### Phase 2: Public immutable plugin artifacts

- Add Hub acquisition provider.
- Download public plugin ZIP artifacts with checksum verification.
- Converge on the common import core.
- Persist Hub provenance.

### Phase 3: Managed Python runtime and environments

- Generalize safe runtime download infrastructure for CPython.
- Add environment cache and bindings.
- Launch Python MCPs from explicit managed paths.

### Phase 4: Shared model cache

- Add model snapshot catalog, content-addressed blobs, leases, and cleanup.
- Require offline-only model loading.
- Add disk and download consent UX.

### Phase 5: Subscription tickets and entitlement

- Add authenticated prepare-install.
- Redeem short-lived resource tickets.
- Add upgrade/sign-in flows.
- Implement disclosed cancellation policy.

### Phase 6: Updates, repair, storage management, and hardening

- Atomic updates and rollback.
- Repair.
- Shared-resource management UI.
- Packaged target matrix and fault-injection tests.

## 34. Success Metrics

- At least 95% of supported Hub plugins install successfully on a clean supported computer without developer tools.
- Zero install flows invoke customer-installed Git, npm, Python, pip, or compilers.
- A second plugin using an identical model revision downloads zero duplicate model bytes.
- A second plugin using an identical environment key downloads zero duplicate environment bytes.
- Unsupported devices are blocked before downloading large artifacts.
- No subscription artifact grant is issued to an ineligible user.
- No hidden model download begins during MCP startup.
- Failed updates preserve the previously working plugin.
- Every new UI string exists in all six language files.

## 35. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Python environments are not relocatable | Publish a defined relocatable format or offline wheel bundle and run target health tests. |
| PyTorch variants multiply storage | Deduplicate environments by identity and initially support a small approved CPU/CUDA/MPS matrix. |
| Models consume large disk space | Show sizes before consent, share blobs, expose storage management, and never auto-download. |
| A malicious plugin requests arbitrary runtime code | Accept only Hub-normalized plans and compiled runtime families; reject arbitrary marketplace requests. |
| Premium source leaks through compatibility marketplace | Exclude ticketed/subscription plugins and private source metadata from `marketplace.json`. |
| Subscription changes while offline | Apply the disclosed install-only or runtime grace policy; never claim stronger protection than delivered. |
| Resource cleanup breaks another plugin | Use bindings and process leases; delete only unused resources after explicit approval. |
| Hub and marketplace installers diverge | Share one acquired-plugin contract and one import/activation implementation. |

## 36. Acceptance Criteria

1. A clean supported computer without Git, npm, or Python can install and run a compatible Python MCP plugin from Plugin Hub.
2. The catalog list remains lightweight and the detail view loads requirements by stable plugin ID.
3. The customer sees exact incremental download and disk requirements before installation.
4. A Windows-only plugin is shown as unavailable on macOS and no artifact download begins.
5. Two plugins using the same pinned model revision share the same verified snapshot and blobs.
6. A free member can view a subscription plugin detail but cannot obtain install grants.
7. A subscriber can obtain target-scoped grants and install the same plugin.
8. A modified renderer cannot supply its own URL, executable, entitlement, or model path.
9. A failed runtime, environment, model, or plugin health check leaves the prior active installation intact.
10. Marketplace plugins continue using existing direct-source acquisition and cannot silently invoke privileged Hub resource installation.
11. Uninstalling one plugin does not remove resources still used by another.
12. The installed plugin records `hub` provenance with plugin ID, version ID, target, plan digest, and resource bindings.

## 37. Related Documents and Code

- `docs/prd/community-plugin-page-prd.md`: earlier Stage 1 browsing proposal.
- `docs/prd/plugin-marketplace-support-prd.md`: user-managed marketplace behavior.
- `docs/prd/downloadable-local-ai-runtimes-prd.md`: existing first-party downloadable runtime requirements.
- `docs/skills/PRD_Plugin_Management_System.md`: installed plugin product behavior.
- `src/service/PluginInstallService.ts`: current multi-source acquisition orchestrator.
- `src/service/PluginImportService.ts`: common local import pipeline.
- `src/service/PluginMarketplaceService.ts`: marketplace discovery and installation.
- `src/service/SkillEnvironmentManager.ts`: current system-Python-based per-skill environments.
- `src/service/localAiRuntime/`: existing runtime catalog, download, extraction, compatibility, state, and health patterns.
- `src/main-process/communication/local-ai-runtime-ipc.ts`: current trusted runtime catalog configuration.
