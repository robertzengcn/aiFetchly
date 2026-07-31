# DEBUG REPORT

- **Symptom:** Changing AI Chat V2 tool approval mode logged `[AiChatV2] failed to save tool approval mode: Error: unknow error`.
- **Root cause:** `AI_CHAT_V2_GET_TOOL_APPROVAL_MODE` and `AI_CHAT_V2_SET_TOOL_APPROVAL_MODE` were registered in the main IPC layer and used by the renderer API, but were missing from the preload `window.api.invoke` allowlist. `window.api.invoke` returned `undefined`, so `windowInvoke` threw `"unknow error"` before the main handler ran. The same audit found `AI_CHAT_V2_COMPACT_CONVERSATION` missing from the same allowlist.
- **Fix:** Added compact conversation plus get/set tool approval mode constants to `src/preload.ts` imports and invoke allowlist.
- **Evidence:** `test/vitest/main/preloadAgentRuntime.test.ts` failed before the fix for all three AI Chat V2 channels with zero mocked `ipcRenderer.invoke` calls; after the fix, the same suite passed with 8/8 tests.
- **Regression test:** `test/vitest/main/preloadAgentRuntime.test.ts`
- **Related:** Same bridge allowlist pattern as `memory/2026-07-03-agent-runtime-preload-whitelist.md`.
- **Status:** DONE
