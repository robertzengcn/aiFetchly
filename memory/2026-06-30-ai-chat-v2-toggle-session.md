# AI Chat V2 Toggle Session Reset

## Symptom

Closing and reopening the AI Chat V2 dock made the current chat disappear. The next message appeared to start a new chat session instead of continuing the previous active conversation.

## Root cause

`src/views/layout/layout.vue` rendered `<AiChatV2>` with `v-if="v2ChatPanelOpen"`. Closing the dock destroyed the component, which reset `AiChatV2.vue` local refs such as `activeConversationId` and `messages`. On reopen, `AiChatV2` mounted fresh and loaded only the conversation list, not the previously active conversation.

## Fix

Changed the V2 dock to keep `<AiChatV2>` mounted with `v-show="v2ChatPanelOpen"`. The dock open state still controls visibility and width, but the component instance and active conversation state survive toggles.

## Evidence

- Added regression coverage in `test/vitest/utilitycode/layoutChatDock.test.ts`.
- Verified the new test failed before the production change because the source still used `v-if`.
- Verified after the fix with:
  - `npx vitest --config vite.utilityCode.config.mjs test/vitest/utilitycode/layoutChatDock.test.ts --run`
  - `yarn tsc-result`

## Status

DONE
