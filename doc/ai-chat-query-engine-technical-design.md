# AI Chat Query Engine - Technical Design

## 1. Purpose

This document translates `doc/ai-chat-query-engine-prd.md` into an implementation-facing technical design.

The goal is to extract the current AI chat v2 orchestration from `src/main-process/communication/ai-chat-v2-ipc.ts` into a small query-engine layer while preserving current behavior.

The design intentionally does not add a new RAG database or a new agent framework. Existing retrieval remains tool-based through `knowledge_library_search`. The new query engine owns the conversation lifecycle and delegates the repeated model/tool cycle to a query loop.

## 2. Current System Summary

### 2.1 Current Chat V2 Flow

The current flow is:

```text
Renderer chat UI
  -> src/views/api/aiChatV2.ts
  -> preload-safe IPC
  -> src/main-process/communication/ai-chat-v2-ipc.ts
  -> AIChatV2Module / AIChatPlanModule
  -> OpenAIChatTranscriptBuilder
  -> AiChatApi.openAIChatCompletionStream()
  -> OpenAIStreamAccumulator
  -> SkillRegistry / SkillExecutor / PlanModeToolRegistry
  -> stream chunks back to renderer
```

`ai-chat-v2-ipc.ts` currently contains three broad categories of behavior:

1. IPC and request boundary behavior:
   - AI enable gate.
   - JSON parsing.
   - request validation.
   - IPC channel registration.
   - renderer chunk emission.

2. Conversation lifecycle behavior:
   - conversation ID creation.
   - user message persistence.
   - plan-state resolution.
   - prompt construction.
   - transcript assembly.
   - assistant message persistence.
   - cancellation/error persistence.

3. Inner query-loop behavior:
   - model streaming.
   - stream accumulation.
   - tool-call parsing.
   - tool execution.
   - plan tool interception.
   - permission pause/resume.
   - plan question pause/resume.
   - max tool-round enforcement.

This technical design keeps category 1 in IPC and moves categories 2 and 3 into services.

### 2.2 Existing Services To Reuse

The query-engine implementation should reuse these existing services:

| File | Responsibility |
| --- | --- |
| `src/modules/AIChatV2Module.ts` | v2 conversation ID creation, user/assistant message persistence, v2-scoped history/conversation listing |
| `src/modules/AIChatPlanModule.ts` | durable plan state, questions, answers, approvals, plan versions |
| `src/service/OpenAIChatTranscriptBuilder.ts` | convert local message rows into OpenAI `messages[]` |
| `src/service/OpenAIStreamAccumulator.ts` | reduce OpenAI-compatible stream chunks into text and buffered tool calls |
| `src/service/PlanModePromptBuilder.ts` | build plan-mode system prompt |
| `src/service/PlanModeToolPolicy.ts` | block high-impact tools before plan approval |
| `src/service/PlanModeToolRegistry.ts` | expose local plan tools as OpenAI tools |
| `src/config/skillsRegistry.ts` | enumerate built-in/imported/MCP skills as tool functions |
| `src/service/SkillExecutor.ts` | validate, permission-check, execute, and audit AI tools |
| `src/api/aiChatApi.ts` | OpenAI-compatible model listing and chat completion streaming |

### 2.3 Existing Retrieval Tool

`knowledge_library_search` is already registered in `SkillRegistry`. It calls `RagSearchModule.searchKnowledgeForTool()` and returns structured, citation-friendly results.

The query engine must pass this tool through the normal tool list. It must not replace it with automatic hidden prompt injection in phase 1.

## 3. Target Architecture

### 3.1 Layer Boundaries

Target flow:

```text
Renderer
  -> src/views/api/aiChatV2.ts
  -> preload IPC
  -> ai-chat-v2-ipc.ts
  -> AIChatQueryEngine
  -> AIChatQueryLoop
  -> AiChatApi.openAIChatCompletionStream()
  -> SkillExecutor / PlanModeTool handlers
  -> AIChatQueryEngine final persistence
  -> ai-chat-v2-ipc.ts forwards events
  -> renderer
```

New files:

| File | Responsibility |
| --- | --- |
| `src/service/AIChatQueryEngine.ts` | conversation lifecycle owner for chat v2 turns |
| `src/service/AIChatQueryLoop.ts` | inner model/tool loop for one user turn |
| `src/service/AIChatQueryEvents.ts` | shared event/result types for engine-to-IPC communication |
| `test/vitest/main/service/AIChatQueryLoop.test.ts` | isolated query-loop tests |
| `test/vitest/main/service/AIChatQueryEngine.test.ts` | lifecycle/setup/persistence tests with fakes |

Optional later file:

| File | Responsibility |
| --- | --- |
| `src/service/AIChatPendingTurnStore.ts` | process-memory pending permission/question state, if state grows enough to extract |

### 3.2 Ownership Rules

`ai-chat-v2-ipc.ts` owns:

- AI enable check before parsing AI requests.
- JSON parse errors.
- request validation.
- IPC handler registration.
- converting engine events to existing `ChatV2StreamChunk` renderer events.
- calling engine stop/resume methods.

`AIChatQueryEngine` owns:

- creating/reusing conversation IDs.
- setting active conversation state.
- resolving plan mode.
- saving user messages.
- loading history.
- building system prompt.
- building transcript.
- resolving model tools.
- constructing abort controllers.
- invoking the query loop.
- saving assistant messages.
- storing pending turn state.
- producing user-safe lifecycle results.

`AIChatQueryLoop` owns:

- model stream calls.
- accumulator lifecycle.
- tool-call parsing.
- tool execution.
- plan tool handling.
- plan policy enforcement.
- in-memory transcript mutation during the turn.
- max tool-round handling.
- returning a terminal result or paused result.

Modules and models continue to own database access. No database repositories should be imported by IPC, engine, or loop unless the access is already hidden behind a Module.

## 4. Public Service Interfaces

### 4.1 Engine Input

```typescript
export interface AIChatQuerySubmitRequest {
  eventSink: AIChatQueryEventSink;
  request: ChatV2StreamRequest;
}

export interface AIChatQueryEventSink {
  emit(event: AIChatQueryEvent): void;
}
```

`eventSink` lets IPC remain responsible for renderer channels while keeping the engine independent from Electron's `IpcMainEvent`.

### 4.2 Engine Events

```typescript
export type AIChatQueryEvent =
  | AIChatQueryStartEvent
  | AIChatQueryTokenEvent
  | AIChatQueryRetryEvent
  | AIChatQueryToolCallEvent
  | AIChatQueryToolResultEvent
  | AIChatQueryPlanBlockedToolEvent
  | AIChatQueryAskUserQuestionEvent
  | AIChatQueryPlanSubmittedEvent
  | AIChatQueryCompleteEvent
  | AIChatQueryCancelledEvent
  | AIChatQueryErrorEvent;
```

These events should mirror the existing renderer stream chunks closely so the first refactor does not require UI changes.

### 4.3 Engine Methods

```typescript
export class AIChatQueryEngine {
  async submitMessage(input: AIChatQuerySubmitRequest): Promise<void>;

  stopActiveTurn(): void;

  async resumeToolAfterPermission(
    request: ResumeToolAfterPermissionRequest
  ): Promise<ResumeTurnResult>;

  async answerPlanQuestion(
    request: AnswerPlanQuestionRequest
  ): Promise<ResumeTurnResult>;
}
```

`submitMessage()` replaces most of the current `handleStream()` body after IPC validation.

`stopActiveTurn()` replaces the current `handleStop()` turn-state logic.

`resumeToolAfterPermission()` replaces the current `handleResumeToolAfterPermission()` core logic after IPC validation.

`answerPlanQuestion()` replaces the stream-resume portion of `handleAnswerQuestion()` after the plan module persists the answer, or it can own both answer persistence and resume. The recommended first extraction is for the engine to own both so pause/resume state remains colocated.

### 4.4 Query Loop Input

```typescript
export interface AIChatQueryLoopInput {
  conversationId: string;
  assistantMessageId: string;
  messages: OpenAIChatMessage[];
  request: ChatV2StreamRequest;
  openAITools: OpenAITool[];
  abortController: AbortController;
  eventSink: AIChatQueryEventSink;
  planContext?: AIChatPlanLoopContext;
  startRound: number;
}
```

### 4.5 Query Loop Result

```typescript
export type AIChatQueryLoopResult =
  | {
      type: "completed";
      fullContent: string;
      finishReason: string;
      model?: string;
      responseId?: string;
    }
  | {
      type: "cancelled";
      partialContent: string;
      model?: string;
      responseId?: string;
    }
  | {
      type: "paused_for_permission";
      pending: PendingPermissionTurn;
    }
  | {
      type: "paused_for_plan_question";
      pending: PendingPlanQuestionTurn;
    }
  | {
      type: "failed";
      error: unknown;
      partialContent: string;
      model?: string;
      responseId?: string;
    };
```

The loop should not save assistant messages. It returns enough information for the engine to persist consistently.

## 5. State Model

### 5.1 Active Turn State

The engine should preserve the current one-active-stream behavior:

```typescript
type ActiveTurnState = {
  conversationId: string;
  abortController: AbortController;
};
```

When a new stream starts, the engine should abort the existing active turn before replacing it, matching current behavior.

### 5.2 Pending Permission State

```typescript
type PendingPermissionTurn = {
  conversationId: string;
  assistantMessageId: string;
  conversationMessages: OpenAIChatMessage[];
  abortController: AbortController;
  request: ChatV2StreamRequest;
  nextRound: number;
  toolCallId: string;
  toolName: string;
  toolArguments: Record<string, unknown>;
  planContext?: AIChatPlanLoopContext;
};
```

This state can remain process-memory only in phase 1, matching current behavior.

### 5.3 Pending Plan Question State

```typescript
type PendingPlanQuestionTurn = {
  conversationId: string;
  assistantMessageId: string;
  conversationMessages: OpenAIChatMessage[];
  abortController: AbortController;
  request: ChatV2StreamRequest;
  nextRound: number;
  toolCallId: string;
  questionId: string;
  planId: string;
};
```

The plan question itself remains durable through `AIChatPlanModule`.

## 6. Detailed Turn Flow

### 6.1 Submit Message

```text
IPC handleStream()
  -> check isAIEnabled()
  -> parse JSON
  -> validateStreamRequest()
  -> queryEngine.submitMessage({ request, eventSink })
```

Inside `submitMessage()`:

```text
create AIChatV2Module
create AIChatPlanModule
resolve preliminary plan state
determine isPlanMode
conversationId = createConversationIfNeeded()
abort prior active turn
save user message
load conversation history
build base or plan-mode system prompt
build OpenAI transcript
resolve SkillRegistry tools
append PlanModeToolRegistry tools when needed
emit start event
call AIChatQueryLoop.run()
persist based on loop result
emit complete/cancelled/error unless loop already emitted terminal event
clear active turn unless paused
```

### 6.2 Normal Completion

```text
AIChatQueryLoop.run()
  -> stream model response
  -> no tool calls
  -> return completed

AIChatQueryEngine
  -> save assistant message when content length > 0
  -> emit complete
  -> clear active state
```

### 6.3 Tool Completion

```text
AIChatQueryLoop.run()
  -> stream model response with finish_reason=tool_calls
  -> parse tool calls
  -> append assistant tool-call message to in-memory transcript
  -> for each tool call:
       emit tool_call
       execute or handle locally
       emit tool_result
       append role=tool message
  -> next model round
  -> return completed when model stops
```

Tool result serialization should continue to use the existing behavior:

```text
{ success, executionTimeMs, ...result.result }
```

### 6.4 Permission Pause

```text
tool result indicates needsPermissionPrompt
  -> emit tool_result containing permission prompt payload
  -> return paused_for_permission with PendingPermissionTurn

AIChatQueryEngine
  -> store pendingPermissionTurn
  -> keep active state tied to pending turn
  -> do not save final assistant content
  -> do not emit complete
```

Resume:

```text
IPC resume handler
  -> check AI enable
  -> validate toolId/conversationId
  -> queryEngine.resumeToolAfterPermission()
  -> SkillExecutor.execute(..., skipPermissionCheck: true)
  -> emit replacement tool_result
  -> append role=tool message
  -> AIChatQueryLoop.run(startRound=nextRound)
```

### 6.5 Plan Question Pause

```text
model calls AskUserQuestion
  -> AIChatQueryLoop validates payload
  -> AIChatPlanModule.saveQuestion()
  -> emit ask_user_question event
  -> append synthetic awaiting_answer tool result
  -> return paused_for_plan_question
```

Resume:

```text
IPC answer handler
  -> check AI enable
  -> queryEngine.answerPlanQuestion()
  -> AIChatPlanModule.answerQuestion()
  -> replace synthetic tool result with answered tool result
  -> load current plan state
  -> AIChatQueryLoop.run(startRound=nextRound)
```

### 6.6 Stop

```text
IPC stop event
  -> queryEngine.stopActiveTurn()
  -> abort active AbortController
  -> clear pending state when the pending turn is cancelled
```

If the abort happens while streaming, the loop should return `cancelled` with partial content from the active accumulator. The engine persists that partial content with metadata:

```json
{
  "source": "chat-v2",
  "finishReason": "cancelled",
  "cancelled": true
}
```

## 7. File-Level Change Map

### 7.1 New Files

| File | Contents |
| --- | --- |
| `src/service/AIChatQueryEvents.ts` | event interfaces, terminal result types, pending turn types |
| `src/service/AIChatQueryLoop.ts` | extracted loop from current `continueStreamAfterTools()` |
| `src/service/AIChatQueryEngine.ts` | extracted setup/persistence/pending-state orchestration |
| `test/vitest/main/service/AIChatQueryLoop.test.ts` | loop unit tests with fake model and fake tool executor |
| `test/vitest/main/service/AIChatQueryEngine.test.ts` | engine tests with fake modules and fake loop |

### 7.2 Modified Files

| File | Change |
| --- | --- |
| `src/main-process/communication/ai-chat-v2-ipc.ts` | reduce to validation, AI gate, event forwarding, channel registration |
| `src/service/OpenAIChatTranscriptBuilder.ts` | phase 1: no behavior change; phase 2: support tool transcript groups |
| `src/entityTypes/aiChatV2Types.ts` | add event fields only if needed to preserve current renderer contract |

No renderer files should need changes in phase 1 unless event shape changes. Event shape should not change in the first extraction.

## 8. Dependency Injection

The query loop should support dependency injection so tests can run without network, Electron, or real tools.

Recommended dependency shape:

```typescript
export interface AIChatQueryLoopDeps {
  streamChatCompletion(
    request: OpenAIChatCompletionRequest,
    onChunk: (chunk: OpenAIChatCompletionChunk) => void,
    options: OpenAIChatStreamOptions
  ): Promise<void>;

  executeTool(
    name: string,
    args: Record<string, unknown>,
    context: SkillExecutionContext
  ): Promise<ToolExecutionResult>;

  getSkillDefinition(name: string): SkillDefinition | undefined;

  savePlanQuestion(input: SavePlanQuestionInput): Promise<AIChatPlanQuestionView>;
  submitPlanForApproval(input: SubmitPlanInput): Promise<AIChatPlanStateView>;
}
```

Production deps wrap:

- `AiChatApi.openAIChatCompletionStream()`
- `SkillExecutor.execute()`
- `SkillRegistry.getSkill()`
- `AIChatPlanModule` methods

Tests pass fakes.

## 9. Error Handling

### 9.1 User-Safe Error Mapping

Keep a single `userSafeError(err: unknown): string` utility for chat v2. It can remain in the IPC file initially, but the cleaner target is:

```text
src/service/AIChatErrorMapper.ts
```

The mapper should preserve current behavior:

- `AbortError` -> `Generation stopped.`
- `401` or `403` -> `Please sign in again.`
- `404` -> `Selected model is not available.`
- `503` -> `No chat model is configured on the AI server.`
- network failure -> `Could not connect to the AI server.`
- fallback -> `An unexpected error occurred. Please try again.`

Raw server bodies and stack traces must remain in logs only.

### 9.2 Loop Errors

The loop should return a `failed` result rather than directly sending terminal renderer events. The engine decides whether to persist partial content and which terminal event to emit.

Malformed tool arguments should produce a controlled failure:

```text
Tool call arguments were malformed.
```

Max tool rounds should produce a controlled failure with a user-safe message:

```text
The assistant reached the maximum number of tool rounds.
```

## 10. Persistence Rules

Phase 1 persistence should preserve current behavior:

- Save user message before the remote call.
- Save final assistant text on normal completion.
- Save partial assistant text on cancellation when non-empty.
- Save partial assistant text on error when non-empty.
- Do not persist in-memory tool messages yet unless they are already represented in final assistant text.

Phase 2 will add durable tool transcript persistence. That phase must ensure assistant tool-call messages and matching tool result messages are included or excluded as a group during transcript assembly.

## 11. TypeScript Rules

- Do not use `any`.
- Use `unknown` for caught errors.
- Use explicit return types on exported functions and class methods.
- Keep OpenAI wire types in `src/api/aiChatApi.ts`.
- Keep renderer-facing stream types in `src/entityTypes/aiChatV2Types.ts`.
- Keep engine internal event types in `src/service/AIChatQueryEvents.ts`.

## 12. Migration Plan

### 12.1 Step 1: Add Types And Empty Shells

- Add `AIChatQueryEvents.ts`.
- Add `AIChatQueryLoop.ts` with deps and a placeholder run method.
- Add `AIChatQueryEngine.ts` with constructor/deps shape.
- Add tests for event mapping and dependency construction.

Commit:

```bash
git add src/service/AIChatQueryEvents.ts src/service/AIChatQueryLoop.ts src/service/AIChatQueryEngine.ts test/vitest/main/service
git commit -m "feat: add AI chat query engine service boundaries"
```

### 12.2 Step 2: Extract Query Loop

- Move `continueStreamAfterTools()` behavior into `AIChatQueryLoop.run()`.
- Move helper functions needed only by the loop into the loop file or adjacent helpers.
- Keep renderer event payloads unchanged.
- Add unit tests for normal completion, tool call, malformed arguments, and max rounds.

Commit:

```bash
git add src/service/AIChatQueryLoop.ts test/vitest/main/service/AIChatQueryLoop.test.ts src/main-process/communication/ai-chat-v2-ipc.ts
git commit -m "refactor: extract AI chat v2 query loop"
```

### 12.3 Step 3: Extract Engine

- Move conversation setup from `handleStream()` into `AIChatQueryEngine.submitMessage()`.
- Move active abort controller and current conversation state into the engine.
- Move pending permission and pending plan question state into the engine.
- Keep IPC handler validation and AI enable gate in place.
- Add engine lifecycle tests with fake modules/loop.

Commit:

```bash
git add src/service/AIChatQueryEngine.ts test/vitest/main/service/AIChatQueryEngine.test.ts src/main-process/communication/ai-chat-v2-ipc.ts
git commit -m "refactor: extract AI chat v2 query engine"
```

### 12.4 Step 4: Extract Resume Paths

- Move permission resume logic into `AIChatQueryEngine.resumeToolAfterPermission()`.
- Move plan question answer/resume logic into `AIChatQueryEngine.answerPlanQuestion()`.
- Keep plan state read-only IPC handlers in `ai-chat-v2-ipc.ts`.
- Add tests for resume success and conversation mismatch.

Commit:

```bash
git add src/service/AIChatQueryEngine.ts test/vitest/main/service/AIChatQueryEngine.test.ts src/main-process/communication/ai-chat-v2-ipc.ts
git commit -m "refactor: move AI chat resume flows into query engine"
```

### 12.5 Step 5: Final IPC Cleanup

- Remove unused helpers from `ai-chat-v2-ipc.ts`.
- Ensure `ai-chat-v2-ipc.ts` only validates, gates, forwards, and registers.
- Run targeted tests and type checks.

Commit:

```bash
git add src/main-process/communication/ai-chat-v2-ipc.ts
git commit -m "refactor: simplify AI chat v2 IPC handler"
```

## 13. Testing Strategy

### 13.1 Query Loop Tests

Test file:

```text
test/vitest/main/service/AIChatQueryLoop.test.ts
```

Minimum cases:

- Streams a normal assistant response and returns `completed`.
- Buffers streamed tool-call deltas and executes the tool after `finish_reason: "tool_calls"`.
- Appends assistant tool call and tool result messages before the second model request.
- Emits tool call and tool result events.
- Returns `failed` for malformed tool arguments.
- Returns `failed` when max tool rounds is reached.
- Returns `paused_for_permission` when tool result needs permission.
- Returns `paused_for_plan_question` for `AskUserQuestion`.
- Blocks high-impact plan-mode tools before approval.

### 13.2 Query Engine Tests

Test file:

```text
test/vitest/main/service/AIChatQueryEngine.test.ts
```

Minimum cases:

- Saves user message before loop execution.
- Builds plan-mode prompt when plan mode is active.
- Includes normal skills and plan tools only when appropriate.
- Saves assistant message on completion.
- Saves partial assistant message on cancellation.
- Saves partial assistant message on failure.
- Stores pending permission state and resumes it.
- Stores pending plan question state and resumes it.
- Aborts prior active turn when a new turn starts.

### 13.3 IPC Tests

Existing or new IPC tests should verify:

- AI enable check happens before parsing stream payload.
- Invalid JSON returns a structured error event.
- Valid requests call `AIChatQueryEngine.submitMessage()`.
- Stop calls `AIChatQueryEngine.stopActiveTurn()`.
- Resume handlers check AI enable before calling the engine.

### 13.4 Manual Verification

Manual smoke tests:

- Normal chat message.
- Stop mid-stream.
- Tool call using a pure/read-only tool.
- `knowledge_library_search` question.
- Permission-gated tool pause/resume.
- Plan mode ask question and submit plan.
- Plan mode blocks high-impact tool before approval.

## 14. Rollback Strategy

This is an internal refactor, so rollback should be simple:

- Keep existing IPC channel names.
- Keep existing stream event shapes.
- Keep existing renderer API.
- Avoid database schema changes in phase 1.

If regressions appear, revert the extraction commits and return to the original `ai-chat-v2-ipc.ts` orchestration.

## 15. Future Extensions

After phase 1 is stable, future work can add:

- durable tool transcript persistence.
- token-aware transcript selection.
- conversation summaries.
- prompt-too-long recovery.
- model fallback.
- streaming tool execution overlap for concurrency-safe tools.
- per-turn usage and cost tracking.
- multiple simultaneous active conversations.

These features should be implemented only after the engine boundary is in place and covered by tests.
