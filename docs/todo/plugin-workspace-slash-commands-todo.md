# Plugin Workspace Slash Commands TODO

Source PRD: `docs/prd/plugin-workspace-slash-commands-prd.md`
Audit date: 2026-07-20
Completed: 2026-07-21

The scoped slash-command MVP and Claude-compatible prompt command loading are mostly implemented. This TODO tracked the remaining gaps found during the PRD implementation audit. **All five items are now resolved** (see per-section resolution notes; original audit Problem/Tasks/Acceptance retained as context).

## 1. Persist And Expose Plugin Command Diagnostics

Status: Done (commit `18ee4ecc`)

Resolution:
- Added `src/service/pluginCompat/PluginCommandDiagnosticsStore.ts` — an in-memory per-plugin diagnostics cache (commands have no DB row; the live registry is the truth).
- `promotePluginCommandsAndAgents` now writes each plugin's command+agent diagnostics to the store (and clears them for disabled/uninstalled/missing-install-path plugins).
- `PluginDiagnosticsService.buildBundle()` surfaces them as a new `commandDiagnostics` field with secret-redacted messages.
- Invalid command files do not block valid siblings (existing behavior; now also verified by the new store assertions).
- Tests: extended `PluginComponentRegistryService.promotion.test.ts` (valid sibling + invalid command/agent; disabled reconcile clears the store; immutable snapshots) and `pluginDiagnosticsService.test.ts` (command diagnostics appear redacted; empty when none).

Original audit notes:

Problem:
- `PluginCommandSourceReader` returns diagnostics for invalid command files and unsupported Claude declarations.
- `PluginComponentRegistryService.promotePluginCommandsAndAgents()` collects those diagnostics, but `applyLoadedPlugins()` drops the returned value.
- Plugin detail/export diagnostics UI does not appear to show command-promotion diagnostics.

Acceptance:
- Invalid plugin command declarations are inspectable by users.
- Diagnostics include plugin name/source id, file path or inline declaration key, diagnostic code, and readable message.
- Existing promotion still succeeds for valid sibling commands.

## 2. Add Plugin Command Management Polish

Status: Done (commit `469debd7`)

Resolution:
- `CommandRegistry.listBySource` / `listViewsBySource` project a single source's commands as renderer-safe views (body/metadata stripped — PRD §11.1/AC-9).
- `PLUGIN_GET` returns `commands[]` (name/description/aliases/argumentHint/enabled/sourceId); `PLUGIN_LIST` + the diagnostics bundle summary carry `commandCount`.
- New `PluginCommandsTab.vue` + a Commands tab in `PluginDetailPanel.vue`; the overview tab shows the command count.
- `PluginCommandView` types on the renderer api; `commandDiagnostics` field on the diagnostics bundle type.
- i18n keys added to all six language files (`tab_commands`, `command_count`, `no_commands`, `column_command`, `column_aliases`, `column_argument_hint`).
- Command diagnostics from TODO #1 surface in the Diagnostics tab (bundle JSON) beside the command list.
- Tests: `plugin-ipc.test.ts` (command list/count + renderer-safety — no body/metadata), new `PluginCommandsTab.test.ts` (render/empty/disabled row), and `commandCount` added to existing `PluginSummary` fixtures.

Original audit notes:

Problem:
- The PRD Phase 3 asks for command count, optional command list, and better command diagnostics in plugin detail/status.
- Current plugin detail UI exposes skills, subagents, MCP servers, permissions, diagnostics, and manifest, but no command tab/count/list was found.

Acceptance:
- Users can inspect which slash commands a plugin contributes.
- Users can understand why invalid plugin command declarations were skipped.

## 3. Prevent Prompt Commands From Being Re-Dispatched When Expanded Prompt Starts With `/`

Status: Done (commit `fa80e5fb`)

Resolution:
- `onSend` gained an internal `options?: { isExpandedPrompt?: boolean }` param; when set, the `text.trim().startsWith("/")` slash interception is skipped.
- `handleSlashCommandSubmission` submits expanded prompts via `onSend(result.prompt, [], { isExpandedPrompt: true })`, so a body beginning with `/` streams as chat content instead of re-dispatching.
- Manual `/` input (no flag) still dispatches as a slash command.
- Test: `AiChatV2.slashCommands.test.ts` — a prompt command expanding to `/...` calls `dispatchSlashCommand` exactly once and streams via `streamChatV2Message` (never re-dispatched).

Original audit notes:

Problem:
- `AiChatV2.handleSlashCommandSubmission()` calls `onSend(result.prompt, [])` for `submit_prompt`.
- `onSend()` treats any no-file message whose trimmed text starts with `/` as a slash command.
- A valid prompt command whose expanded body begins with `/` can be intercepted as another slash command instead of being submitted to Chat V2 streaming.

Acceptance:
- Expanded prompt text is always submitted as chat content, regardless of its first character.
- Manual user input beginning with `/` still dispatches as a slash command.

## 4. Clarify AI Gate Semantics Against Local Provider Chat

Status: Done (commit `858e06be`) — decision: **provider-aware**

Resolution:
- Decision: prompt slash commands follow provider-aware Chat V2 availability (`canUseChat()`), not strict hosted `USER_AI_ENABLED`. Local-provider users can run prompt slash commands without hosted entitlement. No new gate was added.
- Updated PRD §9.3, §11.3 (renamed "Chat V2 availability gate"), Goal #7, and AC-10, plus the technical-design doc (§3.1, §13), to describe provider-aware `canUseChat()` gating.

Original audit notes:

Problem:
- The PRD says prompt slash commands should still respect `USER_AI_ENABLED` through the existing Chat V2 stream handler.
- Current Chat V2 uses provider-aware `canUseChat()`: hosted chat checks hosted entitlement, while local-provider chat may be allowed without hosted `USER_AI_ENABLED`.
- This may be intentional after local AI provider support, but it differs from the PRD wording.

Acceptance:
- Product docs and implementation agree on whether local-provider chat can execute prompt slash commands when hosted AI is disabled.

## 5. Update Stale Slash IPC Comments

Status: Done (commit `858e06be`)

Resolution:
- `slash-command-ipc.ts` header + dispatch comment and the `SlashCommandDispatchResponse` doc in `slashCommandTypes.ts` now reference the provider-aware `canUseChat()` gate at the top of `handleStream` in `ai-chat-v2-ipc.ts` (the stale `handleStream lines 385-393` / `USER_AI_ENABLED` references are gone), aligned with the TODO #4 decision.

Original audit notes:

Problem:
- `slash-command-ipc.ts` comments reference old `ai-chat-v2-ipc.ts` line numbers and `USER_AI_ENABLED` wording.
- The current stream handler gates via `canUseChat()` before parsing.

Acceptance:
- Slash command IPC comments describe the current gate accurately.

## Verification Checklist

- Run targeted main tests:
  `yarn vitest --config vite.main.config.mjs run test/vitest/main/service/CommandRegistry.scoped.test.ts test/vitest/main/service/SlashCommandDispatcher.scoped.test.ts test/vitest/main/service/SlashCommandScopeResolver.test.ts test/vitest/main/service/PluginCommandSourceReader.test.ts test/vitest/main/service/PluginComponentRegistryService.promotion.test.ts test/vitest/main/service/workspaceWatch/WorkspaceWatchManager.commands.test.ts test/vitest/main/service/AIFetchlyRuntimeRegistrySync.trust.test.ts test/vitest/main/ipc/slash-command-ipc.test.ts test/vitest/main/plugin-ipc.test.ts`
- Run targeted component tests:
  `yarn vitest --config test/vitest/main/components/vitest.config.mjs run test/vitest/main/components/AiChatV2Composer.slashScope.test.ts test/vitest/main/components/AiChatV2Composer.slashCommands.test.ts test/vitest/main/components/AiChatV2SlashSuggestions.test.ts test/vitest/main/components/AiChatV2.slashCommands.test.ts test/vitest/main/components/PluginCommandsTab.test.ts`
- Run the diagnostics-service test (uses the real DB; needs better-sqlite3 rebuilt for Node):
  `yarn vitest --config vite.utilityCode.config.mjs run test/vitest/utilitycode/pluginDiagnosticsService.test.ts`
- New tests added by this work: `PluginCommandsTab.test.ts` (component), the diagnostics-visibility cases in `PluginComponentRegistryService.promotion.test.ts` + `pluginDiagnosticsService.test.ts`, the command list/count cases in `plugin-ipc.test.ts`, and the slash-prefixed prompt-expansion case in `AiChatV2.slashCommands.test.ts`. All green; full `tsc --noEmit` passes with 0 errors.
