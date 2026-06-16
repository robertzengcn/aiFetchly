# AI Chat V2 Incomplete Tool Call Stream Debug Report

- Date: 2026-06-16
- Symptom: The app logged `finishReason=undefined parsedCalls=0 willContinue=false`, then emitted an IPC `complete` event with `fullContentLen=0`.
- Root cause: `AIChatQueryLoop` defaulted a missing final `finish_reason` to `"stop"` even when the stream had produced a `delta.tool_calls` field that could not be parsed into a complete tool call. That converted a malformed or truncated AI server stream into a successful empty assistant response.
- Fix: `OpenAIStreamAccumulator` now records whether any tool-call delta was observed. `AIChatQueryLoop` fails the turn when the stream ends after an unusable tool-call delta without `finish_reason: "tool_calls"`.
- Regression test: `test/vitest/main/service/AIChatQueryLoop.test.ts` covers the logged shape: assistant role, empty content, incomplete `tool_calls`, and no finish reason.
- Verification:
  - `yarn testmain test/vitest/main/service/AIChatQueryLoop.test.ts --run`
  - `yarn testmain test/vitest/main/service/OpenAIStreamAccumulator.test.ts --run`
  - `yarn testmain test/vitest/main/ipc/ai-chat-v2-ipc.test.ts --run`
  - `yarn tsc-result --pretty false`
- Status: DONE
