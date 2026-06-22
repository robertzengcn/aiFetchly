# PRD: Auto-Dream User Memory

**Date:** 2026-06-22
**Status:** Draft
**Owner:** AiFetchly AI Chat
**Related area:** `ai-chat-v2`, agent runtime, skill/tool execution
**Builds on:** [2026-06-15-agent-memory-compact-prd.md](2026-06-15-agent-memory-compact-prd.md)

## Summary

AiFetchly needs a durable auto-dream memory system that carries useful context across sessions. The system should periodically consolidate completed AI Chat V2 conversations and agent task transcripts into structured SQLite memories scoped to the current local user database.

The feature is inspired by Claude Code's auto-dream and long-term memory design, but AiFetchly should not copy Claude Code's git-root file memory model. AiFetchly does not have a per-project/workspace memory concept today, and the app already uses SQLite, TypeORM, IPC handlers, modules, and services for durable state.

The first durable memory version should be:

- Per local database / user account.
- Stored in SQLite through TypeORM entities, models, and modules.
- Sourced from both AI Chat V2 conversations and agent task transcripts/tool runs.
- Injected into future AI Chat V2 context through the existing context assembler.
- Inspectable, editable, and removable by the user before broad automation is enabled by default.

## Problem

AiFetchly now has conversation-local compact memory. That helps long conversations continue, but it does not solve cross-session memory:

- A user preference learned in one conversation is not available in a later conversation.
- A project decision explained during an agent task is lost after that task ends.
- Useful operational context from tool runs, approvals, failures, and fixes is not reused.
- The assistant can repeat questions that the user has already answered in earlier sessions.
- Manual "remember this" and "forget this" behavior has no durable structured home.

AiFetchly needs a durable memory layer that is broader than one conversation, but still controlled, inspectable, and safe.

## Goals

1. Preserve useful user/account-level AI context across sessions and conversations.
2. Store memories in the current local user database using SQLite and TypeORM.
3. Consolidate signal from both AI Chat V2 conversations and agent task transcripts/tool runs.
4. Keep durable memory separate from conversation compact summaries.
5. Inject relevant durable memories into future AI Chat V2 prompt assembly.
6. Support manual remember, edit, archive, and forget operations.
7. Gate all AI-powered memory extraction and consolidation behind `USER_AI_ENABLED`.
8. Avoid storing secrets, credentials, raw scraped private data, or large transcript fragments.
9. Follow AiFetchly's Entity -> Model -> Module -> Service -> IPC layering.
10. Keep background auto-dream failures isolated from normal chat and agent execution.

## Non-Goals

1. Do not create per-project, per-workspace, or git-root memory in the first version.
2. Do not store memory as markdown files on disk.
3. Do not require sqlite-vec/vector retrieval in the first version.
4. Do not send every memory into every prompt.
5. Do not rewrite or delete original chat messages or agent task transcripts during consolidation.
6. Do not let child/worker processes access memory tables directly.
7. Do not sync memories to a remote service in the first version.
8. Do not automatically store sensitive customer/contact data from scraping results.
9. Do not make memory invisible to the user once automatic extraction is enabled.

## Users

### Primary User

A marketer, operator, or business user using AiFetchly's AI chat and automation tools across multiple sessions. This user benefits when the assistant remembers preferences, recurring campaign constraints, and prior decisions.

### Secondary User

A power user or developer using plan mode, skills, and agent tasks. This user benefits when the assistant remembers durable implementation decisions, preferred workflows, external references, and prior feedback.

## Memory Scope

Memory is scoped to the current local user database only.

AiFetchly should not attempt to infer project identity from folders, git roots, or workspaces. If the user switches local databases or accounts, that database has its own independent memory store.

## Memory Sources

### AI Chat V2 Conversations

The system should extract durable memory candidates from completed AI Chat V2 conversations, including:

- User-stated preferences.
- User profile facts relevant to using the app.
- Decisions and rationale that matter later.
- Reusable workflow details.
- External references the user expects the assistant to reuse.
- Explicit "remember this" instructions.

Conversation-local compact summaries may be used as input signal, but durable memories must remain separate records.

### Agent Task Transcripts And Tool Runs

The system should also extract durable memory candidates from agent task records:

- Agent task messages.
- Tool calls.
- Tool results.
- Permission or approval decisions when they express a reusable preference.
- Failed tool runs and fixes only when they reveal durable process knowledge.

Agent task extraction should avoid storing bulky tool outputs. It should prefer concise facts, decisions, and user preferences derived from the task.

## Memory Taxonomy

Durable memories should use a closed taxonomy.

| Type | Description | Examples |
| --- | --- | --- |
| `preference` | User preference or instruction for future AI behavior | "Prefer concise implementation notes." |
| `fact` | Durable user/account fact useful in future sessions | "User manages email marketing campaigns." |
| `decision` | Decision and rationale that should survive the session | "Use SQLite structured memory instead of file memory." |
| `reference` | Pointer to an external/local resource | "Relevant Claude Code doc path is ..." |
| `workflow` | Reusable process or operating pattern | "Run compact memory updates after completed assistant turns." |

The first implementation should not allow arbitrary memory types.

## Product Scope

### Phase 1: Manual Durable Memory

Add structured memory storage and manual controls.

Users should be able to:

- Create a memory explicitly.
- Ask the assistant to remember a fact.
- List active memories.
- Edit a memory.
- Archive or forget a memory.

The assistant should be able to write memory only through a controlled service path, not through direct database access from IPC or workers.

### Phase 2: Memory Retrieval And Prompt Injection

Extend AI Chat V2 context assembly to include selected durable memories.

Prompt order should be:

1. Base system prompt and mode-specific system prompt.
2. Durable user memory context.
3. Conversation compact/session memory context.
4. Recent verbatim messages.
5. Current user message.

The system should inject only a small relevant subset, not the full memory table.

### Phase 3: Auto-Dream Consolidation

Add a background consolidation service that periodically reviews new source material and updates durable memories.

The auto-dream service should:

- Run only in the main process service layer.
- Check AI enablement before any AI call.
- Use time and source-count gates.
- Lock so only one consolidation run happens at a time.
- Review both AI Chat V2 conversations and agent task transcripts/tool runs.
- Create new memories, update existing memories, and archive contradicted memories.
- Never block the visible chat response or task result.

### Phase 4: User Controls And Observability

Add UI and IPC surfaces for:

- Auto-dream enable/disable.
- Last consolidation status.
- Memory list/search.
- Memory edit/archive/delete.
- Source attribution for a memory.
- Manual "run consolidation now" action for debugging and power users.

Any user-facing UI text must update all language files in `src/views/lang/`.

### Future Phase: Semantic Retrieval

After the structured memory lifecycle is stable, add sqlite-vec retrieval for better relevance.

The first implementation should use deterministic selection: active status, type weighting, keyword matching, recency, and last-used timestamps.

## Functional Requirements

### Durable Memory Storage

1. The system shall store durable memories in SQLite in the current local user database.
2. The system shall expose memory database access through Model and Module classes.
3. The system shall not access memory tables directly from IPC handlers.
4. The system shall not access memory tables directly from child/worker processes.
5. The system shall support active, archived, and contradicted memory states.
6. The system shall store source attribution when a memory comes from a conversation or agent task.
7. The system shall preserve creation and update timestamps.
8. The system shall support confidence or quality metadata for extracted memories.

### Manual Memory Operations

1. The user shall be able to create a durable memory manually.
2. The user shall be able to ask AI Chat V2 to remember a fact.
3. The user shall be able to list active memories.
4. The user shall be able to edit memory title/content/type.
5. The user shall be able to archive a memory.
6. The user shall be able to permanently delete a memory after confirmation.
7. Manual memory operations shall not require an AI call unless the user asks the assistant to transform or extract text.

### Memory Retrieval

1. The system shall retrieve a bounded set of relevant active memories for each AI Chat V2 turn.
2. The system shall cap injected durable memory by count and estimated token budget.
3. The system shall prefer memories relevant to the current user message and active conversation.
4. The system shall prefer active memories over archived or contradicted memories.
5. The system shall update `lastUsedAt` or equivalent usage metadata when a memory is injected.
6. The system shall exclude archived and contradicted memories from normal prompt injection.
7. The system shall keep durable memory context separate from conversation compact context.

### Auto-Dream Consolidation

1. The system shall evaluate auto-dream after completed AI Chat V2 assistant turns.
2. The system shall evaluate auto-dream after completed agent tasks.
3. The system shall skip auto-dream when `USER_AI_ENABLED` is not `"true"`.
4. The system shall support a separate auto-dream setting, such as `USER_AI_AUTO_DREAM`.
5. The system shall skip auto-dream when disabled by user settings.
6. The system shall skip auto-dream until a configurable time threshold has passed since the last successful run.
7. The system shall skip auto-dream until a configurable number of new or changed sources exist.
8. The system shall serialize consolidation with a lock.
9. The system shall record each consolidation run with status, source counts, memory changes, and errors.
10. The system shall tolerate AI failures without breaking chat or task execution.
11. The system shall avoid unbounded retries after repeated failures.
12. The system shall be manually runnable for testing/debugging.

### Source Coverage

1. The system shall track which AI Chat V2 conversations have been reviewed.
2. The system shall track which agent tasks have been reviewed.
3. The system shall avoid repeatedly processing the same unchanged source range.
4. The system shall support incremental consolidation based on last reviewed timestamps or source boundaries.
5. The system shall avoid storing full raw transcripts in memory records.

### Memory Consolidation Behavior

1. The system shall merge duplicate memories rather than creating repeated entries.
2. The system shall update stale memories when newer evidence refines them.
3. The system shall archive or mark contradicted memories instead of keeping conflicting active facts.
4. The system shall preserve explicit user preferences unless later explicitly changed.
5. The system shall convert relative dates into absolute dates when enough context exists.
6. The system shall prefer concise memory content over transcript-like summaries.
7. The system shall store enough source attribution for user trust and debugging.

## Suggested Data Model

### AIUserMemoryEntity

Table: `ai_user_memories`

| Field | Type | Notes |
| --- | --- | --- |
| id | integer PK | auto increment |
| memoryId | varchar(100) | stable unique id |
| type | varchar(30) | `preference`, `fact`, `decision`, `reference`, `workflow` |
| title | varchar(200) | short human-readable label |
| content | text | concise durable memory |
| status | varchar(30) | `active`, `archived`, `contradicted` |
| confidence | integer | 0-100 extraction confidence |
| sourceKind | varchar(30) nullable | `manual`, `chat_v2`, `agent_task`, `auto_dream` |
| sourceConversationId | varchar(100) nullable | source AI Chat V2 conversation |
| sourceAgentTaskId | varchar(100) nullable | source agent task |
| sourceMessageIds | simple-json nullable | source message ids if available |
| lastUsedAt | datetime nullable | last prompt injection time |
| metadata | simple-json nullable | small structured details |
| createdAt | datetime | inherited from auditable entity |
| updatedAt | datetime | inherited from auditable entity |

Indexes:

- unique `memoryId`
- `type`
- `status`
- `sourceKind`
- `sourceConversationId`
- `sourceAgentTaskId`
- `lastUsedAt`
- `updatedAt`

### AIMemoryConsolidationRunEntity

Table: `ai_memory_consolidation_runs`

| Field | Type | Notes |
| --- | --- | --- |
| id | integer PK | auto increment |
| runId | varchar(100) | stable unique id |
| status | varchar(30) | `running`, `completed`, `failed`, `cancelled` |
| startedAt | datetime | run start |
| finishedAt | datetime nullable | run end |
| reviewedSince | datetime nullable | lower source boundary |
| reviewedThrough | datetime nullable | upper source boundary |
| chatConversationsReviewed | integer | count |
| agentTasksReviewed | integer | count |
| memoriesCreated | integer | count |
| memoriesUpdated | integer | count |
| memoriesArchived | integer | count |
| model | varchar(100) nullable | AI model used |
| errorMessage | text nullable | last failure |
| createdAt | datetime | inherited from auditable entity |
| updatedAt | datetime | inherited from auditable entity |

Indexes:

- unique `runId`
- `status`
- `startedAt`
- `finishedAt`

## Prompt Requirements

The auto-dream prompt shall instruct the model to:

1. Extract only durable future-useful memories.
2. Use the closed memory taxonomy.
3. Avoid secrets, credentials, cookies, tokens, private scraped data, and full raw transcript text.
4. Prefer explicit user statements over inferred facts.
5. Keep memories concise and human-readable.
6. Merge duplicates with existing memories.
7. Mark contradictions instead of preserving conflicting active memories.
8. Include source identifiers for every proposed memory change.
9. Return structured JSON suitable for validation before database writes.

The system shall validate model output before applying memory changes.

## UX Requirements

### AI Chat Behavior

When durable memories are injected, the assistant should use them as background context. It should not recite memory content unless relevant.

If memory conflicts with the current user message, the current user message wins.

### Memory Management View

The app should eventually expose:

- Active memories.
- Archived memories.
- Search/filter by type and source.
- Edit action.
- Archive action.
- Delete action.
- Source conversation or agent task reference when available.
- Last used timestamp.
- Auto-dream status.

### Settings

The app should expose an auto-dream setting separate from the general AI enablement setting.

Recommended default for initial rollout:

- Manual memory: enabled when AI is enabled.
- Retrieval injection: enabled after manual memory exists.
- Auto-dream extraction: disabled by default until UI controls are available.

## Security And Privacy

1. All AI-powered memory features shall check `USER_AI_ENABLED` before model work.
2. Auto-dream shall not process source material when AI is disabled.
3. The system shall not store known credential-like values.
4. The system shall not store cookies, access tokens, refresh tokens, API keys, or passwords.
5. The system shall not store large scraped lead/contact datasets as durable memories.
6. The system shall keep memory writes in the main process service/module path.
7. The system shall make extracted memories inspectable by the user.
8. The system shall provide deletion for user trust and privacy.

## Success Metrics

1. The assistant can reuse explicit preferences across new AI Chat V2 conversations.
2. The assistant can reuse durable decisions from prior agent tasks.
3. Prompt injection stays within the durable memory token budget.
4. Automatic consolidation does not delay visible chat responses or task completion.
5. Users can inspect and remove memories.
6. Auto-dream failures are logged and contained.
7. No raw secrets or bulky scraped outputs are saved as memories in normal operation.

## Acceptance Criteria

1. A user can manually create, list, edit, archive, and delete durable memories.
2. A "remember this" request can create a durable memory through a controlled service path.
3. Active durable memories can be selected and injected into AI Chat V2 prompt assembly.
4. Conversation compact context remains separate from durable user memory context.
5. Auto-dream can review AI Chat V2 conversations and propose memory changes.
6. Auto-dream can review agent task messages/tool calls and propose memory changes.
7. Auto-dream records each run with status and memory change counts.
8. Auto-dream skips all AI work when `USER_AI_ENABLED` is not `"true"`.
9. Auto-dream skips when the dedicated auto-dream setting is disabled.
10. Repeated auto-dream failures do not break normal chat or agent execution.
11. Tests cover memory CRUD, retrieval selection, AI gate behavior, run locking, and source review boundaries.

## Rollout Plan

### Milestone 1: Structured Memory Store

Add entities, types, models, modules, and tests for durable user memories and consolidation run records.

### Milestone 2: Manual Memory Path

Add service and IPC support for manual remember/list/edit/archive/delete operations. Add minimal UI only if required for manual verification.

### Milestone 3: Retrieval Injection

Extend `AIChatContextAssembler` to retrieve and inject a bounded durable memory block before conversation compact context.

### Milestone 4: Auto-Dream From AI Chat V2

Add background consolidation from completed AI Chat V2 conversations with gates, lock, run records, and output validation.

### Milestone 5: Auto-Dream From Agent Runtime

Extend consolidation to agent task messages and tool calls. Track reviewed agent task boundaries.

### Milestone 6: Memory Management UI

Add full inspect/edit/archive/delete UI and auto-dream settings/status. Update all supported language files.

### Milestone 7: Semantic Retrieval

Add optional sqlite-vec retrieval once deterministic retrieval is stable and tested.

## Product Decisions For V1

1. `USER_AI_AUTO_DREAM` should default to disabled until the memory management UI is available.
2. "Remember this" should be implemented through a dedicated controlled memory tool/service path. Simple text detection can be added later, but should not be the only write path.
3. Agent task extraction should be evaluated after task completion, but actual consolidation should use the same gated auto-dream queue as chat conversations.
4. The first prompt injection budget should be 2,000 estimated tokens or 10 memories, whichever is reached first.
5. Archive should be the default user-facing removal action. Permanent delete should hard delete the memory after confirmation and does not need a tombstone in v1.
