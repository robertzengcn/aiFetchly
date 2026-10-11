# Task Completion Policy — PRD Coverage TODO

Source PRDs (both `Proposed`, implementation has now **started in Slice 1 only**):

- `docs/prd/scheduled-loop-premature-stop-recovery-advice.md` (v3.0) — FR-01…FR-24, NFR-01…NFR-12, AC-01…AC-32
- `docs/prd/scheduled-loop-premature-stop-recovery-technical-design.md` (v2.0) — §§1…18, delivery slices §16

Branch: `worktree-task-completion-policy-v1-slice1` (26 commits on top of `7ce133b2`,
`+8306/−10`, confined to `src/{entity,entityTypes,model,modules,service/aiTaskExecution,config}` + tests).

**Headline verdict**

- Slice 1 foundation is landed as library code and **all Slice 1 tests pass**: 115 tests
  across 12 files (58 + 27 vitest via `vitest.service.config.mjs`, 30 Mocha via
  `scripts/run-module-tests.js`); `tsc --noEmit` clean.
- **All 10 audit bugs (B1–B10) + R1 are fixed** — see checkboxes below for commit SHAs.
  The "missing unit tests for landed fixes" gap (structuredClone, verifyHash, NaN/Infinity,
  true-concurrent CAS) is also closed.
- **Nothing is wired into the live loop**: the gate `isAiTaskCompletionPolicyV1Enabled()`
  (`src/config/featureFlags.ts:213`) has zero production call sites; `AIChatQueryLoop`,
  `AIChatQueryEngine`, `ScheduledLoopEventSink`, `ScheduledAiMessageRunner` are untouched
  (old `goalTextStop` / `shouldAutoContinueGoal` / `complete→completed` still live).
  That is *correct* for Slice 1 (shadow-only by design, B10 decision), but it means
  **every AC that requires live recovery still fails**, and the shadow evaluation itself
  is never invoked. Slice 2 owns the live wiring.

How to use this file: `[BUG]` = fix in landed code. `[GAP-Sn]` = unimplemented work
belonging to Slice n (§16 traceability). Checkboxes are ordered by dependency.

---

## A. Bugs in landed Slice 1 code (fix before Slice 2)

- [x] **[BUG] B1 — NaN poisons `TaskRunBudget` accounting.** ✅ Done (commit 2380328a):
      `reconcileTokens`, `addActiveRuntime`, `addWaitMs` now `Number.isFinite`-guard every
      numeric input (fail-closed to 0). Tests in `TaskRunBudget.test.ts:95-166` cover NaN and
      Infinity on every accumulator (FR-08, §9). `src/service/aiTaskExecution/TaskRunBudget.ts`.

- [x] **[BUG] B2 — "CAS" finalization is check-then-act, not atomic.** ✅ Done (commit 1653ba90):
      `finalizeExecution` is a single `UPDATE … WHERE execution_state_version = :v AND finalized = 0`
      with an affected-rows check (via `useStructuredResult=true` on the driver QueryRunner); true
      concurrent `Promise.all` race test resolves to exactly one winner. `src/model/AiTaskExecution.model.ts:148-184`.
      `finalizeExecution` does read (`getById`) → version check → `save()` as separate steps, so two
      concurrent finalizers can both read version 0, both pass, and the second overwrites the first —
      violating §6.3 step 1 ("Claim an unfinalized execution using expected state version **in a
      transaction**") and the file's own docstring. The test named "concurrent CAS finalization"
      awaits finalizer 1 fully before starting finalizer 2, so it cannot detect this race.
      Fix (Slice 2 at latest): single `UPDATE … WHERE execution_state_version = :v AND finalized = false`
      with affected-rows check, in one transaction including the ledger-owner release; add a true
      concurrency test.
      PRD: §6.2, §6.3, AC-32.

- [x] **[BUG] B3 — Non-atomic creation leaves orphan ledgers.** ✅ Done (commit 1653ba90):
      `createExecution` wraps ledger + execution saves in a single TypeORM transaction.
      `src/model/AiTaskExecution.model.ts:96,130`.
      `ledgerRepo.save()` then `executionRepo.save()` with no transaction; a crash/failure between them
      leaves a `ledger-*` row whose `active_execution_id` points at a nonexistent execution.
      Fix: wrap both saves in a TypeORM transaction (combine with AC-26 submission-dedup lookup work).
      PRD: §6.2.

- [x] **[BUG] B4 — Operation create: race + silent intent collision.** ✅ Done (commit 77676058):
      `create` now catches the unique-constraint violation and returns `{ alreadyExists: true }` instead
      of throwing raw; same key + *different* `intentHash`/`executionId`/`toolIdentity` returns an
      `INTENT_CONFLICT`-style result instead of silently accepting a changed target. Tests in
      `AiTaskOperationModule.test.ts` cover the concurrent same-key race and the intent-collision
      branch (§10.1). `src/model/AiTaskOperation.model.ts`.

- [x] **[BUG] B5 — `claimed_at` is never written.** ✅ Done (commit 77676058): `updateState` stamps
      `claimed_at` on the `claimed` transition (test:
      `AiTaskOperationModule.test.ts` "stamps claimed_at on the 'claimed' transition (§10.2)").
      `src/model/AiTaskOperation.model.ts`.

- [x] **[BUG] B6 — `finalizeExecution` silently drops evidence linkage.** ✅ Done (commit 1653ba90):
      `evidenceIds`/`remainingWork`/`assistantResultMessageId` now persist into `execution_state_json`
      as a finalization checkpoint; `assistant_result_message_id` column also written via
      `COALESCE` in the CAS UPDATE. `src/model/AiTaskExecution.model.ts:146-187`
      vs `FinalizeInput:23-31`. Callers pass `evidenceIds`/`remainingWork` but neither is persisted (no
      evidence store in Slice 1) and `assistant_result_message_id` has no input field at all — yet the call
      returns `ok: true`, despite §6.3 step 2 requiring "outcome, reason, **linked assistant result,
      evidence/counter summary**".
      Fix: persist to `execution_state_json` now, or remove the fields until the Slice 2 checkpoint format
      lands; silent drop is the worst option.
      PRD: §6.3, FR-12.

- [x] **[BUG] B7 — `freeze` output not schema-validated; hash order-sensitive.** ✅ Done (commit
      ad3141c8): `freeze` now runs `taskCompletionContractSchema.parse` on the frozen output (rejects
      empty `objective`, negative offsets, overlong strings, duplicate criterion `id`s), and `computeHash`
      sorts criteria by `id` and normalizes `sourceRefs`/`approvedSourceMessageIds` before hashing —
      semantically identical freezes hash identically regardless of caller order. Tests in
      `TaskCompletionContractService.test.ts:118-240` cover order-independence (criteria + approved IDs),
      schema-parity rejections, `verifyHash` round-trip + tamper detection, and `structuredClone`
      post-freeze immunity (FR-19, §5.1, §8.2). `src/service/aiTaskExecution/TaskCompletionContractService.ts`.

- [x] **[BUG] B8 — `recordShadowDecision` clobbers checkpoint, can mutate terminal rows.** ✅ Done
      (commit 1653ba90): merges the decision under a stable `shadowDecision` key instead of overwriting
      (§6.1), guards on `finalized` (terminal rows immutable), bumps `execution_state_version` (CAS
      preserved), and no-ops on a missing execution. `src/modules/AiTaskExecutionModule.ts:57-66`.
      PRD: §6.1, §6.2.

- [x] **[BUG] B9 — Controller stuffs criterion IDs into `evidenceIds`.** ✅ Done (commit 97250c43):
      shadow mode now emits `evidenceIds: []` (no evidence collected until `TaskEvidenceService` exists
      in Slice 2), so downstream consumers validating reference membership/scope (§8.2) won't
      misattribute criterion IDs as evidence identities. `src/service/aiTaskExecution/TaskCompletionController.ts:110,125`.
      PRD: §5.2, §8.2.

- [x] **[BUG] R1 — Resolver misses the PRD's own headline scenarios without a template.** ✅ Done
      (commit bd332e26): `classify` now uses structural verb+target matchers for
      `save/collect/find/search/gather/add/import` task verbs (and conjunctions like `find+save+draft`),
      tolerates leading politeness/scoping prefixes (`please`, `now`, etc.), and keeps the
      definition-question and ambiguity guards. Tests in `TaskRequestResolver.test.ts` cover the
      no-template headline scenarios AC-01/AC-17/AC-19/AC-20 (`save 100 qualifying contacts`,
      `find 20 leads, save them, and draft an email`, `please check the deployment status now`) —
      all now route to task routes, not `response_only`. Template path unchanged (FR-18: structural
      verb+target analysis, not keyword matching alone). `src/service/aiTaskExecution/TaskRequestResolver.ts`.

---

## B. Incomplete work, by delivery slice (§16)

### Slice 1 remainder (gate: FR-05/06/16–20/24; AC-12/14/19/21/26/31)

- [x] **[GAP-S1] B10 — Shadow evaluation is never invoked in production.** `decide()` and
      `recordShadowDecision()` have zero production callers; the gate has zero call sites. Slice 1
      currently records no shadow decisions at all — "read-only shadow evaluation … on both origins"
      exists as tested library code only. **Decision (2026-10-05): explicitly defer call-site wiring
      to Slice 2. Slice 1 is recorded as library-only.** Rationale:
      1. §17 mandates "Shadow mode uses local read-only evidence and explicitly budgeted checker
         work; it cannot alter counters or trigger maker continuations. **Measure checker cost before
         enrollment.**" The bounded read-only evidence adapters and checker dispatch
         (`TaskEvidenceService`, `[GAP-S2]`) do not exist yet — there is no evidence source to drive
         a shadow `decide()` call against. Wiring a call site now would invoke `decide()` against an
         empty evidence set on every enrolled run, producing shadow decisions with nothing to
         evaluate — a cost-measurement signal with no payload, the opposite of what §17 asks for.
      2. The engine acceptance path (`[GAP-S2]`: conversation lease, DB/user scope, durable
         `submissionId`, execution record before resolver/maker dispatch, trusted binding on every
         resume path) is the *prerequisite* for any shadow call site — `recordShadowDecision` needs
         a created execution to record against, and the loop-consult path needs the controller wired.
         That wiring is itself Slice 2.
      3. Shadow evaluation that cannot alter counters or trigger maker continuations (§17) is, by
         construction, a no-op without the Slice 2 enforcement gate (`decide()` returns a decision
         that the loop would consult; the loop does not consult it today). Wiring the call site
         ahead of the consult path would record decisions the loop ignores — dead traffic.
      Slice 2 must: (a) add the `TaskEvidenceService` so shadow `decide()` has evidence to
      evaluate, (b) wire a gate-checked, read-only shadow `decide()` + `recordShadowDecision()`
      call site on both manual (`AIChatQueryEngine`/`AIChatQueryLoop`) and scheduled
      (`ScheduledAiMessageRunner`/`ScheduledLoopEventSink`) origins, and (c) measure checker cost
      per §17 before any enrollment. Until then the gate stays OFF in production (zero call sites is
      correct for a shadow-only library slice).
- [x] **[GAP-S1] Worker-guard tests.** ✅ Done (commit 399d8f8c): tests in
      `test/modules/AiTaskExecutionModule.test.ts` assert `createExecution`/`finalizeExecution`/
      `getExecution`/`getUnfinalizedExecutions` throw under `process.env.WORKER_TYPE` (NFR-03).
- [x] **[GAP-S1] Missing unit tests for landed fixes:** ✅ Done across commits 2380328a / 1653ba90 /
      399d8f8c / ad3141c8: `structuredClone` deep-copy post-freeze immunity + `verifyHash` round-trip +
      tamper detection (`TaskCompletionContractService.test.ts:200-240`), NaN/Infinity budget inputs
      (`TaskRunBudget.test.ts:95-166`), true-concurrent CAS race via `Promise.all`
      (`AiTaskExecutionModule.test.ts:331` resolves to exactly one created + one reused).
- [x] **[GAP-S1] `HARD_CAPS` declared but unenforced.** ✅ Done (commit ab9caf7c): `clampToHardCaps`
      in `budgetDefaults.ts` clamps `maxContinuations`/`maxActiveRuntimeMs` at the ledger freeze
      boundary; `AiTaskExecutionModel.createExecution` serializes
      `clampToHardCaps(input.budgetLimits)` into `policy_limits_json` instead of `"{}"`. Coordinator
      wires `budgetLimits` through `CreateExecutionInput` → module → model.
      PRD: FR-08 ("Only trusted validated configuration changes the defaults"), §6.1.
- [x] **[GAP-S1] Ledger `policy_limits_json` never populated** (`AiTaskExecution.model.ts` wrote `"{}"`).
      ✅ Done (commit ab9caf7c): frozen clamped budget limits now persist at `createExecution` time.
      PRD: §6.1.
- [x] **[GAP-S1] Scoped submission uniqueness unenforced.** ✅ Done (commit b872f221): partial
      unique index on `(conversation_id, submission_id) WHERE submission_id IS NOT NULL`;
      `createExecution` looks up by `(conversation, submission)` and returns `reused` (same
      request_hash, AC-26 transport-retry) or `conflict` (`SUBMISSION_CONFLICT`, different
      request_hash); scheduled-origin `null` submission_id is exempt (lineage key is
      occurrence_key). Process-wide `AsyncMutex` serializes the dedup-lookup + insert so
      concurrent callers don't collide on the shared better-sqlite3 connection. PRD: §4A.1, §6.1,
      AC-26.

### Slice 2 — Manual + scheduled recovery (gate: FR-01–10/12–15/17–24; AC-01–08/11/15–27/29–32)

Contracts, evidence & verification:

- [x] **[GAP-S2] `TaskEvidenceService`** (adapters, deterministic checks, checker dispatch, §8.1/§8.2):
      record/file/operation/observation/text evidence with source revision + baseline handling; qualitative
      checker with schema validation, reference-membership checks, retry budget (1 retry/candidate, 6/run).
      PRD: FR-03, FR-04, AC-03, AC-11, AC-20. ✅ Shipped Unit 1 (`0f5eab92`): `TaskEvidenceService` +
      `criteriaAdapters` (observation/operation_receipt/record_count/qualitative/artifact→unknown);
      controller wires `checkCandidate` into `decide()` for verified/best-effort routes and populates real
      `evidenceIds` on the decision.
- [x] **[GAP-S2] `TaskProgressTracker`** (evidence fingerprints, stall detection §7.2 step 9, no-progress
      streak bound 3, discovery-traffic exclusion). PRD: FR-09, AC-05. ✅ Shipped post-Unit-8
      (`a6cbf44c`): `TaskProgressTracker` per-execution fingerprint (normalized tool name + arguments +
      result, strips timestamps/random IDs/excludes `tool_catalog_search`); `recordToolRoundProgress`
      closure on `LoopTaskExecutionBinding`; loop observes every committed tool round; controller continue
      branch gates on `!budget.isNoProgressStreakExhausted()` and `incompleteReasonCode` returns
      NO_PROGRESS (precedence over boundary-derived CONTINUATION_LIMIT). Changed error resets streak
      without replenishing continuation allowance.
- [x] **[GAP-S2] Contract freezing per run** (template compiler + main-process validation, §4A.2/§5.1;
      criterion offset-vs-message-body validation; baseline capture before change-evidence actions).
      PRD: FR-01, FR-02, FR-19. ✅ Library Unit 3 (`TaskExecutionCoordinator.freezeContract` +
      `CreateExecutionInput.contractSnapshotJson`/`contractHash` persisted at creation); engine enrollment
      seam wired in Unit 4 (`4a6c97f5`, `engine.submitMessage` after `savedUser.messageId` at ~1169).
- [x] **[GAP-S2] Live `TaskRunBudget` enforcement**: ledger-backed reservations, dispatch gate on every
      resolver/maker/checker/compaction/fallback/HTTP-retry path, token-estimate reservation + actual
      reconciliation with dedup by request ID, active-time/1-hour-wait accounting, `HARD_CAPS` clamping.
      PRD: FR-08, AC-08, AC-29. ✅ Shipped Unit 2 (`5203ac40`): `reserveCheckerAttempt`, the three
      `is*BudgetExhausted` accessors, `resurrectFromLedger` round-trip; controller consults them in
      `decide()`. OPEN SUB-ITEM (GAP-S2 #4 reservations PERSISTENCE): budget is resurrected from ledger
      COUNTERS only on Continue; per-request reservations are still in-memory. Tracked as post-Slice-2.

Engine / loop / scheduler wiring (all behind `aiTaskCompletionPolicyV1`, frozen policy at acceptance):

- [x] **[GAP-S2] Engine acceptance path** (§4A.1): conversation lease, DB/user scope, durable user message by
      stable `submissionId`, execution record + ledger before resolver/maker dispatch, trusted binding on
      every resume path (permission, plan-question, plan-approval). Renderer generates/retains
      `submissionId`. PRD: FR-17, FR-20, AC-26. ✅ Library Unit 3 (`e29c7811`): `startManual`/`startScheduled`
      build the binding with leaseGeneration from `owner_generation`, contract + lineage persisted,
      budget resurrected via `getLedgerById` on Continue, `assertOwnership` STATE_CONFLICT guard);
      engine enrollment seam wired in Unit 4 (`4a6c97f5`) and carried through the three resume paths.
- [x] **[GAP-S2] Loop consults controller before terminal event** (FR-05): every enrolled no-call ending and
      round/budget cap reaches `decide()`; suppress legacy `goalTextStop`/empty-stop/cap nudges for enrolled
      runs only (`AIChatQueryLoop.ts:2224-2268`, `:2164-2182` stay for non-enrolled). Valid parsed calls still
      execute even with `stop`. PRD: FR-05, FR-06, AC-02, AC-12, AC-18. ✅ Shipped Unit 4 (`4a6c97f5`):
      four consult sites (round-cap, empty-stop-after-tools, goalTextStop, loop-exit) call
      `maybeConsultPolicy` → `consultLoopEndCandidate`; flag-off / no-binding is byte-identical legacy.
- [x] **[GAP-S2] Single-owner enforcement**: standalone vs goal owner per execution; unrelated active goals
      cannot take over manual requests (§4A.3); goal-maker iterations yield internally. PRD: FR-20, AC-14, AC-31.
      ✅ Library Unit 3 (`e29c7811`): `leaseGeneration` = fenced `owner_generation` from the ledger;
      `assertOwnership` returns STATE_CONFLICT on mismatch; Continue successor bumps owner_generation
      via the model layer; live consult/finalization gating wired in Units 4/5 (`4a6c97f5`/`76430ed9`).
- [x] **[GAP-S2] `ScheduledLoopEventSink` rejects missing/malformed task result as `MISSING_TASK_OUTCOME`**
      (never falls back to success); manual path likewise. Consult must happen upstream of
      `ScheduledLoopEventSink.ts:68` first-wins guard. PRD: FR-05, FR-12. ✅ Shipped Unit 6 (`caa2630b`):
      sink DI seam `policyBinding` consults `controller.decide` on `complete`, maps decision→outcome
      (`verified_complete`→`completed`, else `incomplete`/`blocked`/`cancelled`/`failed`); `failOutstanding`
      commits `missing_outcome`/`STREAM_INCOMPLETE` when flag on; flag-off blind mapping byte-identical.
- [x] **[GAP-S2] Atomic finalization with schedule accounting** (`AiTaskExecutionModule.finalizeExecution`
      + scheduled adapter in one transaction: outcome/reason/evidence/counters + occurrence status/counters/
      next-run exactly once; manual path touches no schedule tables; `verified_complete→completed` mapping
      preserves semantic outcome; unknown-action-outcome pauses schedule immediately). PRD: FR-12, §6.3, AC-32.
      ✅ Shipped Unit 5 manual (`76430ed9`) + Unit 6 scheduled (`caa2630b`): `finalizeManualAtCompleteGate`
      fallback consult + CAS; `finalizeScheduledExecution` multi-statement txn (CAS + ledger release + run
      row + schedule counters + pause-if-needed) serialized via `executionCreateMutex`;
      `updateIntervalAfterResult` literal-string bug FIXED; swallowing `catch {}` FIXED (AC-15).
- [x] **[GAP-S2] Pause/resume/cancel/Continue/Retry semantics** (§4A.4, §12): same-execution grant/deny and
      question/approval resume with remaining ledger; Stop/Replace fencing (`TASK_REPLACED`, late-callback
      fencing); linked Continue successor (immutable ancestor, shared lineage ledger, one active successor);
      explicit Retry as disclosed new ledger; transport retry idempotency. PRD: FR-10, FR-21, FR-22, AC-06,
      AC-07, AC-22–27. ✅ Shipped Unit 7 (`5c393e7f`): `coordinator.cancel`/`continueExecution`/
      `retryExecution`; `stopActiveTurn` → `coordinator.cancel` when flag on; Continue shares lineage ledger
      + resurrects budget; Retry mints new ledger; `AI_CHAT_V2_TASK_CONTINUE/RETRY` IPC (AI-gate → flag-gate
      → parent lookup → Zod); replacement fencing on new submission.
- [x] **[GAP-S2] Stop during checking/recovery** aborts owner + checker/transport waits, no further dispatch,
      no late success (AC-24); replacement message fences old execution (AC-25). ✅ Shipped Unit 7
      (`5c393e7f`): `checkCandidate` catches `AbortError` from the checker LLM → `unknown` for un-evaluated
      criteria → `finish(cancelled, USER_CANCELLED)`; abort during continuation dispatch →
      `finish(incomplete, USER_CANCELLED)`; never `verified_complete`.

Renderer / i18n / tests:

- [x] **[GAP-S2] Renderer + history surfaces** (Slice 2 Unit 8): `ChatV2StreamChunk.taskExecutionState` +
      `ChatV2TaskExecutionStateEvent` type (`aiTaskExecutionTypes.ts`) + `task_execution_state` chunk routing
      in `AiChatV2.vue` (mirrors `goal_state`); `activeTaskExecution` ref + `TaskExecutionStatusBadge.vue`
      (all 10 statuses, honest terminal labels, reason-code tooltip); Continue/Retry buttons at terminal
      non-verified (fresh submissionId via recovery IPC, Unit 7); Stop button delegates to the existing
      stream-stop → `coordinator.cancel` path; per-conversation reset. NOTE: the main-process
      `task_execution_state` EMITTER is renderer-ahead wiring (ships with the scheduled-runner push in a
      later phase — same pattern `goal_state` used); component tests drive chunks directly. Stale/duplicate
      event filtering by executionId is deferred with the emitter. PRD: FR-13, FR-14, AC-16, AC-29/32.
- [x] **[GAP-S2] Six-language translations** (`en zh es fr de ja` + English fallbacks) —
      `aiChatV2.taskExecution` section: 10 status labels + actions + all 31 reason-code messages per
      language; parity is enforced by the extended `AIChatHistoryI18n.test.ts` (any missing key in any
      language fails). PRD: FR-15.
- [x] **[GAP-S2] Component tests** — `TaskExecutionStatusBadge.test.ts` (labels, tooltip, te() fallbacks);
      `AiChatV2TaskChunkRouting.test.ts` (chunk routing, button gating, Continue/Retry IPC payloads,
      per-conversation reset). **E2E** — `scheduled-incomplete-recovery.spec.ts` (flag-off denial,
      flag-on unknown-parent denial, malformed payload rejection on the real preload bridge) and
      `manual-cancel-during-checking.spec.ts` (enrolled turn → Stop mid-stream → conversation recovers;
      recovery IPC fails closed). E2E for the full scheduled badge loop + stale-event filtering lands with
      the emitter (renderer-ahead note above). PRD: FR-15, §15 (test table), AC-24/25/27/28/29–32.

Acceptance mapping (all currently failing live; Slice 2 gate requires all green):
AC-01 (54/100 continue), AC-02 (first-response no-tool recovery), AC-03 (genuine completion, no extra maker
call), AC-04 (observation occurrence), AC-05 (no-progress incomplete), AC-06 (permission resume counters),
AC-07 (denial honored), AC-08 (budget exhaustion), AC-11 (checker-invented evidence rejected), AC-15
(persistence failure → no success), AC-16 (history reload all languages), AC-17–27, AC-29 (monotonic counters
through compaction/fallback), AC-30 (recoverable pre-decision error stays non-terminal), AC-32 (idempotent
terminal identity, no schedule accounting for manual).

### Slice 3 — Guarded effects (gate: FR-11, NFR-05/07; AC-09/10/13/28)

- [ ] **[GAP-S3] `TaskOperationGuard`** (§10): stable operation keys (execution/lineage + domain + target +
      intent hash + contract-permitted ordinal only), native receipt preference, claim→dispatch→confirm/unknown
      state machine with transition validation, pending/unknown query, no-effect-evidence-gated retry only.
- [ ] **[GAP-S3] Cross-execution same-intent lookup**: new execution/conversation must not bypass an
      unresolved earlier send/job (domain/target/intent/state index or native job lookup); `UNKNOWN_ACTION_OUTCOME`
      blocks replay, requires reconciliation, pauses schedule (FR-12).
- [ ] **[GAP-S3] Startup recovery**: mark unfinished executions/occurrences interrupted, preserve
      checkpoints/receipts, invalidate callbacks/handles, reconcile uncertain operations — no automatic action
      replay. (NFR-05; `getUnfinalizedExecutions` exists, no consumer.)
- [ ] **[GAP-S3] Crash/finalization fault-injection tests** (reservation↔dispatch crash, dispatch↔receipt crash,
      restart-before-notification dedup, zero duplicate effects, single schedule-count increment).
- [x] **[GAP-S3] Background-job semantics**: start-receipt vs completion distinction, bounded read-only polling
      (backoff, ≥1s interval), no unbounded internal polling. (§10.3) — bounded polling landed (T23e):
      async poll loop now grows the interval ×1.5 from the registry's `pollMinIntervalMs` (5s) to a 15s cap
      with a 1s floor, honoring `rate_limited.retryAfterMs` (`ToolJobRegistry.pollMinIntervalMs` accessor).
      The start-vs-completion distinction is enforced at the criterion-threshold layer, not in
      `classifySendOutcome`: `TaskCriteriaResolver` compiles every send to `operation_receipt`
      `requiredState="completed"`, and `meetsOperationThreshold` ranks
      `pending<claimed<dispatched<accepted<completed`, so a claimed send lands `accepted` — it satisfies a
      start-only criterion but fails the completion criterion, exactly as §10.3 prescribes. Resolving
      `accepted`→`completed` (native delivery-status reconciliation) is the open terminology item below.
      2 backoff tests in `AIChatQueryLoopAsyncPoll.test.ts`.
- [ ] **[GAP-S3] Terminology reconciliation**: entity/types use `pending…accepted/completed`, design §10.2
      diagram uses `prepared…confirmed` — pick one before receipt reconciliation lands.

### Slice 4 — External adapters (gate: FR-04, AC-14)

- [ ] **[GAP-S4] Legacy schedule-page and non-Chat-V2 AI features**: separate enrollment adapters + compatibility
      tests; never silently infer new targets. (Only `AiMessageTask` policy columns exist as schema prep.)

### Server diagnostics (FR-16; owner: AI server engineering; repo `/Users/cengjianze/project/aifetchserver`)

Desktop completion control must work without server metadata; all fields optional/capability-negotiated.

- [ ] **[GAP-SRV] Preserve provider finish reasons**; record `terminal_origin`
      (`provider|adapter_normalized|synthetic_missing_terminal|transport_error|unknown`) in
      `aifetchserver/api/openai_compatible.py` stream builder + adapters; no image-whitelist leakage to
      unrelated passthrough streams; no silent error→stop translation.
- [ ] **[GAP-SRV] Optional `aifetch_stream_diagnostics` extension** (schema v1: request/server-query IDs,
      provider label, selected/resolved model incl. failover record, upstream response/finish reason,
      forwarded reason, terminal origin + `upstream_terminal_seen`, output budget, usage source); optional
      correlation header; safe logs only (no prompts/args/recipients/reasoning/keys).
- [ ] **[GAP-SRV] Desktop correlation plumbing**: opaque request/execution (+ optional scheduled-run) IDs via
      optional metadata/headers; `OpenAIStreamAccumulator` + API stream types record provenance;
      missing-diagnostics → `unknown` tolerated.
- [ ] **[GAP-SRV] Server unit/integration tests** per §15 row (raw stop passthrough, absent-terminal origin,
      normalization, midstream error, post-terminal usage, fallback-model record, metadata optionality,
      sensitive-log exclusion).

---

## C. Regression & rollout gates (PRD §12, design §17/§18)

- [ ] All AC-01–32 pass assigned test layers, incl. manually typed tasks with no `/goal`, schedule, or toggle.
- [ ] Zero enrolled non-verified runs recorded successful; zero duplicate effects in fault-injection tests.
- [ ] `yarn testmain`, relevant `yarn test` module cases, `yarn typecheck`, `yarn test:components`,
      `yarn vue-typecheck`, `yarn test:e2e` green for changed flows; server `uv run pytest` + `ruff` + `mypy`.
- [ ] Metrics instrumented (evidence-backed completion, recovery success, incomplete reasons, extra
      resolver/maker/checker calls, actual/estimated usage labels, latency, waits, finalization conflicts,
      reconciliation) segmented by manual/scheduled origin, route, action risk; shadow baseline comparison.
- [ ] Rollback verified: flag OFF stops enrollment/continuations; enrolled runs finish frozen-policy or
      incomplete/cancelled — never fallback success; additive schema retained; quiesce before downgrade.
- [ ] Historical `completed` rows untouched (no retroactive `verified` relabel).

---

## D. Audit trail

- Audited 2026-10-05 on branch `worktree-task-completion-policy-v1-slice1`; re-verified 2026-10-05 after
  bug-fix commits landed.
- Method: full read of both PRDs; full read of all 6 `src/service/aiTaskExecution/*` files, all 3 entities,
  both models, both modules, `entityTypes`, feature gate; grep-confirmed zero live call sites in
  `AIChatQueryLoop`/`AIChatQueryEngine`/`ScheduledLoopEventSink`/`ScheduledAiMessageRunner`; ran all
  Slice 1 test suites (115/115 pass: 58 + 27 vitest via `vitest.service.config.mjs`, 30 Mocha via
  `scripts/run-module-tests.js` — note: bare `yarn vitest run` without the config fails `@/` alias
  resolution, a harness-invocation detail, not a repo bug); `tsc --noEmit` clean; executed a throwaway
  resolver probe (deleted afterward) proving R1 before the fix landed.
- Prior audit claims incorporated: B1–B8 (parallel audit agents, each verified by quoted source); B9/R1/B10
  added by lead audit. Slice 2/3/4 absence cross-checked against `git log 7ce133b2..HEAD` file list.
- Bug-fix commits: `1653ba90` (B2/B3/B6/B8), `97250c43` (B9), `2380328a` (B1), `77676058` (B4/B5),
  `ad3141c8` (B7), `bd332e26` (R1), `399d8f8c` (concurrent CAS + worker-guard tests),
  `ab9caf7c` (HARD_CAPS + policy_limits_json), `b872f221` (scoped submission uniqueness AC-26),
  `4521ff44` (B10 decision). B10 call-site wiring explicitly deferred to Slice 2 per §17.
