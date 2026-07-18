# DEBUG REPORT

- **Symptom:** AI Chat V2 still showed a permission prompt for `shell_execute` after the user selected `Full access`.
- **Root cause:** The approval-mode selector did not persist local state when no `activeConversationId` existed, and `ChatV2StreamRequest` did not carry the selected approval mode. On the first turn of a new conversation, the main process created the conversation with the default `ask_for_approval`, so shell execution followed the normal permission-prompt path.
- **Fix:** Keep `toolApprovalMode` in renderer state before a conversation exists, send it with the stream request, validate it in IPC, and persist it immediately after `AIChatQueryEngine` resolves the final conversation id.
- **Evidence:** Added a regression test that sends a new conversation stream with `toolApprovalMode: "full_access"`, triggers `shell_execute`, and asserts `SkillExecutor.execute` receives `skipPermissionCheck: true` without a permission-prompt tool result.
- **Regression test:** `test/vitest/main/ipc/ai-chat-v2-ipc.test.ts`
- **Verification:** `npx vitest --config vite.main.config.mjs run test/vitest/main/ipc/ai-chat-v2-ipc.test.ts` passed; `yarn tsc-result` passed.
- **Related:** Existing IPC test logs still include mocked database/context warnings from unrelated memory/workspace services.
- **Status:** DONE
