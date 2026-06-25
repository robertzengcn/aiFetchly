# AI Chat Local Memory Design

## Goal

Move AI chat memory ownership from the remote AI server to the local application so the app can compact context, summarize old turns, and decide exactly what gets sent on each request.

## Recommendation

Use **SQLite** as the primary local storage for chat memory.

Use raw files only for large binary payloads if attachment size or write volume becomes a problem.

## Why SQLite

SQLite fits the shape of chat memory better than raw files because the app needs:

- indexed lookup by `conversationId`
- message pagination
- deletion of one conversation or all conversations
- metadata queries
- compaction markers and summary state
- attachment/message relationships
- reliable migrations over time

The codebase already has local chat persistence patterns in:

- `src/entity/AIChatMessage.entity.ts`
- `src/entity/AIChatAttachment.entity.ts`
- `src/modules/AIChatModule.ts`

That makes SQLite the lowest-risk and most consistent choice.

## When Raw Files Make Sense

Raw files are reasonable for:

- large attachment binaries
- exported conversation archives
- debug snapshots

They are not a good primary store for live chat memory because they make partial reads, pagination, search, and deletion awkward.

## Target Architecture

The local app should own:

- raw transcript storage
- conversation summaries
- token budgeting
- context selection for each request
- retrieval of recent messages and pinned facts

The remote AI server should only:

- receive the request context
- run inference
- stream the response

The server should not be the source of truth for memory.

## Suggested Local Memory Model

Store three layers locally:

1. Raw transcript
2. Rolling summary
3. Active context window

The active context for a request should usually include:

- system prompt
- summary of earlier turns
- recent messages
- relevant attachments or RAG context
- the current user message

## Compaction Rule

Use token budget thresholds, not message count.

When the conversation exceeds the budget:

- keep the latest messages unchanged
- summarize older messages into a structured summary
- record which message the summary covers
- keep the raw transcript intact

The summary should be structured, for example:

- user goals
- decisions made
- important facts
- open tasks
- constraints
- tool or file references

## Risk to Avoid

Do not let both local memory and remote server memory stay active at the same time.

That creates drift, duplicate context, and hard-to-debug answers. The migration should make the remote side stateless as early as possible.

## Practical Migration Path

1. Build a local context manager that assembles the prompt from local history.
2. Stop relying on remote conversation memory.
3. Add local summary state and compaction.
4. Add debug metadata for token usage and summary coverage.
5. Keep raw history locally for audit and recovery.

