# Technical Design: AI Tool Call Timeout Resilience

**Date:** 2026-06-25
**Status:** Draft
**PRD:** [2026-06-25-ai-tool-timeout-resilience-prd.md](2026-06-25-ai-tool-timeout-resilience-prd.md)

**Related files:**

- `src/service/AIChatQueryLoop.ts` — agent loop, `executeToolWithTimeout`
- `src/service/AIChatQueryEvents.ts` — event sink and event union types
- `src/service/ToolExecutor.ts` — static `execute`, rate limiter config
- `src/config/skillsRegistry.ts` — tool registry (`SkillDefinition[]`)
- `src/entityTypes/skillTypes.ts` — `SkillDefinition`, `SkillExecutionContext`
- `src/modules/GoogleMapsModule.ts`, `src/modules/YandexMapsModule.ts` — maps workers
- `src/main-process/communication/ai-chat-v2-ipc.ts` — IPC entry, AI-enable gate

## Design Intent

Make slow browser-automation tools (`search_maps_businesses`, `extract_contact_info`, `search_yellow_pages`) reliable in `ai-chat-v2`, while keeping fast tools snappy and the agent loop responsive.

The design adds three coordinated capabilities, mirroring the PRD's three phases:

1. **Per-tool-class timeouts** replace the global `CHAT_V2_TOOL_TIMEOUT_MS = 90_000` ceiling.
2. **Progress events + partial results** flow through the existing event sink and reshape timeouts from total failures into degraded successes.
3. **Async jobs** move multi-minute tools off the synchronous tool-call path onto an enqueue-and-poll model.

The reference architecture is AiFetchly's existing worker pattern in `extract_contact_info` (`src/childprocess/contact-extraction/`): a main-process coordinator spawns workers, workers stream progress via IPC, the coordinator owns the database. The async-job design generalizes that pattern.

## Current State

### Tool call flow

```text
AIChatQueryLoop.runRound()
  → for each tool_call in assistant stream:
      → executeToolWithTimeout(input, call)          // AIChatQueryLoop.ts:809
          → Promise.race([
              deps.executeTool(name, args, ctx),     //→ ToolExecutor.execute(name, args, conversationId)
              setTimeout(90s) → { timedOut: true }
            ])
      → emit "tool_result" event                     // AIChatQueryEvents.ts:62
      → push { role:"tool", tool_call_id, content } into messages[]
```

### Key constants and shapes (today)

- `CHAT_V2_TOOL_TIMEOUT_MS = 90_000` — single global constant, `AIChatQueryLoop.ts:48`.
- `executeToolWithTimeout` — `AIChatQueryLoop.ts:809-849`. Uses `Promise.race`. On timeout, resolves `{ success: false, result: { error, timedOut: true } }`. The underlying promise is **not** cancelled.
- `ToolExecutionResult` (defined in `@/api/aiChatApi`) — currently `{ tool_call_id, tool_name, success, result, execution_time_ms }`. No `partial` flag.
- `SkillDefinition` (`src/entityTypes/skillTypes.ts:70`) — has `tier`, `requiresConfirmation`, `permissionCategory`, `source`, `execute`. No timeout class, no async flag, no progress channel.
- `SkillExecutionContext` (`src/entityTypes/skillTypes.ts:123`) — has `conversationId`, `toolCallId`, `args`. No progress sink.
- `AIChatQueryEvent` union (`src/service/AIChatQueryEvents.ts:143`) — discriminants include `tool_call`, `tool_result`, `retry_connect`, etc. No `tool_progress` discriminant.
- Rate limiter config (`src/service/ToolExecutor.ts:34`) — per-tool-class `maxPerMinute`, `maxConcurrent`, `cooldownMs`. `mapsBusiness` already has its own entry. The limiter is orthogonal to timeouts and is **not** changed by this design.

### What's wrong

1. 90s is too short for browser tools, too long for hung fast tools.
2. The race discards the tool's partial output on timeout.
3. The model and the user see nothing during a 90s wait.
4. Multi-minute scraping has no synchronous ceiling that wouldn't also degrade fast tools.

## Architecture

### After all three phases

```text
Renderer
  │
  ▼
ai-chat-v2-ipc.ts
  │  AI gate (USER_AI_ENABLED), validation, event mapping
  ▼
AIChatQueryEngine
  │  conversation lifecycle, persistence
  ▼
AIChatQueryLoop
  │  per-round tool-call driver
  │
  ├──▶ executeToolWithTimeout(call)
  │      │
  │      │  resolve class via ToolTimeoutPolicy:
  │      │     fast=30s | network=90s | browser=240s | async=∞
  │      │
  │      ├── class=fast|network|browser  →  sync path
  │      │     ▼
  │      │   ToolExecutor.execute(name, args, ctx)
  │      │     │  ctx now carries progressSink (Phase 2)
  │      │     ▼
  │      │   Module / worker (emits progress via progressSink)
  │      │     │
  │      │     ▼
  │      │   on timeout: request partial result from module (Phase 2)
  │      │
  │      └── class=async  →  async path (Phase 3)
  │            ▼
  │          ToolJobRegistry.start(name, args, ctx)
  │            │  spawns worker, assigns job_id, returns within 2s
  │            ▼
  │          returns { async: true, job_id } as ToolExecutionResult
  │
  ├──▶ companion tools (Phase 3)
  │      ├── check_tool_job_status(job_id)
  │      └── cancel_tool_job(job_id)
  │
  ▼
eventSink.emit(tool_call | tool_progress | tool_result)
```

### Design principles

1. **Opt-in, never default.** Async and partial-result capabilities are declared per skill. Existing tools keep their current behavior unless explicitly upgraded.
2. **No new persistence.** Jobs live in memory in v1. Workers keep obeying the existing no-direct-DB rule.
3. **Single timeout race code path.** Phases 1–3 all flow through `executeToolWithTimeout`. We do not fork the loop.
4. **Backwards-compatible shapes.** Existing fields stay; new fields are optional. Old tools keep working without registry edits.
5. **No new dependencies.** Pure TypeScript on existing runtime primitives.

## Phase 1: Per-Tool-class Timeouts

### Data model

#### 1.1 `ToolTimeoutClass` (new union type)

File: `src/entityTypes/skillTypes.ts` (or a new `src/service/ToolTimeoutPolicy.ts`).

```ts
export type ToolTimeoutClass = "fast" | "network" | "browser" | "async";
```

#### 1.2 `ToolTimeoutPolicy` (new)

```ts
export interface ToolTimeoutPolicyConfig {
  readonly fast: number;     // default 30_000
  readonly network: number;  // default 90_000
  readonly browser: number;  // default 240_000
  // "async" has no synchronous ceiling
}

export const TOOL_TIMEOUT_POLICY: ToolTimeoutPolicyConfig = {
  fast: 30_000,
  network: 90_000,
  browser: 240_000,
};

export function resolveTimeoutMs(
  cls: ToolTimeoutClass,
  policy: ToolTimeoutPolicyConfig = TOOL_TIMEOUT_POLICY
): number | null {
  if (cls === "async") return null;
  return policy[cls];
}
```

#### 1.3 Extend `SkillDefinition`

Add an optional timeout-class declaration. Both a static value and an argument-driven resolver are supported.

```ts
export interface SkillDefinition {
  // ... existing fields ...

  /**
   * Timeout class for this tool. If absent, the runtime infers a default
   * from the tool name (file tools → "fast", network tools → "network",
   * browser tools → "browser"). Explicit declaration is preferred.
   */
  readonly timeoutClass?: ToolTimeoutClass;

  /**
   * Dynamic timeout-class resolver. When present, overrides `timeoutClass`
   * based on the actual call arguments. Used to route heavy argument
   * combinations (e.g. high max_results + include_website) to the async path.
   */
  readonly resolveTimeoutClass?: (
    args: Record<string, unknown>
  ) => ToolTimeoutClass;
}
```

#### 1.4 Backwards-compatible default resolver

A fallback function classifies tools by name when `timeoutClass` is absent, so the registry can be migrated incrementally. Example mapping (matches the PRD's table):

```ts
export function inferTimeoutClassByName(name: string): ToolTimeoutClass {
  if (
    name.startsWith("file_") ||
    name === "glob_files" ||
    name === "grep_files" ||
    name === "read_url_content"
  ) {
    return "fast";
  }
  if (
    name === "search_maps_businesses" ||
    name === "extract_contact_info"
  ) {
    return "browser";
  }
  if (
    name === "analyze_website" ||
    name === "search_yellow_pages"
  ) {
    return "network";
  }
  return "fast";
}
```

### Code changes

#### `AIChatQueryLoop.executeToolWithTimeout`

The function currently uses the constant `CHAT_V2_TOOL_TIMEOUT_MS` directly. Replace with a policy lookup:

```ts
// Pseudocode — actual code is TypeScript, exact lines preserved.
const skill = input.skillRegistry?.get(call.name);
const cls = skill?.resolveTimeoutClass?.(call.arguments ?? {})
  ?? skill?.timeoutClass
  ?? inferTimeoutClassByName(call.name);
const timeoutMs = resolveTimeoutMs(cls);

if (timeoutMs === null) {
  // async path — Phase 3. Phase 1 falls back to browser/network ceiling
  // so the loop still terminates if Phase 3 is not yet shipped.
  return await this.executeAsyncTool(input, call);
}
// ... existing Promise.race with timeoutMs instead of CHAT_V2_TOOL_TIMEOUT_MS
```

The existing constant `CHAT_V2_TOOL_TIMEOUT_MS` is kept as the value of the `network` class for back-compat, but is no longer used directly by the race.

#### `skillsRegistry.ts`

Add `timeoutClass` (or `resolveTimeoutClass`) to each entry. Phase 1 only needs the four browser/network tools annotated; the default resolver handles the rest.

Example declaration for `search_maps_businesses`:

```ts
{
  name: "search_maps_businesses",
  // ... existing fields ...
  timeoutClass: "browser",
  // (Phase 3 will replace this with resolveTimeoutClass that returns "async"
  //  for max_results > 20 or include_website: true.)
}
```

### Phase 1 invariants

- The race code has exactly **one** place that reads the ceiling.
- Adding a new slow tool requires only a `timeoutClass` line in the registry.
- Fast tools' P95 latency is unaffected (lookup is O(1), no I/O).

### Phase 1 test plan

- **Unit:** `inferTimeoutClassByName` table; `resolveTimeoutMs` returns null for `async`.
- **Unit:** `executeToolWithTimeout` uses the right ceiling given a mock skill with each class.
- **Integration:** `file_read` against a hung target still fails within 30s.
- **Integration:** `search_maps_businesses` with `max_results: 5, include_website: false` completes without timeout under normal conditions.
- **Regression:** existing tool tests in `test/vitest/main/service/` pass unchanged.

## Phase 2: Streaming Progress and Partial Results

### Data model

#### 2.1 New event: `tool_progress`

Add to `AIChatQueryEvents.ts`:

```ts
export interface AIChatQueryToolProgressEvent {
  type: "tool_progress";
  conversationId: string;
  messageId: string;
  toolCallId: string;
  toolName: string;
  phase:
    | "queued"
    | "running"
    | "fetching"
    | "extracting"
    | "finalizing";
  message: string;            // i18n key or fallback English string
  progress: number | null;    // 0..1 or null when indeterminate
  partialCount: number | null;
  expectedCount: number | null;
  timestamp: number;
}
```

Extend the `AIChatQueryEvent` union (`AIChatQueryEvents.ts:143`) to include it. The chat view already renders `tool_call` / `tool_result`; it will receive a new event variant. Frontend rendering changes are minor and reuse the existing tool-state channel — out of scope for this design beyond the event contract.

#### 2.2 Progress sink on `SkillExecutionContext`

```ts
export interface SkillExecutionContext {
  // ... existing fields ...

  /** Emits a progress event for this tool call. No-op if absent. */
  readonly emitProgress?: (event: {
    phase: "queued" | "running" | "fetching" | "extracting" | "finalizing";
    message: string;
    progress?: number | null;
    partialCount?: number | null;
    expectedCount?: number | null;
  }) => void;
}
```

`ToolExecutor.execute` constructs the context and wires `emitProgress` to `eventSink.emit({ type: "tool_progress", ... })` via a closure capturing `conversationId`, `messageId`, `toolCallId`.

#### 2.3 `ToolExecutionResult` extension

```ts
export interface ToolExecutionResult {
  // ... existing fields ...
  readonly partial?: boolean;
  readonly collectedCount?: number;
  readonly expectedCount?: number;
  readonly timedOutAfterMs?: number;
}
```

All new fields are optional. Tools that don't support partial results are unchanged.

#### 2.4 Partial-result capability on `SkillDefinition`

```ts
export interface SkillDefinition {
  // ... existing fields ...

  /**
   * When true, the runtime may request whatever partial data the tool has
   * collected when the timeout fires. The tool's execute() must return
   * promptly when its cancellation signal is set.
   */
  readonly supportsPartialResult?: boolean;
}
```

### Code changes

#### Worker → module → executor → loop

Progress is produced at the worker (Puppeteer scrape loop) and propagated up:

1. **Worker** emits IPC messages: `{ type: "progress", phase, message, partialCount, expectedCount }`.
2. **Module** (`GoogleMapsModule`, `YandexMapsModule`, `ContactExtractionModule`) attaches a listener on `child.on("message")` and calls the `emitProgress` callback passed in by the executor.
3. **ToolExecutor.execute** builds `emitProgress` as a closure over the event sink.
4. **Loop** does nothing special on progress events — they go straight to the renderer. Progress does **not** extend the timeout; it only improves visibility.

#### Partial result on timeout

`executeToolWithTimeout` is extended. When the timeout fires and the skill declares `supportsPartialResult: true`:

```ts
// Pseudocode for the timeout branch.
if (skill?.supportsPartialResult) {
  const snapshot = await ToolExecutor.requestPartialSnapshot(call.id);
  if (snapshot) {
    return {
      tool_call_id: call.id,
      tool_name: call.name,
      success: true,
      partial: true,
      result: snapshot.data,
      collectedCount: snapshot.collectedCount,
      expectedCount: snapshot.expectedCount,
      timedOutAfterMs: timeoutMs,
      execution_time_ms: timeoutMs,
    };
  }
}
// fall through to existing { success: false, timedOut: true } shape
```

#### `ToolExecutor.requestPartialSnapshot(toolCallId)`

New static method. Maintains a `Map<toolCallId, PartialSnapshotEmitter>` populated when a supporting tool starts. Calling it asks the active module to return its current in-memory result buffer within 2 seconds (best-effort). If the module doesn't respond, the snapshot is `null` and the loop falls back to the existing timeout error shape.

The cancellation protocol is shared with Phase 3's job-cancellation infrastructure (see §3.5).

#### Module-side support

For `search_maps_businesses`, the Maps modules expose:

- A `progress` callback the worker can call as it accumulates businesses.
- A `cancelAndCollect()` method that signals the worker to stop scraping and immediately emit a final `result` message with whatever it has. The module's `execute()` resolves with that final payload.

Other supporting tools (`extract_contact_info`, `search_yellow_pages`, `analyze_website`) follow the same shape. The worker IPC contract already supports arbitrary `{ type, ... }` messages, so no wire-protocol change is needed — only a new message type `progress` and a new request type `collect_and_cancel`.

### Phase 2 invariants

- Tools that don't opt in pay zero cost: `emitProgress` is `undefined`, the partial-result branch is skipped.
- The model always sees a structured `partial: true` flag; it must include this in its user-facing summary so partial data is not presented as complete.
- Progress events never block the agent loop.

### Phase 2 test plan

- **Unit:** `emitProgress` closures route to the correct `conversationId`/`toolCallId`.
- **Unit:** On timeout with `supportsPartialResult: true`, the loop returns `partial: true` with whatever the mock module returned from `requestPartialSnapshot`.
- **Unit:** On timeout without `supportsPartialResult`, behavior is unchanged from Phase 1.
- **Integration:** a mocked Maps worker emits 3 progress events; the renderer-side test harness receives them in order.
- **i18n:** progress `message` strings resolve through the existing i18n pipeline (`src/views/lang/*.ts`) for all six languages.

## Phase 3: Async Job Pattern

### Data model

#### 3.1 `ToolJobRegistry` (new, in-memory, main-process only)

File: `src/service/ToolJobRegistry.ts`.

```ts
export type ToolJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "not_found";

export interface ToolJobProgress {
  readonly phase: ToolProgressPhase;
  readonly message: string;
  readonly progress: number | null;
  readonly partialCount: number | null;
  readonly expectedCount: number | null;
}

export interface ToolJobSnapshot {
  readonly jobId: string;
  readonly toolName: string;
  readonly conversationId: string;
  readonly status: ToolJobStatus;
  readonly progress: ToolJobProgress | null;
  readonly partial: { data: unknown; collectedCount: number; expectedCount: number } | null;
  readonly result: unknown;
  readonly error: string | null;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly completedAt: number | null;
}

export interface ToolJobLimits {
  readonly maxConcurrent: number;   // default 4
  readonly staleAfterMs: number;    // default 5 * 60_000
  readonly pollMinIntervalMs: number; // default 5_000, rate-limit on polling
}

class ToolJobRegistry {
  start(
    toolName: string,
    args: Record<string, unknown>,
    ctx: SkillExecutionContext,
    spawn: (handle: JobHandle) => Promise<unknown>
  ): { jobId: string; queued: boolean };
  getStatus(jobId: string): ToolJobSnapshot;
  getPartial(jobId: string): ToolJobSnapshot["partial"];
  cancel(jobId: string): { cancelled: boolean; reason?: string };
  evictStale(): number;
  // ... internal maps, timers, sweeper ...
}
```

The registry is a singleton in the main process. It holds:

- `jobs: Map<string, InternalJob>` keyed by `jobId` (UUID v4).
- `running: number` and a FIFO queue for overflow.
- A background sweeper (setInterval 60s) that evicts `staleAfterMs`-old terminal or abandoned jobs.
- A child-process handle per running job, used by `cancel()`.

The registry **does not** touch the database. On app shutdown, the main process terminates all running workers (best-effort) and discards the map.

#### 3.2 Async execution contract

A skill declares async capability statically or dynamically:

```ts
export interface SkillDefinition {
  // ... existing fields ...

  /** When true (or when resolveAsync returns true), the tool runs async. */
  readonly async?: boolean;
  readonly resolveAsync?: (args: Record<string, unknown>) => boolean;
}
```

Example for `search_maps_businesses` (replaces the Phase 1 static `timeoutClass`):

```ts
{
  name: "search_maps_businesses",
  // ...
  resolveTimeoutClass: (args) =>
    (args.max_results as number) > 20 || args.include_website === true
      ? "async"
      : "browser",
  resolveAsync: (args) =>
    (args.max_results as number) > 20 || args.include_website === true,
  supportsPartialResult: true,
}
```

When `resolveTimeoutClass` returns `"async"`, `executeToolWithTimeout` dispatches to the async path.

### Async path execution flow

```text
executeToolWithTimeout(call)
  → cls = "async"
  → executeAsyncTool(input, call)
      │
      │ 1. AI-enable gate (USER_AI_ENABLED) — already enforced at IPC layer,
      │    re-checked here for safety.
      │ 2. rate-limit via existing mapsBusiness limiter.
      │ 3. registry.start(toolName, args, ctx, spawn)
      │     - spawns the same worker modules used by sync Maps/contact tools
      │     - wires worker IPC → registry progress/partial updates
      │
      │ 4. return within 2s with ToolExecutionResult:
      │     {
      │       success: true,
      │       result: { async: true, job_id, status: "running"|"queued" },
      │       execution_time_ms: <elapsed>
      │     }
      │
      └─ loop pushes { role:"tool", tool_call_id, content: JSON } into messages[]
         → model sees: "Tool started async. job_id=<uuid>. Poll with check_tool_job_status."
```

### New companion tools

#### 3.3 `check_tool_job_status`

Registered in `skillsRegistry.ts`. Synchronous, fast, `timeoutClass: "fast"`, no AI-enable gate (read-only).

Parameters:

```json
{
  "type": "object",
  "properties": {
    "job_id": { "type": "string" },
    "return_partial_if_running": { "type": "boolean", "default": false }
  },
  "required": ["job_id"]
}
```

Returns a snapshot:

```json
{
  "status": "running",
  "progress": { "phase": "extracting", "message": "Found 18 of 50 businesses", "progress": 0.36, "partialCount": 18, "expectedCount": 50 },
  "partial": null,
  "started_at": 1734900000000
}
```

On terminal status, returns `{ status: "completed", result: ... }`, `{ status: "failed", error: ... }`, etc. After a terminal status the registry retains the snapshot for `staleAfterMs` so the model can do a final poll.

The tool is rate-limited per `job_id`: minimum `pollMinIntervalMs` between polls. Polling faster returns `{ status: "rate_limited", retry_after_ms: ... }` (a soft signal, not an error).

#### 3.4 `cancel_tool_job`

Parameters: `{ job_id: string }`. Returns `{ cancelled: true }` or `{ cancelled: false, reason: "already_completed" | "not_found" }`.

Cancellation uses `tree-kill` (already available via existing worker-process utilities in `src/childprocess/`) to terminate the worker's process group, then frees the slot. The slot is reused by the next queued job.

No `requiresConfirmation` — cheap to re-run.

### Worker reuse

The async path uses the **same** worker modules as sync Maps/contact execution (`GoogleMapsModule`, `YandexMapsModule`, `ContactExtractionModule`). The only difference is how the orchestrator (loop vs. registry) consumes the result:

- Sync path: `await module.executeSearch(...)` blocks until terminal.
- Async path: `registry.start(...)` calls `module.executeSearch(...)` in the background, returns the `job_id` immediately.

This means worker-side changes (progress emission, `collect_and_cancel` IPC) implemented in Phase 2 are reused unchanged in Phase 3.

### Cancellation

`cancel(jobId)` flow:

1. Look up the internal job. If terminal or missing, return `cancelled: false` with reason.
2. Send the worker an IPC `{ type: "collect_and_cancel" }`. The worker emits one final `{ type: "result", partial: true, data, collectedCount, expectedCount }` message if it can, then exits.
3. After a 2-second grace period, `tree-kill` the process group.
4. Mark the job `status: "cancelled"`, retain for `staleAfterMs`.

A periodic sweeper (60s interval) kills any worker whose job object has gone missing (defensive cleanup for orphaned processes after crashes).

### Concurrency and limits

- `maxConcurrent: 4` default. Overflow jobs return `status: "queued"` from `check_tool_job_status` until a slot frees.
- The existing `RateLimiterManager` (per tool class) is **not** bypassed. Async tools still flow through it; the registry sits downstream.
- `pollMinIntervalMs: 5_000` per `job_id` to prevent tight-loop polling.

### App shutdown

On `app.before-quit`, the registry:

1. Marks all running jobs `status: "cancelled"`, reason `"app_shutdown"`.
2. `tree-kill`s every worker.
3. Discards the in-memory map.

On next launch, polls referencing old `job_id` values return `{ status: "not_found" }`. The chat view can render a soft notice when it sees a `not_found` poll response referencing a `job_id` from a prior message.

### Phase 3 invariants

- The agent loop is **never** blocked on a worker for async tools. The synchronous `executeTool` resolves within 2s.
- Worker processes obey all existing rules: no direct DB, IPC-only communication with main.
- All async state is in-memory. Restart loses jobs; this is documented and accepted in v1.
- AI-enable gate is enforced at job creation (not at poll).

### Phase 3 test plan

- **Unit:** `ToolJobRegistry.start` returns within 2s for a mocked long-running spawn.
- **Unit:** `check_tool_job_status` transitions through `queued → running → completed` correctly.
- **Unit:** Rate-limiter rejects polls tighter than `pollMinIntervalMs`.
- **Unit:** `cancel` with a running job invokes `tree-kill` and frees the slot.
- **Integration:** `search_maps_businesses` with `max_results: 50, include_website: true` returns a `job_id` synchronously; polling eventually returns `completed` with 50 results.
- **Integration:** cancelling a 30s scrape terminates the worker within 5s.
- **Stress:** 6 concurrent async jobs — 4 run, 2 queue, all eventually complete or cancel cleanly.
- **Shutdown:** quitting the app with 2 running jobs terminates both within 3s; restart shows `not_found` on the old ids.

## Cross-cutting concerns

### Observability

All phases log through the existing `DEBUG='module:*'` channel. Key events:

- `tool_timeout_class_resolved` (debug) — tool, args-shape, resolved class.
- `tool_progress_emitted` (debug) — tool, phase, counts.
- `tool_partial_returned` (info) — tool, collected/expected, ms.
- `tool_job_started` / `tool_job_completed` / `tool_job_cancelled` (info) — `jobId`, tool, duration.
- `tool_job_evicted_stale` (warn) — `jobId`, age.
- `tool_job_orphan_killed` (error) — worker pid that was killed without a matching job.

No new telemetry surface; these log lines are greppable and feed into the PRD's success metrics.

### i18n

- Progress messages and partial-result notices use i18n keys added to all six language files (`src/views/lang/{en,zh,es,fr,de,ja}.ts`).
- Tool descriptions for `check_tool_job_status` and `cancel_tool_job` are model-facing and stay in English (matching the existing registry convention).
- Async "job started" notices surfaced to the user are translated.

### Security

- **AI-enable gate.** `executeAsyncTool` re-checks `USER_AI_ENABLED` before calling `registry.start`, mirroring the IPC-layer gate.
- **Conversation scoping.** A `jobId` is scoped to the conversation that created it. `check_tool_job_status` and `cancel_tool_job` validate `conversationId` matches; cross-conversation access returns `not_found`.
- **Argument validation.** Async tools use the same JSON-schema validation as sync tools (existing registry behavior). No new attack surface.
- **Resource exhaustion.** `maxConcurrent: 4` plus the existing rate limiter bounds worker count. A single user cannot spawn unbounded browsers.
- **No secrets in job state.** The registry stores tool args and results only in memory; it never persists credentials.

### Database

No schema changes. No new entities. Workers continue to access SQLite only via main-process IPC through Model/Module classes. This explicitly satisfies the PRD's no-persistence non-goal and the project's three-layer DB rule.

### Performance

- Phase 1 lookup: O(1) map read, <1ms added to dispatch.
- Phase 2 progress emission: only when the tool calls `emitProgress`; fast tools never call it.
- Phase 3 dispatch: 2s ceiling on the sync return path; the actual scrape runs in a worker process and does not occupy the agent loop thread.
- No regression to fast-tool latency (verified by the Phase 1 regression test).

### Error handling

| Scenario | Behavior |
|---|---|
| Async tool fails to spawn worker | Registry returns `{ status: "failed", error }` synchronously through the 2s path; model sees failure immediately. |
| Worker crashes mid-job | `exit` handler on child process sets job `failed` with last known error; `check_tool_job_status` returns `failed`. |
| Poll on unknown `job_id` | Returns `{ status: "not_found" }` — soft signal so the model can recover. |
| Cancel on terminal job | Returns `{ cancelled: false, reason: "already_completed" }`. |
| Partial-snapshot request times out | Loop falls back to existing `timedOut: true` error shape. |
| Registry at `maxConcurrent` | New job goes to queue; `check_tool_job_status` returns `status: "queued"`. |
| App shutdown mid-job | Workers killed; jobs marked `cancelled` reason `app_shutdown`; map discarded. |

## Migration and rollout

### Phase 1 (low risk)

- Land `ToolTimeoutPolicy`, `inferTimeoutClassByName`, registry annotations for `search_maps_businesses`, `search_yellow_pages`, `extract_contact_info`, `analyze_website`.
- Update `executeToolWithTimeout` to read the policy.
- No behavior change for tools without a declared class.

### Phase 2 (medium risk)

- Land `tool_progress` event, `emitProgress` on context, partial-result fields on `ToolExecutionResult`, `supportsPartialResult` on `SkillDefinition`.
- Update Maps/Yandex/contact modules to emit progress and respond to `collect_and_cancel`.
- Annotate the four supporting tools with `supportsPartialResult: true`.
- Update i18n files with new keys.

### Phase 3 (higher risk)

- Land `ToolJobRegistry`, async execution branch in `executeToolWithTimeout`.
- Add `check_tool_job_status` and `cancel_tool_job` to the registry.
- Switch `search_maps_businesses` to use `resolveTimeoutClass` / `resolveAsync`.
- Land sweeper, shutdown handler, and tree-kill integration.

Each phase ships behind the previous one's stable contract. Phase 3 can be feature-flagged (a single config switch in `usersetting`) if early rollouts surface stability issues.

## Test strategy summary

| Layer | Tests |
|---|---|
| Unit | `ToolTimeoutPolicy`, `inferTimeoutClassByName`, `ToolJobRegistry` lifecycle, partial-snapshot fallback, poll rate-limit |
| Service | `executeToolWithTimeout` across all four classes; async dispatch returns within 2s |
| Integration | Maps scrape end-to-end with progress events; cancel terminates worker; concurrent job cap |
| Regression | Existing `test/vitest/main/service/ToolExecutorYandex.test.ts` and related pass unchanged |
| i18n | Progress/partial-result strings resolve in all six languages |
| Manual | Run a real Maps scrape at `max_results: 50, include_website: true` and observe job lifecycle |

Test placement follows the project convention:

- `test/modules/ToolTimeoutPolicy.test.ts`
- `test/modules/ToolJobRegistry.test.ts`
- `test/vitest/main/service/AIChatQueryLoopTimeout.test.ts`
- `test/vitest/main/service/ToolExecutorAsync.test.ts`

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `collect_and_cancel` worker IPC unimplemented for some modules | Phase 2 explicitly scopes which tools opt into `supportsPartialResult`. Tools without it skip partial handling. |
| Worker doesn't honor `tree-kill` (rare on Windows) | Grace period + process-group kill + periodic orphan sweeper. |
| Model abandons async job (never polls again) | Registry auto-evicts after `staleAfterMs`. Telemetry tracks abandonment rate. |
| Conversation-scope check breaks resume-after-restart | Scope check uses `conversationId` only; jobs are already lost on restart, so cross-conversation access is impossible by construction. |
| Phase 1 regression on fast tools | Resolution is a pure function; covered by a regression test in CI. |
| Memory bloat from retaining terminal snapshots | Snapshots evicted after `staleAfterMs` (5 min) and on shutdown. |
| User confusion: "tool still running" looks frozen | Mandatory progress emission for async tools; chat-view "running" indicator (existing UI). |

## Open questions

1. Should `check_tool_job_status` be auto-injected into the next model turn when a job transitions to terminal? (Currently the model polls.) Decision: no — keep polling explicit so the model controls cadence.
2. Should the registry persist a "last known status" snapshot to disk on shutdown so restart can recover? v1 says no; revisit if users complain.
3. Should `cancel_tool_job` accept multiple `job_id`s in one call? Probably yes for cleanup UX; defer to v1.1.
4. Default `maxConcurrent: 4` — validate against real hardware before locking in.

## Appendix: File-by-file change list

### Phase 1
- `src/service/ToolTimeoutPolicy.ts` (new) — types, policy, `inferTimeoutClassByName`, `resolveTimeoutMs`.
- `src/entityTypes/skillTypes.ts` — extend `SkillDefinition` with `timeoutClass`, `resolveTimeoutClass`.
- `src/service/AIChatQueryLoop.ts` — replace constant usage in `executeToolWithTimeout`.
- `src/config/skillsRegistry.ts` — annotate the four browser/network tools.
- `test/modules/ToolTimeoutPolicy.test.ts` (new).

### Phase 2
- `src/service/AIChatQueryEvents.ts` — add `AIChatQueryToolProgressEvent`, extend union.
- `src/entityTypes/skillTypes.ts` — extend `SkillExecutionContext` with `emitProgress`; `SkillDefinition` with `supportsPartialResult`.
- `src/api/aiChatApi.ts` — extend `ToolExecutionResult` with partial fields.
- `src/service/ToolExecutor.ts` — wire `emitProgress`, add `requestPartialSnapshot`.
- `src/service/AIChatQueryLoop.ts` — partial-result branch in `executeToolWithTimeout`.
- `src/modules/GoogleMapsModule.ts`, `YandexMapsModule.ts`, `ContactInfoModule.ts`, `WebsiteAnalyzerModule.ts` — emit progress, handle `collect_and_cancel`.
- `src/views/lang/{en,zh,es,fr,de,ja}.ts` — new i18n keys.
- `test/vitest/main/service/AIChatQueryLoopTimeout.test.ts` (new).

### Phase 3
- `src/service/ToolJobRegistry.ts` (new).
- `src/entityTypes/skillTypes.ts` — extend `SkillDefinition` with `async`, `resolveAsync`.
- `src/service/AIChatQueryLoop.ts` — async dispatch branch.
- `src/config/skillsRegistry.ts` — add `check_tool_job_status`, `cancel_tool_job`; switch `search_maps_businesses` to `resolveTimeoutClass` / `resolveAsync`.
- `src/background.ts` — registry shutdown hook.
- `test/modules/ToolJobRegistry.test.ts`, `test/vitest/main/service/ToolExecutorAsync.test.ts` (new).
