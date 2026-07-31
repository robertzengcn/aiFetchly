# AI Chat Reasoning Visibility PRD

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-07-31
- **Owner**: Engineering Team
- **Related Systems**: AI Chat V2, OpenAI-compatible Chat Completions API, local AI provider support, Electron IPC, Vue 3 renderer, TypeORM chat persistence
- **Related Technical Design**: [AI Chat Reasoning Visibility Technical Design](./ai-chat-reasoning-visibility-technical-design.md)
- **Server companion PRD**: `/home/robertzeng/project/aifetchserver/doc/chat-reasoning-streaming-prd.md`

## Executive Summary

AiFetchly AI Chat V2 should let users decide whether to see model-provided reasoning information while an assistant response is generated. The feature should add a visible control in the chat UI, stream reasoning separately from final answer content, and render it in a collapsible reasoning panel attached to the active assistant message.

The product must not expose hidden chain-of-thought as normal chat content. It should display only reasoning signals that the AI server or local OpenAI-compatible provider explicitly exposes as safe-to-show fields, such as `reasoning_content`, `reasoning_summary`, `reasoning_delta`, or provider-specific equivalents normalized by the app. If no safe reasoning data is available, the toggle should not invent a thinking trace.

The normal answer stream must remain unchanged. Reasoning content should not be spoken by voice playback, should not be copied as the assistant answer by default, and should not be sent back to the model as assistant message content in later turns unless a future feature deliberately supports that.

## Background And Problem Statement

AI Chat V2 currently shows a streaming status such as "Generating..." and then appends assistant tokens from `choices[].delta.content` to the assistant message. It does not surface any separate reasoning or thinking data.

Current app behavior:

- `OpenAIStreamAccumulator` reads `delta.content`, `delta.tool_calls`, `delta.images`, and usage metadata.
- `AIChatQueryLoop` emits `token` events only when visible answer content is present.
- `ai-chat-v2-ipc.ts` maps query-loop events into `ChatV2StreamChunk` IPC payloads.
- `AiChatV2.vue` appends `contentDelta` to the active assistant message.
- `AiChatV2Message.vue` renders assistant `message.content` and existing tool/status blocks.

Some providers and reasoning models can expose reasoning-like stream fields separately from final content. The AI server may normalize these fields, and local OpenAI-compatible providers may pass them directly. AiFetchly needs an app-level contract and UI behavior that can render those fields without corrupting final answer content or breaking providers that do not support reasoning output.

## Goals

1. Add a user-facing control to show or hide AI reasoning information in AI Chat V2.
2. Treat reasoning as a separate stream channel, not as normal answer text.
3. Support hosted aiFetchly AI server and local OpenAI-compatible providers.
4. Preserve existing AI Chat V2 behavior for users who do not enable the control.
5. Persist final reasoning information on the assistant message when the user has enabled reasoning display.
6. Restore reasoning panels when loading chat history.
7. Keep UI text fully internationalized across all supported languages.
8. Avoid exposing hidden chain-of-thought or requiring models to reveal private reasoning.
9. Provide tests for stream parsing, IPC mapping, renderer state updates, and history reload.

## Non-Goals

1. Do not ask the LLM to reveal private chain-of-thought.
2. Do not merge reasoning into `message.content`.
3. Do not display fake reasoning when the server/provider does not emit reasoning data.
4. Do not replace existing tool-call, tool-progress, recovery, or plan-mode UI.
5. Do not change the AI server contract directly in the Electron PRD. The server companion PRD owns that contract.
6. Do not send reasoning text to text-to-speech playback by default.
7. Do not expose provider credentials, server routing details, or raw SSE diagnostics in the renderer.
8. Do not add direct database access in IPC handlers or Vue components.

## Users And Use Cases

### Primary Users

- Users who want more transparency while an AI answer is being generated.
- Users working on complex tasks where a brief reasoning summary helps them evaluate the model's direction.
- Users debugging prompts, tools, or model behavior in local-provider setups.

### Developer Users

- Developers who need to verify whether hosted and local providers emit reasoning fields.
- QA testers who need deterministic visibility into stream event handling.
- Support engineers investigating why a user expected reasoning but the selected model did not provide it.

### Core Use Cases

1. User enables "Show reasoning" before sending a message. The assistant streams reasoning into a collapsible panel and final answer text into the normal bubble.
2. User disables "Show reasoning". Reasoning stream events are ignored or not requested; the normal chat answer still works.
3. User selects a model that does not provide reasoning. The UI shows the normal answer and no reasoning panel.
4. User reloads a conversation. Messages that previously saved reasoning display their reasoning panel according to the current view preference.
5. User uses a local OpenAI-compatible provider that emits `reasoning_content`. The app parses and displays it without the hosted server path.
6. User runs voice response. Only final answer content is spoken.

## Product Principles

### Reasoning Is Optional

Reasoning should never be required to use chat. It is an inspectable aid, not the source of truth for the answer.

### Separate Channels

Reasoning data, final answer text, tool calls, and recovery status must remain separate event channels. This avoids transcript corruption and makes history replay predictable.

### Safe-To-Show Only

The app displays only fields explicitly emitted as user-visible reasoning or summaries. The app must not prompt models to output private chain-of-thought or scrape reasoning from hidden provider metadata.

### No Surprise Persistence

If reasoning is persisted, it must be persisted in assistant message metadata and should be considered part of the local chat transcript. It must not be mixed into answer text or tool result content.

### Provider Capability Is Variable

Different models and providers expose reasoning differently or not at all. The UI must degrade cleanly without error states for unsupported providers.

## User Experience Requirements

### UX-1: Toggle Placement

Add a compact icon control in the AI Chat V2 header action area or composer prepend controls.

Recommended behavior:

- Icon: `mdi-brain` or equivalent Vuetify Material Design icon.
- Active state: primary color.
- Inactive state: default text/icon color.
- Tooltip when inactive: "Show reasoning".
- Tooltip when active: "Hide reasoning".
- Disable state: disabled only while the preference is being saved, not while chat is streaming.

The control should not consume significant horizontal space. It should match existing header icon controls such as voice, compact conversation, history, MCP tools, new conversation, and clear chat.

### UX-2: Preference Scope

MVP should support a global local preference:

- Same setting applies across conversations.
- Preference survives app restart.
- User can toggle while idle or streaming.

If toggled on during an active stream, the UI should begin showing any reasoning events received after the toggle changes. Previously ignored reasoning events do not need to be recovered in MVP.

Future enhancement: per-conversation override.

### UX-3: Reasoning Panel Rendering

Render reasoning in `AiChatV2Message.vue` for assistant messages.

Recommended display:

- Collapsible `details`-style panel or Vuetify expansion panel inside the assistant bubble.
- Header text: "Reasoning".
- Optional live label while streaming: "Reasoning..."
- Monospace is not required. Use normal readable text.
- Preserve line breaks.
- Keep max height bounded with internal scroll for very long reasoning.
- The panel should be collapsed by default for completed historical messages unless the global preference is enabled.
- The panel should be open by default on the active streaming message when reasoning is enabled and reasoning has started.

### UX-4: Unsupported Provider Behavior

If reasoning is enabled but the provider emits no reasoning data:

- Do not show an empty panel.
- Do not show a warning for every message.
- Optionally show a one-time tooltip or small model capability hint in the model selector later.

### UX-5: Copy And Voice Behavior

Default copy behavior for assistant messages should copy only final answer content.

Voice playback should receive only `contentDelta`, not `reasoningDelta`.

Future enhancement: "Copy reasoning" action inside the reasoning panel.

### UX-6: Error And Cancellation Behavior

If the stream errors or is cancelled:

- Keep whatever reasoning text was already displayed on the partial assistant message.
- Mark the assistant message with the existing error/cancelled stream status.
- Do not use reasoning as fallback answer content.

## Functional Requirements

### FR-1: Extend App Stream Types

Update AI Chat V2 types to support a reasoning stream event.

Required changes:

- Add `"reasoning_delta"` to `ChatV2StreamEventType`.
- Add `reasoningDelta?: string` to `ChatV2StreamChunk`.
- Add `reasoning?: string` or structured reasoning metadata to `ChatV2MessageMetadata`.

Recommended metadata shape:

```ts
interface ChatV2ReasoningMetadata {
  content: string;
  format: "plain_text";
  source: "server" | "local_provider";
  model?: string;
  truncated?: boolean;
}
```

`ChatV2MessageMetadata` should include:

```ts
reasoning?: ChatV2ReasoningMetadata;
```

### FR-2: Extend OpenAI-Compatible Stream Delta Type

Update `OpenAIStreamDelta` to accept normalized reasoning fields.

Required fields:

```ts
reasoning_content?: string | null;
reasoning_summary?: string | null;
reasoning_delta?: string | null;
```

The app should treat all supported fields as reasoning text deltas. If multiple fields appear in one chunk, append them in this priority order:

1. `reasoning_delta`
2. `reasoning_content`
3. `reasoning_summary`

### FR-3: Accumulate Reasoning Separately

Update `OpenAIStreamAccumulator` so `ingest()` returns both answer and reasoning deltas.

Recommended return type:

```ts
interface OpenAIStreamIngestResult {
  contentDelta: string;
  reasoningDelta: string;
}
```

Accumulator state should include:

```ts
reasoningContent: string;
```

Existing callers should be updated from:

```ts
const delta = accumulator.ingest(rawChunk);
```

to:

```ts
const { contentDelta, reasoningDelta } = accumulator.ingest(rawChunk);
```

### FR-4: Emit Query Loop Reasoning Events

Add a new event type in `AIChatQueryEvents.ts`:

```ts
export interface AIChatQueryReasoningDeltaEvent {
  type: "reasoning_delta";
  conversationId: string;
  messageId: string;
  reasoningDelta: string;
  model?: string;
}
```

`AIChatQueryLoop` should emit this event only when:

- `reasoningDelta` is non-empty;
- the active turn is still valid;
- the request or user preference indicates reasoning should be shown/requested, if that preference is wired to request payload.

### FR-5: Map Reasoning Through IPC

Update `ai-chat-v2-ipc.ts` event sink:

```ts
case "reasoning_delta":
  sendChunk(event, {
    eventType: "reasoning_delta",
    conversationId: e.conversationId,
    messageId: e.messageId,
    reasoningDelta: e.reasoningDelta,
    model: e.model,
  });
  break;
```

IPC handlers must continue to check chat availability/AI enablement before starting AI work. This feature must not add any AI IPC handler that bypasses the existing gate.

### FR-6: Renderer State Updates

`AiChatV2.vue` should maintain reasoning text on the active assistant message.

Recommended approach:

- Keep `reasoningByMessageId: Record<string, string>` or directly update `assistant.metadata.reasoning.content`.
- On `reasoning_delta`, append to the active assistant message metadata.
- Do not append reasoning to `assistant.content`.
- Do not send reasoning deltas to `speechController.pushDelta()`.
- On complete, persist final reasoning metadata if non-empty.

### FR-7: Persistence

Persist reasoning in existing message metadata using the Module/Model path.

Requirements:

- No database access in renderer.
- No direct TypeORM use in IPC handler.
- Use existing AI Chat V2 message persistence flow.
- Save reasoning only on assistant messages.
- Save `source`, `format`, `model`, and `truncated` where known.

If the existing assistant message completion path persists metadata only at finalization, the engine should carry final reasoning content through its completed result object.

### FR-8: Request Preference To Server

If the AI server supports explicit reasoning request options, the app should pass a request option when the user enables reasoning.

Recommended field:

```ts
reasoning?: {
  enabled: boolean;
  effort?: "low" | "medium" | "high";
  summary?: "auto" | "concise" | "detailed";
}
```

MVP can pass only:

```json
{
  "reasoning": { "enabled": true, "summary": "auto" }
}
```

The app must omit this field when the toggle is off to avoid extra provider cost or latency.

### FR-9: Local Provider Compatibility

Local OpenAI-compatible provider streaming bypasses the hosted server and uses `OpenAIStreamParser`. Therefore:

- The parser must preserve nonstandard `delta.reasoning_content`, `delta.reasoning_delta`, and `delta.reasoning_summary` fields.
- Type casts must not erase the fields before they reach `OpenAIStreamAccumulator`.
- Local provider requests should include the same `reasoning` request option only if the provider is configured to support it or if pass-through is acceptable.

For MVP, it is acceptable to parse reasoning fields from local providers even if the app does not send a reasoning request option to them.

### FR-10: i18n

All user-facing strings must be added to:

- `src/views/lang/en.ts`
- `src/views/lang/zh.ts`
- `src/views/lang/es.ts`
- `src/views/lang/fr.ts`
- `src/views/lang/de.ts`
- `src/views/lang/ja.ts`

Required keys:

```ts
aiChatV2.show_reasoning
aiChatV2.hide_reasoning
aiChatV2.reasoning_title
aiChatV2.reasoning_streaming
aiChatV2.reasoning_unavailable
aiChatV2.copy_reasoning
aiChatV2.reasoning_copied
```

`reasoning_unavailable` is optional in MVP if no unavailable panel is rendered.

## Data Model Requirements

### Assistant Message Metadata

Example stored metadata:

```json
{
  "source": "chat-v2",
  "openaiResponseId": "chatcmpl-abc",
  "finishReason": "stop",
  "reasoning": {
    "content": "I need to compare the user's current request with the available stream contract, then propose separate UI and server changes.",
    "format": "plain_text",
    "source": "server",
    "model": "deepseek-reasoner",
    "truncated": false
  }
}
```

### Privacy And Retention

Reasoning metadata is local user data. It should follow existing chat-history clear/delete behavior:

- Clear conversation deletes reasoning metadata.
- Clear all chat deletes reasoning metadata.
- Export features, if any, should decide explicitly whether reasoning is included.

## API And Event Contract

### OpenAI-Compatible Chunk Extension

Input from server/local provider:

```json
{
  "id": "chatcmpl-123",
  "object": "chat.completion.chunk",
  "model": "reasoning-model",
  "choices": [
    {
      "index": 0,
      "delta": {
        "reasoning_content": "I should first inspect the UI stream path."
      },
      "finish_reason": null
    }
  ]
}
```

Normal answer chunk:

```json
{
  "choices": [
    {
      "index": 0,
      "delta": {
        "content": "Here is the implementation plan..."
      },
      "finish_reason": null
    }
  ]
}
```

Renderer IPC chunk:

```json
{
  "eventType": "reasoning_delta",
  "conversationId": "conv-1",
  "messageId": "msg-1",
  "reasoningDelta": "I should first inspect the UI stream path.",
  "model": "reasoning-model"
}
```

## Security, Safety, And Policy Requirements

### SSR-1: No Hidden Chain-Of-Thought Prompting

The app must not add prompts such as:

```text
Show your full chain of thought.
Think step by step and reveal all reasoning.
```

Acceptable phrasing for server/provider request options:

```text
Return a concise reasoning summary if the model/provider supports safe reasoning output.
```

### SSR-2: Prompt Injection Boundary

Reasoning text is model output. Treat it as untrusted:

- Render as text, not HTML.
- Do not execute links or commands from reasoning.
- Do not use reasoning to auto-approve tools.
- Do not use reasoning as evidence that a task completed.

### SSR-3: Logging

Do not add new console logs that print full reasoning content. Existing stream debug logs should log event type and length only.

### SSR-4: Tool Safety

Tool approval, Plan Mode, workspace safety, and dependency install prompts must be unchanged. Reasoning visibility does not grant tool permissions.

## Performance Requirements

- Reasoning rendering must not cause message list layout jumps beyond normal streaming growth.
- Appending reasoning deltas should be O(delta length), not reprocessing the whole message list.
- Long reasoning content should be bounded in UI with max-height scrolling.
- Optional truncation may cap persisted reasoning to a configurable limit, recommended 32 KB per assistant message for MVP.

## Accessibility Requirements

- Toggle must expose `aria-label` and `aria-pressed`.
- Reasoning panel header must be keyboard accessible.
- Streaming updates should not steal focus.
- Color must not be the only indicator of active/inactive state.

## Analytics And Diagnostics

Do not collect reasoning text.

Safe diagnostics:

- Reasoning toggle enabled/disabled.
- Reasoning event count.
- Total reasoning character length.
- Provider/model identifier if already logged elsewhere.
- Whether reasoning was persisted.

## Rollout Plan

### Phase 1: Passive Parsing And Hidden State

- Extend types and accumulator.
- Parse reasoning fields from server/local provider.
- Add tests.
- Do not expose UI yet except under development flag.

### Phase 2: UI Toggle And Live Panel

- Add toggle.
- Add live reasoning panel.
- Add i18n.
- Preserve voice/copy behavior.

### Phase 3: Persistence And History Reload

- Persist reasoning metadata.
- Restore reasoning panel in history.
- Add clear/export behavior checks.

### Phase 4: Provider Capability UX

- Show optional model capability hint.
- Add provider settings capability for reasoning if needed.
- Add server request option when capability is known.

## Acceptance Criteria

1. With reasoning disabled, AI Chat V2 behaves exactly as before for normal text, tools, usage, cancellation, and errors.
2. With reasoning enabled and a stream containing `delta.reasoning_content`, the app displays reasoning in a separate panel and final answer text in the normal assistant bubble.
3. Reasoning text is not appended to `assistant.content`.
4. Voice playback speaks final answer text only.
5. Copying an assistant answer copies final answer text only by default.
6. The app handles streams that contain reasoning-only chunks before answer chunks.
7. The app handles streams that interleave reasoning and answer chunks.
8. The app handles providers that emit no reasoning fields without showing an empty panel.
9. The app persists non-empty reasoning metadata on assistant messages when reasoning display is enabled.
10. Reloaded history shows persisted reasoning in the assistant message panel.
11. Clearing a conversation removes persisted reasoning.
12. All new UI strings exist in every supported language file.
13. Tests cover accumulator parsing, query-loop event emission, IPC mapping, renderer state update, and history reload.

## Test Plan

### Unit Tests

- `OpenAIStreamAccumulator` parses `reasoning_content`.
- `OpenAIStreamAccumulator` parses `reasoning_delta`.
- `OpenAIStreamAccumulator` keeps `contentDelta` and `reasoningDelta` separate.
- Tool-call parsing still works when reasoning fields are present.
- Usage-only final chunks still work.

### Main Process Tests

- `AIChatQueryLoop` emits `reasoning_delta` when accumulator returns reasoning.
- `ai-chat-v2-ipc.ts` maps reasoning query events to `ChatV2StreamChunk`.
- AI enable/provider availability gating still happens before streaming.

### Renderer Tests

- `AiChatV2.vue` appends reasoning to metadata, not message content.
- Toggle updates active/inactive UI state.
- Reasoning panel appears only when content exists.
- Voice controller does not receive reasoning deltas.

### Manual QA

1. Start app with `yarn dev`.
2. Open `http://localhost:5173`.
3. Enable reasoning.
4. Send a prompt using a test server fixture that emits reasoning chunks.
5. Confirm reasoning appears separately while final answer streams normally.
6. Stop mid-stream and verify partial reasoning remains visible.
7. Reload conversation and verify persisted reasoning.
8. Switch language and verify strings render correctly.

## Open Questions

1. Should the reasoning toggle be global or per conversation after MVP?
2. Should persisted reasoning be included in chat export features?
3. Should users be able to copy reasoning separately?
4. Should local provider settings include an explicit reasoning capability flag?
5. Should the app request `reasoning.summary = "concise"` by default to control length and cost?

## Implementation Notes

Likely files:

```text
src/api/aiChatApi.ts
src/service/OpenAIStreamAccumulator.ts
src/service/AIChatQueryEvents.ts
src/service/AIChatQueryLoop.ts
src/main-process/communication/ai-chat-v2-ipc.ts
src/entityTypes/aiChatV2Types.ts
src/views/api/aiChatV2.ts
src/views/components/aiChatV2/AiChatV2.vue
src/views/components/aiChatV2/AiChatV2Message.vue
src/views/components/aiChatV2/AiChatV2StreamStatus.vue
src/views/lang/en.ts
src/views/lang/zh.ts
src/views/lang/es.ts
src/views/lang/fr.ts
src/views/lang/de.ts
src/views/lang/ja.ts
```

Architecture rules:

- IPC handlers must call Modules/Controllers for persistence.
- No direct database access in Vue components or IPC handlers.
- No `any` types. Use explicit interfaces or `unknown`.
- All user-facing UI text must use i18n.
