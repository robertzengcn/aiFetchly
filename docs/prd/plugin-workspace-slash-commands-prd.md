# Plugin And Workspace Slash Commands - Product Requirements Document

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-07-16
- **Owner**: AiFetchly Desktop Engineering
- **Related docs**:
  - `docs/prd/plugin-workspace-slash-commands-technical-design.md`
  - `docs/prd/aifetchly-local-extensibility-prd.md`
  - `docs/prd/aifetchly-local-extensibility-technical-design.md`
  - `docs/prd/claude-code-plugin-compatibility-prd.md`
  - `docs/prd/claude-code-plugin-compatibility-tech-design.md`
  - `docs/prd/claude-code-plugin-compat-phase4-todo.md`
  - `docs/prd/plugin-marketplace-support-prd.md`
  - `memory/2026-07-16-plugin-slash-command-support-design.md`
  - `/home/robertzeng/project/github/claude-code/docs/slash-commands.md`
  - `src/views/components/aiChatV2/AiChatV2.vue`
  - `src/views/components/aiChatV2/AiChatV2Composer.vue`
  - `src/modules/SlashCommandModule.ts`
  - `src/service/slashCommands/CommandRegistry.ts`
  - `src/service/slashCommands/SlashCommandDispatcher.ts`
  - `src/service/PluginComponentRegistryService.ts`

## 1. Executive Summary

AiFetchly should support Claude-Code-style slash commands in AiChatV2 from three user-extensible sources:

1. Global user commands in `~/.aifetchly/commands`.
2. Workspace commands in `<workspace>/.aifetchly/commands`.
3. Installed plugin commands, including Claude-compatible plugin command declarations.

The product goal is simple: a user selects or approves a workspace, installs plugins if needed, types `/`, sees the commands that are valid for the current chat context, selects one, supplies arguments, and the command expands into a prompt submitted through the existing Chat V2 flow.

This is not a request to clone Claude Code's full command runtime. AiFetchly should initially support **prompt commands only**. Local imperative commands, JSX UI commands, shell interpolation, command-specific tool grants, and model-invoked command execution are explicitly out of scope for the first release because they widen the security surface and overlap with existing Skill, MCP, Hook, and Tool Approval systems.

## 2. Background

### 2.1 Current AiFetchly capabilities

AiFetchly already has most of the slash-command foundation:

- `AiChatV2Composer.vue` shows slash command suggestions.
- `AiChatV2.vue` dispatches slash-command submissions through `dispatchSlashCommand`.
- `SlashCommandModule` exposes list, dispatch, reload, and status operations.
- `CommandRegistry` stores command definitions and enforces source precedence.
- `SlashCommandDispatcher` parses raw slash input and returns either `show_result` or `submit_prompt`.
- `expandPrompt` supports `$ARGUMENTS` prompt substitution.
- `AIFetchlyConfigLoader` loads global user commands from `~/.aifetchly/commands/*.md`.
- `WorkspaceConfigScanner` and `WorkspaceWatchManager` load workspace commands from `<workspace>/.aifetchly/commands/*.md`.
- `AIFetchlyRuntimeRegistrySync.applyWorkspaceSnapshot()` trust-filters workspace commands before registration.
- `PluginComponentRegistryService.promotePluginCommandsAndAgents()` already promotes plugin `commands/*.md` into the command registry.

### 2.2 Current gaps

The feature is incomplete in three important ways:

1. **Workspace scoping gap**: command listing and dispatch do not consistently resolve commands through the active conversation workspace. Workspace commands can leak into chats that did not select that workspace if they are present in the shared runtime registry.
2. **Plugin install timing gap**: plugin commands depend on a plugin component promotion pass. After install, commands must become available immediately without requiring an app restart or a manual reload.
3. **Claude compatibility gap**: Claude plugin `commands` declarations are carried opaquely by the compatibility adapter. AiFetchly currently reads a physical `<plugin>/commands/*.md` directory, but does not support Claude's manifest-declared command formats.

### 2.3 Why now

AiFetchly has already invested in local extensibility, workspace trust, Claude plugin compatibility, plugin marketplaces, dynamic agents, and AiChatV2 slash UI. Closing this gap turns those pieces into a coherent user workflow and makes plugin command packs useful in the chat UI.

## 3. Problem Statement

Users and plugin authors need reusable, discoverable, context-aware chat commands. Today, command behavior is partially implemented but not yet complete enough to trust as a product feature.

Without this work:

- Plugin authors cannot rely on `commands/` or Claude `commands` declarations becoming useful after install.
- Users cannot confidently type `/` and see only commands relevant to the selected workspace.
- Workspace commands may be resolved outside their intended workspace context.
- Installed plugin commands may require reload behavior that feels broken.
- AiFetchly cannot claim meaningful Claude slash-command compatibility even though the lower-level plugin compatibility exists.

## 4. Goals

1. Let users type `/` in AiChatV2 and see relevant slash commands.
2. Scope workspace commands to chats whose active approved workspace matches the command source.
3. Keep built-in, user, plugin, and workspace commands in one coherent registry model.
4. Make plugin commands available immediately after plugin install, enable, disable, reload, or uninstall.
5. Support plugin commands from both native AiFetchly plugin folders and Claude-compatible plugin command declarations.
6. Support prompt-only command execution through the existing `AI_CHAT_V2_STREAM` flow.
7. Preserve existing Chat V2 availability gating by ensuring command prompt submissions flow through the existing Chat V2 stream handler (provider-aware: hosted entitlement or a valid local-provider config).
8. Preserve existing workspace trust behavior before enabling workspace commands.
9. Preserve the existing plugin, workspace, and database architecture boundaries.
10. Provide clear diagnostics for invalid command files or unsupported command declarations.
11. Update all user-facing UI strings in English, Chinese, Spanish, French, German, and Japanese when implementation adds or modifies UI text.

## 5. Non-Goals

The first release will not include:

- Claude `local` commands.
- Claude `local-jsx` commands.
- Shell interpolation inside command markdown.
- Running command-defined shell scripts.
- Command-specific automatic tool grants.
- Model-invoked slash commands.
- Per-command model override or effort override.
- Command hooks.
- Command usage analytics beyond existing app telemetry patterns.
- Importing commands from `~/.claude` automatically.
- Copying plugin commands into workspace folders.
- Renderer-side filesystem access.
- Worker-side database access.
- Replacing Skill, MCP, Hook, Agent, or Tool Approval systems.

## 6. Target Users

### 6.1 Marketing Operator

Uses AiChatV2 daily and wants commands such as `/lead-research`, `/write-email`, `/campaign-review`, and `/summarize-thread` to be discoverable and reusable.

### 6.2 Workspace User

Works in multiple projects and expects each chat to expose only the commands from its selected workspace. A `/release-note` command from Workspace A should not appear in Workspace B.

### 6.3 Plugin Author

Publishes AiFetchly or Claude-compatible plugins with `commands/` markdown files and expects those commands to appear after installation.

### 6.4 Power User

Maintains global personal commands in `~/.aifetchly/commands` and expects them to work across all chats unless shadowed by a higher-priority built-in or workspace command.

### 6.5 Security-Conscious User

Wants workspace-provided commands to be gated by workspace trust, wants invalid command files to produce diagnostics, and does not want prompt bodies leaked to the renderer.

## 7. Command Sources And Precedence

### 7.1 Sources

AiFetchly supports four slash command source categories:

| Source | Example sourceId | Scope | Trust model |
|---|---|---|---|
| Built-in | `built-in` | All chats | Always available |
| Workspace | `workspace:<workspaceId>` | Chats using that approved workspace | Requires workspace command trust |
| User | `user` | All chats | User-owned, trusted |
| Plugin | `plugin:<pluginName>` | All chats when plugin is enabled | Plugin install/enable trust |

### 7.2 Precedence

When multiple sources define the same command name, the winner is:

```text
built-in > workspace > user > plugin
```

Requirements:

- Built-ins cannot be shadowed.
- Workspace commands may shadow user and plugin commands, but only inside chats for that workspace.
- User commands may shadow plugin commands.
- Plugin commands have the lowest default precedence.
- Disabled or untrusted commands do not participate in command resolution.

### 7.3 Aliases

Aliases are supported for command lookup and suggestions.

Requirements:

- An alias follows the same precedence rules as a primary name.
- A command cannot use an alias to shadow a built-in command.
- Invalid aliases produce diagnostics and do not register.
- If an alias collides with another command name, the same source precedence rules decide the winner.

## 8. Supported Command Formats

### 8.1 AiFetchly command markdown

Global, workspace, and native plugin commands use markdown with restricted YAML frontmatter:

```markdown
---
name: review
description: Review the current workspace changes
type: prompt
argumentHint: [scope]
aliases:
  - code-review
---

Review the current workspace changes.

Focus on: $ARGUMENTS
```

Required fields:

- `name`
- `description`
- `type: prompt`
- non-empty body

Optional fields:

- `argumentHint`
- `aliases`

### 8.2 Claude plugin commands

Claude-compatible plugin commands may be declared by:

1. Convention-based `commands/` directory at plugin root.
2. Manifest `commands` as a single path string.
3. Manifest `commands` as an array of paths.
4. Manifest `commands` as an object mapping.
5. Manifest object entries with inline `content`.

AiFetchly must support these declarations by converting them into internal `SlashCommandDefinition` objects with `type: "prompt"`.

Unsupported Claude fields should be ignored with diagnostics rather than causing the whole plugin to fail, unless the unsupported field creates a security issue.

### 8.3 Command naming for plugins

Plugin commands should support both ergonomic short names and stable source identity.

Requirements:

- The command definition id remains source-scoped: `plugin:<pluginName>:command:<name>`.
- The visible command name may be the frontmatter name for short command entry.
- If two plugins define the same command name, the first registered plugin may win short-name lookup, but both command definitions remain inspectable by id.
- A future namespaced display form such as `/plugin-name:command` should remain possible without schema migration.

## 9. User Experience Requirements

### 9.1 Slash suggestions

As a user, when I type `/` in AiChatV2, I see available commands for the current chat context.

Acceptance criteria:

- Suggestions include built-in commands.
- Suggestions include global user commands.
- Suggestions include enabled plugin commands.
- Suggestions include workspace commands only when the active chat has that approved workspace.
- Suggestions exclude workspace commands from other workspaces.
- Suggestions exclude disabled plugin commands.
- Suggestions exclude untrusted workspace commands.
- Suggestions show command name, argument hint, description, and source badge.
- Suggestions never expose raw prompt bodies or arbitrary metadata to the renderer.
- Suggestions update after config reload, plugin reload, plugin install, plugin disable, and workspace config change.

### 9.2 Command selection

As a user, when I select a suggested command, the composer is populated with the command name and a trailing space.

Acceptance criteria:

- Selecting `/review` inserts `/review `.
- The user can add arguments after the command.
- Enter dispatches the command.
- If the command needs arguments, the argument hint is visible in suggestions.
- If no command matches, the suggestions list shows the existing empty state.

### 9.3 Command dispatch

As a user, when I submit a slash command, AiFetchly resolves and executes the command in the current conversation context.

Acceptance criteria:

- Dispatch receives `conversationId`.
- Dispatch resolves workspace scope from `conversationId` in the main process.
- Dispatch does not trust renderer-provided workspace paths.
- Unknown commands produce a readable local result.
- Disabled commands produce a readable local result.
- Prompt commands expand to prompt text and are submitted through the existing Chat V2 streaming path.
- Built-in local commands continue to return `show_result`.
- `/clear` continues to clear the active conversation through existing clear logic.
- Prompt submissions respect the provider-aware Chat V2 availability gate (`canUseChat()`) because they use the existing Chat V2 stream IPC handler: hosted chat requires hosted entitlement, local-provider chat requires a valid local-provider config. Prompt slash commands are not gated by a stricter hosted-only `USER_AI_ENABLED` check.

### 9.4 Plugin install experience

As a user, after installing a plugin that provides commands, I can immediately use those commands.

Acceptance criteria:

- Native plugin `commands/*.md` files are promoted after install.
- Claude plugin commands declarations are promoted after install.
- Plugin disable removes that plugin's commands from suggestions and dispatch.
- Plugin re-enable restores valid commands.
- Plugin uninstall removes commands from suggestions and dispatch.
- Plugin reload refreshes command definitions.
- Invalid command files produce plugin diagnostics without blocking unrelated plugin components.

### 9.5 Workspace command experience

As a user, after selecting an approved workspace, commands from `<workspace>/.aifetchly/commands` become available in that chat only.

Acceptance criteria:

- Workspace command files are auto-scanned by the existing workspace watcher.
- Workspace commands require workspace trust for commands.
- A command added to Workspace A appears only in conversations using Workspace A.
- The same command does not appear in a conversation with no workspace.
- The same command does not appear in a conversation using Workspace B.
- Revoking workspace trust removes workspace commands from suggestions and dispatch.
- Workspace command changes are reflected without app restart.

## 10. Functional Requirements

### FR-1: Conversation-aware command listing

`SLASH_COMMAND_LIST` must accept `conversationId` and return commands scoped to that conversation.

Rules:

- If `conversationId` is absent, return only non-workspace commands.
- If `conversationId` has no approved workspace, return only non-workspace commands.
- If `conversationId` has an approved workspace, include commands from `workspace:<workspaceId>`.
- Do not include commands from any other workspace source.

### FR-2: Conversation-aware command dispatch

`SLASH_COMMAND_DISPATCH` must resolve command names against the same scoped command set used by listing.

Rules:

- Suggestions and dispatch must agree on which command wins.
- A workspace command cannot be dispatched from the wrong workspace by manually typing its name.
- A command hidden from suggestions because of scope must also be unavailable to dispatch.

### FR-3: Command registry scoped lookup

The command system must provide scoped list and lookup behavior without duplicating command definitions.

Rules:

- The shared registry may continue storing all commands.
- Scoped access should filter by allowed `sourceId`s before precedence resolution.
- Built-in, user, and plugin sources are always allowed unless disabled.
- Exactly one workspace source is allowed at a time, derived from `conversationId`.

### FR-4: Plugin command promotion

Installed plugins must promote commands into `CommandRegistry`.

Rules:

- Enabled plugins register valid command definitions under `plugin:<pluginName>`.
- Disabled plugins reconcile their source to an empty command set.
- Missing plugin install paths reconcile their source to an empty command set.
- Invalid command files produce diagnostics and are skipped.
- Valid sibling command files still register when another command file is invalid.

### FR-5: Claude command declaration support

Claude-compatible plugin commands must be supported at the prompt-command level.

Rules:

- `commands/` directory auto-detection is supported.
- Manifest string path is supported.
- Manifest path array is supported.
- Manifest object mapping is supported.
- Inline `content` entries are supported when they produce a valid prompt command.
- Object entries with both `source` and `content` are invalid and produce diagnostics.
- Paths must stay inside the plugin root.
- Large files must be skipped with diagnostics.
- Unsupported command metadata must not block valid prompt command loading.

### FR-6: Prompt expansion

Prompt command bodies are expanded with existing `$ARGUMENTS` behavior.

Rules:

- `$ARGUMENTS` is replaced with raw args after the command name.
- If no `$ARGUMENTS` token exists and args are present, args are appended after a blank line.
- Empty args do not add extra text.
- Expansion is text-only.
- Expansion does not execute shell, JavaScript, TypeScript, or template code.

### FR-7: Built-in commands remain available

Existing built-ins must keep working:

- `/help`
- `/clear`
- `/status`
- `/agents`
- `/reload-config`

Rules:

- Built-ins cannot be shadowed.
- Built-ins are available in every chat.
- Built-ins do not require workspace selection.

### FR-8: Diagnostics

Invalid command sources must produce diagnostics.

Diagnostic examples:

- malformed frontmatter
- missing `name`
- invalid command name
- missing `description`
- missing `type: prompt`
- empty body
- oversized markdown file
- path outside plugin root
- manifest object entry with both `source` and `content`
- unsupported Claude local command behavior

Diagnostics should be visible through existing status/plugin detail surfaces where practical.

## 11. Security And Trust Requirements

### 11.1 Renderer boundary

The renderer must not read command files directly.

Requirements:

- Renderer receives only `SlashCommandView`.
- Renderer never receives raw prompt bodies during suggestions.
- Renderer never receives arbitrary command metadata during suggestions.
- File parsing happens in main process or existing scanner workers.

### 11.2 Workspace trust

Workspace commands are untrusted until workspace trust permits commands.

Requirements:

- Workspace snapshots pass through `applyWorkspaceSnapshot`.
- If `trust.commands` is false, workspace commands are dropped before registry mutation.
- Revoking trust removes workspace commands without requiring restart.

### 11.3 Chat V2 availability gate

Prompt command dispatch must not bypass Chat V2 availability checks.

Requirements:

- `SLASH_COMMAND_DISPATCH` may return `submit_prompt`.
- The renderer submits that prompt through existing Chat V2 streaming APIs.
- The stream handler continues enforcing the provider-aware Chat V2 availability gate (`canUseChat()`) before doing AI work: hosted chat requires hosted entitlement, local-provider chat requires a valid local-provider config. Prompt slash commands follow whatever chat availability the user has; they are not gated by a stricter hosted-only `USER_AI_ENABLED` check (decision: provider-aware).
- The slash-command IPC handler should not duplicate Chat V2 gating unless the architecture changes.

### 11.4 Plugin safety

Plugin command loading must not execute plugin code.

Requirements:

- Reading command markdown is allowed.
- Parsing restricted frontmatter is allowed.
- Prompt expansion is text-only.
- No command shell execution.
- No `eval`, dynamic function creation, subprocess spawning, or arbitrary script execution in command dispatch.
- Path traversal must be blocked for all plugin command paths.

### 11.5 Worker and database boundary

Worker processes must not access the database.

Requirements:

- Workspace scanner workers produce file snapshots and command drafts only.
- Main process converts drafts and mutates registries.
- Any database reads required to resolve `conversationId -> workspace` happen through Module/Model layers in the main process.

## 12. Architecture Constraints

The implementation must follow existing AiFetchly architecture rules:

- IPC handlers validate input and call Modules/Services.
- IPC handlers do not access TypeORM repositories directly.
- Database reads use Model/Module layers.
- Workspace resolution uses `WorkspaceModule` or an equivalent Module-owned resolver.
- Runtime registry mutation stays in main process.
- Plugin install persistence stays in existing plugin Module/Model layers.
- User-facing UI text must use i18n in all supported language files.

## 13. Success Metrics

### Product success

- A user can install a plugin with prompt commands and use one immediately in AiChatV2.
- A user can add a workspace command file and see it only in chats using that workspace.
- A user typing `/` in a workspace chat sees no commands from unrelated workspaces.
- Users do not need to restart AiFetchly after plugin install or workspace command changes.

### Quality success

- Unit tests cover command scoping, dispatch scoping, plugin promotion, Claude command declarations, and workspace trust filtering.
- Existing slash command tests continue to pass.
- No raw prompt bodies are returned by list APIs.
- No direct database access is introduced in IPC handlers.
- No worker database access is introduced.

## 14. Acceptance Criteria

### AC-1: Scoped suggestions

Given:

- Workspace A defines `.aifetchly/commands/review.md`.
- Workspace B has no `review` command.
- Conversation A uses Workspace A.
- Conversation B uses Workspace B.

When:

- The user types `/rev` in Conversation A.

Then:

- `/review` appears.

When:

- The user types `/rev` in Conversation B.

Then:

- Workspace A's `/review` does not appear.

### AC-2: Scoped dispatch

Given the same setup as AC-1.

When:

- The user manually types `/review` in Conversation B.

Then:

- Dispatch returns an unknown or unavailable command result.
- The Workspace A command body is not expanded.
- No AI request is submitted for the Workspace A command.

### AC-3: Plugin command after install

Given:

- A plugin contains `commands/review.md`.

When:

- The user installs the plugin successfully.

Then:

- `/review` is available in AiChatV2 suggestions without app restart.
- Dispatch expands the plugin prompt when no higher-precedence command wins.

### AC-4: Plugin disable removes commands

Given:

- A plugin provides `/review`.

When:

- The user disables the plugin.

Then:

- `/review` from that plugin is removed from suggestions.
- Manual dispatch no longer resolves to that plugin command.

### AC-5: Claude manifest command path

Given:

- A Claude plugin manifest declares `"commands": "./commands/review.md"`.

When:

- The plugin is installed.

Then:

- The command is parsed, validated, and registered as a plugin prompt command.

### AC-6: Claude inline command content

Given:

- A Claude plugin manifest declares:

```json
{
  "commands": {
    "review": {
      "description": "Review current changes",
      "content": "---\nname: review\ndescription: Review current changes\ntype: prompt\n---\nReview $ARGUMENTS\n"
    }
  }
}
```

When:

- The plugin is installed.

Then:

- `/review` is available as a plugin prompt command.

### AC-7: Built-in precedence

Given:

- A plugin defines a command named `help`.
- A workspace defines a command named `help`.

When:

- The user dispatches `/help`.

Then:

- The built-in help command wins.

### AC-8: Workspace shadows plugin in the same chat

Given:

- A plugin defines `/review`.
- The active workspace also defines `/review`.

When:

- The user dispatches `/review` in a chat using that workspace.

Then:

- The workspace command wins.

When:

- The user dispatches `/review` in a chat with no workspace.

Then:

- The plugin command wins, unless a user command shadows it.

### AC-9: Prompt body privacy

When:

- The renderer calls `SLASH_COMMAND_LIST`.

Then:

- The returned command entries do not include `body`.
- The returned command entries do not include arbitrary raw `metadata`.

### AC-10: Chat availability gate preservation

Given:

- Chat V2 is unavailable for the user (no hosted entitlement AND no valid local-provider config).

When:

- The user dispatches a prompt slash command.

Then:

- Slash dispatch may return `submit_prompt`.
- The subsequent Chat V2 stream request is rejected by the existing provider-aware availability gate (`canUseChat()`) before AI work begins.

Note: when only hosted AI is disabled but a valid local provider is configured, prompt slash commands remain available because the Chat V2 stream accepts local-provider chat (decision: provider-aware).

## 15. Phased Delivery

### Phase 1: Scoped MVP

Scope:

- Conversation-aware command listing.
- Conversation-aware command dispatch.
- `AiChatV2Composer` receives active `conversationId`.
- Plugin command promotion runs after plugin install/reload/enable/disable/uninstall.
- Existing AiFetchly command format only.

Exit criteria:

- Workspace commands cannot leak across chats.
- Plugin `commands/*.md` work immediately after install.
- Existing built-ins and global user commands still work.

### Phase 2: Claude-Compatible Prompt Commands

Scope:

- Claude `commands/` auto-detection.
- Claude manifest string/array/object command declarations.
- Claude inline command content.
- Plugin diagnostics for invalid command declarations.

Exit criteria:

- Real Claude plugins with prompt command declarations can be installed and used without modifying plugin source files.

### Phase 3: Command Management Polish

Scope:

- Plugin detail shows command count and command diagnostics.
- Optional command list in Plugin Manager detail.
- Better `/status` command diagnostics.
- Optional namespaced command display for plugin collisions.

Exit criteria:

- Users can inspect which commands each plugin contributes and why invalid commands were skipped.

## 16. Test Requirements

### Unit tests

- `CommandRegistry` scoped list/lookup behavior.
- `SlashCommandModule.listCommands` with and without workspace.
- `SlashCommandDispatcher.dispatch` with scoped command resolution.
- Workspace command cannot dispatch from wrong conversation.
- Plugin promotion registers valid commands and removes disabled plugin commands.
- Claude command declaration parser handles string, array, object mapping, and inline content.
- Invalid Claude command declarations produce diagnostics.
- Built-in precedence remains unchanged.

### IPC tests

- `SLASH_COMMAND_LIST` accepts optional `conversationId`.
- `SLASH_COMMAND_DISPATCH` requires `conversationId`.
- Malformed payloads are rejected by schema validation.
- List response never includes raw prompt bodies.

### Component tests

- `AiChatV2Composer` calls `listSlashCommands` with active `conversationId`.
- Switching conversations refreshes suggestion scope.
- Selecting a command still inserts `/<name> `.

### Integration tests

- Install a plugin with `commands/review.md`, then list commands.
- Disable plugin, then list commands.
- Approve workspace with `.aifetchly/commands/review.md`, list in matching conversation, list in non-matching conversation.
- Revoke workspace trust, then verify command removal.

## 17. Open Questions

1. Should plugin command collisions be surfaced as diagnostics, or is source precedence plus optional future namespace enough?
2. Should Plugin Manager expose a command toggle per plugin command, or only plugin-level enable/disable in the first release?
3. Should `/help` list only currently scoped commands or all commands with disabled/unavailable badges? Recommended: only currently scoped commands for MVP.
4. Should user commands be able to shadow plugin commands globally? Current precedence says yes.
5. Should workspace command trust become per-capability in the UI, or continue using the existing workspace trust UX? Recommended: reuse existing trust UX for MVP.

## 18. Future Considerations

- Namespaced command invocation such as `/plugin-name:review`.
- Model-invoked command discovery after a separate permission model is defined.
- Command-specific model preferences.
- Command usage recency ranking.
- Import command packs from `~/.claude` as an explicit user action.
- Local imperative commands implemented as approved AiFetchly skills rather than raw command execution.
- Command marketplace metadata and preview before install.
