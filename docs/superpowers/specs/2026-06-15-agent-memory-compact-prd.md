# PRD: Agent Memory And Conversation Compact

**Date:** 2026-06-15
**Status:** Draft
**Owner:** AiFetchly AI Chat
**Related area:** `ai-chat-v2`
**Technical design:** [2026-06-15-agent-memory-compact-technical-design.md](2026-06-15-agent-memory-compact-technical-design.md)

## Summary

AiFetchly needs an agent memory and compact system for long-running AI chat sessions. The feature should let the assistant preserve useful context across long conversations without sending the full chat history to the model on every turn.

The first version should focus on conversation-local session memory and automatic compaction. Durable cross-conversation memory should be added after users can inspect, edit, and delete saved memories.

This product requirement is based on Claude Code's compact model, especially:

- Layer 4: session memory compact, where a background agent maintains a rolling conversation summary.
- Layer 5: full compact, where an LLM-generated summary replaces older transcript context when the active conversation is near the model limit.

AiFetchly should adapt those ideas to its OpenAI-compatible `messages[]` API and Electron/TypeORM architecture. It should not depend on Anthropic-only prompt cache editing or API-native microcompact behavior.

## Problem

`ai-chat-v2` currently builds model context from a capped recent history window. That keeps requests small, but it loses important long-session state:

- User goals and constraints from earlier turns disappear.
- Plan-mode decisions can be separated from later implementation discussion.
- Tool results and troubleshooting history can fall out of context.
- Long sessions become inconsistent because the assistant no longer sees why prior choices were made.

The app needs a way to preserve the useful parts of old conversation history while still staying within model context limits.

## Goals

1. Keep long `ai-chat-v2` conversations coherent after the raw transcript exceeds the prompt budget.
2. Maintain a background session memory for each conversation without blocking the visible chat response.
3. Use full compact only when needed, or when the user manually requests it.
4. Preserve original chat history in the database. Compaction changes prompt assembly, not stored history.
5. Respect the existing AI enable gate before any background AI work.
6. Follow the existing three-layer database architecture: Entity, Model, Module, then service/IPC.
7. Make compact behavior observable enough for debugging and future UI controls.

## Non-Goals

1. Do not implement Anthropic cache editing.
2. Do not implement Anthropic API-native microcompact.
3. Do not delete or rewrite original user/assistant messages.
4. Do not create a worker process that writes directly to SQLite.
5. Do not automatically save durable cross-conversation memories in the first implementation.
6. Do not add team/shared memory sync in the first implementation.
7. Do not add vector search for memory retrieval in the first implementation.

## Users

### Primary User

A marketer or operator using AiFetchly's AI chat to plan and execute multi-step work, such as campaign setup, email template drafting, contact extraction analysis, or scheduled AI task design.

### Secondary User

A developer or power user using plan mode and tools across a long conversation. This user needs the assistant to remember decisions, pending tasks, errors, file references, and current implementation state.

## User Stories

1. As a user, I can continue a long AI chat without the assistant forgetting the original goal.
2. As a user, I can keep working after many tool calls without hitting context-length failures.
3. As a user, I can manually compact a conversation when it feels too large or slow.
4. As a user, I can clear a conversation and know its compact summaries are cleared too.
5. As a developer, I can inspect compact state and see which messages are covered by a summary.
6. As a developer, I can test compact behavior without relying on the real remote AI service.

## Product Scope

### Phase 1: Session Memory Compact

Add a background compact agent that maintains one rolling session memory per `ai-chat-v2` conversation.

The agent runs after a completed assistant turn. It reads messages since the last summarized boundary, merges them into an existing session memory, and stores the updated result.

The session memory is conversation-local. It is not durable user memory. It should be used to help assemble future prompt context for the same conversation.

### Phase 2: Context Assembler

Replace the fixed recent-message cap with a context assembler. The assembler decides what to send to the model:

1. System prompt.
2. Plan-mode prompt additions, when active.
3. Compact summary or session memory, when available.
4. Recent verbatim messages.
5. Current user message.

The assembler should preserve recent turns exactly and use summaries only for older conversation history.

### Phase 3: Full Compact

Add full compact for threshold pressure and manual compact.

Full compact creates a structured LLM summary for older messages, stores the compact boundary, and uses that summary in future prompt assembly. It should be attempted only when session memory compact is missing, insufficient, stale, or explicitly bypassed.

### Phase 4: UI And Controls

Expose basic controls:

- Manual compact action for a conversation.
- Compact status indicator.
- Optional developer/debug view showing compact summary metadata.

Any user-facing UI text must update all language files in `src/views/lang/`.

### Future Phase: Durable Agent Memory

After compact is stable, add durable memory:

- User preferences.
- Project facts.
- Feedback.
- External references.

Durable memory must include inspect/edit/delete UI before automatic extraction is enabled.

## Functional Requirements

### Session Memory Compact

1. The system shall maintain at most one active session memory record per conversation.
2. The system shall update session memory after successful assistant completion.
3. The update shall run in the background and shall not delay the streamed completion event.
4. The update shall be skipped when AI is disabled.
5. The update shall record the last message covered by the memory.
6. The update shall use a per-conversation lock to avoid concurrent writes.
7. The update shall tolerate failures without failing the user's chat turn.
8. The update shall stop auto-retrying after repeated failures.

### Full Compact

1. The system shall estimate prompt size before model calls.
2. The system shall trigger full compact when estimated context exceeds a configurable threshold.
3. The system shall preserve a recent verbatim message window after compact.
4. The system shall not split tool-call and tool-result pairs across the compact boundary.
5. The system shall store compact summaries with the covered message boundary.
6. The system shall preserve original chat messages.
7. The system shall expose a manual compact path.
8. The system shall fall back to recent-message trimming if compact fails and the request can still fit.

### Context Assembly

1. The system shall assemble context through a dedicated service, not directly in IPC.
2. The system shall keep system and plan-mode instructions first.
3. The system shall include compact/session memory before recent verbatim messages.
4. The system shall include the current user message exactly once.
5. The system shall keep recent messages in chronological order.
6. The system shall exclude non-chat-v2 rows unless explicitly supported.

### Data Management

1. Clearing one conversation shall clear its session memory and compact summaries.
2. Clearing all v2 history shall clear all v2 session memory and compact summaries.
3. Compact summaries shall include creation/update timestamps.
4. Compact summaries shall include a model name when generated by an AI call.
5. Compact summaries shall include token estimates when available.

### Security And Privacy

1. Background compact shall use `Token` and `USER_AI_ENABLED` before any AI call.
2. Background compact shall not run in a child process that writes directly to the database.
3. Summaries shall not intentionally store secrets, tokens, cookies, or credentials.
4. Future durable memory extraction shall require stronger filters and user controls before automatic save.
5. The compact prompt shall instruct the model to summarize operational facts, not preserve sensitive raw data.

## Session Memory Content

The session memory should use a stable markdown structure:

```markdown
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

The content should be concise. It should preserve state that matters for continuing work, not rewrite the entire conversation.

## Full Compact Summary Content

Full compact should produce a structured summary:

```markdown
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

This summary should be more complete than session memory because it replaces a larger part of the prompt context.

## UX Requirements

### Conversation View

Minimum UI requirements:

- Manual compact action.
- Compact-in-progress state.
- Compact failure state with a retry action.
- Timestamp or short status indicating that compact context exists.

### Settings Or Debug View

Minimum internal/debug requirements:

- Show whether session memory exists for a conversation.
- Show compact boundary metadata.
- Show last compact error if present.

Full durable memory management UI is out of scope for the first compact release.

## Success Metrics

1. Long conversations can continue beyond the current 30-message window without losing the original goal.
2. Automatic compact does not block visible assistant completion.
3. Context-length failures decrease for long `ai-chat-v2` conversations.
4. Existing short chats behave the same as before.
5. Plan mode still preserves approved plan state and pending question state.
6. Compact failures are contained and observable.

## Acceptance Criteria

1. A completed assistant turn schedules a session memory update when AI is enabled.
2. A session memory record is created or updated for the conversation.
3. Future prompt assembly can include session memory plus recent messages.
4. Full compact can be triggered manually for a conversation.
5. Full compact stores a summary and covered boundary.
6. Full compact does not delete original messages.
7. Clearing a conversation deletes associated compact records.
8. Tests cover successful session memory update, compact failure, clear behavior, and context assembly ordering.

## Rollout Plan

### Milestone 1

Implement database entities, models, and modules for session memory and compact summaries.

### Milestone 2

Implement background session memory compact after completed turns.

### Milestone 3

Implement `AIChatContextAssembler` and route normal `submitMessage` through it.

### Milestone 4

Implement full compact threshold logic and manual compact IPC.

### Milestone 5

Add UI controls and i18n coverage.

### Milestone 6

Evaluate durable memory extraction separately.

## Risks

### Summary Drift

The compact summary can misrepresent old messages. Mitigation: preserve recent messages verbatim, keep original history, and store boundaries for inspection.

### Privacy Leakage

Summaries can preserve sensitive details. Mitigation: prompt-level redaction rules, no durable memory auto-save in phase 1, and future secret scanning for durable memory.

### Hidden Background Cost

Session memory updates add extra AI calls. Mitigation: debounce updates, skip small deltas, use circuit breakers, and add settings/metrics.

### Race Conditions

Two updates can write conflicting summaries. Mitigation: per-conversation lock and covered-boundary checks before save.

### Tool Pair Corruption

Compaction can split tool calls from results. Mitigation: boundary adjustment before compact.

## Open Questions

1. What exact threshold should trigger automatic full compact for the first release?
2. Should manual compact be a visible chat action or a slash command first?
3. Should session memory update use the user's selected model or a fixed cheaper model?
4. How much compact status should be visible to normal users versus debug-only?
5. Should compact summaries be searchable in conversation search?
