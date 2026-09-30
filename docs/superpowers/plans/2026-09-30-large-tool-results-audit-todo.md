# Audit TODO: Recoverable Large Tool Results — Incomplete Work & Errors

**Date:** 2026-09-30
**Branch:** `feature/large-tool-results` (worktree `/Users/cengjianze/project/aiFetchly-large-tool-results`)
**Audited against:**
- `docs/superpowers/specs/2026-09-29-ai-chat-large-tool-results-prd.md` (PRD)
- `docs/superpowers/specs/2026-09-29-ai-chat-large-tool-results-technical-design.md` (TD)
- `docs/superpowers/plans/2026-09-30-ai-chat-large-tool-results-implementation-plan.md` (plan)

**Verification method:** every claim below is backed by a fresh command run on the worktree
(`tsc --noEmit`, `vue-tsc --noEmit`, `yarn testmain`, `yarn test:components`, targeted greps/reads).
No claim is made from commit messages or the plan's self-reported status table alone.

## 0. Headline status

- Type check (`tsc --noEmit` + `vue-tsc --noEmit`): **clean** (after purging stale `*.tsbuildinfo`; see E-1).
- `yarn test:components`: **408/408 pass**.
- `yarn testmain`: 4 failed / 4923 passed. Of the 4 failures, **0 are caused by this branch**
  (3 are parallel-DB-lock flakiness; 1 is a pre-existing baseline failure on `master` — see E-2).
- Service/storage/retrieval/budget/publisher/recovery layers are implemented and unit-tested.
- **The feature is completely inert in production** (P0-1): the live execution loop does not call
  the new preparer/publisher, so no result is ever externalized. With the rollout flags OFF and no
  caller, flipping the flags ON produces no behavior change.

## 1. Incomplete tasks (PRD/TD requirements not met)

### P0-1 — Execution-path wiring is not done (Unit 10) — **BLOCKING**
**Requirement:** TD §9.1 pipeline, §9.2 adapter coverage; PRD FR-01, FR-02, FR-08, FR-09, AC-01…AC-18.
**Evidence:**
- `grep ToolResultPreparationService src/` → the symbol appears **only in its own definition**
  (`ToolResultPreparationService.ts:124`). Zero non-test callers anywhere in
  `src/service/`, `src/modules/`, `src/main-process/`.
- `src/service/AIChatQueryLoop.ts` still calls the legacy path:
  - `normalizeToolResult(toolResult)` at lines 2614, 3504, 3511.
  - `shrinkLiveTurnToolPayloads(messages)` at line 1502 — the exact mechanism TD §2 says is
    "retired from the new path" and whose "broad string slicing and argument replacement are not
    acceptable substitutes for preservation."
- `src/modules/AIChatV2Module.ts:saveToolResultMessage` (line 192) is unchanged in its
  result-serialization responsibility; it is not routed through the publisher.
- `src/service/ScheduledAiMessageRunner.ts` and `src/service/AgentRuntime.ts` have **no**
  references to the preparer/publisher (only legacy `event.toolResult?.needsPermissionPrompt`).
  So TD §9.2 "Scheduled loops" and "Agent runtime" adapter coverage is also unimplemented, not
  just the normal V2 path.

**Impact:** None of FR-01/02/08/09 are actually delivered to a running conversation. Every
acceptance criterion that depends on a real result being externalized (AC-02, AC-03, AC-04,
AC-07, AC-08, AC-09, AC-10, AC-12, AC-13, AC-16, AC-17, AC-18, AC-24, AC-25, AC-26) cannot be
exercised end-to-end. The plan's delivery-sequence phase 3 ("V2 publication and budget") is the
missing work.

**Plan acknowledges this** ("Unit 10 — Partial"), but the plan understates it: it frames the gap
as only the normal V2 loop, while the scheduled, agent, MCP, and legacy resume paths (TD §9.2)
are also unwired.

### P0-2 — `shrinkLiveTurnToolPayloads` is still the active oversized-result mechanism
**Requirement:** TD §2 explicitly retires it; PRD principle 7 ("Reduction happens before
distribution").
**Evidence:** `AIChatQueryLoop.ts:1502` still calls it as the budget-failure fallback, and it
still replaces older large arguments with `{}` (the fabricated-argument problem TD §1 invariant 6
forbids).
**Fix:** must be replaced by the truthful budget-failure path (P0-1) once the loop is wired.

### P1-3 — Retrieval-tool activation gates on the wrong flag
**Requirement:** TD §8.1 — `tool_result_read`/`tool_result_search` "available in the core tool
set while new reference delivery is enabled **or** existing references are present."
**Evidence:** `src/config/skillsRegistry.ts:1343` and `:1401` gate both tools on
`isToolOutputCaptureEnabled()` (the `capture` flag). The design ties availability to
`modelRefs` (model-visible references) and to the presence of existing references, not to whether
new capture is on. With capture off (the default) the tools return `OUTPUT_NOT_AVAILABLE` even
for previously committed artifacts — contradicting PRD §12 ("Disabling new capture must not
disable reading already committed output") and TD §13.4 ("Turning capture off … does not
unregister readers for existing references").
**Fix:** gate on `isToolOutputModelRefsEnabled() || hasAnyToolResultReferences(context)` (or
equivalent), not on `capture`.

### P1-4 — `legacy_message` backend is defined in types but not implemented
**Requirement:** TD §5.1 (`backend: "file" | "legacy_message"`), §10.2 (legacy source-row
fallback reader), §10.2 last paragraph ("Both readers enforce the same scope/page/budget
contract").
**Evidence:** `grep legacy_message` across `src/model/ToolResult.model.ts`,
`ToolResultStorageService.ts`, `ToolResultRetrievalService.ts` returns nothing. The retrieval
service only serves the `file` backend. A legacy artifact cannot be read through the tools.
**Status:** consistent with the plan's "legacy backfill out of scope," but the plan claims "Every
one of these has its public contract, error code, and config flag defined now." The type union
is defined; the reader is not. This is acceptable only as long as no `legacy_message` row is
ever written — which is guaranteed today only because P0-1 means nothing writes any row.

### P1-5 — Versioned bootstrap marker is missing
**Requirement:** TD §5.1 ("Versioned bootstrap marker … resume after interruption"),
§13.2 ("introduce a versioned idempotent bootstrap for this feature's indexes and data backfill.
Do not pretend a new migration file will run automatically.").
**Evidence:** `src/config/SqliteDb.ts:617` still uses `synchronize: true`; `grep bootstrap` in
`SqliteDb.ts` and `toolResultConfig.ts` returns nothing. There is no bootstrap marker entity or
resumable-backfill position recorded.
**Status:** not blocking while backfill is out of scope, but it means a future backfill cannot
resume safely after interruption, and a schema change on a populated production DB will rely on
TypeORM `synchronize` heuristics rather than an idempotent bootstrap. Should be done before any
rollout that writes real rows.

### P2-6 — Out-of-scope items (acknowledged, listed for completeness)
The plan §4 declares these out of scope; verified they are genuinely not implemented:
- **Foreground/background shell spooling** (FR-16, AC-24): no capture-handle wiring in
  `ShellToolService.ts` / `BackgroundShellRegistry.ts`. Producer truncation is therefore not
  preserved through the artifact cap.
- **Legacy hosted-continuation certification** (AC-21): no contract fixture against
  `/api/ai/ask/continue`; `aiChatApi.ts:streamContinueWithToolResults` unchanged.
- **Legacy source-row backfill/migration** (§10.2): `AIChatMessageArchiveModel.readSourceSlice*`
  still materializes full content fields (P1-4 above).
- **Performance benchmark harness / NFR-01…09 measurement**: no fixture found; numbers are
  unmeasured (the plan correctly does not claim them).

These are legitimately phased (TD §11 phases 4–5), not silent skips. No action required for the
first V2 release boundary except ensuring P0-1 lands first.

## 2. Errors found

### E-1 — `tsc` typecheck gate is flaky under incremental builds (CI-reliability bug)
**Symptom:** Running `node_modules/.bin/tsc --noEmit -p tsconfig.json` produced a flood of
phantom syntax errors starting at `ToolResultPreparationService.ts(184,3): TS1128`, while the
identical command run minutes earlier exited 0, and `yarn testmain`'s globalSetup gate passed.
**Root cause:** stale `*.tsbuildinfo` incremental cache. Purging all `*.tsbuildinfo` files makes
`tsc` exit clean again. The file is syntactically valid (confirmed via standalone TS-API parse:
only module-resolution errors, no syntax errors).
**Why it matters:** the Vitest globalSetup (`test/vitest/_typecheck/globalSetup.ts`) runs the
same `tsc --noEmit`. A poisoned cache can (a) make CI report phantom errors, or (b) worse,
report clean when there is a real error. This is not a feature-code defect, but it is a real
release-blocking reliability issue because the gate's verdict is non-deterministic.
**Fix:** disable incremental caching for the gate invocation (`tsc --noEmit --incremental:false`
or a dedicated `tsconfig.typecheck.json` without `incremental`), and/or have the gate delete
`*.tsbuildinfo` before running. Reproduces reliably: `git clean -ndx` is not needed; just
`find . -name '*.tsbuildinfo' -not -path './node_modules/*'` shows the stale file.

### E-2 — Three `testmain` failures are DB-lock flakiness, not regressions (false alarm — documented)
**Symptom:** `yarn testmain` reports 4 failed:
- `EmailReplyKnowledgeService.test.ts` ("knowledge scope unreadable; abstaining")
- `EmailReplyApprovalValidation.test.ts` (P0.4 approval blocked)
- `EmailReplyV2IdentityDelivery.test.ts` (`SqliteError: database is locked` during
  `SqliteDb` `synchronize`)
- `HookDispatcher.skillRef.test.ts` (5000ms timeout)
**Evidence:** Running the same 4 files in isolation (`npx vitest --config vite.main.config.mjs
run <the 4 files>`) with the cache purged → **only `HookDispatcher.skillRef` fails** (the known
baseline failure). The 3 email failures disappear. They only manifest under full-suite parallel
pressure because `SqliteDb` holds a process-wide singleton and parallel `synchronize` runs
contend (exactly the "Test-suite pressure" note in the plan). No source file in the email/knowledge
area was touched by this branch (`git diff --name-only master...HEAD | grep -iE 'email|knowledge|approval|identity'` → empty).
**Verdict:** not caused by this branch. Documented for traceability — do not treat as feature
failures. (The deeper `database is locked` flakiness is a pre-existing test-isolation issue
tracked separately; the plan's mitigation — one shared DB dir for all DB-backed cases — is
already applied.)

## 3. Things verified as actually working (no action needed)

- All 6 additive entities (`AIToolOutputScope`, `AIToolOutput`,
  `AIToolOutputReservation`, `AIToolOutputGrant`, `AIToolOutputRetrievalBudget`,
  `AIToolResultProjection`) are registered in `SqliteDb.ts` (lines 563–568).
- All 16 TD §12 failure codes are defined in `toolResultTypes.ts` (verified distinct-code count).
- IPC handlers use `registerAiValidatedHandler` → AI-enable gate (`ensureHostedAiEnabled`) is
  enforced centrally before payload parsing (satisfies CLAUDE.md AI-feature rule).
- All 4 IPC channels allowlisted in `preload.ts` (lines 258–261, 983–986) — no silent-`undefined`
  regression.
- Config flags (`capture`/`modelRefs`/`ui`) default OFF and fail-closed (documented in
  `toolResultConfig.ts:150–166`).
- `AiChatToolResultViewer.vue` is wired into `AiChatV2Message.vue:172` (lazy import + render),
  and `AiChatV2Message.vue:770` lazy-imports the export API. Viewer is reachable from the card.
- i18n keys added to all six language files; `test/vitest/main/i18nKeysPresent.test.ts` passes.
- `test:components` suite (incl. `AiChatToolResultViewer.test.ts`,
  `AiChatV2Message.toolOutputCard.test.ts`) — 408/408 pass.

## 4. Recommended order to close the gaps

1. **P0-1 / P0-2:** wire `ToolResultPreparationService` + `ToolResultPublisher` into
   `AIChatQueryLoop` (replace `normalizeToolResult`+`shrinkLiveTurnToolPayloads`), then
   `AIChatQueryEngine` resume, `ScheduledAiMessageRunner`, `AgentRuntime`, MCP, legacy
   `StreamEventProcessor`/`ToolExecutionService`. Land with `modelRefs` flag OFF by default; only
   flip ON once retrieval is exercised end-to-end (TD §13.4). This is the single largest piece of
   unfinished work and gates the entire release.
2. **P1-3:** fix the retrieval-tool activation condition to match TD §8.1 (modelRefs OR existing
   references), not capture.
3. **E-1:** make the typecheck gate deterministic before relying on it for the P0-1 rollout.
4. **P1-5:** add the versioned bootstrap marker before any rollout that writes production rows.
5. **P1-4 / P2-6:** legacy backfill + `legacy_message` reader, shell spooling, legacy-server
   certification, perf harness — per TD §11 phases 4–5.

## 5. Summary

The branch ships a complete, tested, well-factored *substrate* (contracts, storage, retrieval,
budget, publisher, recovery, UI, i18n, IPC) but has **not connected the substrate to the running
application**. The plan is honest that Unit 10 is partial; this audit's addition is that the gap
is broader (scheduled + agent + MCP + legacy resume paths too), the `shrinkLiveTurnToolPayloads`
removal is not yet done, the retrieval-tool gate is on the wrong flag, the `legacy_message`
reader and bootstrap marker are absent, and the `tsc` gate is nondeterministic. None of these are
hidden; all are reproducible from the evidence above.
