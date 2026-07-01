# PRD: AI Tool Call Timeout Resilience

**Date:** 2026-06-25
**Status:** Draft
**Owner:** AiFetchly AI Chat
**Related area:** `ai-chat-v2`, `src/service/AIChatQueryLoop.ts`, `src/service/ToolExecutor.ts`
**Related tools:** `search_maps_businesses`, `search_yellow_pages`, `extract_contact_info`, `analyze_website`

## Summary

`ai-chat-v2` wraps every tool call in a single global 90-second hard timeout (`CHAT_V2_TOOL_TIMEOUT_MS`). That value is reasonable for fast file/URL tools but is fundamentally too short for browser-automation tools such as `search_maps_businesses`, which spawns a Puppeteer worker to scrape Google Maps or Yandex Maps. Those tools routinely take 90–240 seconds, so users see `Tool "search_maps_businesses" timed out after 90000ms` even when the work would have succeeded.

This PRD defines a product-level fix composed of three coordinated changes:

1. **Per-tool-class timeouts.** Replace the single global ceiling with a timeout table keyed by tool category. Slow browser-based tools get a longer ceiling (e.g. 240s) while fast tools stay at the current 90s or lower.
2. **Streaming progress and partial results.** Long-running tools emit incremental progress events, and on timeout the loop returns whatever the tool has produced so far instead of a synthetic `timedOut: true` error.
3. **Async job pattern for genuinely long tools.** Tools whose expected runtime exceeds any reasonable synchronous timeout (notably Maps/contact extraction at high `max_results`) switch to an enqueue-and-poll model: the tool returns a `job_id` immediately, and a companion tool `check_tool_job_status(job_id)` lets the model poll for completion and stream intermediate results.

Together these changes remove the timeout failure mode for legitimate work, give the model and the user visibility into slow tools, and align Maps/contact scraping with the existing worker-process architecture already used by `extract_contact_info`.

## Problem

### Symptom

When the AI calls `search_maps_businesses` with default arguments (`max_results: 20`, `include_website: true`), the call frequently fails with:

```
Tool "search_maps_businesses" timed out after 90000ms.
```

The model receives no business data, cannot reason about partial results, and typically either retries (consuming rate-limit budget) or gives up.

### Root cause

`AIChatQueryLoop.executeToolWithTimeout` (line 809) races the real tool execution against a `Promise.race` with a fixed 90s timer (`CHAT_V2_TOOL_TIMEOUT_MS = 90_000`, line 48). The maps tool path is:

```
executeMapsSearch
  → GoogleMapsModule / YandexMapsModule
    → child_process.spawn(Puppeteer worker)
      → launch browser (3–10s)
      → load Maps page + anti-bot wait (5–20s)
      → scroll/paginate for N results (scales with max_results)
      → optional per-result page visits for website/email (1–3s per result)
```

At `max_results: 20` with website extraction, total runtime realistically lands between 90 and 240 seconds. The 90s ceiling was chosen for fast tools and was never re-evaluated when Maps scraping was added.

### Secondary problems

- **Wasted work.** On timeout the worker process is not cancelled; it keeps running, consuming CPU and a browser instance, while the loop moves on. The user pays the cost twice: slow tool + failed result.
- **No visibility.** The user and the model see nothing between "tool started" and "tool timed out". There is no progress signal ("found 8 businesses so far").
- **All-or-nothing result.** Even if the worker has already collected 18 of 20 results when the 90s timer fires, the loop returns `timedOut: true` and discards everything.
- **Rate limiter makes it worse.** `mapsBusiness: { maxConcurrent: 2, cooldownMs: 2000 }` adds queue wait on top of the actual scrape time, so a tool that needs 80s of scrape work can hit the 90s ceiling just from queueing behind another call.

### Why not just raise the global timeout?

Raising the global 90s to, say, 240s fixes Maps but degrades the fast-tool experience: a hung `file_read` or `glob_files` call would now hang the whole agent loop for 4 minutes before failing. The timeout needs to be **per tool class**, not global.

## Goals

1. Eliminate spurious `timedOut` failures for legitimate browser-automation tools (`search_maps_businesses`, `search_yellow_pages`, `extract_contact_info`) at default arguments.
2. Preserve the snappy failure behavior of fast tools (file ops, URL reads, simple lookups) — their timeouts must not lengthen.
3. Give the user and the model real-time visibility into long-running tool progress.
4. On timeout, return the partial data the tool has already collected, instead of an opaque error, so the model can still reason and respond.
5. Provide an async (enqueue + poll) execution path for tools whose expected runtime exceeds any reasonable synchronous ceiling, so the agent loop is never blocked waiting on a multi-minute scrape.
6. Keep all worker-process and database-access rules intact: workers never touch the DB directly, all results flow through the main process.
7. Make timeout configuration declarative and discoverable, so adding a new slow tool does not require touching the timeout race code.

## Non-Goals

1. Do not change the underlying Puppeteer scraping logic itself. Browser-pool warming, asset blocking, and Places-API substitution are separate efforts.
2. Do not change the rate-limiter semantics (`maxPerMinute`, `maxConcurrent`, `cooldownMs`). Per-tool-class timeouts are independent of rate limiting.
3. Do not change the model provider or the OpenAI-compatible `messages[]` protocol.
4. Do not remove the synchronous execution path. Fast tools must continue to run synchronously. Async is opt-in per tool class.
5. Do not introduce durable, cross-conversation job persistence in v1. Async jobs live in memory and are lost on app restart.
6. Do not introduce new database entities in v1. Job state is in-memory and observable via the existing event sink and debug logs.
7. Do not add UI surfaces (progress bars, cancel buttons) in v1. Visibility flows through the existing tool-progress event channel that the chat view already renders.

## Users

### Primary User

A marketer or operator using `ai-chat-v2` to find local businesses, analyze websites, or extract contacts. Today they see "timed out" errors and assume the feature is broken. They want the tool to actually return data, and when it takes a while, they want to see progress rather than a frozen UI.

### Secondary User

A developer or power user running multi-step agent workflows that chain several slow tools (e.g. "find 30 dentists in Berlin, then extract contact info for each"). They need the agent loop to stay responsive while slow tools run, and they need partial results when one step times out so the workflow can continue.

## User Stories

1. As a user, I can call `search_maps_businesses` with default arguments and get a complete result back, instead of a 90s timeout error.
2. As a user, when a tool takes longer than a few seconds, I see incremental progress events (e.g. "Scraping Google Maps… found 8 of 20 businesses") in the chat UI.
3. As a user, if a tool genuinely cannot finish in the allotted time, I still receive whatever data it has collected so far, clearly labeled as partial.
4. As a user, I can call `search_maps_businesses` with `max_results: 50` and `include_website: true` and the tool will run asynchronously, returning a job handle immediately while continuing to work in the background.
5. As the AI assistant, I can poll the status of an async tool job, receive intermediate results as they arrive, and decide whether to wait, proceed with partial data, or cancel.
6. As the AI assistant, when I call a fast tool (file ops, URL read), it still fails fast if it hangs — I do not wait 4 minutes for a hung `file_read`.
7. As a developer adding a new slow tool, I can declare its timeout class and async capability in the registry without touching the timeout race code.
8. As a developer, I can observe job lifecycle (created, running, progress, completed, failed, cancelled, timed_out) for debugging.

## Product Scope

This PRD defines three coordinated phases. Phase 1 and Phase 2 ship together (they share the result-shape contract). Phase 3 ships after, since it depends on Phase 1's timeout table and Phase 2's progress channel.

### Phase 1: Per-Tool-Class Timeouts

Replace the single global `CHAT_V2_TOOL_TIMEOUT_MS` with a **timeout class table**. Each tool in the registry declares a timeout class; the class maps to a ceiling in milliseconds.

**Default classes:**

| Class | Ceiling | Tools |
|---|---|---|
| `fast` | 30,000 ms | `file_read`, `glob_files`, `grep_files`, `file_write`, `file_edit`, `read_url_content`, simple lookups |
| `network` | 90,000 ms | `analyze_website`, `search_yellow_pages` (low `max_results`) |
| `browser` | 240,000 ms | `search_maps_businesses`, `extract_contact_info`, `search_yellow_pages` (high `max_results`) |
| `async` | n/a (no synchronous ceiling) | Maps/contact tools at high `max_results` (see Phase 3) |

**Key behaviors:**
- The timeout race in `executeToolWithTimeout` reads the tool's class from the registry and uses the class ceiling instead of the global constant.
- Tools without an explicit class default to `fast`.
- The class is declared in `skillsRegistry.ts` next to `tier`, `requiresConfirmation`, and `permissionCategory`.
- The class can be **conditional on arguments** — e.g. `search_maps_businesses` is `browser` when `max_results <= 20` and `include_website: false`, but `async` when `max_results > 20` or `include_website: true`. This is computed by a function on the skill entry, not a static field.

**Acceptance:**
- Calling `search_maps_businesses` with default arguments no longer hits the timeout under normal network conditions.
- Calling `file_read` against a hung target still fails within 30s.
- Adding a new slow tool requires only adding a class entry to the registry, not editing `AIChatQueryLoop`.

### Phase 2: Streaming Progress and Partial Results

Add two capabilities to the tool execution contract:

**2.1 Progress events.** Long-running tools emit progress events through the existing event sink used by the agent loop. Each progress event is a structured object:

```
{
  tool_call_id: string,
  phase: "queued" | "running" | "fetching" | "extracting" | "finalizing",
  message: string,           // human-readable, e.g. "Found 8 of 20 businesses"
  progress: number | null,   // 0..1 if known, null if indeterminate
  partial_count: number | null, // how many results collected so far, if applicable
  timestamp: number
}
```

The chat view already renders tool-execution state; Phase 2 routes these events into that channel. The model does not consume progress events — they exist for the user.

**2.2 Partial result on timeout.** When the timeout race fires, the loop queries the tool for whatever it has produced so far. Tools that opt into partial results expose a callback or property on their execution context. On timeout:

- The tool result is `{ success: true, partial: true, data: <partial>, collected_count: N, expected_count: M, timed_out_after_ms: K }`.
- The tool execution context records `partial: true` in `ToolExecutionResult`.
- The model sees a successful tool call with partial data and a `partial: true` flag, and can decide how to proceed.

**Tools that must support partial results:**
- `search_maps_businesses` — return businesses collected so far.
- `search_yellow_pages` — return results collected so far.
- `extract_contact_info` — return contacts extracted so far.
- `analyze_website` — return partial analysis if any.

**Tools that need not support partial results:**
- File tools (`file_read`, `glob_files`, etc.) — no useful intermediate state.
- `read_url_content` — no useful intermediate state.

**Acceptance:**
- When a Maps scrape hits the timeout ceiling, the model still receives the businesses already collected, with `partial: true`.
- The user sees at least one progress event per 15 seconds during a long Maps scrape.
- Progress events do not block the agent loop or add latency to fast tools.

### Phase 3: Async Job Pattern

Introduce an opt-in async execution path for tools whose expected runtime exceeds any reasonable synchronous ceiling. The synchronous path (Phases 1–2) remains the default.

**3.1 Job lifecycle.** A tool may declare `async: true` (statically, or dynamically based on arguments). When async:

1. The tool's `execute` starts the worker and returns immediately with `{ async: true, job_id: <uuid>, status: "running" }`.
2. The job is registered in an in-memory `ToolJobRegistry` (main-process only, no DB).
3. The worker streams progress events to the registry as in Phase 2.
4. The model uses the companion tool `check_tool_job_status(job_id)` to poll. Polling returns one of: `{ status: "running", progress: …, partial: <partial results so far> }`, `{ status: "completed", result: … }`, `{ status: "failed", error: … }`, `{ status: "cancelled" }`.
5. On terminal status, the registry evicts the job after a short retention window (e.g. 5 minutes) so the model can do a final poll after presenting results.

**3.2 New tool: `check_tool_job_status`.**
- Parameters: `{ job_id: string (required), return_partial_if_running: boolean (default false) }`.
- Returns: the job's current state, including partial results when `return_partial_if_running: true`.
- The model is expected to poll at a reasonable interval (e.g. every 15–30s) and not in a tight loop.

**3.3 New tool: `cancel_tool_job`.**
- Parameters: `{ job_id: string (required) }`.
- Returns: `{ cancelled: true }` or `{ cancelled: false, reason: "already_completed" | "not_found" }`.
- Cancelling sends a terminate signal to the worker process and frees resources.

**3.4 Model guidance.**
- Tool descriptions for async-capable tools tell the model: *"At high max_results or with include_website: true, this tool runs asynchronously. You will receive a job_id; poll it with check_tool_job_status every 15–30 seconds until status is completed or failed."*
- The model is given an explicit upper bound on expected runtime so it does not poll indefinitely.

**3.5 Resource limits.**
- `ToolJobRegistry` caps concurrent async jobs (default 4). Exceeding the cap returns `{ status: "queued" }` from `check_tool_job_status` until a slot frees.
- On app exit, all running workers are terminated. In-memory jobs are lost; the model is told via the next poll that the job is gone.

**Acceptance:**
- Calling `search_maps_businesses` with `max_results: 50, include_website: true` returns within 2 seconds with a `job_id`.
- The agent loop is not blocked while the Maps scrape runs; the model can reason, talk to the user, and queue follow-up work.
- The user sees the same progress events as in Phase 2; only the execution path differs.
- Cancelling a job terminates the worker process within 5 seconds and frees its browser instance.
- After app restart, polls to old `job_id` values return `{ status: "not_found" }` quickly rather than hanging.

## Requirements

### Functional

| ID | Requirement |
|---|---|
| FR-1 | The system must support per-tool timeout ceilings, sourced from a class table in the registry. |
| FR-2 | Tools may declare a dynamic timeout class based on call arguments. |
| FR-3 | Tools may emit progress events during execution; the events must reach the existing tool-execution-state UI channel. |
| FR-4 | On timeout, tools that support partial results must return whatever data they have collected, marked `partial: true`. |
| FR-5 | Tools may declare `async: true`; async tools must return `{ async: true, job_id }` within 2 seconds of invocation. |
| FR-6 | A `check_tool_job_status(job_id)` tool must exist and return running/completed/failed/cancelled/not_found status. |
| FR-7 | A `cancel_tool_job(job_id)` tool must exist and terminate the underlying worker. |
| FR-8 | The agent loop must never block on an async tool's worker; polling is the model's responsibility. |
| FR-9 | The `ToolJobRegistry` must enforce a concurrent-job cap and reject new async jobs over the cap with `status: "queued"`. |
| FR-10 | Async jobs must remain in-memory only in v1; no new database entities or migrations. |
| FR-11 | Worker processes must continue to obey the existing rule: no direct DB access. Job results flow through main-process IPC. |

### Non-Functional

| ID | Requirement |
|---|---|
| NFR-1 | Per-tool-class timeout lookup must add <1 ms to tool dispatch. |
| NFR-2 | Progress-event emission must not add measurable latency to fast tools. Tools that don't emit progress pay zero cost. |
| NFR-3 | Async job registry must support at least 4 concurrent jobs without degradation. |
| NFR-4 | Worker cancellation must complete within 5 seconds. |
| NFR-5 | All timeout, partial-result, and job-status state must be observable via existing debug logging (`DEBUG='module:*'`). |
| NFR-6 | No new third-party dependencies. |
| NFR-7 | No regression in fast-tool latency. The Phase 1 change must not slow down `file_read`, `glob_files`, etc. |

### Constraints

- **Architecture:** Three-layer DB access (Entity → Model → Module → service/IPC) must be preserved. Workers do not touch SQLite.
- **i18n:** Any user-facing progress message surfaced through the UI must be translatable in all six supported languages (`en`, `zh`, `es`, `fr`, `de`, `ja`).
- **AI enable gate:** Async job creation is an AI feature; the IPC handler must check `USER_AI_ENABLED` before starting a job. Polling and cancelling do not require the gate (they are read-only / cleanup operations).
- **Backwards compatibility:** Existing synchronous tools must continue to work unchanged. Async is opt-in per tool.

## Success Metrics

| Metric | Target | Measurement |
|---|---|---|
| `search_maps_businesses` timeout rate at default args | < 5% (baseline: ~50%+) | Tool execution telemetry, sampled over 1 week post-launch |
| Median time-to-first-result for `search_maps_businesses` | First progress event within 15s | Worker progress-event timestamps |
| Fast-tool P95 latency (file_read, glob_files) | No regression vs. baseline | A/B against current code path |
| User-visible "timed out" errors per 1000 tool calls | < 20 (baseline: ~80+) | Error-rate dashboard |
| Async job cancellation latency (P95) | < 5s | Registry timestamps |
| Partial-result recovery rate | On > 50% of timeouts that would otherwise be total failures, the model still produces a useful response | Manual eval of 20 timeout cases |

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Partial results are malformed or cause the model to hallucinate missing fields | Medium | High | Always tag partial results with `partial: true` and include `collected_count`/`expected_count`. Tool description instructs the model to disclose partial data to the user. |
| Model polls async jobs in a tight loop, overwhelming the worker | Medium | Medium | `check_tool_job_status` description specifies 15–30s poll interval. Rate-limit polling to 1 req / 5s / job_id. |
| Model forgets to poll and abandons jobs | Medium | Medium | Registry auto-evicts stale jobs after 5 minutes. Telemetry tracks abandoned-job rate. |
| Worker process not actually killed on cancel, leaking browser instances | Medium | High | Cancel uses `tree-kill` to terminate the process group, then verifies process exit. Add a periodic sweep that kills any worker whose parent job no longer exists. |
| Per-tool timeout table drifts from reality as tools evolve | Low | Low | Class is declared in the registry next to the tool, reviewed when the tool changes. CI lint can flag tools without a declared class. |
| User confuses async tool "still running" with "broken" | Medium | Medium | Progress events are mandatory for async tools. The chat view must show a clear "running" indicator while the job is active. |
| In-memory job loss on app restart frustrates users | Medium | Medium | On startup, any orphaned workers are killed. The chat view shows a soft notice when a message references a `job_id` that no longer exists. |
| Phase 3 scope creep (durable jobs, cross-device sync) | High | High | Non-Goals explicitly forbid durable persistence in v1. A follow-up PRD will handle persistence if needed. |

## Open Questions

1. **Should async jobs survive app restart?** v1 says no. Decide before v2 whether persistence is worth a new entity + migration.
2. **Should the model auto-cancel stale jobs on conversation switch?** Probably yes, but the conversation-switch hook is not in scope here.
3. **What is the right default concurrent-job cap?** 4 is a placeholder based on current `maxConcurrent: 2` per tool class. Needs validation against real hardware.
4. **Should `cancel_tool_job` require user confirmation?** It is reversible only by re-running the scrape, but cheap to re-run. Lean toward no confirmation in v1.

## Out of Scope (Explicit)

- Warming a browser pool to cut Maps scrape time.
- Replacing Puppeteer with Playwright.
- Substituting Google Places API for Google Maps scraping.
- Changes to the rate-limiter configuration.
- New UI components for job management (progress events reuse existing tool-state rendering).
- Durable cross-conversation job persistence.
- Team/shared job visibility.

## Phasing Summary

| Phase | Ships | Depends On | Risk |
|---|---|---|---|
| Phase 1: Per-tool-class timeouts | First | — | Low. Small, surgical change to `executeToolWithTimeout`. |
| Phase 2: Progress + partial results | With Phase 1 | Phase 1 (result-shape contract) | Medium. Requires worker-side progress emission, which touches Maps/Yandex/contact modules. |
| Phase 3: Async job pattern | After Phases 1–2 stabilize | Phase 1 (timeout table), Phase 2 (progress channel) | Higher. New tool, new registry, lifecycle edge cases. Worth a separate technical design doc. |

## References

- Current timeout implementation: `src/service/AIChatQueryLoop.ts:48`, `:809`
- Tool dispatch: `src/service/ToolExecutor.ts:1224` (`executeMapsSearch`)
- Tool registry: `src/config/skillsRegistry.ts:255` (`search_maps_businesses`)
- Rate limiter config: `src/service/ToolExecutor.ts:34`
- Existing async-shaped tool (precedent): `extract_contact_info` and its child-process worker in `src/childprocess/contact-extraction/`
- Project conventions: `CLAUDE.md` sections on three-layer DB access and worker-process IPC rules
