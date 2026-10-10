# OpenAI-Compatible Chat V2 - Product Requirements Document

## 1. Executive Summary

### 1.1 Overview

AiFetchly should add a new AI chat experience built around the AI server's OpenAI-compatible Chat Completions API and local application-owned conversation history.

This is not an in-place rewrite of the existing chat UI. The new experience should be implemented as a parallel v2 chat stack with new UI components, new renderer API wrappers, and new IPC channels. The old `AiChatBox.vue`, old IPC flow, `/api/ai/ask/stream`, and `/api/ai/ask/continue` should remain available during migration.

The target user experience should use Nuxt UI Chat as a product interaction reference: clear message list, prompt area, submit and stop controls, streaming state, tool status blocks, and optional reasoning/status sections. The implementation should stay native to this codebase: Vue 3, Vuetify, Electron IPC, TypeScript, local SQLite, and the existing `AiChatApi` HTTP client.

### 1.1.1 Companion Documents

- Technical design: `docs/openai-compatible-chat-v2-technical-design.md`
- Local memory design: `docs/ai-chat-local-memory-design.md`

### 1.2 Goals

- Create a new chat UI that can replace the old chat UI after validation, without modifying the old chat UI during initial development.
- Use the AI server's OpenAI-compatible API for chat: `POST /v1/chat/completions` and `GET /v1/models`.
- Make the local Electron app the source of truth for conversation history.
- Convert local history into OpenAI `messages[]` for each request.
- Support streaming assistant responses through new IPC events.
- Preserve AI enable gating before any AI work starts.
- Use the existing local database architecture: IPC handler calls Module, Module calls Model, Model uses TypeORM.
- Keep the first release focused enough to ship safely, then add tool-calling depth incrementally.

### 1.3 Non-Goals

- Do not modify the old chat UI in the initial v2 implementation.
- Do not remove `/api/ai/ask/stream` or `/api/ai/ask/continue`.
- Do not add LangChain or LangGraph to the Electron client for the first v2 release.
- Do not migrate server-side plan-execute agent events in the first v2 release.
- Do not adopt Nuxt UI as a dependency. Use it as a reference only.
- Do not expose remote AI tokens, backend auth details, or model-provider details to the renderer.
- Do not let worker processes access chat history or the database directly.

## 2. Background

The current chat system is centered on a legacy streaming contract. The server emits app-specific events such as `token`, `tool_call`, `tool_result`, `done`, `conversation_start`, and plan execution events. The Electron main process receives those events, `StreamEventProcessor` translates them into renderer chunks, and the old Vue component renders the result.

That design works, but it mixes several responsibilities:

- remote server conversation state
- local chat persistence
- stream event translation
- tool execution continuation
- UI rendering state

The AI server now exposes an OpenAI-compatible API. That API naturally expects the client to send the complete model context as `messages[]`. The server can then behave as a stateless model gateway for normal chat. This matches the direction already described in `docs/ai-chat-local-memory-design.md`: the local app should own raw transcript storage, summary state, context selection, and request assembly.

Nuxt UI Chat is a useful reference because its documented component model separates chat into the right UI primitives: message list, individual message, prompt, submit/stop button, reasoning block, tool block, and streaming shimmer. Its docs describe chat components for streaming, reasoning, and tool calling, with components such as `ChatMessages`, `ChatMessage`, `ChatPrompt`, `ChatPromptSubmit`, `ChatReasoning`, `ChatTool`, and `ChatShimmer`. See:

- https://ui.nuxt.com/docs/components/chat
- https://ui.nuxt.com/docs/components/chat-message
- https://ui.nuxt.com/docs/components/chat-prompt

AiFetchly should use that separation as design guidance while building with Vuetify and the existing app architecture.

## 3. Users And Use Cases

### 3.1 Primary Users

- AiFetchly users who ask the AI assistant for marketing strategy, lead-generation help, scraping guidance, and campaign-writing support.
- Users who want chat history to persist locally and remain available across sessions.
- Users who need a clearer, calmer chat UI than the current legacy panel.

### 3.2 Developer Users

- Developers who need a simpler chat stack to debug.
- Developers who need a clean migration path from server-owned chat state to client-owned chat state.
- Developers who need reliable tests around transcript reconstruction, streaming, and tool-call loops.

### 3.3 Core Use Cases

1. A user opens the v2 chat panel and starts a new conversation.
2. The app saves the user message locally.
3. The main process builds OpenAI `messages[]` from local history.
4. The main process calls `POST /v1/chat/completions` with `stream: true`.
5. The renderer displays assistant text as it streams.
6. The app saves the completed assistant message locally.
7. The user switches conversations and sees local history restored.
8. The user stops a streaming response and the UI returns to an idle, recoverable state.

## 4. Product Principles

### 4.1 Local History Is The Source Of Truth

The local SQLite chat history must be the authoritative transcript for v2 chat. The server should not be relied on to remember prior turns.

### 4.2 New Stack Before Replacement

Build the v2 stack beside the old stack. Replacement should happen only after the v2 stack is validated.

### 4.3 OpenAI-Compatible At The Boundary

The API boundary should use OpenAI-compatible request and response types:

- `messages`
- `model`
- `temperature`
- `max_tokens`
- `stream`
- `tools`
- `tool_choice`
- `tool_calls`
- `tool_call_id`

Internal UI components do not need to mirror OpenAI's wire format directly. They should use app-specific view models that are easier to render.

### 4.4 Main Process Owns Remote AI Work

The renderer must not call the AI server directly. Renderer code talks to preload-safe APIs, which call IPC, which calls the main process, which calls `AiChatApi`.

### 4.5 UI Should Be Calm And Operational

The chat surface is part of a desktop productivity app, not a marketing landing page. It should prioritize readable messages, clear controls, compact tool/status displays, and stable layout.

## 5. Scope

### 5.1 Phase 1 Scope

Phase 1 should deliver a usable v2 chat without full legacy feature parity.

Required:

- New chat UI component tree.
- New renderer API wrapper.
- New IPC channels.
- AI enable check at the start of every v2 AI IPC handler.
- OpenAI-compatible model listing.
- OpenAI-compatible streaming chat.
- Local conversation creation and loading.
- Local message persistence for user and assistant messages.
- Transcript builder from local DB rows to OpenAI `messages[]`.
- Stop-stream support.
- Error display and retry-ready state.
- i18n keys for all user-facing text in English, Chinese, Spanish, French, German, and Japanese.
- Feature flag or route/menu switch that allows v2 chat to be enabled without deleting old chat.

Deferred:

- Full tool-calling loop.
- Plan-execute events.
- Reasoning blocks, unless the server provides compatible reasoning deltas.
- Attachment support beyond simple text references.
- RAG tool integration, unless already exposed as a normal OpenAI tool.
- Conversation summarization and token-budget compaction.
- Message queueing while another response streams.

### 5.2 Phase 2 Scope

Phase 2 should add OpenAI tool calling:

- Convert local skills to OpenAI `tools`.
- Buffer streamed `delta.tool_calls`.
- Execute local tools after `finish_reason: "tool_calls"`.
- Persist assistant tool calls and tool result messages locally.
- Send a follow-up OpenAI request containing assistant `tool_calls` and `role: "tool"` messages.
- Render tool-call and tool-result blocks in the v2 UI.
- Preserve permission prompts and dependency-install prompts where relevant.

### 5.3 Phase 3 Scope

Phase 3 should add advanced context management:

- Token-budget-aware history selection.
- Conversation summaries.
- Safe truncation that never splits an assistant tool call from its matching tool messages.
- Attachment-aware context references.
- RAG context selection and citations.

## 6. User Experience Requirements

### 6.1 Layout

The v2 chat UI should use a three-zone layout:

1. Conversation sidebar or compact selector
2. Scrollable message area
3. Prompt composer

The message area should auto-scroll while streaming unless the user has intentionally scrolled upward.

### 6.2 Message List

Inspired by Nuxt UI Chat's `ChatMessages` and `ChatMessage` separation, v2 should use separate components for the message list and individual message rows.

Required message states:

- user message
- assistant message
- assistant streaming message
- error message
- cancelled response
- empty conversation state
- loading history state

Recommended component names:

- `AiChatV2.vue`
- `AiChatV2Messages.vue`
- `AiChatV2Message.vue`
- `AiChatV2Composer.vue`
- `AiChatV2ConversationList.vue`
- `AiChatV2StreamStatus.vue`

### 6.3 Composer

Inspired by Nuxt UI Chat's `ChatPrompt` and `ChatPromptSubmit`, the composer should keep text entry, submit, stop, and error state visually close but not overloaded.

Required:

- Multi-line text input.
- Enter to send.
- Shift+Enter for newline.
- Submit button.
- Separate stop button while streaming.
- Disabled submit state when the draft is empty.
- Visible error state when the last request fails.

### 6.4 Streaming

When the assistant is streaming:

- Show assistant text incrementally.
- Show a subtle streaming indicator.
- Keep layout dimensions stable.
- Allow stop generation.
- Save the assistant message only after completion or cancellation policy is applied.

Cancellation policy:

- If the user stops after partial text arrived, keep the partial assistant message and mark metadata as cancelled.
- If the user stops before any assistant text arrived, do not create an empty assistant message.

### 6.5 Tool And Reasoning UI

Phase 1 should define the visual slots but may not populate them.

Inspired by Nuxt UI Chat's `ChatTool`, `ChatReasoning`, and `ChatShimmer`:

- Tool calls should render as compact collapsible status blocks.
- Tool results should render as compact result blocks.
- Reasoning should render only if the server provides an explicit reasoning part.
- Streaming placeholders should be subtle and not dominate the page.

### 6.6 Conversation Switching

Required:

- List recent conversations.
- Open an existing conversation.
- Start a new conversation.
- Clear one conversation.
- Clear all v2 chat history only through an explicit confirmation.

If a stream is active and the user switches conversation:

- The app should stop the active stream before switching, or
- The app should block switching until the stream ends.

Recommendation:

- Stop the active stream and mark the partial assistant message according to the cancellation policy.

## 7. Functional Requirements

### 7.1 API Client

`src/api/aiChatApi.ts` already includes OpenAI-compatible types and methods. V2 should use or refine these methods:

- `listOpenAIModels()`
- `openAIChatCompletion()`
- `openAIChatCompletionStream()`

Required checks:

- Confirm the path prefix matches the server and `HttpClient` base URL behavior.
- Confirm streaming parser handles `data: [DONE]`.
- Confirm streaming parser handles chunks that contain `choices[].delta.content`.
- Confirm streaming parser handles chunks that contain `choices[].delta.tool_calls`, even if Phase 1 does not execute tools yet.

### 7.2 IPC Channels

V2 must use new channels so the old chat path remains untouched.

Recommended channel names:

- `AI_CHAT_V2_MODELS`
- `AI_CHAT_V2_CONVERSATIONS`
- `AI_CHAT_V2_HISTORY`
- `AI_CHAT_V2_SEND`
- `AI_CHAT_V2_STREAM`
- `AI_CHAT_V2_STREAM_CHUNK`
- `AI_CHAT_V2_STREAM_COMPLETE`
- `AI_CHAT_V2_STREAM_STOP`
- `AI_CHAT_V2_CLEAR_CONVERSATION`
- `AI_CHAT_V2_CLEAR_ALL`

Every v2 AI IPC handler must check AI enable first, before parsing request data or calling AI APIs.

### 7.3 Local Transcript Builder

The transcript builder is the core of v2.

Required input:

- conversation ID
- local messages ordered by timestamp
- current user message
- optional system prompt
- model context limits, when available

Required output:

```typescript
interface OpenAIChatCompletionRequest {
  model?: string;
  messages: OpenAIChatMessage[];
  stream?: boolean;
  tools?: OpenAITool[];
  tool_choice?: OpenAIToolChoice;
  temperature?: number;
  max_tokens?: number;
}
```

Phase 1 mapping:

| Local row | OpenAI message |
|---|---|
| `role = system`, `messageType = message` | `{ role: "system", content }` |
| `role = user`, `messageType = message` | `{ role: "user", content }` |
| `role = assistant`, `messageType = message` | `{ role: "assistant", content }` |

Phase 2 mapping:

| Local row | OpenAI message |
|---|---|
| `messageType = tool_call` | assistant message with `content: null` and `tool_calls` |
| `messageType = tool_result` | tool message with `tool_call_id` and serialized `content` |

Rules:

- The builder must preserve chronological order.
- The builder must not include malformed tool rows in an OpenAI request.
- If history truncation is applied, it must not split a tool-call group.
- The current user message should be appended exactly once.
- Draft or queued messages must not appear in history until actually sent.

### 7.4 Persistence

V2 should reuse existing chat storage where practical, but it may add fields if needed for OpenAI compatibility.

Current useful pieces:

- `src/entity/AIChatMessage.entity.ts`
- `src/model/AIChatMessage.model.ts`
- `src/modules/AIChatModule.ts`
- `MessageType.MESSAGE`
- `MessageType.TOOL_CALL`
- `MessageType.TOOL_RESULT`

Required persistence behavior:

- Save user message before starting the remote stream.
- Save assistant message after stream completion.
- Save cancellation metadata if a partial assistant message is kept.
- Save model metadata when available.
- Save token usage if available from non-streaming responses or final stream metadata.

Potential schema/type updates:

- Allow local/OpenAI role `tool` at the type level.
- Standardize tool-call metadata shape so it can reconstruct OpenAI `tool_calls`.
- Standardize tool-result metadata shape so it can reconstruct `tool_call_id`.

### 7.5 Renderer API

V2 should add a new renderer API wrapper, separate from `src/views/api/aiChat.ts`.

Recommended file:

- `src/views/api/aiChatV2.ts`

Required functions:

- `getOpenAIChatModels()`
- `getChatV2Conversations()`
- `getChatV2History(conversationId)`
- `streamChatV2Message(request, onChunk, onComplete, onError)`
- `stopChatV2Stream()`
- `clearChatV2Conversation(conversationId)`

### 7.6 Feature Flag Or Entry Point

V2 must be safely reachable without deleting old chat.

Acceptable options:

- Add a settings flag: `AI_CHAT_V2_ENABLED`.
- Add a development-only route or menu entry.
- Add a hidden toggle in the existing AI assistant launcher.

Recommendation:

- Use a settings flag plus a clearly named route/component entry. This keeps release control explicit.

## 8. OpenAI-Compatible Streaming Behavior

### 8.1 Text Streaming

For every chunk:

- Read `choices[0].delta.content`.
- Append content to the active assistant draft.
- Emit a v2 renderer chunk containing the delta and full message ID.

### 8.2 Completion

When stream ends:

- Handle `data: [DONE]`.
- Handle final chunks with `finish_reason`.
- Save the completed assistant message.
- Emit `AI_CHAT_V2_STREAM_COMPLETE`.

### 8.3 Tool Calls

Phase 1:

- Detect streamed `delta.tool_calls`.
- Do not execute tools unless the v2 tool loop is enabled.
- Show a clear unsupported-tool error if the model requests a tool while tool execution is disabled.

Phase 2:

- Buffer tool-call fragments by index and ID.
- Assemble the function name and JSON argument string.
- Validate arguments before execution.
- Persist the assistant tool-call row.
- Execute allowed local tool.
- Persist tool result row.
- Send the full updated transcript in a follow-up `POST /v1/chat/completions` request.

## 9. Architecture

### 9.1 Target Flow

```text
Renderer v2 UI
  -> src/views/api/aiChatV2.ts
  -> preload-safe IPC
  -> src/main-process/communication/ai-chat-v2-ipc.ts
  -> AIChatV2Module / AIChatModule
  -> AIChatMessageModel / TypeORM / SQLite
  -> OpenAI transcript builder
  -> AiChatApi.openAIChatCompletionStream()
  -> AI server /v1/chat/completions
  -> OpenAI stream chunk parser
  -> v2 IPC stream chunk
  -> Renderer v2 UI
```

### 9.2 Files To Add

Recommended:

- `src/main-process/communication/ai-chat-v2-ipc.ts`
- `src/views/api/aiChatV2.ts`
- `src/views/components/aiChatV2/AiChatV2.vue`
- `src/views/components/aiChatV2/AiChatV2Messages.vue`
- `src/views/components/aiChatV2/AiChatV2Message.vue`
- `src/views/components/aiChatV2/AiChatV2Composer.vue`
- `src/views/components/aiChatV2/AiChatV2ConversationList.vue`
- `src/service/OpenAIChatTranscriptBuilder.ts`
- `test/vitest/main/service/OpenAIChatTranscriptBuilder.test.ts`
- `test/vitest/main/ipc/ai-chat-v2-ipc.test.ts`

### 9.3 Files To Modify

Expected:

- `src/config/channellist.ts`
- `src/preload.ts`
- `src/main-process/communication/index.ts`
- `src/api/aiChatApi.ts`
- `src/entityTypes/commonType.ts`
- `src/modules/AIChatModule.ts`
- `src/views/lang/en.ts`
- `src/views/lang/zh.ts`
- `src/views/lang/es.ts`
- `src/views/lang/fr.ts`
- `src/views/lang/de.ts`
- `src/views/lang/ja.ts`
- app navigation or chat launcher component

## 10. Data Requirements

### 10.1 Conversation Metadata

Each conversation should expose:

- `conversationId`
- title or last-message preview
- created timestamp
- latest message timestamp
- message count
- active/cancelled/error status where useful

### 10.2 Message Metadata

Each message should support:

- stable message ID
- conversation ID
- role
- content
- timestamp
- message type
- model
- token usage
- metadata JSON

V2 metadata should support:

- `openaiResponseId`
- `finishReason`
- `cancelled`
- `toolCallId`
- `toolName`
- `toolArguments`
- `toolResultStatus`
- `source: "chat-v2"`

## 11. Security And Privacy Requirements

- AI enable must be checked first in every v2 AI IPC handler using `Token` and `USER_AI_ENABLED`.
- Renderer must not receive auth tokens.
- Renderer must not call remote AI endpoints directly.
- IPC handlers must validate and sanitize incoming request data.
- Database access must stay in Model and Module layers.
- Local tool execution must keep the existing permission model.
- Tool-call arguments must be treated as untrusted model output.
- Prompt injection from chat history, RAG content, or attachments must not bypass tool permissions.
- Stop-stream must abort remote fetch and prevent late chunks from mutating inactive conversations.

## 12. Internationalization Requirements

All new user-facing UI text must be translated in:

- `src/views/lang/en.ts`
- `src/views/lang/zh.ts`
- `src/views/lang/es.ts`
- `src/views/lang/fr.ts`
- `src/views/lang/de.ts`
- `src/views/lang/ja.ts`

Required translation groups:

- chat v2 title and empty state
- new conversation
- conversation list labels
- send
- stop
- retry
- clear conversation
- clear all conversations
- streaming status
- cancelled response
- model loading failure
- AI disabled message
- unsupported tool-call message
- network error message

## 13. Testing Requirements

### 13.1 Unit Tests

Required:

- Transcript builder maps simple history to OpenAI `messages[]`.
- Transcript builder appends current user message once.
- Transcript builder handles system messages.
- Transcript builder skips malformed tool rows in Phase 1.
- Transcript builder preserves tool-call/tool-result groups in Phase 2.
- Stream parser handles `delta.content`.
- Stream parser handles `data: [DONE]`.
- Stream parser buffers fragmented `delta.tool_calls`.
- AI disabled branch returns before parsing request data.

### 13.2 IPC Tests

Required:

- `AI_CHAT_V2_STREAM` checks AI enable first.
- `AI_CHAT_V2_STREAM_STOP` aborts active stream.
- Stream chunks include conversation ID and message ID.
- Completion event is emitted once.
- Errors are returned as structured v2 stream completion payloads.

### 13.3 UI Tests

Required:

- Empty conversation renders.
- Existing conversation history renders.
- Send button disables for empty input.
- Stop button appears during streaming.
- Streaming text updates one assistant message instead of creating many messages.
- Error state is visible and recoverable.
- Text does not overflow buttons or message containers in desktop and narrow layouts.

### 13.4 Manual QA

Required flows:

1. Start new v2 conversation and receive streamed answer.
2. Stop generation after partial response.
3. Switch conversation and reload history.
4. Clear conversation.
5. Disable AI and verify v2 returns the AI disabled message before any remote call.
6. Use a model that streams multiple chunks quickly.
7. Use a network failure or invalid server URL and verify clear error state.

## 14. Success Metrics

### 14.1 Product Metrics

- User can complete a normal streamed chat turn in v2.
- User can leave and return to a conversation with history intact.
- User can stop a stream without corrupting local history.
- Old chat remains functional while v2 is enabled.

### 14.2 Engineering Metrics

- Transcript builder has focused unit coverage.
- V2 IPC tests cover AI enable gating and stream lifecycle.
- No direct database access is added to IPC handlers.
- No worker process database access is introduced.
- V2 can be disabled without reverting code.

## 15. Risks And Mitigations

### 15.1 Risk: Tool Calling Is Underestimated

OpenAI tool calls stream as fragments. Executing tools before arguments are fully assembled will create bad calls.

Mitigation:

- Defer tool execution to Phase 2.
- Build tests for fragmented tool-call assembly before enabling tools.

### 15.2 Risk: Local History Sends Too Much Context

Stateless OpenAI-compatible requests resend history every turn.

Mitigation:

- Phase 1 can use recent-message limits.
- Phase 3 must add token-budget-aware compaction.

### 15.3 Risk: V2 Diverges From Existing Permissions

Local skills can perform sensitive actions.

Mitigation:

- Reuse existing permission services.
- Treat tool arguments as untrusted.
- Keep tool execution in the main process.

### 15.4 Risk: UI Library Mismatch

Nuxt UI Chat is not a Vuetify component library.

Mitigation:

- Use Nuxt UI Chat only as an interaction reference.
- Implement v2 components with Vuetify and local CSS.

### 15.5 Risk: Mixed Source Of Truth

If server memory and local memory both influence answers, behavior becomes hard to debug.

Mitigation:

- V2 should send complete `messages[]`.
- V2 should not pass legacy `conversation_id` for server memory.
- Server should be treated as stateless for v2 normal chat.

## 16. Release Plan

### 16.1 Milestone 1: V2 Skeleton

- Add v2 route or launcher entry.
- Add v2 component shell.
- Add v2 IPC channel definitions.
- Add v2 translations.
- Add model listing through OpenAI-compatible API.

Exit criteria:

- V2 UI opens and shows empty state.
- Model list loads or shows a recoverable error.

### 16.2 Milestone 2: Local History And Streaming

- Add transcript builder.
- Add v2 stream IPC.
- Persist user and assistant messages.
- Render streaming assistant text.
- Add stop-stream support.

Exit criteria:

- User can complete a streamed chat turn.
- Reloading conversation restores local history.
- Old chat still works.

### 16.3 Milestone 3: Stabilization

- Add focused tests.
- Add manual QA pass.
- Fix layout and i18n gaps.
- Add feature flag or controlled replacement path.

Exit criteria:

- V2 can be used for normal chat without known blocker bugs.
- V2 can replace old chat entry point behind a flag.

### 16.4 Milestone 4: Tool Calling

- Add tool-call buffering.
- Add tool execution loop.
- Persist tool call and tool result messages.
- Render tool blocks.
- Add permission and dependency prompt compatibility.

Exit criteria:

- A model can request an allowed local tool.
- The app executes it, persists the result, and sends a follow-up OpenAI request.

## 17. Acceptance Criteria

- A new chat UI exists and can be launched without editing the old chat UI.
- V2 chat uses `POST /v1/chat/completions` for streaming chat.
- V2 chat uses local SQLite history to build OpenAI `messages[]`.
- V2 chat persists user and assistant messages locally.
- V2 chat can stop an active stream.
- V2 chat can list and reopen local conversations.
- V2 chat has complete translations for all new UI text.
- V2 chat does not add LangChain or LangGraph to the Electron client.
- V2 chat uses Nuxt UI Chat as reference only, not as a dependency.
- Existing chat remains available until v2 replacement is explicitly enabled.

## 18. Open Questions

1. Should v2 use the same `ai_chat_messages` table with `source: "chat-v2"` metadata, or create a separate v2 table?
2. Should Phase 1 include image attachments, or should attachments wait until after normal chat is stable?
3. Should old conversations be visible in v2, or should v2 start with a clean conversation namespace?
4. Should the replacement flag be user-facing, developer-only, or remote-config controlled?
5. Should v2 use the `ai` package already present in `package.json`, or stay fully custom around the existing IPC stream parser?

## 19. Recommendation

Build v2 as a parallel stack and start with normal OpenAI-compatible streaming chat plus local history. Do not start with tools, LangGraph, or full old-chat parity. The first high-value deliverable is a reliable local transcript builder and a clean v2 UI that can stream and persist normal chat turns.

Once that works, add tool calling in a second phase. That keeps the migration easy to debug: if normal chat fails, the issue is transcript or streaming. If tool calling fails later, the issue is tool assembly or continuation, not the entire new stack.
