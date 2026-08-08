# AiFetchly Local Extensibility - Technical Design

## 1. Purpose

This document translates `docs/prd/aifetchly-local-extensibility-prd.md` into an implementation-facing technical design.

The feature adds support for:

- global user configuration in `~/.aifetchly`
- approved workspace configuration in `<workspace>/.aifetchly`
- assistant instruction injection through AiChatV2 context assembly
- slash commands in the AiChatV2 composer
- live reload when config files are added, changed, renamed, or deleted
- workspace file watching and config scanning in a child process
- future dynamic agents, hooks, skills, and plugin command integration

The design keeps AiFetchly's existing architecture intact:

```text
Renderer
  -> preload-safe IPC
  -> main-process IPC handlers
  -> Modules and Services
  -> Models for persistence
  -> childprocess workers for isolated scanning/execution work
```

The main process remains the authority for trust, registry mutation, database access, permissions, and renderer events. The workspace watcher child process only watches files, parses bounded input, and returns typed snapshots.

## 2. Current System Summary

### 2.1 Chat V2 context assembly

`src/service/AIChatContextAssembler.ts` currently builds the OpenAI message array for Chat V2. It already injects:

- base system prompt
- Plan Mode system prompt
- custom context directive from settings
- active workspace path through `WorkspaceResolver`
- durable user memory
- compacted conversation summaries
- recent conversation messages
- current user message

This is the correct place to inject `~/.aifetchly/AGENTS.md` and trusted workspace instructions.

### 2.2 Workspace approval

Workspace state already exists:

```text
src/modules/WorkspaceModule.ts
src/model/Workspace.model.ts
src/service/WorkspaceResolver.ts
src/entityTypes/workspaceTypes.ts
src/views/components/aiChatV2/WorkspaceBadge.vue
src/views/components/aiChatV2/WorkspaceRequiredCard.vue
```

`WorkspaceResolver.resolve(conversationId)` returns a workspace only when its `approvalState` is `approved`. The local extensibility feature must reuse that boundary. It should not introduce a second active-workspace table.

### 2.3 Skill and tool execution

Existing surfaces:

```text
src/config/skillsRegistry.ts
src/service/SkillExecutor.ts
src/service/SkillPermissionService.ts
src/service/ToolExecutor.ts
src/service/ToolExecutionService.ts
src/service/AIChatQueryLoop.ts
src/service/AIChatQueryEngine.ts
```

The first release does not execute `~/.aifetchly/skills` directly. Later phases must register local skills through the existing `SkillRegistry` and execute them through `SkillExecutor`, preserving permission checks.

### 2.4 Agent runtime

Existing surfaces:

```text
src/service/AgentDefinitionRegistry.ts
src/service/AgentRuntimeRegistry.ts
src/service/agentTools/runSubagentTool.ts
src/entityTypes/agentTypes.ts
```

`AgentDefinitionRegistry` currently returns built-ins only. Dynamic local agents require adding source-aware registration and lookup.

### 2.5 Hooks

Existing surfaces:

```text
src/service/hooks/HookRegistry.ts
src/service/hooks/HookDispatcher.ts
src/service/hooks/HookMatcher.ts
src/service/hooks/HookAuditService.ts
src/service/hooks/executors/CommandHookExecutor.ts
src/service/pluginCompat/ClaudeHooksAdapter.ts
```

Workspace hooks must be gated by workspace trust and must not execute directly in the Electron main process.

### 2.6 Plugin compatibility

Plugin compatibility already supports `.aifetchly-plugin/plugin.json` and `.claude-plugin/plugin.json`. `commands/` and `agents/` from Claude plugins are currently opaque because AiFetchly has no command surface and no dynamic agent registry.

This technical design creates those prerequisite surfaces. Plugin command and plugin agent activation remains a later phase.

## 3. Target Architecture

### 3.1 Component overview

```text
Renderer AiChatV2
  -> slash parser UI state
  -> views/api/slashCommands.ts
  -> preload bridge
  -> slash-command-ipc.ts
  -> SlashCommandModule
  -> CommandRegistry / SlashCommandDispatcher

Main process startup
  -> AIFetchlyConfigManager
  -> AIFetchlyConfigLoader scans ~/.aifetchly
  -> AIFetchlyRuntimeRegistrySync applies user snapshot
  -> AIFetchlyContextCache stores instruction blocks

Workspace lifecycle
  -> WorkspaceWatchManager.acquire()
  -> WorkspaceConfigWatchWorker child process
  -> worker snapshot event
  -> main-process trust check
  -> AIFetchlyRuntimeRegistrySync applies workspace snapshot
  -> renderer config-changed event

Chat request
  -> AIChatQueryEngine.submitMessage()
  -> AIChatContextAssembler.assemble()
  -> AIFetchlyContextLoader.getInstructionBlocks()
  -> messages[] include global and trusted workspace instructions
```

### 3.2 Main process ownership

Main process owns:

- config manager lifecycle
- global config scan scheduling
- workspace watcher worker process lifecycle
- workspace approval and trust checks
- command, agent, hook, and skill registry mutation
- context cache mutation
- slash command dispatch
- database access through Modules and Models
- renderer notifications

### 3.3 Child process ownership

Workspace watcher worker owns:

- watching `<workspace>/.aifetchly/**`
- optionally watching `<workspace>/AGENTS.md`
- debouncing file events
- bounded async file reads
- parsing markdown frontmatter and JSON files
- content hashing
- snapshot and diagnostic generation

The worker must not:

- import TypeORM
- import Modules or Models
- read or write SQLite
- mutate app registries
- call AI APIs
- call renderer IPC
- decide whether a workspace is trusted
- execute hooks, skills, shell, or user-defined functions

## 4. New Files

### 4.1 Entity types

```text
src/entityTypes/aifetchlyConfigTypes.ts
src/entityTypes/slashCommandTypes.ts
```

`aifetchlyConfigTypes.ts` contains pure types shared by main process and worker. It must not import Electron, TypeORM, Vue, Modules, or main-process services.

`slashCommandTypes.ts` contains renderer-safe command view types and dispatch request/response types.

### 4.2 Services

```text
src/service/aifetchlyConfig/AIFetchlyConfigConstants.ts
src/service/aifetchlyConfig/AIFetchlyConfigLoader.ts
src/service/aifetchlyConfig/AIFetchlyConfigMarkdown.ts
src/service/aifetchlyConfig/AIFetchlyConfigSnapshotDiff.ts
src/service/aifetchlyConfig/AIFetchlyContextLoader.ts
src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts
src/service/aifetchlyConfig/AIFetchlyConfigManager.ts
src/service/aifetchlyConfig/WorkspaceWatchManager.ts
src/service/aifetchlyConfig/WorkspaceTrustService.ts
src/service/slashCommands/CommandRegistry.ts
src/service/slashCommands/SlashCommandParser.ts
src/service/slashCommands/SlashCommandDispatcher.ts
src/service/slashCommands/builtinSlashCommands.ts
```

Use a subdirectory to keep the feature from adding many top-level service files.

### 4.3 Module and IPC

```text
src/modules/SlashCommandModule.ts
src/main-process/communication/slash-command-ipc.ts
src/views/api/slashCommands.ts
```

### 4.4 Child process

```text
src/childprocess/aifetchly-config/WorkspaceConfigWatchWorker.ts
src/childprocess/aifetchly-config/WorkspaceConfigScanner.ts
src/childprocess/aifetchly-config/WorkspaceConfigWatcher.ts
```

All worker entry points and worker-only code must live under `src/childprocess/`.

### 4.5 Renderer

```text
src/views/components/aiChatV2/AiChatV2SlashSuggestions.vue
src/views/components/aiChatV2/AiChatV2ConfigStatus.vue
```

Modify:

```text
src/views/components/aiChatV2/AiChatV2.vue
src/views/components/aiChatV2/AiChatV2Composer.vue
src/views/lang/en.ts
src/views/lang/zh.ts
src/views/lang/es.ts
src/views/lang/fr.ts
src/views/lang/de.ts
src/views/lang/ja.ts
src/config/channellist.ts
src/preload.ts
src/main-process/communication/index.ts
forge.config.js
```

## 5. Data Contracts

### 5.1 Source identity

```typescript
export type AIFetchlyConfigSourceKind = "user" | "workspace" | "plugin";

export interface AIFetchlyConfigSourceRef {
  readonly kind: AIFetchlyConfigSourceKind;
  readonly sourceId: string;
  readonly rootPath: string;
  readonly workspaceId?: string;
  readonly workspaceRoot?: string;
  readonly pluginName?: string;
}
```

Source ID format:

```text
user
workspace:<workspaceId>
plugin:<pluginName>
```

Do not use raw filesystem paths as registry source IDs. Paths change and can leak private data into UI-facing state.

### 5.2 File snapshot

```typescript
export type AIFetchlyConfigFileKind =
  | "instructions"
  | "settings"
  | "command"
  | "agent"
  | "skill"
  | "hook"
  | "plugin-options"
  | "unknown";

export interface AIFetchlyConfigFileSnapshot {
  readonly relativePath: string;
  readonly kind: AIFetchlyConfigFileKind;
  readonly mtimeMs: number;
  readonly sizeBytes: number;
  readonly contentHash: string;
}
```

`contentHash` should be SHA-256 of UTF-8 file content for text files. For rejected oversized files, use an empty hash and emit a diagnostic.

### 5.3 Diagnostics

```typescript
export type AIFetchlyConfigSeverity = "info" | "warning" | "error";

export interface AIFetchlyConfigDiagnostic {
  readonly severity: AIFetchlyConfigSeverity;
  readonly source: AIFetchlyConfigSourceKind;
  readonly sourceId: string;
  readonly filePath: string;
  readonly code: string;
  readonly message: string;
  readonly recoverable: boolean;
}
```

Diagnostic codes should be stable strings:

```text
file-too-large
frontmatter-missing
frontmatter-invalid
command-name-invalid
command-description-missing
agent-name-invalid
agent-tool-invalid
settings-json-invalid
path-outside-root
unsupported-file
workspace-untrusted
scanner-io-error
```

### 5.4 Instruction block

```typescript
export interface AIFetchlyInstructionBlock {
  readonly id: string;
  readonly source: "user" | "workspace";
  readonly sourceId: string;
  readonly label: string;
  readonly relativePath: string;
  readonly content: string;
  readonly contentHash: string;
  readonly trusted: boolean;
}
```

`id` examples:

```text
user:instructions:AGENTS.md
workspace:42:instructions:.aifetchly/AGENTS.md
workspace:42:instructions:AGENTS.md
```

### 5.5 Slash command definitions

```typescript
export type SlashCommandSource = "built-in" | "user" | "workspace" | "plugin";
export type SlashCommandType = "prompt" | "local" | "skill";

export interface SlashCommandDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly aliases: readonly string[];
  readonly type: SlashCommandType;
  readonly source: SlashCommandSource;
  readonly sourceId: string;
  readonly sourceLabel: string;
  readonly argumentHint?: string;
  readonly requiresTrust: boolean;
  readonly enabled: boolean;
  readonly body?: string;
  readonly metadata?: Record<string, unknown>;
}
```

For renderer list responses, do not include full prompt body unless the UI explicitly needs preview.

```typescript
export interface SlashCommandView {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly aliases: readonly string[];
  readonly source: SlashCommandSource;
  readonly sourceLabel: string;
  readonly argumentHint?: string;
  readonly enabled: boolean;
  readonly disabledReason?: string;
}
```

### 5.6 Snapshot

```typescript
export interface AIFetchlyConfigSnapshot {
  readonly source: "user" | "workspace";
  readonly sourceId: string;
  readonly rootPath: string;
  readonly version: number;
  readonly files: readonly AIFetchlyConfigFileSnapshot[];
  readonly instructions: readonly AIFetchlyInstructionBlock[];
  readonly commands: readonly SlashCommandDefinition[];
  readonly agents: readonly AgentDefinitionView[];
  readonly hooks: readonly HookDefinitionView[];
  readonly skills: readonly LocalSkillDefinition[];
  readonly diagnostics: readonly AIFetchlyConfigDiagnostic[];
}
```

`HookDefinitionView` and `LocalSkillDefinition` should be pure type aliases or interfaces in `aifetchlyConfigTypes.ts` until the hook and skill phases wire into concrete runtime types.

### 5.7 Snapshot diff

```typescript
export interface AIFetchlyConfigDiff {
  readonly added: readonly string[];
  readonly changed: readonly string[];
  readonly removed: readonly string[];
  readonly commandsChanged: boolean;
  readonly agentsChanged: boolean;
  readonly skillsChanged: boolean;
  readonly hooksChanged: boolean;
  readonly instructionsChanged: boolean;
  readonly diagnosticsChanged: boolean;
}
```

The diff is for UI and logging. Runtime correctness must come from source replacement using the full snapshot.

## 6. Config Loading

### 6.1 Global root resolution

`AIFetchlyConfigLoader` should resolve the global root as:

```typescript
path.join(os.homedir(), ".aifetchly")
```

This root is intentionally not Electron `userData`. It is a user-editable configuration folder.

### 6.2 Workspace root resolution

Workspace root comes from `WorkspaceResolver.resolve(conversationId)` or a trusted `WorkspaceRecord` loaded by `WorkspaceModule`.

Never accept a renderer-provided workspace root for scanning without confirming it against the stored approved workspace.

### 6.3 Path safety

Add a helper:

```typescript
export function resolveConfigRelativePath(
  rootPath: string,
  relativePath: string
): { ok: true; absolutePath: string } | { ok: false; reason: string };
```

Rules:

- reject absolute relative paths
- reject paths containing `..`
- normalize path separators
- resolve realpath for existing files
- reject symlinks that escape the root
- return structured errors, not thrown validation failures

### 6.4 File discovery

Phase 1 global loader should discover:

```text
AGENTS.md
settings.json
commands/*.md
```

Phase 2 workspace loader should discover:

```text
.aifetchly/AGENTS.md
.aifetchly/settings.json
.aifetchly/commands/*.md
AGENTS.md
```

Later phases add:

```text
agents/*.md
hooks/hooks.json
skills/*/manifest.json
```

### 6.5 Size limits

Put limits in constants:

```typescript
export const AIFETCHLY_CONFIG_LIMITS = {
  agentsMdBytes: 256 * 1024,
  commandMdBytes: 64 * 1024,
  agentMdBytes: 128 * 1024,
  hooksJsonBytes: 128 * 1024,
  settingsJsonBytes: 32 * 1024,
  maxCommandsPerSource: 200,
  maxAgentsPerSource: 100,
} as const;
```

Files above their limit are ignored and produce diagnostics.

### 6.6 Markdown frontmatter parser

Use a restricted frontmatter parser in `AIFetchlyConfigMarkdown.ts`.

Supported format:

```markdown
---
name: review
description: Review current changes
aliases:
  - rv
argumentHint: [scope]
type: prompt
---

Body text...
```

Requirements:

- parse only an initial `---` block
- support simple scalars and string arrays
- do not execute YAML tags
- fail closed on ambiguous syntax
- preserve body exactly after frontmatter

If the project later needs richer YAML, add a constrained dependency and keep schema validation explicit.

### 6.7 Command parsing rules

Command frontmatter schema:

```typescript
export interface ParsedCommandFrontmatter {
  readonly name: string;
  readonly description: string;
  readonly aliases?: readonly string[];
  readonly argumentHint?: string;
  readonly type?: "prompt";
}
```

Validation:

- `name` required, regex `^[a-z][a-z0-9_-]*$`
- `description` required, non-empty, max 500 characters
- `aliases` optional, same regex as name, max 10 aliases
- `argumentHint` optional, max 100 characters
- `type` optional, only `prompt` in Phase 1
- body required, non-empty after trim

### 6.8 Settings parsing

Settings schema:

```typescript
export interface AIFetchlyConfigSettings {
  readonly commandsEnabled: boolean;
  readonly agentsEnabled: boolean;
  readonly hooksEnabled: boolean;
  readonly workspaceConfigEnabled: boolean;
  readonly watchEnabled: boolean;
}
```

Defaults:

```typescript
export const DEFAULT_AIFETCHLY_CONFIG_SETTINGS = {
  commandsEnabled: true,
  agentsEnabled: true,
  hooksEnabled: false,
  workspaceConfigEnabled: true,
  watchEnabled: true,
} as const;
```

Unknown fields are ignored. Invalid known fields fall back to defaults and produce warnings.

## 7. Registry Design

### 7.1 CommandRegistry

```typescript
export class CommandRegistry {
  register(command: SlashCommandDefinition): void;
  unregister(id: string): void;
  replaceSource(sourceId: string, commands: readonly SlashCommandDefinition[]): void;
  getByName(name: string): SlashCommandDefinition | null;
  getById(id: string): SlashCommandDefinition | null;
  list(): SlashCommandDefinition[];
  listViews(): SlashCommandView[];
}
```

Lookup order for duplicate names:

1. built-in
2. workspace
3. user
4. plugin

Rationale: built-ins must remain stable and cannot be shadowed by a workspace repo. Workspace commands should beat user commands for project-specific workflows. The UI should show duplicates with source badges if the query matches more than one command, but command execution by exact `/name` should use the first enabled command in lookup order.

### 7.2 Built-in command registration

`builtinSlashCommands.ts` registers built-ins during main process startup:

```typescript
export function registerBuiltInSlashCommands(registry: CommandRegistry): void;
```

Initial commands:

- `help`
- `clear`
- `status`
- `reload-config`

Add later:

- `plugins`
- `skills`
- `agents`

### 7.3 Source replacement

Do not patch individual commands after file events. Replace all commands for a source:

```typescript
registry.replaceSource("user", userSnapshot.commands);
registry.replaceSource("workspace:42", workspaceSnapshot.commands);
```

Implementation:

- delete all existing entries with `sourceId`
- insert new entries
- rebuild name index

This handles deletes, renames, and missed file events.

### 7.4 Dynamic AgentDefinitionRegistry

Current `AgentDefinitionRegistry` is an object over a built-in array. Phase 4 should refactor it to:

```typescript
class AgentDefinitionRegistryImpl {
  listBuiltIns(): AgentDefinitionView[];
  list(): AgentDefinitionView[];
  getById(id: string): AgentDefinitionView | null;
  replaceSource(sourceId: string, agents: readonly AgentDefinitionView[]): void;
}

export const AgentDefinitionRegistry = new AgentDefinitionRegistryImpl();
```

Lookup order:

1. built-ins
2. user
3. trusted workspace
4. plugin

Built-ins cannot be shadowed.

### 7.5 HookRegistry source replacement

Hook support should add:

```typescript
HookRegistry.replaceSource(sourceId: string, hooks: readonly HookDefinitionView[]): void;
HookRegistry.unregisterSource(sourceId: string): void;
```

If the existing `HookRegistry` uses different runtime types, add an adapter in `AIFetchlyRuntimeRegistrySync`.

## 8. Runtime Registry Sync

### 8.1 Responsibilities

`AIFetchlyRuntimeRegistrySync` takes trusted snapshots and applies them:

```typescript
export class AIFetchlyRuntimeRegistrySync {
  applySnapshot(snapshot: AIFetchlyConfigSnapshot, trust: AIFetchlySourceTrust): AIFetchlyConfigApplyResult;
  removeSource(sourceId: string): void;
}
```

It updates:

- `CommandRegistry`
- `AgentDefinitionRegistry`
- `HookRegistry`
- future local skill registry
- context cache
- diagnostics store

### 8.2 Trust filtering

The sync layer must filter by trust before registry mutation.

Example:

```text
workspace trusted for instructions only
  -> apply instructions
  -> do not register commands, agents, hooks, or skills
  -> emit diagnostics/status explaining disabled capabilities
```

Do not rely on UI-only disabled states for trust enforcement.

### 8.3 Context cache

Add an in-memory context cache:

```typescript
export class AIFetchlyContextStore {
  replaceInstructions(sourceId: string, blocks: readonly AIFetchlyInstructionBlock[]): void;
  removeSource(sourceId: string): void;
  getGlobalInstructions(): AIFetchlyInstructionBlock[];
  getWorkspaceInstructions(workspaceId: string): AIFetchlyInstructionBlock[];
}
```

This avoids reading files during every chat request.

### 8.4 Renderer notifications

After applying a snapshot, emit:

```text
AIFETCHLY_CONFIG_CHANGED
```

Payload:

```typescript
export interface AIFetchlyConfigChangedEvent {
  readonly source: "user" | "workspace";
  readonly sourceId: string;
  readonly workspaceId?: string;
  readonly diff: AIFetchlyConfigDiff;
  readonly summary: {
    readonly commandCount: number;
    readonly agentCount: number;
    readonly skillCount: number;
    readonly hookCount: number;
    readonly diagnosticCount: number;
  };
}
```

## 9. Workspace Watcher Worker

### 9.1 Process model

Use one worker process for all watched workspaces:

```text
0 watched workspaces -> no worker
1+ watched workspaces -> one worker process
worker crash -> restart and rescan all still-acquired workspaces
app shutdown -> graceful shutdown message, then kill timeout
```

Do not spawn one process per chat.

### 9.2 Worker entry point

```text
src/childprocess/aifetchly-config/WorkspaceConfigWatchWorker.ts
```

Register the entry in `forge.config.js` under the build section with a dedicated Vite config if the project pattern requires it.

### 9.3 Watch manager

`WorkspaceWatchManager` lives in the main process:

```typescript
export interface WorkspaceWatchAcquireInput {
  readonly workspaceId: string;
  readonly workspaceRoot: string;
  readonly consumerId: string;
  readonly reason: "chat-open" | "active-stream" | "agent-run" | "tool-execution";
}

export class WorkspaceWatchManager {
  acquire(input: WorkspaceWatchAcquireInput): Promise<void>;
  release(workspaceId: string, consumerId: string): Promise<void>;
  rescan(workspaceId: string): Promise<void>;
  shutdown(): Promise<void>;
}
```

State:

```typescript
interface WatchedWorkspaceState {
  readonly workspaceId: string;
  readonly workspaceRoot: string;
  readonly consumers: Set<string>;
  readonly lastSnapshot?: AIFetchlyConfigSnapshot;
}
```

### 9.4 Worker protocol

Main to worker:

```typescript
export type WorkspaceWatchCommand =
  | {
      type: "watch-workspace";
      workspaceId: string;
      workspaceRoot: string;
      includeRootAgentsFile: boolean;
    }
  | { type: "unwatch-workspace"; workspaceId: string }
  | { type: "rescan-workspace"; workspaceId: string }
  | { type: "shutdown" };
```

Worker to main:

```typescript
export type WorkspaceWatchEvent =
  | {
      type: "snapshot";
      workspaceId: string;
      snapshot: AIFetchlyConfigSnapshot;
    }
  | {
      type: "changed";
      workspaceId: string;
      snapshot: AIFetchlyConfigSnapshot;
      diff: AIFetchlyConfigDiff;
    }
  | {
      type: "diagnostic";
      workspaceId: string;
      diagnostic: AIFetchlyConfigDiagnostic;
    }
  | {
      type: "error";
      workspaceId: string;
      message: string;
      recoverable: boolean;
    };
```

Worker messages must be validated in the main process before use.

### 9.5 Watch paths

The worker watches:

```text
<workspace>/.aifetchly/**
<workspace>/AGENTS.md
```

It must not watch the whole workspace in this feature.

### 9.6 Debounce and generations

Use per-workspace debounce:

```typescript
const WATCH_DEBOUNCE_MS = 500;
```

Use scan generations to discard stale scans:

```typescript
interface WorkspaceScanState {
  generation: number;
  pendingTimer?: NodeJS.Timeout;
  lastSnapshot?: AIFetchlyConfigSnapshot;
}
```

If scan generation 8 starts after generation 7, and 7 finishes last, discard generation 7.

### 9.7 Scanner implementation

`WorkspaceConfigScanner.scan(input)` returns a full snapshot:

```typescript
export interface WorkspaceConfigScanInput {
  readonly workspaceId: string;
  readonly workspaceRoot: string;
  readonly includeRootAgentsFile: boolean;
}

export class WorkspaceConfigScanner {
  scan(input: WorkspaceConfigScanInput): Promise<AIFetchlyConfigSnapshot>;
}
```

Use async filesystem APIs only.

Discovery should be explicit, not a broad recursive scan in Phase 2:

```text
.aifetchly/AGENTS.md
.aifetchly/settings.json
.aifetchly/commands/*.md
AGENTS.md
```

When later phases add `agents`, `hooks`, and `skills`, add explicit globs for those directories.

### 9.8 Worker crash handling

On worker exit:

1. Mark worker unhealthy.
2. Clear process handle.
3. If watched workspace count is zero, do nothing.
4. If watched workspace count is greater than zero, restart worker.
5. Re-send `watch-workspace` for each watched workspace.
6. Request full rescan for each workspace.
7. Emit diagnostics/status to renderer.

Avoid infinite restart loops:

```typescript
maxRestarts = 3 within 60 seconds
```

If exceeded, stop watcher and surface an error. Manual `/reload-config` can try again.

## 10. Workspace Lifecycle Integration

### 10.1 Chat open

When AiChatV2 opens or selects a conversation:

```text
AiChatV2 selected conversation
  -> renderer requests workspace summary as today
  -> main process resolves approved workspace
  -> WorkspaceWatchManager.acquire({
       workspaceId,
       workspaceRoot,
       consumerId: `chat:${conversationId}`,
       reason: "chat-open"
     })
```

Add a main-process method rather than trusting renderer path input.

### 10.2 Workspace approval

After `WorkspaceModule.approveWorkspace(id)` succeeds:

```text
workspace approved
  -> acquire chat consumer
  -> watch workspace config
  -> initial snapshot
  -> trust prompt if .aifetchly exists and trust is absent
```

Workspace approval and workspace config trust may be separate states. If no new trust table exists in Phase 2, use workspace approval as the temporary trust gate only for instructions and prompt commands, then add finer-grained trust before hooks/skills.

### 10.3 Chat close

Renderer should notify main process when AiChatV2 panel closes:

```text
AI_CHAT_V2_WORKSPACE_WATCH_RELEASE
```

Payload:

```typescript
{ conversationId: string }
```

Main process resolves workspace for that conversation and releases `chat:<conversationId>`.

### 10.4 Active stream and background jobs

When a stream starts for a conversation with workspace:

```text
acquire `stream:<turnId>`
```

When stream completes, cancels, or fails:

```text
release `stream:<turnId>`
```

Agent and tool runs should follow the same pattern only when they need workspace config to remain active after the chat panel is closed.

## 11. Slash Command Implementation

### 11.1 Parser

`SlashCommandParser` should parse only command-leading messages:

```typescript
export interface ParsedSlashCommandInput {
  readonly isCommand: boolean;
  readonly name?: string;
  readonly args?: string;
  readonly raw: string;
}
```

Rules:

- `/review src` is a command.
- ` /review src` is a command after left trim.
- `//review` is not a command.
- `/` opens suggestions but is not dispatchable.
- `/unknown args` returns a parsed command and dispatcher returns not found.
- escaped slash support (`\/review`) can be deferred.

### 11.2 Suggestions

Renderer requests:

```typescript
export interface SlashCommandListRequest {
  readonly conversationId?: string;
  readonly query?: string;
}
```

Response:

```typescript
export interface SlashCommandListResponse {
  readonly status: boolean;
  readonly commands: readonly SlashCommandView[];
  readonly diagnostics: readonly AIFetchlyConfigDiagnostic[];
  readonly msg?: string;
}
```

Filter ranking:

1. exact name
2. exact alias
3. prefix name
4. prefix alias
5. substring in description

Fuse-style fuzzy search can be added later.

### 11.3 Dispatch IPC

Channels:

```typescript
export const SLASH_COMMAND_LIST = "slash-command:list";
export const SLASH_COMMAND_DISPATCH = "slash-command:dispatch";
export const AIFETCHLY_CONFIG_RELOAD = "aifetchly-config:reload";
export const AIFETCHLY_CONFIG_STATUS = "aifetchly-config:status";
export const AIFETCHLY_CONFIG_CHANGED = "aifetchly-config:changed";
```

Dispatch request:

```typescript
export interface SlashCommandDispatchRequest {
  readonly conversationId: string;
  readonly rawInput: string;
}
```

Dispatch response:

```typescript
export type SlashCommandDispatchResponse =
  | {
      readonly status: true;
      readonly action: "submit_prompt";
      readonly prompt: string;
      readonly commandId: string;
    }
  | {
      readonly status: true;
      readonly action: "show_result";
      readonly content: string;
      readonly commandId: string;
    }
  | {
      readonly status: false;
      readonly msg: string;
    };
```

For prompt commands, the renderer can either submit the returned prompt through the existing send path or the main process can call the AI engine directly. Prefer returning `submit_prompt` in Phase 1 to minimize Chat V2 engine changes, but ensure AI enable gating occurs before actual AI submission in the stream IPC.

### 11.4 Built-in commands

Built-ins run in main process through `SlashCommandDispatcher`.

`/help`:

- returns a text summary of available commands
- no AI enable check required

`/status`:

- returns global and active workspace config status
- no AI enable check required

`/reload-config`:

- rescans global config and active workspace config
- no AI enable check required unless it also triggers AI work

`/clear`:

- should reuse existing clear conversation path
- may require confirmation in renderer
- no AI enable check required

## 12. Context Injection

### 12.1 Integration point

Modify `AIChatContextAssembler.assemble()`:

```typescript
const localInstructions = await this.aifetchlyContext.getInstructionBlocks({
  conversationId: input.conversationId,
  mode: input.mode,
});

for (const block of localInstructions) {
  messages.push({
    role: "system",
    content: formatInstructionBlock(block),
  });
}
```

Place local instructions after the base system prompt and before durable memory. This mirrors the current custom context directive placement and keeps conversation-specific retrieved memory lower priority than explicit user/workspace instructions.

### 12.2 Formatting

Use clear labels:

```text
User global AiFetchly instructions from ~/.aifetchly/AGENTS.md:

<content>
```

Workspace:

```text
Trusted workspace AiFetchly instructions for /path/to/workspace from .aifetchly/AGENTS.md:

<content>
```

Avoid wording that tells the model these files are higher priority than the app's own system prompt.

### 12.3 Cache misses

If config manager has not loaded yet, `AIFetchlyContextLoader` should return an empty list rather than blocking the chat request on a scan.

Startup should trigger the initial scan early enough that normal usage sees instructions.

## 13. Trust Persistence

### 13.1 Minimal Phase 2 implementation

For Phase 2, workspace approval may temporarily gate workspace instructions and prompt commands:

```text
WorkspaceResolver returns approved workspace
  -> workspace config can be watched
  -> prompt commands and instructions can be enabled
```

Before hooks, skills, or executable command types ship, add explicit workspace AI config trust.

### 13.2 Full trust implementation

Add a Module/Model pair:

```text
src/entity/AIFetchlyWorkspaceTrust.entity.ts
src/model/AIFetchlyWorkspaceTrust.model.ts
src/modules/AIFetchlyWorkspaceTrustModule.ts
```

Entity fields:

```typescript
workspaceRootHash: string;
workspaceRootPath: string;
conversationId?: string;
trustInstructions: boolean;
trustCommands: boolean;
trustAgents: boolean;
trustHooks: boolean;
trustSkills: boolean;
createdAt: Date;
updatedAt: Date;
```

Use a hash for lookup, but keep path for display/debug. All DB access goes through Module and Model.

### 13.3 Trust service

```typescript
export interface AIFetchlySourceTrust {
  readonly instructions: boolean;
  readonly commands: boolean;
  readonly agents: boolean;
  readonly hooks: boolean;
  readonly skills: boolean;
}

export class WorkspaceTrustService {
  getTrustForWorkspace(workspaceId: string, rootPath: string): Promise<AIFetchlySourceTrust>;
}
```

## 14. Security Controls

### 14.1 AI enable gating

Handlers that execute AI work must check:

```typescript
const token = new Token();
const enabled = token.getValue(USER_AI_ENABLED);
if (enabled !== "true") {
  return { status: false, msg: "AI features are disabled.", data: null };
}
```

Handlers that only list commands or reload config do not need this gate.

### 14.2 Renderer isolation

Do not expose raw file contents except through explicit preview APIs guarded by trust UI. Slash command list responses should include metadata, not full command bodies.

### 14.3 No direct executable loading

Phase 1 prompt commands are text expansion only.

When skills ship:

- validate manifest
- register through existing skill flow
- execute through `SkillExecutor`
- permission-check through `SkillPermissionService`
- never load arbitrary user code into Electron main process

### 14.4 Worker message validation

Main process must validate every worker message:

- correct object shape
- known `type`
- workspace ID is currently watched
- snapshot source matches workspace
- no absolute file paths in relative path fields
- diagnostics are strings within size limits

Malformed worker messages should terminate and restart the worker.

## 15. Error Handling

### 15.1 Loader failures

Expected failures become diagnostics:

- invalid frontmatter
- missing required fields
- file too large
- unreadable file
- invalid JSON
- unsupported type

Unexpected failures are logged and surfaced as recoverable source-level diagnostics.

### 15.2 Watcher failures

If `fs.watch` is unavailable or fails for a workspace:

- emit a diagnostic
- keep manual reload available
- do not disable global config

If worker crashes repeatedly:

- stop automatic watching
- show `/status` warning
- allow `/reload-config` to try one manual scan

### 15.3 Dispatch failures

Unknown command:

```text
Unknown slash command: /foo
```

Disabled command:

```text
Command /foo is disabled because workspace config is not trusted.
```

Invalid prompt expansion:

```text
Command /foo could not be expanded. Check the command file diagnostics.
```

## 16. Performance

### 16.1 Main process

Main process must not perform synchronous recursive workspace scans.

Allowed:

- small global config scan on startup using async APIs
- registry replacement in memory
- worker lifecycle messages

Avoid:

- `fs.readFileSync` during chat send
- recursive whole-workspace scanning
- hashing large files in main process

### 16.2 Worker

Worker scan target:

- typical `.aifetchly` scan under 500ms
- debounce file bursts to one scan
- explicit path discovery in early phases

### 16.3 Renderer

Slash suggestion list should be preloaded or fetched on `/` open and updated on `AIFETCHLY_CONFIG_CHANGED`.

Do not call IPC on every keystroke if the command list is already local. Filter in renderer after receiving the list.

## 17. IPC And Preload

### 17.1 Channel constants

Add to `src/config/channellist.ts`:

```typescript
export const SLASH_COMMAND_LIST = "slash-command:list";
export const SLASH_COMMAND_DISPATCH = "slash-command:dispatch";
export const AIFETCHLY_CONFIG_RELOAD = "aifetchly-config:reload";
export const AIFETCHLY_CONFIG_STATUS = "aifetchly-config:status";
export const AIFETCHLY_CONFIG_CHANGED = "aifetchly-config:changed";
export const AIFETCHLY_WORKSPACE_WATCH_ACQUIRE = "aifetchly-workspace-watch:acquire";
export const AIFETCHLY_WORKSPACE_WATCH_RELEASE = "aifetchly-workspace-watch:release";
```

Acquire/release channels can remain internal main-process methods if the existing workspace IPC path can call `WorkspaceWatchManager` directly. Add public channels only if renderer lifecycle events require them.

### 17.2 Preload API

Expose renderer-safe methods:

```typescript
slashCommands: {
  list(request: SlashCommandListRequest): Promise<SlashCommandListResponse>;
  dispatch(request: SlashCommandDispatchRequest): Promise<SlashCommandDispatchResponse>;
  onConfigChanged(callback: (event: AIFetchlyConfigChangedEvent) => void): () => void;
}

aifetchlyConfig: {
  reload(conversationId?: string): Promise<AIFetchlyConfigReloadResponse>;
  status(conversationId?: string): Promise<AIFetchlyConfigStatusResponse>;
}
```

Do not expose file paths beyond display-safe labels unless needed by the existing workspace UI.

## 18. Renderer Design

### 18.1 Composer changes

`AiChatV2Composer.vue` should:

- detect when current draft starts with `/`
- show `AiChatV2SlashSuggestions`
- allow arrow key navigation
- allow Enter/Tab to choose a command
- keep Shift+Enter newline behavior
- emit normal send for non-command messages
- emit slash command submit for command messages

Phase 1 can use a simple dropdown. Do not overbuild fuzzy search.

### 18.2 AiChatV2 changes

`AiChatV2.vue` should:

- load slash commands when mounted
- subscribe to config changed events
- refresh command list after config changes
- acquire workspace watch on active conversation/workspace
- release workspace watch on unmount or conversation switch
- route command submissions through `slashCommands.dispatch`

### 18.3 Status display

`AiChatV2ConfigStatus.vue` can be used by `/status` later. Phase 1 may render status as a chat system/result message.

### 18.4 i18n keys

Add keys under a new group, for example:

```typescript
aifetchlyConfig: {
  reload: "...",
  status: "...",
  diagnostics: "...",
  workspaceTrustTitle: "...",
  workspaceTrustBody: "...",
  commandDisabledUntrusted: "...",
}
slashCommands: {
  help: "...",
  clear: "...",
  reloadConfig: "...",
  status: "...",
  noMatches: "...",
}
```

Update all supported language files.

## 19. Startup And Shutdown

### 19.1 Startup

Main process startup sequence:

```text
register built-in slash commands
create AIFetchlyConfigManager singleton
scan ~/.aifetchly asynchronously
apply user snapshot
register IPC handlers
```

Do not block app launch on global config scan. If scan fails, record diagnostics.

### 19.2 Shutdown

On app shutdown:

```text
WorkspaceWatchManager.shutdown()
  -> send worker shutdown
  -> wait short timeout
  -> kill if still alive
```

Do not leave watcher processes running.

## 20. Phase Plan

### Phase 1: Global context and built-in slash commands

Files:

```text
src/entityTypes/aifetchlyConfigTypes.ts
src/entityTypes/slashCommandTypes.ts
src/service/aifetchlyConfig/*
src/service/slashCommands/*
src/modules/SlashCommandModule.ts
src/main-process/communication/slash-command-ipc.ts
src/views/api/slashCommands.ts
src/views/components/aiChatV2/AiChatV2SlashSuggestions.vue
```

Scope:

- global `~/.aifetchly/AGENTS.md`
- global `settings.json`
- built-in slash command registry
- `/help`, `/status`, `/reload-config`, `/clear`
- context injection
- manual reload
- startup scan

### Phase 2: Workspace watcher worker

Files:

```text
src/childprocess/aifetchly-config/WorkspaceConfigWatchWorker.ts
src/childprocess/aifetchly-config/WorkspaceConfigScanner.ts
src/childprocess/aifetchly-config/WorkspaceConfigWatcher.ts
src/service/aifetchlyConfig/WorkspaceWatchManager.ts
```

Scope:

- start watch when approved workspace is active in chat
- stop watch by reference count
- worker scan of `.aifetchly/AGENTS.md`, `.aifetchly/settings.json`, `.aifetchly/commands/*.md`, optional root `AGENTS.md`
- worker restart on crash
- config changed renderer events

### Phase 3: Prompt command files

Scope:

- parse user and workspace `commands/*.md`
- command source replacement
- slash suggestions with source badges
- prompt expansion with `$ARGUMENTS`
- deletion/rename reconciliation

### Phase 4: Dynamic agents

Scope:

- refactor `AgentDefinitionRegistry`
- parse `agents/*.md`
- register source-scoped agents
- update `/agents`
- update `run_subagent` validation and description

### Phase 5: Hooks

Scope:

- parse `hooks/hooks.json`
- trust-gated hook registration
- source replacement in `HookRegistry`
- worker/sandbox dispatch only

### Phase 6: Skills and plugin integration

Scope:

- safe `~/.aifetchly/skills` import/enable design
- plugin `commands/` activation
- plugin `agents/` activation

## 21. Testing

### 21.1 Unit tests

```text
test/vitest/main/service/AIFetchlyConfigMarkdown.test.ts
test/vitest/main/service/AIFetchlyConfigLoader.test.ts
test/vitest/main/service/AIFetchlyConfigSnapshotDiff.test.ts
test/vitest/main/service/CommandRegistry.test.ts
test/vitest/main/service/SlashCommandParser.test.ts
test/vitest/main/service/SlashCommandDispatcher.test.ts
```

Cover:

- valid command markdown
- missing frontmatter
- invalid names
- aliases
- `$ARGUMENTS`
- size limits
- source replacement
- duplicate names and lookup order

### 21.2 IPC tests

```text
test/vitest/main/ipc/slash-command-ipc.test.ts
test/vitest/main/ipc/aifetchly-config-ipc.test.ts
```

Cover:

- list commands
- dispatch built-ins
- dispatch prompt command
- reload config
- malformed request handling
- AI enable gate where dispatch starts AI work

### 21.3 Worker tests

```text
test/vitest/main/childprocess/WorkspaceConfigScanner.test.ts
test/vitest/main/childprocess/WorkspaceWatchManager.test.ts
```

Cover:

- initial snapshot
- deleted command removed from new snapshot
- debounce
- malformed JSON diagnostic
- path traversal rejection
- worker crash restart behavior

### 21.4 Context tests

```text
test/vitest/main/service/AIFetchlyContextLoader.test.ts
test/vitest/main/service/AIChatContextAssembler.aifetchly.test.ts
```

Cover:

- global instruction injection
- trusted workspace instruction injection
- untrusted workspace ignored
- ordering relative to base prompt and memory
- read failure degrades gracefully

### 21.5 Renderer tests

If existing frontend test setup supports it:

```text
test/vitest/utilitycode/AiChatV2SlashSuggestions.test.ts
```

Otherwise use manual QA until the renderer test harness is stable.

## 22. Manual QA Checklist

1. Start app with no `~/.aifetchly`.
2. Run `/status`; verify no config loaded and no error.
3. Create `~/.aifetchly/AGENTS.md`.
4. Run `/reload-config`.
5. Send a chat message that should reflect the instruction.
6. Create `~/.aifetchly/commands/review.md`.
7. Type `/`; verify `/review` appears.
8. Run `/review src/service`; verify prompt command expands and sends.
9. Delete `review.md`; verify `/review` disappears after watcher/reload.
10. Open chat with approved workspace.
11. Add `<workspace>/.aifetchly/commands/project-review.md`.
12. Verify workspace watcher loads it without app restart.
13. Close chat; verify watcher releases when no consumers remain.
14. Reopen chat; verify watcher starts and command returns.

## 23. Migration And Compatibility

No data migration is required for Phase 1.

Phase 2 may add workspace trust persistence. If that happens:

- create a TypeORM entity
- add Module and Model
- use existing DB path resolution through `BaseModule` and `BaseDb`
- do not query the DB from the worker

Claude plugin `commands` and `agents` remain opaque until Phase 6.

## 24. Risks And Mitigations

| Risk | Mitigation |
|---|---|
| Main process stalls during file scanning | Workspace scan runs in child process; global scan uses async bounded reads |
| Deleted files leave stale commands | Always replace source from full snapshot |
| Workspace repo injects unsafe behavior | Workspace trust gate and no executable commands in Phase 1 |
| Duplicate command names confuse users | Source badges and deterministic lookup order |
| Worker crashes break config reload | Restart with cap, rescan watched workspaces, manual reload fallback |
| Prompt commands become hidden prompt injection | Label command-expanded prompts and keep app system prompt higher priority |
| Renderer sees private file contents | List metadata only; preview APIs must be explicit and trust-aware |
| Future hooks execute unsafe shell | Hooks route through existing hook/worker permission boundaries |

## 25. Implementation Order

1. Add shared types and constants.
2. Add markdown/frontmatter parser and tests.
3. Add `CommandRegistry` and built-in commands.
4. Add slash command IPC and renderer API.
5. Add basic slash suggestions UI.
6. Add global config loader and context store.
7. Wire `AIChatContextAssembler` to context loader.
8. Add `/reload-config` and `/status`.
9. Add global command markdown loading.
10. Add workspace watcher worker and scanner.
11. Add `WorkspaceWatchManager` lifecycle.
12. Wire active chat workspace acquire/release.
13. Add workspace command and instruction snapshots.
14. Add trust UI and persistence before enabling hooks/skills.

Commit each logical unit separately.

