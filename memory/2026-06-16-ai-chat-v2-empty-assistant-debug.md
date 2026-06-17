# AI Chat V2 Empty Assistant Debug Report

- Date: 2026-06-16
- Symptom: Sending a message renders only the assistant role label `AI` with no response content.
- Investigation: The renderer shows the role label for any assistant message, even when `content` is empty. That means the stream can complete with `fullContentLen=0`. Existing logs only showed the accumulator summary, not the actual server payload shape.
- Root cause hypothesis confirmed by tests: The OpenAI stream endpoint can return either legacy SSE payloads (`event: token` + `data: {"content": ...}`) or non-streaming-style choices (`choices[].message.content`). The previous parser passed those shapes through as OpenAI stream chunks without normalization, so the accumulator saw no `choices[].delta.content` and completed with empty content.
- Fix: Normalize OpenAI-route SSE payloads into stream chunks before the accumulator sees them. Supported shapes now include normal `choices[].delta.content`, legacy top-level/nested `content`, and non-streaming `choices[].message.content`.
- Diagnostics added:
  - Main process logs the first few OpenAI stream payload shapes and ignored payloads.
  - IPC logs token delta lengths and terminal `fullContentLen`.
  - Renderer API logs received token/terminal chunk lengths.
  - UI shows an explicit empty-response diagnostic instead of a blank assistant bubble if the stream still completes with no text.
- Verification:
  - `yarn -s vitest-puppeteer --run test/vitest/utilitycode/aiChatApi.test.ts` passed: 45 tests.
  - `yarn -s testmain --run test/vitest/main/service/AIChatContextAssembler.test.ts test/vitest/main/service/AIChatQueryEngine.test.ts test/vitest/main/ipc/ai-chat-v2-ipc.test.ts test/vitest/main/api/aiChatV2.test.ts` passed: 36 tests.
  - `yarn -s tsc-result` exited 0.
- Status: DONE
