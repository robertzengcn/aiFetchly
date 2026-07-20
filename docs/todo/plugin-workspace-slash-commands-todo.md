# Plugin Workspace Slash Commands TODO

Source PRD: `docs/prd/plugin-workspace-slash-commands-prd.md`
Audit date: 2026-07-20

The scoped slash-command MVP and Claude-compatible prompt command loading are mostly implemented. This TODO tracks the remaining gaps found during the PRD implementation audit.

## 1. Persist And Expose Plugin Command Diagnostics

Status: Not finished

Problem:
- `PluginCommandSourceReader` returns diagnostics for invalid command files and unsupported Claude declarations.
- `PluginComponentRegistryService.promotePluginCommandsAndAgents()` collects those diagnostics, but `applyLoadedPlugins()` drops the returned value.
- Plugin detail/export diagnostics UI does not appear to show command-promotion diagnostics.

Tasks:
- Persist or cache plugin command diagnostics per plugin during promotion.
- Include command diagnostics in `PluginDiagnosticsService.buildBundle()` or the plugin detail diagnostics surface.
- Ensure invalid command files do not block valid sibling commands.
- Add tests that install/promote a plugin with one invalid command and verify diagnostics are visible through the chosen UI/API surface.

Acceptance:
- Invalid plugin command declarations are inspectable by users.
- Diagnostics include plugin name/source id, file path or inline declaration key, diagnostic code, and readable message.
- Existing promotion still succeeds for valid sibling commands.

## 2. Add Plugin Command Management Polish

Status: Not finished

Problem:
- The PRD Phase 3 asks for command count, optional command list, and better command diagnostics in plugin detail/status.
- Current plugin detail UI exposes skills, subagents, MCP servers, permissions, diagnostics, and manifest, but no command tab/count/list was found.

Tasks:
- Add command count to plugin summary/detail data if it is intended to be user-visible.
- Add an optional command list in plugin detail showing command name, description, aliases, argument hint, enabled state, and source id.
- Surface command diagnostics beside the command list where practical.
- Update all six language files for any new UI labels.
- Add component/API tests for command count/list rendering.

Acceptance:
- Users can inspect which slash commands a plugin contributes.
- Users can understand why invalid plugin command declarations were skipped.

## 3. Prevent Prompt Commands From Being Re-Dispatched When Expanded Prompt Starts With `/`

Status: Not finished

Problem:
- `AiChatV2.handleSlashCommandSubmission()` calls `onSend(result.prompt, [])` for `submit_prompt`.
- `onSend()` treats any no-file message whose trimmed text starts with `/` as a slash command.
- A valid prompt command whose expanded body begins with `/` can be intercepted as another slash command instead of being submitted to Chat V2 streaming.

Tasks:
- Add an internal send path or flag that submits expanded slash-command prompts directly to the normal Chat V2 stream flow.
- Preserve normal user-entered slash command interception.
- Add a component test where a prompt command expands to text beginning with `/` and verify it streams as a prompt, not as a second slash command.

Acceptance:
- Expanded prompt text is always submitted as chat content, regardless of its first character.
- Manual user input beginning with `/` still dispatches as a slash command.

## 4. Clarify AI Gate Semantics Against Local Provider Chat

Status: Needs decision

Problem:
- The PRD says prompt slash commands should still respect `USER_AI_ENABLED` through the existing Chat V2 stream handler.
- Current Chat V2 uses provider-aware `canUseChat()`: hosted chat checks hosted entitlement, while local-provider chat may be allowed without hosted `USER_AI_ENABLED`.
- This may be intentional after local AI provider support, but it differs from the PRD wording.

Tasks:
- Decide whether prompt slash commands should follow provider-aware Chat V2 availability or strict hosted `USER_AI_ENABLED`.
- If provider-aware behavior is intended, update the PRD/comment wording and tests to reflect that.
- If strict hosted gating is required, add a gate before streaming prompt slash-command expansions.

Acceptance:
- Product docs and implementation agree on whether local-provider chat can execute prompt slash commands when hosted AI is disabled.

## 5. Update Stale Slash IPC Comments

Status: Not finished

Problem:
- `slash-command-ipc.ts` comments reference old `ai-chat-v2-ipc.ts` line numbers and `USER_AI_ENABLED` wording.
- The current stream handler gates via `canUseChat()` before parsing.

Tasks:
- Update comments to reference provider-aware Chat V2 stream gating instead of stale line numbers.
- Keep comments aligned with the decision from TODO 4.

Acceptance:
- Slash command IPC comments describe the current gate accurately.

## Verification Checklist

- Run targeted main tests:
  `yarn vitest --config vite.main.config.mjs run test/vitest/main/service/CommandRegistry.scoped.test.ts test/vitest/main/service/SlashCommandDispatcher.scoped.test.ts test/vitest/main/service/SlashCommandScopeResolver.test.ts test/vitest/main/service/PluginCommandSourceReader.test.ts test/vitest/main/service/workspaceWatch/WorkspaceWatchManager.commands.test.ts test/vitest/main/service/AIFetchlyRuntimeRegistrySync.trust.test.ts test/vitest/main/ipc/slash-command-ipc.test.ts test/vitest/main/plugin-ipc.test.ts`
- Run targeted component tests:
  `yarn vitest --config test/vitest/main/components/vitest.config.mjs run test/vitest/main/components/AiChatV2Composer.slashScope.test.ts test/vitest/main/components/AiChatV2Composer.slashCommands.test.ts test/vitest/main/components/AiChatV2SlashSuggestions.test.ts test/vitest/main/components/AiChatV2.slashCommands.test.ts`
- Add new tests for diagnostics visibility and slash-prefixed prompt expansion before closing this TODO.
