# Plugin Subagent Management QA Problems

Date: 2026-07-19

Related documents:
- `docs/prd/plugin-subagent-management-prd.md`
- `docs/prd/plugin-subagent-management-technical-design.md`
- `docs/test-manual/plugin-subagent-management.md`

## Summary

Backend/runtime implementation is mostly working and covered by passing automated tests, but several UI and browser-mode requirements from the manual test suite are incomplete.

Verified passing:
- Parser/import/manifest tests: 24/24 passed.
- Agent management, runtime filtering, IPC, plugin lifecycle tests: 42/42 passed.
- `yarn tsc-result` passed.
- `vue-tsc --noEmit` passed.
- All six language files have matching `subagents` translation keys.

## Problems

### 1. Browser-mode manual subagent CRUD is blocked

Severity: High

The Subagents page renders in the browser at `http://localhost:5173`, but manual agent create/toggle/delete cannot complete through the dev browser bridge.

Observed bridge responses:
- `agent-definition:create`: `Channel 'agent-definition:create' is not on the dev browser bridge invoke allowlist.`
- `agent-definition:toggle`: `Channel 'agent-definition:toggle' is not on the dev browser bridge invoke allowlist.`
- `agent-definition:delete`: `Channel 'agent-definition:delete' is not on the dev browser bridge invoke allowlist.`

Evidence:
- `src/main-process/devtools/devBrowserChannels.ts` only allowlists `GET_APP_INFO`, `QUERY_USER_INFO`, and `GET_LOGIN_URL`.
- Electron preload does expose the agent management channels, so this appears limited to browser-mode testing/use.

Impacted manual tests:
- TC-19 through TC-24
- TC-26 through TC-28 when tested in browser mode
- TC-47 when tested through browser-managed data

### 2. Subagents table is missing required columns

Severity: Medium

The PRD/manual test requires columns:

Agent, Description, Source, Plugin, Mode, Tools, Model, Status, Actions

Current UI columns:

Agent, Description, Source, Mode, Tools, Status, Actions

Missing:
- Plugin
- Model

Evidence:
- `src/views/components/agents/AgentManager.vue`

Impacted manual tests:
- TC-14

### 3. "Has warnings" filter is not exposed

Severity: Medium

The manual suite requires a "Has warnings" filter. The component has internal support for `statusFilter === "warning"`, but the filter item is not present in the dropdown.

Evidence:
- `statusFilter` type includes `"warning"`.
- `statusFilterItems` only includes all/status, enabled, and disabled options.

Impacted manual tests:
- TC-12

### 4. Agent detail panel is missing required fields

Severity: Medium

The PRD/manual test requires the detail panel to show:

ID, Display name, Description, Source, Plugin owner, Component path, Status, Mode, Default model, Max tool calls, Max runtime, Max continue calls, Allowed tools, Output schema, System prompt, Warnings, Last updated

Current detail panel shows most core runtime fields, but does not visibly show:
- Output schema
- Warnings or last error details
- Last updated timestamp
- Created timestamp
- Explicit ID field label

Evidence:
- `src/views/components/agents/AgentDetailPanel.vue`

Impacted manual tests:
- TC-15
- TC-16

### 5. Direct Subagents route can blank in browser smoke test

Severity: Medium

Directly opening `http://localhost:5173/#/systemsetting/subagents` produced an empty body in the browser smoke test.

Navigating from `#/dashboard/home` to `#/systemsetting/subagents` rendered correctly.

Impacted manual tests:
- TC-11

## Notes

The backend/runtime behavior passed focused automated verification after rebuilding `better-sqlite3` for the current Node runtime with:

```bash
npm rebuild better-sqlite3 --build-from-source
```

The first test run failed because `better-sqlite3` was compiled for a different Node ABI. After rebuild, the DB-backed subagent suites passed.

## Retest After Fix

Date: 2026-07-19

Fix commit:
- `e4f20ea4 fix: enable browser subagent management QA`

Fixed:
- Browser bridge code now allowlists and dispatches `agent-definition:list`, `agent-definition:get`, `agent-definition:create`, `agent-definition:update`, `agent-definition:toggle`, and `agent-definition:delete`.
- Subagents table now includes the required Plugin and Model columns.
- Status filter now exposes the Has warnings option.
- Detail panel now shows explicit ID, display name, component path, output schema, warnings, created timestamp, and last updated timestamp.
- Direct route smoke for `http://localhost:5173/#/systemsetting/subagents` now renders the Subagents page, Add Subagent action, filters, and empty state.

Retest results:
- `yarn testmain --run test/vitest/main/devtools/devBrowserChannels.test.ts test/vitest/main/devtools/DevBrowserDispatcher.test.ts test/vitest/main/agent-definition-ipc.test.ts test/vitest/main/agentDefinitionManagement.test.ts test/vitest/main/agentRuntimeDefinitionList.test.ts`: 46/46 passed.
- `yarn tsc-result`: passed.
- `./node_modules/.bin/vue-tsc --noEmit`: passed.
- Translation parity check: all six language files have 57 `subagents` keys.

Remaining live-test note:
- The currently running Electron process was launched before the fix and still rejects `agent-definition:list` with the old allowlist. Restart Electron, then rerun browser CRUD smoke for TC-19 through TC-24 and TC-26 through TC-28.

## Retest After Electron Restart

Date: 2026-07-20

Result: passed.

Verified against restarted Electron process:
- Dev bridge config loaded from `http://127.0.0.1:37621` with allowed origin `http://localhost:5173`.
- Bridge CRUD smoke passed for disposable agent `user:codex-live-smoke-1784507790775`: list, create, get, toggle disabled, update enabled, list, delete, and final list cleanup.
- Browser UI create passed for disposable agent `user:codex-ui-smoke-1784507823630`: Add Subagent dialog saved successfully and the table rendered the new manual agent.
- Required table columns rendered: Agent, Description, Source, Plugin, Mode, Tools, Model, Status, Actions.
- Detail panel rendered required fields: ID, Display name, Output schema, Warnings, Last updated, and Created.
- Status filter exposed the Has warnings option.
- Browser UI delete passed: confirmation dialog deleted the disposable UI agent and the row disappeared.

Remaining observations:
- Browser console showed one `404 Not Found` resource error during page loads. It did not block Subagents route rendering or CRUD behavior.
