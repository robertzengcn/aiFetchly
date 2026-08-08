# Plugin Subagent Management Live Retest Problems

Date: 2026-07-21

Related documents:
- `docs/prd/plugin-subagent-management-prd.md`
- `docs/prd/plugin-subagent-management-technical-design.md`
- `docs/test-manual/plugin-subagent-management.md`
- `docs/test-problem/plugin-subagent-management-problems-2026-07-19.md`

## Summary

After restarting the application, the live browser and dev bridge retest passed the previously blocked Subagents management paths:

- `http://localhost:5173/` was listening and rendered the app.
- Dev browser bridge was listening at `http://127.0.0.1:37621`.
- Bridge config loaded with allowed origin `http://localhost:5173`.
- Subagents route rendered at `#/systemsetting/subagents`.
- Manual agent bridge CRUD passed: list, create, get, toggle disabled, update, delete, final cleanup.
- Manual agent UI create passed, including ID slug auto-generation.
- Manual agent UI delete passed and removed the row from the database.
- Search, empty filtered state, source filters, status filters, and table toggle worked.
- Built-in table toggle is disabled and built-in agents show no edit/delete actions.

Remaining console observation:

- `http://localhost:5173/favicon.ico` returns 404. This did not block Subagents behavior.

## Problems

### 1. Built-in detail dialog exposes an enabled status switch

Severity: Medium

The built-in `agent-lead-researcher` row correctly has a disabled toggle in the Subagents table. However, clicking the built-in agent to open the detail dialog shows an enabled `Enabled` switch.

Observed behavior:

- Detail dialog switch is enabled for a built-in agent.
- Clicking it does not change the persisted built-in agent status, because backend rules still protect built-ins.
- The UI still suggests the built-in status is editable, which conflicts with the read-only/built-in management rules.

Evidence:

- `src/views/components/agents/AgentDetailPanel.vue:193` renders the detail-panel `v-switch` without a `:disabled` binding for built-in or read-only sources.
- Live probe showed `switchInfo.disabled === false` for `agent-lead-researcher` in the detail dialog.
- Backend response after click still showed `status: "active"`.

Impacted manual tests:

- TC-25: Cannot delete built-in agents
- TC-15: Agent detail panel - plugin agent/read-only behavior, by the same read-only pattern

Expected fix:

- Disable the detail-panel status switch when `source === "built-in"`.
- Consider also disabling it for read-only source types where direct status changes should not be presented.

### 2. Manual agent validation blocks save silently

Severity: Medium

The Add Subagent dialog prevents bad data from being saved, but it does not surface clear validation errors to the user.

Observed behavior:

- Empty Name / Description / System prompt: Save returns early with no visible error.
- Invalid output schema JSON: Save returns early with no visible error.
- Duplicate ID slug: the user remains in the dialog without a visible duplicate/unique ID error.

Evidence:

- `src/views/components/agents/AgentEditorDialog.vue:202` returns early when required fields are missing.
- `src/views/components/agents/AgentEditorDialog.vue:206` returns early when output schema JSON is invalid.
- The focused live probe compared validation/message text before and after Save; no new message appeared for empty required fields, invalid schema JSON, or duplicate ID.
- The invalid JSON case correctly did not create `user:codex-validation-invalid-json`, so the issue is UI feedback rather than data integrity.

Impacted manual tests:

- TC-20: Create manual agent - validation

Expected fix:

- Use `v-form` validation or explicit touched/error state so required-field messages render after Save.
- Show a visible error for invalid output schema JSON.
- Catch create/update errors, including duplicate ID, and display them in the dialog.

### 3. Plugin detail Subagents tab is incomplete versus PRD

Severity: Medium

The Plugin detail dialog includes a Subagents tab, but the tab does not match the PRD/manual test requirements.

Current columns:

- Agent
- Mode
- Tools
- Health
- Status

Missing expected UI:

- Description column
- Actions column
- View details action

Evidence:

- `src/views/components/plugins/PluginAgentsTab.vue:5` through `src/views/components/plugins/PluginAgentsTab.vue:9` define only Agent, Mode, Tools, Health, and Status headers.
- `src/views/components/plugins/PluginAgentsTab.vue:28` through `src/views/components/plugins/PluginAgentsTab.vue:36` renders only the status toggle as the row action.

Impacted manual tests:

- TC-41: Plugin detail shows Subagents tab
- TC-42: Plugin Subagents tab - actions

Expected fix:

- Add Description and Actions columns to `PluginAgentsTab.vue`.
- Add a View details action for plugin-owned agents.
- Do not add edit or delete actions for plugin-owned agents.

## Not Fully Live-Tested

Plugin install/detail with real plugin-owned agents was not live-tested in the browser during this pass because the running app had no installed plugins, and the dev browser bridge intentionally does not expose plugin import/install channels.

Coverage still exists from automated tests:

- `test/vitest/main/pluginAgentLifecycle.test.ts`
- `test/vitest/utilitycode/pluginAgentImportService.test.ts`
- `test/vitest/utilitycode/claudeAgentFormatAdapter.test.ts`
- `test/vitest/utilitycode/pluginManifestService.test.ts`

## Cleanup

All disposable QA agents created during the live retest were deleted. Final bridge list check showed no remaining `user:codex-*` smoke-test agents.
