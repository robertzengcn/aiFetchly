# Plugin-Installed Subagents and Subagent Management - Technical Design

Version: 1.0
Date: 2026-07-11
Status: Draft
Source PRD: `docs/prd/plugin-subagent-management-prd.md`

## 1. Purpose

This document translates the Plugin-Installed Subagents PRD into an implementation-facing technical design for aiFetchly.

The goal is to make subagents a first-class plugin component and a first-class user-managed capability. Plugins may contribute agent definition Markdown files, users may create manual subagents, and the existing agent runtime consumes only enabled definitions.

This design deliberately does not add a new agent runtime. It extends the existing plugin import pipeline, `AgentDefinitionEntity`, `AgentDefinitionModule`, runtime definition listing, and settings UI.

## 2. Scope

In scope:

- Native and Claude-compatible plugin `agents` declarations.
- Plugin `agents/` directory discovery for Claude-compatible plugins.
- Markdown agent parsing with YAML-style frontmatter.
- Plugin-owned agent persistence.
- Manual agent CRUD.
- Subagents settings UI.
- Plugin detail Subagents tab.
- Runtime active-catalog filtering by agent status and owning plugin enablement.
- Import rollback and uninstall cleanup.
- i18n for all new UI strings.
- Unit, IPC, integration, and focused UI tests.

Out of scope:

- Coordinator workers.
- Teammate mode.
- Remote agents.
- Process-per-agent execution.
- Plugin-owned Vue or Electron extensions.
- Agent-provided hooks or MCP servers from agent frontmatter.
- Marketplace browsing.
- Runtime prompt architecture changes beyond using the updated active definition catalog.

## 3. Key Decisions

### 3.1 Invalid plugin agents fail import in v1

If a plugin explicitly declares agents and any declared agent file is invalid, plugin import fails atomically. This matches the current `PluginImportService` pattern for skill and MCP validation and prevents silently degraded agent catalogs.

If a Claude plugin only has an auto-detected `agents/` directory and all agent files are invalid, import fails with agent parse errors. If the directory is absent, the plugin imports normally with zero agents.

### 3.2 Manual agent IDs use `user:` prefix

Manual agents use IDs in the form:

```text
user:<slug>
```

The UI can display only the friendly name, but persisted IDs use the prefix to prevent future collisions with plugin names and built-ins.

### 3.3 Plugin agent IDs use plugin namespace

Plugin agent IDs use:

```text
<plugin-name>:<agent-name>
<plugin-name>:<nested-dir>:<agent-name>
```

The frontmatter `name` field is required. The nested path is included only when the Markdown file is under nested folders below an agent root.

### 3.4 Agent row status is the runtime source of truth

`agent_definitions.status` is the runtime source of truth for component-level enablement. For plugin-owned agents, `installed_plugins.componentStateJson.agents` mirrors the same enabled state so future overwrite/update flows can preserve user toggles.

On plugin import or overwrite:

1. Load previous component state if the plugin already existed.
2. Derive each plugin agent's initial `status` from that state when available.
3. Persist the agent row.
4. Persist mirrored component state.

At runtime, active filtering reads `agent_definitions.status` plus `installed_plugins.enabled`. It does not need to parse component state on every runtime lookup.

### 3.5 `tools` and `skills` both map to `allowedTools`

Claude-style agent frontmatter may contain `tools` and `skills`. For v1, both are normalized into `allowedTools`.

No automatic skill preloading is implemented in this feature. The existing `AgentPromptBuilder` and runtime policy decide which available tool names are exposed.

### 3.6 Built-ins are marked on every seed

`AgentDefinitionModule.ensureBuiltIns()` should upsert built-ins with `source = "built-in"` every startup. Existing rows are upgraded by normal TypeORM synchronization and reseeding.

## 4. Existing System Anchors

### 4.1 Agent runtime

```text
src/entity/AgentDefinition.entity.ts
src/entityTypes/agentTypes.ts
src/model/AgentDefinition.model.ts
src/modules/AgentDefinitionModule.ts
src/service/AgentDefinitionRegistry.ts
src/service/AgentRuntime.ts
src/service/AgentRuntimeRegistry.ts
src/service/AgentToolPolicyService.ts
src/main-process/communication/agent-runtime-ipc.ts
```

Current runtime path:

```text
run_subagent tool or agent runtime IPC
  -> AgentRuntime
  -> AgentDefinitionModule.getActiveById()
  -> AgentToolPolicyService
  -> SkillExecutor / tool loop
  -> AgentTask persistence
```

This feature changes definition storage, listing, and management. It does not change the model/tool loop.

### 4.2 Plugin pipeline

```text
src/entityTypes/pluginTypes.ts
src/entity/InstalledPlugin.entity.ts
src/model/InstalledPlugin.model.ts
src/modules/PluginManagementModule.ts
src/service/PluginManifestService.ts
src/service/PluginImportService.ts
src/service/PluginLoaderService.ts
src/service/PluginComponentRegistryService.ts
src/service/PluginRuntimeCache.ts
src/service/pluginCompat/ClaudePluginAdapter.ts
src/main-process/communication/plugin-ipc.ts
src/views/api/plugins.ts
src/views/components/plugins/*
```

Current plugin import persists:

- one installed plugin row
- plugin-owned installed skill rows
- plugin-owned MCP server rows

This feature adds plugin-owned agent definition rows to the same lifecycle.

### 4.3 Frontmatter parsing

Existing parser:

```text
src/service/pluginCompat/claudeFrontmatterParser.ts
```

Existing skill adapter:

```text
src/service/pluginCompat/ClaudeSkillFormatAdapter.ts
```

The agent adapter should reuse the existing frontmatter parser instead of adding a new YAML dependency. If the parser later needs strict YAML support, upgrade the shared parser once for skills and agents.

### 4.4 Database initialization

`SqliteDb` uses TypeORM `synchronize: true`, and `AgentDefinitionEntity` is already registered in `src/config/SqliteDb.ts`. Adding nullable/defaulted columns to the existing entity is sufficient for this local SQLite schema style.

## 5. Target Architecture

```text
Plugin source package
  .aifetchly-plugin/plugin.json OR .claude-plugin/plugin.json
  agents/*.md
        |
        v
PluginManifestService.loadFromDirectory()
  - validates manifest
  - normalizes native and Claude `agents`
        |
        v
PluginAgentImportService.parsePluginAgents()
  - resolves safe paths
  - walks directories
  - parses Markdown frontmatter
  - filters forbidden fields
  - builds AgentDefinitionView + metadata
        |
        v
PluginImportService.importFromDirectory()
  - copies plugin files
  - persists plugin row
  - persists skills
  - persists MCP servers
  - persists agent definitions through AgentDefinitionModule
        |
        v
AgentDefinitionModule
  - management CRUD
  - source-based authorization
  - active runtime filtering
        |
        v
Agent runtime / UI
  - Subagents settings page
  - Plugin Subagents tab
  - agent-runtime:definition-list
```

## 6. Type Changes

### 6.1 `AgentDefinitionSource`

Add to `src/entityTypes/agentTypes.ts`:

```typescript
export type AgentDefinitionSource = "built-in" | "user" | "plugin";
```

### 6.2 `AgentDefinitionHealth`

Add:

```typescript
export type AgentDefinitionHealth =
  | "healthy"
  | "disabled"
  | "partial_load"
  | "invalid"
  | "missing_files";
```

### 6.3 Extend `AgentDefinitionView`

Current:

```typescript
export interface AgentDefinitionView {
  id: string;
  name: string;
  description: string;
  version: number;
  systemPrompt: string;
  allowedTools: string[];
  defaultModel?: string;
  mode: AgentMode;
  maxToolCalls: number;
  maxRuntimeMs: number;
  maxContinueCalls: number;
  outputSchema: Record<string, unknown>;
  status: "active" | "disabled";
}
```

Required extended shape:

```typescript
export interface AgentDefinitionView {
  id: string;
  name: string;
  description: string;
  version: number;
  systemPrompt: string;
  allowedTools: string[];
  defaultModel?: string;
  mode: AgentMode;
  maxToolCalls: number;
  maxRuntimeMs: number;
  maxContinueCalls: number;
  outputSchema: Record<string, unknown>;
  status: "active" | "disabled";
  source: AgentDefinitionSource;
  pluginName?: string;
  pluginComponentPath?: string;
  manifest?: Record<string, unknown>;
  health: AgentDefinitionHealth;
  lastError?: string;
  createdAt?: string;
  updatedAt?: string;
}
```

### 6.4 Manual agent input DTOs

Add:

```typescript
export interface CreateManualAgentDefinitionInput {
  idSlug: string;
  name: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  defaultModel?: string;
  mode: AgentMode;
  maxToolCalls: number;
  maxRuntimeMs: number;
  maxContinueCalls: number;
  outputSchema?: Record<string, unknown>;
  enabled?: boolean;
}

export interface UpdateManualAgentDefinitionInput {
  name?: string;
  description?: string;
  systemPrompt?: string;
  allowedTools?: string[];
  defaultModel?: string | null;
  mode?: AgentMode;
  maxToolCalls?: number;
  maxRuntimeMs?: number;
  maxContinueCalls?: number;
  outputSchema?: Record<string, unknown>;
  enabled?: boolean;
}
```

### 6.5 Plugin agent parse DTOs

Add:

```typescript
export interface ParsedPluginAgentDefinition {
  definition: AgentDefinitionView;
  pluginName: string;
  componentPath: string;
  manifest: Record<string, unknown>;
  warnings: PluginError[];
}

export type PluginAgentParseResult =
  | {
      ok: true;
      agents: ParsedPluginAgentDefinition[];
      warnings: PluginError[];
    }
  | {
      ok: false;
      errors: PluginError[];
    };
```

## 7. Entity Changes

### 7.1 `AgentDefinitionEntity`

Update `src/entity/AgentDefinition.entity.ts`:

```typescript
@Order(14)
@Column("varchar", { length: 32, nullable: false, default: "built-in" })
source: string;

@Order(15)
@Index()
@Column("varchar", { length: 100, nullable: true })
pluginName?: string | null;

@Order(16)
@Column("text", { nullable: true })
pluginComponentPath?: string | null;

@Order(17)
@Column("text", { nullable: true })
manifestJson?: string | null;

@Order(18)
@Column("varchar", { length: 32, nullable: false, default: "healthy" })
health: string;

@Order(19)
@Column("text", { nullable: true })
lastError?: string | null;
```

Keep existing indexes:

- unique `agentId`
- `status`

Add indexes:

- `source`
- `pluginName`
- composite `pluginName, status` if query performance requires it

### 7.2 Column defaults and migration behavior

Existing rows should automatically receive:

- `source = "built-in"`
- `health = "healthy"`
- nullable plugin fields

Then `AgentDefinitionModule.ensureBuiltIns()` upserts the full built-in shape on startup.

## 8. Plugin Type Changes

### 8.1 `PluginManifest`

Extend `src/entityTypes/pluginTypes.ts`:

```typescript
export type PluginAgentDeclaration =
  | string
  | readonly string[]
  | true
  | Record<string, { source?: string; content?: string; description?: string }>;

export interface PluginManifest {
  readonly name: string;
  readonly displayName?: string;
  readonly version: string;
  readonly description: string;
  readonly author?: string;
  readonly source?: PluginSource;
  readonly format?: PluginFormat;
  readonly skills?: readonly string[];
  readonly mcpServers?: readonly string[];
  readonly agents?: PluginAgentDeclaration;
  readonly permissions?: readonly string[];
  readonly dependencies?: readonly PluginDependency[];
  readonly homepage?: string;
  readonly repository?: string;
  readonly [extra: string]: unknown;
}
```

Native aiFetchly manifests should use `agents?: readonly string[]`. The broader union exists because Claude-compatible manifests can use `true`, a string, or an object map.

### 8.2 `PluginComponentState`

Extend:

```typescript
export interface PluginComponentState {
  readonly skills?: Record<string, PluginComponentStateEntry>;
  readonly mcpServers?: Record<string, {
    readonly enabled: boolean;
    readonly toolConfig?: Record<string, PluginMcpToolConfig>;
  }>;
  readonly agents?: Record<string, PluginComponentStateEntry>;
}
```

Keys under `agents` must be full agent IDs, not unscoped names.

### 8.3 `PluginError`

Extend `componentType`:

```typescript
componentType?: "plugin" | "skill" | "mcpServer" | "agent";
```

Add error codes:

```typescript
| "agent-manifest-invalid"
| "agent-frontmatter-invalid"
| "agent-frontmatter-missing-field"
| "agent-name-conflict"
| "agent-path-invalid"
| "agent-unsupported-field"
```

### 8.4 Plugin summary/detail

Extend:

```typescript
export interface PluginSummary {
  readonly id: number;
  readonly name: string;
  readonly displayName?: string;
  readonly version: string;
  readonly source: PluginSource;
  readonly enabled: boolean;
  readonly health: PluginHealth;
  readonly format?: PluginFormat;
  readonly skillCount: number;
  readonly mcpServerCount: number;
  readonly agentCount: number;
  readonly permissions: readonly string[];
  readonly lastUpdated: string;
}

export interface PluginAgentComponent {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly mode: AgentMode;
  readonly toolCount: number;
  readonly componentPath: string;
  readonly health: AgentDefinitionHealth;
  readonly error?: string;
}

export interface PluginDetail extends PluginSummary {
  readonly description: string;
  readonly author?: string;
  readonly skills: readonly PluginSkillComponent[];
  readonly mcpServers: readonly PluginMcpServerComponent[];
  readonly agents: readonly PluginAgentComponent[];
  readonly errors: readonly PluginError[];
  readonly manifest: Record<string, unknown>;
  readonly sourceKind?: PluginSourceKind;
  readonly sourceUri?: string;
  readonly sourceRef?: string;
}
```

## 9. Manifest Loading and Validation

### 9.1 Native manifest validation

In `PluginManifestService.validateManifest()`:

1. Accept optional `agents`.
2. Validate native `agents` as an array of non-empty relative strings when format is `aifetchly`.
3. Update component requirement:

```typescript
const skills = Array.isArray(m.skills) ? m.skills : [];
const mcpServers = Array.isArray(m.mcpServers) ? m.mcpServers : [];
const agents = Array.isArray(m.agents) ? m.agents : [];

if (skills.length === 0 && mcpServers.length === 0 && agents.length === 0) {
  errors.push(...);
}
```

4. Run `resolvePluginRelativePath(pluginRoot, agentPath)` for every native agent path.

### 9.2 Claude manifest adaptation

Update `ClaudePluginAdapter`:

- Stop treating `agents` only as opaque.
- Normalize `agents` to `manifest.agents`.
- Preserve the raw `agents` field under `__claudeOpaque__` as well for diagnostics.
- If `agents` is missing and `<pluginRoot>/agents` exists, set `manifest.agents = true`.

Add helper:

```typescript
function normalizeAgentsField(
  raw: AgentDecl | undefined,
  pluginRoot: string,
  errors: PluginError[]
): PluginAgentDeclaration | undefined
```

Accepted Claude forms:

- `true` means default `agents/`.
- string path.
- string array.
- object map. Object map keys become `agents/<key>.md` unless a value has a string `source`, in which case use that source path.

Object map `content` support is deferred. If an object value uses `content` without `source`, return `agent-unsupported-field` because this implementation imports files from disk only.

## 10. Plugin Agent Parser

### 10.1 File

Create:

```text
src/service/pluginCompat/ClaudeAgentFormatAdapter.ts
src/service/PluginAgentImportService.ts
```

Use `ClaudeAgentFormatAdapter` for one Markdown file. Use `PluginAgentImportService` for manifest declarations, path walking, and plugin-level conflict detection.

### 10.2 `ClaudeAgentFormatAdapter`

Contract:

```typescript
export interface ClaudeAgentAdaptOptions {
  pluginName: string;
  sourcePath: string;
  namespaceSegments: readonly string[];
}

export interface ClaudeAgentAdaptSuccess {
  ok: true;
  definition: AgentDefinitionView;
  manifest: Record<string, unknown>;
  warnings: PluginError[];
}

export interface ClaudeAgentAdaptFailure {
  ok: false;
  errors: PluginError[];
}

export type ClaudeAgentAdaptResult =
  | ClaudeAgentAdaptSuccess
  | ClaudeAgentAdaptFailure;

export class ClaudeAgentFormatAdapter {
  static adapt(
    markdown: string,
    options: ClaudeAgentAdaptOptions
  ): ClaudeAgentAdaptResult;
}
```

### 10.3 Required fields

Required frontmatter:

- `name`: non-empty string
- `description`: non-empty string

Missing required fields return:

- `agent-frontmatter-missing-field`

### 10.4 Name normalization

Use a stricter agent segment sanitizer than skills:

```typescript
const AGENT_SEGMENT_REGEX = /^[a-z0-9][a-z0-9_-]*$/;
```

Normalize:

1. lowercase
2. replace non `[a-z0-9_-]` with `-`
3. collapse repeated `-`
4. trim leading/trailing `-` and `_`
5. reject if empty

Do not silently invent names for plugin agents. A bad or empty name is an invalid agent file.

### 10.5 Namespace generation

Input:

```text
pluginRoot/agents/reviewer.md
```

Output:

```text
plugin-name:reviewer
```

Input:

```text
pluginRoot/agents/review/security.md
```

with frontmatter:

```yaml
name: strict
```

Output:

```text
plugin-name:review:strict
```

Algorithm:

```typescript
function buildPluginAgentId(
  pluginName: string,
  namespaceSegments: readonly string[],
  agentName: string
): string {
  return [pluginName, ...namespaceSegments, agentName].join(":");
}
```

`namespaceSegments` are derived from directories between the declared agent root and the Markdown file's parent directory. The frontmatter name is always the final segment.

### 10.6 Supported frontmatter mapping

| Frontmatter | Target | Notes |
| --- | --- | --- |
| `name` | ID segment and display name fallback | Required |
| `displayName` | `name` | Optional friendly display |
| `description` | `description` | Required |
| `tools` | `allowedTools` | string array |
| `skills` | `allowedTools` | union with `tools` |
| `model` | `defaultModel` | string |
| `mode` | `mode` | default `specialist` |
| `maxTurns` | `maxContinueCalls` | integer |
| `maxToolCalls` | `maxToolCalls` | integer |
| `maxRuntimeMs` | `maxRuntimeMs` | integer |
| `outputSchema` | `outputSchema` | object only |
| `color` | `manifest.color` | stored only |
| `background` | `manifest.background` | stored only |
| `effort` | `manifest.effort` | stored only |

Defaults:

```typescript
version: 1
mode: "specialist"
allowedTools: []
maxToolCalls: 8
maxRuntimeMs: 300000
maxContinueCalls: 8
outputSchema: {}
status: "active"
source: "plugin"
health: "healthy"
```

### 10.7 Markdown body

The Markdown body becomes `systemPrompt`. Trim only leading and trailing whitespace. If empty, return `agent-frontmatter-missing-field` with message "Agent body is empty."

### 10.8 Forbidden fields

Forbidden fields:

- `permissionMode`
- `hooks`
- `mcpServers`
- `alwaysAllow`
- `disallowedTools`
- `mcp`
- `servers`

Behavior:

1. Ignore the field for runtime.
2. Add a recoverable `agent-unsupported-field` warning.
3. Store the raw field in `manifestJson` for diagnostics.

### 10.9 `PluginAgentImportService`

File:

```text
src/service/PluginAgentImportService.ts
```

Contract:

```typescript
export interface ParsePluginAgentsInput {
  pluginRoot: string;
  manifest: PluginManifest;
}

export class PluginAgentImportService {
  static parsePluginAgents(
    input: ParsePluginAgentsInput
  ): PluginAgentParseResult;
}
```

Responsibilities:

- Resolve `manifest.agents`.
- For Claude format and no `manifest.agents`, detect `agents/`.
- Resolve every path with `resolvePluginRelativePath()`.
- Walk directories recursively for `.md` files.
- Ignore non-Markdown files.
- Read file contents.
- Compute namespace segments.
- Call `ClaudeAgentFormatAdapter.adapt()`.
- Reject duplicate IDs in the same plugin.
- Return all parsed agents and warnings.

This service may use synchronous `fs` calls, matching current plugin import code. It must not write files or database rows.

### 10.10 Directory walking

Use a local helper, not `fast-glob`, to keep import path safety explicit:

```typescript
function walkMarkdownFiles(root: string): string[] {
  // depth-first, sorted for deterministic import order
}
```

Sort paths lexicographically before parsing so tests and import results are stable.

## 11. Model and Module Changes

### 11.1 `AgentDefinitionModel`

Add methods:

```typescript
async listAll(): Promise<AgentDefinitionView[]>;

async listActive(): Promise<AgentDefinitionView[]>;

async listActiveWithPluginEnablement(): Promise<AgentDefinitionView[]>;

async getById(agentId: string): Promise<AgentDefinitionView | null>;

async getActiveByIdWithPluginEnablement(
  agentId: string
): Promise<AgentDefinitionView | null>;

async findByPluginName(pluginName: string): Promise<AgentDefinitionView[]>;

async deleteByPluginName(pluginName: string): Promise<string[]>;

async toggle(agentId: string, enabled: boolean): Promise<boolean>;

async createUserAgent(
  input: AgentDefinitionView
): Promise<void>;

async updateUserAgent(
  agentId: string,
  patch: Partial<AgentDefinitionView>
): Promise<boolean>;

async deleteUserAgent(agentId: string): Promise<boolean>;

async upsertPluginAgent(
  view: AgentDefinitionView,
  pluginName: string,
  componentPath: string,
  manifest: Record<string, unknown>
): Promise<void>;
```

`listActiveWithPluginEnablement()` should use a query builder with a left join to `installed_plugins`:

```sql
SELECT agent_definitions.*
FROM agent_definitions
LEFT JOIN installed_plugins
  ON agent_definitions.pluginName = installed_plugins.name
WHERE agent_definitions.status = 'active'
  AND (
    agent_definitions.source != 'plugin'
    OR installed_plugins.enabled = 1
  )
  AND agent_definitions.health = 'healthy'
```

If TypeORM relation setup is not desirable, use query builder on entity names without declaring relations.

### 11.2 `AgentDefinitionModule`

Add methods:

```typescript
async listAllForManagement(): Promise<AgentDefinitionView[]>;

async listActiveForRuntime(): Promise<AgentDefinitionView[]>;

async getForManagement(agentId: string): Promise<AgentDefinitionView | null>;

async getActiveById(agentId: string): Promise<AgentDefinitionView | null>;

async createManualAgent(
  input: CreateManualAgentDefinitionInput
): Promise<AgentDefinitionView>;

async updateManualAgent(
  agentId: string,
  input: UpdateManualAgentDefinitionInput
): Promise<AgentDefinitionView>;

async toggleAgent(agentId: string, enabled: boolean): Promise<boolean>;

async deleteManualAgent(agentId: string): Promise<boolean>;

async findAgentsByPluginName(pluginName: string): Promise<AgentDefinitionView[]>;

async deleteAgentsByPluginName(pluginName: string): Promise<string[]>;

async upsertPluginAgents(
  pluginName: string,
  agents: readonly ParsedPluginAgentDefinition[]
): Promise<void>;
```

Authorization rules:

- Built-ins cannot be deleted.
- Built-ins cannot be edited through management IPC in v1.
- Plugin-owned agents cannot be edited directly.
- Plugin-owned agents can be toggled.
- Manual agents can be edited, toggled, and deleted.
- Manual agent creation rejects ID collisions with any existing source.

### 11.3 Manual ID normalization

Module method:

```typescript
function buildManualAgentId(idSlug: string): string {
  return `user:${sanitizeAgentSegment(idSlug)}`;
}
```

Reject if sanitized slug is empty.

### 11.4 Built-in seed changes

`AgentDefinitionRegistry.listBuiltIns()` should include:

```typescript
source: "built-in",
health: "healthy",
manifest: {},
```

If keeping `AgentDefinitionRegistry` as a pure built-in registry, do not add dynamic plugin registration to it. Dynamic definitions live in the database through `AgentDefinitionModule`.

## 12. Plugin Import Integration

### 12.1 Validation phase

In `PluginImportService.importFromDirectory()` after skill and MCP validation:

```typescript
const agentParse = PluginAgentImportService.parsePluginAgents({
  pluginRoot: localRoot,
  manifest,
});

if (!agentParse.ok) {
  return { success: false, errors: toErrors(agentParse.errors) };
}

const agents = agentParse.agents;
const agentWarnings = agentParse.warnings;
```

Warnings should not fail import. Errors fail import before files are copied.

### 12.2 Copy and persistence phase

After plugin row, skills, and MCP rows are persisted:

```typescript
const agentModule = new AgentDefinitionModule();
try {
  await agentModule.upsertPluginAgents(manifest.name, agents);
} catch (e: unknown) {
  await rollbackRowsAndFiles(manifest.name, installPath);
  return {
    success: false,
    errors: [{
      code: "agent-manifest-invalid",
      componentType: "agent",
      pluginName: manifest.name,
      message: e instanceof Error ? e.message : "Failed to persist plugin agents",
      recoverable: false,
    }],
  };
}
```

### 12.3 Rollback

Extend rollback helpers to delete plugin-owned agents:

```typescript
async function rollbackRowsAndFiles(pluginName: string, installPath: string): Promise<void> {
  const pluginModule = new PluginManagementModule();
  await pluginModule.uninstallPlugin(pluginName); // now deletes skills, MCP, agents
  rollbackInstall(installPath);
}
```

### 12.4 Summary

Return:

```typescript
agentCount: agents.length
```

in `PluginSummary`.

### 12.5 Load errors and warnings

If `agentWarnings.length > 0`, persist them through `PluginManagementModule.setLoadErrors()` but keep plugin health `partial_load` only if the warning is user-actionable. `agent-unsupported-field` warnings can be displayed under diagnostics while plugin health remains `healthy`.

Recommended rule:

- warnings only: `healthy`
- recoverable missing file after install: `partial_load`
- invalid declared agent during import: import fails

## 13. Plugin Management Integration

### 13.1 `PluginManagementModule`

Add `AgentDefinitionModel`:

```typescript
private agentModel: AgentDefinitionModel;
```

In constructor:

```typescript
this.agentModel = new AgentDefinitionModel(this.dbpath);
```

Update `uninstallPlugin()` result:

```typescript
export interface PluginUninstallResult {
  readonly removedPlugin: boolean;
  readonly removedSkillNames: readonly string[];
  readonly removedMcpServerNames: readonly string[];
  readonly removedAgentIds: readonly string[];
  readonly errors: readonly PluginError[];
}
```

Delete plugin-owned agents before deleting the plugin row:

```typescript
const removedAgentIds = await this.agentModel.deleteByPluginName(name);
```

### 13.2 Plugin list/get IPC

`plugin:list` must count owned agents:

```typescript
const agentModule = new AgentDefinitionModule();
const agents = await agentModule.findAgentsByPluginName(p.name);
summaries.push(toSummary(p, skills.length, mcpServers.length, agents.length));
```

`plugin:get` must include:

```typescript
agents: agents.map((a) => ({
  id: a.id,
  name: a.name,
  description: a.description,
  enabled: a.status === "active",
  mode: a.mode,
  toolCount: a.allowedTools.length,
  componentPath: a.pluginComponentPath ?? "",
  health: a.health,
  error: a.lastError,
}))
```

### 13.3 Plugin toggle

`PLUGIN_TOGGLE` does not mutate agent rows. It only toggles the plugin row and invalidates caches. Runtime filtering excludes enabled plugin agents while the plugin is disabled.

### 13.4 Plugin uninstall

After `PluginManagementModule.uninstallPlugin()`:

- delete files as currently implemented
- call `PluginComponentRegistryService.unregisterPluginCapabilities(pluginName)`
- ensure that method also clears agent caches

## 14. Runtime Active Catalog

### 14.1 Runtime listing

`agent-runtime:definition-list` should call:

```typescript
new AgentDefinitionModule().listActiveForRuntime()
```

not the old `listActive()`.

### 14.2 Runtime lookup

`AgentRuntime` currently calls `AgentDefinitionModule.getActiveById()`. Preserve the public method name but update implementation to apply plugin enablement and health filtering.

Lookup must return `null` when:

- no row exists
- row status is disabled
- row health is not healthy
- row source is plugin and owning plugin is disabled or missing

### 14.3 Tool policy remains unchanged

`AgentToolPolicyService` already intersects `allowedTools` with available tool names and enforces v1 deny patterns. No new agent-specific tool policy is needed beyond ensuring plugin-imported `allowedTools` are normalized.

## 15. IPC Design

### 15.1 Channel constants

Add to `src/config/channellist.ts`:

```typescript
export const AGENT_MANAGEMENT_LIST = "agent-definition:list";
export const AGENT_MANAGEMENT_GET = "agent-definition:get";
export const AGENT_MANAGEMENT_CREATE = "agent-definition:create";
export const AGENT_MANAGEMENT_UPDATE = "agent-definition:update";
export const AGENT_MANAGEMENT_TOGGLE = "agent-definition:toggle";
export const AGENT_MANAGEMENT_DELETE = "agent-definition:delete";
```

Keep existing runtime channels:

```typescript
export const AGENT_DEFINITION_LIST = "agent-runtime:definition-list";
```

### 15.2 IPC schemas

Add:

```text
src/schemas/ipc/agentDefinition.ts
```

Schemas:

```typescript
export const agentDefinitionNoInputSchema = noInputSchema;

export const agentDefinitionByIdInputSchema = lazySchema(() =>
  z.strictObject({
    agentId: z.string().min(1).max(256),
  })
);

export const agentDefinitionCreateInputSchema = lazySchema(() =>
  z.strictObject({
    idSlug: z.string().min(1).max(100),
    name: z.string().min(1).max(120),
    description: z.string().min(1).max(2000),
    systemPrompt: z.string().min(1).max(100000),
    allowedTools: z.array(z.string().min(1).max(256)).max(200),
    defaultModel: z.string().max(120).optional(),
    mode: z.enum(["coordinator", "specialist", "verifier", "formatter"]),
    maxToolCalls: z.number().int().positive().max(100),
    maxRuntimeMs: z.number().int().positive().max(3600000),
    maxContinueCalls: z.number().int().positive().max(100),
    outputSchema: z.record(z.string(), z.unknown()).optional(),
    enabled: z.boolean().optional(),
  })
);

export const agentDefinitionUpdateInputSchema = lazySchema(() =>
  agentDefinitionCreateInputSchema()
    .partial()
    .extend({
      agentId: z.string().min(1).max(256),
    })
);

export const agentDefinitionToggleInputSchema = lazySchema(() =>
  z.strictObject({
    agentId: z.string().min(1).max(256),
    enabled: z.boolean(),
  })
);
```

### 15.3 IPC handlers

Add:

```text
src/main-process/communication/agent-definition-ipc.ts
```

Use `registerValidatedHandler` for management-only handlers:

```typescript
export function registerAgentDefinitionIpcHandlers(): void {
  registerValidatedHandler(AGENT_MANAGEMENT_LIST, ..., async () => {
    return new AgentDefinitionModule().listAllForManagement();
  });

  registerValidatedHandler(AGENT_MANAGEMENT_GET, ..., async (input) => {
    return new AgentDefinitionModule().getForManagement(input.agentId);
  });

  registerValidatedHandler(AGENT_MANAGEMENT_CREATE, ..., async (input) => {
    return new AgentDefinitionModule().createManualAgent(input);
  });

  registerValidatedHandler(AGENT_MANAGEMENT_UPDATE, ..., async (input) => {
    const { agentId, ...patch } = input;
    return new AgentDefinitionModule().updateManualAgent(agentId, patch);
  });

  registerValidatedHandler(AGENT_MANAGEMENT_TOGGLE, ..., async (input) => {
    return new AgentDefinitionModule().toggleAgent(input.agentId, input.enabled);
  });

  registerValidatedHandler(AGENT_MANAGEMENT_DELETE, ..., async (input) => {
    return new AgentDefinitionModule().deleteManualAgent(input.agentId);
  });
}
```

These handlers do not execute AI work. They do not need `registerAiValidatedHandler`.

`agent-runtime-ipc.ts` keeps `registerAiValidatedHandler` because runtime definition listing is AI-facing.

### 15.4 Preload

Add new channel constants to `src/preload.ts` allowlist wherever existing agent runtime and plugin channels are exposed.

## 16. Frontend Design

### 16.1 Renderer API

Add:

```text
src/views/api/agents.ts
```

Exports:

```typescript
export async function listAgentDefinitions(): Promise<AgentDefinitionView[] | null>;
export async function getAgentDefinition(agentId: string): Promise<AgentDefinitionView | null>;
export async function createAgentDefinition(input: CreateManualAgentDefinitionInput): Promise<AgentDefinitionView | null>;
export async function updateAgentDefinition(agentId: string, input: UpdateManualAgentDefinitionInput): Promise<AgentDefinitionView | null>;
export async function toggleAgentDefinition(agentId: string, enabled: boolean): Promise<void>;
export async function deleteAgentDefinition(agentId: string): Promise<void>;
```

### 16.2 Page and components

Add:

```text
src/views/pages/systemsetting/subagents.vue
src/views/components/agents/AgentManager.vue
src/views/components/agents/AgentDetailPanel.vue
src/views/components/agents/AgentEditorDialog.vue
src/views/components/plugins/PluginAgentsTab.vue
```

Use "Subagents" as product copy and `Agent*` as code component names.

### 16.3 Subagents page behavior

`AgentManager.vue` owns:

- load state
- search string
- source/status filters
- selected agent
- create/edit/delete/toggle actions

Computed filters:

```typescript
const filteredAgents = computed(() => {
  // search id/name/description/pluginName
  // source filter
  // enabled filter
  // warning filter health != healthy || lastError
});
```

### 16.4 Editor dialog rules

Dialog modes:

- create
- edit manual
- view readonly

Readonly when:

- `source === "built-in"`
- `source === "plugin"`

Editable when:

- `source === "user"`

### 16.5 Plugin UI integration

Update:

```text
src/views/api/plugins.ts
src/views/components/plugins/PluginManager.vue
src/views/components/plugins/PluginDetailPanel.vue
src/views/components/plugins/PluginOverviewTab.vue
```

`PluginManager.vue` should add agent count only if the table remains readable. If the table gets too dense, show component counts as one cell:

```text
Skills 3 / MCP 1 / Agents 2
```

`PluginDetailPanel.vue` adds a Subagents tab using `PluginAgentsTab.vue`.

### 16.6 i18n key structure

Add `agents` or `subagents` namespace. Recommended:

```typescript
subagents: {
  title: "Subagents",
  add_button: "Add Subagent",
  edit_title: "Edit Subagent",
  create_title: "Add Subagent",
  empty_state: "No subagents are installed.",
  no_filter_results: "No subagents match these filters.",
  column_agent: "Agent",
  column_description: "Description",
  column_source: "Source",
  column_plugin: "Plugin",
  column_mode: "Mode",
  column_tools: "Tools",
  column_model: "Model",
  column_status: "Status",
  source_builtin: "Built-in",
  source_plugin: "Plugin",
  source_user: "Manual",
  status_active: "Enabled",
  status_disabled: "Disabled",
  plugin_empty: "This plugin does not include subagents.",
  delete_confirm: "Delete this subagent?",
  readonly_plugin_hint: "Plugin subagents are read-only. Disable them or edit the plugin source.",
  readonly_builtin_hint: "Built-in subagents are read-only.",
}
```

Update all six language files:

```text
src/views/lang/en.ts
src/views/lang/zh.ts
src/views/lang/es.ts
src/views/lang/fr.ts
src/views/lang/de.ts
src/views/lang/ja.ts
```

## 17. Cache Invalidation

### 17.1 Add agent cache invalidation hook

There is no dedicated `AgentDefinitionRuntimeCache` today. If active definition lookups are not cached, no new cache is needed.

If a cache is added later, invalidation points are:

- plugin import
- plugin reload
- plugin toggle
- plugin uninstall
- agent toggle
- manual agent create/update/delete
- built-in seeding

### 17.2 Current plugin cache

Keep using:

```typescript
PluginRuntimeCache.clear(...)
PluginLoaderService.clearCache()
PluginComponentRegistryService.applyLoadedPlugins()
```

Extend `PluginComponentRegistryService.applyLoadedPlugins()` comments to note that agent definitions are DB-backed and require no in-memory registration unless a future cache is introduced.

## 18. Security and Trust Boundaries

### 18.1 Import never executes plugin code

Agent import may:

- read manifest JSON
- read Markdown files
- parse frontmatter
- copy files
- persist database rows

Agent import must not:

- execute scripts
- spawn MCP servers
- call skill entries
- run shell commands
- call AI APIs

### 18.2 Path safety

Every declared path must use:

```typescript
resolvePluginRelativePath(pluginRoot, relPath)
```

Directory walking must start only from the resolved safe path.

### 18.3 Plugin agent privilege fields

Forbidden fields are warnings only. They never influence runtime.

### 18.4 Runtime permissions

An agent allowlist is not permission approval. Tool execution still flows through:

```text
AgentToolPolicyService
  -> SkillExecutor
  -> SkillPermissionService
```

### 18.5 Disabled plugin filtering

An enabled plugin-owned agent under a disabled plugin must be treated as unavailable, not as a policy error.

### 18.6 Prompt injection

Plugin agent `systemPrompt` is trusted as installed plugin content. External web content consumed by tools remains untrusted evidence and must not override the agent instructions.

## 19. Error Handling

### 19.1 Import errors

Fail import when:

- manifest has path traversal
- declared agent file is missing
- declared agent directory is missing
- frontmatter is missing `name`
- frontmatter is missing `description`
- body is empty
- ID collision occurs within the plugin
- plugin agent ID collides with an existing non-owned agent

### 19.2 Warnings

Warn but continue when:

- forbidden field is present
- optional field has wrong type and can be ignored
- unknown field is present

### 19.3 Runtime health

Runtime excludes agents where:

```typescript
health !== "healthy"
```

Management UI still shows them.

### 19.4 Missing files after install

`PluginLoaderService` should include loaded agent health in a future enhancement, but runtime is DB-backed. For v1, missing files after install do not invalidate existing persisted agent rows unless plugin reload explicitly revalidates agents. A follow-up hardening task may add loader-time agent file health checks.

## 20. Testing Plan

### 20.1 Unit tests

Add under `test/vitest/utilitycode/`:

```text
pluginAgentImportService.test.ts
claudeAgentFormatAdapter.test.ts
```

Cases:

- parses required fields
- maps `tools`
- maps `skills`
- maps `maxTurns`
- rejects missing name
- rejects missing description
- rejects empty body
- warns on forbidden fields
- creates nested namespace IDs
- detects duplicate IDs
- rejects path traversal
- auto-detects Claude `agents/`
- supports native array declarations

### 20.2 Module tests

Extend:

```text
test/modules/AgentDefinitionModule.test.ts
```

Cases:

- seeds built-ins with `source = built-in`
- creates manual `user:<slug>` agent
- rejects duplicate manual ID
- updates manual agent
- refuses plugin-owned edit
- refuses built-in delete
- toggles plugin-owned agent
- lists plugin-owned agents
- deletes plugin-owned agents by plugin name
- active runtime list excludes disabled plugin-owned agents

### 20.3 IPC tests

Add:

```text
test/vitest/main/agent-definition-ipc.test.ts
```

Cases:

- list delegates to module
- get validates ID
- create validates required fields
- update rejects invalid mode
- toggle returns error when missing
- delete calls manual delete
- management handlers are not AI-gated

Extend:

```text
test/vitest/main/agent-runtime-ipc.test.ts
```

Case:

- runtime definition list remains AI-gated and uses active runtime method.

### 20.4 Plugin integration tests

Add under an existing plugin test area or `test/vitest/main/service/`:

```text
pluginImportAgents.test.ts
```

Cases:

- imports native plugin with agents
- imports Claude plugin with `agents: true`
- imports Claude plugin with explicit agent path
- imports agent-only plugin
- uninstall removes owned agents
- overwrite preserves disabled state through component state
- import rollback removes agent rows after simulated MCP persistence failure

### 20.5 Frontend tests

If current frontend tests are limited, add focused component tests where practical:

- `AgentManager.vue` renders rows.
- filters source/status.
- create dialog validates required fields.
- readonly state for plugin agent.
- `PluginAgentsTab.vue` renders empty state and rows.

### 20.6 Verification commands

Run:

```bash
yarn vue-check
yarn tsc
yarn test
```

For focused work:

```bash
yarn vitest run test/vitest/utilitycode/claudeAgentFormatAdapter.test.ts
yarn vitest run test/vitest/utilitycode/pluginAgentImportService.test.ts
yarn vitest run test/vitest/main/agent-definition-ipc.test.ts
```

## 21. Rollout Steps

### Step 1: Types and entity columns

Files:

- `src/entityTypes/agentTypes.ts`
- `src/entityTypes/pluginTypes.ts`
- `src/entity/AgentDefinition.entity.ts`
- `src/model/AgentDefinition.model.ts`

Verification:

- TypeScript compile.
- AgentDefinition module tests still pass after updating expected shape.

### Step 2: Agent parser

Files:

- `src/service/pluginCompat/ClaudeAgentFormatAdapter.ts`
- `src/service/PluginAgentImportService.ts`

Verification:

- parser unit tests.

### Step 3: Plugin manifest and import integration

Files:

- `src/service/pluginCompat/ClaudePluginAdapter.ts`
- `src/service/PluginManifestService.ts`
- `src/service/PluginImportService.ts`
- `src/modules/PluginManagementModule.ts`
- `src/service/PluginLoaderService.ts` if loaded plugin detail needs agent metadata

Verification:

- plugin import integration tests.

### Step 4: Agent management backend

Files:

- `src/modules/AgentDefinitionModule.ts`
- `src/main-process/communication/agent-definition-ipc.ts`
- `src/schemas/ipc/agentDefinition.ts`
- `src/main-process/communication/index.ts`
- `src/preload.ts`
- `src/config/channellist.ts`

Verification:

- IPC tests.

### Step 5: Runtime filtering

Files:

- `src/modules/AgentDefinitionModule.ts`
- `src/model/AgentDefinition.model.ts`
- `src/main-process/communication/agent-runtime-ipc.ts`
- `src/service/AgentRuntime.ts` if it needs method-name updates

Verification:

- runtime tests.

### Step 6: UI

Files:

- `src/views/api/agents.ts`
- `src/views/pages/systemsetting/subagents.vue`
- `src/views/components/agents/AgentManager.vue`
- `src/views/components/agents/AgentDetailPanel.vue`
- `src/views/components/agents/AgentEditorDialog.vue`
- `src/views/components/plugins/PluginAgentsTab.vue`
- existing plugin components
- language files

Verification:

- `yarn vue-check`
- manual UI pass in English and one non-English language

### Step 7: Documentation and release notes

Update:

- plugin author docs with agent file format
- release notes warning that Claude plugin `agents` fields now become active capabilities

## 22. Implementation Notes

### 22.1 Keep adapters pure

`ClaudeAgentFormatAdapter` should accept Markdown text and options. It should not read files. This mirrors `ClaudeSkillFormatAdapter` and keeps unit tests simple.

### 22.2 Do not mutate plugin source files

Unlike documentation-only skill wrappers, plugin agents do not require generated files. The persisted database row is enough.

### 22.3 Avoid direct registry mutation

Do not add plugin agents to `AgentDefinitionRegistry`. That registry remains the source for built-ins. Dynamic definitions live in SQLite.

### 22.4 Preserve existing IPC envelopes

Use `registerValidatedHandler` and return `CommonMessage<T>` envelopes through existing helper behavior. Renderer APIs should call `windowInvoke()`.

### 22.5 Avoid `any`

Use `unknown`, narrowed records, and explicit DTOs for frontmatter parsing.

## 23. Open Follow-Ups

These are intentionally outside v1 implementation:

- "Duplicate as manual agent" action for plugin-owned agents.
- Strict JSON schema editor with templates.
- Loader-time missing file health checks for plugin agents.
- Agent prompt preview showing final assembled system prompt.
- Plugin marketplace metadata for agent capabilities.
- Policy UI showing risk summary per allowed tool.
