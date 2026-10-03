# PRD: AI Chat Query Engine

## 1. Overview

AiFetchly should add a lightweight AI chat query engine to improve the reliability, maintainability, and extensibility of the current AI chat v2 flow.

This query engine is not a new search database and not a replacement for the existing knowledge-library RAG system. AiFetchly already has a `knowledge_library_search` tool backed by hybrid vector and keyword retrieval, reranking, neighbor expansion, and citation-aware output. The new query engine should instead own the conversation lifecycle: request preparation, transcript assembly, tool loop execution, pause/resume state, plan-mode coordination, persistence, and stream event emission.

The main product goal is to make AI chat capable of longer, more tool-heavy, and more task-oriented workflows without continuing to grow the IPC handler into an implicit orchestrator.

## 2. Problem Statement

The current `ai-chat-v2-ipc.ts` flow already behaves like a query engine, but the boundary is implicit. It currently coordinates:

- AI enable checks.
- Request validation.
- Conversation creation.
- User message persistence.
- Plan state resolution.
- System prompt construction.
- Transcript building.
- OpenAI-compatible streaming calls.
- Tool-call parsing and execution.
- Plan tool interception.
- Permission-gated tool pause/resume.
- Plan question pause/resume.
- Assistant message persistence.
- Renderer stream events.
- Abort and error handling.

This works for the current phase, but it creates several product and engineering risks:

- AI chat behavior becomes harder to test because orchestration lives in an IPC file.
- Plan mode, tool execution, and retrieval behavior are tightly coupled to renderer communication.
- Long conversations rely on a simple fixed message cap instead of a clear context policy.
- Tool-heavy conversations can lose useful working context because durable tool transcript handling is limited.
- Future features such as summarization, context compaction, proactive knowledge retrieval, model fallback, and richer pause/resume states will make the IPC handler harder to reason about.

Claude Code's QueryEngine shows a useful architectural pattern: separate the conversation owner from the inner model/tool loop. AiFetchly should adopt that boundary in a smaller form suitable for this app.

## 3. Objectives

- Move AI chat orchestration out of `ai-chat-v2-ipc.ts` into a dedicated service layer.
- Keep IPC handlers thin: validate, enforce AI enable gate, call the engine, and forward stream events.
- Preserve the existing OpenAI-compatible chat v2 user experience.
- Preserve the existing local database architecture: IPC -> Module -> Model -> TypeORM.
- Preserve the existing `SkillRegistry` and `SkillExecutor` tool architecture.
- Preserve `knowledge_library_search` as the primary RAG entry point.
- Add a testable inner query loop for streaming, tool calls, tool results, and max-round handling.
- Create a clean place to add future context management without UI or IPC rewrites.

## 4. Non-Goals

- Do not copy Claude Code's full QueryEngine implementation.
- Do not add LangChain, LangGraph, or another agent framework.
- Do not replace the existing RAG ingestion, vector store, or `knowledge_library_search` pipeline.
- Do not move database access into worker processes.
- Do not let renderer code call the AI server directly.
- Do not redesign the entire chat UI in this phase.
- Do not add proactive compaction, streaming tool execution overlap, fallback models, or memory prefetch in the first phase.
- Do not change the AI enable gating rule. AI chat IPC handlers must still check AI enable first.

## 5. Target Users

### 5.1 End Users

- Users who ask the AI assistant for marketing strategy, lead generation help, scraping guidance, email campaign support, and app workflow assistance.
- Users who expect local chat history to persist across sessions.
- Users who run tool-assisted conversations involving search, scraping, contact extraction, email marketing, schedules, or knowledge-library lookup.
- Users who need plan mode to ask clarifying questions, prepare a plan, and block high-impact tools until approval.

### 5.2 Developer Users

- Developers maintaining AI chat v2.
- Developers adding new AI tools through `SkillRegistry`.
- Developers adding plan-mode behavior.
- Developers improving RAG and conversation context management.
- Developers writing tests for chat streaming and tool loops.

## 6. Product Principles

### 6.1 The Query Engine Owns Conversation Lifecycle

The query engine should be responsible for one conversation's AI lifecycle. IPC should not contain the core turn orchestration logic.

### 6.2 Retrieval Remains Tool-Based

Knowledge-library retrieval should remain an AI-callable tool. The model should be able to call `knowledge_library_search` when it needs grounded document context.

### 6.3 Keep The First Engine Small

The first version should extract and stabilize current behavior. It should create the right boundaries before adding advanced agent features.

### 6.4 Local State Is Authoritative

The local app should own conversation state, plan state, tool-pause state, and persisted message history. The AI server should be treated as an OpenAI-compatible model gateway.

### 6.5 Test The Engine Directly

Most AI chat behavior should be testable without Electron IPC. The query engine and query loop should accept injected dependencies for model calls, tool execution, and event emission.

## 7. Proposed Solution

Add a lightweight query-engine layer:

```text
Renderer
  -> preload API
  -> ai-chat-v2 IPC handler
  -> AIChatQueryEngine.submitMessage()
  -> AIChatQueryLoop.run()
  -> AiChatApi.openAIChatCompletionStream()
  -> SkillExecutor / PlanModeToolRegistry
  -> stream events back to renderer
```

### 7.1 `AIChatQueryEngine`

The engine should own turn-level setup and completion:

- Resolve or create conversation ID.
- Resolve plan mode and active plan state.
- Save the user message before remote AI work starts.
- Build the system prompt.
- Build the OpenAI transcript from local history.
- Resolve available tools for the current mode.
- Create and manage the abort controller.
- Call the inner query loop.
- Save the final assistant message.
- Return structured lifecycle events to the IPC handler.

Suggested file:

- `src/service/AIChatQueryEngine.ts`

### 7.2 `AIChatQueryLoop`

The query loop should own the repeated model -> tool -> model cycle within a single user turn:

- Stream OpenAI-compatible chunks.
- Accumulate assistant text.
- Buffer and parse streamed tool calls.
- Stop when the model produces a normal final answer.
- Execute tool calls when `finish_reason` is `tool_calls`.
- Append assistant tool-call messages and tool result messages to the in-memory request transcript.
- Enforce `CHAT_V2_MAX_TOOL_ROUNDS`.
- Intercept plan-mode tools such as `AskUserQuestion` and `SubmitPlanForApproval`.
- Enforce plan-mode tool policy.
- Pause when a tool needs user permission.
- Pause when plan mode asks the user a question.
- Resume from saved pending state.

Suggested file:

- `src/service/AIChatQueryLoop.ts`

### 7.3 IPC Handler Role

`ai-chat-v2-ipc.ts` should remain responsible for:

- AI enable check before parsing AI requests.
- IPC payload parsing.
- User-safe error response if payload parsing fails.
- Registering IPC channels.
- Forwarding engine events to renderer channels.
- Calling stop/resume methods on the engine.

It should not contain the model/tool loop.

### 7.4 Existing RAG Tool Role

The existing `knowledge_library_search` tool should remain registered in `SkillRegistry`. The query engine should pass it to the model as one of the available OpenAI tools.

The engine may later add optional context policy, but phase one should not hide RAG behind automatic prompt injection. Tool-based retrieval gives the model a chance to search after understanding the user's intent.

## 8. Functional Requirements

### 8.1 Stream Start

When a user sends a chat message:

- The IPC handler must check AI enable first.
- The engine must create or reuse a v2 conversation ID.
- The engine must save the user message before the remote AI call.
- The engine must emit a `start` stream event with `conversationId` and `messageId`.

### 8.2 Transcript Assembly

The engine must build an OpenAI-compatible `messages[]` transcript from local conversation history.

Phase one may keep the current fixed message cap, but the transcript assembly must be isolated so later phases can add:

- token-aware history selection
- summary insertion
- durable tool transcript inclusion
- context compaction
- knowledge-library prefetch

### 8.3 Tool Loop

When the model returns tool calls:

- The loop must emit `tool_call` events to the renderer.
- The loop must execute known tools through `SkillExecutor`.
- The loop must serialize tool results safely.
- The loop must emit `tool_result` events to the renderer.
- The loop must append `role: "tool"` messages to the in-memory transcript before the next model request.
- The loop must stop with a controlled error if tool arguments are malformed.
- The loop must enforce a maximum number of tool rounds.

### 8.4 Plan Mode

When plan mode is active:

- Plan tools must be intercepted locally and never dispatched through `SkillExecutor`.
- `AskUserQuestion` must persist the question, emit a structured event, and pause the stream.
- User answers must resume the same turn with the answered tool result.
- `SubmitPlanForApproval` must persist a plan version and transition state to awaiting approval.
- High-impact tools must be blocked until plan approval according to `PlanModeToolPolicy`.

### 8.5 Permission Pause And Resume

When a tool requires permission:

- The loop must emit a permission-related tool result event.
- The engine must store pending state for the paused turn.
- Resume must re-execute the approved tool with permission checks skipped only for that approved invocation.
- Resume must continue at the next model round using the same conversation transcript.

### 8.6 Stop And Cancellation

When the user stops a stream:

- The active abort controller must abort the remote request.
- Partial assistant content should be saved when available.
- A `cancelled` event must be emitted.
- Pending permission or plan question state must be cleared only when the stop action actually cancels that pending turn.

### 8.7 Persistence

The engine must use `AIChatV2Module` and related modules for persistence.

Requirements:

- Save user messages before remote calls.
- Save final assistant messages after completion.
- Save partial assistant messages on cancellation or error when content exists.
- Do not write database logic in IPC handlers.
- Do not access the database from worker processes.

### 8.8 Error Handling

The engine must produce user-safe errors for:

- invalid payload
- disabled AI
- unavailable model
- AI server connection failure
- malformed tool-call arguments
- max tool rounds reached
- unexpected stream failure

Raw server bodies, stack traces, and sensitive request details must not be sent to the renderer.

## 9. User Stories

1. As a user, I can continue using AI chat v2 without seeing behavior regressions after the query engine refactor.
2. As a user, I can ask a question that requires a local knowledge-library search and see the assistant use the existing search tool.
3. As a user, I can stop a streaming response and keep any useful partial answer.
4. As a user, I can approve a permission-gated tool and have the assistant continue the same response.
5. As a user in plan mode, I can answer clarifying questions and have the assistant continue plan creation in the same turn.
6. As a developer, I can test the query loop without creating Electron IPC events.
7. As a developer, I can add future context-management behavior without rewriting IPC handlers.

## 10. Phased Scope

### 10.1 Phase 1: Extract Current Orchestration

Goal: create the query-engine boundary while preserving existing behavior.

Required:

- Add `AIChatQueryEngine`.
- Add `AIChatQueryLoop`.
- Move stream/tool loop logic out of `ai-chat-v2-ipc.ts`.
- Move pending permission and pending plan question state into the engine or a small state manager.
- Keep existing stream chunk types.
- Keep existing `OpenAIStreamAccumulator`.
- Keep existing `OpenAIChatTranscriptBuilder`.
- Keep `knowledge_library_search` as a normal tool.
- Add unit tests for query-loop behavior with fake model/tool dependencies.

### 10.2 Phase 2: Durable Tool Transcript And Context Policy

Goal: make long, tool-heavy conversations more reliable.

Required:

- Persist assistant tool-call messages and tool result messages in a durable format.
- Update transcript building so it can include complete assistant-tool-result groups.
- Prevent transcript truncation from splitting a tool call from its matching tool result.
- Add metadata for tool name, tool call ID, permission state, and result status.

### 10.3 Phase 3: Smarter Context Management

Goal: improve long-running chat quality.

Candidate features:

- Token-budget-aware transcript selection.
- Conversation summaries.
- Summary refresh after long tool workflows.
- Optional knowledge-library prefetch for explicit document questions.
- Tool result budget trimming.
- Prompt-too-long recovery.

### 10.4 Phase 4: Advanced Agent Reliability

Goal: add selected Claude Code-style reliability features only when needed.

Candidate features:

- Model fallback.
- Retry event normalization.
- Streaming tool execution overlap for concurrency-safe tools.
- Tool batch summaries.
- More granular usage and cost tracking.
- Structured result messages for SDK-like clients.

## 11. Acceptance Criteria

### 11.1 Product Acceptance

- Existing AI chat v2 can send and receive normal streaming messages.
- Existing tool calls still work.
- Existing permission prompts still pause and resume correctly.
- Existing plan mode still asks questions, submits plans, and blocks tools before approval.
- Existing knowledge-library search remains available as an AI tool.
- Users do not see new raw technical errors in the chat UI.

### 11.2 Engineering Acceptance

- `ai-chat-v2-ipc.ts` no longer contains the core model/tool loop.
- The new query loop can be unit tested without Electron IPC.
- IPC handlers still check AI enable before parsing AI request payloads.
- No direct database access is added to IPC handlers.
- No worker process database access is introduced.
- TypeScript does not introduce `any`.
- New or changed user-facing UI text includes translations in all supported language files if UI text changes are made.

### 11.3 Test Acceptance

Minimum tests:

- Normal streaming response completes and saves assistant content.
- Tool call executes and feeds result into the next model request.
- Malformed tool arguments produce a controlled error.
- Permission-gated tool pauses and resumes.
- Plan `AskUserQuestion` pauses and resumes after answer.
- Max tool rounds produces a controlled failure.
- Stop cancels the active stream and saves partial content when present.

## 12. Metrics

Track after release:

- Chat stream failure rate.
- Tool-call failure rate.
- Permission resume success rate.
- Plan question resume success rate.
- Average tool rounds per user turn.
- Average time to first token.
- Average total response time.
- Number of prompt-too-long or max-context failures.
- User-visible chat error count.

## 13. Risks And Mitigations

### 13.1 Risk: Refactor Breaks Existing Chat Behavior

Mitigation:

- Extract behavior in small commits.
- Preserve stream event contracts.
- Use fake model/tool tests before changing UI behavior.

### 13.2 Risk: Engine Becomes Too Large

Mitigation:

- Keep `AIChatQueryEngine` responsible for lifecycle.
- Keep `AIChatQueryLoop` responsible for model/tool rounds.
- Keep plan-specific handling in focused helper services when it grows.

### 13.3 Risk: Premature Claude Code Complexity

Mitigation:

- Do not implement compaction, fallback, memory prefetch, or streaming tool overlap in phase one.
- Add advanced reliability only after metrics show the need.

### 13.4 Risk: Tool Transcript Persistence Is Underdesigned

Mitigation:

- Treat durable tool transcript as phase two.
- In phase one, keep in-memory tool transcript behavior equivalent to current chat v2.
- Design persistence so assistant tool calls and tool results cannot be separated during transcript truncation.

## 14. Open Questions

- Should pending permission and plan-question state be process-memory only, or should it survive app restart?
- Should durable tool rows reuse `AIChatMessageEntity` with metadata, or should they get a separate table?
- Should context selection use token estimation locally, or rely on server rejection/retry initially?
- Should knowledge-library prefetch be automatic for explicit document questions, or always model-initiated through the tool?
- Should the query engine support multiple simultaneous conversations, or continue the current one-active-stream model?

## 15. Recommended MVP Decision

Build phase one only:

- Extract the current orchestration into `AIChatQueryEngine` and `AIChatQueryLoop`.
- Keep retrieval as the existing `knowledge_library_search` tool.
- Keep the one-active-stream model.
- Keep current transcript cap behavior.
- Add direct unit tests around the extracted query loop.

This delivers the highest immediate value: the code becomes easier to reason about and safer to extend, without expanding product scope or introducing unnecessary agent framework complexity.
