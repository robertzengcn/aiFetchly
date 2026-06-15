# Technical Design: Agent Memory And Conversation Compact

**Date:** 2026-06-15
**Status:** Draft
**PRD:** [2026-06-15-agent-memory-compact-prd.md](2026-06-15-agent-memory-compact-prd.md)
**Related files:**

- `src/service/AIChatQueryEngine.ts`
- `src/service/AIChatQueryLoop.ts`
- `src/service/OpenAIChatTranscriptBuilder.ts`
- `src/modules/AIChatV2Module.ts`
- `src/main-process/communication/ai-chat-v2-ipc.ts`

## Design Intent

Add a provider-neutral compact system for `ai-chat-v2`.

Claude Code's Layer 4 and Layer 5 compact model is the design reference:

- Layer 4 maintains a session memory file in the background and uses it as a cheaper compact summary.
- Layer 5 performs full LLM summarization when context pressure is high.

AiFetchly should implement the same product behavior with its existing OpenAI-compatible API, TypeORM storage, and Electron main-process service boundaries.

## Current State

`AIChatQueryEngine.submitMessage()` currently:

1. Resolves plan state.
2. Creates or reuses a v2 conversation id.
3. Saves the user message.
4. Loads conversation history.
5. Calls `buildOpenAITranscript()` with `maxMessages = 30`.
6. Runs `AIChatQueryLoop`.
7. Saves assistant output.

This is simple and reliable, but it loses old state. The compact system replaces the fixed 30-message cap with policy-based context assembly.

## Architecture

```text
Renderer
  |
  v
ai-chat-v2-ipc.ts
  |  AI gate, validation, IPC event mapping only
  v
AIChatQueryEngine
  |  conversation lifecycle, persistence, pending state
  v
AIChatContextAssembler
  |  prompt budget, summary selection, recent message window
  +-----------------------+
  |                       |
  v                       v
AIChatCompactAgentService AIChatV2Module
  |                       |
  v                       v
AIChatCompactModule       ai_chat_messages
AIChatSessionMemoryModule
  |
  v
compact/session memory tables
```

The IPC layer remains thin. Database reads and writes go through Model and Module classes. Background compact work runs in the main process service layer first, because it needs Token, AI enable checks, and database access.

## New Services

### AIChatContextAssembler

Responsible for building the final `OpenAIChatMessage[]`.

Inputs:

- `conversationId`
- `currentUserMessage`
- `baseSystemPrompt`
- `request.model`
- `request.maxTokens`
- `mode`
- `planState`

Responsibilities:

- Build the effective system prompt.
- Load compact/session memory context.
- Load recent conversation messages.
- Estimate prompt tokens.
- Decide whether full compact is needed.
- Preserve tool-call and tool-result boundaries.
- Return messages ready for `AIChatQueryLoop`.

Suggested interface:

```ts
export interface AIChatContextAssembleInput {
  readonly conversationId: string;
  readonly currentUserMessage: string;
  readonly baseSystemPrompt: string;
  readonly mode: "chat" | "plan";
  readonly model?: string;
  readonly maxTokens?: number;
  readonly planState?: AIChatPlanStateView | null;
}

export interface AIChatContextAssembleResult {
  readonly messages: OpenAIChatMessage[];
  readonly tokenEstimate: number;
  readonly usedSessionMemory: boolean;
  readonly usedFullCompact: boolean;
  readonly compactTriggered: boolean;
  readonly warnings: readonly string[];
}
```

### AIChatCompactAgentService

Coordinates background compact work.

Responsibilities:

- Queue session memory updates after completed turns.
- Run one compact update per conversation at a time.
- Trigger full compact when requested by context assembler or IPC.
- Enforce AI enable checks before model calls.
- Track repeated failures and suppress auto-updates after the threshold.

This service should not be called from renderer code. IPC may expose commands, but the service owns the work.

### AIChatCompactPromptBuilder

Owns compact prompts and output templates.

Responsibilities:

- Build Layer 4 session memory update prompts.
- Build Layer 5 full compact prompts.
- Validate or normalize returned summaries.
- Keep prompt text out of IPC and query engine code.

### AIChatTokenEstimator

Small utility service for prompt budgeting.

Initial implementation can use a conservative approximation:

```ts
Math.ceil(text.length / 4)
```

The estimator should count:

- Role labels.
- Message content.
- Tool call JSON.
- Summary blocks.
- Safety buffer.

This can be replaced later with a tokenizer without changing the assembler contract.

## New Database Entities

### AIChatSessionMemoryEntity

Table: `ai_chat_session_memories`

| Field | Type | Notes |
| --- | --- | --- |
| id | integer PK | auto increment |
| conversationId | varchar(100) | indexed, unique |
| summary | text | markdown session memory |
| coveredThroughMessageId | varchar(100) nullable | last message included |
| coveredThroughTimestamp | datetime nullable | last timestamp included |
| sourceMessageCount | integer | number of source messages covered |
| tokenEstimate | integer nullable | approximate tokens in summary |
| model | varchar(100) nullable | model used for latest update |
| failureCount | integer | consecutive auto-update failures |
| lastError | text nullable | last compact error |
| status | varchar(30) | `active`, `updating`, `failed`, `disabled` |
| createdAt | datetime | inherited or explicit |
| updatedAt | datetime | inherited or explicit |

Indexes:

- unique `conversationId`
- `status`
- `updatedAt`

### AIChatCompactSummaryEntity

Table: `ai_chat_compact_summaries`

| Field | Type | Notes |
| --- | --- | --- |
| id | integer PK | auto increment |
| compactId | varchar(100) | stable id |
| conversationId | varchar(100) | indexed |
| summary | text | markdown full compact summary |
| fromMessageId | varchar(100) nullable | first covered message |
| throughMessageId | varchar(100) | last covered message |
| throughTimestamp | datetime | boundary timestamp |
| sourceMessageCount | integer | number of messages summarized |
| inputTokenEstimate | integer nullable | compact input estimate |
| outputTokenEstimate | integer nullable | compact output estimate |
| model | varchar(100) nullable | model used |
| status | varchar(30) | `active`, `superseded`, `failed` |
| createdAt | datetime | inherited or explicit |
| updatedAt | datetime | inherited or explicit |

Indexes:

- `conversationId`
- `conversationId`, `status`
- `throughTimestamp`

Only one active full compact summary should be used per conversation. Older summaries may be marked `superseded`.

## Model And Module Layer

New files:

- `src/entity/AIChatSessionMemory.entity.ts`
- `src/entity/AIChatCompactSummary.entity.ts`
- `src/model/AIChatSessionMemory.model.ts`
- `src/model/AIChatCompactSummary.model.ts`
- `src/modules/AIChatSessionMemoryModule.ts`
- `src/modules/AIChatCompactModule.ts`

Module responsibilities:

### AIChatSessionMemoryModule

- `getByConversation(conversationId)`
- `upsertMemory(input)`
- `markUpdating(conversationId)`
- `recordFailure(conversationId, error)`
- `resetFailures(conversationId)`
- `deleteByConversation(conversationId)`
- `deleteAllV2()`

### AIChatCompactModule

- `getActiveSummary(conversationId)`
- `saveFullCompact(input)`
- `markSuperseded(conversationId, compactId?)`
- `deleteByConversation(conversationId)`
- `deleteAllV2()`

`AIChatV2Module.clearConversation()` should call these modules so compact records follow conversation deletion.

## Layer 4: Session Memory Compact

### Trigger

After `AIChatQueryEngine.handleLoopResult()` saves a completed assistant message:

```ts
void compactAgent.enqueueSessionMemoryUpdate({
  conversationId,
  reason: "assistant_turn_completed",
});
```

Do not await this call before emitting completion.

### Update Flow

```text
assistant turn completed
  |
  v
enqueueSessionMemoryUpdate(conversationId)
  |
  v
skip if AI disabled
  |
  v
acquire conversation lock
  |
  v
load existing session memory
  |
  v
load messages after coveredThroughMessageId
  |
  v
skip if delta is too small
  |
  v
call non-streaming compact model
  |
  v
upsert session memory and boundary
  |
  v
release lock
```

### Skip Conditions

Skip session memory update when:

- AI is disabled.
- Conversation id is missing or not v2.
- Another update is running for the same conversation.
- No new messages exist after the current boundary.
- New message delta is below a small threshold.
- Failure count exceeds the circuit breaker threshold.

### Prompt Shape

System prompt:

```text
You maintain compact session memory for an AI chat conversation.
Update the existing memory using only the new conversation messages.
Preserve durable state needed to continue the session.
Do not store secrets, tokens, cookies, credentials, or unnecessary raw data.
Return markdown using the required section headings.
```

User content:

```text
Existing session memory:
<memory or empty>

New messages:
<chronological messages since boundary>

Return updated session memory with these headings:
# Session Memory
## Current Goal
## User Preferences In This Session
## Decisions Made
## Files And Tools Used
## Errors And Fixes
## Pending Tasks
## Last Known State
## Next Useful Step
```

The service should normalize missing headings by inserting empty sections or mark the update failed if output is unusable.

## Layer 5: Full Compact

### Trigger

Full compact can be triggered by:

- Prompt estimate above threshold during context assembly.
- Manual IPC command.
- Future slash command.

Suggested thresholds:

```ts
const DEFAULT_CONTEXT_WINDOW_TOKENS = 128000;
const DEFAULT_OUTPUT_RESERVE_TOKENS = 12000;
const DEFAULT_COMPACT_BUFFER_TOKENS = 10000;
const FULL_COMPACT_THRESHOLD =
  DEFAULT_CONTEXT_WINDOW_TOKENS -
  DEFAULT_OUTPUT_RESERVE_TOKENS -
  DEFAULT_COMPACT_BUFFER_TOKENS;
```

These should be configurable later by model metadata.

### Boundary Selection

Choose the oldest messages to summarize while preserving a recent window.

Rules:

1. Keep at least the last 10 text messages.
2. Keep at least an estimated 8,000 tokens of recent context when possible.
3. Do not split tool-call and tool-result pairs.
4. Do not compact pending permission or pending plan-question turns.
5. Do not compact the current unsaved user message.

### Full Compact Flow

```text
context assembler detects pressure
  |
  v
load active compact summary
  |
  v
if existing summary plus recent messages fits, use it
  |
  v
otherwise select compact boundary
  |
  v
call compact agent
  |
  v
save full compact summary
  |
  v
assemble prompt with new summary plus recent messages
```

### Full Compact Prompt

System prompt:

```text
You create compact continuation summaries for an AI chat application.
Summarize the provided conversation so another assistant can continue accurately.
Keep facts, decisions, constraints, pending tasks, tool outcomes, and current state.
Do not include secrets, tokens, cookies, credentials, or unnecessary raw data.
Use the required markdown headings exactly.
```

User content:

```text
Conversation messages to compact:
<chronological messages>

Return a compact summary with:
# Compact Summary
## Primary Request
## Current State
## Important Decisions
## Technical Concepts
## Files, Modules, And Tools
## Errors And Fixes
## Pending Tasks
## User Constraints
## Next Step
```

## Context Assembly Policy

Final message order:

```text
system: base system prompt plus plan-mode prompt when active
system: compact/session context block when available
history: recent verbatim messages
user: current user message
```

Compact context block:

```text
Conversation compact context:
The following summary is a point-in-time memory of earlier conversation messages.
Use it as context, but prefer recent messages when there is a conflict.

<summary>
```

If both full compact and session memory exist:

1. Prefer active full compact summary for history before its boundary.
2. Include session memory only if it covers newer state not represented by full compact, or if full compact is absent.
3. Avoid duplicating the same facts in the prompt.

## Integration Points

### AIChatQueryEngine

Replace direct `buildOpenAITranscript()` usage with `AIChatContextAssembler`.

Before:

```ts
const transcript = buildOpenAITranscript({
  history,
  currentUserMessage: request.message,
  systemPrompt,
  filterSource: "chat-v2",
  maxMessages: CHAT_V2_PHASE1_MAX_HISTORY_MESSAGES,
});
messages = [...transcript.messages];
```

After:

```ts
const assembled = await contextAssembler.assemble({
  conversationId,
  currentUserMessage: request.message,
  baseSystemPrompt,
  mode: isPlanMode ? "plan" : "chat",
  model: request.model,
  maxTokens: request.maxTokens,
  planState,
});
messages = [...assembled.messages];
```

After successful completion:

```ts
void compactAgent.enqueueSessionMemoryUpdate({
  conversationId,
  reason: "assistant_turn_completed",
});
```

### AIChatV2Module

Add clear hooks:

- `clearConversation(conversationId)` deletes compact/session records.
- `clearAllV2History()` deletes all v2 compact/session records.

### ai-chat-v2-ipc.ts

Add manual compact channel in a later UI phase:

- `AI_CHAT_V2_COMPACT_CONVERSATION`
- request: `{ conversationId: string }`
- response: `CommonMessage<AIChatCompactSummaryView>`

The handler must check AI enable before parsing request details or running compact.

## Background Agent Execution Model

Initial implementation should be an in-process service queue.

Reasons:

- It needs database access through Modules.
- It needs Token access for `USER_AI_ENABLED`.
- It avoids violating the worker-process rule.
- It is easier to test with fake AI dependencies.

Do not create `src/childprocess` compact workers in the first version. If needed later, only move pure summarization work into a worker, and send results back to main process for database persistence.

## Failure Handling

### Session Memory Update Failure

- Log the error.
- Increment failure count.
- Store a user-safe error string in `lastError`.
- Do not fail the active chat turn.
- Stop auto-update after 3 consecutive failures.

### Full Compact Failure

- Return a failed response for manual compact.
- During auto-compact, fall back to the safest fitting context:
  - existing active compact summary if present,
  - otherwise recent-message window,
  - otherwise fail before calling the model with an oversized prompt.

### Prompt Too Large

If the remote AI API reports context length failure:

1. Try full compact once if not already attempted.
2. Retry the chat request with compacted context.
3. If retry fails, return a user-safe error.

## Security And Privacy

1. All AI compact operations must check `USER_AI_ENABLED`.
2. Compact prompts must forbid secrets, tokens, cookies, and credentials.
3. Compact summaries are local database records and should be deleted with chat history.
4. Do not introduce durable cross-conversation memory until inspect/edit/delete UI exists.
5. If durable memory sync is added later, add secret scanning and path validation before upload.

## Testing Plan

### Unit Tests

Add tests under `test/vitest/main/service/`.

Required tests:

- `AIChatContextAssembler` includes system prompt first.
- `AIChatContextAssembler` includes current user message exactly once.
- `AIChatContextAssembler` uses active compact summary when available.
- `AIChatContextAssembler` preserves recent message order.
- `AIChatCompactAgentService` skips when AI disabled.
- `AIChatCompactAgentService` updates session memory after new messages.
- `AIChatCompactAgentService` increments failure count on model error.
- `AIChatCompactAgentService` does not run two updates for the same conversation.
- Boundary selector does not split tool-call and tool-result pairs.

### Module Tests

Add tests for:

- `AIChatSessionMemoryModule.upsertMemory`
- `AIChatSessionMemoryModule.deleteByConversation`
- `AIChatCompactModule.saveFullCompact`
- `AIChatCompactModule.getActiveSummary`
- `AIChatV2Module.clearConversation` clears compact records

### IPC Tests

When manual compact IPC is added:

- returns denied response when AI disabled.
- validates `conversationId`.
- returns compact summary view on success.
- returns user-safe error on failure.

## Migration Plan

1. Add entities to `SqliteDb.ts`.
2. Add models and modules.
3. Add prompt builder and token estimator.
4. Add compact agent service with fakeable AI dependency.
5. Add context assembler behind existing engine path.
6. Replace fixed `CHAT_V2_PHASE1_MAX_HISTORY_MESSAGES` use.
7. Add session memory enqueue after completed assistant messages.
8. Add full compact threshold path.
9. Add manual compact IPC and UI controls.

Each step should be committed as a logical unit and tested before moving to the next step.

## Observability

Log compact events with stable prefixes:

- `[ai-chat-compact] session update queued`
- `[ai-chat-compact] session update skipped`
- `[ai-chat-compact] session update completed`
- `[ai-chat-compact] full compact started`
- `[ai-chat-compact] full compact completed`
- `[ai-chat-compact] compact failed`

Metadata to record:

- conversation id
- source message count
- boundary message id
- token estimate
- elapsed time
- failure count

Do not log raw message content.

## Future Durable Memory

After compact is stable, add durable memory as a separate feature:

```text
AIChatMemoryService
  |
  +-- user preferences
  +-- feedback
  +-- project facts
  +-- external references
```

Durable memory should have:

- explicit memory taxonomy,
- inspect/edit/archive UI,
- manual save first,
- automatic extraction later,
- optional sqlite-vec retrieval after enough data exists.

Durable memory should not be required for session compact.
