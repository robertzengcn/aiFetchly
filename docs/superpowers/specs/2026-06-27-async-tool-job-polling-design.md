# Async Tool Job Polling — Design Spec

**Date:** 2026-06-27
**Status:** Draft
**Owner:** AI Chat v2

## Problem

When the AI chat v2 query loop dispatches an async tool (`run_subagent`, `search_maps_businesses`
with `max_results > 20`, or `extract_contact_info` with >= 8 URLs), the tool returns an envelope
`{ async: true, job_id, status: "running", message: "Poll with check_tool_job_status..." }`.
This envelope is treated as a completed tool result. In the next round the model sees the
"successful" envelope, emits no new tool call (`parsedCalls=0`), and the loop breaks
(`willContinue=false`). The subagent's eventual result - which is stored in
`ToolJobRegistry` - is never injected back into the conversation. The user sees no feedback
that a background job is running, and after 30+ minutes has no way to discover the result.

Two coupled root causes:

1. **`AIChatQueryLoop.executeAsyncTool`** returns the polling envelope as if it were a final
   tool result. The loop treats it as terminal for that tool_call_id.
2. **No UI surface** exists for "this tool_call has a background job running." The existing
   tool_result card renders the envelope text verbatim, confusing users.

The model is *told* to poll (`check_tool_job_status`), but nothing forces it to, and in
practice it never does.

## Goal

When any async tool returns a `job_id`, the query loop itself polls `ToolJobRegistry` until
completion (or a 30-minute cap), then injects the real result as the `tool` message and
continues the model loop. The UI sees a live "running" badge on the tool card via the
existing `tool_progress` event channel and never sees the raw polling envelope.

## Scope

**In scope:**

- `src/service/AIChatQueryLoop.ts` - replace placeholder-return with poll-to-completion.
- `src/views/components/aiChatV2/AiChatV2.vue` - wire `tool_progress` events to tool_call
  card metadata.
- `src/views/components/aiChatV2/AiChatV2Message.vue` - render running badge on tool cards
  that have a pending tool_result plus a progress event.
- New unit tests for the poll loop.
- New manual test doc.

**Out of scope:**

- Changes to `ToolJobRegistry` (already supports everything needed).
- Changes to individual tool definitions (`runSubagentTool.ts`, `skillsRegistry.ts`).
- New IPC channels.
- Moving `scrape_urls_from_search_engine` (Google/Yandex) to async - it currently runs under
  the synchronous "network" 90s ceiling and is unaffected. Separate change if needed.
- A dedicated "Background Jobs" panel below the chat input (deferred; the live badge covers
  the immediate UX gap).

## Architecture

### Single funnel for all async tools

Three tools route to the async path today, all through the same code funnel:

| Tool | Condition for async |
|---|---|
| `run_subagent` | Always (`resolveTimeoutClass: () => "async"`) |
| `search_maps_businesses` | `max_results > 20` OR `include_website === true` |
| `extract_contact_info` | `urls.length >= 8` |

`AIChatQueryLoop.executeToolWithTimeout` resolves the timeout class via
`skill.resolveTimeoutClass(args) ?? skill.timeoutClass ?? inferTimeoutClassByName(name)`.
When the resolved class is `"async"`, `resolveTimeoutMs` returns `null`, and the call is
dispatched to `executeAsyncTool`. Because the poll logic attaches to this single dispatch
point, it covers all current and future async tools without per-tool code.

### Data flow

```
Round N:
  Model streams tool_call(async_tool, args)
  parsedCalls.length > 0 -> willContinue = true
  For each parsed call:
    executeToolWithTimeout(input, call)
      skill.resolveTimeoutClass(args) === "async" -> timeoutMs = null
      executeAsyncTool(input, call):
        AI-enable re-check (existing defense-in-depth)
        registry.start(call.name, args, ctx, spawn) -> { jobId }
        return { jobId } to caller   // *** CHANGED: no placeholder envelope ***
      pollAsyncJobToCompletion(input, call, jobId):
        emit tool_progress { phase: "running", message: "Background job started" }
        loop:
          await race(sleep(15s), abortSignal)
          snap = registry.getStatus(jobId)
          if snap.progress changed: emit tool_progress { phase, progress, message }
          if snap.status === "completed": return success(snap.result)
          if snap.status === "failed":    return failure(snap.error)
          if snap.status === "cancelled": return failure("Job cancelled")
          if snap.status === "not_found": return failure("Job evicted; retry")
          if elapsed >= 30min:           return failure("Timed out after 30min")
      build toolContent = serializeToolResultContent(realPayload)
      emit tool_result { toolCallId, fullContent, toolResult }   // single, final
      messages.push({ role: "tool", tool_call_id, content: toolContent })
  Continue to round N+1 with the REAL result in history
```

**Frontend event sequence for one async tool call:**

```
tool_call(toolCallId=A)          -> renders tool_call card
tool_progress(A, running, 0%)    -> card shows spinner + "Background job started"
tool_progress(A, fetching, 40%)  -> card updates badge
tool_progress(A, finalizing, 90%)
tool_result(A, fullContent)      -> card swaps to result view, badge cleared
```

The user never sees the `{ async: true, job_id, "Poll with check_tool_job_status..." }` envelope.

## Components & Changes

### 1. `src/service/AIChatQueryLoop.ts`

**New constants** (top of file, near other config):

```typescript
const ASYNC_POLL_INTERVAL_MS = 15_000;
const ASYNC_POLL_MAX_MS = 30 * 60_000; // 30 minutes
```

Rationale for 30-min cap: the inner `run_subagent` runtime default cap is 180s, but
multi-tool cascades (Lead Researcher that internally calls `extract_contact_info` with
8+ URLs, then `scrape_urls_from_search_engine` for each result) can legitimately exceed
10 minutes. 30 minutes matches the outer bound of plausible subagent work. Jobs that
exceed this are almost certainly stuck; the model gets a timeout error and can ask the
user whether to keep waiting.

**New private method** `pollAsyncJobToCompletion`:

Signature:
```typescript
private async pollAsyncJobToCompletion(
  input: AIChatQueryLoopInput,
  call: { id: string; name: string; arguments?: Record<string, unknown> },
  jobId: string
): Promise<ToolExecutionResult>
```

Behavior:
- Emits initial `tool_progress` with `phase="running"`, `message="Background job started
  (job_id: <short>)"`, `progress=null`.
- Loops with an abortable 15s sleep: `await Promise.race([sleep(ASYNC_POLL_INTERVAL_MS),
  abortPromise])`. The abortPromise resolves when `input.abortController.signal` aborts.
- On each iteration, calls `registry.getStatus(jobId)` (NOT `getStatusForConversation` -
  the loop owns the job; no need for the conversation scoping that the model-facing
  `check_tool_job_status` tool uses).
- If `snap.status === "running"` and the progress/phase changed since the last emit,
  emits a `tool_progress` event.
- Exits on terminal status or 30-min cap.
- On abort: calls `registry.cancel(jobId)` and returns a cancelled-state result
  (`{ success: false, result: { error: "Turn cancelled" } }`). The outer loop will then
  break via its existing cancel-detection path; the tool_result will not be emitted to
  the UI because the turn is already dead.
- Returns a `ToolExecutionResult` with:
  - `success: true` + `result: snap.result` on completion
  - `success: false` + `result: { error: snap.error | "..." }` on every other path

**Modify `executeAsyncTool`**:

- Keep the AI-enable re-check.
- Keep `registry.start(...)`.
- Change the return type to return `{ jobId: string }` (internal contract) instead of
  the `ToolExecutionResult` placeholder envelope.
- Remove the `"Poll with check_tool_job_status..."` message - dead under the new design.

**Modify `executeToolWithTimeout`** (line ~993-995):

```typescript
if (timeoutMs === null) {
  const { jobId } = await this.executeAsyncTool(input, call);
  return await this.pollAsyncJobToCompletion(input, call, jobId);
}
```

No other call sites of `executeAsyncTool` exist; safe to change its return type.

### 2. `src/views/components/aiChatV2/AiChatV2.vue`

**New helper** `upsertToolProgress(chunk, conversationId)` adjacent to the existing
`upsertToolResultMessage`:

- Finds the tool_call message with `metadata.toolCallId === chunk.toolCallId`.
- If none exists yet (race: progress arrived before tool_call event), drops the event.
  The tool_call card will render shortly; next progress tick will land.
- If found, merges `chunk.phase`, `chunk.message`, `chunk.progress`, `chunk.partialCount`,
  `chunk.expectedCount`, and a monotonic `progressUpdatedAt` timestamp into
  `metadata`. Uses immutable spread.

**Chunk handler wiring** (around line 1378 where `tool_progress` is already received):
ensure the handler calls `upsertToolProgress` instead of only logging. (Much of the
plumbing may already exist - verify and complete it.)

### 3. `src/views/components/aiChatV2/AiChatV2Message.vue`

**New rendering branch** on the tool_call card:

- Condition: `messageType === TOOL_CALL && metadata.toolProgress` (a non-null progress
  object written by `upsertToolProgress`).
- Renders: small spinner icon, the `phase`/`message` text, optional progress bar when
  `progress` is a number in `[0,1]`, optional `partialCount / expectedCount` when both
  are present.
- Uses existing Vuetify components (e.g., `v-progress-linear`, `v-icon` with
  `mdi-spin mdi-loading`).
- Clears automatically when the matching `tool_result` message arrives - the card
  transitions to result view.

**No new component file needed.** The badge is a small inline addition to the existing
tool_call template block.

### 4. `test/vitest/main/service/AIChatQueryLoopAsyncPoll.test.ts` (new)

Unit tests for `pollAsyncJobToCompletion` behavior. Uses a fake `ToolJobRegistry`
injected via the existing DI seam (`setDefaultToolJobRegistry`).

Cases:

1. Returns success with `snap.result` when the job completes.
2. Returns failure with `snap.error` when the job fails.
3. Returns timeout error when 30-min cap exceeded (fake timers).
4. Emits at least one `tool_progress` event before completion.
5. Calls `registry.cancel(jobId)` when `abortController.signal` fires mid-poll.
6. Suppresses placeholder envelope: verifies the outer loop produces exactly one
   `role: "tool"` message with the real result, zero references to
   `"Poll with check_tool_job_status"`.

### 5. `test/vitest/main/components/AiChatV2Message.toolProgress.test.ts` (new)

Component test for the running badge:

1. Renders spinner when `metadata.toolProgress` is set and no `tool_result` follows.
2. Clears badge when `tool_result` for the same `toolCallId` arrives.
3. Renders progress bar when `progress` is a number.

### 6. `docs/test-manual/aiChatV2-async-jobs.md` (new)

Step-by-step manual test:

- Trigger Lead Researcher subagent; observe running badge; wait for completion; verify
  real result appears in chat and the model continues the conversation using it.
- Trigger `extract_contact_info` with 8+ URLs (async path); verify same flow.
- Hit Stop mid-job; verify job is cancelled and UI does not hang.
- Wait 30+ minutes (or mock the cap); verify timeout error is surfaced to the model.

## Error Handling

| Scenario | Behavior |
|---|---|
| Job completes successfully | Real result injected, loop continues |
| Job fails (`status: "failed"`) | Error result injected `{ success: false, error: snap.error }`, loop continues - model can react |
| Job cancelled (user Stop, or superseded turn) | `abortController.signal` fires -> poll loop exits -> `registry.cancel(jobId)` called -> outer loop breaks via existing cancel path |
| Job cancelled via `cancel_tool_job` tool from elsewhere | Poll detects `status: "cancelled"`, injects error, loop continues |
| Job not found (registry evicted stale entry after 5 min) | Inject `{ success: false, error: "Job evicted; retry the tool call" }`, loop continues |
| 30-min cap exceeded | Inject `{ success: false, error: "Background job did not complete within 30 minutes. The job may still be running; ask the user whether to keep waiting or cancel via cancel_tool_job(job_id)." }`, loop continues |
| Polling rate-limited by registry | Cannot happen - 15s interval is above the 5s `pollMinIntervalMs` floor |
| Progress emit fails | Caught and logged; polling continues |

**Key invariant:** every exit path from `pollAsyncJobToCompletion` produces a
`ToolExecutionResult` that becomes a `tool` message, so the model always receives a tool
response for its `tool_call_id`. This is required by the OpenAI chat-completions API
contract: every `tool_call_id` in an assistant message must have a matching `tool` message.

**Abort safety:** the 15s sleep is `Promise.race([sleep, abortPromise])`, so Stop is
responsive within ~100ms, not 15s.

## Testing Strategy

- **Unit tests** (new): poll-loop behavior, all exit paths. Uses fake timers for the
  30-min cap test.
- **Component tests** (new): running badge rendering and clearing.
- **Manual test doc** (new): end-to-end coverage including the cancel path.

Existing tests for `AIChatQueryLoop` and `OpenAIStreamAccumulator` must continue to pass
unchanged.

## Rollout

Single PR. No feature flag needed - the change is a bug fix to existing async behavior,
not new surface area. If regression appears, revert the 4-line change in
`executeToolWithTimeout` to restore the old placeholder behavior.

## Open Questions

None at spec time. Implementation may surface:

- Whether the running badge needs an explicit "Cancel" button on the card (currently
  out of scope; user can use the Stop button). Revisit if usability testing flags it.
- Whether `scrape_urls_from_search_engine` for Google/Yandex should be moved to async.
  Not blocking; tracked separately.
