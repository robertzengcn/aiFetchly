# Plan: Display Context Usage in AI Chat V2

## Context

`AiChatV2.vue` currently has no visibility into how full the model's context window is. As a conversation grows, the user has no idea how close they are to the model's limit until truncation kicks in. We want to display the context usage as a percentage in the header, with live updates during streaming.

User decisions:
- **Placement**: Header badge (top-right), compact format like "CTX 42%".
- **Calculation**: Server usage + estimate. Use real `usage` from OpenAI stream on turn completion; show a heuristic estimate that updates live while tokens stream.
- **Window size**: From the model list API, with fallback to a default.

## Approach

The pipeline already streams OpenAI chunks through `AIChatQueryLoop` → `AIChatQueryEventSink` → IPC → renderer. We will:

1. Add `stream_options: { include_usage: true }` to the OpenAI stream request so the server emits a `usage` object in the final chunk.
2. Capture `usage` in the accumulator, propagate it as a new `usage_update` event through the existing event sink → IPC → renderer channel.
3. The renderer maintains a `contextUsage` state: updates from `usage_update` chunks (real data) and from running token deltas during streaming (estimate).
4. The denominator (context window) comes from the model list, fetched once on mount via the existing `getOpenAIChatModels()`.

## Changes

### Layer 1 — API (`src/api/aiChatApi.ts`)

- Extend `OpenAIChatCompletionRequest` (line 429) with optional `stream_options?: { include_usage?: boolean }`.
- Extend `OpenAIChatCompletionChunk` (line 494) with optional `usage?: OpenAIUsage`.
- Extend `OpenAIModel` (line 442) with optional `context_window?: number` and `context_length?: number` (OpenAI-compatible servers commonly return one of these).
- In `openAIChatCompletionStream` (line 1662), set `data.stream_options = { include_usage: true }` so usage arrives in the final chunk.
- In `normalizeOpenAIStreamPayload` (line 2029), when the raw payload has a top-level `usage` field (final chunk emits an empty `choices` array + `usage`), preserve it on the returned chunk object. Also ensure the function still returns a chunk when `choices` is empty but `usage` is present (currently it would return null because `payload.choices` is not an array — handle this case).
- Apply the same usage extraction in `openAIChatCompletionStreamViaLegacyEndpoint` (line 1829) if feasible; otherwise leave a TODO and rely on the estimate path.

### Layer 2 — Stream accumulator (`src/service/AIChatQueryLoop.ts`)

- In the `OpenAIStreamAccumulator` class (used at line 122), add a `usage?: OpenAIUsage` field on its state and capture it from `rawChunk.usage` inside `ingest()`.
- After each `streamChatCompletion` round completes (around line 172), if `accumulator.state.usage` is present, emit a `usage_update` event through `eventSink` with `promptTokens`, `completionTokens`, `totalTokens`, and the model id. Emit on every round so the user sees updates between tool rounds too.

### Layer 3 — Events (`src/service/AIChatQueryEvents.ts`)

- Add a new `AIChatQueryUsageUpdateEvent` interface:
  ```
  { type: "usage_update"; conversationId; messageId; model?: string;
    promptTokens: number; completionTokens: number; totalTokens: number; }
  ```
- Add it to the `AIChatQueryEvent` union (line 120).

### Layer 4 — IPC adapter (`src/main-process/communication/ai-chat-v2-ipc.ts`)

- In `createEventSink` (line 148), add a `case "usage_update":` that forwards the event as a `ChatV2StreamChunk` with `eventType: "usage_update"`.

### Layer 5 — Renderer types (`src/entityTypes/aiChatV2Types.ts`)

- Add `"usage_update"` to `ChatV2StreamEventType` (line 101).
- Add optional fields on `ChatV2StreamChunk` (line 119): `promptTokens?: number`, `completionTokens?: number`, `totalTokens?: number`.

### Layer 6 — New Vue component `AiChatV2ContextBadge.vue`

Path: `src/views/components/aiChatV2/AiChatV2ContextBadge.vue`

Props:
- `percent: number` (0–100)
- `usedTokens?: number`
- `totalTokens?: number`

Renders a compact badge in the header. Uses Vuetify chip/badge. Color shifts by threshold (grey <50%, primary <80%, warning <95%, error ≥95%). Tooltip shows `usedTokens / totalTokens`. Follows the existing i18n pattern (`t('aiChatV2.context_usage') || 'Context'`).

### Layer 7 — `AiChatV2.vue` integration

- Import `getOpenAIChatModels` (already exported from `@/views/api/aiChatV2`).
- Add state:
  - `const modelContextWindows = ref<Map<string, number>>(new Map());`
  - `const lastUsage = ref<{ promptTokens: number; completionTokens: number; totalTokens: number; model?: string } | null>(null);`
  - `const streamingEstimatedTokens = ref(0);`
- On `onMounted`, call `getOpenAIChatModels()` and build the map: for each model, read `context_window ?? context_length`, fall back to `DEFAULT_CONTEXT_WINDOW = 128000`. Store on the map.
- In the chunk handler inside `onSend`:
  - On `usage_update`: set `lastUsage.value` and reset `streamingEstimatedTokens` to `lastUsage.value.totalTokens`.
  - On each `token` chunk: increment `streamingEstimatedTokens` by a rough estimate of the delta (chars/4). This gives a live-updating feel.
- New computed:
  ```
  const contextPercent = computed(() => {
    const used = streamingEstimatedTokens.value || lastUsage.value?.totalTokens || 0;
    const model = lastUsage.value?.model || activeModel.value;
    const window = modelContextWindows.value.get(model ?? "") ?? DEFAULT_CONTEXT_WINDOW;
    return Math.min(100, Math.round((used / window) * 100));
  });
  ```
- In the header (around line 16, inside `v2-shell__header-actions` or as a new left-section element), add `<AiChatV2ContextBadge :percent="contextPercent" :used-tokens="..." :total-tokens="..." />`.
- Reset `streamingEstimatedTokens` to `lastUsage.value.totalTokens` when a new send starts and on conversation switch (so loading history reflects a sensible value — we can seed from `tokensUsed` on history messages if available).

### Layer 8 — i18n

Add `aiChatV2.context_usage` ("Context") and `aiChatV2.context_usage_tooltip` ("{used} / {total} tokens ({percent}%)") to all six language files (`en.ts`, `zh.ts`, `es.ts`, `fr.ts`, `de.ts`, `ja.ts`) under `src/views/lang/`.

## Key files to modify

- `src/api/aiChatApi.ts` — request/chunk/model types, stream_options
- `src/service/AIChatQueryEvents.ts` — new event type
- `src/service/AIChatQueryLoop.ts` — capture + emit usage
- `src/main-process/communication/ai-chat-v2-ipc.ts` — forward usage_update
- `src/entityTypes/aiChatV2Types.ts` — chunk event type + fields
- `src/views/components/aiChatV2/AiChatV2ContextBadge.vue` — **new file**
- `src/views/components/aiChatV2/AiChatV2.vue` — state, computed, header badge
- `src/views/lang/{en,zh,es,fr,de,ja}.ts` — translation keys

## Reuse notes

- `getOpenAIChatModels()` already exists in `src/views/api/aiChatV2.ts:55` — reuse it.
- The event sink pattern (`AIChatQueryEventSink`) is already plumbed end-to-end; we only add one more variant.
- `OpenAIUsage` type already exists at `src/api/aiChatApi.ts:463`.
- The existing chunk-forwarding switch in `createEventSink` is the single integration point on the IPC side.

## Verification

1. **Type check**: `yarn vue-check` and `yarn tsc` pass.
2. **Unit tests** (Vitest, in `test/vitest/utilitycode/`):
   - Add `aiChatContextUsage.test.ts` covering the percent-computation helper (model in map, model not in map, capped at 100, zero used).
   - Add a test for the new `usage_update` event in the existing event-sink coverage if any exists; otherwise a minimal test that `createEventSink` forwards `usage_update` chunks.
3. **Runtime smoke test**:
   - `yarn dev`, open AI Chat V2, send a message.
   - Verify the header badge appears with `CTX 0%` initially, increases while tokens stream, then snaps to the real value from the server after the turn completes.
   - Send multiple turns; verify the percentage reflects accumulated context.
   - Switch conversations; verify the badge updates to reflect loaded history.
4. **Network check**: In DevTools network or app logs, confirm the request body to `/api/ai/v1/chat/completions` includes `"stream_options":{"include_usage":true}` and the final SSE chunk contains a `usage` field. If the server does not return usage, the estimate path still drives the badge.
