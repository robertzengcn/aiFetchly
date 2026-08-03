# Subagent User Source Toggle Debug

Date: 2026-07-15

## Symptom

Agents imported from `~/.aifetchly` appeared on the Subagents page with source
`Built-in`. In the table, the enable switch was disabled because
`AgentManager.vue` disables switches for `source === "built-in"`.

## Root Cause

The Subagents management API used `AgentDefinitionModule.listAllForManagement()`,
which returned only persisted SQLite rows. The live local config stack scans
`~/.aifetchly` into `getAIFetchlyConfigManager().getAgentRegistry()`, the same
registry used by slash commands and AI chat context, but management and runtime
resolution did not merge that registry.

A secondary legacy-data issue made the UI more confusing: older or partial rows
can store the DB default `source = "built-in"` even for scoped IDs such as
`user:agent:*`, causing user-owned config agents to be mislabeled.

## Fix

- `AgentDefinitionModule` now merges persisted rows with the config manager's
  live agent registry for management and runtime listing.
- Persisted rows still override runtime definitions, so a user toggle remains
  durable.
- Toggling a runtime-only non-built-in agent now materializes it into SQLite
  with the requested enabled/disabled status.
- `AgentDefinition.model.ts` now infers source from scoped IDs and plugin
  ownership before trusting the stored/default source value.

## Verification

- `yarn tsc-result` passed.
- `yarn vitest run --config vite.main.config.mjs test/vitest/main/agentDefinitionManagement.test.ts`
  was attempted, but every test failed during SQLite initialization because
  `better-sqlite3.node` is currently compiled for Electron ABI 133 while the
  Vitest Node process requires ABI 127.
