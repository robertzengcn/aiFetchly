# DEBUG REPORT: Plugin Subagents Missing From AI Chat Discovery

- **Symptom:** A plugin-installed subagent (`cavecrew-builder` from the `caveman` plugin) appeared on the Subagents management page, but asking AI chat to list available agents omitted it.
- **Root cause:** Subagents management and runtime IPC use `AgentDefinitionModule.listActiveForRuntime()`, which merges persisted `AgentDefinitionEntity` rows with runtime definitions and filters plugin agents by enabled plugin. `AIChatContextAssembler` built the model-facing "Available AiFetchly agents" block from `AIFetchlyConfigManager.getAgentRegistry().list()` instead, so persisted plugin-owned agents were invisible to chat discovery.
- **Fix:** `AIChatContextAssembler` now builds the available-agent system message from `AgentDefinitionModule.listActiveForRuntime()`, matching the runtime IPC catalog. The call is inside the existing guarded injection block so catalog failures degrade to no injection rather than breaking chat.
- **Regression test:** `test/vitest/main/service/AIChatContextAssembler.aifetchly.test.ts` now covers a persisted plugin-style agent ID: `plugin:caveman:agent:cavecrew-builder`.
- **Evidence:** `yarn vitest run --config vite.main.config.mjs test/vitest/main/service/AIChatContextAssembler.aifetchly.test.ts` passed with 10 tests. The broader related set also passed: context assembler, workspace-memory assembler, query engine, auto-plan engine, and AI chat v2 IPC tests, 57 tests total.
- **Related:** The focused tests still log pre-existing native `better-sqlite3` warnings from unrelated unmocked workspace lookup paths under the local Node version, but those warnings did not affect the assertions.
- **Status:** DONE
