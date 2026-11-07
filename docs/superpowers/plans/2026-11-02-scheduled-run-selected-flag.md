# Scheduled running conversation shows no running flag in the workspace chat

**Date:** 2026-11-02 · **Scope:** workspace chat bottom running flag when selecting a
conversation whose scheduled (AI message task / `/loop`) occurrence is executing.

## Root cause (systematic debugging Phase 1-2)

The `AI_CHAT_WORKSPACE_SELECT` snapshot (`ai-chat-workspace-ipc.ts`) resolves
`runtimeStatus` from three sources, all blind to scheduled occurrences:

1. `coordinator.getLiveRuntime()` — scheduled turns bypass `AIChatCoordinator`
   (`ScheduledAiMessageRunner.recordProjection` rationale comment).
2. `getQueryEngine().getConversationRuntimeStatus()` — the interactive engine
   singleton; scheduled turns run in a dedicated engine registered in
   `ScheduledLoopEngineRegistry` (both `run()` and `runChatScheduledLoop()`).
3. `AIChatRunModule.listByConversation()` durable fallback — only the chat-bound
   `/loop` path creates the workspace envelope (`createOwnerAdapterSink` line 684);
   the legacy scheduled-task path (`run()` → `executeRunLoop()`, line 1353) does not.

Result: `selectedStore.runtimeStatus` hydrates `"idle"` → `isBusy` false → the
composer (bottom) never swaps Send→Stop and no streaming presentation appears.
Additionally, `getConversationBusyReason` (delete/clear protection) has the same
blind spot, and the workspace center never receives scheduled lifecycle events
(`AI_CHAT_V2_SCHEDULED_STREAM` is only consumed by the legacy `AiChatV2.vue`).

## Fix (root-cause layer, no symptom patches)

1. **`src/service/aiChatWorkspaceRuntime.ts`** — new `scheduledAwareLiveRuntime`
   composite live-runtime lookup (structural probe over
   `ScheduledLoopEngineRegistry`), returning the scheduled engine's own
   `getConversationRuntimeStatus` truth (`running` / `awaiting_permission` /
   `awaiting_user`) with a namespaced `scheduled-<runId>` active run id.
2. **`ai-chat-workspace-ipc.ts`** — wrap the select and bootstrap sidebar lookups
   with it; add the probe to `getConversationBusyReason` so destructive
   clear/delete stays guarded behind the now-visible running state.
3. **`src/views/store/selectedConversation.ts`** — app-scoped
   `AI_CHAT_V2_SCHEDULED_STREAM` subscription: while the conversation is
   selected and no interactive stream owns the view, `start`/`token` event flags
   the run running through `hydrateRuntime` and `done`/`error` clears it, so the
   flag is live while open and never stale after completion.

## Tests (write first / TDD)

- `test/vitest/main/aiChatWorkspaceScheduledRuntime.test.ts` — composite lookup:
  coordinator wins, scheduled engine running/parked surfaced, registry miss →
  null, idle engine entry → null (fall through).
- `test/vitest/main/components/store/selectedConversation.scheduledRuntimeFact.test.ts`
  — store lifecycle: start (selected, no interactive stream) → running; done/error
  → idle; selection mismatch ignored; interactive streaming defers.

## Out of scope (documented follow-ups)

- Stop routing for legacy scheduled occurrences via `ScheduledLoopRunRegistry`
  (Stop silently no-ops; the loop path already stops via `controlScheduledLoop`).
- Live token rendering of scheduled streams in the workspace transcript
  (content lands at load/reselect; the flag is the reported gap).
