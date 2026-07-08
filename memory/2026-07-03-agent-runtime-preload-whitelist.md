# DEBUG REPORT

- **Symptom:** Clicking **Background Agents** in the AI Chat V2 header caused `AgentTaskListDialog` to log `listAgentTasks failed: Error: unknow error`.
- **Root cause:** `AGENT_TASK_LIST` and the other `agent-runtime:*` invoke channels were registered in the main process, but were missing from the preload `window.api.invoke` allowlist. The preload bridge returned `undefined`, and `windowInvoke` converted that into `"unknow error"` before the IPC handler could run.
- **Fix:** Added all agent-runtime invoke channels to `src/preload.ts`.
- **Evidence:** `test/vitest/main/preloadAgentRuntime.test.ts` failed before the fix with zero calls to mocked `ipcRenderer.invoke`; after the fix it passed and confirmed every agent-runtime channel forwards through the bridge.
- **Regression test:** `test/vitest/main/preloadAgentRuntime.test.ts`
- **Related:** `AgentTaskListDialog.vue` surfaced the previously swallowed bridge failure, which made this preload registration gap visible.
- **Status:** DONE
