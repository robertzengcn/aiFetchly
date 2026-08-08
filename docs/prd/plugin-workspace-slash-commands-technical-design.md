# Plugin And Workspace Slash Commands - Technical Design

Version: 1.0
Date: 2026-07-16
Status: Draft
Source PRD: `docs/prd/plugin-workspace-slash-commands-prd.md`
Normative reference: `/home/robertzeng/project/github/claude-code/docs/slash-commands.md`

## 1. Purpose

This document translates the Plugin And Workspace Slash Commands PRD into an implementation-facing design.

The feature finishes the existing AiFetchly slash-command stack so AiChatV2 can safely expose:

- global user prompt commands from `~/.aifetchly/commands`
- trusted workspace prompt commands from `<workspace>/.aifetchly/commands`
- installed plugin prompt commands from native AiFetchly plugin folders
- installed plugin prompt commands from Claude-compatible command declarations

The first release is prompt-only. A command expands text and then the renderer submits that text through the existing Chat V2 stream path. It does not execute plugin code, shell commands, JavaScript, JSX, local UI flows, or command-scoped tool grants.

The design keeps the current architecture:

```text
Renderer AiChatV2
  -> preload-safe IPC
  -> main-process IPC handlers
  -> SlashCommandModule
  -> command scope resolver
  -> CommandRegistry / SlashCommandDispatcher
  -> existing Chat V2 stream path for prompt commands
```

The key technical change is **scoped command resolution**. The current registry stores all commands and builds one global name index. That is not enough for workspace commands because a workspace command must win only inside chats using that workspace. The new design filters allowed source ids first, then applies the existing precedence rules.

## 2. Existing System Anchors

### 2.1 Slash command runtime

```text
src/entityTypes/slashCommandTypes.ts
src/service/slashCommands/CommandRegistry.ts
src/service/slashCommands/SlashCommandParser.ts
src/service/slashCommands/SlashCommandDispatcher.ts
src/service/slashCommands/builtinSlashCommands.ts
src/service/slashCommands/promptCommandFrontmatter.ts
src/service/slashCommands/expandPrompt.ts
src/modules/SlashCommandModule.ts
src/main-process/communication/slash-command-ipc.ts
src/views/api/slashCommands.ts
src/views/components/aiChatV2/AiChatV2.vue
src/views/components/aiChatV2/AiChatV2Composer.vue
src/views/components/aiChatV2/AiChatV2SlashSuggestions.vue
```

Important current behavior:

- `CommandRegistry.replaceSource(sourceId, commands)` already atomically reconciles a full source.
- `CommandRegistry` precedence is currently built-in > workspace > user > plugin.
- `SlashCommandDispatcher.dispatch()` currently calls `registry.getByName(parsed.name)`.
- `SlashCommandModule.listCommands()` currently calls `registry.listViews()` and does not use `conversationId`.
- `AiChatV2.vue` already dispatches slash commands with `conversationId`.
- `AiChatV2Composer.vue` currently lists slash commands without `conversationId`.

### 2.2 Workspace runtime

```text
src/modules/WorkspaceModule.ts
src/model/Workspace.model.ts
src/service/workspaceWatch/WorkspaceWatchManager.ts
src/service/workspaceWatch/WorkspaceConfigScanner.ts
src/service/workspaceWatch/buildWorkspaceCommandDefinitions.ts
src/service/workspaceWatch/WorkspaceWatchManagerSingleton.ts
src/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync.ts
```

Important current behavior:

- `WorkspaceModule.getActiveWorkspace(conversationId)` returns the latest workspace only when `approvalState === "approved"`.
- Workspace scanner workers produce command drafts, not final database-backed state.
- `WorkspaceWatchManager` converts workspace command drafts into `SlashCommandDefinition[]` in the main process.
- `AIFetchlyRuntimeRegistrySync.applyWorkspaceSnapshot(snapshot, trust)` drops workspace commands when `trust.commands` is false.

### 2.3 Plugin runtime

```text
src/service/PluginComponentRegistryService.ts
src/service/PluginLoaderService.ts
src/service/PluginImportService.ts
src/service/PluginInstallService.ts
src/service/pluginCompat/ClaudePluginAdapter.ts
src/service/pluginCompat/pluginFormatTypes.ts
src/entityTypes/pluginTypes.ts
src/main-process/communication/plugin-ipc.ts
```

Important current behavior:

- `PluginComponentRegistryService.promotePluginCommandsAndAgents()` already scans `<plugin>/commands/*.md`.
- Plugin commands are registered under `sourceId = plugin:<pluginName>`.
- Disabled or missing plugin install dirs reconcile their command source to `[]`.
- Claude plugin `commands` declarations are currently stored in `__claudeOpaque__`, not converted to commands.
- Plugin install currently clears plugin runtime cache but does not directly call command promotion in `PluginImportService`.
- Plugin toggle, reload, uninstall, skill toggle, and MCP toggle already call `PluginComponentRegistryService.applyLoadedPlugins()` or unregister capabilities in IPC.

## 3. Target Architecture

### 3.1 Runtime data flow

```text
User types "/" in AiChatV2
  -> AiChatV2 passes activeConversationId to AiChatV2Composer
  -> Composer calls listSlashCommands({ conversationId, query })
  -> SLASH_COMMAND_LIST IPC validates input
  -> SlashCommandModule.resolveScope(conversationId)
       -> WorkspaceModule.getActiveWorkspace(conversationId)
       -> allowedSourceIds = built-in + user + plugin:* + optional workspace:<id>
  -> CommandRegistry.listScopedViews(scope)
  -> rankSuggestions(query, scopedViews)
  -> renderer receives SlashCommandView[] only

User submits "/review current changes"
  -> AiChatV2.handleSlashCommandSubmission(rawInput)
  -> dispatchSlashCommand({ conversationId, rawInput })
  -> SLASH_COMMAND_DISPATCH IPC validates input
  -> SlashCommandModule.resolveScope(conversationId)
  -> SlashCommandDispatcher.dispatch(input, scope)
  -> scoped resolver finds winning command
  -> local command returns show_result OR prompt command returns submit_prompt
  -> renderer submits submit_prompt via existing Chat V2 stream path
  -> AI_CHAT_V2_STREAM gates via provider-aware canUseChat() before AI work
```

### 3.2 Source registration flow

```text
Global user config
  -> AIFetchlyConfigLoader.scanGlobalRoot()
  -> buildPromptCommandDefinition(source=user)
  -> AIFetchlyRuntimeRegistrySync.applySnapshot()
  -> CommandRegistry.replaceSource("user", commands)

Workspace config
  -> WorkspaceConfigScanner worker snapshots .aifetchly/commands/*.md
  -> WorkspaceWatchManager converts drafts in main process
  -> AIFetchlyRuntimeRegistrySync.applyWorkspaceSnapshot(snapshot, trust)
  -> trust.commands ? CommandRegistry.replaceSource("workspace:<id>", commands) : []

Plugin install/load
  -> PluginLoaderService.loadAllPlugins()
  -> PluginCommandSourceReader reads native + Claude command declarations
  -> buildPromptCommandDefinition(source=plugin)
  -> PluginComponentRegistryService.promotePluginCommandsAndAgents()
  -> CommandRegistry.replaceSource("plugin:<name>", commands)
```

### 3.3 Main design rule

The registry may contain all workspace commands, but every public list and dispatch path must use a scoped view of the registry.

The wrong pattern is:

```typescript
const cmd = registry.getByName(name);
```

The correct pattern is:

```typescript
const scope = await scopeResolver.resolveForConversation(conversationId);
const cmd = registry.getByNameScoped(name, scope);
```

## 4. Types And Interfaces

### 4.1 Extend slash command types

File: `src/entityTypes/slashCommandTypes.ts`

Add pure types. This file must remain free of Electron, TypeORM, Vue, Modules, and Services.

```typescript
export interface SlashCommandScope {
  readonly conversationId?: string;
  readonly activeWorkspaceId?: string;
  readonly allowedExactSourceIds: readonly string[];
  readonly allowPluginSources: boolean;
}

export interface SlashCommandListResponse {
  readonly status: true;
  readonly commands: readonly SlashCommandView[];
  readonly diagnostics: readonly unknown[];
  readonly msg: string;
}
```

Scope semantics:

- `allowedExactSourceIds` includes `built-in`, `user`, and optionally `workspace:<workspaceId>`.
- `allowPluginSources` is true for normal chat command use.
- A command source is allowed when:
  - `scope.allowedExactSourceIds.includes(cmd.sourceId)`, or
  - `scope.allowPluginSources && cmd.source === "plugin"`.

Why plugins use a predicate instead of enumerating ids: installed plugin count is dynamic and already represented in the registry. Filtering by `cmd.source === "plugin"` avoids rebuilding scopes when plugins change.

### 4.2 Optional diagnostics typing

The existing list response uses `readonly unknown[]`. Keep that wire shape for compatibility in Phase 1. Internally, use `AIFetchlyConfigDiagnostic[]` where diagnostics are already available.

Do not send raw prompt bodies, parsed frontmatter maps, or arbitrary plugin metadata to the renderer.

## 5. Scoped Command Registry

### 5.1 Current problem

`CommandRegistry` currently maintains:

- `byId`
- `byName`
- `sourceIndex`

`byName` is global. If `workspace:1` registers `/review`, `registry.getByName("review")` may return the workspace command even in a conversation that is not using workspace 1.

### 5.2 Required registry additions

File: `src/service/slashCommands/CommandRegistry.ts`

Add scoped accessors without removing existing methods:

```typescript
export interface CommandRegistryScope {
  readonly allowedExactSourceIds: ReadonlySet<string>;
  readonly allowPluginSources: boolean;
}

export class CommandRegistry {
  listScoped(scope: CommandRegistryScope): SlashCommandDefinition[] {}
  listScopedViews(scope: CommandRegistryScope): SlashCommandView[] {}
  getByNameScoped(name: string, scope: CommandRegistryScope): SlashCommandDefinition | null {}
}
```

Implementation:

```typescript
private isAllowed(cmd: SlashCommandDefinition, scope: CommandRegistryScope): boolean {
  if (scope.allowedExactSourceIds.has(cmd.sourceId)) return true;
  if (scope.allowPluginSources && cmd.source === "plugin") return true;
  return false;
}
```

`listScoped()`:

1. Iterate over `byId.values()` in insertion order.
2. Filter by `isAllowed`.
3. Return defensive copies.

`getByNameScoped()`:

1. Iterate over `byId.values()` in insertion order.
2. Filter by `cmd.name === name`.
3. Filter by `isAllowed`.
4. Filter by `cmd.enabled`.
5. Select the lowest `SOURCE_RANK`.
6. Break ties by first registration order.
7. Return a defensive copy or null.

`listScopedViews()` maps `listScoped()` through the existing renderer-safe `toView`.

### 5.3 Alias-aware scoped lookup

The PRD requires aliases to work for lookup and suggestions. Current `getByName()` does not resolve aliases. Add:

```typescript
getByLookupNameScoped(lookupName: string, scope: CommandRegistryScope): SlashCommandDefinition | null
```

Matching rule:

```typescript
cmd.name === lookupName || cmd.aliases.includes(lookupName)
```

Ranking rule:

- Source rank decides between all matched commands.
- Primary-name match and alias match do not change source precedence.
- For same source rank, primary-name match should beat alias match.
- For exact tie, first registration order wins.

Keep existing `getByName()` behavior for backward-compatible tests, but route production dispatch through `getByLookupNameScoped`.

### 5.4 Scoped help output

`/help` should list only commands in the same scope as dispatch.

Current `SlashCommandDispatcher.renderHelp()` calls `registry.listViews()`. Change the dispatcher to receive the scoped views for local rendering or pass a resolver into `renderHelp()`.

Recommended shape:

```typescript
export interface SlashCommandDispatchContext {
  readonly scope: CommandRegistryScope;
}

dispatcher.dispatch(input, context)
```

Then `/help` calls `registry.listScopedViews(context.scope)`.

## 6. Command Scope Resolution

### 6.1 New service

Add:

```text
src/service/slashCommands/SlashCommandScopeResolver.ts
```

This service is main-process only.

```typescript
export interface SlashCommandScopeResolution {
  readonly commandScope: CommandRegistryScope;
  readonly activeWorkspaceId?: string;
  readonly activeWorkspaceRoot?: string;
}

export class SlashCommandScopeResolver {
  async resolve(conversationId?: string): Promise<SlashCommandScopeResolution> {}
}
```

Implementation:

```typescript
const exact = new Set<string>([BUILTIN_SOURCE, USER_SOURCE]);

if (conversationId) {
  const workspace = await new WorkspaceModule().getActiveWorkspace(conversationId);
  if (workspace) {
    exact.add(`workspace:${workspace.id}`);
  }
}

return {
  commandScope: {
    allowedExactSourceIds: exact,
    allowPluginSources: true,
  },
  activeWorkspaceId: workspace ? String(workspace.id) : undefined,
  activeWorkspaceRoot: workspace?.rootPath,
};
```

Notes:

- Use `WorkspaceModule`, not `WorkspaceModel`, from `SlashCommandModule`.
- `WorkspaceModule` extends `BaseModule`, so DB path resolution stays in the existing model/module stack.
- Do not use renderer-supplied workspace path.
- Do not accept `workspaceId` directly from the renderer for command scope.

### 6.2 Handling missing or invalid conversation id

For `SLASH_COMMAND_LIST`:

- `conversationId` is optional.
- Missing or unknown conversation means no workspace source.
- The list still returns built-in, user, and plugin commands.

For `SLASH_COMMAND_DISPATCH`:

- `conversationId` remains required by schema.
- Unknown conversation means no workspace source.
- Dispatch still allows built-in, user, and plugin commands.

### 6.3 Performance

Scope resolution reads the workspace row on every list debounce and dispatch. The current composer debounce is 120ms. That can produce frequent DB reads.

Phase 1 can use direct `WorkspaceModule.getActiveWorkspace()` because this is a local SQLite read and command lists are small.

If this becomes visible in profiling, add a small main-process cache:

```typescript
Map<string, { workspaceId?: string; rootPath?: string; expiresAt: number }>
```

Invalidation events:

- workspace approved
- workspace revoked
- active conversation switched
- app reload

Do not add the cache until there is evidence of pressure; it increases invalidation risk.

## 7. SlashCommandModule Changes

File: `src/modules/SlashCommandModule.ts`

### 7.1 Constructor

Add an injectable scope resolver for tests:

```typescript
constructor(
  registry?: CommandRegistry,
  manager?: AIFetchlyConfigManager,
  scopeResolver?: SlashCommandScopeResolver
) {}
```

### 7.2 listCommands

Change from:

```typescript
const all = this.registry.listViews();
```

To:

```typescript
const scope = await this.scopeResolver.resolve(req.conversationId);
const all = this.registry.listScopedViews(scope.commandScope);
```

Then run existing `rankSuggestions(query, all)`.

### 7.3 dispatch

Change from:

```typescript
return this.dispatcher.dispatch(req);
```

To:

```typescript
const scope = await this.scopeResolver.resolve(req.conversationId);
return this.dispatcher.dispatch(req, { scope: scope.commandScope });
```

### 7.4 reload/status

`reloadConfig()` and `getStatus()` do not need workspace command scoping in this phase.

Future improvement: make `/status` include active workspace source counts if `conversationId` is supplied. This is not required by the PRD.

## 8. SlashCommandDispatcher Changes

File: `src/service/slashCommands/SlashCommandDispatcher.ts`

### 8.1 New dispatch signature

```typescript
async dispatch(
  input: SlashCommandDispatchRequest,
  context: SlashCommandDispatchContext
): Promise<SlashCommandDispatchResponse>
```

For existing tests, provide a helper in test setup that creates a default all-non-workspace scope.

### 8.2 Scoped command lookup

Change:

```typescript
const cmd = this.registry.getByName(parsed.name);
```

To:

```typescript
const cmd = this.registry.getByLookupNameScoped(parsed.name, context.scope);
```

If no command is found, return the existing unknown command response.

### 8.3 Prompt command branch

Keep prompt execution exactly as-is:

```typescript
const rendered = expandPrompt(cmd.body ?? "", parsed.args ?? "");
return {
  status: true,
  action: "submit_prompt",
  prompt: rendered,
  commandId: cmd.id,
};
```

Do not add shell interpolation, file reads, or tool grants here.

### 8.4 Local command branch

Change `/help` to render scoped help.

Recommended:

```typescript
private renderHelp(scope: CommandRegistryScope): string {
  const views = this.registry.listScopedViews(scope);
  ...
}
```

`/status`, `/reload-config`, `/clear`, and `/agents` can remain unchanged. `/agents` currently lists all agents. Scoping dynamic workspace agents is a separate agent-system concern and not required for slash command command-scope safety.

## 9. Renderer Changes

### 9.1 AiChatV2 parent

File: `src/views/components/aiChatV2/AiChatV2.vue`

Change composer usage:

```vue
<AiChatV2Composer
  :conversation-id="activeConversationId"
  :is-streaming="chatIsRunning"
  :is-processing="isPreparingAttachments"
  @send="onSend"
  @stop="onStop"
>
```

Do not create a new conversation just for suggestions. A new chat with no conversation id should list non-workspace commands only. A conversation id is created when the user sends or chooses workspace setup.

### 9.2 AiChatV2Composer props

File: `src/views/components/aiChatV2/AiChatV2Composer.vue`

Add:

```typescript
const props = defineProps<{
  conversationId?: string | null;
  isStreaming: boolean;
  isProcessing?: boolean;
}>();
```

Change list call:

```typescript
const resp = await listSlashCommands({
  conversationId: props.conversationId ?? undefined,
  query,
});
```

### 9.3 Refresh on conversation changes

Add a watcher:

```typescript
watch(
  () => props.conversationId,
  () => {
    if (draft.value.startsWith("/")) refreshSlashSuggestions();
  }
);
```

This makes suggestions update when the user switches conversations while the composer contains slash text.

### 9.4 Config changed events

`views/api/slashCommands.ts` already has `onAifetchlyConfigChanged()`. The parent can keep existing behavior. The composer's next `refreshSlashSuggestions()` call will fetch scoped data.

If live refresh while dropdown is open is required, pass a monotonically increasing `slashRefreshKey` from parent to composer and watch it. This is a polish item, not Phase 1 required.

## 10. Plugin Command Loading

### 10.1 New reader service

Add:

```text
src/service/pluginCompat/PluginCommandSourceReader.ts
```

Purpose: read native and Claude plugin command declarations and return validated prompt command definitions plus diagnostics.

```typescript
export interface PluginCommandSourceReadInput {
  readonly pluginName: string;
  readonly installPath: string;
  readonly manifest: PluginManifest;
}

export interface PluginCommandSourceReadResult {
  readonly definitions: readonly SlashCommandDefinition[];
  readonly diagnostics: readonly AIFetchlyConfigDiagnostic[];
}

export class PluginCommandSourceReader {
  static async read(input: PluginCommandSourceReadInput): Promise<PluginCommandSourceReadResult> {}
}
```

### 10.2 Why a separate reader

`PluginComponentRegistryService.readComponentFiles()` currently handles only a flat physical directory. Claude supports several declaration shapes. A dedicated reader keeps:

- plugin-specific path handling out of `CommandRegistry`
- Claude compatibility out of `SlashCommandDispatcher`
- scanner logic reusable in tests
- command validation centralized through `buildPromptCommandDefinition`

### 10.3 Native AiFetchly plugin commands

For all plugins, read:

```text
<installPath>/commands/*.md
```

Use current behavior:

- only direct `.md` children in Phase 1
- skip missing directory without diagnostics
- size cap from `AIFETCHLY_CONFIG_LIMITS.commandMdBytes`
- parse with `parseRestrictedFrontmatter`
- validate with `buildPromptCommandDefinition`

### 10.4 Claude `commands/` convention

For `manifest.format === "claude"`, support a physical `commands/` directory even when manifest does not declare `commands`.

Command name derivation:

- Use frontmatter `name` if present.
- Otherwise use file basename without `.md`.
- For nested directory support, use colon namespace later. Phase 2 can support only direct files unless real plugins require nesting.

Description derivation:

- Use frontmatter `description` if present.
- Else use manifest command mapping description if available.
- Else use the first non-empty markdown line stripped of heading syntax.
- If still missing, produce `command-description-missing`.

Type derivation:

- Force `type: prompt` for Claude prompt command markdown unless frontmatter explicitly declares an unsupported local command type.
- If frontmatter declares local/local-jsx/shell behavior, skip with `claude-format-unsupported-feature`.

Argument hint derivation:

- Map Claude `argument-hint` to AiFetchly `argumentHint`.
- If both are present, `argumentHint` wins.

Unsupported Claude metadata:

- `allowed-tools`, `when_to_use`, `model`, `effort`, `disable-model-invocation`, `user-invocable`, `shell`, `version` are ignored in Phase 2.
- Ignored safe metadata should not produce a warning by default. Only produce diagnostics for fields that imply execution or unsupported safety behavior.

### 10.5 Claude manifest `commands` field

Add a type in `pluginTypes.ts` or `pluginFormatTypes.ts`:

```typescript
export type PluginCommandDeclaration =
  | string
  | readonly string[]
  | true
  | Record<string, PluginCommandDeclarationEntry>;

export interface PluginCommandDeclarationEntry {
  readonly source?: string;
  readonly content?: string;
  readonly description?: string;
}
```

The reader must support:

#### String path

```json
{ "commands": "./commands/review.md" }
```

Resolve path inside plugin root. If it is a directory, read direct `.md` children. If it is a file, read that file.

#### Path array

```json
{ "commands": ["./commands/review.md", "./commands/ship.md"] }
```

Resolve each path independently. One bad path produces a diagnostic but does not stop valid siblings.

#### Object mapping with source

```json
{
  "commands": {
    "review": { "source": "./commands/review.md", "description": "Review changes" }
  }
}
```

Use mapping key as fallback command name and mapping description as fallback description.

#### Object mapping with inline content

```json
{
  "commands": {
    "review": {
      "description": "Review changes",
      "content": "---\ndescription: Review changes\n---\nReview $ARGUMENTS\n"
    }
  }
}
```

For inline content:

- Virtual relative path: `<inline:<pluginName>:<commandKey>>`.
- Parse frontmatter if present.
- Supply fallback `name = commandKey`.
- Supply fallback `description = entry.description`.
- Supply fallback `type = prompt`.

#### Invalid object mapping

If an entry has both `source` and `content`, return a diagnostic:

```text
code: "frontmatter-invalid" or "claude-frontmatter-invalid"
message: Command '<key>' declares both source and content; choose one.
```

The project already has `claude-frontmatter-invalid` in `PluginErrorCode`, but command diagnostics use `AIFetchlyConfigDiagnostic.code` as a string. Prefer `claude-frontmatter-invalid` for clarity.

### 10.6 Path safety

All plugin command paths must resolve through:

```typescript
resolvePluginRelativePath(pluginRoot, relPath)
```

Never use `path.join(pluginRoot, userInput)` without containment validation.

### 10.7 Updating ClaudePluginAdapter

Current `ClaudePluginAdapter` stores `commands` under `CLAUDE_OPAQUE_KEY`.

Keep that for backward compatibility, but expose a typed helper:

```typescript
export function getClaudeOpaque(manifest: PluginManifest): Record<string, unknown> {
  return (manifest[CLAUDE_OPAQUE_KEY] ?? {}) as Record<string, unknown>;
}

export function getClaudeCommandDeclaration(manifest: PluginManifest): PluginCommandDeclaration | undefined {
  const opaque = getClaudeOpaque(manifest);
  return opaque.commands as PluginCommandDeclaration | undefined;
}
```

Do not move command parsing into `ClaudePluginAdapter`. The adapter should remain manifest normalization. Command file reading belongs in `PluginCommandSourceReader`.

### 10.8 PluginComponentRegistryService integration

Change:

```typescript
const commandResult = await PluginComponentRegistryService.readComponentFiles(...)
```

To:

```typescript
const commandResult = await PluginCommandSourceReader.read({
  pluginName: plugin.name,
  installPath: plugin.installPath,
  manifest: plugin.manifest,
});
```

Then:

```typescript
allDiagnostics.push(...commandResult.diagnostics);
commandRegistry.replaceSource(sourceId, commandResult.definitions);
```

Agents can continue using existing `readComponentFiles()` for now.

## 11. Plugin Install Timing

### 11.1 Current issue

`PluginImportService.installFromLocalRoot()` persists plugin rows and clears `PluginRuntimeCache`, but command promotion happens through `PluginComponentRegistryService.applyLoadedPlugins()` in several IPC paths. Import/install paths should guarantee command registry refresh before returning success to the renderer.

### 11.2 Recommended fix

Update plugin IPC install handlers, not `PluginImportService`, to avoid a circular import risk:

File: `src/main-process/communication/plugin-ipc.ts`

After successful:

- `PLUGIN_IMPORT`
- `PLUGIN_INSTALL_FROM_SOURCE`

Call:

```typescript
await PluginComponentRegistryService.applyLoadedPlugins();
```

This mirrors existing toggle/reload behavior and keeps import service focused on persistence and file operations.

### 11.3 Failure handling

If plugin install succeeds but command promotion fails unexpectedly:

- Do not roll back plugin install.
- Record/log promotion failure as a recoverable load error where practical.
- Return plugin install success if core install succeeded.
- Plugin reload should be able to recover.

The rationale: invalid commands should not block unrelated plugin capabilities such as skills or MCP servers.

## 12. Workspace Command Scoping

### 12.1 Source id mapping

Workspace command source ids are:

```text
workspace:<workspaceId>
```

The workspace id must be the persisted `WorkspaceEntity.id` as a string. `WorkspaceModule.getActiveWorkspace()` returns `id: number`, so scope resolver should use:

```typescript
const workspaceSourceId = `workspace:${workspace.id}`;
```

### 12.2 Trust gate

Do not duplicate workspace trust checks in `SlashCommandModule`.

Reason:

- The workspace watcher already passes snapshots through `applyWorkspaceSnapshot(snapshot, trust)`.
- If `trust.commands` is false, commands are never registered for that workspace source.

The scope resolver only decides which registered workspace source is eligible for this conversation.

### 12.3 Revocation

When workspace trust is revoked:

- `WorkspaceWatchManagerSingleton.revokeWorkspaceTrust()` sets trust false.
- It triggers a rescan.
- `applyWorkspaceSnapshot()` applies an empty command set for that workspace.
- Scoped list/dispatch no longer sees the commands.

No special slash-command code is required beyond scoped lookup.

## 13. IPC Contracts

### 13.1 SLASH_COMMAND_LIST

Existing schema:

```typescript
z.object({
  conversationId: z.string().optional(),
  query: z.string().optional(),
})
```

Keep this schema.

Response:

```typescript
{
  status: true,
  commands: SlashCommandView[],
  diagnostics: unknown[],
  msg: string
}
```

Guarantees:

- `commands[].body` is absent.
- `commands[].metadata` is absent.
- Workspace commands are scoped to `conversationId`.
- Missing `conversationId` means no workspace commands.

### 13.2 SLASH_COMMAND_DISPATCH

Existing schema:

```typescript
z.object({
  conversationId: z.string(),
  rawInput: z.string(),
})
```

Keep this schema.

Response remains:

```typescript
| { status: true; action: "submit_prompt"; prompt: string; commandId: string }
| { status: true; action: "show_result"; content: string; commandId: string }
| { status: false; msg: string }
```

Guarantees:

- Dispatch and list use the same scope resolver.
- A command hidden by workspace scope cannot be manually dispatched.
- Prompt commands still go through existing AI gate after renderer submission.

### 13.3 AI gate

Do not convert `slash-command-ipc.ts` to `registerAiValidatedHandler`.

Rationale:

- List/status/reload are metadata or local config operations.
- Local built-ins do not call AI.
- Prompt command dispatch returns text only.
- Actual AI work happens in `AI_CHAT_V2_STREAM`, where the provider-aware Chat V2 availability gate (`canUseChat()`) is already enforced first (hosted entitlement OR a valid local-provider config).

## 14. Security Invariants

### 14.1 No executable command runtime

The following imports and APIs must not appear in `SlashCommandDispatcher` or `expandPrompt`:

- `child_process`
- `spawn`
- `exec`
- `eval`
- `Function`
- dynamic import of plugin command files

### 14.2 Renderer-safe list response

`CommandRegistry.listScopedViews()` must use the same projection as `listViews()`:

```typescript
{
  id,
  name,
  description,
  aliases,
  source,
  sourceLabel,
  argumentHint,
  enabled,
}
```

It must omit:

- `body`
- `metadata`
- parsed frontmatter
- plugin manifest content
- file paths beyond stable ids/source labels

### 14.3 Database access

`SlashCommandScopeResolver` may call `WorkspaceModule`. It must not instantiate `WorkspaceModel` directly and must not import TypeORM.

`slash-command-ipc.ts` must remain a thin validation and module invocation layer.

### 14.4 Worker boundary

Workspace workers must continue returning drafts and snapshots only. They must not resolve conversation ids, query the database, or mutate command registries.

### 14.5 Plugin path safety

All manifest-declared command paths must go through `resolvePluginRelativePath()`.

Inline content never touches the filesystem. It is parsed as a virtual command body and then validated through the same prompt-command validator.

## 15. Diagnostics

### 15.1 Diagnostic owner

Use `AIFetchlyConfigDiagnostic` for command-source diagnostics because that is the existing diagnostic shape for local extensibility and plugin promotion.

For plugin commands:

```typescript
{
  severity: "warning",
  source: "plugin",
  sourceId: `plugin:${pluginName}`,
  filePath: relativeOrVirtualPath,
  code,
  message,
  recoverable: true
}
```

### 15.2 Diagnostic codes

Use existing codes where possible:

- `file-too-large`
- `frontmatter-unparseable`
- `frontmatter-invalid`
- `command-name-invalid`
- `command-description-missing`
- `scanner-io-error`
- `path-outside-plugin`
- `claude-frontmatter-invalid`
- `claude-format-unsupported-feature`

No database migration is needed for diagnostic codes.

### 15.3 Surfacing diagnostics

Phase 1:

- Preserve returned diagnostics from promotion tests.
- Log unexpected promotion failures.
- `/status` continues count-only behavior.

Phase 3:

- Plugin Detail can show command diagnostics.
- `/status` can include source-specific diagnostic counts.

## 16. File-Level Implementation Plan

### 16.1 Phase 1: Scoped MVP

Modify:

```text
src/entityTypes/slashCommandTypes.ts
src/service/slashCommands/CommandRegistry.ts
src/service/slashCommands/SlashCommandDispatcher.ts
src/modules/SlashCommandModule.ts
src/views/components/aiChatV2/AiChatV2.vue
src/views/components/aiChatV2/AiChatV2Composer.vue
src/main-process/communication/plugin-ipc.ts
```

Add:

```text
src/service/slashCommands/SlashCommandScopeResolver.ts
```

Tests:

```text
test/vitest/main/service/CommandRegistry.scoped.test.ts
test/vitest/main/service/SlashCommandScopeResolver.test.ts
test/vitest/main/service/SlashCommandDispatcher.scoped.test.ts
test/vitest/main/components/AiChatV2Composer.slashScope.test.ts
test/vitest/main/plugin-ipc.test.ts
```

### 16.2 Phase 2: Claude-compatible prompt commands

Modify:

```text
src/service/PluginComponentRegistryService.ts
src/service/pluginCompat/ClaudePluginAdapter.ts
src/entityTypes/pluginTypes.ts
```

Add:

```text
src/service/pluginCompat/PluginCommandSourceReader.ts
src/service/pluginCompat/ClaudeCommandDeclaration.ts
```

Tests:

```text
test/vitest/main/service/PluginCommandSourceReader.test.ts
test/vitest/main/service/PluginComponentRegistryService.promotion.test.ts
test/vitest/main/service/ClaudePluginAdapter.commands.test.ts
```

### 16.3 Phase 3: management polish

Likely files:

```text
src/views/components/plugins/PluginManager.vue
src/views/api/plugins.ts
src/entityTypes/pluginTypes.ts
src/views/lang/en.ts
src/views/lang/zh.ts
src/views/lang/es.ts
src/views/lang/fr.ts
src/views/lang/de.ts
src/views/lang/ja.ts
```

Only do this if the implementation adds visible command diagnostics or command counts to Plugin Manager.

## 17. Algorithms

### 17.1 Scoped winner selection

```typescript
function getByLookupNameScoped(
  lookupName: string,
  scope: CommandRegistryScope
): SlashCommandDefinition | null {
  let winner: { cmd: SlashCommandDefinition; matchRank: number } | null = null;

  for (const cmd of this.byId.values()) {
    if (!cmd.enabled) continue;
    if (!isAllowed(cmd, scope)) continue;

    const primaryMatch = cmd.name === lookupName;
    const aliasMatch = cmd.aliases.includes(lookupName);
    if (!primaryMatch && !aliasMatch) continue;

    const matchRank = primaryMatch ? 0 : 1;
    if (!winner) {
      winner = { cmd, matchRank };
      continue;
    }

    const sourceDelta = SOURCE_RANK[cmd.source] - SOURCE_RANK[winner.cmd.source];
    if (sourceDelta < 0) {
      winner = { cmd, matchRank };
      continue;
    }
    if (sourceDelta === 0 && matchRank < winner.matchRank) {
      winner = { cmd, matchRank };
    }
  }

  return winner ? { ...winner.cmd } : null;
}
```

### 17.2 Claude command draft normalization

```typescript
function normalizeClaudeCommandDraft(input): PromptCommandDraft {
  const parsed = parseRestrictedFrontmatter(input.content);
  const fm = parsed ? frontmatterRecord(parsed) : {};

  return {
    relativePath: input.relativePath,
    body: parsed ? parsed.body : input.content,
    frontmatter: {
      ...fm,
      name: stringOr(fm.name, input.fallbackName),
      description: stringOr(fm.description, input.fallbackDescription),
      type: "prompt",
      argumentHint: stringOr(fm.argumentHint, fm["argument-hint"]),
    },
  };
}
```

If `fm.type` exists and is not `prompt`, skip with unsupported diagnostic rather than forcing prompt.

### 17.3 Plugin command reader

```typescript
async function read(input): Promise<PluginCommandSourceReadResult> {
  const sourceMeta = {
    source: "plugin",
    sourceId: `plugin:${input.pluginName}`,
    sourceLabel: "Plugin",
    requiresTrust: false,
  };

  const drafts = [
    ...await readNativeCommandsDirectory(input.installPath),
    ...await readClaudeCommandsIfNeeded(input),
  ];

  const definitions = [];
  const diagnostics = [];

  for (const draft of drafts) {
    const result = buildPromptCommandDefinition(draft, sourceMeta);
    if (result.ok) definitions.push(result.definition);
    else diagnostics.push(result.diagnostic);
  }

  return { definitions, diagnostics };
}
```

Deduplication:

- If native `commands/review.md` and Claude manifest also point to the same file, dedupe by absolute file path or virtual path.
- If two different declarations produce the same command id, keep the first and emit a `frontmatter-invalid` duplicate diagnostic for later entries.

## 18. Test Plan

### 18.1 CommandRegistry scoped tests

Cases:

- no workspace scope excludes `workspace:*`
- workspace scope includes exactly that workspace source
- workspace A command excluded from workspace B scope
- built-in beats workspace/user/plugin
- workspace beats user/plugin only when workspace is in scope
- user beats plugin
- alias lookup follows same source precedence
- renderer-safe scoped views omit `body` and `metadata`

### 18.2 SlashCommandModule tests

Cases:

- `listCommands({ conversationId })` uses scope resolver
- query ranking happens after scope filtering
- missing conversation id lists non-workspace commands
- dispatch and list agree on winning command

### 18.3 Dispatcher tests

Cases:

- prompt command in wrong workspace returns unknown
- prompt command in correct workspace returns `submit_prompt`
- `/help` lists scoped commands only
- `/status`, `/clear`, `/reload-config` still work
- disabled scoped command returns disabled response

### 18.4 Renderer tests

Cases:

- `AiChatV2` passes `activeConversationId` to composer
- composer calls `listSlashCommands({ conversationId, query })`
- conversation id change refreshes slash suggestions when draft starts with `/`
- selecting a command still inserts `/<name> `

### 18.5 Plugin tests

Cases:

- native plugin `commands/*.md` still works
- disabled plugin reconciles commands to `[]`
- missing plugin install path reconciles commands to `[]`
- Claude `commands` string path registers command
- Claude `commands` array registers valid siblings when one path fails
- Claude object mapping with `source` registers command
- Claude object mapping with inline `content` registers command
- Claude object mapping with both `source` and `content` reports diagnostic
- path traversal is rejected
- oversized command file is skipped
- duplicate command id in same plugin emits diagnostic

### 18.6 IPC tests

Cases:

- `SLASH_COMMAND_LIST` accepts optional conversation id
- `SLASH_COMMAND_DISPATCH` requires conversation id
- malformed payloads rejected by zod schema
- list response excludes `body`
- plugin import/install path calls `PluginComponentRegistryService.applyLoadedPlugins()`

## 19. Migration And Compatibility

No database migration is required.

Existing command definitions remain valid:

- built-ins keep the same ids
- user command ids remain `user:command:<name>`
- workspace command ids remain `workspace:<workspaceId>:command:<name>`
- plugin command ids remain `plugin:<pluginName>:command:<name>`

Existing tests that call `registry.getByName()` can keep doing so for global registry behavior. New production paths should use scoped lookup.

Existing renderer API signatures remain compatible because `conversationId` is already optional for list and required for dispatch.

## 20. Rollout Plan

### 20.1 Phase 1 rollout

1. Implement scoped registry methods.
2. Implement `SlashCommandScopeResolver`.
3. Thread scope through module and dispatcher.
4. Pass `conversationId` to composer list calls.
5. Call plugin promotion after successful import/install.
6. Run focused tests.

### 20.2 Phase 2 rollout

1. Add command declaration types.
2. Add `PluginCommandSourceReader`.
3. Integrate reader into `PluginComponentRegistryService`.
4. Add Claude command tests.
5. Validate against one real Claude plugin command pack if available.

### 20.3 Phase 3 rollout

1. Add command diagnostics to plugin detail UI if needed.
2. Add i18n strings in all supported language files.
3. Add command counts to plugin summaries only if the UI needs them. This may require type changes but not a database migration if derived at load time.

## 21. Risks And Mitigations

### Risk: Workspace command leakage

Cause: Some code path continues using `registry.getByName()` or `registry.listViews()`.

Mitigation:

- Production slash list and dispatch must route through `SlashCommandModule`.
- Add tests where global registry contains workspace A command and conversation B cannot see or dispatch it.
- Consider lint/grep tests for `registry.getByName(` in slash dispatch code.

### Risk: Claude command compatibility is too strict

Cause: Existing AiFetchly prompt validator requires `name` and `type: prompt`, while Claude command files often derive name from filename and omit type.

Mitigation:

- Normalize Claude command drafts before validation.
- Supply fallback name, description, and type where safe.
- Skip only when metadata implies unsupported execution behavior.

### Risk: Plugin install succeeds but commands unavailable until reload

Cause: Import path clears caches but does not run promotion.

Mitigation:

- Add `applyLoadedPlugins()` after successful import/install IPC handlers.
- Test IPC install success calls promotion.

### Risk: DB reads on every slash keystroke

Cause: composer calls list after debounce and scope resolver reads workspace row.

Mitigation:

- Keep 120ms debounce.
- Add cache only if profiling shows visible cost.
- Scope cache to main process and invalidate on workspace approve/revoke.

### Risk: Prompt body leakage

Cause: New scoped list accidentally maps full definitions to renderer.

Mitigation:

- Reuse existing `toView()` projection.
- Add explicit tests that scoped list responses omit `body` and `metadata`.

## 22. Implementation Checklist

Phase 1:

- [ ] Add `SlashCommandScope` / registry scope types.
- [ ] Add `CommandRegistry.listScoped`.
- [ ] Add `CommandRegistry.listScopedViews`.
- [ ] Add `CommandRegistry.getByLookupNameScoped`.
- [ ] Add `SlashCommandScopeResolver`.
- [ ] Update `SlashCommandModule.listCommands`.
- [ ] Update `SlashCommandModule.dispatch`.
- [ ] Update `SlashCommandDispatcher.dispatch` signature.
- [ ] Update `/help` rendering to use scoped views.
- [ ] Pass `activeConversationId` into `AiChatV2Composer`.
- [ ] Pass `conversationId` into `listSlashCommands`.
- [ ] Refresh suggestions on conversation id change.
- [ ] Call `PluginComponentRegistryService.applyLoadedPlugins()` after successful plugin import/install.
- [ ] Add Phase 1 tests.

Phase 2:

- [ ] Add command declaration types.
- [ ] Add helper accessors for Claude opaque `commands`.
- [ ] Add `PluginCommandSourceReader`.
- [ ] Support native `commands/*.md` through the new reader.
- [ ] Support Claude `commands/` directory convention.
- [ ] Support Claude string/array/object path declarations.
- [ ] Support Claude inline content declarations.
- [ ] Normalize `argument-hint` to `argumentHint`.
- [ ] Supply Claude fallback `name`, `description`, and `type: prompt`.
- [ ] Add duplicate id diagnostics.
- [ ] Integrate reader into `PluginComponentRegistryService`.
- [ ] Add Phase 2 tests.

Phase 3:

- [ ] Add Plugin Manager command count if needed.
- [ ] Add Plugin Manager command diagnostics if needed.
- [ ] Add i18n updates for all UI text.
- [ ] Add `/status` diagnostic polish if needed.

## 23. Verification Commands

Run focused tests as they are added:

```bash
yarn testmain test/vitest/main/service/CommandRegistry.scoped.test.ts
yarn testmain test/vitest/main/service/SlashCommandDispatcher.scoped.test.ts
yarn testmain test/vitest/main/service/PluginCommandSourceReader.test.ts
yarn testmain test/vitest/main/service/PluginComponentRegistryService.promotion.test.ts
```

Run existing affected tests:

```bash
yarn testmain test/vitest/main/service/SlashCommandDispatcher.test.ts
yarn testmain test/vitest/main/service/workspaceWatch/WorkspaceWatchManager.commands.test.ts
yarn testmain test/vitest/main/plugin-ipc.test.ts
```

Run type checks before shipping implementation:

```bash
yarn vue-check
yarn tsc
```

`yarn tsc` is watch mode in this project, so use the project's CI/typecheck command if a non-watch variant exists when implementation starts.

