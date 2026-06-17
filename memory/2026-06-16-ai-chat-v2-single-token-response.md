# AI Chat V2 Single Token Response Debug Report

- Date: 2026-06-16
- Symptom: After sending a message, AI Chat V2 rendered only `AI` and stopped. Application logs showed `round 0 -> POST /chat/completions msgs=3 roles=[system,user,user] tools=38` followed by `finishReason=undefined`.
- Root cause: Two defects were present on the request/stream path. The current user message was saved before context assembly, then loaded from history and appended again, creating duplicate `user` messages. The OpenAI SSE parser only accepted `data: ` lines with a space, so valid `data:{...}` chunks after the first token could be skipped.
- Fix: Pass the saved user message id to `AIChatContextAssembler` and filter that exact row from recent history before appending the current user message. Parse OpenAI SSE lines with `data:` both with and without a space, including `data:[DONE]`.
- Regression tests:
  - `test/vitest/main/service/AIChatContextAssembler.test.ts` verifies the saved current user message is not duplicated.
  - `test/vitest/utilitycode/aiChatApi.test.ts` verifies OpenAI SSE `data:{...}` chunks stream completely.
- Verification:
  - `yarn -s testmain --run test/vitest/main/service/AIChatContextAssembler.test.ts test/vitest/main/service/AIChatQueryEngine.test.ts test/vitest/main/ipc/ai-chat-v2-ipc.test.ts test/vitest/main/api/aiChatV2.test.ts` passed: 36 tests.
  - `yarn -s vitest-puppeteer --run test/vitest/utilitycode/aiChatApi.test.ts` passed: 43 tests.
  - `yarn -s tsc-result` exited 0.
- Status: DONE
