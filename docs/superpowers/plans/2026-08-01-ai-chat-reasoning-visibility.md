# AI Chat Reasoning Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let AI Chat V2 users optionally see model-provided reasoning (e.g. `reasoning_content`) streamed into a collapsible panel on the assistant message, fully separated from the final answer text, persisted in message metadata, and translated across all six supported languages.

**Architecture:** A new `reasoning_delta` stream channel flows alongside the existing `token` channel: provider chunk → `OpenAIStreamAccumulator` (separate `reasoningContent` state) → `AIChatQueryLoop` emits `reasoning_delta` → IPC sink maps to `ChatV2StreamChunk` → `AiChatV2.vue` appends to `assistant.metadata.reasoning.content` (never `assistant.content`, never speech) → `AiChatV2Message.vue` renders a collapsible `<details>` panel. The engine persists final reasoning into the existing message-metadata JSON (no new entity) with a 32 KB cap. A global toggle (localStorage for MVP) controls whether the request carries a `reasoning` option and whether the panel renders.

**Tech Stack:** TypeScript 5.x, Electron IPC, Vue 3 + Vuetify, vue-i18n, Vitest (main config + dedicated happy-dom components config), `@vue/test-utils`.

---

## Verified codebase facts (read before each task)

These were confirmed against the working tree on 2026-08-01. The companion technical-design doc (`ai-chat-reasoning-visibility-technical-design.md`) contains **stale paths** — this plan supersedes them:

- ❌ `src/service/aiProvider/` does **not** exist. There is no `OpenAIStreamParser.ts`, no `OpenAIRequestPayload.ts`, no `buildOpenAIPayload()`.
- ✅ All OpenAI-compatible types + the single streaming client live in `src/api/aiChatApi.ts`. `OpenAICompatibleProviderClient.openAIChatCompletionStream()` (line ~1881) is the **one** stream path for both hosted and local-routed providers; it POSTs to `/api/ai/v1/chat/completions`.
- ✅ `OpenAIStreamDelta` (aiChatApi.ts ~511) currently has only `role`, `content`, `tool_calls`. **No `images` field exists** (the design's `images`/`captureImages` references are aspirational — ignore them).
- ✅ `OpenAIStreamTextState` (OpenAIStreamAccumulator.ts:7) has `responseId?, model?, fullContent, finishReason?, sawToolCallDelta, usage?`. **No images.**
- ✅ `OpenAIStreamAccumulator.ingest()` (OpenAIStreamAccumulator.ts:58) currently returns `string` (the content delta). Only one caller: `AIChatQueryLoop.ts:349`.
- ✅ IPC tests in `test/vitest/main/ipc/ai-chat-v2-ipc.test.ts` already drive the **real** pipeline (engine → loop → accumulator → sink → mocked module persistence) by mocking only `AiChatApi.openAIChatCompletionStream`. Injecting a reasoning chunk there proves accumulator + loop + IPC + persistence in one test.
- ✅ Vue SFC tests run under a dedicated config: `yarn vitest --config test/vitest/main/components/vitest.config.mjs run <file>` (happy-dom). The root `vite.main.config.mjs` explicitly excludes `components/**` and stays on node.
- ✅ Main-process tests run under: `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run <file>` (skip TSC only in tight loops; final verification must run real TSC).

## MVP decisions (resolving the design's Open Questions §20)

1. **Preference storage → localStorage** (design §11.1 option 2). Key: `aiChatV2.showReasoning`. Simpler than a new settings IPC + DB column; survives restart; satisfies UX-2. The toggle is also sent per-request as `showReasoning`, so the main process always knows.
2. **Local-provider `reasoning` option → send when toggle on.** There is only one stream path in this app; the AI server strips/options it per provider. The app always parses reasoning fields when present regardless of the toggle (passive compatibility, FR-9).
3. **Truncation cap → 32 KB** persisted reasoning (`truncated: true` if cut).
4. **History panels → render whenever metadata.reasoning exists**; `open` while streaming the active message, collapsed for completed history unless the global toggle is on.
5. **`source` field → `"server"`** for MVP (the app's only path is the AI server, which normalizes provider reasoning).
6. **"Copy reasoning" → deferred** (UX-5 future). Default copy already copies only `message.content`, which never includes reasoning.

## File map

| File | Responsibility | Change |
| --- | --- | --- |
| `src/api/aiChatApi.ts` | OpenAI-compatible request/delta types; stream client | Add reasoning request option + delta fields; forward `reasoning` in payload |
| `src/service/OpenAIStreamAccumulator.ts` | Reduce chunks to state | `ingest()` returns `{contentDelta, reasoningDelta}`; add `reasoningContent` state + extractor |
| `src/entityTypes/aiChatV2Types.ts` | Renderer-safe types | Add `ChatV2ReasoningMetadata`, `reasoning_delta` event, chunk field, request fields |
| `src/service/AIChatQueryEvents.ts` | Main-process event contract | Add `AIChatQueryReasoningDeltaEvent`; `reasoningContent?` on completed/cancelled/failed results |
| `src/service/AIChatQueryLoop.ts` | Run model rounds, emit events | Destructure ingest; emit `reasoning_delta`; carry `reasoningContent` in results |
| `src/main-process/communication/ai-chat-v2-ipc.ts` | Map events → renderer chunks | Add `case "reasoning_delta"`; pass `showReasoning`/`reasoning` through STREAM handler |
| `src/service/AIChatQueryEngine.ts` | Persist assistant turns | Build + persist `metadata.reasoning` (with truncation) on completed/cancelled/failed |
| `src/views/components/aiChatV2/AiChatV2Message.vue` | Render message bubble | Render collapsible reasoning panel (text only, no v-html) |
| `src/views/components/aiChatV2/AiChatV2.vue` | Active turn state + UI | Toggle (localStorage), header button, `reasoning_delta` chunk handler, pass request fields |
| `src/views/lang/{en,zh,es,fr,de,ja}.ts` | Translations | Add 7 reasoning keys each |
| `test/vitest/main/OpenAIStreamAccumulator.test.ts` | NEW — accumulator unit tests | reasoning parsing/priority/separation |
| `test/vitest/main/ipc/ai-chat-v2-ipc.test.ts` | Extend — end-to-end reasoning | reasoning chunk → IPC + persistence |
| `test/vitest/main/components/AiChatV2Message.reasoning.test.ts` | NEW — panel rendering | panel present/absent, text-escaped |

No worker-process files. No new DB entity.

---

## Task 1: Extend OpenAI-compatible types in aiChatApi.ts

**Files:**
- Modify: `src/api/aiChatApi.ts` (around lines 441–452 request type, 511–515 delta type)

- [ ] **Step 1: Add the reasoning request option + extend the request interface**

In `src/api/aiChatApi.ts`, insert these types just **above** `export interface OpenAIChatCompletionRequest` (line 441):

```ts
/** Reasoning effort/summary request option for reasoning-capable models. */
export type OpenAIReasoningEffort = "low" | "medium" | "high";
export type OpenAIReasoningSummary = "auto" | "concise" | "detailed";

export interface OpenAIReasoningOptions {
  enabled: boolean;
  effort?: OpenAIReasoningEffort;
  summary?: OpenAIReasoningSummary;
}
```

Add `reasoning?: OpenAIReasoningOptions;` as a new field inside `OpenAIChatCompletionRequest` (after `stream_options`).

- [ ] **Step 2: Extend `OpenAIStreamDelta` (line ~511)** to add the three reasoning fields:

```ts
export interface OpenAIStreamDelta {
  role?: string;
  content?: string | null;
  reasoning_content?: string | null;
  reasoning_summary?: string | null;
  reasoning_delta?: string | null;
  tool_calls?: OpenAIStreamToolCallDelta[];
}
```

- [ ] **Step 3: Type-check**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run test/vitest/main/AIChatQueryLoopCancellation.test.ts`
Expected: existing tests still PASS (purely additive type changes; no runtime change yet).

- [ ] **Step 4: Commit**

```bash
git add src/api/aiChatApi.ts
git commit -m "feat(ai-chat): add OpenAI reasoning request option + stream delta fields"
```

---

## Task 2: Accumulator parses reasoning separately (TDD)

**Files:**
- Test: `test/vitest/main/OpenAIStreamAccumulator.test.ts` (create)
- Modify: `src/service/OpenAIStreamAccumulator.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/OpenAIStreamAccumulator.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { OpenAIStreamAccumulator } from "@/service/OpenAIStreamAccumulator";
import type { OpenAIChatCompletionChunk } from "@/api/aiChatApi";

function chunk(delta: Record<string, unknown>, finish?: string): OpenAIChatCompletionChunk {
  return {
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    created: 1,
    model: "reasoning-model",
    choices: [{ index: 0, delta: delta as never, finish_reason: finish ?? null }],
  };
}

describe("OpenAIStreamAccumulator — reasoning", () => {
  it("accumulates reasoning_content into reasoningDelta and state.reasoningContent", () => {
    const acc = new OpenAIStreamAccumulator();
    const r1 = acc.ingest(chunk({ reasoning_content: "Hello " }));
    const r2 = acc.ingest(chunk({ reasoning_content: "world." }));
    expect(r1.reasoningDelta).toBe("Hello ");
    expect(r2.reasoningDelta).toBe("world.");
    expect(r1.contentDelta).toBe("");
    expect(acc.state.reasoningContent).toBe("Hello world.");
  });

  it("keeps contentDelta and reasoningDelta separate within one chunk", () => {
    const acc = new OpenAIStreamAccumulator();
    const r = acc.ingest(chunk({ reasoning_content: "think", content: "say" }));
    expect(r.reasoningDelta).toBe("think");
    expect(r.contentDelta).toBe("say");
    expect(acc.state.fullContent).toBe("say");
    expect(acc.state.reasoningContent).toBe("think");
  });

  it("prioritizes reasoning_delta > reasoning_content > reasoning_summary", () => {
    const acc = new OpenAIStreamAccumulator();
    // All three present → only reasoning_delta used (no duplicate aliases).
    const r = acc.ingest(
      chunk({
        reasoning_delta: "D",
        reasoning_content: "C",
        reasoning_summary: "S",
      })
    );
    expect(r.reasoningDelta).toBe("D");
    expect(acc.state.reasoningContent).toBe("D");

    // Without reasoning_delta, reasoning_content wins.
    const acc2 = new OpenAIStreamAccumulator();
    const r2 = acc2.ingest(chunk({ reasoning_content: "C", reasoning_summary: "S" }));
    expect(r2.reasoningDelta).toBe("C");
  });

  it("returns empty deltas on usage-only chunks but still captures usage", () => {
    const acc = new OpenAIStreamAccumulator();
    const r = acc.ingest({
      id: "x",
      object: "chat.completion.chunk",
      created: 1,
      model: "m",
      choices: [],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    });
    expect(r.contentDelta).toBe("");
    expect(r.reasoningDelta).toBe("");
    expect(acc.state.usage?.total_tokens).toBe(5);
  });

  it("still buffers tool calls when reasoning fields are present", () => {
    const acc = new OpenAIStreamAccumulator();
    acc.ingest({
      id: "x",
      object: "chat.completion.chunk",
      created: 1,
      model: "m",
      choices: [
        {
          index: 0,
          delta: {
            reasoning_content: "planning",
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                type: "function",
                function: { name: "file_read", arguments: '{"path":"/a"}' },
              },
            ],
          } as never,
          finish_reason: "tool_calls",
        },
      ],
    });
    const calls = acc.tryParseToolCallArguments();
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("file_read");
    expect(calls[0].ok).toBe(true);
  });

  it("ignores malformed non-string reasoning fields", () => {
    const acc = new OpenAIStreamAccumulator();
    const r = acc.ingest(chunk({ reasoning_content: { bad: true } } as never));
    expect(r.reasoningDelta).toBe("");
    expect(acc.state.reasoningContent).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run test/vitest/main/OpenAIStreamAccumulator.test.ts`
Expected: FAIL — `acc.ingest(...).reasoningDelta` is `undefined` (ingest currently returns a string); `acc.state.reasoningContent` is `undefined`.

- [ ] **Step 3: Implement — rewrite `OpenAIStreamAccumulator.ts`**

Replace the `OpenAIStreamTextState` interface, add an ingest-result interface + extractor, and change `ingest()`. The full new file body (preserve `_bufferToolCall` and `tryParseToolCallArguments` exactly as-is; only the bits shown change):

Add to the state interface (insert `reasoningContent: string;` after `fullContent: string;`):

```ts
export interface OpenAIStreamTextState {
  responseId?: string;
  model?: string;
  fullContent: string;
  reasoningContent: string;
  finishReason?: string | null;
  sawToolCallDelta: boolean;
  usage?: OpenAIUsage;
}
```

Add just below the imports/above the class:

```ts
export interface OpenAIStreamIngestResult {
  contentDelta: string;
  reasoningDelta: string;
}

/**
 * Extract the first non-empty reasoning delta from a choice delta, using the
 * priority order reasoning_delta → reasoning_content → reasoning_summary.
 * Only string values are honoured; malformed non-string fields are ignored.
 */
function extractReasoningDelta(delta: OpenAIStreamDelta | undefined): string {
  if (!delta) {
    return "";
  }
  const candidates: (string | null | undefined)[] = [
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

You need `OpenAIStreamDelta` imported at the top — add it to the existing `import type { ... } from "@/api/aiChatApi";`.

Update the initial state and `ingest()`:

```ts
  private _state: OpenAIStreamTextState = {
    fullContent: "",
    reasoningContent: "",
    sawToolCallDelta: false,
  };
  private _toolCalls: Map<number, BufferedOpenAIToolCall> = new Map();

  get state(): OpenAIStreamTextState {
    return this._state;
  }

  getBufferedToolCalls(): BufferedOpenAIToolCall[] {
    return Array.from(this._toolCalls.values()).sort(
      (a, b) => a.index - b.index
    );
  }

  /**
   * Ingest a single raw chunk. Returns the non-empty content and reasoning
   * deltas for this chunk (each "" when absent). Reasoning is accumulated
   * separately from answer content so the two channels never mix.
   */
  ingest(chunk: OpenAIChatCompletionChunk): OpenAIStreamIngestResult {
    if (chunk.id) {
      this._state.responseId = chunk.id;
    }
    if (chunk.model) {
      this._state.model = chunk.model;
    }
    if (chunk.usage) {
      this._state.usage = chunk.usage;
    }

    let contentDelta = "";
    let reasoningDelta = "";
    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta;

      // Emit reasoning before content so the renderer sees "thinking before
      // answer" within a single chunk. Final stored state is order-independent.
      const nextReasoning = extractReasoningDelta(delta);
      if (nextReasoning) {
        this._state.reasoningContent += nextReasoning;
        reasoningDelta += nextReasoning;
      }

      if (delta?.content) {
        this._state.fullContent += delta.content;
        contentDelta += delta.content;
      }
      if (choice.finish_reason) {
        this._state.finishReason = choice.finish_reason;
      }
      if (delta?.tool_calls) {
        this._state.sawToolCallDelta = true;
        for (const tc of delta.tool_calls) {
          this._bufferToolCall(tc);
        }
      }
    }
    return { contentDelta, reasoningDelta };
  }
```

Leave `_bufferToolCall` and `tryParseToolCallArguments` unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run test/vitest/main/OpenAIStreamAccumulator.test.ts`
Expected: PASS (all 6 cases).

- [ ] **Step 5: Commit**

```bash
git add src/service/OpenAIStreamAccumulator.ts test/vitest/main/OpenAIStreamAccumulator.test.ts
git commit -m "feat(ai-chat): accumulate reasoning stream separately from answer content"
```

---

## Task 3: Extend renderer-safe types (aiChatV2Types.ts)

**Files:**
- Modify: `src/entityTypes/aiChatV2Types.ts`

- [ ] **Step 1: Add `ChatV2ReasoningMetadata` and extend `ChatV2MessageMetadata`**

Add the interface just above `ChatV2MessageMetadata` (line 30):

```ts
/** Persisted reasoning metadata for an assistant message. Local user data. */
export interface ChatV2ReasoningMetadata {
  content: string;
  format: "plain_text";
  source: "server" | "local_provider" | "unknown";
  model?: string;
  truncated?: boolean;
}
```

Add a field inside `ChatV2MessageMetadata`:

```ts
  reasoning?: ChatV2ReasoningMetadata;
```

- [ ] **Step 2: Extend `ChatV2StreamRequest` (line ~72)** with toggle + request option:

```ts
export interface ChatV2StreamRequest {
  conversationId?: string;
  message: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  mode?: ChatV2Mode;
  /** UI preference: render the reasoning panel when reasoning data exists. */
  showReasoning?: boolean;
  /** Provider/server reasoning request option; derived from showReasoning when omitted. */
  reasoning?: {
    enabled: boolean;
    effort?: "low" | "medium" | "high";
    summary?: "auto" | "concise" | "detailed";
  };
}
```

- [ ] **Step 3: Extend `ChatV2StreamEventType` (line ~124)** — add `"reasoning_delta"` to the union (e.g. after `"token"`).

- [ ] **Step 4: Extend `ChatV2StreamChunk` (line ~144)** — add field:

```ts
  /** reasoning_delta: incremental safe-to-show reasoning text. */
  reasoningDelta?: string;
```

- [ ] **Step 5: Type-check**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run test/vitest/main/OpenAIStreamAccumulator.test.ts`
Expected: PASS (additive type changes compile).

- [ ] **Step 6: Commit**

```bash
git add src/entityTypes/aiChatV2Types.ts
git commit -m "feat(ai-chat): add reasoning types to V2 stream/message contract"
```

---

## Task 4: Add reasoning query event + result fields (AIChatQueryEvents.ts)

**Files:**
- Modify: `src/service/AIChatQueryEvents.ts`

- [ ] **Step 1: Add the reasoning event type**

Insert after `AIChatQueryTokenEvent` (line ~33):

```ts
export interface AIChatQueryReasoningDeltaEvent {
  type: "reasoning_delta";
  conversationId: string;
  messageId: string;
  reasoningDelta: string;
  model?: string;
}
```

- [ ] **Step 2: Add it to the `AIChatQueryEvent` union** (line ~167) — add `| AIChatQueryReasoningDeltaEvent`.

- [ ] **Step 3: Add `reasoningContent?: string` to terminal results**

In `AIChatQueryLoopResult`:
- `completed` variant (line ~188): add `reasoningContent?: string;`
- `cancelled` variant (line ~204): add `reasoningContent?: string;`
- `failed` variant (line ~223): add `reasoningContent?: string;`

- [ ] **Step 4: Type-check**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run test/vitest/main/AIChatQueryLoopCancellation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/service/AIChatQueryEvents.ts
git commit -m "feat(ai-chat): add reasoning_delta query event + reasoningContent on results"
```

---

## Task 5: Emit reasoning_delta from AIChatQueryLoop.run()

**Files:**
- Modify: `src/service/AIChatQueryLoop.ts` (stream callback ~346–358; terminal returns ~441–449, ~725–735, ~795–805, ~855–865)

- [ ] **Step 1: Update the stream callback to destructure ingest + emit reasoning**

Find the `onChunk` callback body (around line 346–358):

```ts
          (rawChunk) => {
            if (input.abortController.signal.aborted) return;
            if (!input.isActiveTurn()) return;
            const delta = accumulator.ingest(rawChunk);
            if (delta) {
              eventSink.emit({
                type: "token",
                conversationId: input.conversationId,
                messageId: input.assistantMessageId,
                contentDelta: delta,
                model: accumulator.state.model,
              });
            }
          },
```

Replace with:

```ts
          (rawChunk) => {
            if (input.abortController.signal.aborted) return;
            if (!input.isActiveTurn()) return;
            const { contentDelta, reasoningDelta } = accumulator.ingest(rawChunk);
            if (reasoningDelta) {
              eventSink.emit({
                type: "reasoning_delta",
                conversationId: input.conversationId,
                messageId: input.assistantMessageId,
                reasoningDelta,
                model: accumulator.state.model,
              });
            }
            if (contentDelta) {
              eventSink.emit({
                type: "token",
                conversationId: input.conversationId,
                messageId: input.assistantMessageId,
                contentDelta,
                model: accumulator.state.model,
              });
            }
          },
```

- [ ] **Step 2: Carry `reasoningContent` into the cancelled early-return** (around line 441–449, the abort-inside-round path). Add `reasoningContent: accumulator.state.reasoningContent || undefined,` to the returned object.

- [ ] **Step 3: Carry `reasoningContent` into the main cancelled/failed returns** that read from `finalAccumulator` (around lines 725–735 and 795–805). Add `reasoningContent: finalAccumulator?.state.reasoningContent || undefined,` to each returned object.

- [ ] **Step 4: Carry `reasoningContent` into the completed return** (around line 855–865). Add `reasoningContent: finalAccumulator?.state.reasoningContent || undefined,` to the returned object.

- [ ] **Step 5: Confirm no other ingest() callers**

Run: `grep -rn "\.ingest(" src/ test/`
Expected: only `src/service/AIChatQueryLoop.ts` (the call edited above). If any other caller appears, update it to destructure `{ contentDelta }` (or `{ contentDelta, reasoningDelta }`).

- [ ] **Step 6: Run existing loop test (regression)**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run test/vitest/main/AIChatQueryLoopCancellation.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/service/AIChatQueryLoop.ts
git commit -m "feat(ai-chat): emit reasoning_delta events and carry reasoning into results"
```

---

## Task 6: Map reasoning_delta through IPC + pass request fields

**Files:**
- Modify: `src/main-process/communication/ai-chat-v2-ipc.ts` (event sink switch ~187–341; STREAM handler request build)

- [ ] **Step 1: Add the IPC sink case**

In `createEventSink`'s `switch (e.type)` (line ~187), insert immediately **after** the `case "token":` block (after its `break;` ~209):

```ts
        case "reasoning_delta":
          console.debug(
            `[ai-chat-v2] reasoning_delta conv=${e.conversationId} message=${e.messageId} deltaLen=${e.reasoningDelta.length}`
          );
          sendChunk(event, {
            eventType: "reasoning_delta",
            conversationId: e.conversationId,
            messageId: e.messageId,
            reasoningDelta: e.reasoningDelta,
            model: e.model,
          });
          break;
```

Note: log **length only**, never the reasoning text (SSR-3 / §14).

- [ ] **Step 2: Ensure the STREAM handler forwards `showReasoning` / `reasoning`**

Locate where the STREAM handler builds the `ChatV2StreamRequest` (or the engine input) from the IPC payload. Search the file:

Run: `grep -n "showReasoning\|temperature\|maxTokens\|message:" src/main-process/communication/ai-chat-v2-ipc.ts`

Confirm the sanitized request object includes `showReasoning` and `reasoning` when present on the incoming payload (mirror how `temperature`/`maxTokens` are passed). If the handler builds the request field-by-field, add:

```ts
  if (typeof parsed.showReasoning === "boolean") {
    request.showReasoning = parsed.showReasoning;
  }
  if (parsed.reasoning && typeof parsed.reasoning === "object") {
    request.reasoning = parsed.reasoning as ChatV2StreamRequest["reasoning"];
  }
```

(Adapt variable names to the actual handler. The goal: the `ChatV2StreamRequest` handed to the engine carries `showReasoning`/`reasoning`.)

- [ ] **Step 3: Type-check + run existing IPC tests (regression)**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run test/vitest/main/ipc/ai-chat-v2-ipc.test.ts`
Expected: PASS (all existing lifecycle tests).

- [ ] **Step 4: Commit**

```bash
git add src/main-process/communication/ai-chat-v2-ipc.ts
git commit -m "feat(ai-chat): map reasoning_delta to renderer chunks and forward toggle"
```

---

## Task 7: End-to-end reasoning test (IPC + persistence)

**Files:**
- Test: `test/vitest/main/ipc/ai-chat-v2-ipc.test.ts` (extend — add a new `describe` block)

- [ ] **Step 1: Write the failing test**

Append a new `describe` block at the end of `ai-chat-v2-ipc.test.ts` (it reuses the module-level mocks already in the file):

```ts
describe("AI Chat V2 — reasoning streaming + persistence", () => {
  beforeEach(() => {
    setupElectronMocks();
    vi.clearAllMocks();
    mockOpenAIChatCompletionStream.mockResolvedValue(undefined);
    registerAiChatV2IpcHandlers();
  });
  afterEach(() => {
    resetElectronMocks();
  });

  it("emits a reasoning_delta chunk separate from token and persists metadata.reasoning", async () => {
    mockOpenAIChatCompletionStream.mockImplementation(
      async (_req, onChunk: (c: unknown) => void) => {
        // Reasoning arrives before the answer.
        onChunk({ choices: [{ delta: { reasoning_content: "Thinking..." } }] });
        onChunk({ choices: [{ delta: { content: "Answer" } }] });
        onChunk({
          choices: [{ delta: { content: "" }, finish_reason: "stop" }],
        });
      }
    );

    const senderSend = vi.fn();
    await mockIpcMain.callHandler(
      AI_CHAT_V2_STREAM,
      { sender: { send: senderSend } },
      JSON.stringify({ message: "hi", showReasoning: true })
    );

    // 1. A reasoning_delta chunk was sent on the chunk channel.
    const reasoningChunk = senderSend.mock.calls
      .filter(([ch]) => ch === AI_CHAT_V2_STREAM_CHUNK)
      .map(([, p]) => JSON.parse(p as string))
      .find((c) => c.eventType === "reasoning_delta");
    expect(reasoningChunk).toMatchObject({
      reasoningDelta: "Thinking...",
    });

    // 2. The answer token chunk was sent too, and stays separate.
    const tokenChunks = senderSend.mock.calls
      .filter(([ch]) => ch === AI_CHAT_V2_STREAM_CHUNK)
      .map(([, p]) => JSON.parse(p as string))
      .filter((c) => c.eventType === "token");
    expect(tokenChunks).toHaveLength(1);
    expect(tokenChunks[0].contentDelta).toBe("Answer");

    // 3. Reasoning was persisted on the assistant message, separate from content.
    expect(mockSaveAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Answer",
        metadata: expect.objectContaining({
          reasoning: expect.objectContaining({
            content: "Thinking...",
            format: "plain_text",
            source: "server",
            truncated: false,
          }),
        }),
      })
    );

    // 4. Full reasoning text is never logged.
    const logCalls = senderSend.mock.calls.map((c) => JSON.stringify(c));
    expect(logCalls.some((s) => s.includes("Thinking..."))).toBe(false);
  });

  it("does not persist reasoning when the model emits none", async () => {
    mockOpenAIChatCompletionStream.mockImplementation(
      async (_req, onChunk: (c: unknown) => void) => {
        onChunk({ choices: [{ delta: { content: "No reasoning here" } }] });
        onChunk({
          choices: [{ delta: { content: "" }, finish_reason: "stop" }],
        });
      }
    );

    const senderSend = vi.fn();
    await mockIpcMain.callHandler(
      AI_CHAT_V2_STREAM,
      { sender: { send: senderSend } },
      JSON.stringify({ message: "hi", showReasoning: true })
    );

    const reasoningChunk = senderSend.mock.calls
      .filter(([ch]) => ch === AI_CHAT_V2_STREAM_CHUNK)
      .map(([, p]) => JSON.parse(p as string))
      .find((c) => c.eventType === "reasoning_delta");
    expect(reasoningChunk).toBeUndefined();

    const saved = mockSaveAssistantMessage.mock.calls[0]?.[0] as
      | { metadata?: { reasoning?: unknown } }
      | undefined;
    expect(saved?.metadata?.reasoning).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run test/vitest/main/ipc/ai-chat-v2-ipc.test.ts -t "reasoning streaming"`
Expected: FAIL — no `reasoning_delta` chunk (engine persistence not implemented yet — Task 8).

- [ ] **Step 3: Commit the test (RED)**

```bash
git add test/vitest/main/ipc/ai-chat-v2-ipc.test.ts
git commit -m "test(ai-chat): add reasoning streaming + persistence expectations (RED)"
```

> The test goes GREEN after Task 8 wires persistence. (Loop emission + IPC mapping are already implemented in Tasks 5–6; only the `metadata.reasoning` assertion is still unmet.)

---

## Task 8: Forward reasoning request option + persist reasoning metadata

**Files:**
- Modify: `src/api/aiChatApi.ts` (payload build in `openAIChatCompletionStream` ~1890)
- Modify: `src/service/AIChatQueryEngine.ts` (metadata build ~664, ~718, ~744)

- [ ] **Step 1: Forward `reasoning` in the stream request payload**

In `openAIChatCompletionStream` (aiChatApi.ts ~1881), inside the payload build after the existing `if (request.user !== undefined)` block (~1914) and before `data.stream_options = ...`, add:

```ts
    if (request.reasoning?.enabled) {
      data.reasoning = {
        enabled: true,
        effort: request.reasoning.effort,
        summary: request.reasoning.summary ?? "auto",
      };
    }
```

Do the same in the non-streaming `openAIChatCompletion` (~1840) for consistency (same insertion point relative to `user`).

- [ ] **Step 2: Derive the OpenAI request `reasoning` from `showReasoning` in the loop**

In `AIChatQueryLoop.run()`, the `streamChatCompletion` request object (~330–345) currently omits `reasoning`. Add a `reasoning` field derived from the request, so the hosted server receives the option when the user enabled it. Insert into the request literal (e.g. after `tool_choice`):

```ts
            reasoning: input.request.reasoning
              ? input.request.reasoning
              : input.request.showReasoning
                ? { enabled: true, summary: "auto" }
                : undefined,
```

- [ ] **Step 3: Add a truncation constant + builder in AIChatQueryEngine.ts**

Near the top of `AIChatQueryEngine.ts` (after imports / existing constants), add:

```ts
/** Maximum persisted reasoning characters per assistant message (32 KB). */
const CHAT_V2_REASONING_MAX_CHARS = 32 * 1024;

/**
 * Build persisted reasoning metadata from the loop's final reasoning string.
 * Returns undefined when there is nothing to persist. Truncates above the cap
 * and flags truncated=true so history stays bounded.
 */
function buildReasoningMetadata(
  reasoningContent: string | undefined,
  model: string | undefined
): { reasoning: ChatV2ReasoningMetadata } | undefined {
  if (!reasoningContent || reasoningContent.length === 0) {
    return undefined;
  }
  const over = reasoningContent.length > CHAT_V2_REASONING_MAX_CHARS;
  return {
    reasoning: {
      content: over
        ? reasoningContent.slice(0, CHAT_V2_REASONING_MAX_CHARS)
        : reasoningContent,
      format: "plain_text",
      source: "server",
      model,
      truncated: over ? true : false,
    },
  };
}
```

Ensure `ChatV2ReasoningMetadata` is imported from `@/entityTypes/aiChatV2Types` (add to the existing import if not present).

- [ ] **Step 4: Persist reasoning in the `completed` path** (~664–668)

Change the metadata literal to spread the builder output:

```ts
            metadata: {
              source: "chat-v2",
              openaiResponseId: result.responseId,
              finishReason: result.finishReason,
              ...buildReasoningMetadata(result.reasoningContent, result.model),
            },
```

- [ ] **Step 5: Persist reasoning in the `cancelled` path** (~718–723)

```ts
            metadata: {
              source: "chat-v2",
              openaiResponseId: result.responseId,
              finishReason: "cancelled",
              cancelled: true,
              ...buildReasoningMetadata(result.reasoningContent, result.model),
            },
```

- [ ] **Step 6: Persist reasoning in the `failed` path** (~744–749)

```ts
            metadata: {
              source: "chat-v2",
              openaiResponseId: result.responseId,
              finishReason: "error",
              error: userSafeError(result.error),
              ...buildReasoningMetadata(result.reasoningContent, result.model),
            },
```

- [ ] **Step 7: Run Task 7's test — now GREEN**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run test/vitest/main/ipc/ai-chat-v2-ipc.test.ts`
Expected: PASS (including the new reasoning block).

- [ ] **Step 8: Commit**

```bash
git add src/api/aiChatApi.ts src/service/AIChatQueryEngine.ts src/service/AIChatQueryLoop.ts
git commit -m "feat(ai-chat): forward reasoning option and persist reasoning metadata (32KB cap)"
```

---

## Task 9: Reasoning panel in AiChatV2Message.vue (TDD)

**Files:**
- Test: `test/vitest/main/components/AiChatV2Message.reasoning.test.ts` (create)
- Modify: `src/views/components/aiChatV2/AiChatV2Message.vue`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/components/AiChatV2Message.reasoning.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatV2Message from "@/views/components/aiChatV2/AiChatV2Message.vue";
import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: { aiChatV2: { reasoning_title: "Reasoning" } } },
});

function makeAssistantMessage(reasoning?: {
  content: string;
}): ChatV2MessageView {
  return {
    id: "m1",
    conversationId: "c1",
    role: "assistant",
    content: "Final answer.",
    timestamp: new Date().toISOString(),
    messageType: MessageType.TEXT,
    metadata: reasoning
      ? {
          source: "chat-v2",
          reasoning: {
            content: reasoning.content,
            format: "plain_text",
            source: "server",
            truncated: false,
          },
        }
      : { source: "chat-v2" },
  } as unknown as ChatV2MessageView;
}

function mountWith(message: ChatV2MessageView) {
  return mount(AiChatV2Message, {
    props: { message },
    global: {
      plugins: [i18n],
      stubs: {
        SkillApprovalCard: true,
        AiChatV2StreamStatus: true,
        AiChatV2PlanApprovalCard: true,
        VIcon: true,
      },
    },
  });
}

describe("AiChatV2Message reasoning panel", () => {
  it("renders the reasoning panel when metadata.reasoning.content exists", async () => {
    const wrapper = mountWith(makeAssistantMessage({ content: "I considered X." }));
    await flushPromises();
    expect(wrapper.find(".v2-message__reasoning").exists()).toBe(true);
    expect(wrapper.text()).toContain("I considered X.");
  });

  it("omits the panel when there is no reasoning metadata", async () => {
    const wrapper = mountWith(makeAssistantMessage());
    await flushPromises();
    expect(wrapper.find(".v2-message__reasoning").exists()).toBe(false);
  });

  it("renders reasoning as escaped text, not HTML", async () => {
    const wrapper = mountWith(
      makeAssistantMessage({ content: "<script>alert(1)</script>" })
    );
    await flushPromises();
    // Text interpolation escapes the string — no live script element.
    expect(wrapper.find(".v2-message__reasoning script").exists()).toBe(false);
    expect(wrapper.text()).toContain("<script>alert(1)</script>");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest --config test/vitest/main/components/vitest.config.mjs run test/vitest/main/components/AiChatV2Message.reasoning.test.ts`
Expected: FAIL — `.v2-message__reasoning` does not exist yet.

- [ ] **Step 3: Implement the panel**

In `AiChatV2Message.vue`, first confirm `MessageType.TEXT` exists (it is used in the test). If the enum uses a different name for plain assistant messages, adjust the test's `messageType` to match the real value that takes the `v-else` content branch (run `grep -n "TEXT\|MESSAGE" src/entityTypes/commonType.ts` to confirm).

Add the panel **inside** `.v2-message__bubble`, just before the `<AiChatV2StreamStatus ... />` line (so it renders for assistant text messages). In `<script setup>`, add computed values:

```ts
const reasoningText = computed(
  () => props.message.metadata?.reasoning?.content?.trim() ?? ""
);
const hasReasoning = computed(
  () => props.message.role === "assistant" && reasoningText.value.length > 0
);
```

In the template, immediately before `<AiChatV2StreamStatus`:

```vue
      <details v-if="hasReasoning" class="v2-message__reasoning" open>
        <summary>
          <v-icon size="x-small">mdi-brain</v-icon>
          {{ t("aiChatV2.reasoning_title") || "Reasoning" }}
        </summary>
        <div class="v2-message__reasoning-content">{{ reasoningText }}</div>
      </details>
```

(Text interpolation `{{ reasoningText }}` auto-escapes — no `v-html`. `open` keeps it expanded on the active message; for completed history the parent can leave it; MVP renders open whenever present.)

Add scoped styles at the end of the `<style scoped>` block:

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

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest --config test/vitest/main/components/vitest.config.mjs run test/vitest/main/components/AiChatV2Message.reasoning.test.ts`
Expected: PASS (3 cases).

- [ ] **Step 5: Commit**

```bash
git add src/views/components/aiChatV2/AiChatV2Message.vue test/vitest/main/components/AiChatV2Message.reasoning.test.ts
git commit -m "feat(ai-chat): render collapsible reasoning panel on assistant messages"
```

---

## Task 10: Toggle + chunk handler in AiChatV2.vue

**Files:**
- Modify: `src/views/components/aiChatV2/AiChatV2.vue` (header ~16–76; state in `<script setup>`; stream request ~1485; chunk handler ~1536–1662)

- [ ] **Step 1: Add toggle state + persistence in `<script setup>`**

Near the other `ref` declarations (e.g. next to the model localStorage handling ~602–723), add:

```ts
const SHOW_REASONING_STORAGE_KEY = "aiChatV2.showReasoning";
const showReasoning = ref<boolean>((() => {
  try {
    return window.localStorage.getItem(SHOW_REASONING_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
})());
const reasoningSaving = ref(false);

function toggleReasoning(): void {
  reasoningSaving.value = true;
  const next = !showReasoning.value;
  try {
    if (next) {
      window.localStorage.setItem(SHOW_REASONING_STORAGE_KEY, "true");
    } else {
      window.localStorage.removeItem(SHOW_REASONING_STORAGE_KEY);
    }
  } catch {
    /* localStorage unavailable — keep in-memory state */
  }
  showReasoning.value = next;
  // Preference save is synchronous local storage; release the disabled state
  // on the next microtask so the button's :loading/:disabled flicker is brief.
  queueMicrotask(() => {
    reasoningSaving.value = false;
  });
}

const reasoningToggleTitle = computed(() =>
  showReasoning.value
    ? t("aiChatV2.hide_reasoning") || "Hide reasoning"
    : t("aiChatV2.show_reasoning") || "Show reasoning"
);
```

(`computed` is already imported in this file — confirm via the existing `import { ... } from "vue"`.)

- [ ] **Step 2: Add the header toggle button**

In the header-actions area (around line 22, near the compact/history buttons), insert:

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

- [ ] **Step 3: Pass `showReasoning` + `reasoning` in the stream request**

In the `streamChatV2Message({...})` call (~1485–1491), extend the request object:

```ts
      {
        conversationId: activeConversationId.value ?? undefined,
        message: text,
        mode: mode.value,
        model: resolveModelForRequest(),
        showReasoning: showReasoning.value,
        reasoning: showReasoning.value
          ? { enabled: true, summary: "auto" }
          : undefined,
      },
```

- [ ] **Step 4: Handle `reasoning_delta` chunks (no content/speech leak)**

In the chunk handler's "non-start/non-retry" `else` branch (~1536), insert a **reasoning branch before the `token` branch**. Reasoning may arrive before the first token, so ensure the assistant placeholder exists and append into metadata — never into `assistant.content`, never into speech:

```ts
          if (chunk.eventType === "reasoning_delta" && chunk.reasoningDelta) {
            ensureAssistantAdded();
            const prevReasoning =
              (assistant.metadata?.reasoning?.content as string | undefined) ??
              "";
            const nextReasoning = prevReasoning + chunk.reasoningDelta;
            assistant.metadata = {
              ...(assistant.metadata ?? { source: "chat-v2" }),
              reasoning: {
                content: nextReasoning,
                format: "plain_text",
                source: "server",
                model: chunk.model,
                truncated: false,
              },
            };
            const idx = messages.value.findIndex((m) => m.id === assistant.id);
            if (idx !== -1) {
              messages.value[idx] = {
                ...messages.value[idx],
                metadata: assistant.metadata,
              };
            }
          } else if (chunk.eventType === "token" && chunk.contentDelta) {
            // ... existing token handling unchanged
```

(Split the existing `if (chunk.eventType === "token" ...)` into `else if` so reasoning is handled first. Do **not** call any speech controller with `chunk.reasoningDelta`.)

- [ ] **Step 5: Confirm the assistant placeholder object supports `metadata`**

Run: `grep -n "const assistant\|ensureAssistantAdded\|assistant.metadata\|metadata:" src/views/components/aiChatV2/AiChatV2.vue | head -30`

If the local `assistant` object is typed without `metadata`, widen its type to include `metadata?: ChatV2MessageMetadata` (import the type if needed). The `messages.value[idx]` replacement already spreads `metadata`, so no further change is required for reactivity.

- [ ] **Step 6: Type-check (vue-tsc)**

Run: `npx vue-tsc --noEmit` (one-shot; do NOT use the watch script)
Expected: no errors. Fix any type fallout (e.g. import `ChatV2MessageMetadata`).

- [ ] **Step 7: Commit**

```bash
git add src/views/components/aiChatV2/AiChatV2.vue
git commit -m "feat(ai-chat): add reasoning toggle and stream reasoning into message metadata"
```

---

## Task 11: i18n — add 7 keys to all six language files

**Files:**
- Modify: `src/views/lang/{en,zh,es,fr,de,ja}.ts`

- [ ] **Step 1: Add the keys to `en.ts`** inside the `aiChatV2:` block (e.g. right after `title:` at line 1827):

```ts
    show_reasoning: "Show reasoning",
    hide_reasoning: "Hide reasoning",
    reasoning_title: "Reasoning",
    reasoning_streaming: "Reasoning…",
    reasoning_unavailable: "Reasoning is not available for this model.",
    copy_reasoning: "Copy reasoning",
    reasoning_copied: "Reasoning copied",
```

- [ ] **Step 2: Add the same keys (translated) to the other five files**, in the same position in their `aiChatV2:` block:

`zh.ts`:
```ts
    show_reasoning: "显示推理",
    hide_reasoning: "隐藏推理",
    reasoning_title: "推理",
    reasoning_streaming: "推理中…",
    reasoning_unavailable: "此模型不支持推理。",
    copy_reasoning: "复制推理",
    reasoning_copied: "推理已复制",
```

`es.ts`:
```ts
    show_reasoning: "Mostrar razonamiento",
    hide_reasoning: "Ocultar razonamiento",
    reasoning_title: "Razonamiento",
    reasoning_streaming: "Razonando…",
    reasoning_unavailable: "El razonamiento no está disponible para este modelo.",
    copy_reasoning: "Copiar razonamiento",
    reasoning_copied: "Razonamiento copiado",
```

`fr.ts`:
```ts
    show_reasoning: "Afficher le raisonnement",
    hide_reasoning: "Masquer le raisonnement",
    reasoning_title: "Raisonnement",
    reasoning_streaming: "Raisonnement…",
    reasoning_unavailable: "Le raisonnement n'est pas disponible pour ce modèle.",
    copy_reasoning: "Copier le raisonnement",
    reasoning_copied: "Raisonnement copié",
```

`de.ts`:
```ts
    show_reasoning: "Denkvorgang anzeigen",
    hide_reasoning: "Denkvorgang ausblenden",
    reasoning_title: "Denkvorgang",
    reasoning_streaming: "Denkvorgang…",
    reasoning_unavailable: "Für dieses Modell ist kein Denkvorgang verfügbar.",
    copy_reasoning: "Denkvorgang kopieren",
    reasoning_copied: "Denkvorgang kopiert",
```

`ja.ts`:
```ts
    show_reasoning: "推論を表示",
    hide_reasoning: "推論を非表示",
    reasoning_title: "推論",
    reasoning_streaming: "推論中…",
    reasoning_unavailable: "このモデルでは推論を利用できません。",
    copy_reasoning: "推論をコピー",
    reasoning_copied: "推論をコピーしました",
```

- [ ] **Step 3: Commit**

```bash
git add src/views/lang/en.ts src/views/lang/zh.ts src/views/lang/es.ts src/views/lang/fr.ts src/views/lang/de.ts src/views/lang/ja.ts
git commit -m "feat(ai-chat): add reasoning i18n keys for all six languages"
```

---

## Task 12: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run TypeScript type-check (one-shot)**

Run: `npx tsc --noEmit`
Expected: 0 errors. (If `tsc` is slow, `npx tsc --noEmit -p tsconfig.json`.)

- [ ] **Step 2: Run Vue type-check (one-shot)**

Run: `npx vue-tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Run main-process tests**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run`
Expected: all green (includes new accumulator test + IPC reasoning block + existing regression suite).

- [ ] **Step 4: Run component tests**

Run: `yarn vitest --config test/vitest/main/components/vitest.config.mjs run`
Expected: all green (includes new reasoning panel test + existing component tests).

- [ ] **Step 5: Spot-check acceptance criteria**

Walk the PRD acceptance list mentally against the implementation:
1. Toggle off → unchanged (accumulator still parses, but no `reasoning` request option and panel hidden when no metadata). ✅
2. Toggle on + `reasoning_content` → separate panel + normal bubble. ✅
3. Reasoning never in `assistant.content`. ✅ (chunk handler writes metadata only)
4. Voice speaks answer only. ✅ (reasoning never wired to speech)
5. Copy copies answer only. ✅ (copy reads `message.content`)
6/7. Reasoning-only-before-answer and interleaved both handled (priority extractor + per-chunk deltas). ✅
8. No-reasoning providers → no empty panel. ✅ (`hasReasoning` gate)
9/10. Persisted + reloaded. ✅ (engine writes `metadata.reasoning`; message panel reads it)
11. Clear conversation removes reasoning with the row. ✅ (existing clear deletes messages)
12. Six-language strings. ✅
13. Tests cover accumulator, IPC mapping (+ loop emission + persistence via the IPC test), renderer panel. ✅

- [ ] **Step 6: Final commit (if any fixups)**

```bash
git status
# commit any remaining fixups with an appropriate message
```

---

## Self-review notes

- **Spec coverage:** PRD FR-1..FR-10, UX-1..UX-6, SSR-1..SSR-4, §10 persistence, §13 i18n, Test Plan §18.1/§18.2/§18.3 all map to tasks above. FR-8/FR-9 (request option + local compatibility) → Task 8. FR-7 (persistence) → Tasks 7–8. UX-3 panel → Task 9. Copy/voice safety (UX-5) → satisfied by construction (Task 10 step 4 + default copy). Phase 4 capability UX (model hint) is explicitly **deferred** per design §17 / non-MVP.
- **Type consistency:** `reasoningDelta` (chunk field), `AIChatQueryReasoningDeltaEvent`, `ChatV2ReasoningMetadata`, `reasoningContent` (result field) are used identically in every task. `extractReasoningDelta`, `buildReasoningMetadata`, `toggleReasoning`, `reasoningToggleTitle`, `SHOW_REASONING_STORAGE_KEY`, `CHAT_V2_REASONING_MAX_CHARS` named consistently.
- **Placeholders:** none — every code step shows the exact code or the exact grep to locate it.
- **Stale-path corrections** (top of plan) reconcile the design doc with the real tree.
