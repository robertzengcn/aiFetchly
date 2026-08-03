# Plugin And Workspace Slash Commands Remediation PRD

## Document Information

- **Status**: Proposed
- **Created**: 2026-07-22
- **Owner**: AiFetchly Desktop Engineering
- **Parent PRD**: `docs/prd/plugin-workspace-slash-commands-prd.md`

## Summary

The plugin/workspace slash command feature is mostly implemented, but the audit found several gaps that should be fixed before the feature is considered complete:

1. Slash command suggestions can show lower-priority shadowed commands even though dispatch resolves only the winning command.
2. Open slash suggestions do not refresh immediately after config/plugin/workspace command changes.
3. One Plugin Diagnostics UI string is hard-coded in English instead of using i18n.
4. A workspace watcher test has stale trust-flag expectations and currently fails.

## Problem 1: Suggestions Do Not Match Dispatch Precedence

### Current Behavior

`CommandRegistry.listScopedViews()` returns every command allowed by scope. If multiple allowed sources define the same command name or alias, suggestions can show multiple entries, while dispatch uses `getByLookupNameScoped()` and executes only the precedence winner.

Example:

- Built-in, user, and plugin all define `/review`.
- Suggestions may show all three entries.
- Dispatch runs only the highest-priority winner.

### Impact

- Violates the parent PRD requirement that suggestions and dispatch agree.
- Creates confusing UX because users may select a command that is not the one dispatch will resolve.
- Makes built-in unshadowability less clear in the UI.

### Required Fix

Add a scoped suggestion/listing path that filters to effective command winners by command lookup identity before returning renderer views.

Rules:

- Built-in wins over workspace, user, and plugin.
- Workspace wins over user and plugin only in that workspace scope.
- User wins over plugin.
- Plugin remains lowest priority.
- Aliases must follow the same precedence rules.
- Renderer list APIs must still omit `body` and `metadata`.

### Acceptance Criteria

- If built-in `/help` exists and a plugin defines `/help`, suggestions show only the built-in `/help`.
- If workspace `/review` and plugin `/review` both exist in a chat using that workspace, suggestions show only workspace `/review`.
- If the same chat has no workspace, suggestions show the user/plugin winner and never the out-of-scope workspace command.
- Manual dispatch resolves to the same command shown in suggestions.

## Problem 2: Suggestions Do Not Live-Refresh On Config Changes

### Current Behavior

`AiChatV2Composer` refreshes slash suggestions when:

- The draft changes.
- The active conversation changes while the draft starts with `/`.

It does not subscribe to `AIFETCHLY_CONFIG_CHANGED`. If a plugin is installed, disabled, reloaded, uninstalled, or a workspace command file changes while suggestions are open, the visible list can remain stale until the user types again or switches conversations.

### Impact

- Violates the parent PRD requirement that suggestions update after config reload, plugin reload/install/disable, and workspace config changes.
- Makes plugin install and workspace command editing appear inconsistent.

### Required Fix

Refresh open slash suggestions when relevant config-change events arrive.

Rules:

- Subscribe through the existing renderer API, not direct filesystem access.
- Refresh only when the current draft starts with `/`.
- Preserve stale-result generation guards so commands from a previous conversation cannot flash into the current chat.
- If a workspace-scoped event includes `workspaceId`, refresh only when it may affect the active conversation; otherwise refresh conservatively.

### Acceptance Criteria

- With `/` suggestions open, installing a plugin with `/review` makes `/review` appear without typing another character.
- With `/review` visible from a plugin, disabling that plugin removes it without typing another character.
- With `/` suggestions open in Workspace A, adding `.aifetchly/commands/review.md` makes `/review` appear only in Workspace A's conversation.
- Workspace B does not refresh into Workspace A's command list.

## Problem 3: Hard-Coded English Plugin Diagnostics Text

### Current Behavior

`PluginDiagnosticsTab.vue` renders `No diagnostics available.` directly in the template.

### Impact

- Violates the repository i18n rule requiring all user-facing UI text to use translations in all supported languages.
- Creates incomplete localization for Chinese, Spanish, French, German, and Japanese users.

### Required Fix

Move the string into the `plugins` translation group in all supported language files:

- `src/views/lang/en.ts`
- `src/views/lang/zh.ts`
- `src/views/lang/es.ts`
- `src/views/lang/fr.ts`
- `src/views/lang/de.ts`
- `src/views/lang/ja.ts`

### Acceptance Criteria

- `PluginDiagnosticsTab.vue` uses `t("plugins.no_diagnostics") || "No diagnostics available."`.
- All six language files define `plugins.no_diagnostics`.
- No new hard-coded user-facing strings are introduced.

## Problem 4: Stale Workspace Watcher Trust Test

### Current Behavior

`test/vitest/main/service/workspaceWatch/WorkspaceWatchManager.test.ts` expects approved workspace trust to produce:

```json
{
  "instructions": true,
  "commands": true,
  "agents": false,
  "hooks": false,
  "skills": false
}
```

Current production code returns all five capabilities as trusted for approved workspaces.

### Impact

- Focused workspace watcher tests fail.
- The failing test creates uncertainty about whether the all-capability trust behavior is intended.

### Required Fix

Align the test with the intended current trust model, or change production if the all-capability trust model is not intended.

Recommended direction:

- Keep production behavior as-is if the current workspace trust UX intentionally trusts all workspace AI config.
- Update the stale test expectation to all true.
- Add or update a test for revoked/untrusted workspace behavior to ensure commands are dropped when trust is false.

### Acceptance Criteria

- `WorkspaceWatchManager.test.ts` passes under `yarn vitest --config vite.main.config.mjs --run test/vitest/main/service/workspaceWatch/WorkspaceWatchManager.test.ts`.
- There is explicit test coverage for approved trust and revoked/untrusted trust.
- Test comments match the current trust model.

## Verification Plan

Run these commands after implementation:

```bash
yarn vitest --config vite.main.config.mjs --run \
  test/vitest/main/service/CommandRegistry.scoped.test.ts \
  test/vitest/main/service/SlashCommandDispatcher.scoped.test.ts \
  test/vitest/main/service/PluginCommandSourceReader.test.ts \
  test/vitest/main/service/PluginComponentRegistryService.promotion.test.ts \
  test/vitest/main/ipc/slash-command-ipc.test.ts \
  test/vitest/main/service/workspaceWatch/WorkspaceWatchManager.commands.test.ts \
  test/vitest/main/service/workspaceWatch/WorkspaceWatchManager.test.ts

yarn vitest --config test/vitest/main/components/vitest.config.mjs --run \
  test/vitest/main/components/AiChatV2Composer.slashScope.test.ts
```

## Out Of Scope

- Adding new slash command execution types.
- Adding per-command plugin toggles.
- Importing commands from `~/.claude`.
- Changing Chat V2 provider availability rules.
- Adding renderer filesystem access.
