# AI Chat V2 Seven-Layer Recovery Strategy — Implementation Plan

## Context

The AI Chat V2 stack (`ai-chat-v2-ipc.ts` → `AIChatQueryEngine` → `AIChatQueryLoop` → `AiChatApi`) currently handles failures inconsistently: only Layer-1-style connection retry exists (fixed 3 attempts, deterministic 1s/2s/4s backoff, no jitter, no `Retry-After`, no typed errors). Transient overloads, output truncation, context overflow, model unavailability, and long rate-limit windows surface as user-facing failures requiring manual retry.

`docs/prd/ai-chat-seven-layer-recovery-strategy.md` and `docs/prd/ai-chat-seven-layer-recovery-technical-design.md` specify a seven-layer recovery strategy (three rollout phases). The user has asked for **all three phases** in one autonomous pass.

The architecture stays intact: IPC thin, engine owns turn state/persistence, loop owns model/tool recovery, API classifies transport failures, renderer displays status. Five new recovery service files plus targeted updates to existing surfaces.

Existing seams to reuse:
- `AiChatApi.openAIChatCompletionStream()` at `src/api/aiChatApi.ts:1881` and its `sleepWithAbort()` at `:2035`
- `AIChatQueryLoop.run()` outer catch at `src/service/AIChatQueryLoop.ts:868-888`
- `accumulator.state.finishReason` / `sawToolCallDelta` already tracked
- `currentMaxTokens` already doubled-on-truncation at `AIChatQueryLoop.ts:541` (will be replaced by structured output-token recovery)
- `consecutiveMalformedRounds` self-correction at `:491-512` (becomes part of Layer 3)
- `AIChatCompactAgentService.runFullCompact()` at `src/service/AIChatCompactAgentService.ts:291` and `enqueueSessionMemoryUpdate()` at `:85`
- `AIChatContextAssembler.assemble()` at `src/service/AIChatContextAssembler.ts:65`, token estimate at `:209`
- `AIChatQueryEngine.handleLoopResult()` completed case at `src/service/AIChatQueryEngine.ts:655-708` (where recovery metadata attaches to assistant row)
- `createEventSink()` switch at `src/main-process/communication/ai-chat-v2-ipc.ts:183` (add `recovery_status` case)
- `ChatV2StreamChunk` shape at `src/entityTypes/aiChatV2Types.ts:144`
- Renderer `retryInfo` at `src/views/components/aiChatV2/AiChatV2.vue:433`, chunk dispatch at `:1493-1562`, badge in `AiChatV2Messages.vue:36-55`

Existing recovery infra (`AIRecoveryExecutor`/`AIRecoveryBridge`/`AIRecoveryHandler` under `src/childprocess/` and `src/modules/`) is for **worker-process AI tasks**, unrelated to this V2 chat recovery work — leave it untouched.

---

## Scope (all three phases)

- **Phase 1** — Classified API retry + recovery events (Layers 1 & 2)
- **Phase 2** — Output-token + context recovery (Layers 3, 4, 5)
- **Phase 3** — Model fallback + persistent retry (Layers 6 & 7)

---

## New files (all under `src/service/`)

1. **`AIChatRecoveryTypes.ts`** — types, constants, `AIChatRecoverableError`, `AIChatRecoveryAttemptState`, `createRecoveryAttemptState()`, `logRecoveryEvent()`. No imports of `AiChatApi`/`Vue` (avoid cycles).
2. **`AIChatRecoveryClassifier.ts`** — pure `classifyThrown()`, `classifyHttpFailure()`, `classifyStreamFinish()`, `parseRetryAfter()`, `parseRateLimitReset()`. No service calls.
3. **`AIChatRetryPolicy.ts`** — constants `AI_CHAT_RECOVERY_DEFAULTS`, `AIChatRetryProfile`, `decide()`, `computeDelay()` with jitter, injectable random.
4. **`AIChatRecoveryCoordinator.ts`** — cross-layer orchestrator; returns `retry_model_call | fallback_model | fail`; records attempts in `AIChatRecoveryAttemptState.records`.
5. **`AIChatModelFallbackService.ts`** — `resolveFallback({originalModel, currentModel, reason})` → configured fallback map → server `default_model` → first different model from `listOpenAIModels()`.
6. **`AIChatContextRecoveryService.ts`** — drain + reactive compact; preserves tool-call/result atomic grouping.
7. **`AIChatModelCatalogService.ts`** — caches `/api/ai/v1/models`; exposes `getContextWindow(model?)` and `getMaxOutputTokens(model?)`; falls back to 128k default.
8. **`src/views/components/aiChatV2/AiChatV2RecoveryStatus.vue`** — compact inline badge receiving `recoveryInfo` prop.

---

## Phase 1 — Classified API retry + recovery events

### 1.1 `AIChatRecoveryTypes.ts`
Types per tech-design §4. `AIChatRecoveryLayer`, `AIChatRecoveryReason`, `AIChatRecoverableError` (extends `Error`), `AIChatRecoveryAttemptRecord`, `AIChatRecoveryAttemptState`, `createRecoveryAttemptState(model?)`, `logRecoveryEvent()` (redacts content).

### 1.2 `AIChatRecoveryClassifier.ts`
Pure class implementing rules in tech-design §5.3–5.4:
- HTTP table (401/403→auth, 402→quota, 408/409→timeout, 413→media_overflow vs context_overflow, 429→rate_limit, 404/410→model_unavailable, 529→overload, 5xx→server_error)
- Body patterns (`overloaded_error`, `Prompt Too Long`, `max_output_tokens`, `input length`+`context limit`)
- Thrown patterns (`AbortError`→cancelled, `ECONNRESET`/`EPIPE`/`fetch failed`→network, `ETIMEDOUT`→timeout)
- Stream finish (`length`/`max_tokens`→output_limit, `error`+empty→server_error, partial tool call→output_limit or non_recoverable)
- `parseRetryAfter(headers)` — seconds or HTTP-date; `parseRateLimitReset(headers)` — generic anthropic-ratelimit-unified-reset

### 1.3 `AIChatRetryPolicy.ts`
- `AI_CHAT_RECOVERY_DEFAULTS` constants (tech-design §6.1)
- `decide()` returns `{type:"retry"|"fallback"|"fail", ...}` based on profile, attempt, consecutive overload, hasFallback
- `computeDelay()` exponential + 25% jitter, capped by profile max, honoring `retryAfterMs`
- Non-retryable: auth, quota, cancelled, non_recoverable
- Constructor takes `random: () => number = Math.random` for deterministic tests
- Background profile caps at 1 retry; persistent profile uncapped up to 6h hard cap

### 1.4 `src/api/aiChatApi.ts` updates
Extend `openAIChatCompletionStream()` options with `retryProfile?: AIChatRetryProfile`, `onRecoveryStatus?: (info: StreamRecoveryInfo) => void`. Keep `onRetry` (legacy `retry_connect`) emitting in parallel.
- Replace fixed 3-attempt loop with `AIChatRetryPolicy`-driven loop using `AIChatRecoveryClassifier` for thrown errors and HTTP statuses.
- Read bounded error body (`readErrorBody()`, max 8000 chars).
- Emit `onRecoveryStatus` (Layer 1 `api_retry`, Layer 2 `overload_retry`) before each sleep.
- Track consecutive 529s; when foreground profile hits threshold (3), break out by throwing `AIChatRecoverableError` with `reason: overload` so the coordinator (Phase 3) can fallback.
- Throw typed `AIChatRecoverableError` (not bare `Error`) when exhausted.
- `retry_connect` (`onRetry`) stays emitted for backward compatibility.

### 1.5 `src/service/AIChatQueryEvents.ts`
Add `AIChatQueryRecoveryStatusEvent` (`type: "recovery_status"` + all fields from tech-design §4.4). Add to `AIChatQueryEvent` union.

### 1.6 `src/entityTypes/aiChatV2Types.ts`
Add `"recovery_status"` to `ChatV2StreamEventType`. Extend `ChatV2StreamChunk` with optional `recoveryLayer`, `recoveryReason`, `recoveryAttempt`, `recoveryMaxAttempts`, `recoveryDelayMs`, `recoveryElapsedMs`, `recoveryOriginalModel`, `recoveryCurrentModel`, `recoveryFallbackModel`, `recoveryMessage`. Extend `ChatV2MessageMetadata` with optional `recovery?: ChatV2RecoveryMetadata`.

### 1.7 `src/main-process/communication/ai-chat-v2-ipc.ts`
Add `case "recovery_status":` in `createEventSink()` (after `retry_connect` case ~line 219). Forwards as `ChatV2StreamChunk` with `eventType: "recovery_status"`. Pure event forwarding — no DB access.

### 1.8 `src/service/AIChatQueryLoop.ts`
Add `onRecoveryStatus` callback in the `streamChatCompletion` options block (~line 360) that re-emits through `eventSink` as `AIChatQueryRecoveryStatusEvent`. Update `AIChatQueryLoopDeps.streamChatCompletion` signature to accept the new options shape.

### 1.9 Renderer
- `src/views/components/aiChatV2/AiChatV2.vue`: add `recoveryInfo` ref. In chunk dispatch (~line 1520), handle `chunk.eventType === "recovery_status"` — set `recoveryInfo`, set `receivedFirstResponse = true`, keep `isStreaming = true`. Clear `recoveryInfo` on `token`/`tool_call`/`complete`/`cancelled`/`error`. Pass `recoveryInfo` to `<AiChatV2RecoveryStatus>`.
- New file `src/views/components/aiChatV2/AiChatV2RecoveryStatus.vue`: compact icon + label + (optional) attempt count + elapsed/stop hint. Uses `t('aiChatV2.recovery.<layer>')`.
- Keep `retryInfo`/`retry_connect` path unchanged for one release.

### 1.10 i18n — add `aiChatV2.recovery.{api_retry, overload_retry, output_token_recovery, reactive_compact, context_collapse_drain, model_fallback, persistent_retry, stop_hint}` to `src/views/lang/{en,zh,es,fr,de,ja}.ts`.

---

## Phase 2 — Output-token + context recovery (Layers 3, 4, 5)

### 2.1 `AIChatRecoveryCoordinator.ts`
Implements tech-design §9. `recover(input)` returns:
- `output_limit` → output-token recovery action (escalate then continue)
- `context_overflow`/`media_overflow` → context drain → reactive compact
- `overload`/`model_unavailable` → (Phase 3) model fallback when low-level retries exhausted
- `rate_limit` in persistent profile → persistent retry
- else → fail

Records every action in `state.records`.

### 2.2 `AIChatQueryLoop.ts` — Layer 3 (output-token recovery)
- After `deps.streamChatCompletion()` resolves, run `AIChatRecoveryClassifier.classifyStreamFinish()` on `accumulator.state`.
- Hold a `RecoveryAttemptState` (created once per `run()`).
- On `output_limit`:
  - **Stage 1** (if `!state.outputEscalationAttempted`): set flag, set `currentMaxTokens = min(modelMaxOutput ?? 65536, 65536)`, emit `recovery_status` (Layer 3), `continue` the round loop without persisting partial.
  - **Stage 2** (escalation already done, `state.outputContinuationCount < 3`): append non-persisted meta user message `"Output token limit hit. Continue directly from the cutoff..."`, increment counter, `continue`.
  - Else: throw user-safe error.
- Truncated tool-call JSON (`looksTruncatedJson()` helper) → Layer 3 path, never execute partial args.
- Existing `consecutiveMalformedRounds` self-correction (lines 491-512) folds into this layer as the malformed-arguments sub-case; the existing `currentMaxTokens *= 2` line at 541 is removed in favor of the structured escalation.
- **Withholding**: partial assistant content from a recoverable output-limit failure stays in `accumulator.state.fullContent` (in-memory) only. The loop must not emit a terminal `complete` event for withheld content — only the final consolidated content after recovery.

### 2.3 `AIChatContextRecoveryService.ts` + `AIChatContextAssembler.ts` — Layers 4 & 5
- New `AIChatContextBudgetPolicy` type (`contextWindowTokens`, `softThresholdRatio=0.9`, `hardThresholdRatio=0.95`, `reserveOutputTokens`).
- `AIChatModelCatalogService.getContextWindow(model)` resolves from `/api/ai/v1/models` (cache for process lifetime; fallback 128_000).
- `AIChatContextAssembler.assemble()` accepts optional `contextPolicy`. When estimated tokens ≥ soft threshold, collapse older tool-call/result groups into summary before the call; at hard threshold, force collapse.
- **Tool-call group atomicity**: build logical transcript groups (assistant tool_call + matching role=tool rows). Trim oldest groups first; never split a group.
- **Reactive compact** (on 413/context_overflow): `AIChatContextRecoveryService.recoverOverflow()`:
  1. If `!state.contextDrainAttempted`: try drain (drop to soft threshold).
  2. Else if `!state.reactiveCompactAttempted`: invoke `AIChatCompactAgentService.runFullCompact()` (reuse existing module) and retry once with reduced prompt.
  3. Else fail with context-too-large.
- Raw history rows never mutated; summaries stored separately via existing compact module.

### 2.4 Wire `AIChatQueryLoop` to call coordinator on `context_overflow`/`media_overflow` thrown from API (the API now throws `AIChatRecoverableError` with reason set). On retry action, rebuild messages via `AIChatContextAssembler` with the new policy and `continue`.

---

## Phase 3 — Model fallback (Layer 6) + persistent retry (Layer 7)

### 3.1 `AIChatModelFallbackService.ts`
`resolveFallback({originalModel, currentModel, reason})`:
1. Local fallback map (config constant in `AIChatRetryPolicy.ts`, empty by default).
2. Server `default_model` from cached `/api/ai/v1/models` response.
3. First model from `/models` whose id differs from `currentModel`.
Never returns the same model. Returns `undefined` if none found.

### 3.2 `AIChatQueryLoop.ts` — Layer 6
- Track `currentModel` separately from `input.request.model`.
- After Phase-1 API layer exhausts overload retries (throws `AIChatRecoverableError` reason=overload or model_unavailable), call coordinator → fallback action.
- On fallback: set `currentModel = fallbackModel`, `state.currentModel = fallbackModel`, discard failed accumulator, emit `recovery_status` (Layer 6) with `originalModel`/`currentModel`/`fallbackModel`, retry model call with **same messages** (tools results already appended stay; no tool replay).
- Never fall back while a tool is executing (guarded by the round structure).

### 3.3 Persistent retry (Layer 7)
- Opt-in via `ChatV2StreamRequest.recoveryMode?: "foreground" | "persistent"`. Engine may set persistent internally for approved plan execution.
- In `AIChatRetryPolicy`, persistent profile: max backoff `5 * 60_000` ms, hard cap `6 * 60 * 60_000` ms (6h), heartbeat every `30_000` ms.
- During long wait, emit `recovery_status` (Layer 7) with `elapsedMs` every heartbeat; keep `isStreaming=true`; Stop button aborts the wait through the same `AbortSignal`.
- After 6h, emit terminal `error`.

### 3.4 Persistence — `AIChatQueryEngine.handleLoopResult()` (lines 655-708)
On completed/cancelled, attach `recovery: ChatV2RecoveryMetadata { layersUsed, attempts, originalModel, finalModel, outputEscalated, outputContinuationCount, contextCompacted, contextDrained, fallbackModel }` to the assistant row metadata. Engine reads it from the loop result. Loop result type extended with `recoveryMetadata?`.

---

## Tests (TDD per global rule; 80%+ coverage target)

**New unit tests** under `test/vitest/main/service/`:
- `AIChatRecoveryClassifier.test.ts` — status/body/thrown/finish tables, `Retry-After` seconds + HTTP-date, rate-limit reset.
- `AIChatRetryPolicy.test.ts` — jitter bounded, max-delay cap, non-retryable reasons, background cap, persistent hard cap.
- `AIChatRecoveryCoordinator.test.ts` — layer order, attempt recording, side-effect-boundary safety.
- `AIChatModelFallbackService.test.ts` — never same model, fallback map → default → first different.
- `AIChatContextRecoveryService.test.ts` — tool-call group atomicity, drain before compact, no raw-history mutation.
- `AIChatModelCatalogService.test.ts` — caching, fallback default.

**Extend existing tests**:
- `test/vitest/utilitycode/aiChatApi.test.ts` — network failure then success, 429 with `Retry-After`, 529 three-then-success, abort during retry sleep, exhausted throws `AIChatRecoverableError`.
- `test/vitest/main/service/AIChatQueryLoop.test.ts` — `finish_reason=length` escalates once then continuation, truncated tool JSON not executed, three failures → failed result, fallback retries model call without replaying tools, side-effect boundary.
- `test/vitest/main/service/AIChatQueryEngine.test.ts` — final assistant saved once after recovery, recovery metadata on final row, partial saved only when visible on cancel.
- IPC test — `recovery_status` maps to `ChatV2StreamChunk`, AI gate still first.

---

## Implementation order (commits per global CLAUDE.md rule)

1. `AIChatRecoveryTypes.ts` + tests → commit
2. `AIChatRecoveryClassifier.ts` + tests → commit
3. `AIChatRetryPolicy.ts` + tests → commit
4. `AIChatQueryEvents.ts` + `aiChatV2Types.ts` type additions → commit
5. `aiChatApi.ts` Phase-1 integration + `aiChatApi.test.ts` → commit
6. `ai-chat-v2-ipc.ts` `recovery_status` case → commit
7. `AIChatQueryLoop.ts` `onRecoveryStatus` forwarding → commit
8. `AiChatV2RecoveryStatus.vue` + `AiChatV2.vue` renderer wiring + 6 lang files → commit (Phase 1 done)
9. `AIChatModelCatalogService.ts` + tests → commit
10. `AIChatContextRecoveryService.ts` + tests → commit
11. `AIChatRecoveryCoordinator.ts` + tests → commit
12. `AIChatQueryLoop.ts` Layer 3 + `AIChatContextAssembler.ts` policy + loop test extensions → commit
13. `AIChatModelFallbackService.ts` + tests → commit
14. `AIChatQueryLoop.ts` Layer 6 wiring + persistent retry + engine metadata → commit (Phases 2 & 3 done)

Each commit follows `<type>: <description>` per global git-workflow rule. After each functionally-complete unit, stage named files and commit. No `--no-verify`. After all commits: type-check (`yarn vue-check`; final run must include tsc gate — do not leave `AIFETCHLY_SKIP_TSC=1` in any committed code).

---

## Verification

1. **Type check**: `yarn vue-check` (renderer types) and the vitest global `tsc --noEmit` gate (run `yarn testmain`).
2. **Unit tests**: `yarn testmain` runs all `test/vitest/main/**/*.test.ts` and `test/vitest/utilitycode/**/*.test.ts` through the typed vitest configs. All new and extended recovery tests must pass.
3. **No regressions**: existing `AIChatQueryLoop.test.ts`, `AIChatQueryEngine.test.ts`, `aiChatApi.test.ts` continue to pass; existing `retry_connect` event still emitted for backward compatibility.
4. **Manual smoke (optional, dev-only)**: `yarn dev` → trigger each recovery scenario in dev:
   - Kill AI server mid-stream → Layer 1 reconnect with status badge.
   - Simulate 529 (dev proxy) → Layer 2 then Layer 6 fallback.
   - Long conversation → Layer 5 collapse badge near 90%.
   - Click Stop during backoff → immediate `cancelled`.

---

## Non-Goals / Out of scope

- No new DB table (recovery metadata on assistant row only, per tech-design §15.1).
- No worker-process changes (existing `AIRecoveryExecutor`/`AIRecoveryBridge` untouched).
- No renderer settings UI for recovery knobs (defaults in code, per tech-design §FR-7).
- No auto-replay of non-idempotent tools (tool safety maintained by `sideEffectBoundaryCrossed`).
- No removal of `retry_connect` (kept for one release for compatibility).
