# Plugin Marketplace Support - Technical Design

Version: 1.0
Date: 2026-07-09
Status: Draft
Source PRD: `docs/prd/plugin-marketplace-support-prd.md`
Normative references:
- <https://code.claude.com/docs/en/discover-plugins>
- <https://code.claude.com/docs/en/plugin-marketplaces>

## 1. Purpose

This document translates the Plugin Marketplace Support PRD into an implementation-facing design for AiFetchly.

The goal is to add marketplace catalog support without creating a second plugin installer. A marketplace is untrusted catalog data. The catalog is fetched, validated, cached, and persisted. Installing a marketplace plugin resolves one catalog entry into the existing `PluginInstallService.installFromSource()` pipeline.

Hard rule: marketplace support must sit above the existing plugin system. It must not duplicate plugin import, plugin loading, skill registration, MCP registration, or installed plugin management.

## 2. Existing System Anchors

### 2.1 Installed plugin pipeline

```text
src/entityTypes/pluginTypes.ts                 # PluginSourceKind, PluginSummary, PluginError
src/entity/InstalledPlugin.entity.ts           # installed plugin row + source provenance columns
src/model/InstalledPlugin.model.ts             # installed plugin data access
src/modules/PluginManagementModule.ts          # installed plugin business logic
src/service/PluginInstallService.ts            # multi-source install orchestration
src/service/PluginImportService.ts             # manifest -> component import -> persistence
src/service/PluginComponentRegistryService.ts  # applies loaded plugins to skill/MCP runtime
src/service/pluginSources/                     # direct plugin source fetchers
src/main-process/communication/plugin-ipc.ts   # installed plugin IPC handlers
src/views/api/plugins.ts                       # renderer installed plugin API
src/views/components/plugins/PluginManager.vue # installed plugin UI
```

Marketplace install must end at the same point as direct source install:

```text
marketplace entry
  -> PluginSourceRequest
  -> PluginInstallService.installFromSource()
  -> PluginImportService.installFromLocalRoot()
  -> PluginManagementModule / SkillManagementModule / MCPToolModule
```

### 2.2 Source install contracts

Existing plugin source fetchers use:

```typescript
export interface PluginSourceRequest {
  readonly kind: PluginSourceKind;
  readonly overwrite?: boolean;
  readonly zipPath?: string;
  readonly folderPath?: string;
  readonly uri?: string;
  readonly ref?: string;
  readonly npmPackage?: string;
  readonly npmVersion?: string;
  readonly npmRegistry?: string;
  readonly npmAuthScope?: string;
  readonly npmAuthToken?: string;
  readonly onProgress?: (msg: string, pct?: number) => void;
}
```

Marketplace support must convert catalog entries into this shape. It should not add installer-specific branches in IPC handlers.

### 2.3 Plugin filesystem layout

Current helper:

```text
src/service/pluginPaths.ts
```

Current functions:

- `getPluginsRoot()`
- `getPluginInstallRoot(pluginName)`
- `getPluginOwnedSkillRoot(pluginName, skillName)`
- `getPluginOptionsFile(pluginName)`

Marketplace support adds a separate marketplace cache root under the same user data base. Marketplace files are not installed plugins.

### 2.4 Database architecture

Repository rules from `AGENTS.md` apply:

- IPC handlers never access TypeORM repositories.
- Models in `src/model/` own database access and extend `BaseDb`.
- Modules in `src/modules/` own business logic and extend `BaseModule`.
- Services may coordinate modules and filesystem/network operations.
- Database path resolution goes through existing base classes and `Token`/`USERSDBPATH`.
- Worker processes never access the database.

Marketplace fetchers are main-process services. They are not worker entry points.

### 2.5 IPC validation pattern

Existing plugin IPC uses zod schemas in:

```text
src/schemas/ipc/plugin.ts
```

Marketplace IPC should follow the same pattern in a separate schema file:

```text
src/schemas/ipc/pluginMarketplace.ts
```

Handlers should use `registerAiValidatedHandler` unless product explicitly decides marketplace catalog browsing is allowed while AI features are disabled. To match current plugin IPC behavior, this design uses `registerAiValidatedHandler`.

## 3. Architecture Overview

```text
Renderer
  PluginManager.vue
    Installed tab
    Discover tab
    Marketplaces tab
    Errors tab
        |
        v
Renderer API
  views/api/pluginMarketplaces.ts
        |
        v
IPC
  plugin-marketplace-ipc.ts
  zod schemas in schemas/ipc/pluginMarketplace.ts
        |
        v
Service layer
  PluginMarketplaceService
  pluginMarketplaces/* fetchers, validation, paths, redaction
        |
        +-----------------------------+
        |                             |
        v                             v
Marketplace DB                  Existing plugin install pipeline
  PluginMarketplaceModule         PluginInstallService
  PluginMarketplaceModel          PluginImportService
  PluginMarketplaceEntity         PluginManagementModule
```

Core flow:

```text
Add marketplace:
  user source -> parse -> fetch -> locate marketplace.json -> validate
  -> atomic cache write -> PluginMarketplaceModule.create/update

Discover plugins:
  PluginMarketplaceModule.findEnabled -> parse cached manifestJson
  -> flatten entries -> join installed plugin provenance -> return summaries

Install plugin:
  pluginId "name@marketplace" -> load marketplace -> find entry
  -> resolve entry source -> PluginSourceRequest
  -> PluginInstallService.installFromSource()
  -> persist installed plugin with source="marketplace" and sourceMetaJson.marketplace
```

## 4. Data Model

### 4.1 Entity

Add `src/entity/PluginMarketplace.entity.ts`.

```typescript
import { Entity, Column, PrimaryGeneratedColumn, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import { Order } from "@/entity/order.decorator";

@Entity("plugin_marketplaces")
@Index(["name"], { unique: true })
@Index(["enabled"])
@Index(["health"])
export class PluginMarketplaceEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("text")
  name: string;

  @Order(2)
  @Column("text", { nullable: true })
  displayName?: string;

  @Order(3)
  @Column("text")
  ownerName: string;

  @Order(4)
  @Column("text", { nullable: true })
  ownerEmail?: string;

  @Order(5)
  @Column("text", { nullable: true })
  ownerUrl?: string;

  @Order(6)
  @Column("text", { nullable: true })
  description?: string;

  @Order(7)
  @Column("text", { nullable: true })
  version?: string;

  @Order(8)
  @Column("text")
  sourceKind: string;

  @Order(9)
  @Column("text")
  sourceUri: string;

  @Order(10)
  @Column("text", { nullable: true })
  sourceRef?: string;

  @Order(11)
  @Column("text", { nullable: true })
  installPath?: string;

  @Order(12)
  @Column("text")
  manifestJson: string;

  @Order(13)
  @Column("integer", { default: 0 })
  pluginCount: number;

  @Order(14)
  @Column("integer", { default: 1 })
  enabled: number;

  @Order(15)
  @Column("integer", { default: 0 })
  autoUpdate: number;

  @Order(16)
  @Column("text", { default: "healthy" })
  health: string;

  @Order(17)
  @Column("text", { default: "[]" })
  lastErrorJson: string;

  @Order(18)
  @Column("datetime", { nullable: true })
  lastFetchedAt?: Date;

  @Order(19)
  @Column("text", { default: "{}" })
  sourceMetaJson: string;
}
```

Health values:

```typescript
export type PluginMarketplaceHealth =
  | "healthy"
  | "disabled"
  | "invalid"
  | "fetch_failed"
  | "missing_files";
```

### 4.2 Entity registration

Register `PluginMarketplaceEntity` anywhere the app registers TypeORM entities. Search for `InstalledPluginEntity` registration and add the marketplace entity beside it.

Expected impacted file:

```text
src/config/SqliteDb.ts
```

If the project uses an entity glob rather than explicit imports, no registration change may be needed. Verify before implementation.

### 4.3 Installed plugin provenance

Use existing `InstalledPluginEntity` fields:

- `source = "marketplace"`
- `sourceKind = resolved plugin source kind`
- `sourceUri = resolved plugin source URI`
- `sourceRef = resolved ref/sha/version`
- `sourceMetaJson.marketplace = MarketplaceInstallMeta`

No new installed plugin columns are required for MVP.

```typescript
export interface MarketplaceInstallMeta {
  readonly marketplaceName: string;
  readonly marketplaceSource: PluginMarketplaceSource;
  readonly marketplaceVersion?: string;
  readonly entryName: string;
  readonly entryVersion?: string;
  readonly entrySource: PluginMarketplaceEntrySource;
  readonly resolvedSourceKind: PluginSourceKind;
  readonly resolvedSourceUri?: string;
  readonly resolvedSourceRef?: string;
  readonly resolvedAt: string;
}
```

Persistence rule: `PluginInstallService.installFromSource()` currently builds provenance from the install request. Add an optional `sourceMeta` field to `PluginSourceRequest`, or add a second options object to `installFromSource()`. Prefer adding `sourceMeta?: Record<string, unknown>` to `PluginSourceRequest` because it keeps the installer call single-argument and mirrors `PluginSourceProvenance.sourceMeta`.

```typescript
export interface PluginSourceRequest {
  // existing fields...
  readonly sourceMeta?: Record<string, unknown>;
}
```

Then update `PluginInstallService`:

```typescript
const provenance: PluginSourceProvenance = {
  sourceKind: req.kind,
  sourceUri: req.uri ?? req.zipPath ?? req.folderPath ?? req.npmPackage,
  sourceRef: req.ref ?? req.npmVersion,
  sourceMeta: {
    ...(req.npmRegistry ? { registry: req.npmRegistry } : {}),
    ...(req.sourceMeta ?? {}),
  },
};
```

## 5. Type Contracts

Add marketplace types to `src/entityTypes/pluginMarketplaceTypes.ts`.

Keep them separate from `pluginTypes.ts` until implementation needs shared exports in renderer. This avoids bloating the installed plugin type file.

### 5.1 Source types

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

### 5.2 Manifest types

```typescript
export interface PluginMarketplaceManifest {
  readonly name: string;
  readonly owner: PluginMarketplaceOwner;
  readonly description?: string;
  readonly version?: string;
  readonly metadata?: PluginMarketplaceMetadata;
  readonly plugins: readonly PluginMarketplaceEntry[];
  readonly renames?: Record<string, string | null>;
  readonly allowCrossMarketplaceDependenciesOn?: readonly string[];
}

export interface PluginMarketplaceOwner {
  readonly name: string;
  readonly email?: string;
  readonly url?: string;
}

export interface PluginMarketplaceMetadata {
  readonly pluginRoot?: string;
  readonly description?: string;
  readonly version?: string;
  readonly [key: string]: unknown;
}
```

### 5.3 Entry types

```typescript
export interface PluginMarketplaceEntry {
  readonly name: string;
  readonly displayName?: string;
  readonly description?: string;
  readonly version?: string;
  readonly author?: string | PluginMarketplaceOwner;
  readonly homepage?: string;
  readonly repository?: string;
  readonly license?: string;
  readonly keywords?: readonly string[];
  readonly category?: string;
  readonly tags?: readonly string[];
  readonly source: PluginMarketplaceEntrySource;
  readonly defaultEnabled?: boolean;
  readonly strict?: boolean;
  readonly relevance?: unknown;

  readonly skills?: unknown;
  readonly commands?: unknown;
  readonly agents?: unknown;
  readonly hooks?: unknown;
  readonly mcpServers?: unknown;
  readonly lspServers?: unknown;
  readonly outputStyles?: unknown;
  readonly experimental?: unknown;
}

export type PluginMarketplaceEntrySource =
  | string
  | PluginMarketplaceGithubSource
  | PluginMarketplaceGitUrlSource
  | PluginMarketplaceGitSubdirSource
  | PluginMarketplaceNpmSource;

export interface PluginMarketplaceGithubSource {
  readonly source: "github";
  readonly repo: string;
  readonly ref?: string;
  readonly sha?: string;
}

export interface PluginMarketplaceGitUrlSource {
  readonly source: "url";
  readonly url: string;
  readonly ref?: string;
  readonly sha?: string;
}

export interface PluginMarketplaceGitSubdirSource {
  readonly source: "git-subdir";
  readonly url: string;
  readonly path: string;
  readonly ref?: string;
  readonly sha?: string;
}

export interface PluginMarketplaceNpmSource {
  readonly source: "npm";
  readonly package: string;
  readonly version?: string;
  readonly registry?: string;
}
```

### 5.4 API DTOs

```typescript
export interface PluginMarketplaceSummary {
  readonly id: number;
  readonly name: string;
  readonly displayName?: string;
  readonly ownerName: string;
  readonly description?: string;
  readonly version?: string;
  readonly sourceKind: PluginMarketplaceSourceKind;
  readonly sourceUri: string;
  readonly sourceRef?: string;
  readonly pluginCount: number;
  readonly enabled: boolean;
  readonly autoUpdate: boolean;
  readonly health: PluginMarketplaceHealth;
  readonly lastFetchedAt?: string;
  readonly updatedAt?: string;
}

export interface PluginMarketplaceDetail extends PluginMarketplaceSummary {
  readonly ownerEmail?: string;
  readonly ownerUrl?: string;
  readonly manifest: PluginMarketplaceManifest;
  readonly errors: readonly PluginMarketplaceError[];
  readonly installPath?: string;
  readonly sourceMeta: Record<string, unknown>;
}

export interface PluginMarketplacePluginSummary {
  readonly pluginId: string; // `${entry.name}@${marketplace.name}`
  readonly name: string;
  readonly displayName?: string;
  readonly marketplaceName: string;
  readonly marketplaceDisplayName?: string;
  readonly version?: string;
  readonly description?: string;
  readonly author?: string;
  readonly category?: string;
  readonly tags: readonly string[];
  readonly sourceKind: string;
  readonly capabilitySummary: PluginMarketplaceCapabilitySummary;
  readonly installed: boolean;
  readonly installedVersion?: string;
  readonly status: "not_installed" | "installed" | "different_version" | "unsupported" | "error";
  readonly errors: readonly PluginMarketplaceError[];
}

export interface PluginMarketplaceCapabilitySummary {
  readonly hasSkills: boolean;
  readonly hasCommands: boolean;
  readonly hasAgents: boolean;
  readonly hasHooks: boolean;
  readonly hasMcpServers: boolean;
  readonly hasLspServers: boolean;
  readonly hasOutputStyles: boolean;
  readonly hasMonitors: boolean;
}
```

## 6. Error Model

Add marketplace-specific errors in `pluginMarketplaceTypes.ts`.

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

export interface PluginMarketplaceError {
  readonly code: PluginMarketplaceErrorCode;
  readonly marketplaceName?: string;
  readonly pluginName?: string;
  readonly path?: string;
  readonly message: string;
  readonly recoverable: boolean;
}
```

Errors returned to the renderer must already be redacted. Do not rely on frontend redaction.

## 7. Filesystem Layout

Add `src/service/pluginMarketplaces/pluginMarketplacePaths.ts`.

```typescript
import * as path from "path";
import { getElectronUserDataPath } from "@/service/SkillEnvironmentManager";

export function getPluginMarketplacesRoot(): string {
  return path.join(getElectronUserDataPath(), "plugins", "marketplaces");
}

export function getPluginMarketplaceCacheRoot(name: string): string {
  return path.join(getPluginMarketplacesRoot(), "cache", name);
}

export function getPluginMarketplaceTempRoot(): string {
  return path.join(getPluginMarketplacesRoot(), "tmp");
}

export function getPluginMarketplaceManifestPath(name: string): string {
  return path.join(getPluginMarketplaceCacheRoot(name), ".claude-plugin", "marketplace.json");
}

export function getPluginMarketplaceDownloadedManifestPath(name: string): string {
  return path.join(getPluginMarketplaceCacheRoot(name), "marketplace.json");
}
```

Cache layout:

```text
<userData>/plugins/marketplaces/
+-- cache/
|   +-- team-tools/
|   |   +-- .claude-plugin/marketplace.json   # git/local folder style
|   |   +-- plugins/
|   +-- url-market/
|       +-- marketplace.json                  # direct URL style
+-- tmp/
```

Atomic replacement:

```text
fetch -> tmp/<random> -> validate -> rename cache/<name>.next -> cache/<name>
```

For cross-device rename issues on Windows, use:

1. Build temp under `getPluginMarketplacesRoot()`.
2. Rename within the same parent directory.
3. If target exists, rename target to `.old`, rename `.next` to target, then delete `.old`.

## 8. Marketplace Fetchers

Create directory:

```text
src/service/pluginMarketplaces/
```

### 8.1 Fetcher contract

```typescript
export interface PluginMarketplaceFetchRequest {
  readonly source: PluginMarketplaceSource;
  readonly onProgress?: (msg: string, pct?: number) => void;
}

export interface FetchedPluginMarketplace {
  readonly marketplaceRoot: string;
  readonly manifestPath: string;
  readonly manifestJson: string;
  readonly cleanup: () => Promise<void>;
}

export type PluginMarketplaceFetchResult =
  | { success: true; marketplace: FetchedPluginMarketplace }
  | { success: false; errors: readonly PluginMarketplaceError[] };

export interface PluginMarketplaceFetcher {
  readonly kind: PluginMarketplaceSourceKind;
  fetch(req: PluginMarketplaceFetchRequest): Promise<PluginMarketplaceFetchResult>;
}
```

### 8.2 Source parser

Add `parseMarketplaceSource.ts`.

```typescript
export function parseMarketplaceSource(
  raw: string,
  ref?: string
): { success: true; source: PluginMarketplaceSource } | { success: false; errors: PluginMarketplaceError[] };
```

Rules:

- Trim input.
- Reject empty.
- Reject `\r`, `\n`, and ASCII control characters.
- `owner/repo` -> `github`.
- `git@...` -> `git`.
- `https://...` ending in `.git` -> `git`.
- `https://.../marketplace.json` -> `url`.
- Existing directory -> `local-folder`.
- Existing file named `marketplace.json` -> `local-file`.
- Relative local paths are resolved with `path.resolve()`.
- Plain `http://` is rejected.
- Ambiguous URL returns `marketplace-source-invalid` with a hint to use `.git` or direct `marketplace.json`.

### 8.3 GitMarketplaceFetcher

Implementation mirrors `GitPluginFetcher` with a different validation target.

Behavior:

- Accepts `https://`, `ssh://`, `git://`, and `git@`.
- Rejects `http://`.
- Runs `git clone --depth 1`, plus `--branch <ref>` if provided.
- Uses `shell: false`.
- Timeout: 60 seconds.
- Swallows stdout/stderr from git.
- After clone, locates marketplace manifest:
  - `<repo>/.claude-plugin/marketplace.json`
  - `<repo>/marketplace.json`
- Does not support nested single-subdir unwrap in MVP unless the source explicitly points to that repository shape. Marketplace repositories should put the marketplace file at the root or `.claude-plugin`.

### 8.4 GitHubMarketplaceFetcher

Supports:

- GitHub shorthand `owner/repo`.
- GitHub repo URL `https://github.com/owner/repo`.

Implementation:

- Convert shorthand to `https://github.com/owner/repo.git`.
- Delegate to `GitMarketplaceFetcher`.
- Private repositories rely on the user's git credential helper or SSH agent if using a git URL.

Do not implement GitHub release asset marketplace download in MVP. Use direct URL marketplace support for hosted JSON files.

### 8.5 LocalMarketplaceFetcher

Supports:

- `local-folder`: directory containing `.claude-plugin/marketplace.json` or `marketplace.json`.
- `local-file`: direct path to `marketplace.json`.

Behavior:

- Resolve real path.
- For folders, copy the whole folder into the marketplace cache so relative plugin entries keep working.
- For files, copy only the file into cache. Relative plugin entries should be marked unsupported because a single file has no marketplace root with plugin contents.
- Apply directory limits before copy.
- Reject paths inside the installed plugins root to avoid circular installs.

### 8.6 UrlMarketplaceFetcher

Supports:

- HTTPS direct link to `marketplace.json`.

Behavior:

- Reject non-HTTPS.
- Follow at most 5 redirects.
- Timeout: 60 seconds.
- Max response size: 5 MB.
- Save as `<cache>/marketplace.json`.
- Since URL marketplaces have no repository root, relative plugin sources cannot be resolved. Entries using relative string sources are returned in Discover with `unsupported` status.

### 8.7 Fetcher registry

```typescript
export class PluginMarketplaceFetcherRegistry {
  private readonly fetchers = new Map<PluginMarketplaceSourceKind, PluginMarketplaceFetcher>();

  register(fetcher: PluginMarketplaceFetcher): void;
  get(kind: PluginMarketplaceSourceKind): PluginMarketplaceFetcher;
}
```

Default registry:

```typescript
export function createDefaultMarketplaceFetcherRegistry(): PluginMarketplaceFetcherRegistry {
  const reg = new PluginMarketplaceFetcherRegistry();
  const git = new GitMarketplaceFetcher();
  reg.register(git);
  reg.register(new GitHubMarketplaceFetcher(git));
  reg.register(new LocalMarketplaceFetcher());
  reg.register(new UrlMarketplaceFetcher());
  return reg;
}
```

## 9. Manifest Validation

Add `pluginMarketplaceValidation.ts`.

Use zod for a two-stage validation:

1. Strict enough to reject unusable marketplaces.
2. Permissive enough to preserve unknown fields for future Claude compatibility.

### 9.1 Constants

```typescript
export const MARKETPLACE_NAME_REGEX = /^[a-z0-9][a-z0-9_-]*$/;
export const MARKETPLACE_PLUGIN_NAME_REGEX = /^[a-z0-9][a-z0-9_-]*$/;
export const MARKETPLACE_LIMITS = {
  maxManifestBytes: 5 * 1024 * 1024,
  maxPlugins: 5000,
  maxStringLength: 4096,
};
```

### 9.2 Schema outline

```typescript
const ownerSchema = z.object({
  name: z.string().min(1).max(256),
  email: z.string().email().max(320).optional(),
  url: z.string().url().max(2048).optional(),
}).passthrough();

const marketplaceEntrySourceSchema = z.union([
  z.string().min(1).max(4096),
  z.object({
    source: z.literal("github"),
    repo: z.string().min(1).max(512),
    ref: z.string().max(256).optional(),
    sha: z.string().regex(/^[a-f0-9]{40}$/i).optional(),
  }).passthrough(),
  z.object({
    source: z.literal("url"),
    url: z.string().min(1).max(4096),
    ref: z.string().max(256).optional(),
    sha: z.string().regex(/^[a-f0-9]{40}$/i).optional(),
  }).passthrough(),
  z.object({
    source: z.literal("git-subdir"),
    url: z.string().min(1).max(4096),
    path: z.string().min(1).max(2048),
    ref: z.string().max(256).optional(),
    sha: z.string().regex(/^[a-f0-9]{40}$/i).optional(),
  }).passthrough(),
  z.object({
    source: z.literal("npm"),
    package: z.string().min(1).max(512),
    version: z.string().max(256).optional(),
    registry: z.string().url().max(2048).optional(),
  }).passthrough(),
]);

const entrySchema = z.object({
  name: z.string().regex(MARKETPLACE_PLUGIN_NAME_REGEX).max(256),
  displayName: z.string().max(256).optional(),
  description: z.string().max(2048).optional(),
  version: z.string().max(128).optional(),
  source: marketplaceEntrySourceSchema,
  tags: z.array(z.string().max(64)).max(64).optional(),
  keywords: z.array(z.string().max(64)).max(64).optional(),
  category: z.string().max(128).optional(),
}).passthrough();

const marketplaceSchema = z.object({
  name: z.string().regex(MARKETPLACE_NAME_REGEX).max(256),
  owner: ownerSchema,
  description: z.string().max(2048).optional(),
  version: z.string().max(128).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  plugins: z.array(entrySchema).max(MARKETPLACE_LIMITS.maxPlugins),
  renames: z.record(z.string(), z.string().nullable()).optional(),
  allowCrossMarketplaceDependenciesOn: z.array(z.string()).optional(),
}).passthrough();
```

### 9.3 Post-schema validation

After zod:

- Ensure entry names are unique.
- Validate relative string sources start with `./`.
- Reject relative source strings containing CRLF or control chars.
- Validate `metadata.pluginRoot`, if present, does not escape marketplace root.
- Mark unsupported sources as entry-level errors instead of failing the whole marketplace when possible.

The whole marketplace fails only when:

- JSON is invalid.
- Required top-level fields are missing or invalid.
- `plugins` is not an array.
- Manifest exceeds size limit.
- Marketplace name conflicts and caller did not request overwrite.

Individual entries fail when:

- Entry source is unsupported.
- Relative path escapes root.
- Entry source has invalid fields.

## 10. Model And Module

### 10.1 Model

Add `src/model/PluginMarketplace.model.ts`.

Pattern should match `InstalledPluginModel`.

```typescript
export class PluginMarketplaceModel extends BaseDb {
  private repository: Repository<PluginMarketplaceEntity> | null = null;

  constructor(filepath: string) {
    super(filepath);
  }

  private async getRepository(): Promise<Repository<PluginMarketplaceEntity>> {
    if (!this.repository) {
      await this.ensureConnection();
      this.repository = this.sqliteDb.connection.getRepository(PluginMarketplaceEntity);
    }
    return this.repository;
  }

  async findAll(): Promise<PluginMarketplaceEntity[]>;
  async findEnabled(): Promise<PluginMarketplaceEntity[]>;
  async findByName(name: string): Promise<PluginMarketplaceEntity | null>;
  async create(marketplace: Partial<PluginMarketplaceEntity>): Promise<number>;
  async updateByName(name: string, data: Partial<PluginMarketplaceEntity>): Promise<boolean>;
  async toggle(name: string, enabled: boolean): Promise<boolean>;
  async remove(name: string): Promise<boolean>;
}
```

### 10.2 Module

Add `src/modules/PluginMarketplaceModule.ts`.

```typescript
export class PluginMarketplaceModule extends BaseModule {
  private marketplaceModel: PluginMarketplaceModel;

  constructor() {
    super();
    this.marketplaceModel = new PluginMarketplaceModel(this.dbpath);
  }

  async listMarketplaces(): Promise<PluginMarketplaceEntity[]>;
  async listEnabledMarketplaces(): Promise<PluginMarketplaceEntity[]>;
  async getMarketplaceByName(name: string): Promise<PluginMarketplaceEntity | null>;
  async createMarketplace(input: CreatePluginMarketplaceInput): Promise<number>;
  async updateMarketplaceState(input: UpdatePluginMarketplaceInput): Promise<boolean>;
  async toggleMarketplace(name: string, enabled: boolean): Promise<boolean>;
  async setMarketplaceErrors(name: string, errors: readonly PluginMarketplaceError[]): Promise<boolean>;
  async removeMarketplace(name: string): Promise<boolean>;
}
```

The module does not fetch network resources and does not parse marketplace JSON. It only owns DB-facing business logic.

## 11. Service Layer

### 11.1 Public service

Add `src/service/PluginMarketplaceService.ts`.

Constructor injection keeps tests simple:

```typescript
export class PluginMarketplaceService {
  constructor(
    private readonly marketplaceModule = new PluginMarketplaceModule(),
    private readonly installService = new PluginInstallService(),
    private readonly fetchers = createDefaultMarketplaceFetcherRegistry()
  ) {}

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

### 11.2 Add marketplace flow

```text
addMarketplace(req)
  -> parseMarketplaceSource(req.source, req.ref)
  -> fetcher.fetch(parsedSource)
  -> validateMarketplaceManifest(fetched.manifestJson, fetched.marketplaceRoot)
  -> existing = marketplaceModule.getMarketplaceByName(manifest.name)
  -> if existing && !req.overwrite: return marketplace-name-conflict
  -> write cache atomically under cache/<manifest.name>
  -> marketplaceModule.create/update(...)
  -> return summary
```

Important detail: fetchers may fetch to a temp location. The service owns the final cache write. This keeps fetchers testable and keeps cache naming based on the parsed manifest name, not user input.

### 11.3 Refresh marketplace flow

```text
refreshMarketplace(name)
  -> existing = marketplaceModule.getMarketplaceByName(name)
  -> if missing: error
  -> fetcher.fetch(existing.source)
  -> validate fetched manifest
  -> if fetched manifest.name !== existing.name: error, keep previous cache
  -> atomic cache replace
  -> update manifestJson, pluginCount, lastFetchedAt, health
  -> return summary
```

Refresh must not delete the previous good cache until the new manifest is validated.

### 11.4 Remove marketplace flow

```text
removeMarketplace(name)
  -> existing = marketplaceModule.getMarketplaceByName(name)
  -> if missing: return success
  -> marketplaceModule.removeMarketplace(name)
  -> rm cache/<name> best-effort
```

MVP does not uninstall installed plugins from this marketplace. Installed plugins keep working from their installed plugin cache.

### 11.5 List available plugins flow

```text
listAvailablePlugins(filter)
  -> marketplaces = marketplaceModule.listEnabledMarketplaces()
  -> installed = PluginManagementModule.listInstalledPlugins()
  -> installedByMarketplaceEntry = build from InstalledPlugin.sourceMetaJson.marketplace
  -> for each marketplace:
       parse manifestJson
       validate/collect entry-level errors
       map entries to summaries
       join installed status
  -> apply filters/search
  -> sort
```

Sort order:

1. Entry errors last.
2. Not installed before installed.
3. Marketplace name ascending.
4. Plugin display name/name ascending.

### 11.6 Install marketplace plugin flow

```text
installMarketplacePlugin(req)
  -> parsePluginIdentifier(req.pluginId)
  -> require marketplace part
  -> marketplace = marketplaceModule.getMarketplaceByName(marketplaceName)
  -> manifest = parse marketplace.manifestJson
  -> entry = manifest.plugins.find(p => p.name === pluginName)
  -> resolved = resolveMarketplaceEntrySource(entry, marketplace)
  -> installService.installFromSource({
       ...resolved.pluginSourceRequest,
       overwrite: req.overwrite,
       sourceMeta: { marketplace: meta }
     })
  -> if result.success: return result.plugin
  -> else: throw redacted install error
```

### 11.7 Result mapping

Add pure mapping helpers:

- `toMarketplaceSummary(entity): PluginMarketplaceSummary`
- `toMarketplaceDetail(entity): PluginMarketplaceDetail`
- `toMarketplacePluginSummary(entry, marketplace, installed): PluginMarketplacePluginSummary`

Avoid mapping in IPC handlers.

## 12. Entry Source Resolution

Add `resolveMarketplaceEntrySource.ts`.

```typescript
export interface MarketplaceEntryResolutionContext {
  readonly marketplaceName: string;
  readonly marketplaceRoot: string;
  readonly marketplaceSource: PluginMarketplaceSource;
  readonly marketplaceVersion?: string;
}

export interface ResolvedMarketplacePluginSource {
  readonly request: PluginSourceRequest;
  readonly meta: MarketplaceInstallMeta;
  readonly warnings: readonly PluginMarketplaceError[];
}

export function resolveMarketplaceEntrySource(
  entry: PluginMarketplaceEntry,
  context: MarketplaceEntryResolutionContext
): { success: true; resolved: ResolvedMarketplacePluginSource } | { success: false; errors: PluginMarketplaceError[] };
```

### 12.1 Relative source strings

```typescript
if (typeof entry.source === "string") {
  if (!entry.source.startsWith("./")) error;
  const baseRoot = resolveMarketplacePluginRoot(context.marketplaceRoot, manifest.metadata?.pluginRoot);
  const candidate = path.resolve(baseRoot, entry.source);
  assertInside(baseRoot, candidate);
  const realBase = fs.realpathSync(baseRoot);
  const realCandidate = fs.realpathSync(candidate);
  assertInside(realBase, realCandidate);
  return { kind: "local-folder", folderPath: realCandidate };
}
```

If the marketplace was added from a direct URL, relative sources are unsupported because the URL fetcher only has a manifest file, not the repository tree.

### 12.2 GitHub source

```typescript
{ source: "github", repo, ref, sha }
  -> { kind: "github", uri: `https://github.com/${repo}`, ref: sha ?? ref }
```

The existing `GitHubPluginFetcher.classifyGitHubUrl()` expects a GitHub URL, not `owner/repo`. Convert to URL in the resolver.

### 12.3 Git URL source

Marketplace source type `"url"` means git URL in Claude marketplace plugin entries, not necessarily direct download.

Resolution:

- If URL ends with `.git`, starts with `git@`, or uses `ssh://`, use `kind: "git"`.
- If URL is a GitHub repo URL, use `kind: "github"`.
- If URL ends with `.zip`, use `kind: "url"` and let `UrlPluginFetcher` classify/download.
- Plain `http://` is rejected.
- `sha ?? ref` is passed as `ref`.

### 12.4 NPM source

```typescript
{ source: "npm", package, version, registry }
  -> {
       kind: "npm",
       npmPackage: package,
       npmVersion: version,
       npmRegistry: registry
     }
```

No auth token is read from marketplace data. If private npm support is needed, the UI must collect a one-time token during install.

### 12.5 Git subdir source

MVP behavior:

- Return `marketplace-plugin-source-unsupported`.
- Show the entry in Discover with `status: "unsupported"`.

Phase 2:

- Add `git-subdir` to `PluginSourceKind`.
- Add `GitSubdirPluginFetcher`.
- Resolve to `kind: "git-subdir", uri: url, ref: sha ?? ref, sourceMeta: { path }`.

## 13. IPC Design

### 13.1 Channels

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

### 13.2 Schemas

Add `src/schemas/ipc/pluginMarketplace.ts`.

```typescript
export const pluginMarketplaceNoInputSchema = noInputSchema;

export const pluginMarketplaceByNameInputSchema = lazySchema(() =>
  z.strictObject({
    name: z.string().min(1).max(256).regex(/^[a-z0-9][a-z0-9_-]*$/),
  })
);

export const pluginMarketplaceAddInputSchema = lazySchema(() =>
  z.strictObject({
    source: z.string().min(1).max(4096),
    ref: z.string().max(256).optional(),
    overwrite: z.boolean().optional(),
  })
);

export const pluginMarketplaceAvailablePluginsInputSchema = lazySchema(() =>
  z
    .object({
      search: z.string().max(256).optional(),
      marketplaceName: z.string().max(256).optional(),
      category: z.string().max(128).optional(),
      installed: z.boolean().optional(),
      hasSkills: z.boolean().optional(),
      hasMcpServers: z.boolean().optional(),
      hasHooks: z.boolean().optional(),
    })
    .strict()
);

export const pluginMarketplacePluginByIdInputSchema = lazySchema(() =>
  z.strictObject({
    pluginId: z.string().min(1).max(512),
  })
);

export const pluginMarketplaceInstallInputSchema = lazySchema(() =>
  z.strictObject({
    pluginId: z.string().min(1).max(512),
    overwrite: z.boolean().optional(),
    enableAfterInstall: z.boolean().optional(),
    npmAuthToken: z.string().max(4096).optional(),
  })
);
```

Control character checks remain in the service because the same checks are needed outside IPC tests.

### 13.3 Handler file

Add `src/main-process/communication/plugin-marketplace-ipc.ts`.

```typescript
export function registerPluginMarketplaceIpcHandlers(): void {
  registerAiValidatedHandler(PLUGIN_MARKETPLACE_LIST, pluginMarketplaceNoInputSchema, async () => {
    return await new PluginMarketplaceService().listMarketplaces();
  });

  registerAiValidatedHandler(PLUGIN_MARKETPLACE_GET, pluginMarketplaceByNameInputSchema, async (input) => {
    return await new PluginMarketplaceService().getMarketplace(input.name);
  });

  registerAiValidatedHandler(PLUGIN_MARKETPLACE_ADD, pluginMarketplaceAddInputSchema, async (input) => {
    return await new PluginMarketplaceService().addMarketplace(input);
  });

  registerAiValidatedHandler(PLUGIN_MARKETPLACE_REFRESH, pluginMarketplaceByNameInputSchema, async (input) => {
    return await new PluginMarketplaceService().refreshMarketplace(input.name);
  });

  registerAiValidatedHandler(PLUGIN_MARKETPLACE_REMOVE, pluginMarketplaceByNameInputSchema, async (input) => {
    await new PluginMarketplaceService().removeMarketplace(input.name);
    return null;
  });

  registerAiValidatedHandler(
    PLUGIN_MARKETPLACE_AVAILABLE_PLUGINS,
    pluginMarketplaceAvailablePluginsInputSchema,
    async (input) => {
      return await new PluginMarketplaceService().listAvailablePlugins(input);
    }
  );

  registerAiValidatedHandler(PLUGIN_MARKETPLACE_GET_PLUGIN, pluginMarketplacePluginByIdInputSchema, async (input) => {
    return await new PluginMarketplaceService().getAvailablePlugin(input.pluginId);
  });

  registerAiValidatedHandler(PLUGIN_MARKETPLACE_INSTALL_PLUGIN, pluginMarketplaceInstallInputSchema, async (input) => {
    return await new PluginMarketplaceService().installMarketplacePlugin(input);
  });
}
```

Then register it from `src/main-process/communication/index.ts`.

## 14. Renderer API

Add `src/views/api/pluginMarketplaces.ts`.

Use `windowInvoke` like `src/views/api/plugins.ts`.

```typescript
export async function listPluginMarketplaces(): Promise<PluginMarketplaceSummary[] | null>;
export async function getPluginMarketplace(name: string): Promise<PluginMarketplaceDetail | null>;
export async function addPluginMarketplace(req: AddPluginMarketplaceRequest): Promise<PluginMarketplaceSummary | null>;
export async function refreshPluginMarketplace(name: string): Promise<PluginMarketplaceSummary | null>;
export async function removePluginMarketplace(name: string): Promise<void>;
export async function listMarketplacePlugins(filter?: PluginMarketplacePluginFilter): Promise<PluginMarketplacePluginSummary[] | null>;
export async function getMarketplacePlugin(pluginId: string): Promise<PluginMarketplacePluginDetail | null>;
export async function installMarketplacePlugin(req: InstallMarketplacePluginRequest): Promise<PluginSummary | null>;
```

The renderer API should export DTO types that mirror `pluginMarketplaceTypes.ts`. Keep renderer types readonly where practical, but plain interfaces are acceptable to match existing API files.

## 15. UI Design

### 15.1 `PluginManager.vue`

Refactor to tabs:

```vue
<v-tabs v-model="tab">
  <v-tab value="installed">{{ t("plugins.tab_installed") }}</v-tab>
  <v-tab value="discover">{{ t("plugins.marketplace.tab_discover") }}</v-tab>
  <v-tab value="marketplaces">{{ t("plugins.marketplace.tab_marketplaces") }}</v-tab>
  <v-tab value="errors">{{ t("plugins.marketplace.tab_errors") }}</v-tab>
</v-tabs>
```

Move current installed plugin table into `PluginInstalledTab.vue` or keep it inline as the `installed` tab. Prefer extraction if the file becomes too large.

### 15.2 New components

```text
src/views/components/plugins/PluginDiscoverTab.vue
src/views/components/plugins/PluginMarketplacesTab.vue
src/views/components/plugins/PluginMarketplaceAddDialog.vue
src/views/components/plugins/PluginMarketplacePluginDetailDialog.vue
src/views/components/plugins/PluginMarketplaceErrorsTab.vue
```

### 15.3 Discover tab state

State:

```typescript
const search = ref("");
const marketplaceName = ref<string | null>(null);
const installedFilter = ref<"all" | "installed" | "not_installed">("all");
const items = ref<PluginMarketplacePluginSummary[]>([]);
const selected = ref<PluginMarketplacePluginSummary | null>(null);
const loading = ref(false);
```

Load strategy:

- Load on mount.
- Reload after marketplace add/remove/refresh.
- Reload after install.
- Filtering can be client-side for MVP because the expected count is small. Keep API filter support for larger catalogs.

### 15.4 Marketplaces tab state

State:

```typescript
const marketplaces = ref<PluginMarketplaceSummary[]>([]);
const selected = ref<PluginMarketplaceDetail | null>(null);
const showAdd = ref(false);
const loading = ref(false);
const refreshingName = ref<string | null>(null);
```

Remove behavior:

- Confirm dialog states that installed plugins remain installed.
- After remove, refresh marketplaces and discover tabs.

### 15.5 Trust flags

Add pure helper in UI or shared service:

```typescript
export function getMarketplacePluginRiskFlags(detail: PluginMarketplacePluginDetail): PluginRiskFlag[] {
  // based on source kind and capability summary
}
```

Flags:

- `mcpServers`
- `hooks`
- `monitors`
- `npm`
- `unpinnedGit`
- `remoteUrl`
- `unsupportedSource`

Install button:

- Disabled for unsupported source.
- Enabled for supported high-risk source after user checks confirm box.

### 15.6 i18n keys

Add under `plugins.marketplace`.

Minimum keys:

```typescript
marketplace: {
  tab_installed: "Installed",
  tab_discover: "Discover",
  tab_marketplaces: "Marketplaces",
  tab_errors: "Errors",
  add_button: "Add Marketplace",
  add_title: "Add Plugin Marketplace",
  source_label: "Marketplace source",
  ref_label: "Branch, tag, or commit",
  refresh_button: "Refresh",
  refresh_all_button: "Refresh All",
  remove_button: "Remove",
  install_button: "Install",
  reinstall_button: "Reinstall",
  view_details: "View details",
  column_marketplace: "Marketplace",
  column_owner: "Owner",
  column_plugins: "Plugins",
  column_last_fetched: "Last fetched",
  status_installed: "Installed",
  status_not_installed: "Not installed",
  status_different_version: "Different version installed",
  status_unsupported: "Unsupported source",
  health_healthy: "Healthy",
  health_disabled: "Disabled",
  health_invalid: "Invalid",
  health_fetch_failed: "Fetch failed",
  health_missing_files: "Missing files",
  confirm_remove: "Remove this marketplace? Installed plugins from it will remain installed.",
  risk_mcp: "This plugin starts MCP servers.",
  risk_hooks: "This plugin declares hooks.",
  risk_npm: "This plugin installs from npm.",
  risk_unpinned_git: "This plugin is not pinned to a commit.",
}
```

Update all six language files.

## 16. Security Design

### 16.1 Marketplace is data

Marketplace fetch and validation must not execute marketplace scripts.

Forbidden:

- Running any command from `marketplace.json`.
- Running package manager scripts while parsing a marketplace.
- Loading marketplace-provided JavaScript.
- Trusting marketplace paths without realpath checks.

### 16.2 Git and npm safety

Git fetchers:

- Use `shell: false`.
- Reject `http://`.
- Do not pass credentials on argv.
- Swallow stdout/stderr or redact before surfacing.

NPM plugin install:

- Existing `NpmPluginFetcher` should keep `--ignore-scripts`.
- Marketplace install must not persist `npmAuthToken`.
- Registry is allowed only as HTTPS URL.

### 16.3 Redaction

Add `pluginMarketplaceRedact.ts`.

Redact:

- Basic auth in URLs: `https://user:pass@host` -> `https://host`.
- Query tokens: `token=`, `access_token=`, `_authToken=`, `password=`.
- Authorization headers.
- npm auth token values.

All errors crossing IPC must be redacted.

### 16.4 Path traversal guard

Add helper:

```typescript
export function assertPathInsideBase(base: string, target: string): void {
  const rel = path.relative(base, target);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) return;
  throw new Error("Path escapes marketplace root.");
}
```

For existing paths, use realpath:

```typescript
const realBase = fs.realpathSync(base);
const realTarget = fs.realpathSync(target);
assertPathInsideBase(realBase, realTarget);
```

### 16.5 AI enable gate

Current plugin IPC uses `registerAiValidatedHandler`. Use it for marketplace IPC in MVP for consistency. If product later wants marketplace browsing before AI enablement, split handlers:

- Browse/list/add/remove: `registerValidatedHandler`.
- Install/reload/AI capability activation: `registerAiValidatedHandler`.

Do not mix this decision inside service code.

## 17. Unsupported And Deferred Features

### 17.1 Git subdir

MVP returns unsupported. Phase 2 adds `GitSubdirPluginFetcher`.

Implementation notes for Phase 2:

```text
git clone --filter=blob:none --sparse <url> <tmp>
git -C <tmp> sparse-checkout set <path>
git -C <tmp> checkout <sha/ref>
localRoot = <tmp>/<path>
```

Path must remain inside cloned repo. `path` cannot start with `/` or contain `..`.

### 17.2 Dependencies

MVP ignores dependency fields. Future support should:

- Validate dependency marketplace allowlist.
- Ask before installing dependencies.
- Install dependencies before primary plugin.
- Roll back all installs if any required dependency fails.

### 17.3 Auto-update

MVP stores `autoUpdate` but defaults false and does not run background refresh. Future support should run a startup task only after app initialization and only for enabled marketplaces.

## 18. Testing Plan

### 18.1 Utility tests

Add:

```text
test/vitest/utilitycode/parseMarketplaceSource.test.ts
test/vitest/utilitycode/pluginMarketplaceValidation.test.ts
test/vitest/utilitycode/pluginMarketplacePaths.test.ts
test/vitest/utilitycode/resolveMarketplaceEntrySource.test.ts
test/vitest/utilitycode/pluginMarketplaceRedact.test.ts
test/vitest/utilitycode/pluginMarketplaceService.test.ts
```

Key cases:

- `owner/repo` -> github.
- `https://host/repo.git` -> git.
- `git@github.com:org/repo.git` -> git.
- Local folder -> local-folder.
- Local file -> local-file.
- `http://` rejected.
- CRLF rejected.
- Valid marketplace parses.
- Duplicate plugin names rejected.
- Relative source outside root rejected.
- Direct URL marketplace marks relative plugin entry unsupported.
- GitHub source converts to GitHub URL.
- SHA overrides ref.
- Secrets redacted.

### 18.2 Module tests

Add:

```text
test/modules/PluginMarketplaceModule.test.ts
```

Cases:

- Create and find marketplace.
- List enabled marketplaces.
- Update health/errors.
- Toggle enabled.
- Remove marketplace.

### 18.3 IPC tests

Add:

```text
test/vitest/main/plugin-marketplace-ipc.test.ts
```

Cases:

- Add rejects invalid source.
- List returns service result.
- Refresh requires name.
- Install rejects plugin ID without marketplace.
- Install rejects malformed plugin ID.
- Remove returns null.

Mock `PluginMarketplaceService` at module boundary if existing IPC tests follow that pattern.

### 18.4 UI checks

If component tests are available:

- Discover tab renders plugin rows.
- Marketplaces tab renders marketplace health.
- Add dialog emits add request.
- Install dialog requires confirmation for high-risk flags.

If component tests are not available, run manual UAT after implementation.

### 18.5 Manual UAT

Create fixture marketplace:

```text
/tmp/aifetchly-marketplace/
+-- .claude-plugin/
|   +-- marketplace.json
+-- plugins/
    +-- hello-plugin/
        +-- .claude-plugin/
        |   +-- plugin.json
        +-- skills/
            +-- hello/
                +-- SKILL.md
```

Marketplace:

```json
{
  "name": "local-test-market",
  "owner": { "name": "AiFetchly Test" },
  "plugins": [
    {
      "name": "hello-plugin",
      "description": "Test plugin",
      "source": "./plugins/hello-plugin"
    }
  ]
}
```

UAT flow:

1. Add local marketplace folder.
2. Open Discover and verify `hello-plugin@local-test-market`.
3. Install plugin.
4. Verify installed plugin source chip is Marketplace.
5. Disable/re-enable installed plugin.
6. Remove marketplace.
7. Verify installed plugin remains installed.

## 19. Implementation Sequence

### Task 1: Type contracts

- Add `pluginMarketplaceTypes.ts`.
- Add `sourceMeta?: Record<string, unknown>` to `PluginSourceRequest`.
- Update `PluginInstallService` to merge sourceMeta into provenance.
- Tests: sourceMeta is passed to `installFromLocalRoot`.

Commit: `feat(plugin): add marketplace type contracts`

### Task 2: Entity, model, module

- Add `PluginMarketplaceEntity`.
- Register entity.
- Add `PluginMarketplaceModel`.
- Add `PluginMarketplaceModule`.
- Tests: module CRUD.

Commit: `feat(plugin): persist plugin marketplaces`

### Task 3: Paths and redaction

- Add marketplace path helpers.
- Add redaction helper.
- Tests: paths, redaction cases.

Commit: `feat(plugin): add marketplace paths and redaction helpers`

### Task 4: Source parsing and validation

- Add source parser.
- Add zod validation.
- Add entry-level validation.
- Tests: parsing, schema, duplicates, unsupported entries.

Commit: `feat(plugin): validate marketplace sources and manifests`

### Task 5: Fetchers

- Add fetcher contract and registry.
- Add Git, GitHub, Local, Url marketplace fetchers.
- Tests: injected spawn/download/copy paths.

Commit: `feat(plugin): add marketplace fetchers`

### Task 6: Entry source resolver

- Add `resolveMarketplaceEntrySource.ts`.
- Convert entries to `PluginSourceRequest`.
- Tests: relative path, github, url, npm, git-subdir unsupported.

Commit: `feat(plugin): resolve marketplace plugin sources`

### Task 7: Marketplace service

- Add `PluginMarketplaceService`.
- Implement add/list/get/refresh/remove/listAvailable/getAvailable/install.
- Tests with mocked module/fetchers/install service.

Commit: `feat(plugin): add marketplace service`

### Task 8: IPC and renderer API

- Add channels.
- Add zod schemas.
- Add IPC registration.
- Add renderer API.
- Tests: IPC validation and service calls.

Commit: `feat(plugin): expose marketplace IPC and renderer API`

### Task 9: UI

- Refactor Plugin Manager into tabs.
- Add Discover, Marketplaces, Add dialog, Plugin detail dialog, Errors tab.
- Wire install flow.

Commit: `feat(plugin): add marketplace management UI`

### Task 10: i18n and final verification

- Add all translation keys to six language files.
- Run `yarn vue-check`.
- Run focused tests.

Commit: `feat(plugin): add marketplace translations`

## 20. Migration And Backward Compatibility

Existing installed plugins continue to work.

New table:

- If TypeORM auto-sync is enabled for local SQLite, table is created automatically.
- If schema init is manual, update the database initialization path that creates entities.

Existing direct-source installed plugins:

- `source` remains `local` unless explicitly installed from marketplace.
- Existing `sourceMetaJson` remains valid.
- Plugin Manager should tolerate missing `sourceMetaJson.marketplace`.

Marketplace removal:

- Does not alter installed plugin rows.
- Does not delete installed plugin files.

## 21. Failure Modes

| Failure | Behavior |
|---|---|
| Marketplace source cannot be parsed | Add fails before fetch |
| Git clone timeout | Add/refresh fails, previous cache remains |
| Invalid JSON | Add fails; refresh keeps previous cache |
| Top-level schema invalid | Add fails; refresh keeps previous cache |
| Some plugin entries invalid | Marketplace saves; invalid entries show unsupported/error |
| Relative plugin path escapes root | Entry marked error, install disabled |
| Marketplace removed after plugin install | Installed plugin remains manageable |
| Installed plugin source no longer exists in marketplace | Discover may not show it; Installed tab still does |
| npm token appears in error | Redaction test must fail until fixed |

## 22. Open Implementation Decisions

1. Whether marketplace browsing remains AI-gated. This design keeps it gated for consistency.
2. Whether `GitHubPluginFetcher` should accept `owner/repo` directly. This design converts to URL in marketplace resolver.
3. Whether local-file marketplaces should support relative entries by using the file's directory as root. This design treats direct file as manifest-only and marks relative entries unsupported for stricter safety.
4. Whether to extract current installed table into `PluginInstalledTab.vue` during UI work. Prefer extraction if `PluginManager.vue` grows beyond readable size.
5. Whether to show auto-update disabled in MVP or hide it. Prefer hidden unless product wants to teach the concept early.

## 23. Verification Commands

Focused checks after implementation:

```bash
yarn test test/modules/PluginMarketplaceModule.test.ts
npx vitest --config vite.utilityCode.config.mjs test/vitest/utilitycode/parseMarketplaceSource.test.ts
npx vitest --config vite.utilityCode.config.mjs test/vitest/utilitycode/pluginMarketplaceValidation.test.ts
npx vitest --config vite.utilityCode.config.mjs test/vitest/utilitycode/resolveMarketplaceEntrySource.test.ts
npx vitest --config vite.utilityCode.config.mjs test/vitest/utilitycode/pluginMarketplaceService.test.ts
npx vitest --config vite.main.config.mjs test/vitest/main/plugin-marketplace-ipc.test.ts
yarn vue-check
```

Full release check:

```bash
yarn test
yarn build
```

Use the project's actual Vitest config names if they differ. Existing docs mention `yarn testmain` and utility-code test scripts; prefer repo scripts when available.

## 24. Definition Of Done

- New marketplace entity/model/module exists and follows DB architecture rules.
- Marketplace source parsing, validation, fetching, and cache replacement are tested.
- Discover list is generated from cached marketplace manifests.
- `plugin-name@marketplace-name` install delegates to `PluginInstallService`.
- Marketplace provenance is stored in installed plugin `sourceMetaJson`.
- Plugin Manager has Installed, Discover, Marketplaces, and Errors tabs.
- High-risk install flags are visible before install.
- All new UI strings exist in English, Chinese, Spanish, French, German, and Japanese.
- Relative paths cannot escape marketplace root.
- Refresh failure preserves previous good cache.
- Marketplace removal leaves installed plugins intact.
- Focused module, utility, IPC, and UI/manual tests pass.
