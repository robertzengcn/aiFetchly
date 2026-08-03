# AI Chat Reasoning Visibility Technical Design

Related PRD: [AI Chat Reasoning Visibility PRD](./ai-chat-reasoning-visibility-prd.md)

Server companion technical design: `/home/robertzeng/project/aifetchserver/doc/chat-reasoning-streaming-technical-design.md`

## 1. Purpose And Scope

This document describes how AiFetchly should implement optional reasoning visibility in AI Chat V2.

The feature adds a UI preference and a separate stream channel for safe model-provided reasoning text. Final answer content remains in the assistant message body. Reasoning is displayed in a collapsible panel on the assistant message and persisted in assistant metadata when non-empty.

The design covers the Electron/Vue app only:

- TypeScript stream types.
- OpenAI-compatible stream parsing.
- Main-process query loop events.
- IPC mapping.
- Renderer state and UI.
- Message metadata persistence.
- i18n and tests.

The AI server companion design owns provider extraction, server SSE behavior, request schema support, and server logging.

## 2. Existing System Fit

### 2.1 Current Stream Pipeline

Current AI Chat V2 data flow:

```text
AiChatV2.vue
  -> streamChatV2Message()
  -> preload/windowSend(AI_CHAT_V2_STREAM)
  -> ai-chat-v2-ipc.ts
  -> AIChatQueryEngine
  -> AIChatQueryLoop
  -> AiChatApi.openAIChatCompletionStream()
  -> hosted server or local OpenAI-compatible provider
  -> OpenAIStreamAccumulator.ingest()
  -> AIChatQueryEventSink
  -> ChatV2StreamChunk over IPC
  -> AiChatV2.vue appends contentDelta
  -> AiChatV2Message.vue renders assistant bubble
```

### 2.2 Current Responsibilities

| Component | Current responsibility | Reasoning change |
| --- | --- | --- |
| `src/api/aiChatApi.ts` | OpenAI-compatible request/response types and hosted stream parser | Add optional reasoning request and delta fields |
| `OpenAICompatibleProviderClient` | Local provider streaming | Preserve reasoning fields from local SSE payloads |
| `OpenAIStreamParser` | Convert local provider SSE payloads into typed chunks | Keep nonstandard reasoning fields in `delta` |
| `OpenAIStreamAccumulator` | Accumulate content, tool calls, images, usage | Accumulate reasoning separately from content |
| `AIChatQueryLoop` | Run model/tool rounds and emit query events | Emit `reasoning_delta` events |
| `AIChatQueryEvents.ts` | Main-process event contract | Add query event type for reasoning deltas |
| `ai-chat-v2-ipc.ts` | Map query events to renderer stream chunks | Map reasoning events to `ChatV2StreamChunk` |
| `entityTypes/aiChatV2Types.ts` | Renderer-safe chat types | Add stream event and message metadata |
| `AiChatV2.vue` | Active chat turn state and renderer stream handling | Append reasoning to metadata, not content |
| `AiChatV2Message.vue` | Render message bubbles | Render reasoning panel |
| language files | UI translations | Add all reasoning labels |

## 3. Design Principles

### 3.1 Separate Text Channels

Answer text and reasoning text must never share the same field.

```text
Answer text     -> delta.content       -> assistant.content
Reasoning text  -> reasoning fields    -> assistant.metadata.reasoning.content
Tool calls      -> delta.tool_calls    -> tool call rows
Images          -> delta.images        -> generatedImages metadata
```

### 3.2 Safe Reasoning Only

The app renders only server/provider fields that are explicitly delivered as safe-to-show output. It must not add prompts asking the model to reveal private reasoning.

### 3.3 Passive Compatibility

With the toggle off, existing chat behavior should be unchanged. With providers that emit no reasoning fields, chat should be unchanged except for the toggle state.

### 3.4 Renderer Does Not Persist Directly

Renderer code updates local view state. Main-process Module/Model code remains responsible for durable persistence.

## 4. Target Architecture

```text
Hosted AI server or local provider
  emits OpenAI-compatible chunk extension
  { choices[0].delta.reasoning_content: "..." }
        |
        v
AiChatApi / OpenAICompatibleProviderClient
        |
        v
OpenAIStreamAccumulator
  returns { contentDelta, reasoningDelta }
        |
        v
AIChatQueryLoop
  emits token and reasoning_delta independently
        |
        v
ai-chat-v2-ipc.ts
  sends ChatV2StreamChunk(eventType="reasoning_delta")
        |
        v
AiChatV2.vue
  appends to assistant.metadata.reasoning.content
        |
        v
AiChatV2Message.vue
  renders collapsible Reasoning panel
```

## 5. Type System Changes

### 5.1 OpenAI-Compatible Request Type

File: `src/api/aiChatApi.ts`

Add request option:

```ts
export type OpenAIReasoningEffort = "low" | "medium" | "high";
export type OpenAIReasoningSummary = "auto" | "concise" | "detailed";

export interface OpenAIReasoningOptions {
  enabled: boolean;
  effort?: OpenAIReasoningEffort;
  summary?: OpenAIReasoningSummary;
}
```

Extend `OpenAIChatCompletionRequest`:

```ts
export interface OpenAIChatCompletionRequest {
  messages: OpenAIChatMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  reasoning?: OpenAIReasoningOptions;
  tools?: OpenAITool[];
  tool_choice?: OpenAIToolChoice;
  stop?: string | string[];
  user?: string;
}
```

### 5.2 OpenAI Stream Delta Type

File: `src/api/aiChatApi.ts`

Extend `OpenAIStreamDelta`:

```ts
export interface OpenAIStreamDelta {
  role?: string;
  content?: string | null;
  reasoning_content?: string | null;
  reasoning_summary?: string | null;
  reasoning_delta?: string | null;
  tool_calls?: OpenAIStreamToolCallDelta[];
  images?: OpenAIChatImage[];
}
```

These fields are additive and compatible with providers that never send them.

### 5.3 Ingest Result Type

File: `src/service/OpenAIStreamAccumulator.ts`

Add:

```ts
export interface OpenAIStreamIngestResult {
  contentDelta: string;
  reasoningDelta: string;
}
```

Extend state:

```ts
export interface OpenAIStreamTextState {
  responseId?: string;
  model?: string;
  fullContent: string;
  reasoningContent: string;
  finishReason?: string | null;
  sawToolCallDelta: boolean;
  usage?: OpenAIUsage;
  images: OpenAIChatImage[];
}
```

Change `ingest()` signature:

```ts
ingest(chunk: OpenAIChatCompletionChunk): OpenAIStreamIngestResult
```

### 5.4 Query Event Type

File: `src/service/AIChatQueryEvents.ts`

Add:

```ts
export interface AIChatQueryReasoningDeltaEvent {
  type: "reasoning_delta";
  conversationId: string;
  messageId: string;
  reasoningDelta: string;
  model?: string;
}
```

Extend `AIChatQueryEvent` union with `AIChatQueryReasoningDeltaEvent`.

Extend completed result:

```ts
reasoningContent?: string;
```

### 5.5 Renderer Stream Type

File: `src/entityTypes/aiChatV2Types.ts`

Add:

```ts
export interface ChatV2ReasoningMetadata {
  content: string;
  format: "plain_text";
  source: "server" | "local_provider" | "unknown";
  model?: string;
  truncated?: boolean;
}
```

Extend `ChatV2MessageMetadata`:

```ts
reasoning?: ChatV2ReasoningMetadata;
```

Extend `ChatV2StreamEventType`:

```ts
| "reasoning_delta"
```

Extend `ChatV2StreamChunk`:

```ts
reasoningDelta?: string;
```

### 5.6 Chat Stream Request Type

File: `src/entityTypes/aiChatV2Types.ts`

Add:

```ts
showReasoning?: boolean;
reasoning?: {
  enabled: boolean;
  effort?: "low" | "medium" | "high";
  summary?: "auto" | "concise" | "detailed";
};
```

`showReasoning` controls the UI preference. `reasoning` is the request-level provider/server option. MVP can derive `reasoning` from `showReasoning` inside the main process.

## 6. Stream Parsing And Accumulation

### 6.1 Reasoning Field Priority

The accumulator should extract a reasoning delta per choice using this priority:

1. `delta.reasoning_delta`
2. `delta.reasoning_content`
3. `delta.reasoning_summary`

If multiple fields are present in one delta, append only the first non-empty value by priority to avoid duplicate provider aliases.

Helper:

```ts
function extractReasoningDelta(delta: OpenAIStreamDelta | undefined): string {
  if (!delta) return "";
  const candidates = [
    delta.reasoning_delta,
    delta.reasoning_content,
    delta.reasoning_summary,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return "";
}
```

### 6.2 Accumulator Behavior

Pseudo-code:

```ts
ingest(chunk: OpenAIChatCompletionChunk): OpenAIStreamIngestResult {
  this.captureChunkMetadata(chunk);

  let contentDelta = "";
  let reasoningDelta = "";

  for (const choice of chunk.choices ?? []) {
    const delta = choice.delta;

    const nextReasoning = extractReasoningDelta(delta);
    if (nextReasoning) {
      this._state.reasoningContent += nextReasoning;
      reasoningDelta += nextReasoning;
    }

    if (delta?.content) {
      this._state.fullContent += delta.content;
      contentDelta += delta.content;
    }

    this.captureFinishReason(choice);
    this.captureToolCalls(delta);
    this.captureImages(delta);
  }

  return { contentDelta, reasoningDelta };
}
```

Order does not affect final state because content and reasoning are stored separately. Emission order should follow chunk order by emitting reasoning before content when both are present in one chunk. That gives the renderer a natural "thinking before answer" feel without changing transcript content.

### 6.3 Usage-Only Chunks

Usage-only chunks have empty `choices` and populated `usage`. They should return:

```ts
{ contentDelta: "", reasoningDelta: "" }
```

Existing usage capture behavior remains unchanged.

### 6.4 Local Provider Parser

File: `src/service/aiProvider/OpenAIStreamParser.ts`

The parser currently casts `payload.choices` into `OpenAIChatCompletionChunk["choices"]`. Because TypeScript structural typing preserves runtime fields, no runtime stripping happens if the payload is assigned directly.

Still, tests should verify that a payload with:

```json
{"delta":{"reasoning_content":"x"}}
```

reaches the accumulator unchanged.

## 7. Request Construction

### 7.1 Hosted Provider Request

File: `src/api/aiChatApi.ts`

`openAIChatCompletionStreamHosted()` should copy `request.reasoning` into the request payload only when enabled.

```ts
if (request.reasoning?.enabled) {
  data.reasoning = {
    enabled: true,
    effort: request.reasoning.effort,
    summary: request.reasoning.summary ?? "auto",
  };
}
```

Continue always setting:

```ts
data.stream_options = { include_usage: true };
```

### 7.2 Local Provider Request

File: `src/service/aiProvider/OpenAIRequestPayload.ts`

`buildOpenAIPayload()` should preserve `request.reasoning` only if enabled:

```ts
if (request.reasoning?.enabled) {
  payload.reasoning = request.reasoning;
}
```

This is an OpenAI-compatible extension. Providers that reject unknown fields may fail. The conservative MVP option is:

- Hosted path: send `reasoning` when enabled.
- Local path: do not send `reasoning` until local provider capability is known, but still parse reasoning fields if the provider emits them.

Recommended MVP: add a local-provider capability check before forwarding `reasoning`.

### 7.3 Query Loop Mapping

File: `src/service/AIChatQueryLoop.ts`

When constructing the OpenAI request:

```ts
reasoning: input.request.showReasoning
  ? { enabled: true, summary: "auto" }
  : undefined,
```

If `ChatV2StreamRequest.reasoning` is provided, prefer it over the default derived option.

## 8. Query Loop Event Emission

Update the stream callback in `AIChatQueryLoop.run()`.

Current shape:

```ts
const delta = accumulator.ingest(rawChunk);
if (delta) emit token;
```

Target shape:

```ts
const result = accumulator.ingest(rawChunk);

if (result.reasoningDelta) {
  eventSink.emit({
    type: "reasoning_delta",
    conversationId: input.conversationId,
    messageId: input.assistantMessageId,
    reasoningDelta: result.reasoningDelta,
    model: accumulator.state.model,
  });
}

if (result.contentDelta) {
  eventSink.emit({
    type: "token",
    conversationId: input.conversationId,
    messageId: input.assistantMessageId,
    contentDelta: result.contentDelta,
    model: accumulator.state.model,
  });
}
```

Reasoning emission should honor:

- aborted turn check;
- active turn check;
- non-empty delta check.

### 8.1 Completed Result

When returning `completed`, include:

```ts
reasoningContent: finalAccumulator?.state.reasoningContent || undefined
```

This allows the engine/persistence layer to save metadata at the same point it saves the final assistant message.

## 9. IPC Mapping

File: `src/main-process/communication/ai-chat-v2-ipc.ts`

Add a switch case:

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

Do not log full reasoning content. Debug logs may include event type and delta length:

```ts
console.debug(
  `[ai-chat-v2] reasoning_delta conv=${e.conversationId} message=${e.messageId} deltaLen=${e.reasoningDelta.length}`
);
```

Do not add any new AI IPC handler without the existing chat availability gate.

## 10. Persistence Design

### 10.1 Metadata Storage

No new database entity is required. Reasoning should be stored in the existing message metadata JSON for assistant messages.

Metadata shape:

```json
{
  "source": "chat-v2",
  "openaiResponseId": "chatcmpl-abc",
  "finishReason": "stop",
  "reasoning": {
    "content": "Safe model-provided reasoning text.",
    "format": "plain_text",
    "source": "server",
    "model": "deepseek-reasoner",
    "truncated": false
  }
}
```

### 10.2 Persistence Boundary

The write path should stay in the main process service/module stack:

```text
AIChatQueryEngine
  -> AIChatV2Module
  -> AIChatV2Model
  -> TypeORM
```

Renderer state is not authoritative. Renderer metadata is for live display only.

### 10.3 Truncation

Recommended maximum persisted reasoning content:

```ts
const CHAT_V2_REASONING_MAX_CHARS = 32 * 1024;
```

If reasoning exceeds the cap:

- persist only the first cap characters;
- set `truncated: true`;
- keep normal answer content unaffected.

Truncation should happen before persistence, not while streaming to the renderer. Users can see live reasoning as it streams, but persisted history is bounded.

### 10.4 History Reload

`AIChatV2Module` should return metadata unchanged for message views. `AiChatV2Message.vue` reads `message.metadata?.reasoning?.content`.

No transcript reconstruction should include reasoning as assistant content. When building OpenAI `messages[]` for the next turn, use `message.content`, tool calls, and tool results only.

## 11. Renderer State Design

### 11.1 Global Preference

MVP global preference options:

1. Store in the existing Token/user setting system if a renderer-safe preference IPC already exists.
2. Store in localStorage if no shared settings path exists and the preference is purely UI-level.

Recommended key:

```text
aiChatV2.showReasoning
```

Since enabling reasoning can change server request payload and possibly cost, the preferred implementation is a main-process setting exposed through IPC rather than only localStorage.

### 11.2 AiChatV2 State

Add:

```ts
const showReasoning = ref(false);
const reasoningSaving = ref(false);
```

When sending:

```ts
await streamChatV2Message({
  ...request,
  showReasoning: showReasoning.value,
  reasoning: showReasoning.value
    ? { enabled: true, summary: "auto" }
    : undefined,
});
```

### 11.3 Stream Chunk Handling

Add a branch before token handling:

```ts
if (chunk.eventType === "reasoning_delta" && chunk.reasoningDelta) {
  const assistant = findAssistantMessage(chunk.messageId);
  appendReasoning(assistant, chunk.reasoningDelta, chunk.model);
  return;
}
```

Helper:

```ts
function appendReasoning(
  assistant: ChatV2MessageView,
  delta: string,
  model?: string
): void {
  const metadata = assistant.metadata ?? { source: "chat-v2" };
  const current = metadata.reasoning?.content ?? "";
  assistant.metadata = {
    ...metadata,
    reasoning: {
      content: current + delta,
      format: "plain_text",
      source: "server",
      model,
      truncated: false,
    },
  };
}
```

Do not call:

```ts
speechController.pushDelta(chunk.reasoningDelta)
```

### 11.4 Completion Reconciliation

When the complete event arrives, `complete.fullContent` remains final answer content only.

If the complete event later includes final reasoning metadata, reconcile it with local streaming metadata by preferring the complete event. MVP can rely on streamed metadata and persistence from the main process.

## 12. UI Component Design

### 12.1 Toggle In `AiChatV2.vue`

Add a header action button near the voice toggle:

```vue
<v-btn
  icon
  size="small"
  variant="text"
  :color="showReasoning ? 'primary' : undefined"
  :loading="reasoningSaving"
  :disabled="reasoningSaving"
  :title="reasoningToggleTitle"
  :aria-label="reasoningToggleTitle"
  :aria-pressed="showReasoning"
  @click="toggleReasoning"
>
  <v-icon size="small">mdi-brain</v-icon>
</v-btn>
```

Computed title:

```ts
const reasoningToggleTitle = computed(() =>
  showReasoning.value
    ? t("aiChatV2.hide_reasoning") || "Hide reasoning"
    : t("aiChatV2.show_reasoning") || "Show reasoning"
);
```

### 12.2 Reasoning Panel In `AiChatV2Message.vue`

Add computed:

```ts
const reasoningText = computed(
  () => props.message.metadata?.reasoning?.content?.trim() ?? ""
);

const hasReasoning = computed(
  () => props.message.role === "assistant" && reasoningText.value.length > 0
);
```

Template:

```vue
<details v-if="hasReasoning" class="v2-message__reasoning" open>
  <summary>
    <v-icon size="x-small">mdi-brain</v-icon>
    {{ t("aiChatV2.reasoning_title") || "Reasoning" }}
  </summary>
  <div class="v2-message__reasoning-content">
    {{ reasoningText }}
  </div>
</details>
```

Use text interpolation, not `v-html`.

### 12.3 Styling

Add scoped styles:

```css
.v2-message__reasoning {
  margin-top: 8px;
  padding: 8px;
  border-left: 3px solid rgba(var(--v-theme-primary), 0.45);
  background: rgba(var(--v-theme-primary), 0.06);
  border-radius: 6px;
}

.v2-message__reasoning summary {
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 4px;
}

.v2-message__reasoning-content {
  margin-top: 6px;
  white-space: pre-wrap;
  max-height: 220px;
  overflow: auto;
  font-size: 13px;
  line-height: 1.45;
}
```

Avoid nested cards. The panel is part of the message bubble, not a card inside a card.

## 13. i18n

Update all language files:

```text
src/views/lang/en.ts
src/views/lang/zh.ts
src/views/lang/es.ts
src/views/lang/fr.ts
src/views/lang/de.ts
src/views/lang/ja.ts
```

Keys:

```ts
show_reasoning: "Show reasoning",
hide_reasoning: "Hide reasoning",
reasoning_title: "Reasoning",
reasoning_streaming: "Reasoning...",
reasoning_unavailable: "Reasoning is not available for this model.",
copy_reasoning: "Copy reasoning",
reasoning_copied: "Reasoning copied",
```

Only render `reasoning_unavailable` if the product intentionally adds an unavailable state. Do not show it for every unsupported response in MVP.

## 14. Logging And Diagnostics

Never log full reasoning text by default.

Allowed debug fields:

- event type;
- delta length;
- message ID;
- conversation ID;
- model;
- total reasoning length.

Disallowed default logs:

- full `reasoningDelta`;
- full `metadata.reasoning.content`;
- raw provider payloads containing reasoning.

## 15. Security Considerations

### 15.1 Model Output Is Untrusted

Reasoning text is model output. It may contain inaccurate claims, malicious instructions, or copied user data.

Controls:

- render as text only;
- do not execute links;
- do not feed reasoning into tool approval decisions;
- do not treat reasoning as verification evidence;
- do not include reasoning in future model context by default.

### 15.2 AI Enable Gate

No new AI work should run before the existing chat availability check. If a new settings IPC is added for the toggle and it does not perform AI work, it does not need AI entitlement gating.

### 15.3 Local Provider Boundary

Local providers may send nonstandard fields. The parser should accept string reasoning fields and ignore unexpected non-string structures.

## 16. Error Handling

| Scenario | Behavior |
| --- | --- |
| Provider sends no reasoning | Render normal answer only |
| Provider sends malformed non-string reasoning | Ignore field |
| Reasoning stream arrives before start event | Ignore if message cannot be matched |
| Reasoning stream arrives after cancellation | Ignore because active turn check fails |
| Persistence metadata too large | Truncate and set `truncated: true` |
| Server rejects `reasoning` option | Surface normal stream error; future improvement can retry without option |

## 17. Rollout Plan

### Phase 1: Parser And Accumulator

- Add stream delta fields.
- Add ingest result type.
- Add accumulator tests.
- Keep UI hidden.

### Phase 2: Query Events And IPC

- Add `AIChatQueryReasoningDeltaEvent`.
- Emit from query loop.
- Map through IPC.
- Add main-process tests.

### Phase 3: UI Toggle And Live Panel

- Add preference state.
- Add header toggle.
- Add message panel.
- Add i18n.
- Verify voice and copy behavior.

### Phase 4: Persistence

- Carry final reasoning through completed result.
- Persist metadata through AIChatV2 module/model.
- Restore on history load.
- Add clear conversation verification.

### Phase 5: Capability UX

- Read server model capability fields when available.
- Add optional model selector hint.
- Avoid sending `reasoning` options to local providers that reject unknown fields.

## 18. Test Plan

### 18.1 Unit Tests

Target files:

```text
test/vitest/main/OpenAIStreamAccumulator.test.ts
test/vitest/main/AIChatQueryLoop.reasoning.test.ts
```

Cases:

- `reasoning_content` accumulates into `reasoningContent`.
- `reasoning_delta` has priority over `reasoning_content`.
- `content` and reasoning fields in the same chunk produce separate deltas.
- usage-only chunks return empty deltas and preserve usage.
- tool-call chunks still buffer arguments.
- malformed reasoning fields are ignored.

### 18.2 IPC Tests

Cases:

- query event `reasoning_delta` maps to `ChatV2StreamChunk`.
- full reasoning text is not logged.
- complete events remain unchanged for content.

### 18.3 Renderer Tests

Cases:

- toggling reasoning updates button state and persisted preference.
- `reasoning_delta` updates `message.metadata.reasoning.content`.
- `token` updates `message.content`.
- voice controller receives token delta only.
- reasoning panel renders escaped text.
- no panel renders when reasoning is empty.

### 18.4 Manual QA

1. Start dev server with `yarn dev`.
2. Open `http://localhost:5173`.
3. Enable reasoning.
4. Use a test fixture or reasoning-capable server model.
5. Verify reasoning appears in the panel while final answer streams normally.
6. Stop generation and confirm partial reasoning remains in the current message.
7. Reload conversation and confirm persisted reasoning appears.
8. Switch each supported language and confirm labels exist.

## 19. Acceptance Checklist

- [ ] Toggle is visible, keyboard accessible, and translated.
- [ ] Reasoning stream event is separate from token event.
- [ ] Reasoning never appends to `assistant.content`.
- [ ] Reasoning is not spoken by voice playback.
- [ ] Reasoning is not included in future OpenAI `messages[]` context.
- [ ] Reasoning metadata persists on assistant rows.
- [ ] History reload renders persisted reasoning.
- [ ] Clearing chat removes reasoning metadata with the message row.
- [ ] Local provider reasoning fields parse when present.
- [ ] Hosted server reasoning fields parse when present.
- [ ] Providers with no reasoning output behave as before.
- [ ] No full reasoning content appears in default logs.
- [ ] All new text has translations in six language files.

## 20. Open Implementation Questions

1. Should the preference be stored in Token settings or renderer localStorage for MVP?
2. Should local providers receive the `reasoning` request extension before capability detection exists?
3. Should persisted reasoning be capped at 32 KB or a different limit?
4. Should historical reasoning panels respect the current global toggle or always show when metadata exists?
5. Should a separate "copy reasoning" control ship in MVP or later?

## 21. File Change Summary

Expected app files:

```text
src/api/aiChatApi.ts
src/service/aiProvider/OpenAIRequestPayload.ts
src/service/aiProvider/OpenAIStreamParser.ts
src/service/OpenAIStreamAccumulator.ts
src/service/AIChatQueryEvents.ts
src/service/AIChatQueryLoop.ts
src/main-process/communication/ai-chat-v2-ipc.ts
src/entityTypes/aiChatV2Types.ts
src/views/api/aiChatV2.ts
src/views/components/aiChatV2/AiChatV2.vue
src/views/components/aiChatV2/AiChatV2Message.vue
src/views/lang/en.ts
src/views/lang/zh.ts
src/views/lang/es.ts
src/views/lang/fr.ts
src/views/lang/de.ts
src/views/lang/ja.ts
```

Expected tests:

```text
test/vitest/main/
test/vitest/utilitycode/
```

No worker process files are required.
