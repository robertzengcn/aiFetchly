# DEBUG REPORT

- **Symptom:** Manual test `13.3 — Hook modifies tool input` appeared to run `shell_execute` with the original `{"command":"echo hello"}` instead of the hook-rewritten `{"command":"echo safe"}`.
- **Root cause:** AI Chat V2 emitted and persisted the `tool_call` event before running `PreToolUse`, so chat history always showed the model's original input. The permission-pause path also stored the original arguments, so a rewritten tool call could resume with stale input after user approval.
- **Fix:** Split tool execution into hook preparation and execution. For executable tools, AI Chat V2 now runs `PreToolUse` first, emits/persists the tool call with effective arguments, executes with the same effective arguments, and stores those arguments in pending permission state.
- **Evidence:** Added regressions for command-hook `updatedInput` execution and pending permission state.
- **Regression test:** `test/vitest/main/service/AIChatQueryLoop.test.ts`
- **Verification:** `npx vitest --config vite.main.config.mjs run test/vitest/main/service/AIChatQueryLoop.test.ts --reporter=dot` passed; `yarn tsc-result` passed.
- **Related:** The manual test originally said "callback hook", but the System Settings UI creates command hooks. The manual now describes a command-hook output shape.
- **Status:** DONE
