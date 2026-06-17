# OpenAI-Compatible Chat V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a parallel v2 AI chat stack that uses the server's OpenAI-compatible `/v1/chat/completions` API with local SQLite-owned conversation history, leaving the legacy chat stack untouched.

**Architecture:** New v2 channels (IPC) → new v2 module → existing `AIChatMessageEntity` table (tagged via `source: "chat-v2"` metadata) → pure `OpenAIChatTranscriptBuilder` builds `messages[]` → `AiChatApi.openAIChatCompletionStream` streams → `OpenAIStreamAccumulator` reduces chunks → app-level `ChatV2StreamChunk` events flow to a new Vuetify-based `aiChatV2` component tree. A feature-flagged launcher entry keeps old chat available.

**Tech Stack:** TypeScript 5.x, Electron IPC, Vue 3 + Vuetify + Pinia, TypeORM/SQLite, Vitest, vue-i18n.

---

## File Structure

### New Files

| File | Responsibility |
|---|---|
| `src/entityTypes/aiChatV2Types.ts` | Renderer-facing v2 request/response/stream-chunk types + metadata shape |
| `src/service/OpenAIChatTranscriptBuilder.ts` | Pure: convert local `AIChatMessageEntity[]` → OpenAI `messages[]` |
| `src/service/OpenAIStreamAccumulator.ts` | Pure: reduce raw `OpenAIChatCompletionChunk[]` into accumulated text + buffered tool calls |
| `src/modules/AIChatV2Module.ts` | Business logic: conversation creation, message save, v2-scoped conversation listing |
| `src/main-process/communication/ai-chat-v2-ipc.ts` | IPC handlers: AI-enable gate, stream lifecycle, abort, completion events |
| `src/views/api/aiChatV2.ts` | Renderer IPC wrapper: models, conversations, history, stream, stop, clear |
| `src/views/components/aiChatV2/AiChatV2.vue` | Root v2 chat shell + state |
| `src/views/components/aiChatV2/AiChatV2Messages.vue` | Scrollable message list |
| `src/views/components/aiChatV2/AiChatV2Message.vue` | Single message row by role |
| `src/views/components/aiChatV2/AiChatV2Composer.vue` | Multi-line input + send/stop |
| `src/views/components/aiChatV2/AiChatV2ConversationList.vue` | Conversation selector + new chat |
| `src/views/components/aiChatV2/AiChatV2StreamStatus.vue` | Subtle streaming/cancelled/error status |
| `test/vitest/main/service/OpenAIChatTranscriptBuilder.test.ts` | Unit tests for transcript builder |
| `test/vitest/main/service/OpenAIStreamAccumulator.test.ts` | Unit tests for stream accumulator |
| `test/vitest/main/ipc/ai-chat-v2-ipc.test.ts` | IPC handler tests (AI-gate, lifecycle) |

### Modified Files

| File | Change |
|---|---|
| `src/api/aiChatApi.ts` | Fix OpenAI endpoint paths (`/api/ai/v1/chat/completions` → `/v1/chat/completions`) |
| `src/config/channellist.ts` | Add `AI_CHAT_V2_*` channel constants |
| `src/preload.ts` | Add v2 channels to send/receive/invoke allowlists + `removeAllListeners` allowlist |
| `src/main-process/communication/index.ts` | Call `registerAiChatV2IpcHandlers()` |
| `src/views/lang/en.ts`, `zh.ts`, `es.ts`, `fr.ts`, `de.ts`, `ja.ts` | Add `aiChatV2` translation group |
| `src/views/layout/layout.vue` | Add feature-flagged v2 launcher button |

---

## Task 1: Fix OpenAI-Compatible API Endpoint Paths

The server registers the OpenAI router at `/v1`, and `HttpClient` prepends `/apis`, so correct endpoints resolve to `<loginUrl>/apis/v1/chat/completions`. The current `openAIChatCompletion` and `openAIChatCompletionStream` methods incorrectly use `/api/ai/v1/chat/completions`.

**Files:**
- Modify: `src/api/aiChatApi.ts:1612` and `src/api/aiChatApi.ts:1661`

- [ ] **Step 1: Fix non-streaming endpoint path**

In `src/api/aiChatApi.ts`, change the `openAIChatCompletion` return statement (line ~1612):

```typescript
    return this._httpClient.postJson("/v1/chat/completions", data);
```

- [ ] **Step 2: Fix streaming endpoint path**

In the same file, change the `openAIChatCompletionStream` `postStream` call (line ~1661):

```typescript
    const response = await this._httpClient.postStream(
      "/v1/chat/completions",
      data,
      fetchOptions
    );
```

- [ ] **Step 3: Verify no other references to the wrong path**

Run: `grep -rn "/api/ai/v1/chat/completions" src/`
Expected: no matches.

- [ ] **Step 4: Type check**

Run: `yarn vue-check` (in another terminal, watch mode) — confirm no errors introduced.

- [ ] **Step 5: Commit**

```bash
git add src/api/aiChatApi.ts
git commit -m "fix: correct OpenAI-compatible chat completion endpoint paths to /v1"
```

---

## Task 2: Add V2 IPC Channel Constants

**Files:**
- Modify: `src/config/channellist.ts` (after the existing AI chat channels, ~line 259)

- [ ] **Step 1: Add v2 channel constants**

Add this block immediately after the existing `AI_KEYWORDS_GENERATE` line (or after the AI chat channel group, keeping alphabetical/feature grouping):

```typescript
// ==================== AI Chat V2 Channels ====================
export const AI_CHAT_V2_MODELS = "ai-chat-v2:models";
export const AI_CHAT_V2_CONVERSATIONS = "ai-chat-v2:conversations";
export const AI_CHAT_V2_HISTORY = "ai-chat-v2:history";
export const AI_CHAT_V2_STREAM = "ai-chat-v2:stream";
export const AI_CHAT_V2_STREAM_STOP = "ai-chat-v2:stream-stop";
export const AI_CHAT_V2_STREAM_CHUNK = "ai-chat-v2:stream-chunk";
export const AI_CHAT_V2_STREAM_COMPLETE = "ai-chat-v2:stream-complete";
export const AI_CHAT_V2_CLEAR_CONVERSATION = "ai-chat-v2:clear-conversation";
export const AI_CHAT_V2_CLEAR_ALL = "ai-chat-v2:clear-all";
```

- [ ] **Step 2: Verify**

Run: `grep -n "AI_CHAT_V2_" src/config/channellist.ts`
Expected: 9 matches.

- [ ] **Step 3: Commit**

```bash
git add src/config/channellist.ts
git commit -m "feat: add AI chat v2 IPC channel constants"
```

---

## Task 3: Add V2 Channels to Preload Allowlist

**Files:**
- Modify: `src/preload.ts` (send allowlist, receive allowlist, invoke allowlist, removeAllListeners allowlist)

- [ ] **Step 1: Add imports**

At the top of `src/preload.ts`, alongside the existing `AI_CHAT_*` imports from `@/config/channellist`, add:

```typescript
  AI_CHAT_V2_MODELS,
  AI_CHAT_V2_CONVERSATIONS,
  AI_CHAT_V2_HISTORY,
  AI_CHAT_V2_STREAM,
  AI_CHAT_V2_STREAM_STOP,
  AI_CHAT_V2_STREAM_CHUNK,
  AI_CHAT_V2_STREAM_COMPLETE,
  AI_CHAT_V2_CLEAR_CONVERSATION,
  AI_CHAT_V2_CLEAR_ALL,
```

- [ ] **Step 2: Add to send() allowlist**

In the `send` validChannels array (where `AI_CHAT_STREAM` and `AI_CHAT_STREAM_STOP` already appear), add after them:

```typescript
    AI_CHAT_V2_STREAM,
    AI_CHAT_V2_STREAM_STOP,
```

- [ ] **Step 3: Add to receive() allowlist**

In the `receive` validChannels array (where `AI_CHAT_STREAM_CHUNK` and `AI_CHAT_STREAM_COMPLETE` already appear), add after them:

```typescript
    AI_CHAT_V2_STREAM_CHUNK,
    AI_CHAT_V2_STREAM_COMPLETE,
```

- [ ] **Step 4: Add to invoke() allowlist**

In the `invoke` validChannels array (where `AI_CHAT_MESSAGE`, `AI_CHAT_HISTORY`, `AI_CHAT_CLEAR`, `AI_CHAT_CONVERSATIONS` appear), add after them:

```typescript
    AI_CHAT_V2_MODELS,
    AI_CHAT_V2_CONVERSATIONS,
    AI_CHAT_V2_HISTORY,
    AI_CHAT_V2_CLEAR_CONVERSATION,
    AI_CHAT_V2_CLEAR_ALL,
```

- [ ] **Step 5: Add to removeAllListeners() allowlist**

In the `removeAllListeners` validChannels array (where `AI_CHAT_STREAM_CHUNK` and `AI_CHAT_STREAM_COMPLETE` appear), add:

```typescript
        AI_CHAT_V2_STREAM_CHUNK,
        AI_CHAT_V2_STREAM_COMPLETE,
```

- [ ] **Step 6: Verify**

Run: `grep -c "AI_CHAT_V2_" src/preload.ts`
Expected: at least 13 (imports + allowlist entries).

- [ ] **Step 7: Commit**

```bash
git add src/preload.ts
git commit -m "feat: allowlist AI chat v2 channels in preload bridge"
```

---

## Task 4: Create V2 Types

**Files:**
- Create: `src/entityTypes/aiChatV2Types.ts`

- [ ] **Step 1: Write the types file**

Create `src/entityTypes/aiChatV2Types.ts`:

```typescript
import { MessageType } from "@/entityTypes/commonType";

/** Metadata stored on v2 chat rows in the existing ai_chat_messages table. */
export interface ChatV2MessageMetadata {
  source: "chat-v2";
  openaiResponseId?: string;
  finishReason?: string | null;
  cancelled?: boolean;
  error?: string;
  toolCallId?: string;
  toolName?: string;
  toolArguments?: Record<string, unknown>;
  toolResultStatus?: "success" | "error";
  toolResultSummary?: string;
}

/** Renderer request to start a streaming chat turn. */
export interface ChatV2StreamRequest {
  conversationId?: string;
  message: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface ChatV2HistoryRequest {
  conversationId: string;
  limit?: number;
  offset?: number;
}

export interface ChatV2ClearConversationRequest {
  conversationId: string;
}

/** Conversation summary for the sidebar. */
export interface ChatV2ConversationSummary {
  conversationId: string;
  title: string;
  lastMessage: string;
  lastMessageTimestamp: string;
  messageCount: number;
  createdAt: string;
}

/** Single message view rendered by the UI. */
export interface ChatV2MessageView {
  id: string;
  conversationId: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  timestamp: string;
  messageType: MessageType;
  model?: string;
  tokensUsed?: number;
  metadata?: ChatV2MessageMetadata;
}

export interface ChatV2HistoryResponse {
  conversationId: string;
  messages: ChatV2MessageView[];
  totalMessages: number;
}

/** App-level stream chunk sent over IPC to the renderer. */
export type ChatV2StreamEventType =
  | "start"
  | "token"
  | "tool_call_delta"
  | "tool_call"
  | "tool_result"
  | "error"
  | "cancelled"
  | "complete";

export interface ChatV2StreamChunk {
  eventType: ChatV2StreamEventType;
  conversationId: string;
  messageId?: string;
  contentDelta?: string;
  fullContent?: string;
  model?: string;
  finishReason?: string | null;
  errorMessage?: string;
  toolCallId?: string;
  toolName?: string;
  toolArguments?: Record<string, unknown>;
}
```

- [ ] **Step 2: Verify**

Run: `grep -n "ChatV2StreamChunk" src/entityTypes/aiChatV2Types.ts`
Expected: matches.

- [ ] **Step 3: Commit**

```bash
git add src/entityTypes/aiChatV2Types.ts
git commit -m "feat: add AI chat v2 shared types"
```

---

## Task 5: OpenAIChatTranscriptBuilder (TDD)

Pure module: converts local DB rows → OpenAI `messages[]`. Phase 1 skips tool rows with warnings.

**Files:**
- Create: `test/vitest/main/service/OpenAIChatTranscriptBuilder.test.ts`
- Create: `src/service/OpenAIChatTranscriptBuilder.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/vitest/main/service/OpenAIChatTranscriptBuilder.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { MessageType } from "@/entityTypes/commonType";
import { buildOpenAITranscript } from "@/service/OpenAIChatTranscriptBuilder";

function makeRow(
  overrides: Partial<AIChatMessageEntity> & { id: number }
): AIChatMessageEntity {
  const row = new AIChatMessageEntity();
  Object.assign(row, {
    messageId: `m-${overrides.id}`,
    conversationId: "v2-conv-1",
    role: "user",
    content: "",
    timestamp: new Date(2020, 0, overrides.id),
    messageType: MessageType.MESSAGE,
    ...overrides,
  });
  return row;
}

describe("OpenAIChatTranscriptBuilder", () => {
  it("builds from empty history plus current user message", () => {
    const result = buildOpenAITranscript({
      history: [],
      currentUserMessage: "hello",
    });
    expect(result.messages).toEqual([
      { role: "user", content: "hello" },
    ]);
    expect(result.skippedMessageIds).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("prepends system prompt when provided", () => {
    const result = buildOpenAITranscript({
      history: [],
      currentUserMessage: "hi",
      systemPrompt: "be brief",
    });
    expect(result.messages[0]).toEqual({ role: "system", content: "be brief" });
    expect(result.messages[1]).toEqual({ role: "user", content: "hi" });
  });

  it("maps user and assistant history in timestamp order", () => {
    const result = buildOpenAITranscript({
      history: [
        makeRow({ id: 2, role: "assistant", content: "hi there" }),
        makeRow({ id: 1, role: "user", content: "hello" }),
      ],
      currentUserMessage: "again",
    });
    expect(result.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
    expect(result.messages.map((m) => m.content)).toEqual([
      "hello",
      "hi there",
      "again",
    ]);
  });

  it("appends current user message exactly once", () => {
    const result = buildOpenAITranscript({
      history: [makeRow({ id: 1, role: "user", content: "old" })],
      currentUserMessage: "new",
    });
    const userMessages = result.messages.filter((m) => m.role === "user");
    expect(userMessages.map((m) => m.content)).toEqual(["old", "new"]);
  });

  it("filters out rows whose metadata source is not chat-v2 when filtering enabled", () => {
    const oldRow = makeRow({ id: 1, role: "user", content: "legacy" });
    oldRow.metadata = JSON.stringify({ source: "legacy" });
    const v2Row = makeRow({ id: 2, role: "user", content: "v2-msg" });
    v2Row.metadata = JSON.stringify({ source: "chat-v2" });
    const result = buildOpenAITranscript({
      history: [oldRow, v2Row],
      currentUserMessage: "next",
      filterSource: "chat-v2",
    });
    expect(result.messages.map((m) => m.content)).toEqual(["v2-msg", "next"]);
  });

  it("skips tool_call rows in phase 1 and records warnings", () => {
    const toolRow = makeRow({
      id: 1,
      role: "assistant",
      content: "{}",
      messageType: MessageType.TOOL_CALL,
    });
    toolRow.metadata = JSON.stringify({ source: "chat-v2" });
    const result = buildOpenAITranscript({
      history: [toolRow],
      currentUserMessage: "hi",
    });
    expect(result.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(result.skippedMessageIds).toEqual(["m-1"]);
    expect(result.warnings.length).toBe(1);
  });

  it("does not throw on malformed metadata JSON", () => {
    const row = makeRow({ id: 1, role: "user", content: "hi" });
    row.metadata = "{not json";
    const result = buildOpenAITranscript({
      history: [row],
      currentUserMessage: "again",
    });
    expect(result.messages.length).toBe(2);
    expect(result.warnings).toEqual([]);
  });

  it("limits history to maxMessages when provided (keeping most recent)", () => {
    const history: AIChatMessageEntity[] = [];
    for (let i = 1; i <= 10; i++) {
      history.push(makeRow({ id: i, role: "user", content: `u-${i}` }));
    }
    const result = buildOpenAITranscript({
      history,
      currentUserMessage: "now",
      maxMessages: 3,
    });
    expect(result.messages.length).toBe(4);
    expect(result.messages.map((m) => m.content)).toEqual([
      "u-8",
      "u-9",
      "u-10",
      "now",
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn testmain -- OpenAIChatTranscriptBuilder`
Expected: FAIL (module `@/service/OpenAIChatTranscriptBuilder` not found).

- [ ] **Step 3: Write the implementation**

Create `src/service/OpenAIChatTranscriptBuilder.ts`:

```typescript
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { MessageType } from "@/entityTypes/commonType";
import type { OpenAIChatMessage } from "@/api/aiChatApi";

export interface BuildOpenAITranscriptInput {
  history: AIChatMessageEntity[];
  currentUserMessage?: string;
  systemPrompt?: string;
  /** When set, only rows whose metadata.source equals this value are included. */
  filterSource?: "chat-v2";
  /** Optional cap on the number of history rows (most recent kept). */
  maxMessages?: number;
}

export interface BuildOpenAITranscriptResult {
  messages: OpenAIChatMessage[];
  skippedMessageIds: string[];
  warnings: string[];
}

interface ParsedRowMeta {
  source?: string;
}

function parseMeta(raw: string | undefined | null): ParsedRowMeta | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as ParsedRowMeta;
    }
  } catch {
    // Malformed metadata: treat as null, never throw.
  }
  return null;
}

/**
 * Pure converter: local DB rows -> OpenAI messages[].
 * Phase 1 only maps MESSAGE rows of role system/user/assistant. Tool rows are
 * skipped with a warning so they never leak into a request prematurely.
 */
export function buildOpenAITranscript(
  input: BuildOpenAITranscriptInput
): BuildOpenAITranscriptResult {
  const messages: OpenAIChatMessage[] = [];
  const skippedMessageIds: string[] = [];
  const warnings: string[] = [];

  if (input.systemPrompt) {
    messages.push({ role: "system", content: input.systemPrompt });
  }

  const sorted = [...input.history].sort((a, b) => {
    const ta = a.timestamp.getTime();
    const tb = b.timestamp.getTime();
    if (ta !== tb) {
      return ta - tb;
    }
    return a.id - b.id;
  });

  let rows = sorted;
  if (input.maxMessages !== undefined && input.maxMessages > 0) {
    rows = sorted.slice(-input.maxMessages);
  }

  for (const row of rows) {
    if (input.filterSource) {
      const meta = parseMeta(row.metadata);
      if (!meta || meta.source !== input.filterSource) {
        continue;
      }
    }

    if (row.messageType !== MessageType.MESSAGE) {
      skippedMessageIds.push(row.messageId);
      warnings.push(
        `Skipped non-message row ${row.messageId} (messageType=${row.messageType})`
      );
      continue;
    }

    const role = row.role;
    if (role !== "system" && role !== "user" && role !== "assistant") {
      skippedMessageIds.push(row.messageId);
      warnings.push(`Skipped row ${row.messageId} (unsupported role=${role})`);
      continue;
    }

    messages.push({ role, content: row.content });
  }

  if (input.currentUserMessage) {
    messages.push({ role: "user", content: input.currentUserMessage });
  }

  return { messages, skippedMessageIds, warnings };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn testmain -- OpenAIChatTranscriptBuilder`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/service/OpenAIChatTranscriptBuilder.ts test/vitest/main/service/OpenAIChatTranscriptBuilder.test.ts
git commit -m "feat: add OpenAIChatTranscriptBuilder with phase-1 mapping and tests"
```

---

## Task 6: OpenAIStreamAccumulator (TDD)

Pure module: accumulates assistant text, tracks model/responseId/finishReason, and buffers fragmented tool-call deltas by index.

**Files:**
- Create: `test/vitest/main/service/OpenAIStreamAccumulator.test.ts`
- Create: `src/service/OpenAIStreamAccumulator.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/vitest/main/service/OpenAIStreamAccumulator.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { OpenAIStreamAccumulator } from "@/service/OpenAIStreamAccumulator";
import type { OpenAIChatCompletionChunk } from "@/api/aiChatApi";

function chunk(
  overrides: Partial<OpenAIChatCompletionChunk>
): OpenAIChatCompletionChunk {
  return {
    id: "chatcmpl-1",
    object: "chat.completion.chunk",
    created: 1,
    model: "test-model",
    choices: [
      {
        index: 0,
        delta: { role: "assistant", content: "" },
        finish_reason: null,
      },
    ],
    ...overrides,
  };
}

describe("OpenAIStreamAccumulator", () => {
  it("appends content deltas to full content", () => {
    const acc = new OpenAIStreamAccumulator();
    acc.ingest(chunk({ choices: [{ index: 0, delta: { content: "Hel" }, finish_reason: null }] }));
    acc.ingest(chunk({ choices: [{ index: 0, delta: { content: "lo" }, finish_reason: null }] }));
    expect(acc.state.fullContent).toBe("Hello");
  });

  it("role-only delta does not create text", () => {
    const acc = new OpenAIStreamAccumulator();
    acc.ingest(chunk({ choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }));
    expect(acc.state.fullContent).toBe("");
  });

  it("captures responseId and model from chunks", () => {
    const acc = new OpenAIStreamAccumulator();
    acc.ingest(chunk({ id: "chatcmpl-abc", model: "gpt-test" }));
    expect(acc.state.responseId).toBe("chatcmpl-abc");
    expect(acc.state.model).toBe("gpt-test");
  });

  it("stores finishReason when present", () => {
    const acc = new OpenAIStreamAccumulator();
    acc.ingest(chunk({ choices: [{ index: 0, delta: { content: "x" }, finish_reason: "stop" }] }));
    expect(acc.state.finishReason).toBe("stop");
  });

  it("returns non-empty content deltas for IPC forwarding", () => {
    const acc = new OpenAIStreamAccumulator();
    const d1 = acc.ingest(chunk({ choices: [{ index: 0, delta: { content: "ab" }, finish_reason: null }] }));
    const d2 = acc.ingest(chunk({ choices: [{ index: 0, delta: { content: "" }, finish_reason: null }] }));
    expect(d1).toBe("ab");
    expect(d2).toBe("");
  });

  it("buffers fragmented tool call argument deltas by index", () => {
    const acc = new OpenAIStreamAccumulator();
    acc.ingest(chunk({
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: "call_1",
            type: "function",
            function: { name: "search", arguments: "{\"q\":\"den" },
          }],
        },
        finish_reason: null,
      }],
    }));
    acc.ingest(chunk({
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            function: { arguments: "tists\"}" },
          }],
        },
        finish_reason: "tool_calls",
      }],
    }));
    const calls = acc.getBufferedToolCalls();
    expect(calls.length).toBe(1);
    expect(calls[0].id).toBe("call_1");
    expect(calls[0].name).toBe("search");
    expect(calls[0].argumentsJson).toBe("{\"q\":\"dentists\"}");
  });

  it("reports malformed tool-call JSON without throwing", () => {
    const acc = new OpenAIStreamAccumulator();
    acc.ingest(chunk({
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{ index: 0, id: "c1", function: { name: "t", arguments: "{bad" } }],
        },
        finish_reason: "tool_calls",
      }],
    }));
    const parsed = acc.tryParseToolCallArguments();
    expect(parsed.length).toBe(1);
    expect(parsed[0].ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn testmain -- OpenAIStreamAccumulator`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

Create `src/service/OpenAIStreamAccumulator.ts`:

```typescript
import type {
  OpenAIChatCompletionChunk,
  OpenAIStreamToolCallDelta,
} from "@/api/aiChatApi";

export interface OpenAIStreamTextState {
  responseId?: string;
  model?: string;
  fullContent: string;
  finishReason?: string | null;
}

export interface BufferedOpenAIToolCall {
  index: number;
  id?: string;
  type?: "function";
  name?: string;
  argumentsJson: string;
}

export interface ParsedToolCallResult {
  index: number;
  id?: string;
  name?: string;
  ok: boolean;
  arguments?: Record<string, unknown>;
}

/**
 * Reduces a stream of OpenAI-compatible chunks into a stable app-level state.
 * Pure with respect to external IO; only mutates its own accumulator state.
 */
export class OpenAIStreamAccumulator {
  private _state: OpenAIStreamTextState = { fullContent: "" };
  private _toolCalls: Map<number, BufferedOpenAIToolCall> = new Map();

  get state(): OpenAIStreamTextState {
    return this._state;
  }

  getBufferedToolCalls(): BufferedOpenAIToolCall[] {
    return Array.from(this._toolCalls.values()).sort((a, b) => a.index - b.index);
  }

  /**
   * Ingest a single raw chunk. Returns the non-empty content delta (or "").
   */
  ingest(chunk: OpenAIChatCompletionChunk): string {
    if (chunk.id) {
      this._state.responseId = chunk.id;
    }
    if (chunk.model) {
      this._state.model = chunk.model;
    }

    let contentDelta = "";
    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta;
      if (delta?.content) {
        this._state.fullContent += delta.content;
        contentDelta += delta.content;
      }
      if (choice.finish_reason) {
        this._state.finishReason = choice.finish_reason;
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          this._bufferToolCall(tc);
        }
      }
    }
    return contentDelta;
  }

  private _bufferToolCall(tc: OpenAIStreamToolCallDelta): void {
    const existing = this._toolCalls.get(tc.index);
    const next: BufferedOpenAIToolCall = existing
      ? existing
      : { index: tc.index, argumentsJson: "" };

    if (tc.id && !next.id) {
      next.id = tc.id;
    }
    if (tc.type === "function") {
      next.type = "function";
    }
    if (tc.function?.name && !next.name) {
      next.name = tc.function.name;
    }
    if (tc.function?.arguments) {
      next.argumentsJson += tc.function.arguments;
    }
    this._toolCalls.set(tc.index, next);
  }

  /**
   * Attempt to parse buffered tool-call arguments. Returns ok=false for any
   * malformed JSON so callers can treat arguments as untrusted model output.
   */
  tryParseToolCallArguments(): ParsedToolCallResult[] {
    return this.getBufferedToolCalls().map((call) => {
      const result: ParsedToolCallResult = {
        index: call.index,
        id: call.id,
        name: call.name,
        ok: false,
      };
      if (call.argumentsJson) {
        try {
          const parsed = JSON.parse(call.argumentsJson);
          if (parsed && typeof parsed === "object") {
            result.ok = true;
            result.arguments = parsed as Record<string, unknown>;
          }
        } catch {
          result.ok = false;
        }
      }
      return result;
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn testmain -- OpenAIStreamAccumulator`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/service/OpenAIStreamAccumulator.ts test/vitest/main/service/OpenAIStreamAccumulator.test.ts
git commit -m "feat: add OpenAIStreamAccumulator with text and tool-call buffering"
```

---

## Task 7: AIChatV2Module

Business logic layer. Delegates persistence to the existing `AIChatModule` and `AIChatMessageModel`, scopes conversations to `chat-v2` source/prefix.

**Files:**
- Create: `src/modules/AIChatV2Module.ts`

- [ ] **Step 1: Write the module**

Create `src/modules/AIChatV2Module.ts`:

```typescript
import { BaseModule } from "@/modules/baseModule";
import { AIChatModule } from "@/modules/AIChatModule";
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { MessageType } from "@/entityTypes/commonType";
import type {
  ChatV2ConversationSummary,
  ChatV2MessageMetadata,
} from "@/entityTypes/aiChatV2Types";

const V2_CONVERSATION_PREFIX = "v2-";
const V2_DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant.";

function uuid(): string {
  // Crypto.randomUUID is available in Electron (Node 16+ / Chromium).
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class AIChatV2Module extends BaseModule {
  private chatModule: AIChatModule;

  constructor() {
    super();
    this.chatModule = new AIChatModule();
  }

  /** Create (or reuse) a v2 conversation id. */
  createConversationIfNeeded(existingId?: string): string {
    if (existingId && existingId.startsWith(V2_CONVERSATION_PREFIX)) {
      return existingId;
    }
    return `${V2_CONVERSATION_PREFIX}${uuid()}`;
  }

  async saveUserMessage(params: {
    conversationId: string;
    content: string;
    messageId?: string;
    timestamp?: Date;
  }): Promise<AIChatMessageEntity> {
    return this.chatModule.saveMessage({
      messageId: params.messageId ?? `user-${uuid()}`,
      conversationId: params.conversationId,
      role: "user",
      content: params.content,
      timestamp: params.timestamp,
      metadata: { source: "chat-v2" } as ChatV2MessageMetadata,
      messageType: MessageType.MESSAGE,
    });
  }

  async saveAssistantMessage(params: {
    conversationId: string;
    content: string;
    messageId?: string;
    model?: string;
    tokensUsed?: number;
    metadata?: ChatV2MessageMetadata;
    timestamp?: Date;
  }): Promise<AIChatMessageEntity> {
    const meta: ChatV2MessageMetadata = {
      source: "chat-v2",
      ...(params.metadata ?? {}),
    };
    return this.chatModule.saveMessage({
      messageId: params.messageId ?? `assistant-${uuid()}`,
      conversationId: params.conversationId,
      role: "assistant",
      content: params.content,
      model: params.model,
      tokensUsed: params.tokensUsed,
      timestamp: params.timestamp,
      metadata: meta,
      messageType: MessageType.MESSAGE,
    });
  }

  async getConversationMessages(
    conversationId: string,
    limit?: number,
    offset?: number
  ): Promise<AIChatMessageEntity[]> {
    return this.chatModule.getConversationMessages(conversationId, limit, offset);
  }

  async clearConversation(conversationId: string): Promise<number> {
    return this.chatModule.clearConversation(conversationId);
  }

  async clearAllV2History(): Promise<number> {
    // Scope clear to v2-tagged rows by deleting each v2 conversation.
    const summaries = await this.getConversations();
    let total = 0;
    for (const s of summaries) {
      total += await this.chatModule.clearConversation(s.conversationId);
    }
    return total;
  }

  /** List v2 conversations only (filtered by prefix + chat-v2 metadata). */
  async getConversations(): Promise<ChatV2ConversationSummary[]> {
    const all = await this.chatModule.getConversationsWithMetadata();
    const summaries: ChatV2ConversationSummary[] = [];
    for (const conv of all) {
      if (!conv.conversationId.startsWith(V2_CONVERSATION_PREFIX)) {
        continue;
      }
      // Confirm at least one row carries v2 source metadata.
      const rows = await this.getConversationMessages(conv.conversationId, 1);
      const first = rows[0];
      let isV2 = false;
      if (first?.metadata) {
        try {
          const parsed = JSON.parse(first.metadata);
          isV2 = parsed?.source === "chat-v2";
        } catch {
          isV2 = false;
        }
      }
      if (!isV2) {
        continue;
      }
      summaries.push({
        conversationId: conv.conversationId,
        title: conv.lastMessage.slice(0, 60) || "New conversation",
        lastMessage: conv.lastMessage,
        lastMessageTimestamp: conv.lastMessageTimestamp.toISOString(),
        messageCount: conv.messageCount,
        createdAt: conv.createdAt.toISOString(),
      });
    }
    summaries.sort((a, b) =>
      b.lastMessageTimestamp.localeCompare(a.lastMessageTimestamp)
    );
    return summaries;
  }

  /** Derive the default system prompt for new conversations. */
  getDefaultSystemPrompt(): string {
    return V2_DEFAULT_SYSTEM_PROMPT;
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit src/modules/AIChatV2Module.ts 2>&1 | head -20` (informational; full check via `yarn vue-check`).

- [ ] **Step 3: Commit**

```bash
git add src/modules/AIChatV2Module.ts
git commit -m "feat: add AIChatV2Module for v2-scoped local history operations"
```

---

## Task 8: V2 IPC Handlers

Wire v2 channels. AI-enable gate runs first in every handler. Stream lifecycle uses an `AbortController` and compares active IDs before mutating state (late-chunk protection).

**Files:**
- Create: `test/vitest/main/ipc/ai-chat-v2-ipc.test.ts`
- Create: `src/main-process/communication/ai-chat-v2-ipc.ts`

- [ ] **Step 1: Write the failing IPC tests**

Create `test/vitest/main/ipc/ai-chat-v2-ipc.test.ts`:

```typescript
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  setupElectronMocks,
  resetElectronMocks,
  mockIpcMain,
} from "../../../utils/electron-mocks";

// Mock Token so AI-enabled is controllable.
vi.mock("@/modules/token", () => {
  return {
    Token: vi.fn().mockImplementation(() => ({
      getValue: vi.fn().mockReturnValue("true"),
    })),
  };
});
vi.mock("@/config/usersetting", () => ({
  USER_AI_ENABLED: "USER_AI_ENABLED",
  USERSDBPATH: "USERSDBPATH",
}));

// Mock the v2 module.
const mockClearConversation = vi.fn().mockResolvedValue(5);
const mockClearAllV2 = vi.fn().mockResolvedValue(5);
const mockGetConversations = vi.fn().mockResolvedValue([]);
vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: vi.fn().mockImplementation(() => ({
    clearConversation: mockClearConversation,
    clearAllV2History: mockClearAllV2,
    getConversations: mockGetConversations,
  })),
}));

import { registerAiChatV2IpcHandlers } from "@/main-process/communication/ai-chat-v2-ipc";
import {
  AI_CHAT_V2_CONVERSATIONS,
  AI_CHAT_V2_CLEAR_CONVERSATION,
  AI_CHAT_V2_CLEAR_ALL,
} from "@/config/channellist";

describe("AI Chat V2 IPC handlers", () => {
  beforeEach(() => {
    setupElectronMocks();
    vi.clearAllMocks();
    registerAiChatV2IpcHandlers();
  });

  afterEach(() => {
    resetElectronMocks();
  });

  it("registers a handler for each v2 channel", () => {
    const registered = mockIpcMain.getRegisteredChannels();
    expect(registered).toContain(AI_CHAT_V2_CONVERSATIONS);
    expect(registered).toContain(AI_CHAT_V2_CLEAR_CONVERSATION);
    expect(registered).toContain(AI_CHAT_V2_CLEAR_ALL);
  });

  it("lists conversations through the module", async () => {
    const result = await mockIpcMain.callHandler(AI_CHAT_V2_CONVERSATIONS);
    expect(mockGetConversations).toHaveBeenCalled();
    expect(result).toMatchObject({ status: true });
  });

  it("clears a conversation through the module", async () => {
    const result = await mockIpcMain.callHandler(
      AI_CHAT_V2_CLEAR_CONVERSATION,
      {},
      JSON.stringify({ conversationId: "v2-1" })
    );
    expect(mockClearConversation).toHaveBeenCalledWith("v2-1");
    expect(result).toMatchObject({ status: true });
  });

  it("clears all v2 history through the module", async () => {
    const result = await mockIpcMain.callHandler(AI_CHAT_V2_CLEAR_ALL);
    expect(mockClearAllV2).toHaveBeenCalled();
    expect(result).toMatchObject({ status: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn testmain -- ai-chat-v2-ipc`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the IPC handler module**

Create `src/main-process/communication/ai-chat-v2-ipc.ts`:

```typescript
import { ipcMain, type IpcMainEvent } from "electron";
import { Token } from "@/modules/token";
import { USER_AI_ENABLED } from "@/config/usersetting";
import { AiChatApi } from "@/api/aiChatApi";
import { AIChatV2Module } from "@/modules/AIChatV2Module";
import { buildOpenAITranscript } from "@/service/OpenAIChatTranscriptBuilder";
import { OpenAIStreamAccumulator } from "@/service/OpenAIStreamAccumulator";
import {
  AI_CHAT_V2_MODELS,
  AI_CHAT_V2_CONVERSATIONS,
  AI_CHAT_V2_HISTORY,
  AI_CHAT_V2_STREAM,
  AI_CHAT_V2_STREAM_STOP,
  AI_CHAT_V2_STREAM_CHUNK,
  AI_CHAT_V2_STREAM_COMPLETE,
  AI_CHAT_V2_CLEAR_CONVERSATION,
  AI_CHAT_V2_CLEAR_ALL,
} from "@/config/channellist";
import type { CommonMessage } from "@/entityTypes/commonType";
import type {
  ChatV2StreamRequest,
  ChatV2StreamChunk,
  ChatV2MessageView,
  ChatV2HistoryResponse,
  ChatV2ConversationSummary,
  ChatV2MessageMetadata,
} from "@/entityTypes/aiChatV2Types";

const CHAT_V2_PHASE1_MAX_HISTORY_MESSAGES = 30;

let currentAbortController: AbortController | null = null;
let currentConversationId: string | null = null;
let currentAssistantMessageId: string | null = null;

function isAIEnabled(): boolean {
  const tokenService = new Token();
  const value = tokenService.getValue(USER_AI_ENABLED);
  return value === "true";
}

function denied<T>(msg: string): CommonMessage<T> {
  return { status: false, msg, data: undefined };
}

function ok<T>(data: T): CommonMessage<T> {
  return { status: true, msg: "", data };
}

function sendChunk(
  event: IpcMainEvent,
  chunk: ChatV2StreamChunk,
  channel: string = AI_CHAT_V2_STREAM_CHUNK
): void {
  event.sender.send(channel, JSON.stringify(chunk));
}

function sendComplete(event: IpcMainEvent, chunk: ChatV2StreamChunk): void {
  event.sender.send(AI_CHAT_V2_STREAM_COMPLETE, JSON.stringify(chunk));
}

async function handleModels(): Promise<CommonMessage<unknown>> {
  if (!isAIEnabled()) {
    return denied("AI is not enabled");
  }
  try {
    const api = new AiChatApi();
    const models = await api.listOpenAIModels();
    return ok(models);
  } catch (err) {
    return denied(userSafeError(err));
  }
}

async function handleConversations(): Promise<CommonMessage<ChatV2ConversationSummary[]>> {
  if (!isAIEnabled()) {
    return denied("AI is not enabled");
  }
  try {
    const module = new AIChatV2Module();
    return ok(await module.getConversations());
  } catch (err) {
    return denied(userSafeError(err));
  }
}

async function handleHistory(
  _e: IpcMainEvent,
  data: string
): Promise<CommonMessage<ChatV2HistoryResponse | null>> {
  if (!isAIEnabled()) {
    return denied("AI is not enabled");
  }
  try {
    const req = JSON.parse(data ?? "{}");
    const conversationId: string = req.conversationId;
    if (!conversationId) {
      return denied("conversationId is required");
    }
    const module = new AIChatV2Module();
    const rows = await module.getConversationMessages(conversationId);
    const views: ChatV2MessageView[] = rows.map((r) => ({
      id: r.messageId,
      conversationId: r.conversationId,
      role: (r.role as ChatV2MessageView["role"]) ?? "user",
      content: r.content,
      timestamp: r.timestamp.toISOString(),
      messageType: r.messageType,
      model: r.model,
      tokensUsed: r.tokensUsed,
      metadata: parseMetadata(r.metadata),
    }));
    return ok({
      conversationId,
      messages: views,
      totalMessages: views.length,
    });
  } catch (err) {
    return denied(userSafeError(err));
  }
}

async function handleClearConversation(
  _e: IpcMainEvent,
  data: string
): Promise<CommonMessage<{ deleted: number } | null>> {
  if (!isAIEnabled()) {
    return denied("AI is not enabled");
  }
  try {
    const req = JSON.parse(data ?? "{}");
    const conversationId: string = req.conversationId;
    if (!conversationId) {
      return denied("conversationId is required");
    }
    const module = new AIChatV2Module();
    const deleted = await module.clearConversation(conversationId);
    return ok({ deleted });
  } catch (err) {
    return denied(userSafeError(err));
  }
}

async function handleClearAll(): Promise<CommonMessage<{ deleted: number } | null>> {
  if (!isAIEnabled()) {
    return denied("AI is not enabled");
  }
  try {
    const module = new AIChatV2Module();
    const deleted = await module.clearAllV2History();
    return ok({ deleted });
  } catch (err) {
    return denied(userSafeError(err));
  }
}

function validateStreamRequest(req: Partial<ChatV2StreamRequest>): string | null {
  if (!req || typeof req.message !== "string" || req.message.trim().length === 0) {
    return "Message must be a non-empty string";
  }
  if (req.conversationId !== undefined && req.conversationId === "pending") {
    return "conversationId must not be 'pending'";
  }
  if (
    req.temperature !== undefined &&
    (typeof req.temperature !== "number" || req.temperature < 0 || req.temperature > 2)
  ) {
    return "temperature must be a number in [0, 2]";
  }
  if (
    req.maxTokens !== undefined &&
    (typeof req.maxTokens !== "number" || req.maxTokens <= 0 || !Number.isInteger(req.maxTokens))
  ) {
    return "maxTokens must be a positive integer";
  }
  return null;
}

async function handleStream(event: IpcMainEvent, data: string): Promise<void> {
  // AI gate FIRST, before parsing request data.
  if (!isAIEnabled()) {
    sendComplete(event, {
      eventType: "error",
      conversationId: "",
      errorMessage: "AI is not enabled",
    });
    return;
  }

  let req: ChatV2StreamRequest;
  try {
    req = JSON.parse(data ?? "{}");
  } catch {
    sendComplete(event, {
      eventType: "error",
      conversationId: "",
      errorMessage: "Invalid request payload",
    });
    return;
  }

  const validationError = validateStreamRequest(req);
  if (validationError) {
    sendComplete(event, {
      eventType: "error",
      conversationId: req.conversationId ?? "",
      errorMessage: validationError,
    });
    return;
  }

  const module = new AIChatV2Module();
  const conversationId = module.createConversationIfNeeded(req.conversationId);
  currentConversationId = conversationId;

  // Save user message before remote call.
  await module.saveUserMessage({
    conversationId,
    content: req.message,
  });

  // Load history and build transcript.
  const history = await module.getConversationMessages(conversationId);
  const transcript = buildOpenAITranscript({
    // Exclude the just-saved current message from history (it is also appended
    // via currentUserMessage so it appears exactly once).
    history: history.filter((r) => r.content !== req.message || r.role !== "user"),
    currentUserMessage: req.message,
    systemPrompt: req.systemPrompt ?? module.getDefaultSystemPrompt(),
    filterSource: "chat-v2",
    maxMessages: CHAT_V2_PHASE1_MAX_HISTORY_MESSAGES,
  });

  const api = new AiChatApi();
  const accumulator = new OpenAIStreamAccumulator();
  const assistantMessageId = `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  currentAssistantMessageId = assistantMessageId;

  const abortController = new AbortController();
  currentAbortController = abortController;

  // Start chunk.
  sendChunk(event, {
    eventType: "start",
    conversationId,
    messageId: assistantMessageId,
  });

  try {
    await api.openAIChatCompletionStream(
      {
        messages: transcript.messages,
        model: req.model,
        temperature: req.temperature,
        max_tokens: req.maxTokens,
        stream: true,
      },
      (rawChunk) => {
        if (currentConversationId !== conversationId) return;
        const delta = accumulator.ingest(rawChunk);
        if (delta) {
          sendChunk(event, {
            eventType: "token",
            conversationId,
            messageId: assistantMessageId,
            contentDelta: delta,
            model: accumulator.state.model,
          });
        }
      },
      { signal: abortController.signal }
    );

    // Late-chunk protection.
    if (currentConversationId !== conversationId) return;

    const fullContent = accumulator.state.fullContent;
    const finishReason = accumulator.state.finishReason ?? "stop";

    if (fullContent.length > 0) {
      await module.saveAssistantMessage({
        conversationId,
        content: fullContent,
        messageId: assistantMessageId,
        model: accumulator.state.model,
        metadata: {
          source: "chat-v2",
          openaiResponseId: accumulator.state.responseId,
          finishReason,
        },
      });
    }

    sendComplete(event, {
      eventType: "complete",
      conversationId,
      messageId: assistantMessageId,
      fullContent,
      model: accumulator.state.model,
      finishReason,
    });
  } catch (err) {
    const partial = accumulator.state.fullContent;
    if (currentConversationId !== conversationId) return;

    const aborted = err instanceof Error && err.name === "AbortError";
    if (aborted) {
      if (partial.length > 0) {
        await module.saveAssistantMessage({
          conversationId,
          content: partial,
          messageId: assistantMessageId,
          model: accumulator.state.model,
          metadata: {
            source: "chat-v2",
            openaiResponseId: accumulator.state.responseId,
            finishReason: "cancelled",
            cancelled: true,
          } as ChatV2MessageMetadata,
        });
      }
      sendComplete(event, {
        eventType: "cancelled",
        conversationId,
        messageId: partial.length > 0 ? assistantMessageId : undefined,
        fullContent: partial,
      });
    } else {
      if (partial.length > 0) {
        await module.saveAssistantMessage({
          conversationId,
          content: partial,
          messageId: assistantMessageId,
          model: accumulator.state.model,
          metadata: {
            source: "chat-v2",
            finishReason: "error",
            error: userSafeError(err),
          },
        });
      }
      sendComplete(event, {
        eventType: "error",
        conversationId,
        messageId: partial.length > 0 ? assistantMessageId : undefined,
        errorMessage: userSafeError(err),
      });
    }
  } finally {
    if (currentConversationId === conversationId) {
      currentAbortController = null;
      currentConversationId = null;
      currentAssistantMessageId = null;
    }
  }
}

function handleStop(): void {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
}

function userSafeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "AbortError") {
      return "Generation stopped.";
    }
    const msg = err.message || "Unknown error";
    if (/401|403/.test(msg)) {
      return "Please sign in again.";
    }
    if (/404/.test(msg)) {
      return "Selected model is not available.";
    }
    if (/503/.test(msg)) {
      return "No chat model is configured on the AI server.";
    }
    if (/Failed to fetch|NetworkError|ECONNREFUSED|fetch failed/i.test(msg)) {
      return "Could not connect to the AI server.";
    }
    return msg;
  }
  return "Unknown error";
}

function parseMetadata(raw?: string | null): ChatV2MessageMetadata | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.source === "chat-v2") {
      return parsed as ChatV2MessageMetadata;
    }
  } catch {
    // ignore
  }
  return undefined;
}

export function registerAiChatV2IpcHandlers(): void {
  ipcMain.handle(AI_CHAT_V2_MODELS, async () => handleModels());
  ipcMain.handle(AI_CHAT_V2_CONVERSATIONS, async () => handleConversations());
  ipcMain.handle(AI_CHAT_V2_HISTORY, async (_e, data) => handleHistory(_e, data));
  ipcMain.handle(AI_CHAT_V2_CLEAR_CONVERSATION, async (_e, data) =>
    handleClearConversation(_e, data)
  );
  ipcMain.handle(AI_CHAT_V2_CLEAR_ALL, async () => handleClearAll());
  ipcMain.on(AI_CHAT_V2_STREAM, async (event, data) => handleStream(event, data));
  ipcMain.on(AI_CHAT_V2_STREAM_STOP, () => handleStop());
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn testmain -- ai-chat-v2-ipc`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main-process/communication/ai-chat-v2-ipc.ts test/vitest/main/ipc/ai-chat-v2-ipc.test.ts
git commit -m "feat: add AI chat v2 IPC handlers with stream lifecycle and AI-enable gate"
```

---

## Task 9: Register V2 IPC Handlers

**Files:**
- Modify: `src/main-process/communication/index.ts`

- [ ] **Step 1: Import the v2 registration function**

Near the existing `registerAiChatIpcHandlers` import at the top of `src/main-process/communication/index.ts`, add:

```typescript
import { registerAiChatV2IpcHandlers } from "@/main-process/communication/ai-chat-v2-ipc";
```

- [ ] **Step 2: Call the registration function**

Inside `registerCommunicationIpcHandlers`, immediately after the existing `registerAiChatIpcHandlers();` call, add:

```typescript
    registerAiChatV2IpcHandlers();
```

- [ ] **Step 3: Verify**

Run: `grep -n "registerAiChatV2IpcHandlers" src/main-process/communication/index.ts`
Expected: 2 matches (import + call).

- [ ] **Step 4: Commit**

```bash
git add src/main-process/communication/index.ts
git commit -m "feat: register AI chat v2 IPC handlers alongside legacy handlers"
```

---

## Task 10: V2 Renderer API Wrapper

**Files:**
- Create: `src/views/api/aiChatV2.ts`

- [ ] **Step 1: Write the renderer API wrapper**

Create `src/views/api/aiChatV2.ts`:

```typescript
import {
  windowInvoke,
  windowSend,
  windowReceive,
  windowRemoveAllListeners,
} from "@/views/utils/apirequest";
import type { CommonMessage } from "@/entityTypes/commonType";
import type {
  ChatV2StreamRequest,
  ChatV2StreamChunk,
  ChatV2HistoryResponse,
  ChatV2ConversationSummary,
} from "@/entityTypes/aiChatV2Types";
import type { OpenAIModelsResponse } from "@/api/aiChatApi";
import {
  AI_CHAT_V2_MODELS,
  AI_CHAT_V2_CONVERSATIONS,
  AI_CHAT_V2_HISTORY,
  AI_CHAT_V2_STREAM,
  AI_CHAT_V2_STREAM_STOP,
  AI_CHAT_V2_STREAM_CHUNK,
  AI_CHAT_V2_STREAM_COMPLETE,
  AI_CHAT_V2_CLEAR_CONVERSATION,
  AI_CHAT_V2_CLEAR_ALL,
} from "@/config/channellist";

export async function getOpenAIChatModels(): Promise<CommonMessage<OpenAIModelsResponse | null>> {
  const resp = await windowInvoke(AI_CHAT_V2_MODELS);
  return resp as CommonMessage<OpenAIModelsResponse | null>;
}

export async function getChatV2Conversations(): Promise<CommonMessage<ChatV2ConversationSummary[]>> {
  const resp = await windowInvoke(AI_CHAT_V2_CONVERSATIONS);
  return resp as CommonMessage<ChatV2ConversationSummary[]>;
}

export async function getChatV2History(
  conversationId: string
): Promise<CommonMessage<ChatV2HistoryResponse | null>> {
  const resp = await windowInvoke(AI_CHAT_V2_HISTORY, { conversationId });
  return resp as CommonMessage<ChatV2HistoryResponse | null>;
}

export async function streamChatV2Message(
  request: ChatV2StreamRequest,
  onChunk: (chunk: ChatV2StreamChunk) => void,
  onComplete: (chunk: ChatV2StreamChunk) => void,
  onError: (error: Error) => void
): Promise<void> {
  return new Promise<void>((resolve) => {
    const chunkHandler = (raw: string): void => {
      try {
        const chunk: ChatV2StreamChunk = JSON.parse(raw);
        onChunk(chunk);
      } catch (err) {
        console.error("aiChatV2: parse chunk error", err);
      }
    };

    const completeHandler = (raw: string): void => {
      try {
        const chunk: ChatV2StreamChunk = JSON.parse(raw);
        if (chunk.eventType === "error" && chunk.errorMessage) {
          onError(new Error(chunk.errorMessage));
        } else {
          onComplete(chunk);
        }
      } catch (err) {
        onError(err instanceof Error ? err : new Error("Stream completion parse error"));
      }
      windowRemoveAllListeners(AI_CHAT_V2_STREAM_CHUNK);
      windowRemoveAllListeners(AI_CHAT_V2_STREAM_COMPLETE);
      resolve();
    };

    windowRemoveAllListeners(AI_CHAT_V2_STREAM_CHUNK);
    windowRemoveAllListeners(AI_CHAT_V2_STREAM_COMPLETE);
    windowReceive(AI_CHAT_V2_STREAM_CHUNK, chunkHandler);
    windowReceive(AI_CHAT_V2_STREAM_COMPLETE, completeHandler);

    windowSend(AI_CHAT_V2_STREAM, request);
  });
}

export function stopChatV2Stream(): void {
  windowSend(AI_CHAT_V2_STREAM_STOP, {});
}

export async function clearChatV2Conversation(
  conversationId: string
): Promise<CommonMessage<{ deleted: number } | null>> {
  const resp = await windowInvoke(AI_CHAT_V2_CLEAR_CONVERSATION, { conversationId });
  return resp as CommonMessage<{ deleted: number } | null>;
}

export async function clearAllChatV2History(): Promise<CommonMessage<{ deleted: number } | null>> {
  const resp = await windowInvoke(AI_CHAT_V2_CLEAR_ALL);
  return resp as CommonMessage<{ deleted: number } | null>;
}
```

- [ ] **Step 2: Verify it compiles** (informational)

Run: `grep -n "streamChatV2Message" src/views/api/aiChatV2.ts`
Expected: 1+ match.

- [ ] **Step 3: Commit**

```bash
git add src/views/api/aiChatV2.ts
git commit -m "feat: add AI chat v2 renderer API wrapper"
```

---

## Task 11: Add i18n Keys (All 6 Languages)

**Files:**
- Modify: `src/views/lang/en.ts`, `zh.ts`, `es.ts`, `fr.ts`, `de.ts`, `ja.ts`

- [ ] **Step 1: Add aiChatV2 group to en.ts**

In `src/views/lang/en.ts`, add before the closing `};` (after the `fileOperations` block):

```typescript
  aiChatV2: {
    title: "AI Assistant (V2)",
    new_conversation: "New conversation",
    empty_title: "Start a conversation",
    empty_description: "Ask anything. Your history stays on this device.",
    input_placeholder: "Send a message…",
    send: "Send",
    stop: "Stop",
    retry: "Retry",
    clear_conversation: "Clear conversation",
    clear_all: "Clear all",
    loading_models: "Loading models…",
    loading_history: "Loading history…",
    streaming: "Generating…",
    cancelled: "Cancelled",
    ai_disabled: "AI is not enabled.",
    model_unavailable: "Selected model is not available.",
    server_unavailable: "Could not connect to the AI server.",
    unsupported_tool_call: "This assistant requested a tool that is not supported yet.",
    clear_confirm_title: "Clear conversation?",
    clear_confirm_body: "This removes all messages in this conversation.",
  },
```

- [ ] **Step 2: Add aiChatV2 group to zh.ts**

In `src/views/lang/zh.ts`, add the same block (before closing `};`) translated to Chinese:

```typescript
  aiChatV2: {
    title: "AI 助手 (V2)",
    new_conversation: "新对话",
    empty_title: "开始对话",
    empty_description: "随便问。历史记录只保存在本设备。",
    input_placeholder: "发送消息…",
    send: "发送",
    stop: "停止",
    retry: "重试",
    clear_conversation: "清空对话",
    clear_all: "全部清空",
    loading_models: "正在加载模型…",
    loading_history: "正在加载历史…",
    streaming: "生成中…",
    cancelled: "已取消",
    ai_disabled: "AI 功能未开启。",
    model_unavailable: "所选模型不可用。",
    server_unavailable: "无法连接到 AI 服务器。",
    unsupported_tool_call: "助手请求了一个暂不支持的工具。",
    clear_confirm_title: "清空对话？",
    clear_confirm_body: "这将删除该对话中的所有消息。",
  },
```

- [ ] **Step 3: Add aiChatV2 group to es.ts**

In `src/views/lang/es.ts`:

```typescript
  aiChatV2: {
    title: "Asistente de IA (V2)",
    new_conversation: "Nueva conversación",
    empty_title: "Inicia una conversación",
    empty_description: "Pregunta lo que quieras. Tu historial queda en este dispositivo.",
    input_placeholder: "Enviar un mensaje…",
    send: "Enviar",
    stop: "Detener",
    retry: "Reintentar",
    clear_conversation: "Borrar conversación",
    clear_all: "Borrar todo",
    loading_models: "Cargando modelos…",
    loading_history: "Cargando historial…",
    streaming: "Generando…",
    cancelled: "Cancelado",
    ai_disabled: "La IA no está habilitada.",
    model_unavailable: "El modelo seleccionado no está disponible.",
    server_unavailable: "No se pudo conectar al servidor de IA.",
    unsupported_tool_call: "El asistente solicitó una herramienta que aún no se admite.",
    clear_confirm_title: "¿Borrar conversación?",
    clear_confirm_body: "Esto elimina todos los mensajes de esta conversación.",
  },
```

- [ ] **Step 4: Add aiChatV2 group to fr.ts**

In `src/views/lang/fr.ts`:

```typescript
  aiChatV2: {
    title: "Assistant IA (V2)",
    new_conversation: "Nouvelle conversation",
    empty_title: "Démarrer une conversation",
    empty_description: "Posez vos questions. Votre historique reste sur cet appareil.",
    input_placeholder: "Envoyer un message…",
    send: "Envoyer",
    stop: "Arrêter",
    retry: "Réessayer",
    clear_conversation: "Effacer la conversation",
    clear_all: "Tout effacer",
    loading_models: "Chargement des modèles…",
    loading_history: "Chargement de l'historique…",
    streaming: "Génération…",
    cancelled: "Annulé",
    ai_disabled: "L'IA n'est pas activée.",
    model_unavailable: "Le modèle sélectionné n'est pas disponible.",
    server_unavailable: "Impossible de se connecter au serveur IA.",
    unsupported_tool_call: "L'assistant a demandé un outil non encore pris en charge.",
    clear_confirm_title: "Effacer la conversation ?",
    clear_confirm_body: "Cela supprime tous les messages de cette conversation.",
  },
```

- [ ] **Step 5: Add aiChatV2 group to de.ts**

In `src/views/lang/de.ts`:

```typescript
  aiChatV2: {
    title: "KI-Assistent (V2)",
    new_conversation: "Neue Unterhaltung",
    empty_title: "Unterhaltung starten",
    empty_description: "Frag alles. Dein Verlauf bleibt auf diesem Gerät.",
    input_placeholder: "Nachricht senden…",
    send: "Senden",
    stop: "Stopp",
    retry: "Erneut versuchen",
    clear_conversation: "Unterhaltung löschen",
    clear_all: "Alles löschen",
    loading_models: "Modelle werden geladen…",
    loading_history: "Verlauf wird geladen…",
    streaming: "Wird generiert…",
    cancelled: "Abgebrochen",
    ai_disabled: "KI ist nicht aktiviert.",
    model_unavailable: "Ausgewähltes Modell nicht verfügbar.",
    server_unavailable: "Verbindung zum KI-Server nicht möglich.",
    unsupported_tool_call: "Der Assistent hat ein noch nicht unterstütztes Werkzeug angefordert.",
    clear_confirm_title: "Unterhaltung löschen?",
    clear_confirm_body: "Dadurch werden alle Nachrichten dieser Unterhaltung entfernt.",
  },
```

- [ ] **Step 6: Add aiChatV2 group to ja.ts**

In `src/views/lang/ja.ts`:

```typescript
  aiChatV2: {
    title: "AI アシスタント (V2)",
    new_conversation: "新しい会話",
    empty_title: "会話を始める",
    empty_description: "何でも聞いてください。履歴はこの端末に保存されます。",
    input_placeholder: "メッセージを送信…",
    send: "送信",
    stop: "停止",
    retry: "再試行",
    clear_conversation: "会話を消去",
    clear_all: "すべて消去",
    loading_models: "モデルを読み込み中…",
    loading_history: "履歴を読み込み中…",
    streaming: "生成中…",
    cancelled: "キャンセルされました",
    ai_disabled: "AI が有効ではありません。",
    model_unavailable: "選択したモデルは利用できません。",
    server_unavailable: "AI サーバーに接続できませんでした。",
    unsupported_tool_call: "アシスタントが未対応のツールを要求しました。",
    clear_confirm_title: "会話を消去しますか？",
    clear_confirm_body: "この会話のすべてのメッセージが削除されます。",
  },
```

- [ ] **Step 7: Verify all 6 files updated**

Run: `grep -l "aiChatV2" src/views/lang/*.ts`
Expected: 6 files listed (en, zh, es, fr, de, ja).

- [ ] **Step 8: Commit**

```bash
git add src/views/lang/en.ts src/views/lang/zh.ts src/views/lang/es.ts src/views/lang/fr.ts src/views/lang/de.ts src/views/lang/ja.ts
git commit -m "feat: add aiChatV2 translations for en/zh/es/fr/de/ja"
```

---

## Task 12: V2 UI Components

Build the component tree (Nuxt UI Chat reference implemented with Vuetify). State lives in `AiChatV2.vue`.

**Files:**
- Create: `src/views/components/aiChatV2/AiChatV2StreamStatus.vue`
- Create: `src/views/components/aiChatV2/AiChatV2Message.vue`
- Create: `src/views/components/aiChatV2/AiChatV2Messages.vue`
- Create: `src/views/components/aiChatV2/AiChatV2ConversationList.vue`
- Create: `src/views/components/aiChatV2/AiChatV2Composer.vue`
- Create: `src/views/components/aiChatV2/AiChatV2.vue`

- [ ] **Step 1: Create AiChatV2StreamStatus.vue**

Create `src/views/components/aiChatV2/AiChatV2StreamStatus.vue`:

```vue
<template>
  <div class="v2-stream-status" v-if="visible">
    <v-progress-circular
      v-if="status === 'streaming'"
      indeterminate
      size="14"
      width="2"
      color="primary"
      class="mr-2"
    />
    <v-icon v-else-if="status === 'cancelled'" size="14" color="grey" class="mr-1">
      mdi-cancel
    </v-icon>
    <v-icon v-else-if="status === 'error'" size="14" color="error" class="mr-1">
      mdi-alert-circle-outline
    </v-icon>
    <span class="v2-stream-status__text">{{ text }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

type Status = "idle" | "streaming" | "cancelled" | "error";
const props = defineProps<{ status: Status; errorMessage?: string }>();
const { t } = useI18n();

const visible = computed(() => props.status !== "idle");
const text = computed(() => {
  if (props.status === "streaming") return t("aiChatV2.streaming") || "Generating…";
  if (props.status === "cancelled") return t("aiChatV2.cancelled") || "Cancelled";
  if (props.status === "error")
    return props.errorMessage || t("aiChatV2.server_unavailable") || "Error";
  return "";
});
</script>

<style scoped>
.v2-stream-status {
  display: flex;
  align-items: center;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.55);
  padding: 4px 8px;
}
.v2-stream-status__text {
  line-height: 1;
}
</style>
```

- [ ] **Step 2: Create AiChatV2Message.vue**

Create `src/views/components/aiChatV2/AiChatV2Message.vue`:

```vue
<template>
  <div class="v2-message" :class="`v2-message--${message.role}`">
    <div class="v2-message__bubble">
      <div class="v2-message__role">{{ roleLabel }}</div>
      <div class="v2-message__content">{{ message.content }}</div>
      <AiChatV2StreamStatus
        v-if="message.role === 'assistant' && status !== 'idle'"
        :status="status"
        :error-message="errorMessage"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import AiChatV2StreamStatus from "./AiChatV2StreamStatus.vue";

type Status = "idle" | "streaming" | "cancelled" | "error";

const props = defineProps<{
  message: ChatV2MessageView;
  status?: Status;
  errorMessage?: string;
}>();
const { t } = useI18n();

const roleLabel = computed(() => {
  if (props.message.role === "user") return t("common.user") || "You";
  if (props.message.role === "assistant") return "AI";
  return props.message.role;
});

const status: Status = props.status ?? "idle";
</script>

<style scoped>
.v2-message {
  display: flex;
  margin: 8px 0;
}
.v2-message--user {
  justify-content: flex-end;
}
.v2-message--assistant,
.v2-message--system,
.v2-message--tool {
  justify-content: flex-start;
}
.v2-message__bubble {
  max-width: 80%;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.04);
  word-break: break-word;
}
.v2-message--user .v2-message__bubble {
  background: rgba(25, 118, 210, 0.12);
}
.v2-message__role {
  font-size: 11px;
  opacity: 0.6;
  margin-bottom: 2px;
}
.v2-message__content {
  white-space: pre-wrap;
  line-height: 1.45;
}
</style>
```

- [ ] **Step 3: Create AiChatV2Messages.vue**

Create `src/views/components/aiChatV2/AiChatV2Messages.vue`:

```vue
<template>
  <div ref="scroller" class="v2-messages">
    <div v-if="messages.length === 0" class="v2-messages__empty">
      <v-icon size="40" color="grey-lighten-1">mdi-chat-outline</v-icon>
      <div class="v2-messages__empty-title">
        {{ t("aiChatV2.empty_title") || "Start a conversation" }}
      </div>
      <div class="v2-messages__empty-desc">
        {{ t("aiChatV2.empty_description") || "Ask anything." }}
      </div>
    </div>
    <AiChatV2Message
      v-for="m in messages"
      :key="m.id"
      :message="m"
      :status="m.id === activeAssistantMessageId ? streamStatus : 'idle'"
      :error-message="errorMessage"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import AiChatV2Message from "./AiChatV2Message.vue";

type Status = "idle" | "streaming" | "cancelled" | "error";

const props = defineProps<{
  messages: ChatV2MessageView[];
  activeAssistantMessageId: string | null;
  streamStatus: Status;
  errorMessage?: string;
}>();
const { t } = useI18n();

const scroller = ref<HTMLDivElement | null>(null);
let pinnedToBottom = true;

const scrollToBottom = async (): Promise<void> => {
  await nextTick();
  if (scroller.value && pinnedToBottom) {
    scroller.value.scrollTop = scroller.value.scrollHeight;
  }
};

const onScroll = (): void => {
  const el = scroller.value;
  if (!el) return;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  pinnedToBottom = atBottom;
};

onMounted(scrollToBottom);
watch(() => props.messages.length, scrollToBottom);
watch(
  () => props.messages.map((m) => m.content).join(""),
  scrollToBottom
);
</script>

<style scoped>
.v2-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
}
.v2-messages__empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: rgba(0, 0, 0, 0.45);
  text-align: center;
  gap: 6px;
}
.v2-messages__empty-title {
  font-weight: 600;
  margin-top: 8px;
}
.v2-messages__empty-desc {
  font-size: 13px;
}
</style>
```

- [ ] **Step 4: Create AiChatV2ConversationList.vue**

Create `src/views/components/aiChatV2/AiChatV2ConversationList.vue`:

```vue
<template>
  <div class="v2-conv-list">
    <v-btn
      block
      variant="tonal"
      color="primary"
      prepend-icon="mdi-plus"
      class="mb-2"
      @click="$emit('new-conversation')"
    >
      {{ t("aiChatV2.new_conversation") || "New conversation" }}
    </v-btn>
    <v-list density="compact" class="v2-conv-list__items">
      <v-list-item
        v-for="conv in conversations"
        :key="conv.conversationId"
        :active="conv.conversationId === activeConversationId"
        :title="conv.title"
        :subtitle="formatTime(conv.lastMessageTimestamp)"
        @click="$emit('select', conv.conversationId)"
      />
    </v-list>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { ChatV2ConversationSummary } from "@/entityTypes/aiChatV2Types";

defineProps<{
  conversations: ChatV2ConversationSummary[];
  activeConversationId: string | null;
}>();
defineEmits<{
  (e: "new-conversation"): void;
  (e: "select", conversationId: string): void;
}>();

const { t } = useI18n();

const formatTime = (iso: string): string => {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return "";
  }
};
</script>

<style scoped>
.v2-conv-list {
  padding: 8px;
  min-width: 0;
}
.v2-conv-list__items {
  max-height: 100%;
  overflow-y: auto;
}
</style>
```

- [ ] **Step 5: Create AiChatV2Composer.vue**

Create `src/views/components/aiChatV2/AiChatV2Composer.vue`:

```vue
<template>
  <div class="v2-composer">
    <v-textarea
      v-model="draft"
      :placeholder="t('aiChatV2.input_placeholder') || 'Send a message…'"
      variant="outlined"
      auto-grow
      rows="1"
      max-rows="6"
      hide-details
      density="comfortable"
      :disabled="isStreaming"
      @keydown="onKeydown"
    />
    <div class="v2-composer__actions">
      <v-btn
        v-if="!isStreaming"
        color="primary"
        icon="mdi-send"
        size="small"
        :disabled="draft.trim().length === 0"
        :aria-label="t('aiChatV2.send') || 'Send'"
        @click="onSend"
      />
      <v-btn
        v-else
        color="error"
        icon="mdi-stop"
        size="small"
        :aria-label="t('aiChatV2.stop') || 'Stop'"
        @click="$emit('stop')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps<{ isStreaming: boolean }>();
const emit = defineEmits<{
  (e: "send", text: string): void;
  (e: "stop"): void;
}>();
const { t } = useI18n();

const draft = ref("");

watch(
  () => props.isStreaming,
  (streaming) => {
    if (!streaming) {
      // keep draft so user can retry/edit; clear only on explicit send
    }
  }
);

const onSend = (): void => {
  const text = draft.value.trim();
  if (!text || props.isStreaming) return;
  emit("send", text);
  draft.value = "";
};

const onKeydown = (event: KeyboardEvent): void => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    onSend();
  }
};
</script>

<style scoped>
.v2-composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
}
.v2-composer__actions {
  display: flex;
  align-items: center;
  padding-bottom: 4px;
}
</style>
```

- [ ] **Step 6: Create AiChatV2.vue (root shell with state)**

Create `src/views/components/aiChatV2/AiChatV2.vue`:

```vue
<template>
  <div class="v2-shell">
    <div class="v2-shell__header">
      <v-select
        v-model="selectedModel"
        :items="modelItems"
        item-title="id"
        item-value="id"
        :label="t('aiChatV2.loading_models') || 'Model'"
        density="compact"
        hide-details
        class="v2-shell__model"
        variant="outlined"
      />
      <span class="v2-shell__title">{{ t("aiChatV2.title") || "AI Assistant (V2)" }}</span>
    </div>

    <div class="v2-shell__body">
      <div class="v2-shell__sidebar">
        <AiChatV2ConversationList
          :conversations="conversations"
          :active-conversation-id="activeConversationId"
          @new-conversation="onNewConversation"
          @select="onSelectConversation"
        />
      </div>
      <div class="v2-shell__main">
        <AiChatV2Messages
          :messages="messages"
          :active-assistant-message-id="activeAssistantMessageId"
          :stream-status="streamStatus"
          :error-message="streamError ?? undefined"
        />
        <AiChatV2Composer
          :is-streaming="isStreaming"
          @send="onSend"
          @stop="onStop"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import type { ChatV2MessageView, ChatV2MessageMetadata } from "@/entityTypes/aiChatV2Types";
import type { OpenAIModel } from "@/api/aiChatApi";
import {
  getOpenAIChatModels,
  getChatV2Conversations,
  getChatV2History,
  streamChatV2Message,
  stopChatV2Stream,
} from "@/views/api/aiChatV2";
import AiChatV2ConversationList from "./AiChatV2ConversationList.vue";
import AiChatV2Messages from "./AiChatV2Messages.vue";
import AiChatV2Composer from "./AiChatV2Composer.vue";

type Status = "idle" | "streaming" | "cancelled" | "error";

const { t } = useI18n();

const models = ref<OpenAIModel[]>([]);
const selectedModel = ref<string | null>(null);
const conversations = ref<ChatV2ConversationView[]>([]);
const activeConversationId = ref<string | null>(null);
const messages = ref<ChatV2MessageView[]>([]);
const isStreaming = ref(false);
const streamError = ref<string | null>(null);
const activeAssistantMessageId = ref<string | null>(null);

interface ChatV2MessageView {
  id: string;
  conversationId: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  timestamp: string;
  messageType: any;
  model?: string;
  tokensUsed?: number;
  metadata?: ChatV2MessageMetadata;
}

type ChatV2ConversationView = {
  conversationId: string;
  title: string;
  lastMessage: string;
  lastMessageTimestamp: string;
  messageCount: number;
  createdAt: string;
};

const modelItems = computed(() => models.value);
const streamStatus = computed<Status>(() => {
  if (isStreaming.value) return "streaming";
  if (streamError.value) return "error";
  const last = messages.value[messages.value.length - 1];
  if (last?.metadata?.cancelled) return "cancelled";
  return "idle";
});

const loadModels = async (): Promise<void> => {
  const resp = await getOpenAIChatModels();
  if (resp.status && resp.data) {
    models.value = resp.data.data ?? [];
    if (!selectedModel.value && models.value.length > 0) {
      selectedModel.value = models.value[0].id;
    }
  } else {
    streamError.value = resp.msg || (t("aiChatV2.model_unavailable") || "Model load failed");
  }
};

const loadConversations = async (): Promise<void> => {
  const resp = await getChatV2Conversations();
  if (resp.status && resp.data) {
    conversations.value = resp.data;
  }
};

const loadHistory = async (conversationId: string): Promise<void> => {
  const resp = await getChatV2History(conversationId);
  if (resp.status && resp.data) {
    messages.value = resp.data.messages;
  }
};

const onNewConversation = (): void => {
  stopIfStreaming();
  activeConversationId.value = null;
  messages.value = [];
  streamError.value = null;
};

const onSelectConversation = (conversationId: string): void => {
  stopIfStreaming();
  activeConversationId.value = conversationId;
  streamError.value = null;
  void loadHistory(conversationId);
};

const stopIfStreaming = (): void => {
  if (isStreaming.value) {
    stopChatV2Stream();
    isStreaming.value = false;
  }
};

const onStop = (): void => {
  stopChatV2Stream();
};

const onSend = async (text: string): Promise<void> => {
  if (isStreaming.value) return;
  streamError.value = null;

  // Optimistically render user message.
  const tempUser: ChatV2MessageView = {
    id: `temp-user-${Date.now()}`,
    conversationId: activeConversationId.value ?? "",
    role: "user",
    content: text,
    timestamp: new Date().toISOString(),
    messageType: "message",
  };
  messages.value = [...messages.value, tempUser];

  const assistantId = `temp-assistant-${Date.now()}`;
  activeAssistantMessageId.value = assistantId;
  const assistant: ChatV2MessageView = {
    id: assistantId,
    conversationId: activeConversationId.value ?? "",
    role: "assistant",
    content: "",
    timestamp: new Date().toISOString(),
    messageType: "message",
  };
  messages.value = [...messages.value, assistant];

  isStreaming.value = true;

  await streamChatV2Message(
    {
      conversationId: activeConversationId.value ?? undefined,
      message: text,
      model: selectedModel.value ?? undefined,
    },
    (chunk) => {
      if (chunk.eventType === "start") {
        if (chunk.conversationId) {
          activeConversationId.value = chunk.conversationId;
          tempUser.conversationId = chunk.conversationId;
          assistant.conversationId = chunk.conversationId;
        }
        if (chunk.messageId) {
          assistant.id = chunk.messageId;
          activeAssistantMessageId.value = chunk.messageId;
        }
      } else if (chunk.eventType === "token" && chunk.contentDelta) {
        assistant.content += chunk.contentDelta;
        messages.value = [...messages.value];
      }
    },
    (complete) => {
      isStreaming.value = false;
      activeAssistantMessageId.value = null;
      if (complete.fullContent !== undefined) {
        assistant.content = complete.fullContent;
      }
      if (complete.conversationId) {
        activeConversationId.value = complete.conversationId;
      }
      messages.value = [...messages.value];
      void loadConversations();
    },
    (error) => {
      isStreaming.value = false;
      activeAssistantMessageId.value = null;
      streamError.value = error.message;
      // Drop empty assistant placeholder if nothing arrived.
      if (assistant.content.length === 0) {
        messages.value = messages.value.filter((m) => m.id !== assistant.id);
      }
    }
  );
};

onMounted(() => {
  void loadModels();
  void loadConversations();
});
</script>

<style scoped>
.v2-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fff;
}
.v2-shell__header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}
.v2-shell__model {
  max-width: 220px;
}
.v2-shell__title {
  font-weight: 600;
}
.v2-shell__body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.v2-shell__sidebar {
  width: 200px;
  border-right: 1px solid rgba(0, 0, 0, 0.08);
  overflow-y: auto;
}
.v2-shell__main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
</style>
```

- [ ] **Step 7: Run type check**

Run: `yarn vue-check` (informational; fix any type errors found).

- [ ] **Step 8: Commit**

```bash
git add src/views/components/aiChatV2/
git commit -m "feat: add AI chat v2 Vue 3 component tree (Vuetify)"
```

---

## Task 13: Add V2 Launcher Entry (Feature Flag)

Add a feature-flagged launcher so v2 is reachable without deleting old chat. Uses a localStorage flag + a new icon button in the layout header.

**Files:**
- Modify: `src/views/layout/layout.vue`

- [ ] **Step 1: Add imports and state in layout.vue**

In the `<script setup>` block of `src/views/layout/layout.vue`, after the existing `AiChatBox` import, add:

```typescript
import AiChatV2 from '@/views/components/aiChatV2/AiChatV2.vue';
```

Near the existing `const chatPanelOpen = ref(false);` line, add:

```typescript
const v2ChatPanelOpen = ref(false);
const V2_FLAG_KEY = 'aifetchly:aiChatV2Enabled';
const aiChatV2Enabled = ref(localStorage.getItem(V2_FLAG_KEY) === 'true');

const toggleV2ChatPanel = () => {
    v2ChatPanelOpen.value = !v2ChatPanelOpen.value;
    if (v2ChatPanelOpen.value) {
        chatPanelOpen.value = false;
    }
};
```

- [ ] **Step 2: Add a v2 toggle button in the header**

Find the existing chat toggle button (the `<v-btn variant="text" icon="mdi-chat" @click="toggleChatPanel">` around line 85) and add a v2 button right after it (only rendered when the flag is enabled):

```html
                    <v-btn
                        v-if="aiChatV2Enabled"
                        variant="text"
                        icon="mdi-robot-happy"
                        @click="toggleV2ChatPanel"
                    ></v-btn>
```

- [ ] **Step 3: Add the v2 panel container**

In the template, after the existing AI chat panel `<div class="ai-chat-panel" ...>…</div>` block (which closes around line 154), add a parallel v2 panel:

```html
        <!-- AI Chat V2 Panel -->
        <div
          class="ai-chat-panel"
          :class="{ 'panel-open': v2ChatPanelOpen }"
          :style="v2ChatPanelOpen ? { width: chatPanelWidth + 'px' } : {}"
        >
          <div
            v-if="v2ChatPanelOpen"
            class="chat-resize-handle"
            @mousedown="startResize"
          ></div>
          <AiChatV2 v-if="v2ChatPanelOpen" />
        </div>
        <div
          v-if="v2ChatPanelOpen"
          class="chat-backdrop"
          @click="toggleV2ChatPanel"
        ></div>
```

- [ ] **Step 4: Verify the flag can be enabled**

To enable v2 at runtime (dev/internal), run in the renderer DevTools console:

```javascript
localStorage.setItem('aifetchly:aiChatV2Enabled', 'true');
```

Then reload. Old chat remains the default.

- [ ] **Step 5: Commit**

```bash
git add src/views/layout/layout.vue
git commit -m "feat: add feature-flagged AI chat v2 launcher in layout"
```

---

## Task 14: Final Verification

- [ ] **Step 1: Run the full main process test suite**

Run: `yarn testmain`
Expected: all tests pass, including the 3 new test files (transcript builder, accumulator, IPC).

- [ ] **Step 2: Type check**

Run: `yarn vue-check`
Expected: no errors.

- [ ] **Step 3: Grep sanity checks**

Run each and confirm expected counts:
- `grep -rn "/api/ai/v1/chat/completions" src/` → 0 matches (bug fixed)
- `grep -c "AI_CHAT_V2_" src/config/channellist.ts` → 9
- `grep -l "aiChatV2" src/views/lang/*.ts` → 6 files

- [ ] **Step 4: Manual smoke check (if running dev)**

Run: `yarn dev`
Then:
1. Open DevTools console, run `localStorage.setItem('aifetchly:aiChatV2Enabled','true')` and reload.
2. Click the new robot icon → v2 panel opens, shows empty state.
3. Send a message → assistant text streams.
4. Click Stop mid-stream → partial assistant text is preserved.
5. Reload → conversation reappears in the sidebar; old chat (mdi-chat) still opens.

- [ ] **Step 5: Final commit (if any fixups)**

If steps 1–3 surfaced fixups, commit them:

```bash
git add -A
git commit -m "test: fix v2 verification issues"
```

---

## Self-Review Notes

**Spec coverage check** (PRD §5.1 Phase 1 required items):
- New chat UI component tree → Task 12 ✓
- New renderer API wrapper → Task 10 ✓
- New IPC channels → Tasks 2, 3, 8 ✓
- AI enable check at start of every v2 AI IPC handler → Task 8 (`isAIEnabled()` gate in each handler) ✓
- OpenAI-compatible model listing → Task 8 `handleModels` + Task 10 wrapper ✓
- OpenAI-compatible streaming chat → Task 8 `handleStream` ✓
- Local conversation creation and loading → Task 7 module + Task 8 handlers ✓
- Local message persistence → Task 7 save methods + Task 8 calls ✓
- Transcript builder → Task 5 ✓
- Stop-stream support → Task 8 `handleStop` + Task 10 wrapper + Task 12 UI ✓
- Error display and retry-ready state → Task 8 error paths + Task 12 UI keeps draft ✓
- i18n keys for en/zh/es/fr/de/ja → Task 11 ✓
- Feature flag → Task 13 ✓

**Deferred (per PRD §5.1 Deferred):** full tool-calling loop (Phase 2), plan-execute events, reasoning blocks, attachments, RAG, summarization, message queueing. The accumulator and metadata shapes are designed to support Phase 2 without rework.

**Type consistency check:** `ChatV2StreamChunk`, `ChatV2MessageView`, `ChatV2ConversationSummary`, `ChatV2MessageMetadata` names match across types file, module, IPC, renderer API, and components.
