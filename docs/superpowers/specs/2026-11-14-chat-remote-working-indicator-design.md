# Chat UI Remote Working Indicator and Empty Bubble Suppression — Design

Date: 2026-11-14
Status: Proposed — awaiting approval

## Intent and Why

When a user submits a prompt to the LLM, the chat UI currently renders an empty assistant response bubble immediately containing a circular spinner and `"Generating…"`. This premature bubble clutters the message thread before the LLM has produced any tokens or reasoning.

Instead, the chat UI should show a clean animated loading/working indicator at the bottom-left of the transcript (where the assistant response will appear) as soon as the user sends a message. The loading/working indicator must stay visible as long as the remote is working (generating text, reasoning, or executing tools). The assistant response bubble should only materialize once actual content or reasoning tokens or tool calls arrive, without showing a redundant `"Generating…"` bubble indicator.

## Goals

1. **Suppress empty AI response bubble with "Generating…":** Do not render an empty assistant bubble when a turn starts or while waiting for the first tokens.
2. **Persistent loading/working indicator at the bottom-left of the transcript:** Show a clear, animated loading/working indicator at the bottom-left of the message list (in both `AiChatWorkspaceTranscript.vue` and `AiChatV2Messages.vue`) whenever the remote is actively working.
3. **Always show while remote is working:** The indicator remains visible throughout the entire remote turn (initial generation, token streaming, and between tool execution rounds) until the turn transitions to a terminal state (`idle`, `error`, `cancelled`, or parked for user permission/input).
4. **Clean bubble rendering when content arrives:** Once assistant text/reasoning or tool cards arrive, render them cleanly without showing the redundant `"Generating…"` status inside the bubble.
5. **Full parity across chat surfaces:** Consistent behavior across both the workspace transcript (`AiChatWorkspaceTranscript.vue` / `AiChatCenterSurface.vue`) and the classic chat dock (`AiChatV2.vue` / `AiChatV2Messages.vue`).
6. **I18n and accessibility:** Screen reader aria-label and tooltips translated across all 6 supported languages (`en`, `zh`, `es`, `fr`, `de`, `ja`).

## Non-Goals

- No changes to queueing logic, pending message steering, or stop buttons.
- No changes to error handling, cancellation banners, or recovery toasts (`AiChatV2RecoveryStatus`).
- No changes to tool execution group cards or plan decision cards other than their normal placement when content arrives.

## Approaches Considered

1. **Option A: Bottom-left of the transcript message stream (Chosen by User).**
   - Render a dedicated animated working/loading indicator at the bottom-left of the transcript whenever `isRemoteWorking` is true.
   - Suppress empty assistant bubbles in the message list until text or reasoning arrives.
   - Remove `"Generating…"` stream text from `AiChatV2StreamStatus` so the bubble content remains clean.
   - *Rationale:* Directly replaces the premature `"Generating…"` bubble right where the user's eyes are focused in the reading flow.

2. **Option B: Bottom-left toolbar in the composer.**
   - Place a persistent working icon in the composer's control bar alongside the mode and model selectors.
   - *Trade-off:* Fixed at the bottom of the viewport, but disconnected from the message stream and competes with selector dropdowns. Dropped per user choice.

3. **Option C: Hybrid (Transcript + Composer toolbar).**
   - Show working indicators in both locations.
   - *Trade-off:* Unnecessary duplication and visual noise. Dropped per user choice.

## Technical Design & Component Changes

### 1. Remote Working State Detection
- In workspace chat (`AiChatWorkspaceTranscript.vue` / `selectedConversation.ts`):
  - Remote is working when `runtimeStatus === 'running' || streamStatus === 'streaming'`.
  - Pass `isRemoteWorking: boolean` (or compute from `streamStatus === 'streaming' || runtimeStatus === 'running'`) into the transcript component.
- In classic chat (`AiChatV2.vue` / `AiChatV2Messages.vue`):
  - Remote is working when `chatIsRunning.value` (`isStreaming.value || authoritativeRuntimeStatus.value === 'running' || liveScheduledAssistant.value !== null`).

### 2. Transcript & Message Rendering
- **`AiChatWorkspaceTranscript.vue`:**
  - Add a dedicated working indicator `.workspace-transcript__working` at the bottom of the transcript scroller, rendered when `isRemoteWorking` is true.
  - In `projectedItems`, filter out empty placeholder assistant messages that have no content, no reasoning, and no tool metadata (`!msg.content && !msg.metadata?.reasoning?.content && !msg.metadata?.toolCallId && !msg.metadata?.toolResult && !msg.metadata?.planStateView && !msg.metadata?.error`).
  - Auto-scroll watches include the working indicator so when the user sends a message, the transcript smoothly reveals the working indicator.
- **`AiChatV2Messages.vue` & `AiChatV2.vue`:**
  - In `AiChatV2Messages.vue`, enhance the bottom-left working indicator (`.v2-messages__working` / typing indicator) so it displays whenever `isRemoteWorking` (or `isStreaming` / between tool rounds) is true.
  - Filter out empty assistant placeholder messages from `visibleMessages` in `AiChatV2.vue` until deltas arrive.
- **`AiChatV2Message.vue` & `AiChatV2StreamStatus.vue`:**
  - In `AiChatV2StreamStatus.vue`, remove the text `"Generating…"` when `status === 'streaming'` (or make `streaming` status invisible within the message bubble itself since the working indicator at the bottom-left represents the active generation). Error and cancelled statuses remain visible.

### 3. Visual Styling
- The working indicator consists of:
  - An animated spinner / pulsing AI icon (`v-progress-circular` or rotating icon) with smooth easing.
  - A subtle label or caption `"AI is working…"` (localized via `t('aiChatV2.ai_working') || 'Working…'`) or animated dots.
  - Aligned to the bottom-left with padding matching message bubbles, styled cleanly for both light and dark themes.

### 4. Internationalization (i18n)
- Add key `aiChatV2.ai_working` across all 6 language files:
  - `en.ts`: `"Working…"`
  - `zh.ts`: `"处理中…"`
  - `es.ts`: `"Trabajando…"`
  - `fr.ts`: `"En cours…"`
  - `de.ts`: `"Wird bearbeitet…"`
  - `ja.ts`: `"処理中…"`

## Verification Plan

- Run `yarn test:components test/vitest/main/components/AiChatWorkspaceTranscript.test.ts`
- Run `yarn test:components test/vitest/main/components/AiChatCenterSurface.test.ts`
- Run `yarn test:components test/vitest/main/components/AiChatV2Messages.scroll.test.ts`
- Run `yarn test:components` to ensure no component test regressions.
- Verify that sending a message does not render an empty bubble with "Generating…", shows the working indicator at the bottom-left, and the indicator stays until remote completes.
