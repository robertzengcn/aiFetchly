# Plugin Management System Technical Design

Version: 1.0  
Date: 2026-06-17  
Status: Draft  
Source PRD: `docs/skills/PRD_Plugin_Management_System.md`

## 1. Purpose

This document translates the Plugin Management PRD into an implementation-facing design for aiFetchly.

The goal is to add a plugin layer that can package and manage:

- AI skills, using the existing skill import, registry, permission, and execution stack.
- MCP servers, using the existing MCP server and tool management stack.

The plugin layer must not become a second runtime. It is an install, ownership, validation, loading, and UI coordination layer above existing capability systems.

## 2. Existing System Anchors

The design depends on these existing code surfaces.

### 2.1 Skill Runtime

```text
src/entityTypes/skillTypes.ts
src/entity/InstalledSkill.entity.ts
src/model/InstalledSkill.model.ts
src/modules/SkillManagementModule.ts
src/service/SkillImportService.ts
src/service/SkillEnvironmentManager.ts
src/service/SkillExecutor.ts
src/service/SkillPermissionService.ts
src/service/SandboxedSkillExecutor.ts
src/service/PythonSkillRuntimeService.ts
src/service/SkillWorkerClient.ts
src/childprocess/SkillWorker.ts
src/config/skillsRegistry.ts
src/main-process/communication/skills-ipc.ts
src/views/pages/systemsetting/skills.vue
```

Important current behavior:

- Imported skills are persisted in `installed_skills`.
- Skill execution goes through `SkillExecutor`.
- JavaScript skills run through sandboxed execution.
- Python skills use per-skill virtual environments.
- Permission decisions go through `SkillPermissionService`.
- Skill IPC handlers already enforce `USER_AI_ENABLED`.

### 2.2 MCP Runtime

```text
src/entity/MCPTool.entity.ts
src/model/MCPTool.model.ts
src/modules/MCPToolModule.ts
src/service/MCPToolService.ts
src/modules/MCPClient.ts
src/main-process/communication/mcp-tool-ipc.ts
src/views/api/mcpTools.ts
src/views/components/aiChat/MCPToolManager.vue
src/views/pages/systemsetting/mcp.vue
```

Important current behavior:

- MCP server records are persisted in `mcp_tool`.
- Tool discovery stores tool names in `tools`.
- Tool schemas are stored in `metadata.toolSchemas`.
- Tool enablement is stored in `toolConfig`.
- AI-facing MCP function names use `mcp_${serverId}_${toolName}`.

### 2.3 Database Architecture

Database rules from `AGENTS.md` apply:

- IPC handlers must not access TypeORM repositories.
- Database access belongs in `src/model/`.
- Business logic belongs in `src/modules/`.
- Modules extend `BaseModule`.
- Models extend `BaseDb`.
- Database path resolution must use the existing `Token` and `USERSDBPATH` pattern through base classes.

### 2.4 Worker Rules

Plugin code must not add worker-side database access.

Worker process code stays under:

```text
src/childprocess/
```

Workers can scrape, execute, transform, or process. They must send results to the main process for persistence.

## 3. Architecture Summary

The plugin system has five layers:

```text
Renderer UI
  Plugin Manager page, import dialog, detail tabs
        |
        v
IPC handlers
  plugin-ipc.ts validates input and checks AI enable
        |
        v
Services
  import, manifest validation, loader, registry adapter, diagnostics
        |
        v
Modules
  PluginManagementModule, SkillManagementModule, MCPToolModule
        |
        v
Models and Entities
  InstalledPlugin, InstalledSkill, MCPTool
```

Runtime capability loading follows a flat registry model:

```text
InstalledPlugin rows
        |
        v
PluginLoaderService.loadAllPlugins()
        |
        v
PluginLoadResult
  enabled plugins
  disabled plugins
  errors
        |
        v
PluginComponentRegistryService
        |
        +--> SkillRegistry plugin skill definitions
        |
        +--> MCPToolService plugin MCP server records
```

Only enabled plugins contribute enabled capabilities. Disabled plugins remain installed, but their skills and MCP tools must not appear in AI tool catalogs.

## 4. Package Format

### 4.1 Canonical Layout

```text
plugin-root/
├── .aifetchly-plugin/
│   └── plugin.json
├── skills/
│   └── lead-enrichment/
│       ├── manifest.json
│       ├── SKILL.md
│       └── main.js
├── mcp/
│   └── servers.json
├── docs/
│   └── README.md
└── assets/
```

V1 accepts zip packages only from the user-facing UI. Development folder import can be added later.

### 4.2 Plugin Manifest Type

Add a new type file:

```text
src/entityTypes/pluginTypes.ts
```

Suggested contracts:

```typescript
export type PluginSource = "local" | "builtin" | "marketplace";

export type PluginHealth =
  | "healthy"
  | "disabled"
  | "needs_configuration"
  | "partial_load"
  | "invalid"
  | "missing_files";

export interface PluginManifest {
  readonly name: string;
  readonly displayName?: string;
  readonly version: string;
  readonly description: string;
  readonly author?: string;
  readonly source?: PluginSource;
  readonly skills?: readonly string[];
  readonly mcpServers?: readonly string[];
  readonly permissions?: readonly string[];
  readonly dependencies?: readonly PluginDependency[];
  readonly homepage?: string;
  readonly repository?: string;
}

export interface PluginDependency {
  readonly name: string;
  readonly version?: string;
  readonly optional?: boolean;
}
```

Validation constraints:

- `name` matches `^[a-z][a-z0-9_-]*$`.
- `version` is semver.
- `description` is non-empty and at most 500 characters.
- At least one of `skills` or `mcpServers` is non-empty.
- Every component path is relative.
- Every component path resolves inside the extracted plugin root.
- Unknown top-level fields are allowed only if preserved under diagnostics. Runtime must ignore them.

### 4.3 MCP Server Config Type

The existing `MCPToolEntity` is host/port-oriented and only partially represents stdio MCP servers. Plugin MCP support should add explicit stdio command fields instead of hiding them in unrelated columns.

Suggested MCP extension types:

```typescript
export type PluginMcpTransport = "stdio" | "sse" | "websocket";

export interface PluginMcpServersFile {
  readonly mcpServers: Record<string, PluginMcpServerDeclaration>;
}

export interface PluginMcpServerDeclaration {
  readonly transport?: PluginMcpTransport;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly env?: Record<string, string>;
  readonly host?: string;
  readonly port?: number;
  readonly url?: string;
  readonly timeout?: number;
  readonly description?: string;
  readonly authType?: "none" | "api_key" | "bearer_token" | "custom";
  readonly metadata?: Record<string, unknown>;
}
```

Normalization rules:

- Missing `transport` defaults to `stdio` if `command` exists.
- `stdio` requires `command`.
- `sse` and `websocket` require `host` or `url`.
- `args` must be an array of strings.
- `env` values are not used as stored secrets. Values with `${user:NAME}` become required user configuration inputs.
- Relative command paths are resolved inside the plugin root only when they point to packaged executables or scripts.

## 5. Persistence Design

### 5.1 New Entity: InstalledPluginEntity

Add:

```text
src/entity/InstalledPlugin.entity.ts
src/model/InstalledPlugin.model.ts
src/modules/PluginManagementModule.ts
```

Entity:

```typescript
import { Entity, Column, PrimaryGeneratedColumn, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

@Entity("installed_plugins")
@Index(["name"], { unique: true })
@Index(["enabled"])
@Index(["health"])
export class InstalledPluginEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("text")
  name: string;

  @Column("text", { nullable: true })
  displayName?: string;

  @Column("text")
  version: string;

  @Column("text", { default: "local" })
  source: "local" | "builtin" | "marketplace";

  @Column("text", { nullable: true })
  author?: string;

  @Column("text")
  description: string;

  @Column("text")
  installPath: string;

  @Column("text")
  manifestJson: string;

  @Column("text", { default: "[]" })
  permissionsJson: string;

  @Column("text", { default: "{}" })
  componentStateJson: string;

  @Column("integer", { default: 1 })
  enabled: number;

  @Column("text", { default: "healthy" })
  health: string;

  @Column("text", { default: "[]" })
  lastLoadErrorsJson: string;
}
```

### 5.2 InstalledSkill Ownership Columns

Extend `InstalledSkillEntity`:

```typescript
@Index()
@Column("text", { nullable: true })
pluginName?: string;

@Column("text", { nullable: true })
pluginComponentPath?: string;
```

Rules:

- `pluginName = null` means standalone skill.
- `pluginName != null` means plugin-owned skill.
- Plugin-owned skills are removed on plugin uninstall.
- Plugin-owned skills can still be shown on the existing Skills page with an ownership label.

### 5.3 MCPTool Ownership and Stdio Columns

Extend `MCPToolEntity`:

```typescript
@Index()
@Column("text", { nullable: true })
pluginName?: string;

@Column("text", { nullable: true })
pluginComponentPath?: string;

@Column("text", { nullable: true })
command?: string;

@Column("text", { nullable: true })
argsJson?: string;

@Column("text", { nullable: true })
envJson?: string;

@Column("text", { nullable: true })
url?: string;

@Column("text", { default: "manual" })
origin: "manual" | "plugin";
```

The current fields stay in place for backward compatibility:

```text
serverName
host
port
transport
enabled
authType
authConfig
timeout
tools
toolConfig
metadata
```

Recommended compatibility behavior:

- Existing rows get `origin = "manual"`.
- Existing rows get `pluginName = null`.
- Existing stdio-like data in `host` remains readable.
- New plugin stdio rows store command data in `command`, `argsJson`, and `envJson`.

### 5.4 Component State JSON

`InstalledPluginEntity.componentStateJson` stores plugin-owned component enablement state independent from plugin-level enabled state.

Example:

```json
{
  "skills": {
    "lead_enrichment": {
      "enabled": true,
      "lastKnownValid": true
    }
  },
  "mcpServers": {
    "linkedin-browser": {
      "enabled": true,
      "toolConfig": {
        "searchProfiles": { "enabled": true },
        "sendMessage": { "enabled": false }
      }
    }
  }
}
```

This state prevents data loss when a user disables a whole plugin and later re-enables it.

## 6. Model and Module Contracts

### 6.1 InstalledPluginModel

File:

```text
src/model/InstalledPlugin.model.ts
```

Methods:

```typescript
export class InstalledPluginModel extends BaseDb {
  findAll(): Promise<InstalledPluginEntity[]>;
  findEnabled(): Promise<InstalledPluginEntity[]>;
  findByName(name: string): Promise<InstalledPluginEntity | null>;
  create(plugin: Partial<InstalledPluginEntity>): Promise<number>;
  updateByName(
    name: string,
    data: Partial<InstalledPluginEntity>
  ): Promise<boolean>;
  toggle(name: string, enabled: boolean): Promise<boolean>;
  remove(name: string): Promise<boolean>;
}
```

Implementation notes:

- Follow the lazy repository pattern used in `InstalledSkillModel`.
- Do not use direct database access from services or IPC.
- Use explicit return types on all methods.

### 6.2 PluginManagementModule

File:

```text
src/modules/PluginManagementModule.ts
```

Responsibilities:

- Plugin CRUD.
- Plugin ownership queries.
- Enable/disable coordination.
- Uninstall coordination.
- Component state updates.
- Health and diagnostics persistence.

Methods:

```typescript
export class PluginManagementModule extends BaseModule {
  listInstalledPlugins(): Promise<InstalledPluginEntity[]>;
  listEnabledPlugins(): Promise<InstalledPluginEntity[]>;
  getPluginByName(name: string): Promise<InstalledPluginEntity | null>;
  createPlugin(input: CreateInstalledPluginInput): Promise<number>;
  updatePluginState(input: UpdatePluginStateInput): Promise<boolean>;
  togglePlugin(name: string, enabled: boolean): Promise<boolean>;
  uninstallPlugin(name: string): Promise<PluginUninstallResult>;
  setLoadErrors(name: string, errors: readonly PluginError[]): Promise<boolean>;
  updateComponentState(
    name: string,
    state: PluginComponentState
  ): Promise<boolean>;
}
```

Module rules:

- It can call `InstalledPluginModel`.
- It can coordinate with `SkillManagementModule` and `MCPToolModule`.
- It should not parse zip files.
- It should not execute plugin code.

## 7. Service Design

### 7.1 PluginManifestService

File:

```text
src/service/PluginManifestService.ts
```

Responsibilities:

- Locate `.aifetchly-plugin/plugin.json`.
- Optionally fallback to root `plugin.json` for legacy packages.
- Parse JSON.
- Validate field types.
- Validate names, version, and path safety.
- Return a typed result instead of throwing for expected validation failures.

Contract:

```typescript
export interface PluginManifestReadResult {
  readonly success: true;
  readonly manifest: PluginManifest;
  readonly manifestPath: string;
}

export interface PluginManifestFailure {
  readonly success: false;
  readonly errors: readonly PluginError[];
}

export class PluginManifestService {
  static loadFromDirectory(
    pluginRoot: string
  ): Promise<PluginManifestReadResult | PluginManifestFailure>;

  static validateManifest(
    manifest: unknown,
    pluginRoot: string
  ): PluginManifestReadResult | PluginManifestFailure;
}
```

Path safety helper:

```typescript
export function resolvePluginRelativePath(
  pluginRoot: string,
  relativePath: string
): string {
  const resolved = path.resolve(path.join(pluginRoot, relativePath));
  const root = path.resolve(pluginRoot);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Path "${relativePath}" escapes plugin directory`);
  }
  return resolved;
}
```

### 7.2 PluginArchiveService

File:

```text
src/service/PluginArchiveService.ts
```

Responsibilities:

- Read zip entries.
- Reject absolute paths.
- Reject `..` path segments.
- Extract to a temp directory.
- Clean up temp directory on success or failure.

Contract:

```typescript
export interface ExtractedPluginArchive {
  readonly tempRoot: string;
  readonly cleanup: () => Promise<void>;
}

export class PluginArchiveService {
  static extractZip(zipPath: string): Promise<ExtractedPluginArchive>;
}
```

Security requirements:

- Reject symlink entries in v1.
- Reject entries larger than configured package max size.
- Reject packages with too many files.
- Never extract over an existing installed plugin path.

Suggested limits:

```typescript
export const PLUGIN_PACKAGE_LIMITS = {
  maxZipBytes: 50 * 1024 * 1024,
  maxExtractedBytes: 250 * 1024 * 1024,
  maxFiles: 5000,
} as const;
```

### 7.3 PluginImportService

File:

```text
src/service/PluginImportService.ts
```

Responsibilities:

- Extract zip.
- Validate plugin manifest.
- Validate skill manifests by reusing `SkillImportService` validation paths where possible.
- Validate MCP server declarations.
- Copy files to final install path.
- Persist plugin record and component records through Modules.
- Roll back on failure.
- Clear loader caches.

Contract:

```typescript
export interface PluginImportOptions {
  readonly zipPath: string;
  readonly overwrite?: boolean;
}

export interface PluginImportSuccess {
  readonly success: true;
  readonly plugin: PluginSummary;
}

export interface PluginImportFailure {
  readonly success: false;
  readonly errors: readonly PluginError[];
}

export class PluginImportService {
  static importFromZip(
    options: PluginImportOptions
  ): Promise<PluginImportSuccess | PluginImportFailure>;
}
```

Atomic import sequence:

```text
1. Validate renderer-provided path string.
2. Extract zip to temp path.
3. Load and validate plugin manifest.
4. Validate all declared skill components.
5. Validate all declared MCP server components.
6. Resolve final install path.
7. Copy temp root to final install path using a temporary sibling.
8. Persist InstalledPlugin row.
9. Persist plugin-owned InstalledSkill rows.
10. Persist plugin-owned MCPTool rows.
11. Clear plugin, skill, and MCP caches.
12. Return plugin summary.
```

Rollback:

```text
If step 8, 9, or 10 fails:
  - delete inserted plugin row if present
  - delete inserted plugin-owned skill rows
  - delete inserted plugin-owned MCP rows
  - remove final install path
  - remove temp path
```

Because SQLite transactions across all current Modules may not be available as a shared unit, v1 can implement compensating rollback. A future improvement can add transaction support to shared model operations.

### 7.4 PluginLoaderService

File:

```text
src/service/PluginLoaderService.ts
```

Responsibilities:

- Load all installed plugins from database.
- Validate install path still exists.
- Reload manifests from disk.
- Split enabled and disabled plugins.
- Load components.
- Collect recoverable load errors.
- Memoize results.

Contract:

```typescript
export interface LoadedPlugin {
  readonly name: string;
  readonly displayName?: string;
  readonly version: string;
  readonly source: PluginSource;
  readonly enabled: boolean;
  readonly installPath: string;
  readonly manifest: PluginManifest;
  readonly skills: readonly LoadedPluginSkill[];
  readonly mcpServers: readonly LoadedPluginMcpServer[];
  readonly errors: readonly PluginError[];
}

export interface PluginLoadResult {
  readonly enabled: readonly LoadedPlugin[];
  readonly disabled: readonly LoadedPlugin[];
  readonly errors: readonly PluginError[];
}

export class PluginLoaderService {
  static loadAllPlugins(): Promise<PluginLoadResult>;
  static clearCache(reason: string): void;
}
```

Memoization:

- First load reads from disk and database.
- Later loads return cached result.
- Cache is cleared after plugin import, uninstall, enable, disable, and update.
- Cache is also cleared after skill or MCP component state changes.

### 7.5 PluginComponentRegistryService

File:

```text
src/service/PluginComponentRegistryService.ts
```

Responsibilities:

- Convert loaded plugin skills into `SkillDefinition` entries.
- Register enabled plugin skills in `SkillRegistry`.
- Remove disabled plugin skills from `SkillRegistry`.
- Ensure plugin-owned MCP servers are enabled or disabled in MCP catalogs based on plugin state.
- Trigger tool catalog cache refresh.

Contract:

```typescript
export class PluginComponentRegistryService {
  static applyLoadedPlugins(loadResult: PluginLoadResult): Promise<void>;
  static unregisterPluginCapabilities(pluginName: string): Promise<void>;
}
```

Important boundary:

- This service adapts plugin data into existing systems.
- It does not execute skills.
- It does not start MCP server processes directly.
- It does not write database records except through Modules when enablement changes must be persisted.

### 7.6 PluginDiagnosticsService

File:

```text
src/service/PluginDiagnosticsService.ts
```

Responsibilities:

- Convert errors to UI-safe text.
- Redact local secrets and auth data.
- Produce diagnostics JSON.

Contract:

```typescript
export interface PluginDiagnosticsBundle {
  readonly pluginName: string;
  readonly generatedAt: string;
  readonly summary: PluginSummary;
  readonly manifest: Record<string, unknown>;
  readonly errors: readonly PluginError[];
  readonly skills: readonly PluginSkillDiagnostic[];
  readonly mcpServers: readonly PluginMcpDiagnostic[];
}
```

## 8. Skill Integration

### 8.1 Install

For each plugin skill path:

```text
pluginRoot + relative skill manifest path
  -> read skill manifest
  -> validate using SkillImportService validation rules
  -> copy skill files as part of plugin install root
  -> create InstalledSkillEntity row with plugin ownership fields
```

The installed skill root can be one of two designs.

Recommended v1:

```text
userData/plugins/installed/<plugin-name>/skills/<skill-name>/
```

Then `SkillEnvironmentManager` needs to support plugin-owned skill roots.

Alternative:

```text
userData/installed_skills/<skill-name>/
```

This reuses current skill root resolution, but duplicates files outside the plugin install root.

Recommendation:

- Use plugin-owned skill roots under the plugin install path.
- Add root resolution to `SkillEnvironmentManager`.
- Keep standalone skills under `userData/installed_skills/<skill-name>/`.

### 8.2 Runtime Resolution

`SkillRegistry` currently resolves imported skill rows by name. Plugin-owned rows should behave the same from the AI tool-call perspective.

Needed updates:

- Include plugin-owned enabled skill rows in dynamic skill loading.
- Resolve plugin-owned skill entry paths from plugin install root.
- Preserve `documentationOnly`, Python, and `python_attachment_execution` behavior.
- Preserve permission categories and supported file type routing.

### 8.3 Disable

When a plugin is disabled:

- Keep the `InstalledSkillEntity.enabled` row value unchanged if it represents component preference.
- Effective runtime enablement becomes `plugin.enabled && skill.enabled`.
- `SkillRegistry.getAllToolFunctions()` should not include plugin-owned skills whose owner plugin is disabled.

Implementation options:

1. Query plugin state inside dynamic skill loading.
2. Denormalize effective disabled state by toggling skill rows.

Recommendation:

- Query plugin state. This preserves component preference and avoids rewriting many rows when plugin state changes.

## 9. MCP Integration

### 9.1 Install

For each plugin MCP file:

```text
read mcp/servers.json
  -> parse mcpServers object
  -> validate server declarations
  -> normalize declarations
  -> create MCPToolEntity rows with plugin ownership fields
```

For stdio servers:

```text
transport = "stdio"
serverName = manifest key
command = normalized command
argsJson = JSON.stringify(args)
envJson = JSON.stringify(env placeholders and non-secret defaults)
host = "stdio" compatibility placeholder only if required by current non-null entity field
```

For network servers:

```text
transport = "sse" | "websocket"
serverName = manifest key
host = parsed host
port = parsed port if present
url = full URL if present
```

### 9.2 Required MCP Model Fix

`MCPToolEntity.host` is currently non-null. Stdio MCP servers do not naturally have a host.

Recommended schema change:

- Make `host` nullable, or
- Keep `host` for compatibility but add `command`, `argsJson`, `envJson`, and `url`.

Recommendation:

- Add explicit command fields and allow `host` to remain a compatibility field in v1.
- Do not encode command arrays into `host`.

### 9.3 Tool Discovery

Plugin-owned MCP servers use the existing `MCPToolService.discoverTools(serverId)`.

Needed updates:

- `MCPClient` must support stdio command/args if it does not already.
- `MCPToolService.discoverTools()` must build the client from command fields for stdio servers.
- Tool schemas continue to be stored in `metadata.toolSchemas`.
- Tool enablement continues to be stored in `toolConfig`.

### 9.4 Effective Enablement

Effective MCP enablement:

```text
plugin is enabled
AND MCP server row is enabled
AND individual tool config is not disabled
```

`MCPToolService.getEnabledMCPTools()` should filter plugin-owned MCP servers by owner plugin state.

## 10. IPC Design

Add file:

```text
src/main-process/communication/plugin-ipc.ts
```

Add channels to:

```text
src/config/channellist.ts
```

Channels:

```typescript
export const PLUGIN_IMPORT = "plugin:import";
export const PLUGIN_VALIDATE_PACKAGE = "plugin:validate-package";
export const PLUGIN_LIST = "plugin:list";
export const PLUGIN_GET = "plugin:get";
export const PLUGIN_TOGGLE = "plugin:toggle";
export const PLUGIN_UNINSTALL = "plugin:uninstall";
export const PLUGIN_RELOAD = "plugin:reload";
export const PLUGIN_EXPORT_DIAGNOSTICS = "plugin:export-diagnostics";
export const PLUGIN_TOGGLE_SKILL = "plugin:toggle-skill";
export const PLUGIN_TOGGLE_MCP_SERVER = "plugin:toggle-mcp-server";
export const PLUGIN_TOGGLE_MCP_TOOL = "plugin:toggle-mcp-tool";
export const PLUGIN_TEST_MCP_CONNECTION = "plugin:test-mcp-connection";
export const PLUGIN_DISCOVER_MCP_TOOLS = "plugin:discover-mcp-tools";
```

### 10.1 AI Enable Check

Every handler that installs, enables, reloads, discovers, or exposes AI-callable plugin capabilities must check:

```typescript
const tokenService = new Token();
const aiEnabled = tokenService.getValue(USER_AI_ENABLED);
```

If AI is disabled, return:

```typescript
{
  status: false,
  msg: "AI features are not enabled. Please upgrade your plan to access AI features.",
  data: null
}
```

### 10.2 Handler Pattern

Handlers should follow the existing response shape:

```typescript
ipcMain.handle(PLUGIN_LIST, async (): Promise<CommonMessage<PluginSummary[] | null>> => {
  const notEnabled = checkAiEnabled();
  if (notEnabled) return notEnabled;

  try {
    const module = new PluginManagementModule();
    const plugins = await module.listInstalledPlugins();
    return {
      status: true,
      msg: "Plugins retrieved",
      data: plugins.map(toPluginSummary),
    };
  } catch (error: unknown) {
    return {
      status: false,
      msg: error instanceof Error ? error.message : "Unknown error occurred",
      data: null,
    };
  }
});
```

Rules:

- No direct repository access.
- No `any`.
- Validate payload shape before calling services.
- Validate strings for length.
- Treat renderer-provided paths as untrusted.
- Return structured errors in `data.errors` when useful.

## 11. Renderer Design

### 11.1 Files

```text
src/views/pages/systemsetting/plugins.vue
src/views/components/plugins/PluginManager.vue
src/views/components/plugins/PluginImportDialog.vue
src/views/components/plugins/PluginDetailPanel.vue
src/views/components/plugins/PluginOverviewTab.vue
src/views/components/plugins/PluginSkillsTab.vue
src/views/components/plugins/PluginMcpServersTab.vue
src/views/components/plugins/PluginPermissionsTab.vue
src/views/components/plugins/PluginDiagnosticsTab.vue
src/views/components/plugins/PluginManifestTab.vue
src/views/api/plugins.ts
```

### 11.2 Frontend API

File:

```text
src/views/api/plugins.ts
```

Types:

```typescript
export interface PluginSummary {
  id: number;
  name: string;
  displayName?: string;
  version: string;
  source: "local" | "builtin" | "marketplace";
  enabled: boolean;
  health: PluginHealth;
  skillCount: number;
  mcpServerCount: number;
  permissions: string[];
  lastUpdated: string;
}

export interface PluginDetail extends PluginSummary {
  description: string;
  author?: string;
  skills: PluginSkillComponent[];
  mcpServers: PluginMcpServerComponent[];
  errors: PluginError[];
  manifest: Record<string, unknown>;
}
```

Methods:

```typescript
export async function listPlugins(): Promise<PluginSummary[] | null>;
export async function getPlugin(name: string): Promise<PluginDetail | null>;
export async function importPlugin(zipPath: string): Promise<PluginSummary | null>;
export async function validatePluginPackage(zipPath: string): Promise<PluginValidationResult | null>;
export async function togglePlugin(name: string, enabled: boolean): Promise<void>;
export async function uninstallPlugin(name: string): Promise<void>;
export async function exportPluginDiagnostics(name: string): Promise<PluginDiagnosticsBundle | null>;
```

### 11.3 Page Layout

`plugins.vue` should be a settings tool surface:

```text
Toolbar
  search
  filters
  Import Plugin button

Main region
  plugin table
  selected plugin detail panel
```

Detail tabs:

```text
Overview
Skills
MCP Servers
Permissions
Diagnostics
Manifest
```

Component-level controls:

- Plugin enable toggle.
- Skill enable toggles.
- MCP server enable toggles.
- MCP tool enable toggles.
- Test connection action.
- Discover tools action.
- Export diagnostics action.
- Uninstall action.

### 11.4 Existing Skills and MCP Pages

Existing pages stay:

```text
src/views/pages/systemsetting/skills.vue
src/views/pages/systemsetting/mcp.vue
```

Updates:

- Show owner plugin name when `pluginName` is set.
- Disable destructive standalone actions for plugin-owned rows, or route them to plugin uninstall.
- Keep standalone skill and MCP management working.

## 12. Routing and i18n

### 12.1 Router

Add a system settings route:

```typescript
{
  path: "plugins",
  name: "system_setting_plugins",
  meta: {
    title: "route.plugins",
  },
  component: () => import("@/views/pages/systemsetting/plugins.vue"),
}
```

### 12.2 Translations

Update all language files:

```text
src/views/lang/en.ts
src/views/lang/zh.ts
src/views/lang/es.ts
src/views/lang/fr.ts
src/views/lang/de.ts
src/views/lang/ja.ts
```

Suggested key namespace:

```text
plugins.title
plugins.import_button
plugins.column_plugin
plugins.column_version
plugins.column_source
plugins.column_status
plugins.column_skills
plugins.column_mcp_servers
plugins.column_permissions
plugins.status_healthy
plugins.status_disabled
plugins.status_needs_configuration
plugins.status_partial_load
plugins.status_invalid
plugins.status_missing_files
plugins.tab_overview
plugins.tab_skills
plugins.tab_mcp_servers
plugins.tab_permissions
plugins.tab_diagnostics
plugins.tab_manifest
plugins.uninstall_confirm
plugins.import_validation_failed
```

Every visible UI string must use `useI18n`.

## 13. Load and Cache Invalidation

### 13.1 Cache Owners

Potential caches:

- `PluginLoaderService` loaded plugin cache.
- `SkillRegistry` dynamic tool list cache, if present.
- `MCPToolService` enabled tool list cache, if added later.
- AI tool catalog assembly in `skillsRegistry.ts` and `aiTools.config.ts`.

### 13.2 Cache Clear Events

Clear plugin and tool caches after:

- Plugin import.
- Plugin uninstall.
- Plugin enable/disable.
- Plugin-owned skill enable/disable.
- Plugin-owned MCP server enable/disable.
- Plugin-owned MCP tool enable/disable.
- MCP discovery for plugin-owned servers.
- Plugin reload.

Suggested central API:

```typescript
export class PluginRuntimeCache {
  static clear(reason: string): void {
    PluginLoaderService.clearCache(reason);
    SkillRegistry.clearDynamicCache?.(reason);
    MCPToolService.clearCache?.(reason);
  }
}
```

If existing services do not expose cache-clearing APIs, add them only where cache exists. Do not add fake cache APIs.

## 14. Error Model

Add to `src/entityTypes/pluginTypes.ts`:

```typescript
export type PluginErrorCode =
  | "manifest-not-found"
  | "manifest-invalid-json"
  | "manifest-schema-invalid"
  | "plugin-name-conflict"
  | "plugin-version-invalid"
  | "path-outside-plugin"
  | "component-not-found"
  | "skill-manifest-invalid"
  | "skill-import-failed"
  | "mcp-config-invalid"
  | "mcp-server-conflict"
  | "permission-denied"
  | "dependency-unsatisfied"
  | "install-io-failed"
  | "cache-missing"
  | "uninstall-failed"
  | "unknown";

export interface PluginError {
  readonly code: PluginErrorCode;
  readonly pluginName?: string;
  readonly componentType?: "plugin" | "skill" | "mcpServer";
  readonly componentName?: string;
  readonly path?: string;
  readonly message: string;
  readonly recoverable: boolean;
}
```

Service behavior:

- Validation failures return errors, not thrown exceptions.
- Unexpected I/O or database failures can throw internally, but IPC must convert them to `{ status: false, msg, data }`.
- Loader errors are collected. One bad plugin should not stop other plugins from loading.

## 15. Security Design

### 15.1 Zip Extraction

Reject:

- Absolute paths.
- `..` segments.
- Symlinks.
- Device files.
- Entries over package limits.
- Total extracted bytes over package limits.

### 15.2 Manifest Validation

Rules:

- Do not execute plugin code.
- Do not resolve network resources.
- Do not run MCP commands.
- Do not install Python dependencies during validation preview.
- Validate all paths under plugin root.

### 15.3 Secret Handling

MCP env declarations may include placeholders:

```json
{
  "env": {
    "API_TOKEN": "${user:API_TOKEN}"
  }
}
```

Import behavior:

- Store placeholder metadata, not the secret.
- Prompt user for secret during configuration.
- Store secret through existing secure token storage if available.
- Never show secret plaintext after save.

### 15.4 Permission Handling

Skills:

- Use `SkillPermissionService`.

MCP:

- V1 at minimum uses server/tool enablement and install-time warnings.
- If MCP permission policy is added later, plugin-owned MCP tools should pass through it before execution.

### 15.5 Process Execution

Plugin import must never execute:

- Skill entry files.
- MCP server commands.
- Shell scripts.
- Package manager commands.

MCP server commands execute only through MCP connection/test/discovery flows initiated by the user or AI runtime after enablement.

## 16. Migration Plan

### 16.1 Entity Registration

Add `InstalledPluginEntity` import and entity registration in:

```text
src/config/SqliteDb.ts
```

### 16.2 Existing Data

Existing installed skills:

- `pluginName = null`
- `pluginComponentPath = null`

Existing MCP rows:

- `pluginName = null`
- `pluginComponentPath = null`
- `origin = "manual"`

### 16.3 Synchronize Behavior

The project currently uses `synchronize: true`. Entity changes should be verified by running the existing database initialization flow used by the project.

Implementation must verify:

- New table creation.
- New nullable columns on existing tables.
- Existing rows remain readable.
- Existing Skills and MCP pages continue to load.

## 17. Testing Plan

### 17.1 Unit Tests

Add:

```text
test/vitest/utilitycode/pluginManifestService.test.ts
test/vitest/utilitycode/pluginArchiveService.test.ts
test/vitest/utilitycode/pluginImportService.test.ts
test/modules/PluginManagementModule.test.ts
test/vitest/main/plugin-ipc.test.ts
```

Cases:

- Valid manifest loads.
- Root `plugin.json` fallback works if enabled.
- Missing manifest fails.
- Invalid JSON fails.
- Invalid semver fails.
- Path escaping plugin root fails.
- Zip slip entries fail.
- Symlink entries fail.
- Duplicate plugin name fails unless overwrite is true.
- Plugin import rollback removes partial rows.
- Disabled plugin hides skills from tool catalog.
- Disabled plugin hides MCP tools from tool catalog.
- Uninstall removes plugin-owned components.
- Uninstall does not remove standalone components.

### 17.2 Fixture Packages

Create fixtures under:

```text
test/fixtures/plugins/
```

Fixtures:

```text
valid-skill-plugin.zip
valid-mcp-plugin.zip
valid-combined-plugin.zip
missing-manifest.zip
invalid-manifest-json.zip
path-traversal.zip
broken-skill-component.zip
broken-mcp-component.zip
```

### 17.3 UI Tests

Test:

- Empty state.
- Import validation success.
- Import validation failure.
- Plugin list filters.
- Detail tabs.
- Enable/disable plugin.
- Enable/disable plugin-owned skill.
- Enable/disable plugin-owned MCP server.
- Discover tools action state.
- Export diagnostics action.
- Uninstall confirmation.

### 17.4 Manual Verification

Commands:

```bash
yarn test
yarn testmain
yarn vue-check
```

For UI verification:

```bash
yarn dev
```

Then open System Settings -> Plugins and test:

- Import valid combined plugin.
- Disable plugin.
- Confirm tools disappear from AI tool list.
- Re-enable plugin.
- Discover MCP tools.
- Uninstall plugin.

## 18. Implementation Phases

### Phase 1: Types, Entity, Model, Module

Files:

```text
src/entityTypes/pluginTypes.ts
src/entity/InstalledPlugin.entity.ts
src/model/InstalledPlugin.model.ts
src/modules/PluginManagementModule.ts
src/config/SqliteDb.ts
```

Deliverables:

- Plugin table.
- Ownership columns.
- Plugin CRUD.
- Unit tests.

### Phase 2: Manifest and Archive Validation

Files:

```text
src/service/PluginManifestService.ts
src/service/PluginArchiveService.ts
```

Deliverables:

- Safe zip extraction.
- Manifest parsing.
- Path validation.
- Structured errors.
- Fixture tests.

### Phase 3: Import Service

Files:

```text
src/service/PluginImportService.ts
```

Deliverables:

- Atomic import.
- Skill component validation.
- MCP component validation.
- Persist plugin-owned components.
- Rollback tests.

### Phase 4: Loader and Runtime Registry

Files:

```text
src/service/PluginLoaderService.ts
src/service/PluginComponentRegistryService.ts
```

Deliverables:

- Enabled plugin loading.
- Dynamic registration with existing skill and MCP systems.
- Cache invalidation.
- Effective enablement.

### Phase 5: IPC

Files:

```text
src/main-process/communication/plugin-ipc.ts
src/config/channellist.ts
```

Deliverables:

- Plugin IPC channels.
- AI enable checks.
- Input validation.
- IPC tests.

### Phase 6: Renderer UI

Files:

```text
src/views/pages/systemsetting/plugins.vue
src/views/components/plugins/*
src/views/api/plugins.ts
src/views/router/index.ts
src/views/lang/*.ts
```

Deliverables:

- Plugin Manager page.
- Import dialog.
- Detail tabs.
- Diagnostics export.
- i18n in all supported languages.

### Phase 7: Hardening

Deliverables:

- Security edge tests.
- Existing Skills/MCP page ownership labels.
- UI QA.
- Documentation updates.

## 19. Key Trade-offs

### 19.1 Plugin-Owned Skill Root

Recommendation:

- Store plugin-owned skill files under plugin install root.

Trade-off:

- Requires root resolution updates in skill services.
- Keeps uninstall clean and avoids duplicate files.

### 19.2 Effective Enablement Instead of Row Rewrites

Recommendation:

- Compute effective enablement as plugin state plus component state.

Trade-off:

- Tool catalog queries become slightly more complex.
- User component preferences survive plugin disable/enable cycles.

### 19.3 Local Zip Only in V1

Recommendation:

- Support local zip only first.

Trade-off:

- No marketplace yet.
- Security, rollback, and ownership model can stabilize before remote install complexity.

### 19.4 Explicit MCP Stdio Fields

Recommendation:

- Add command/args/env columns.

Trade-off:

- Requires schema update.
- Avoids corrupting semantics of `host`.

## 20. Open Technical Decisions

1. Should plugin-owned skill root resolution live in `SkillEnvironmentManager` only, or should it be passed through every skill execution context?
   - Recommendation: centralize in `SkillEnvironmentManager`.

2. Should plugin import reuse `SkillImportService.importFromZip()` internally?
   - Recommendation: reuse validation helpers, but do not call full standalone import because plugin-owned skill files live under plugin root.

3. Should MCP secrets use `Token` directly or a new secret abstraction?
   - Recommendation: use existing secure storage pattern first, then extract a `PluginSecretService` only if duplication appears.

4. Should `PluginLoaderService` run at app startup or lazily when AI tool catalogs are requested?
   - Recommendation: lazy load with explicit cache clear. The UI can call reload when opened.

5. Should failed plugin components be persisted during initial import?
   - Recommendation: no. V1 rejects partial installs. Partial Load applies only when a previously valid installed plugin becomes broken on disk.

## 21. Done Criteria

The technical implementation is complete when:

- Plugin zip import validates and installs local plugins.
- Plugin-owned skills and MCP servers persist with ownership metadata.
- Disabling a plugin removes owned capabilities from AI tool catalogs.
- Re-enabling a plugin restores prior component preferences.
- Uninstall removes plugin-owned rows and files.
- Existing standalone Skills and MCP pages still work.
- Plugin Manager UI handles list, detail, import, enable, disable, diagnostics, and uninstall.
- All user-facing text is translated across all supported language files.
- Security tests cover zip traversal and invalid path declarations.
- Unit, IPC, and UI tests cover the main flows.

