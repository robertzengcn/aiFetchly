# OpenAI-Compatible Chat V2 - Technical Design

## 1. Purpose

This document translates `docs/openai-compatible-chat-v2-prd.md` into an implementation-facing technical design.

The goal is to build a new chat stack that:

- keeps the old chat stack intact during migration
- uses the AI server's OpenAI-compatible API
- stores conversation history locally in the Electron app
- builds OpenAI `messages[]` from local SQLite history
- streams responses through new Electron IPC channels
- uses Nuxt UI Chat as a UI behavior reference, not as a dependency

The design is intentionally split into phases. Phase 1 ships normal streaming chat with local history. Phase 2 adds OpenAI tool calling. Phase 3 adds token-budget context management.

## 2. Current System Summary

### 2.1 Existing Client Stack

The current chat implementation uses these main files:

```text
src/views/components/aiChat/AiChatBox.vue
src/views/api/aiChat.ts
src/main-process/communication/ai-chat-ipc.ts
src/service/StreamEventProcessor.ts
src/api/aiChatApi.ts
src/modules/AIChatModule.ts
src/model/AIChatMessage.model.ts
src/entity/AIChatMessage.entity.ts
src/entityTypes/commonType.ts
src/config/channellist.ts
src/preload.ts
```

The legacy stream path uses:

```text
/api/ai/ask/stream
/api/ai/ask/continue
```

The legacy server emits app-specific stream events:

```text
token
tool_call
tool_result
error
done
complete
conversation_start
conversation_end
pong
plan_created
plan_step_start
plan_step_complete
plan_execute_pause
plan_execute_resume
```

The current renderer and `StreamEventProcessor` are coupled to that event contract. V2 must not mutate that coupling in Phase 1.

### 2.2 Existing Local Chat Storage

The existing local storage table is represented by `AIChatMessageEntity`:

```typescript
@Entity('ai_chat_messages')
@Index(['conversationId', 'timestamp'])
@Index(['role'])
export class AIChatMessageEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column('varchar', { length: 100, nullable: false })
  messageId: string;

  @Column('varchar', { length: 100, default: 'default', nullable: false })
  conversationId: string;

  @Column('varchar', { length: 20, nullable: false })
  role: string;

  @Column('text', { nullable: false })
  content: string;

  @Column('datetime', { nullable: false })
  timestamp: Date;

  @Column('varchar', { length: 100, nullable: true })
  model?: string;

  @Column('int', { nullable: true })
  tokensUsed?: number;

  @Column('text', { nullable: true })
  metadata?: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: MessageType.MESSAGE,
    nullable: false,
    enum: MessageType
  })
  messageType: MessageType;
}
```

The module surface already supports the operations v2 needs:

```typescript
AIChatModule.saveMessage(options)
AIChatModule.getConversationMessages(conversationId, limit, offset)
AIChatModule.getMessageByMessageId(messageId)
AIChatModule.clearConversation(conversationId)
AIChatModule.clearAllHistory()
AIChatModule.getConversationsWithMetadata()
```

V2 should reuse this table in Phase 1. A separate table would avoid mixing old and new rows, but it would duplicate history logic and migrations. The safer first step is to tag v2 rows through metadata:

```json
{
  "source": "chat-v2"
}
```

### 2.3 Existing OpenAI-Compatible Client Types

`src/api/aiChatApi.ts` already defines the main OpenAI-compatible types:

```typescript
export type OpenAIMessageRole =
  | "system"
  | "user"
  | "assistant"
  | "function"
  | "tool";

export interface OpenAIChatMessage {
  role: OpenAIMessageRole;
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export interface OpenAIChatCompletionRequest {
  messages: OpenAIChatMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  tools?: OpenAITool[];
  tool_choice?: OpenAIToolChoice;
  stop?: string | string[];
  user?: string;
}

export interface OpenAIChatCompletionChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAIStreamChoice[];
}
```

The current methods are:

```typescript
listOpenAIModels(): Promise<OpenAIModelsResponse>
openAIChatCompletion(request): Promise<OpenAIChatCompletionResponse>
openAIChatCompletionStream(request, onChunk, options?): Promise<void>
```

Implementation must verify the endpoint paths before use. The server registers the OpenAI-compatible router with prefix `/v1`, while `HttpClient` prefixes all calls with its own `/apis` base URL. The correct client endpoint should resolve to:

```text
<loginUrl>/apis/v1/chat/completions
<loginUrl>/apis/v1/models
```

If any client method sends `/api/ai/v1/chat/completions`, it should be corrected before v2 relies on it.

### 2.4 Existing Server Contract

The AI server is located at:

```text
/home/robertzeng/project/aifetchserver
```

Relevant files:

```text
aifetchserver/main.py
aifetchserver/api/openai_compatible.py
aifetchserver/schemas/openai_compatible.py
doc/api/openai_compatible.http
```

The server exposes:

```text
GET  /v1/models
POST /v1/chat/completions
```

The server accepts:

```python
class ChatCompletionRequest(BaseModel):
    model: str | None = None
    messages: list[ChatCompletionMessage]
    temperature: float | None = None
    max_tokens: int | None = None
    stream: bool = False
    tools: list[dict[str, Any]] | None = None
    tool_choice: str | dict[str, Any] | None = None
    stop: str | list[str] | None = None
    user: str | None = None
```

For streaming, it returns Server-Sent Events containing OpenAI-compatible JSON chunks and a stream terminator:

```text
data: {"id":"chatcmpl-...","object":"chat.completion.chunk",...}

data: [DONE]
```

## 3. Target Architecture

### 3.1 Layer Boundaries

V2 should keep the existing Electron architecture:

```text
Renderer UI
  -> renderer API wrapper
  -> preload-safe IPC
  -> main-process IPC handler
  -> Module layer
  -> Model layer
  -> SQLite
  -> AiChatApi
  -> AI server
```

Concrete v2 path:

```text
src/views/components/aiChatV2/AiChatV2.vue
  -> src/views/api/aiChatV2.ts
  -> window.api invoke/send/receive
  -> src/main-process/communication/ai-chat-v2-ipc.ts
  -> src/modules/AIChatV2Module.ts or AIChatModule
  -> src/service/OpenAIChatTranscriptBuilder.ts
  -> src/api/aiChatApi.ts
  -> /v1/chat/completions
```

### 3.2 Responsibility Split

| Layer | Responsibility | Must not do |
|---|---|---|
| Vue v2 components | Render chat, collect input, show stream state | Call remote AI server directly |
| `src/views/api/aiChatV2.ts` | Typed renderer IPC wrapper | Own DB logic or parse remote SSE |
| `ai-chat-v2-ipc.ts` | Validate input, gate AI, orchestrate stream lifecycle | Direct TypeORM repository use |
| `AIChatV2Module` | Chat business logic and local history operations | Handle renderer IPC channels |
| `OpenAIChatTranscriptBuilder` | Convert local rows into OpenAI `messages[]` | Call remote APIs or write DB |
| `AiChatApi` | HTTP calls and SSE chunk parsing | Own local chat history |
| Model layer | TypeORM access | Run AI calls |

### 3.3 Why Not LangChain Or LangGraph In Client

Do not add LangChain or LangGraph to the Electron client in Phase 1.

Reasons:

- The v2 normal chat path only needs transcript building, streaming, persistence, and UI rendering.
- The AI server already owns heavier orchestration.
- Adding a graph runtime in Electron would create two agent-state owners.
- Tool permissions and local skill execution already have app-specific services.

If client-side multi-step agent orchestration becomes a product requirement later, introduce it as a separate design.

## 4. Files And Modules

### 4.1 New Files

Recommended files:

```text
src/main-process/communication/ai-chat-v2-ipc.ts
src/modules/AIChatV2Module.ts
src/service/OpenAIChatTranscriptBuilder.ts
src/service/OpenAIStreamAccumulator.ts
src/views/api/aiChatV2.ts
src/views/components/aiChatV2/AiChatV2.vue
src/views/components/aiChatV2/AiChatV2Messages.vue
src/views/components/aiChatV2/AiChatV2Message.vue
src/views/components/aiChatV2/AiChatV2Composer.vue
src/views/components/aiChatV2/AiChatV2ConversationList.vue
src/views/components/aiChatV2/AiChatV2ToolBlock.vue
src/views/components/aiChatV2/AiChatV2StreamStatus.vue
test/vitest/main/service/OpenAIChatTranscriptBuilder.test.ts
test/vitest/main/service/OpenAIStreamAccumulator.test.ts
test/vitest/main/ipc/ai-chat-v2-ipc.test.ts
```

### 4.2 Modified Files

Expected modifications:

```text
src/config/channellist.ts
src/preload.ts
src/main-process/communication/index.ts
src/api/aiChatApi.ts
src/entityTypes/commonType.ts
src/modules/AIChatModule.ts
src/views/lang/en.ts
src/views/lang/zh.ts
src/views/lang/es.ts
src/views/lang/fr.ts
src/views/lang/de.ts
src/views/lang/ja.ts
app navigation or chat launcher component
```

### 4.3 Optional Files

Add these only when the implementation needs them:

```text
src/entityTypes/aiChatV2Types.ts
src/service/OpenAIChatContextWindow.ts
src/service/OpenAIChatToolLoop.ts
test/vitest/main/service/OpenAIChatContextWindow.test.ts
test/vitest/main/service/OpenAIChatToolLoop.test.ts
```

Avoid creating broad abstractions before Phase 2 or Phase 3 needs them.

## 5. Data Contracts

### 5.1 Renderer Request Types

Use renderer-facing request types that are smaller than raw OpenAI requests. The main process should decide how to build the final OpenAI request.

```typescript
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
```

Validation rules:

- `message` must be a non-empty string after trim.
- `conversationId`, when provided, must be a non-empty string and must not be `"pending"`.
- `temperature`, when provided, must be a number in a server-supported range.
- `maxTokens`, when provided, must be a positive integer.
- Renderer-provided `systemPrompt` is optional and should be controlled by the app, not arbitrary untrusted UI state, unless product requirements say otherwise.

### 5.2 Renderer Response Types

```typescript
export interface ChatV2ConversationSummary {
  conversationId: string;
  title: string;
  lastMessage: string;
  lastMessageTimestamp: string;
  messageCount: number;
  createdAt: string;
}

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
```

### 5.3 Stream Chunk Types

The renderer should not receive raw OpenAI chunks. It should receive an app-level v2 stream chunk.

```typescript
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

Rules:

- `token` chunks carry `contentDelta`.
- `complete` chunks carry final `messageId`, `conversationId`, and optional `finishReason`.
- `error` chunks carry a user-safe `errorMessage`.
- `cancelled` chunks carry the conversation ID and optional partial message ID.
- Phase 1 may emit `tool_call_delta` only for diagnostics or an unsupported-tool message.

### 5.4 Metadata Shape

Use metadata to tag v2 messages and to prepare for OpenAI tool loops.

```typescript
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
```

Phase 1 saved assistant message metadata:

```json
{
  "source": "chat-v2",
  "openaiResponseId": "chatcmpl-...",
  "finishReason": "stop"
}
```

Cancelled partial message metadata:

```json
{
  "source": "chat-v2",
  "openaiResponseId": "chatcmpl-...",
  "finishReason": "cancelled",
  "cancelled": true
}
```

## 6. IPC Design

### 6.1 Channel Constants

Add v2 channels to `src/config/channellist.ts`:

```typescript
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

Do not reuse old channel names. That keeps listener cleanup and stream ownership separate.

### 6.2 Preload Exposure

Add the new constants to the preload channel allowlists:

- send channels: `AI_CHAT_V2_STREAM`, `AI_CHAT_V2_STREAM_STOP`
- receive channels: `AI_CHAT_V2_STREAM_CHUNK`, `AI_CHAT_V2_STREAM_COMPLETE`
- invoke channels: `AI_CHAT_V2_MODELS`, `AI_CHAT_V2_CONVERSATIONS`, `AI_CHAT_V2_HISTORY`, `AI_CHAT_V2_CLEAR_CONVERSATION`, `AI_CHAT_V2_CLEAR_ALL`

Renderer code should continue to use the existing safe wrapper pattern, not `ipcRenderer` directly.

### 6.3 IPC Handler Registration

Add one registration function:

```typescript
export function registerAiChatV2IpcHandlers(): void {
  ipcMain.handle(AI_CHAT_V2_MODELS, handleModels);
  ipcMain.handle(AI_CHAT_V2_CONVERSATIONS, handleConversations);
  ipcMain.handle(AI_CHAT_V2_HISTORY, handleHistory);
  ipcMain.handle(AI_CHAT_V2_CLEAR_CONVERSATION, handleClearConversation);
  ipcMain.handle(AI_CHAT_V2_CLEAR_ALL, handleClearAll);
  ipcMain.on(AI_CHAT_V2_STREAM, handleStream);
  ipcMain.on(AI_CHAT_V2_STREAM_STOP, handleStop);
}
```

Register it from `src/main-process/communication/index.ts` beside the old chat registration.

### 6.4 AI Enable Gate

Every v2 AI handler must check AI enable before parsing request data.

Pattern:

```typescript
function isAIEnabled(): boolean {
  const tokenService = new Token();
  const aiEnabled = tokenService.getValue(USER_AI_ENABLED);
  return aiEnabled === "true";
}
```

For invoke handlers:

```typescript
if (!isAIEnabled()) {
  return {
    status: false,
    msg: "AI is not enabled",
    data: null,
  };
}
```

For stream handlers:

```typescript
if (!isAIEnabled()) {
  sender.send(AI_CHAT_V2_STREAM_COMPLETE, JSON.stringify({
    eventType: "error",
    conversationId: "",
    errorMessage: "AI is not enabled",
  }));
  return;
}
```

This is required by the project rules.

### 6.5 Active Stream State

V2 must track its stream independently from the old chat stream:

```typescript
let currentChatV2AbortController: AbortController | null = null;
let currentChatV2ConversationId: string | null = null;
let currentChatV2AssistantMessageId: string | null = null;
```

Rules:

- Starting a new v2 stream aborts or rejects any existing v2 stream for the same window.
- Stopping v2 stream must not stop the old chat stream.
- Old chat stop must not stop v2 stream.
- Late chunks after abort must be ignored.

## 7. Module Design

### 7.1 AIChatV2Module

Add `src/modules/AIChatV2Module.ts` if the v2 logic grows beyond a thin wrapper around `AIChatModule`.

Suggested public methods:

```typescript
export class AIChatV2Module extends BaseModule {
  async createConversationIfNeeded(input?: string): Promise<string>;

  async saveUserMessage(params: {
    conversationId: string;
    content: string;
    messageId: string;
    timestamp?: Date;
  }): Promise<AIChatMessageEntity>;

  async saveAssistantMessage(params: {
    conversationId: string;
    content: string;
    messageId: string;
    model?: string;
    tokensUsed?: number;
    metadata?: ChatV2MessageMetadata;
    timestamp?: Date;
  }): Promise<AIChatMessageEntity>;

  async getConversationMessages(
    conversationId: string,
    options?: { limit?: number; offset?: number; source?: "chat-v2" }
  ): Promise<AIChatMessageEntity[]>;

  async getConversations(): Promise<ChatV2ConversationSummary[]>;

  async clearConversation(conversationId: string): Promise<number>;
}
```

The module should delegate persistence to `AIChatModule` and `AIChatMessageModel` where possible.

### 7.2 Conversation Namespace

V2 has two options:

1. Reuse all existing conversations.
2. Filter to v2 conversations only.

Recommendation:

- Phase 1 should show only v2-tagged conversations.
- Use metadata `source: "chat-v2"` on saved v2 messages.
- Existing old chat history stays intact and unchanged.

This avoids strange rendering when old rows contain legacy tool events or plan events that v2 cannot display yet.

## 8. Transcript Builder

### 8.1 Purpose

`OpenAIChatTranscriptBuilder` converts local database rows into the exact OpenAI `messages[]` payload for the next model call.

It must be pure. It should not call the database, write rows, call remote APIs, or know about Vue state.

### 8.2 Input And Output

```typescript
export interface BuildOpenAITranscriptInput {
  history: AIChatMessageEntity[];
  currentUserMessage?: string;
  systemPrompt?: string;
  includeToolMessages?: boolean;
  maxMessages?: number;
}

export interface BuildOpenAITranscriptResult {
  messages: OpenAIChatMessage[];
  skippedMessageIds: string[];
  warnings: string[];
}
```

### 8.3 Phase 1 Algorithm

```text
1. Start with an empty messages array.
2. If systemPrompt is provided, push { role: "system", content: systemPrompt }.
3. Sort history by timestamp ascending, then id ascending.
4. Filter out rows where metadata.source is not "chat-v2", if source filtering is enabled.
5. For each row:
   a. If messageType is MESSAGE and role is system, user, or assistant, push it.
   b. If messageType is TOOL_CALL or TOOL_RESULT, skip it and record a warning.
   c. If role is unsupported, skip it and record a warning.
6. If currentUserMessage is provided, append { role: "user", content: currentUserMessage }.
7. Return messages, skipped IDs, and warnings.
```

### 8.4 Phase 2 Tool Mapping

Tool-call row metadata must be shaped so this mapping is deterministic:

```json
{
  "source": "chat-v2",
  "toolCallId": "call_abc123",
  "toolName": "search_yellow_pages",
  "toolArguments": {
    "keyword": "dentist",
    "location": "Austin"
  }
}
```

Map it to:

```typescript
{
  role: "assistant",
  content: null,
  tool_calls: [
    {
      id: metadata.toolCallId,
      type: "function",
      function: {
        name: metadata.toolName,
        arguments: JSON.stringify(metadata.toolArguments ?? {})
      }
    }
  ]
}
```

Tool-result row metadata:

```json
{
  "source": "chat-v2",
  "toolCallId": "call_abc123",
  "toolName": "search_yellow_pages",
  "toolResultStatus": "success"
}
```

Map it to:

```typescript
{
  role: "tool",
  tool_call_id: metadata.toolCallId,
  content: row.content
}
```

### 8.5 Tool Group Integrity

When context trimming is introduced, the builder must preserve tool groups.

A tool group is:

```text
assistant message with tool_calls
  followed by one role=tool message for each tool_call_id
```

Invalid truncation:

```text
role=tool without the preceding assistant tool_calls message
```

Invalid truncation:

```text
assistant tool_calls message without every matching role=tool result
```

For Phase 1, avoid this by skipping tool rows entirely. For Phase 2, add group-aware trimming before enabling context limits.

## 9. OpenAI Stream Accumulator

### 9.1 Purpose

`OpenAIStreamAccumulator` converts raw OpenAI chunks into app-level stream state.

It should:

- accumulate assistant text
- remember OpenAI response ID and model
- detect finish reasons
- buffer fragmented tool calls
- expose stable app-level events to IPC

### 9.2 Text State

```typescript
export interface OpenAIStreamTextState {
  responseId?: string;
  model?: string;
  fullContent: string;
  finishReason?: string | null;
}
```

For each chunk:

```text
1. Read chunk.id and chunk.model if present.
2. For each choice:
   a. If delta.content is a string, append it to fullContent.
   b. If finish_reason is present, store it.
3. Emit content delta only when non-empty.
```

### 9.3 Tool Call State

OpenAI tool calls can stream in fragments:

```json
{
  "choices": [
    {
      "delta": {
        "tool_calls": [
          {
            "index": 0,
            "id": "call_abc",
            "type": "function",
            "function": {
              "name": "search",
              "arguments": "{\"query\":\"den"
            }
          }
        ]
      }
    }
  ]
}
```

Later chunk:

```json
{
  "choices": [
    {
      "delta": {
        "tool_calls": [
          {
            "index": 0,
            "function": {
              "arguments": "tists\"}"
            }
          }
        ]
      },
      "finish_reason": "tool_calls"
    }
  ]
}
```

Accumulator state:

```typescript
export interface BufferedOpenAIToolCall {
  index: number;
  id?: string;
  type?: "function";
  name?: string;
  argumentsJson: string;
}
```

Rules:

- Buffer by `index`.
- Preserve first non-empty `id`.
- Preserve first non-empty `type`.
- Append `function.arguments` fragments in order.
- Preserve first non-empty `function.name`.
- Parse `argumentsJson` only when `finish_reason === "tool_calls"` or stream ends.
- Treat malformed JSON as a tool-call error, not as trusted input.

Phase 1 should detect this but not execute tools.

## 10. Stream Lifecycle

### 10.1 Normal Streaming Sequence

```text
Renderer sends AI_CHAT_V2_STREAM
  -> main process checks AI enabled
  -> main process parses and validates request
  -> module creates conversation ID if needed
  -> module saves user message
  -> module loads local history
  -> transcript builder builds messages[]
  -> main process sends start chunk
  -> AiChatApi.openAIChatCompletionStream starts fetch
  -> each OpenAI chunk is accumulated
  -> token chunks are sent to renderer
  -> stream completes
  -> module saves assistant message
  -> complete chunk is sent to renderer
  -> active stream state is cleared
```

### 10.2 Error Sequence

```text
Remote call fails or stream parser throws
  -> active stream is cleared
  -> user message remains saved
  -> assistant message is saved only if partial text exists
  -> error completion chunk is sent to renderer
```

Error chunk:

```typescript
{
  eventType: "error",
  conversationId,
  messageId: partialAssistantMessageId,
  errorMessage: userSafeMessage
}
```

### 10.3 Cancellation Sequence

```text
Renderer sends AI_CHAT_V2_STREAM_STOP
  -> main process aborts current AbortController
  -> stream read rejects with AbortError
  -> if fullContent is non-empty, save partial assistant message with cancelled metadata
  -> send cancelled completion chunk
  -> active stream state is cleared
```

Cancellation should not delete the user's message.

### 10.4 Late Chunk Protection

Every chunk handler should compare the active conversation and assistant message IDs before mutating state.

```typescript
if (currentChatV2ConversationId !== conversationId) return;
if (currentChatV2AssistantMessageId !== assistantMessageId) return;
```

This prevents old async callbacks from writing to a newly selected conversation.

## 11. Renderer UI Design

### 11.1 Component Tree

```text
AiChatV2.vue
  AiChatV2ConversationList.vue
  AiChatV2Messages.vue
    AiChatV2Message.vue
      AiChatV2ToolBlock.vue
      AiChatV2StreamStatus.vue
  AiChatV2Composer.vue
```

### 11.2 State Owned By AiChatV2.vue

```typescript
interface AiChatV2State {
  conversations: ChatV2ConversationSummary[];
  activeConversationId: string | null;
  messages: ChatV2MessageView[];
  draft: string;
  selectedModel?: string;
  models: OpenAIModel[];
  isLoadingHistory: boolean;
  isStreaming: boolean;
  streamError: string | null;
  activeAssistantMessageId: string | null;
}
```

### 11.3 Message Rendering

Render by role and message type:

| Role | Message type | Rendering |
|---|---|---|
| user | message | right-aligned or user-styled bubble |
| assistant | message | assistant message with Markdown rendering |
| assistant | tool_call | compact tool status block |
| tool | tool_result | compact tool result block |
| system | message | hidden by default or small system notice |

Phase 1 only needs user and assistant message rendering. Tool blocks can be placeholders.

### 11.4 Nuxt UI Chat Reference Mapping

| Nuxt UI Chat concept | AiFetchly v2 equivalent |
|---|---|
| `ChatMessages` | `AiChatV2Messages.vue` |
| `ChatMessage` | `AiChatV2Message.vue` |
| `ChatPrompt` | `AiChatV2Composer.vue` |
| `ChatPromptSubmit` | submit and stop icon buttons |
| `ChatTool` | `AiChatV2ToolBlock.vue` |
| `ChatReasoning` | deferred reasoning section |
| `ChatShimmer` | subtle streaming status text or skeleton |

Do not install Nuxt UI to implement these patterns. Use Vuetify controls and existing app styling.

### 11.5 Accessibility And Layout

Requirements:

- Composer buttons must have accessible labels.
- Stop button must be visually distinct from send.
- Message list must preserve scroll position when loading history.
- Streaming text must not cause horizontal overflow.
- Long URLs and code blocks must wrap or scroll inside the message container.
- Empty state must not look like a landing page.

## 12. Renderer API Wrapper

Add `src/views/api/aiChatV2.ts`.

Suggested shape:

```typescript
export async function getOpenAIChatModels(): Promise<CommonMessage<OpenAIModelsResponse | null>>;

export async function getChatV2Conversations(): Promise<CommonMessage<ChatV2ConversationSummary[]>>;

export async function getChatV2History(
  conversationId: string
): Promise<CommonMessage<ChatV2HistoryResponse | null>>;

export async function streamChatV2Message(
  request: ChatV2StreamRequest,
  onChunk: (chunk: ChatV2StreamChunk) => void,
  onComplete: (chunk: ChatV2StreamChunk) => void,
  onError: (error: Error) => void
): Promise<void>;

export function stopChatV2Stream(): void;

export async function clearChatV2Conversation(
  conversationId: string
): Promise<CommonMessage<{ deleted: number } | null>>;
```

Listener cleanup is required before registering stream listeners:

```typescript
windowRemove(AI_CHAT_V2_STREAM_CHUNK, existingChunkHandler);
windowRemove(AI_CHAT_V2_STREAM_COMPLETE, existingCompleteHandler);
```

Match the existing `src/views/api/aiChat.ts` pattern.

## 13. API Client Requirements

### 13.1 Endpoint Normalization

`AiChatApi` should use endpoints that match the server router and `HttpClient` base URL.

Expected:

```typescript
listOpenAIModels() -> this._httpClient.get("/v1/models")
openAIChatCompletion() -> this._httpClient.postJson("/v1/chat/completions", data)
openAIChatCompletionStream() -> this._httpClient.postStream("/v1/chat/completions", data, options)
```

If existing methods use `/api/ai/v1/chat/completions`, fix that before the v2 IPC uses them.

### 13.2 SSE Parser Behavior

The parser must handle:

- blank lines between SSE events
- `data: [DONE]`
- multiple data lines in one read
- split JSON across reads
- `AbortError`
- chunks with empty role-only delta
- chunks with content delta
- chunks with tool-call delta

The parser should ignore malformed individual chunk lines only if the stream can continue safely. It should surface repeated or final parse failure to the caller.

## 14. Persistence Rules

### 14.1 User Message Save

Save the user message before calling the AI server.

Reason:

- If the server fails, the user still sees what they asked.
- Retry can use the saved local state.

Metadata:

```json
{
  "source": "chat-v2"
}
```

### 14.2 Assistant Message Save

Save assistant message on:

- normal completion with non-empty content
- cancellation with non-empty partial content
- error after non-empty partial content

Do not save assistant message when:

- stream fails before any content
- AI is disabled
- request validation fails before remote call

### 14.3 Tool Rows

Phase 1:

- Do not save tool rows from v2 unless tool support is explicitly enabled.

Phase 2:

- Save assistant tool-call row before executing the tool.
- Save tool result row after execution.
- Save final assistant answer after follow-up completion.

### 14.4 Shared Table Risk

If v2 uses the existing `ai_chat_messages` table, old and new rows can share the same conversation ID accidentally.

Mitigation:

- Generate v2 conversation IDs with a distinct prefix, for example `v2-${uuid}`.
- Save metadata `{ "source": "chat-v2" }`.
- Filter v2 conversation lists to v2 metadata or v2 prefix.

## 15. Tool Calling Design For Phase 2

### 15.1 Tool Manifest

Convert registered local tools to OpenAI tool schema:

```typescript
export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}
```

The existing `ToolFunction` shape is close, but v2 should use a conversion function:

```typescript
function toOpenAITool(tool: ToolFunction): OpenAITool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters ?? { type: "object", properties: {} },
    },
  };
}
```

### 15.2 Tool Execution Flow

```text
Model streams tool_call deltas
  -> accumulator buffers tool calls
  -> finish_reason is "tool_calls"
  -> persist assistant tool_call message
  -> validate tool name against registry
  -> execute tool through existing SkillExecutor or ToolExecutor
  -> persist role=tool result
  -> rebuild transcript from local DB
  -> call /v1/chat/completions again with stream=true
  -> stream final assistant answer
```

### 15.3 Permission Flow

V2 must reuse existing permission behavior. Tool execution must not run only because the model requested it.

Rules:

- Tool name must be registered or explicitly allowed.
- Permission-required tools must pause and ask the renderer.
- Dependency-install prompts must remain user-approved.
- Tool arguments must be validated before execution.
- Tool results sent back to the model must be sanitized.

### 15.4 Tool Loop Limit

Add a max loop count to prevent runaway tool calls:

```typescript
const MAX_CHAT_V2_TOOL_STEPS = 6;
```

If the limit is reached:

- save an error tool result or assistant error message
- emit a visible error chunk
- stop the loop

## 16. Context Window Design For Phase 3

### 16.1 Initial Phase 1 Limit

Phase 1 can use a simple recent-message cap:

```typescript
const CHAT_V2_PHASE1_MAX_HISTORY_MESSAGES = 30;
```

This avoids sending unbounded history before token counting exists.

### 16.2 Token-Budget Context

Phase 3 should introduce:

```typescript
export interface ContextWindowOptions {
  maxInputTokens: number;
  reservedOutputTokens: number;
  systemPromptTokens: number;
}
```

Selection order:

```text
1. system prompt
2. durable summary, if present
3. most recent complete message groups
4. current user message
```

Tool groups must be atomic. Do not include half a tool group.

### 16.3 Summary Rows

Use metadata to mark summary coverage:

```json
{
  "source": "chat-v2",
  "summary": true,
  "coversMessageIds": ["user-1", "assistant-1"],
  "summaryVersion": 1
}
```

Summary content should be structured:

```text
User goals:
Decisions:
Important facts:
Open tasks:
Constraints:
Tool/file references:
```

## 17. Error Handling

### 17.1 User-Safe Errors

Do not show raw stack traces or token details in the renderer.

Map errors:

| Source | User message |
|---|---|
| AI disabled | AI is not enabled. |
| 401 or 403 | Please sign in again. |
| 404 model not found | Selected model is not available. |
| 503 no chat model | No chat model is configured on the AI server. |
| network failure | Could not connect to the AI server. |
| AbortError | Generation stopped. |
| malformed tool args | The assistant requested a tool with invalid arguments. |

### 17.2 Developer Diagnostics

Log structured diagnostics in the main process:

```typescript
console.error("AI Chat V2 stream error", {
  conversationId,
  model,
  stage: "openai-stream",
  error,
});
```

Do not log full prompts or attachment contents by default.

## 18. i18n Keys

Add a new group, for example `aiChatV2`, to all language files.

Required keys:

```typescript
aiChatV2: {
  title: string;
  new_conversation: string;
  empty_title: string;
  empty_description: string;
  input_placeholder: string;
  send: string;
  stop: string;
  retry: string;
  clear_conversation: string;
  clear_all: string;
  loading_models: string;
  loading_history: string;
  streaming: string;
  cancelled: string;
  ai_disabled: string;
  model_unavailable: string;
  server_unavailable: string;
  unsupported_tool_call: string;
  clear_confirm_title: string;
  clear_confirm_body: string;
}
```

Every new visible string in v2 Vue components must use `t()` with an English fallback.

## 19. Testing Plan

### 19.1 Unit Tests

Add tests for `OpenAIChatTranscriptBuilder`:

```text
test/vitest/main/service/OpenAIChatTranscriptBuilder.test.ts
```

Cases:

- empty history plus current user message
- system prompt plus current user message
- user and assistant history maps in timestamp order
- current user message is appended once
- old non-v2 rows are filtered
- malformed metadata does not throw
- tool rows are skipped in Phase 1 with warnings
- tool-call and tool-result rows map correctly in Phase 2
- truncation does not split tool groups in Phase 3

Add tests for `OpenAIStreamAccumulator`:

```text
test/vitest/main/service/OpenAIStreamAccumulator.test.ts
```

Cases:

- role-only chunk does not create text
- content deltas append to full content
- finish reason is captured
- `[DONE]` is treated as completion by parser caller
- tool-call argument fragments are buffered
- malformed tool-call JSON is reported after finish

### 19.2 IPC Tests

Add:

```text
test/vitest/main/ipc/ai-chat-v2-ipc.test.ts
```

Cases:

- AI disabled returns before JSON parsing
- stream start saves user message
- stream completion saves assistant message
- stop aborts active stream
- remote error emits completion error chunk
- old chat channels are not touched

### 19.3 UI Tests

Component tests or QA should cover:

- empty state
- model load error
- existing history rendering
- streaming into a single assistant row
- stop button behavior
- clear conversation confirmation
- long text wrapping
- narrow viewport layout

### 19.4 Manual Verification

Run:

```bash
yarn testmain
yarn vue-check
yarn tsc-result
```

If UI is implemented:

```bash
yarn dev
```

Then verify:

- v2 chat opens
- old chat still opens
- new conversation streams a response
- stop generation preserves partial response correctly
- history reloads after switching conversation
- AI disabled state returns without remote call

## 20. Migration And Rollout

### 20.1 Phase 1 Rollout

1. Add v2 code behind a feature flag.
2. Keep old chat as default.
3. Use v2 internally for normal chat.
4. Fix stream, history, and layout issues.
5. Switch the default chat entry to v2 only after validation.

### 20.2 Fallback

If v2 fails in production:

- disable the v2 flag
- route users to old chat
- keep v2 local rows in SQLite for debugging
- do not delete old chat code until v2 tool support is stable

### 20.3 Data Migration

Phase 1 should not migrate old conversations automatically.

Reason:

- Old rows may include legacy stream events and plan events.
- V2 cannot faithfully render all old message types yet.

Later migration can be explicit:

```text
Import legacy conversation into v2
  -> copy message rows
  -> drop unsupported legacy event rows
  -> tag copied rows source=chat-v2
  -> create migration report
```

## 21. Implementation Order

Recommended order:

1. Normalize `AiChatApi` OpenAI-compatible endpoints.
2. Add v2 channel constants and preload allowlist.
3. Add transcript builder and tests.
4. Add stream accumulator and tests.
5. Add v2 module methods for local history and message save.
6. Add v2 IPC handlers.
7. Add renderer API wrapper.
8. Add v2 UI shell.
9. Add streaming UI.
10. Add model selector and conversation list.
11. Add i18n keys for all supported languages.
12. Add UI QA and fix layout.
13. Add feature flag replacement path.
14. Add Phase 2 tool-loop design implementation only after Phase 1 is stable.

This order puts the highest-risk protocol and persistence pieces under test before UI work depends on them.

## 22. Known Technical Decisions

### 22.1 Use Existing SQLite Chat Table In Phase 1

Decision:

- Reuse `ai_chat_messages`.
- Tag v2 rows with metadata.
- Use v2 conversation ID prefix.

Trade-off:

- Slight filtering complexity.
- No new migration is needed for normal Phase 1 chat.

### 22.2 Keep Renderer Free Of Remote AI Details

Decision:

- Renderer calls only IPC.
- Main process calls `AiChatApi`.

Trade-off:

- Slightly more IPC code.
- Auth, AI gating, and stream cancellation remain safer and consistent with the app.

### 22.3 Do Not Add LangChain Or LangGraph In Client

Decision:

- Use direct OpenAI-compatible API calls.

Trade-off:

- The app owns transcript and tool-loop code.
- The design avoids a second agent runtime in Electron.

### 22.4 Use Nuxt UI Chat As Reference Only

Decision:

- Copy the component separation and interaction model.
- Implement with Vue 3 and Vuetify.

Trade-off:

- More local UI work.
- No dependency mismatch with the current app.

## 23. Open Questions For Implementation

1. Should v2 conversations be completely hidden from old chat, or should old chat ignore them naturally?
2. Should the feature flag be stored in local settings, remote config, or both?
3. Should Phase 1 include image attachments if the server already accepts them through OpenAI-compatible messages?
4. Should Markdown rendering use the existing renderer or add a streaming-friendly renderer like `@comark/vue` later?
5. Should model selection persist globally or per conversation?

## 24. References

- Product requirements: `docs/openai-compatible-chat-v2-prd.md`
- Local memory design: `docs/ai-chat-local-memory-design.md`
- Legacy chat docs: `docs/ai-chat-technical-docs.md`
- Client API wrapper: `src/api/aiChatApi.ts`
- Local chat entity: `src/entity/AIChatMessage.entity.ts`
- Local chat module: `src/modules/AIChatModule.ts`
- IPC constants: `src/config/channellist.ts`
- Preload bridge: `src/preload.ts`
- Server OpenAI-compatible route: `/home/robertzeng/project/aifetchserver/aifetchserver/api/openai_compatible.py`
- Server schema: `/home/robertzeng/project/aifetchserver/aifetchserver/schemas/openai_compatible.py`
- Server examples: `/home/robertzeng/project/aifetchserver/doc/api/openai_compatible.http`
- Nuxt UI Chat reference: https://ui.nuxt.com/docs/components/chat
- Nuxt UI ChatMessage reference: https://ui.nuxt.com/docs/components/chat-message
- Nuxt UI ChatPrompt reference: https://ui.nuxt.com/docs/components/chat-prompt
