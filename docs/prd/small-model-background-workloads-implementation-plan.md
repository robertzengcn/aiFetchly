# Implementation Plan: Small-Model Routing for Background AI Workloads

**PRD:** `docs/prd/small-model-background-workloads-prd.md`
**Tech design:** `docs/prd/small-model-background-workloads-technical-design.md`
**Branch:** `dev` (6 ahead of origin/dev, clean). Stay on `dev`; no worktree (user didn't request one).

## Scope decisions (confirmed with user)

- **Full feature — all 8 commit units** from tech-design §23.
- **Kill switch default = DISABLED** when env var absent. This deviates from tech-design §8.3 ("default enabled") in the *safer* direction the design itself sanctions (§22 Phase 1: "kill switch remains off in production during code-only validation if server readiness is incomplete"). Operator flips `AIFETCHLY_SMALL_MODEL_ROUTING_ENABLED=true` after the server has an `is_small_model` setting. All code paths still built & tested; they just don't fire until the flag is on. Documented in the ops doc (unit 8).

## Verified codebase anchors (from 4 exploration agents + inline reads)

| Claim | Verified state | Source |
|---|---|---|
| Completion boundary | `AiChatApi.openAIChatCompletion(request)` aiChatApi.ts:2084; no `AbortSignal` param | routing agent |
| Request type has `model/temperature/max_tokens/tools/tool_choice/stream` | TRUE — `OpenAIChatCompletionRequest` aiChatApi.ts:526 | routing agent |
| `_fetchJSON` throws lossy error | `if (!res.ok) throw new Error(res.statusText)` httpclient.ts:249 — discards status/body/headers/code | inline read |
| `signal` already flows to `fetch` | `_fetchJSON` spreads `...options` into `fetch` (httpclient.ts:192); `postJson(endpoint,data,options={})` has an `options` param — plumbing exists, just unused by `openAIChatCompletionHosted` | routing agent |
| `normalizeModelsResponse` drops top-level metadata | OpenAI pass-through branch (aiChatApi.ts:2033-2039) returns `{object, data}` only — drops `default_model` AND any `small_model` | inline read |
| Catalog caches context+maxOutput | `AIChatModelCatalogService.getContextWindow/getMaxOutputTokens` AIChatModelCatalogService.ts:100/112 | inline read |
| No `small_model` field anywhere | TRUE | inline read |
| Factory injects `openAIChatCompletion` via `completeChat` dep | AIAutoDreamFactory.ts:26,68 | auto-dream agent |
| `reviewedThrough` written at startRun, NOT completeRun | TRUE — model `completeRun` omits it (AIMemoryConsolidationRun.model.ts:52-65) | auto-dream agent |
| No transactional `applyPlanAndCompleteRun` | TRUE — memory ops + `completeRun` are separate non-transactional writes | auto-dream agent |
| Parsers/secret-filters exist | `parseAutoDreamModelOutput`/`parseWorkspaceAutoDreamModelOutput` in prompt builders; `MemorySecretFilter.looksSecretlike`; local `isSecretLike` | auto-dream agent |
| No-source run returns skip (no record) | TRUE — returns `null` at multiple guard points | auto-dream agent |
| Compact built with deps incl. `completeChat` | ai-chat-v2-ipc.ts:200-221; `AIChatCompactAgentDeps` AIChatCompactAgentService.ts:50-63 | compact agent |
| Full compact sends ALL message rows, no chunking | `runFullCompact` AIChatCompactAgentService.ts:431-495 | compact agent |
| Compact filters to `MESSAGE`-only + flattens `{role,content}` | TRUE — `isMessageRow` + `sorted.map` discards tool_calls/tool_call_id | compact agent |
| Per-conversation lock | `inFlight` Map AIChatCompactAgentService.ts:81 | compact agent |
| `saveFullCompact` transactional (supersede+insert) | AIChatCompactSummary.model.ts:48-79 | compact agent |
| Session-memory `recordFailure` returns null if no row | AIChatSessionMemory.model.ts:75-87 — first failure lost | compact agent |
| Tool-call grouping exists (private) | `AIChatContextRecoveryService.buildGroups` AIChatContextRecoveryService.ts:179-220 | compact agent |
| `AIChatTokenEstimator` canonical | estimateText/estimateMessage/estimateMessages AIChatTokenEstimator.ts:10/15/28 (length/4 + overhead) | compact agent |
| `resetAiChatV2RuntimeForDatabaseSwitch` | ai-chat-v2-ipc.ts:172-185 — resets queryEngine/compactAgent/catalog/auto-dream singletons | compact agent |
| Boundary fields | compact: `fromMessageId/throughMessageId/throughTimestamp`; session: `coveredThroughMessageId/coveredThroughTimestamp` | compact agent |
| `AIChatMessageEntity` has `messageType/model/tokensUsed/metadata` | AIChatMessage.entity.ts:10 | compact agent |

**Deviations from tech design discovered:** (1) collector doesn't explicitly sort newest-first — delegates to `getConversations()`; the "oldest-first" fix = add explicit ascending sort + derive cursor from committed packets. (2) Compact already drops tool_calls before the LLM call, so "atomic tool grouping" is forward-looking — budget layer must still be correct for full `OpenAIChatMessage[]` per design §13.2. Neither blocks implementation.

## Implementation order (8 commits, each a complete logical unit)

Per CLAUDE.md mandatory auto-commit rule: stage + commit after each unit. Per tech-design §23: do NOT combine phases. TDD: write test first (RED), implement (GREEN), verify. Never `--no-verify`; fix lint/tsc errors for real.

### Commit 1 — `feat: preserve typed hosted AI response errors`
**Files:**
- NEW `test/vitest/utilitycode/httpResponseError.test.ts` (TDD first)
- EDIT `src/modules/lib/httpclient.ts` — replace line 249 `throw new Error(res.statusText)` with `throw new HttpResponseError(...)`. Read ≤16KiB body, parse `error.code` only if valid JSON, parse `Retry-After` with upper bound (cap e.g. 60s). Do NOT log body. Keep 401/403 refresh path untouched (lines 202-247). Auth-refresh-failure still classifies as auth.
- NEW `src/modules/lib/httpResponseError.ts` — `HttpResponseError extends Error { status, responseBody, retryAfterMs?, serverCode? }` (design §9).
- EDIT any httpclient caller tests that assert on `Error(res.statusText)` — update to `HttpResponseError` shape. Grep `res.statusText` / `statusText` across `test/` first.

**Acceptance:** status/body/serverCode/Retry-After preserved; 16KiB bound; existing token-refresh tests still pass. `yarn testmain` + utilitycode tests green.

### Commit 2 — `feat: discover hosted small-model capabilities`
**Files:**
- EDIT `src/api/aiChatApi.ts`:
  - Add `OpenAISmallModelCapability { available; resolved_model?; context_size?; max_tokens? }` (design §8.4).
  - Add `small_model?: OpenAISmallModelCapability` to `OpenAIModelsResponse` (aiChatApi.ts:566).
  - Fix `normalizeModelsResponse` (aiChatApi.ts:2028): OpenAI pass-through branch must preserve `default_model` AND `small_model`; validate positive-int token fields, ignore malformed optional fields without rejecting the list (design §8.4).
- EDIT `src/service/AIChatModelCatalogService.ts` — cache `small_model`; add `getSmallModelCapability(): Promise<OpenAISmallModelCapability | null>`.
- NEW tests: extend `test/vitest/utilitycode/aiChatApi.test.ts` (normalization preserves valid `small_model`; malformed fields ignored); extend `test/vitest/main/service/AIChatModelCatalogService.test.ts` (cache reuse, invalidation).

**Acceptance:** normalization preserves `small_model` for both response shapes; malformed optional fields ignored safely; catalog exposes capability. `yarn testmain` green.

### Commit 3 — `feat: add lightweight AI workload routing policy`
**Files (all NEW per design §5.1):**
- `src/service/AIChatLightweightTypes.ts` — workload IDs, profiles, route results, typed failure reasons, attempt metadata (design §6, §7).
- `src/service/AIChatLightweightProfiles.ts` — frozen exhaustive `LIGHTWEIGHT_PROFILES` map (design §7). TS must fail compile if a new workload lacks a profile.
- `src/service/AIChatPromptBudget.ts` — pure token-budget, atomic-grouping (extract/share from `AIChatContextRecoveryService.buildGroups`), deterministic chunk helpers (design §13).
- `src/service/AIChatLightweightFailureClassifier.ts` — convert typed HTTP/provider/parser failures → policy categories (design §10 matrix).
- `src/config/aiLightweightRouting.ts` — parse env `AIFETCHLY_SMALL_MODEL_ROUTING_ENABLED`; **default DISABLED** (absent → off; invalid → off + log once; explicit `true`/`1` or `false`/`0` only). Read at service construction.
- `src/service/AIChatLightweightCompletionService.ts` — provider selection, kill switch, retries, cooldown, compact fallback, cancellation, structured logging (design §4, §11, §12, §18). No mutable current-request fields; concurrency-safe.
- `src/service/AIChatLightweightCompletionFactory.ts` — process singleton + `resetLightweightRuntime()` hook (called from `resetAiChatV2RuntimeForDatabaseSwitch` and provider-setting updates).
- Tests (TDD): `test/vitest/main/service/AIChatLightweightProfiles.test.ts`, `AIChatPromptBudget.test.ts`, `AIChatLightweightFailureClassifier.test.ts`, `AIChatLightweightCompletionService.test.ts` — cover every design §21.1 + §21.3 row: success, kill-switch direct normal, missing-small, 429 retry, 5xx retry-no-broad-fallback, ambiguous timeout exactly-one-request, auth/quota no-retry, cancellation at each boundary, compact one-fallback-per-allowed-reason + zero-otherwise, cooldown threshold/duration/reset/manual-bypass/runtime-reset.

**Acceptance:** all policy tests pass; `attemptCount<=2` for optional; compact ≤1 fallback; ambiguous = no 2nd request. `yarn testmain` green. **This commit does not wire any caller yet — routing is inert until unit 4+.**

### Commit 4 — `fix: make auto-dream cursors batch safe`
**Files:**
- EDIT `src/service/AIAutoDreamSourceCollector.ts` — filter by `reviewedSince` before limits; sort oldest-first (ascending `(updatedAt, sourceKind, sourceId)`); merge chat+agent-task descriptors chronologically before hydration; hydrate only after selection; set `batchReviewedThrough` to greatest `updatedAt` actually included; never `new Date()` as success cursor (design §14.1). Currently line 69 uses `new Date()` — replace with source-derived cursor.
- EDIT `src/model/AIMemoryConsolidationRun.model.ts` + `AIWorkspaceMemoryConsolidationRun.model.ts` — accept `reviewedThrough` on `completeRun` (not just `startRun`), so cursor commits with the successful result (design §2.6, §14.4).
- EDIT `src/modules/AIMemoryConsolidationRunModule.ts` + `AIWorkspaceMemoryConsolidationRunModule.ts` — `completeRun` passes `reviewedThrough`.
- EDIT `src/service/AIAutoDreamService.ts` + `AIWorkspaceAutoDreamService.ts` — pass `batchReviewedThrough` (from collector) into `completeRun`, not `startRun`.
- NEW/extend tests: oldest-first selection across chat+agent sources; more candidates than one batch, no skipped cursor interval; failure leaves previous cursor unchanged; boundary-timestamp repeat doesn't skip a packet.

**Acceptance:** no eligible source can be skipped; cursor advances only through successfully committed packets. `yarn testmain` green.

### Commit 5 — `feat: route auto-dream through the small model`
**Files:**
- EDIT `src/service/AIAutoDreamFactory.ts` — inject the shared `AIChatLightweightCompletionService` (from factory) into both auto-dream services in place of raw `openAIChatCompletion` (design §5.2).
- EDIT `src/service/AIAutoDreamService.ts` — use profile `user_auto_dream`; budgeted batches (commit 4 collector + `AIChatPromptBudget`); JSON repair once on same route (design §9.4, §14.3); transactional `applyPlanAndCompleteRun` (design §14.4 — new method on `AIUserMemoryModule`); successful-cursor commit; structured logging; `skipped_no_sources` no-record path.
- EDIT `src/service/AIWorkspaceAutoDreamService.ts` — same for `workspace_auto_dream`; per-workspace batch+cursor isolation; shared route cooldown (design §14.5).
- EDIT `src/modules/AIUserMemoryModule.ts` + `AIWorkspaceMemoryModule.ts` — add `applyPlanAndCompleteRun()`: one TypeORM transaction doing archive/update/create through transaction-bound repos + mark run completed with counts+model+`reviewedThrough`; return counts only after commit. On failure roll back, best-effort mark run failed, no model repeat (design §14.4).
- Tests (design §18.2): lightweight dep receives expected workload ID+profile; invalid-JSON repair succeeds; repair fails without DB mutations; missing-small opens cooldown; cooldown suppresses subsequent background calls; manual bypasses scheduling cooldown without expensive fallback; watermark advancement across multiple batches; DB failure causes no further model call.

**Acceptance:** hosted auto-dream sends `model:"small"` (mocked); optional work has no normal fallback; cursor safe. `yarn testmain` green. **Kill switch OFF by default → no live server calls until operator enables.**

### Commit 6 — `feat: chunk session summaries for small models`
**Files:**
- EDIT `src/service/AIChatCompactAgentService.ts` — route `runSessionMemoryUpdate` through lightweight service with profile `session_memory_summary`; rolling chunks (design §15.2: include current summary + next complete message groups; per-chunk boundary advances only after success; resumable partial progress); one same-small formatting retry only if first response was definitive (design §15.2). Reuse per-conversation `inFlight` lock.
- EDIT `src/model/AIChatSessionMemory.model.ts` + `src/modules/AIChatSessionMemoryModule.ts` — first-failure state: create initial row on first failure OR persist minimal row before first request, preserving per-conversation circuit breaker (design §15.3, C6 fix).
- EDIT `src/main-process/communication/ai-chat-v2-ipc.ts` — wire lightweight service into `getCompactAgent` deps (replace raw `completeChat`) + call `resetLightweightRuntime()` from `resetAiChatV2RuntimeForDatabaseSwitch` (design §5.2).
- Tests (design §18.3, §21.5): incremental multi-chunk rolling summary + resumable partial progress; first-chunk failure persists circuit-breaker; oversized deltas in chronological chunks; per-chunk boundary advances only after success; cancellation before/during chunk processing.

**Acceptance:** session summary chunked within small-model budget; partial progress durable; circuit-breaker survives first failure. `yarn testmain` green.

### Commit 7 — `feat: compact conversations with controlled small-model fallback`
**Files:**
- EDIT `src/service/AIChatCompactAgentService.ts` — route `runFullCompact` through lightweight service with profile `conversation_compact`; hierarchical compact (design §16.2: load active summary → load rows after boundary → atomic groups → budgeted chunks → summarize each → merge recursively → validate final → atomic activate). Eligibility gate (design §16.1: hosted + kill-switch on + capability available + valid context; else normal path with route reason `capability_missing`, NOT counted as the one fallback). Controlled one-time normal fallback (design §9.5, §16.3: restart from original state, never mix small intermediates with normal final). Reuse `saveFullCompact` transaction. Manual+automatic share engine (§16.4).
- Tests (design §18.3, §21.5): full compact uses discovered context + keeps atomic groups; intermediate failure leaves previous active compact untouched; final activation atomic; capability absence → direct normal route; definitive small failure restarts from original state on one normal fallback; small intermediates not reused by fallback; empty small output triggers one allowed fallback; no duplicate submission on ambiguous timeout; stored model == `response.model`.

**Acceptance:** large conversations compact within small budget; no boundary corruption; ≤1 fallback; ambiguous timeout = no 2nd request. `yarn testmain` green.

### Commit 8 — `docs: document small-model operations and rollout`
**Files:**
- NEW `docs/small-model-routing-operations.md` — server/operator config (`is_small_model`, capability metadata, `small_model_unavailable` error code), kill-switch env var + **default-OFF rationale**, rollout phases (design §22), observability fields (design §18), success metrics (PRD §14).
- EDIT `CLAUDE.md` — one paragraph under Architecture or a new "Small-Model Routing" subsection pointing at the ops doc + env var + the four allowlisted workloads.

**Acceptance:** ops doc covers config/rollout/observability; CLAUDE.md cross-references it.

## Verification gates (run after each commit, all must pass)
- `yarn testmain` (vitest main + utilitycode; includes tsc gate via globalSetup)
- `yarn vue-check` (only if a Vue/router/translation file changed — none expected this feature, so this stays clean)
- `yarn build` (catches the renderer node-leak guard — relevant if any service import reaches renderer; lightweight services are main-process-only by design §19.6, but verify)
- `npx tsc --noEmit` directly when the husky hook reports errors, to see the full list before committing

## Risks & mitigations (this implementation)
- **Stale premises in design:** already verified all anchors above; the two minor deviations (collector sort, compact tool-grouping) are handled in commits 4 & 7.
- **`--no-verify` temptation:** husky runs eslint (lint-staged) + vitest tsc gate. If a commit is blocked, fix the reported errors for real — including pre-existing lint debt in touched files. Never `--no-verify`.
- **Worktree node_modules:** not using a worktree, so N/A.
- **better-sqlite3 ABI:** only relevant if a DB-test needs a real connection; commits 4-7 use mocked models/repos mostly. If a real-DB test is needed, run `npm rebuild better-sqlite3` first.
- **Quota (glm-5.2/sensenova):** if a subagent dies with 429 mid-implementation, fall back to inline execution on the orchestrator model (per memory note). Don't retry the dead agent.
- **No real server:** all AI calls mocked/faked per design §21 test strategy. Kill switch OFF by default means even if a path fires in dev, it's inert.

## What is explicitly NOT done (deferred per design §26, not in scope)
Durable cross-restart cooldown; composite `(timestamp,sourceKind,sourceId)` DB cursor; provider-declared virtual aliases; server idempotency keys; user-visible cost-diagnostics page; dynamic remote workload profiles; quality-evaluation corpus run (PRD §18.6) — needs the live server. These are listed as deferred and require separate review.
