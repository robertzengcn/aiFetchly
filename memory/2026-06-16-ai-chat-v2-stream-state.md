# AI Chat V2 Stream State Debug Report

- Date: 2026-06-16
- Symptom: Sending an AI Chat V2 message could show no visible pending state or response, and the AI server log showed no request.
- Root cause: `streamChatV2Message()` registered listeners and sent the IPC message, but returned an already-resolved Promise instead of staying pending until a terminal stream event. Send/setup failures from the async `windowSend()` boundary could also become unhandled rejections. The component awaited that wrapper without a defensive catch, and immediate terminal errors were only stored in `streamError`; if no assistant message had been added, the user saw only their own message.
- Fix: `streamChatV2Message()` now resolves on complete, rejects on terminal/setup errors, and cleans up listeners. `AiChatV2.vue` yields once after setting streaming state so the typing indicator can render, catches stream failures, and renders immediate errors as an assistant message.
- Regression test: `test/vitest/main/api/aiChatV2.test.ts` covers pending-until-terminal behavior and send-failure rejection.
- Verification:
  - `yarn -s testmain --run test/vitest/main/ipc/ai-chat-v2-ipc.test.ts test/vitest/main/service/AIChatQueryEngine.test.ts test/vitest/main/api/aiChatV2.test.ts` passed: 31 tests.
  - `yarn -s tsc-result` exited 0.
- Commit: `6198ede fix: keep ai chat v2 stream state visible`
- Status: DONE
