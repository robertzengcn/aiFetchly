# Plugin Marketplace Support - Product Requirements Document

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-07-09
- **Owner**: AiFetchly Desktop Engineering
- **Related docs**:
  - `docs/skills/PRD_Plugin_Management_System.md`
  - `docs/skills/Plugin_Management_System_Technical_Design.md`
  - `docs/prd/claude-code-plugin-compatibility-prd.md`
  - `docs/prd/claude-code-plugin-compatibility-tech-design.md`
  - `docs/superpowers/plans/2026-06-18-plugin-multi-source-install.md`
  - `src/views/components/plugins/PluginManager.vue`
  - `src/views/api/plugins.ts`
  - `src/service/PluginInstallService.ts`
  - Claude Code discover plugins: <https://code.claude.com/docs/en/discover-plugins>
  - Claude Code plugin marketplaces: <https://code.claude.com/docs/en/plugin-marketplaces>

## 1. Executive Summary

AiFetchly already supports local plugin installation, multi-source plugin fetchers, Claude plugin compatibility, skills, and plugin-owned MCP servers. Users can install a plugin from a direct source such as a ZIP, local folder, git repository, GitHub URL, npm package, or remote URL. The missing capability is **marketplace support**: users cannot add a plugin catalog, browse the plugins listed by that catalog, and install individual plugins from it.

This PRD defines Plugin Marketplace Support for AiFetchly. A marketplace is a catalog of installable plugins. Adding a marketplace registers and caches the catalog. It does not install any plugin by itself. After adding a marketplace, users can browse available plugin entries and install a selected plugin by resolving its catalog source into the existing `PluginInstallService` pipeline.

The recommended first release is a local-first MVP:

- Add, list, refresh, and remove marketplaces.
- Browse marketplace plugin entries in a new Discover tab.
- Install a plugin from `plugin-name@marketplace-name`.
- Persist marketplace provenance on installed plugin records.
- Use the existing plugin loader, skill registry, MCP runtime, and Plugin Manager detail views.
- Defer auto-update, dependencies, admin policies, and suggested plugins to later phases.

## 2. Background

### 2.1 Current AiFetchly Plugin Capabilities

AiFetchly already has these plugin foundations:

- `PluginManager.vue` displays installed plugins and supports import, install from source, reload, enable, disable, uninstall, and details.
- `src/views/api/plugins.ts` exposes renderer APIs for installed plugin operations.
- `plugin-ipc.ts` keeps IPC handlers thin and routes work through modules/services.
- `PluginManagementModule` and `InstalledPluginModel` persist installed plugin state.
- `PluginInstallService` resolves direct sources and delegates installation to `PluginImportService.installFromLocalRoot`.
- `PluginSourceKind` currently supports `local-zip`, `local-folder`, `git`, `github`, `npm`, and `url`.
- `parsePluginIdentifier()` already understands Claude-style `name@marketplace` identifiers.
- Installed plugin summaries already include `source: "marketplace"` as a supported enum value, but marketplace flows are not implemented.

### 2.2 Claude Code Marketplace Model

Claude Code's marketplace behavior has two separate actions:

1. **Add marketplace**: register and cache a plugin catalog.
2. **Install plugin**: install one selected plugin entry from that catalog.

Claude marketplace files are `marketplace.json` manifests, usually under `.claude-plugin/marketplace.json` when hosted in a repository. Marketplace entries include a public plugin `name`, metadata, and a `source` that tells the installer where to fetch the plugin. Supported plugin entry sources include relative paths inside the marketplace repository, GitHub repositories, git URLs, git subdirectories, and npm packages.

AiFetchly should adopt this mental model because it matches user expectations from Claude Code and reuses our existing plugin compatibility work.

## 3. Problem Statement

Users can install a plugin only when they already know the exact plugin source. That creates three problems:

1. **Discovery gap**: users cannot browse trusted plugin catalogs from AiFetchly.
2. **Distribution friction**: plugin authors and teams cannot share a single catalog that users add once.
3. **Update blind spot**: AiFetchly cannot tell whether an installed plugin came from a catalog entry or whether that catalog has a newer entry.

The current "Install from Source" dialog is useful for developers and power users, but it is not enough for normal plugin distribution.

## 4. Goals

1. Let users add a plugin marketplace from GitHub, git, local folder/file, or remote URL.
2. Let users browse all available plugins from added marketplaces.
3. Let users install individual marketplace plugins using `plugin-name@marketplace-name`.
4. Reuse the existing `PluginInstallService` and source fetchers for actual plugin installation.
5. Persist marketplace catalogs and installed plugin provenance in SQLite through Model and Module layers.
6. Show source, version, status, and errors clearly in the Plugin Manager.
7. Keep marketplace operations safe, recoverable, and diagnosable.
8. Support Claude marketplace schema enough for real-world Claude marketplace repositories.
9. Update all UI text in `en`, `zh`, `es`, `fr`, `de`, and `ja`.

## 5. Non-Goals

The first release will not include:

- Automatic plugin updates at app startup.
- Automatic marketplace refresh at app startup.
- Marketplace allowlist/blocklist policies.
- Cross-marketplace dependency installation.
- Organization-managed marketplaces.
- Plugin relevance suggestions based on workspace content.
- Ratings, reviews, download counts, or cloud-hosted marketplace search.
- Publishing marketplaces from inside AiFetchly.
- Running marketplace code. A marketplace is data only.
- Installing plugins directly from the public Claude web catalog unless it is exposed as a supported marketplace source.

## 6. Target Users

### 6.1 Marketing Operator

Wants to browse a curated list of marketing automation plugins and install one without understanding git, npm, or plugin manifests.

### 6.2 Team Admin

Wants to give a team a marketplace URL that lists approved internal plugins. The admin needs visible marketplace health and a clear remove path.

### 6.3 Plugin Author

Wants to publish several plugins in one marketplace repository and let AiFetchly users install them without manually pasting each plugin source.

### 6.4 Power User

Wants to add Claude-compatible community marketplaces and inspect plugin contents before installation.

## 7. User Stories And Acceptance Criteria

### 7.1 Add Marketplace

As a user, I can add a marketplace source so that AiFetchly can browse plugins from it.

Acceptance criteria:

- The Plugin Manager has a Marketplaces tab.
- The tab has an Add Marketplace action.
- Supported inputs:
  - GitHub shorthand, such as `owner/repo`.
  - Git URL, such as `https://gitlab.com/team/plugins.git` or `git@github.com:team/plugins.git`.
  - Local directory containing `.claude-plugin/marketplace.json`.
  - Local path directly to `marketplace.json`.
  - Remote HTTPS URL directly to `marketplace.json`.
- Optional `ref` is supported for git-backed sources.
- AiFetchly validates the fetched `marketplace.json` before saving it.
- Adding a marketplace with an existing marketplace name asks for replace confirmation.
- Adding a marketplace does not install any plugin.
- Errors are shown as structured messages, not raw stack traces.

### 7.2 List Marketplaces

As a user, I can see every configured marketplace and its health.

Acceptance criteria:

- The Marketplaces tab shows name, owner, source, plugin count, health, last fetched time, and actions.
- Health states include Healthy, Invalid, Missing Files, Fetch Failed, and Disabled.
- Selecting a marketplace shows manifest metadata and the latest validation errors.
- A marketplace with invalid entries still appears, but invalid entries are excluded from install actions.

### 7.3 Refresh Marketplace

As a user, I can refresh a marketplace catalog so that I see new or updated plugin entries.

Acceptance criteria:

- Each marketplace row has a Refresh action.
- Refresh re-fetches the marketplace from its original source.
- Refresh validates the new manifest before replacing the cached manifest.
- If refresh fails, the previous good cache remains available.
- The UI shows last refresh status and last refresh error.

### 7.4 Remove Marketplace

As a user, I can remove a marketplace I no longer trust or need.

Acceptance criteria:

- Remove asks for confirmation.
- The confirmation explains whether installed plugins from that marketplace will be left installed or removed.
- MVP behavior: removing a marketplace does **not** uninstall already installed plugins. It only removes the catalog.
- Installed plugins from a removed marketplace keep their existing installed files and remain manageable from the Installed tab.
- Future behavior may offer "remove marketplace and uninstall its plugins" as an optional action.

### 7.5 Discover Plugins

As a user, I can browse available plugins across all added marketplaces.

Acceptance criteria:

- Plugin Manager has a Discover tab.
- Discover lists plugin entries from all healthy marketplace caches.
- Columns include Plugin, Marketplace, Version, Category, Source, Capabilities, Status, and Actions.
- Search matches plugin name, display name, description, tags, category, author, and marketplace.
- Filters include Marketplace, Category, Installed, Not Installed, Has Skills, Has MCP Servers, Has Hooks, and Has Errors.
- Selecting a plugin opens a detail panel before install.

### 7.6 Review Plugin Before Install

As a user, I can inspect a marketplace plugin before installing it.

Acceptance criteria:

- Detail panel shows:
  - Plugin name and display name.
  - Marketplace name.
  - Description.
  - Version.
  - Author.
  - Homepage and repository links.
  - Source type.
  - Pinned ref or SHA when available.
  - Declared skills, commands, agents, hooks, MCP servers, LSP servers, output styles, and monitors when discoverable from catalog metadata.
- If full capability inventory requires fetching the plugin, the UI labels that as "Preview after fetch" or performs a safe dry-run fetch.
- Install requires explicit confirmation for plugins declaring hooks, MCP servers, monitors, shell commands, or npm sources.

### 7.7 Install Marketplace Plugin

As a user, I can install one plugin from a marketplace.

Acceptance criteria:

- Install accepts a plugin identifier in the form `plugin-name@marketplace-name`.
- Install resolves the marketplace entry source into an existing `PluginSourceRequest`.
- Install delegates to `PluginInstallService.installFromSource()`.
- Installed plugin row has `source: "marketplace"`.
- Installed plugin provenance records:
  - Marketplace name.
  - Marketplace source.
  - Marketplace entry name.
  - Marketplace entry version.
  - Marketplace entry source object.
  - Resolved source kind.
  - Resolved source URI.
  - Resolved source ref or SHA when present.
- Install result appears in the Installed tab and existing Plugin Detail Panel.
- Plugin capabilities are loaded through existing plugin reload behavior.

### 7.8 Handle Already Installed Plugins

As a user, I can see whether a marketplace plugin is already installed.

Acceptance criteria:

- Discover tab marks already installed plugins.
- If installed version matches marketplace version, action reads Installed.
- If installed version differs, action reads Update when update support exists or Reinstall in MVP.
- Installing an already installed plugin asks for overwrite confirmation.
- Existing per-component enable state is preserved on overwrite when plugin name matches.

### 7.9 Diagnostics

As a user, I can understand marketplace and marketplace-plugin failures.

Acceptance criteria:

- Marketplace errors are separate from installed plugin errors.
- Errors include code, message, source, recoverable flag, and affected marketplace/plugin entry when available.
- Diagnostics export includes marketplace state and installed marketplace plugin provenance.
- Network, git, npm, and manifest validation errors redact secrets and auth tokens.

## 8. Functional Requirements

### 8.1 Marketplace Source Parsing

AiFetchly must parse marketplace input into a structured source:

```typescript
export type PluginMarketplaceSourceKind =
  | "github"
  | "git"
  | "local-folder"
  | "local-file"
  | "url";

export interface PluginMarketplaceSource {
  readonly kind: PluginMarketplaceSourceKind;
  readonly uri: string;
  readonly ref?: string;
}
```

Parsing rules:

- `owner/repo` becomes `{ kind: "github", uri: "owner/repo" }`.
- `https://...git` and `git@...` become `{ kind: "git", uri }`.
- Existing local directories become `{ kind: "local-folder", uri }`.
- Existing local files named `marketplace.json` become `{ kind: "local-file", uri }`.
- `https://.../marketplace.json` becomes `{ kind: "url", uri }`.
- Control characters and CRLF are rejected in all string fields.
- Relative local paths are resolved to absolute paths before persistence.

### 8.2 Marketplace Manifest Schema

MVP supports this marketplace shape:

```typescript
export interface PluginMarketplaceManifest {
  readonly name: string;
  readonly owner: {
    readonly name: string;
    readonly email?: string;
    readonly url?: string;
  };
  readonly description?: string;
  readonly version?: string;
  readonly metadata?: {
    readonly pluginRoot?: string;
    readonly description?: string;
    readonly version?: string;
    readonly [key: string]: unknown;
  };
  readonly plugins: readonly PluginMarketplaceEntry[];
  readonly renames?: Record<string, string | null>;
  readonly allowCrossMarketplaceDependenciesOn?: readonly string[];
}
```

Required validation:

- `name` must match `^[a-z0-9][a-z0-9_-]*$`.
- `owner.name` is required.
- `plugins` must be an array.
- Plugin entry names must be unique within one marketplace.
- Reserved marketplace names may be blocked in a future policy phase. MVP should warn when a name appears to impersonate official Claude marketplaces, but not block unless the list is explicit in code.

### 8.3 Marketplace Plugin Entry Schema

MVP supports:

```typescript
export interface PluginMarketplaceEntry {
  readonly name: string;
  readonly displayName?: string;
  readonly description?: string;
  readonly version?: string;
  readonly author?: string | { readonly name: string; readonly email?: string; readonly url?: string };
  readonly homepage?: string;
  readonly repository?: string;
  readonly license?: string;
  readonly keywords?: readonly string[];
  readonly category?: string;
  readonly tags?: readonly string[];
  readonly source: PluginMarketplaceEntrySource;
  readonly defaultEnabled?: boolean;
  readonly strict?: boolean;

  readonly skills?: unknown;
  readonly commands?: unknown;
  readonly agents?: unknown;
  readonly hooks?: unknown;
  readonly mcpServers?: unknown;
  readonly lspServers?: unknown;
  readonly outputStyles?: unknown;
  readonly experimental?: unknown;
}
```

Supported entry sources:

```typescript
export type PluginMarketplaceEntrySource =
  | string
  | { readonly source: "github"; readonly repo: string; readonly ref?: string; readonly sha?: string }
  | { readonly source: "url"; readonly url: string; readonly ref?: string; readonly sha?: string }
  | { readonly source: "git-subdir"; readonly url: string; readonly path: string; readonly ref?: string; readonly sha?: string }
  | { readonly source: "npm"; readonly package: string; readonly version?: string; readonly registry?: string };
```

Rules:

- String sources must start with `./` and resolve inside the marketplace root.
- `../` path traversal is rejected.
- `git-subdir` requires new fetcher support or is marked unsupported until implemented.
- `sha`, when present, must be preferred over `ref` for git-backed plugin sources.
- npm auth tokens are never stored in marketplace manifests or installed plugin provenance.

### 8.4 Marketplace Cache

Marketplace cache must store a local copy of the catalog so Discover can work without a network call.

Cache behavior:

- GitHub/git sources are cloned or refreshed into an app-managed marketplace cache directory.
- URL sources cache the downloaded JSON file.
- Local folder/file sources store a resolved path and a copy of the last parsed manifest JSON.
- Cache writes are atomic: write to temp location, validate, then replace.
- Refresh failure must not destroy the previous good cache.

Recommended path helpers:

- `getPluginMarketplaceRoot()`
- `getPluginMarketplaceCacheRoot(name: string)`
- `getPluginMarketplaceManifestPath(name: string)`

### 8.5 Marketplace Install Resolution

Installing `plugin-name@marketplace-name` follows this flow:

1. Parse identifier with existing `parsePluginIdentifier()`.
2. Load marketplace by name from database/cache.
3. Find plugin entry by `name`.
4. Convert entry source to `PluginSourceRequest`.
5. Add marketplace provenance metadata.
6. Call `PluginInstallService.installFromSource()`.
7. Persist installed plugin source as `marketplace`.
8. Reload plugin component registry or prompt the user to reload.

Source conversion:

| Marketplace entry source | Install source request |
|---|---|
| `"./plugins/foo"` | `kind: "local-folder"`, `folderPath: <cached-marketplace-root>/plugins/foo` |
| `{ source: "github", repo, ref, sha }` | `kind: "github"`, `uri: repo`, `ref: sha ?? ref` |
| `{ source: "url", url, ref, sha }` | `kind: "git"` or `kind: "url"` based on URL classifier, `uri: url`, `ref: sha ?? ref` |
| `{ source: "git-subdir", url, path, ref, sha }` | Phase 2 `kind: "git-subdir"` or MVP unsupported error |
| `{ source: "npm", package, version, registry }` | `kind: "npm"`, `npmPackage`, `npmVersion`, `npmRegistry` |

### 8.6 Installed Plugin Provenance

Extend installed plugin provenance without breaking existing source install records.

Recommended addition:

```typescript
export interface MarketplaceInstallMeta {
  readonly marketplaceName: string;
  readonly marketplaceSource: PluginMarketplaceSource;
  readonly marketplaceVersion?: string;
  readonly entryName: string;
  readonly entryVersion?: string;
  readonly entrySource: PluginMarketplaceEntrySource;
  readonly resolvedAt: string;
}
```

Store this inside `InstalledPluginEntity.sourceMetaJson` under:

```json
{
  "marketplace": {
    "marketplaceName": "team-tools",
    "entryName": "lead-research",
    "entryVersion": "1.2.0"
  }
}
```

## 9. Data Model Requirements

### 9.1 New Entity: PluginMarketplaceEntity

Create `src/entity/PluginMarketplace.entity.ts`.

Fields:

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | integer | yes | Primary key |
| `name` | text | yes | Unique marketplace identifier |
| `displayName` | text | no | Optional human name |
| `ownerName` | text | yes | From manifest owner |
| `ownerEmail` | text | no | From manifest owner |
| `description` | text | no | Marketplace description |
| `version` | text | no | Marketplace version |
| `sourceKind` | text | yes | `github`, `git`, `local-folder`, `local-file`, `url` |
| `sourceUri` | text | yes | Redacted source URI for display |
| `sourceRef` | text | no | Branch/tag/ref |
| `installPath` | text | no | Local marketplace cache root |
| `manifestJson` | text | yes | Validated marketplace manifest |
| `pluginCount` | integer | yes | Derived during save for fast list |
| `enabled` | integer | yes | Default 1 |
| `autoUpdate` | integer | yes | Default 0 in MVP |
| `health` | text | yes | `healthy`, `invalid`, `fetch_failed`, `missing_files`, `disabled` |
| `lastErrorJson` | text | yes | Structured errors |
| `lastFetchedAt` | datetime | no | Last successful fetch |
| `sourceMetaJson` | text | yes | Raw non-secret source metadata |

Indexes:

- Unique index on `name`.
- Index on `enabled`.
- Index on `health`.

### 9.2 New Model: PluginMarketplaceModel

Create `src/model/PluginMarketplace.model.ts`.

Methods:

- `findAll(): Promise<PluginMarketplaceEntity[]>`
- `findEnabled(): Promise<PluginMarketplaceEntity[]>`
- `findByName(name: string): Promise<PluginMarketplaceEntity | null>`
- `create(input: Partial<PluginMarketplaceEntity>): Promise<number>`
- `updateByName(name: string, patch: Partial<PluginMarketplaceEntity>): Promise<boolean>`
- `remove(name: string): Promise<boolean>`
- `toggle(name: string, enabled: boolean): Promise<boolean>`

The model must extend `BaseDb` and use the same repository initialization pattern as `InstalledPluginModel`.

### 9.3 New Module: PluginMarketplaceModule

Create `src/modules/PluginMarketplaceModule.ts`.

Methods:

- `listMarketplaces()`
- `getMarketplaceByName(name)`
- `createMarketplace(input)`
- `updateMarketplaceState(input)`
- `removeMarketplace(name)`
- `toggleMarketplace(name, enabled)`
- `setMarketplaceErrors(name, errors)`

This module is the only database-facing layer used by IPC and services.

## 10. Service Requirements

### 10.1 PluginMarketplaceService

Create `src/service/PluginMarketplaceService.ts`.

Responsibilities:

- Parse marketplace input.
- Fetch/cache marketplace manifests.
- Validate marketplace manifests.
- Persist marketplace records through `PluginMarketplaceModule`.
- List available marketplace plugins from cached manifests.
- Resolve marketplace plugin entries into install source requests.
- Install marketplace plugins through `PluginInstallService`.
- Redact secrets in all user-facing errors.

Public API:

```typescript
export class PluginMarketplaceService {
  async addMarketplace(req: AddPluginMarketplaceRequest): Promise<PluginMarketplaceSummary>;
  async listMarketplaces(): Promise<PluginMarketplaceSummary[]>;
  async getMarketplace(name: string): Promise<PluginMarketplaceDetail | null>;
  async refreshMarketplace(name: string): Promise<PluginMarketplaceSummary>;
  async removeMarketplace(name: string): Promise<void>;
  async listAvailablePlugins(filter?: PluginMarketplacePluginFilter): Promise<PluginMarketplacePluginSummary[]>;
  async getAvailablePlugin(pluginId: string): Promise<PluginMarketplacePluginDetail | null>;
  async installMarketplacePlugin(req: InstallMarketplacePluginRequest): Promise<PluginSummary>;
}
```

### 10.2 Marketplace Fetchers

Marketplace fetching is similar to plugin source fetching, but the target is a marketplace manifest, not a plugin package.

Create `src/service/pluginMarketplaces/`:

- `pluginMarketplaceTypes.ts`
- `pluginMarketplaceValidation.ts`
- `pluginMarketplacePaths.ts`
- `parseMarketplaceSource.ts`
- `GitHubMarketplaceFetcher.ts`
- `GitMarketplaceFetcher.ts`
- `LocalMarketplaceFetcher.ts`
- `UrlMarketplaceFetcher.ts`
- `PluginMarketplaceFetcherRegistry.ts`
- `pluginMarketplaceRedact.ts`

Fetcher contract:

```typescript
export interface PluginMarketplaceFetcher {
  readonly kind: PluginMarketplaceSourceKind;
  fetch(req: PluginMarketplaceFetchRequest): Promise<PluginMarketplaceFetchResult>;
}
```

Fetch result:

```typescript
export interface FetchedPluginMarketplace {
  readonly marketplaceRoot: string;
  readonly manifestPath: string;
  readonly manifestJson: string;
  readonly cleanup?: () => Promise<void>;
}
```

For git-backed marketplaces, `marketplaceRoot` is the cloned repository root. For direct URL sources, `marketplaceRoot` is a temp/cache directory containing only the downloaded marketplace file.

### 10.3 Validation

Use `zod` for marketplace manifest validation, matching existing IPC schema direction.

Validation returns structured errors:

```typescript
export type PluginMarketplaceErrorCode =
  | "marketplace-source-invalid"
  | "marketplace-fetch-failed"
  | "marketplace-manifest-not-found"
  | "marketplace-manifest-invalid-json"
  | "marketplace-schema-invalid"
  | "marketplace-name-conflict"
  | "marketplace-plugin-entry-invalid"
  | "marketplace-plugin-source-unsupported"
  | "marketplace-plugin-source-outside-root"
  | "marketplace-cache-missing"
  | "marketplace-remove-failed"
  | "unknown";
```

### 10.4 Relative Path Guard

Marketplace plugin entries using relative paths must never escape the marketplace root.

Required checks:

- Source string must start with `./`.
- Resolve path against marketplace root, not `.claude-plugin`.
- `path.resolve(marketplaceRoot, source)` must remain inside `marketplaceRoot`.
- Symlinks must be resolved with realpath before install if the source exists.
- Reject missing paths before invoking `PluginInstallService`.

## 11. IPC And Renderer API Requirements

### 11.1 New Channels

Add to `src/config/channellist.ts`:

```typescript
export const PLUGIN_MARKETPLACE_LIST = "plugin:marketplace:list";
export const PLUGIN_MARKETPLACE_GET = "plugin:marketplace:get";
export const PLUGIN_MARKETPLACE_ADD = "plugin:marketplace:add";
export const PLUGIN_MARKETPLACE_REFRESH = "plugin:marketplace:refresh";
export const PLUGIN_MARKETPLACE_REMOVE = "plugin:marketplace:remove";
export const PLUGIN_MARKETPLACE_AVAILABLE_PLUGINS = "plugin:marketplace:available-plugins";
export const PLUGIN_MARKETPLACE_GET_PLUGIN = "plugin:marketplace:get-plugin";
export const PLUGIN_MARKETPLACE_INSTALL_PLUGIN = "plugin:marketplace:install-plugin";
```

### 11.2 IPC Handler Rules

Add handlers in `plugin-ipc.ts` or a new `plugin-marketplace-ipc.ts` registered from `communication/index.ts`.

Rules:

- IPC handlers validate input with zod schemas.
- IPC handlers call `PluginMarketplaceService` only.
- IPC handlers do not parse marketplace JSON directly.
- IPC handlers do not access TypeORM repositories directly.
- String fields that reach git/npm/spawn reject CRLF and control characters.
- Error messages redact auth tokens, basic auth, query-string tokens, and bearer tokens.
- Because marketplace management affects AI-callable plugin capabilities, use the same AI-enable gate convention as the existing plugin IPC unless product explicitly decides marketplace browsing is allowed without AI features.

### 11.3 Renderer API

Extend `src/views/api/plugins.ts` or create `src/views/api/pluginMarketplaces.ts`.

Recommended new file: `pluginMarketplaces.ts`, to keep installed plugin API from growing too large.

Types:

- `PluginMarketplaceSourceKind`
- `PluginMarketplaceSummary`
- `PluginMarketplaceDetail`
- `PluginMarketplacePluginSummary`
- `PluginMarketplacePluginDetail`
- `AddPluginMarketplaceRequest`
- `InstallMarketplacePluginRequest`

Functions:

- `listPluginMarketplaces()`
- `getPluginMarketplace(name)`
- `addPluginMarketplace(req)`
- `refreshPluginMarketplace(name)`
- `removePluginMarketplace(name)`
- `listMarketplacePlugins(filter?)`
- `getMarketplacePlugin(pluginId)`
- `installMarketplacePlugin(req)`

## 12. UI Requirements

### 12.1 Plugin Manager Tab Layout

Refactor `PluginManager.vue` from a single installed-plugin table into tabs:

- **Installed**: current installed plugin table.
- **Discover**: marketplace plugin catalog.
- **Marketplaces**: marketplace management.
- **Errors**: marketplace and plugin loading errors.

The first screen remains functional. Do not add a marketing landing page.

### 12.2 Installed Tab

Existing behavior remains:

- Reload.
- Import.
- Install from Source.
- Enable/disable.
- Uninstall.
- Detail panel.

Additions:

- Source chip should show `Marketplace` for marketplace-installed plugins.
- Overview tab should show marketplace provenance when present.
- If marketplace has been removed, show "Marketplace removed" but keep plugin manageable.

### 12.3 Discover Tab

Create `PluginDiscoverTab.vue`.

Required controls:

- Search input.
- Marketplace filter.
- Category filter.
- Installed status filter.
- Refresh all button.

Required table columns:

- Plugin.
- Marketplace.
- Version.
- Category.
- Source.
- Capabilities.
- Status.
- Actions.

Actions:

- View details.
- Install.
- Reinstall/Update when already installed.

Status examples:

- Not Installed.
- Installed.
- Installed, different version.
- Unsupported source.
- Marketplace error.

### 12.4 Marketplace Plugin Detail Dialog

Create `PluginMarketplacePluginDetailDialog.vue`.

Sections:

- Overview.
- Source and version.
- Capabilities preview.
- Trust and risk.
- Install options.
- Raw marketplace entry JSON.

Install options:

- Overwrite existing plugin: checkbox.
- Enable after install: default from `defaultEnabled`, fallback true.

### 12.5 Marketplaces Tab

Create `PluginMarketplacesTab.vue`.

Required controls:

- Add Marketplace button.
- Refresh All button.

Required table columns:

- Marketplace.
- Owner.
- Source.
- Plugins.
- Status.
- Last Fetched.
- Auto Update.
- Actions.

MVP auto-update toggle is displayed disabled or hidden. If displayed, label it "Coming later" to avoid false affordance.

Actions:

- Refresh.
- View details.
- Remove.

### 12.6 Add Marketplace Dialog

Create `PluginMarketplaceAddDialog.vue`.

Fields:

- Source input.
- Optional ref input.
- Source type preview.
- Replace existing marketplace checkbox, shown only after name conflict is detected.

Behavior:

- Parse source client-side for immediate feedback when possible.
- Server remains the source of truth for validation.
- Show progress while fetching.
- Show parsed marketplace name, owner, and plugin count before final save when feasible.

### 12.7 Errors Tab

Create or extend diagnostics UI to show:

- Marketplace fetch errors.
- Marketplace schema errors.
- Plugin entry errors.
- Installed plugin load errors.

Each row:

- Source type.
- Marketplace.
- Plugin entry.
- Error code.
- Message.
- Recoverable.
- Timestamp.

## 13. Internationalization Requirements

All new user-facing text must be added to:

- `src/views/lang/en.ts`
- `src/views/lang/zh.ts`
- `src/views/lang/es.ts`
- `src/views/lang/fr.ts`
- `src/views/lang/de.ts`
- `src/views/lang/ja.ts`

Recommended key group:

```typescript
plugins: {
  marketplace: {
    tab_discover: "...",
    tab_marketplaces: "...",
    add_button: "...",
    add_title: "...",
    source_label: "...",
    ref_label: "...",
    refresh_button: "...",
    refresh_all_button: "...",
    remove_button: "...",
    install_button: "...",
    reinstall_button: "...",
    status_installed: "...",
    status_not_installed: "...",
    status_unsupported: "...",
    health_healthy: "...",
    health_invalid: "...",
    health_fetch_failed: "...",
    health_missing_files: "...",
    confirm_remove: "...",
    trust_warning_hooks: "...",
    trust_warning_mcp: "...",
    trust_warning_npm: "..."
  }
}
```

## 14. Security And Trust Requirements

### 14.1 Trust Boundary

Marketplace manifests are untrusted data. Plugin packages installed from marketplaces are untrusted code/configuration until validated and approved.

Required protections:

- No marketplace code execution.
- No direct database access from marketplace services outside Model/Module layers.
- No worker process database access.
- No shell execution for marketplace parsing.
- Git and npm fetchers must use `shell: false`.
- npm install/pack must disable lifecycle scripts.
- Local path and relative path traversal must be blocked.
- Secret values must be redacted from logs, IPC errors, diagnostics, and persisted source metadata.

### 14.2 Trust Dialog

Before installing a marketplace plugin, show a trust/risk summary.

Risk flags:

- Has MCP servers.
- Has hooks.
- Has monitors.
- Uses npm package source.
- Uses unpinned git source.
- Uses remote URL source.
- Has shell commands in MCP config.
- Has source not pinned by SHA.

The install button remains available, but users must confirm when high-risk flags exist.

### 14.3 Pinning Guidance

If a marketplace entry has a SHA, AiFetchly should use it. If it only has a branch/tag ref, AiFetchly should show "Not pinned to commit". If it has neither, AiFetchly should show "Uses default branch or package latest behavior" depending on source.

### 14.4 Marketplace Removal

MVP does not auto-uninstall plugins when a marketplace is removed. This avoids destructive surprise. Installed plugin rows retain provenance so the user can later uninstall each plugin intentionally.

## 15. Performance Requirements

- Listing marketplaces should read from SQLite/cache only and complete in under 200 ms for 20 marketplaces.
- Discover should render 500 plugin entries without noticeable UI lag.
- Refreshing one git-backed marketplace should run asynchronously and show progress.
- Refresh failures should not block installed plugin management.
- Marketplace manifest JSON larger than a defined limit, recommended 5 MB, is rejected.
- Plugin count per marketplace should have a defined limit, recommended 5,000 entries.

## 16. Observability And Diagnostics

Diagnostics bundle should include:

- Marketplace summaries.
- Marketplace source metadata with secrets redacted.
- Marketplace health.
- Last fetch time.
- Last errors.
- Installed marketplace plugin provenance.
- Available plugin entry count.

Do not include:

- npm auth tokens.
- HTTP authorization headers.
- Full private git URLs with embedded credentials.

## 17. Rollout Plan

### Phase 1: Marketplace MVP

Scope:

- Marketplace entity/model/module.
- Marketplace service and validation.
- Add/list/get/refresh/remove marketplace.
- Discover tab.
- Install marketplace plugin for relative path, github, git/url, npm entries where existing fetchers support the source.
- Marketplace provenance on installed plugins.
- i18n.
- Focused tests.

Exit criteria:

- User can add a local Claude-style marketplace.
- User can discover plugins from it.
- User can install `plugin-name@marketplace-name`.
- Installed plugin appears in current Installed tab.
- Removing the marketplace leaves installed plugin intact.

### Phase 2: Source Parity And Update

Scope:

- Add `git-subdir` plugin fetcher if not already present.
- Add update/reinstall action for marketplace-installed plugins.
- Compare installed version to marketplace entry version.
- Optional dry-run fetch for capability inventory before install.

Exit criteria:

- AiFetchly supports all major Claude marketplace plugin source types.
- User can update a marketplace-installed plugin manually.

### Phase 3: Auto Refresh And Policy

Scope:

- Per-marketplace auto-refresh setting.
- Optional startup refresh.
- Marketplace allowlist/blocklist.
- Reserved-name blocking.
- Admin-managed marketplace config.

Exit criteria:

- Team admins can control approved marketplaces.
- Users get clear warnings when a marketplace is disallowed.

### Phase 4: Suggestions And Dependencies

Scope:

- Suggested plugins based on workspace/project context.
- Cross-marketplace dependency install support.
- Renames/removals support from marketplace manifest.
- Unused plugin detection.

Exit criteria:

- Marketplace support feels like a curated plugin ecosystem, not just a catalog viewer.

## 18. Testing Requirements

### 18.1 Unit Tests

Add tests under `test/vitest/utilitycode/`:

- `parseMarketplaceSource.test.ts`
- `pluginMarketplaceValidation.test.ts`
- `pluginMarketplacePaths.test.ts`
- `pluginMarketplaceService.test.ts`
- `pluginMarketplaceEntryResolution.test.ts`

Coverage:

- Source parsing.
- Invalid source rejection.
- Marketplace schema validation.
- Duplicate plugin names.
- Relative path traversal rejection.
- Entry source to `PluginSourceRequest` conversion.
- Secret redaction.

### 18.2 Module Tests

Add tests under `test/modules/`:

- `PluginMarketplaceModule.test.ts`

Coverage:

- Create marketplace.
- List marketplaces.
- Update state.
- Set errors.
- Remove marketplace.

### 18.3 IPC Tests

Add tests under `test/vitest/main/`:

- `plugin-marketplace-ipc.test.ts`

Coverage:

- Invalid add request rejected.
- List calls service.
- Install invalid identifier rejected.
- Install missing marketplace rejected.
- Handler does not directly touch database repositories.

### 18.4 UI Tests

Add or update component tests if current tooling supports them:

- Discover tab renders entries.
- Marketplace tab renders health and actions.
- Add Marketplace dialog validates input states.
- Install confirmation displays risk flags.

### 18.5 Manual UAT

Manual test scenarios:

1. Add a local marketplace with one relative-path plugin.
2. Install that plugin.
3. Disable and re-enable the installed plugin.
4. Remove the marketplace and confirm installed plugin remains.
5. Add a malformed marketplace and verify errors.
6. Add a git-backed marketplace and refresh it.
7. Install an npm-backed marketplace plugin and confirm npm token is not persisted.

## 19. Success Metrics

Product:

- User can complete add marketplace -> discover -> install plugin without reading documentation.
- Marketplace-installed plugins are clearly distinguishable from local/source-installed plugins.
- Broken marketplaces are diagnosable from the UI.

Engineering:

- Marketplace install reuses `PluginInstallService`; no duplicate plugin install pipeline.
- IPC handlers stay thin and schema-validated.
- Database access remains in Model/Module layers.
- Existing plugin import/install tests continue to pass.

Quality:

- No secrets in diagnostics or persisted source metadata.
- Invalid marketplaces cannot corrupt existing marketplace caches.
- Relative paths cannot escape marketplace root.
- All new UI strings translated in six supported languages.

## 20. Open Questions

1. Should marketplace management be AI-gated like existing plugin IPC, or should catalog browsing be allowed when AI is disabled?
2. Should removing a marketplace offer an optional "also uninstall plugins from this marketplace" checkbox in MVP, or defer it?
3. Should AiFetchly preconfigure an official/default marketplace, or require users to add every marketplace manually?
4. Should `git-subdir` support be included in Phase 1 for Claude parity, or Phase 2 to keep the MVP smaller?
5. Should marketplace refresh run automatically only when the user opens Discover, or only when the user clicks Refresh?

## 21. Implementation File Map

New files:

- `src/entity/PluginMarketplace.entity.ts`
- `src/model/PluginMarketplace.model.ts`
- `src/modules/PluginMarketplaceModule.ts`
- `src/service/PluginMarketplaceService.ts`
- `src/service/pluginMarketplaces/pluginMarketplaceTypes.ts`
- `src/service/pluginMarketplaces/pluginMarketplaceValidation.ts`
- `src/service/pluginMarketplaces/pluginMarketplacePaths.ts`
- `src/service/pluginMarketplaces/parseMarketplaceSource.ts`
- `src/service/pluginMarketplaces/GitHubMarketplaceFetcher.ts`
- `src/service/pluginMarketplaces/GitMarketplaceFetcher.ts`
- `src/service/pluginMarketplaces/LocalMarketplaceFetcher.ts`
- `src/service/pluginMarketplaces/UrlMarketplaceFetcher.ts`
- `src/service/pluginMarketplaces/PluginMarketplaceFetcherRegistry.ts`
- `src/service/pluginMarketplaces/pluginMarketplaceRedact.ts`
- `src/main-process/communication/plugin-marketplace-ipc.ts`
- `src/schemas/ipc/pluginMarketplace.ts`
- `src/views/api/pluginMarketplaces.ts`
- `src/views/components/plugins/PluginDiscoverTab.vue`
- `src/views/components/plugins/PluginMarketplacesTab.vue`
- `src/views/components/plugins/PluginMarketplaceAddDialog.vue`
- `src/views/components/plugins/PluginMarketplacePluginDetailDialog.vue`

Modified files:

- `src/config/channellist.ts`
- `src/main-process/communication/index.ts`
- `src/views/components/plugins/PluginManager.vue`
- `src/views/components/plugins/PluginOverviewTab.vue`
- `src/entityTypes/pluginTypes.ts`
- `src/entity/InstalledPlugin.entity.ts` only if additional provenance fields are needed beyond `sourceMetaJson`
- `src/views/lang/en.ts`
- `src/views/lang/zh.ts`
- `src/views/lang/es.ts`
- `src/views/lang/fr.ts`
- `src/views/lang/de.ts`
- `src/views/lang/ja.ts`

## 22. Definition Of Done

- Marketplace add/list/get/refresh/remove works from the UI.
- Discover tab lists cached marketplace plugin entries.
- Installing `plugin-name@marketplace-name` delegates to the existing plugin install pipeline.
- Installed plugin source and marketplace provenance are persisted.
- Marketplace removal does not break installed plugin management.
- All new IPC channels have zod validation.
- All database operations flow through Model/Module classes.
- All new UI strings exist in all supported language files.
- Focused unit/module/IPC tests pass.
- Manual UAT scenarios pass.
- Documentation links from this PRD to existing plugin docs remain valid.
