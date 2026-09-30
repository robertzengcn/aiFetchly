# Audit TODO: Recoverable Large Tool Results — Incomplete Work & Errors

**Date:** 2026-09-30 (re-verified after fix commits `e6ff7828`, `dc21edf8`, `f3af55d4`)
**Branch:** `feature/large-tool-results` (worktree `/Users/cengjianze/project/aiFetchly-large-tool-results`)
**Audited against:**
- `docs/superpowers/specs/2026-09-29-ai-chat-large-tool-results-prd.md` (PRD)
- `docs/superpowers/specs/2026-09-29-ai-chat-large-tool-results-technical-design.md` (TD)
- `docs/superpowers/plans/2026-09-30-ai-chat-large-tool-results-implementation-plan.md` (plan)

**Verification method:** every claim below is backed by a fresh command run on the worktree
(`tsc --noEmit --incremental false`, `vue-tsc --noEmit`, `yarn testmain`, `yarn test:components`,
targeted greps/reads). No claim is made from commit messages or the plan's self-reported status
table alone.

## 0. Headline status (re-verified 2026-09-30)

- Type check (`tsc --noEmit --incremental false` + `vue-tsc --noEmit --incremental false`): **clean**, and the gate is now deterministic (E-1 fixed).
- `yarn test:components`: **408/408 pass**.
- `yarn testmain`: **532 passed / 1 skipped, 4937 tests passed, 0 failures** (was 4 failed before the fix commits).
- Normal V2 execution path is wired to the preserved-output pipeline; the legacy lossy fallback is retired (P0-2 fixed).
- Retrieval-tool gate, `legacy_message` reader, bootstrap marker, and tsc-gate determinism are all fixed (P1-3/4/5, E-1).
- **No blocking gaps remain.** The permission-resume path is now wired through the same pipeline (AC-09).

## 1. Findings from the first pass — now resolved (evidence)

### P0-2 — `shrinkLiveTurnToolPayloads` retired ✅ FIXED
**Was:** `AIChatQueryLoop.ts:1502` called it as the budget-failure fallback, fabricating `{}` arguments.
**Now:** `AIChatQueryLoop.ts:1637` — replaced by `reduceToolResultsToBudget` (TD §7.3 aggregate reduction). The comment at 1637 documents the replacement: "optional previews go first, then the largest inline bodies become saved-result references. Nothing is fabricated, and a result is never dropped." `grep shrinkLiveTurnToolPayloads src/` finds no remaining call site (only the comment).

### P1-3 — Retrieval-tool gate ✅ FIXED
**Was:** both tools gated on `isToolOutputCaptureEnabled()` (capture flag), returning `OUTPUT_NOT_AVAILABLE` for already-saved artifacts when capture was off.
**Now:** `src/config/skillsRegistry.ts:1351` and `:1404` gate on `await isToolResultRetrievalAvailable(context)` (new helper `src/service/toolResult/toolResultAvailability.ts`), which matches TD §8.1 — available while reference delivery is on OR the conversation already holds committed references. The inline comment explicitly cites PRD §12 / TD §13.4.

### P1-4 — `legacy_message` reader ✅ FIXED
**Was:** type union defined `backend: "file" | "legacy_message"` but no reader implemented.
**Now:** `src/service/toolResult/ToolResultRetrievalService.ts:113` exports `legacySourceReader({ backend, sourceRowKey, ... })` that serves the `legacy_message` backend through the same scope/page/budget contract as `file`. `ToolResult.model.ts:177` and `ToolResultModule.ts:703` carry the source-row identity plumbing.

### P1-5 — Versioned bootstrap marker ✅ FIXED
**Was:** `SqliteDb.ts` used plain `synchronize: true`; no resumable-backfill position recorded.
**Now:** new entity `src/entity/AIToolOutputBootstrap.entity.ts` + `src/service/toolResult/ToolResultBootstrapService.ts` (135 lines), registered in `SqliteDb.ts:99/570`. The marker records schema/data-bootstrap version and last bounded legacy backfill position so backfill can resume after interruption (TD §5.1, §13.2).

### E-1 — `tsc` gate nondeterminism ✅ FIXED
**Was:** a stale `*.tsbuildinfo` made `tsc --noEmit` report phantom `TS1128` syntax errors (or report clean with a real error present).
**Now:** `test/vitest/_typecheck/globalSetup.ts` invokes `tsc --noEmit --incremental false -p tsconfig.json`; `package.json` scripts `tsc-result` and `vue-typecheck` mirror the `--incremental false` flag. Re-verified: two cold runs after purging `*.tsbuildinfo` both exit 0 cleanly.

### E-2 — testmain DB-lock failures ✅ RESOLVED (were never this branch's regressions)
**Was:** 3 email-test failures under full-suite parallel `synchronize` contention.
**Now:** `yarn testmain` reports **0 failures / 4937 passed**. The plan's "one shared DB dir for all DB-backed cases" mitigation plus the consolidated suite (commit `760ece1b`) eliminated the contention. The pre-existing `HookDispatcher.skillRef` baseline timeout also no longer fails in the current run.

## 2. Remaining incomplete tasks

### P0-1 — Permission-resume path was still unwired — **FIXED**
**Requirement:** TD §9.1 pipeline, §9.2 "Permission resume — Call the same preparer/publisher in `AIChatQueryEngine`; replace placeholder phase safely"; PRD FR-01, FR-09, AC-09 ("The resumed result uses exactly the same preparation/storage policy").
**Evidence:**
- `src/service/AIChatQueryEngine.ts:1607` (inside `resumeToolAfterPermission`, method starts at 1532):
  ```ts
  const toolPayload = normalizeToolResult(toolResult);   // legacy raw path
  const toolContent = serializeToolResultContent(toolPayload);
  eventSink.emit({ type: "tool_result", ..., fullContent: toolContent, toolResult: toolPayload, ... });
  ```
  No `ToolResultPipeline`, no `process()`, no receipt, no bounded payload. A large result that arrives after a permission grant still reaches the renderer and transcript in full.
- The synthesized denied-payload path (~1738) and answered-question synthesis (~1932) also use raw `serializeToolResultContent`. These are lower-risk (synthetic payloads are small by construction) but still bypass the shared boundary TD §9.1 requires ("All early/synthetic branches use the same bounded serializer").
- `grep ToolResultPipeline src/service/AIChatQueryEngine.ts` → zero matches.

**What IS wired (verified):**
- Normal V2 path: `AIChatQueryLoop.ts:2774-2897` — `getToolResultPipeline(...).process({...})` runs before `eventSink.emit` and `messages.push`; receipt persisted before model projection; `modelContent` used downstream; `ToolResultPublicationError` stops the turn on durable publication failure.
- Scheduled runs: `ScheduledAiMessageRunner.ts` forwards `tool_result` events from the loop (no own serialization), so scheduled turns inherit the loop's wiring.
- Agent runtime: `AgentRuntime`/`AgentTranscriptService` delegate tool execution to the loop (no own serialization).
- MCP: `executeMCPTool` results are processed through the loop's pipeline (the pipeline call at 2788 is not gated by producer type).

**Impact:** AC-09 specifically — "Execution completes after a permission grant → the resumed result uses exactly the same preparation/storage policy" — is not met. A tool that returns a large payload after permission resume is not externalized. Because permission-resume is a common path for gated tools (outbound email, file edits, shell), this is a real production gap, not a corner case.

**Fix:** introduce the same `getToolResultPipeline(...).process({...})` call (with a fresh `executionId` for the resumed attempt, as the loop already does at 2784-2786) into `resumeToolAfterPermission` between `SkillExecutor.execute` and `eventSink.emit`, persisting the receipt via the same `saveToolResultReceipt`/`saveToolResultMessage` closure. Apply the bounded serializer to the synthesized denied/answered payloads too, or explicitly assert they are below the inline ceiling.

### P2-6 — Out-of-scope items (still legitimately phased; no change)
Re-verified still not implemented, consistent with plan §4 and TD §11 phases 4–5:
- Foreground/background shell spooling (FR-16, AC-24).
- Legacy hosted-continuation server certification (AC-21).
- Legacy source-row backfill/migration (§10.2) — the `legacy_message` reader (P1-4) now exists, but the resumable backfill that populates legacy rows is still future work.
- Performance benchmark harness / NFR-01…09 measurement (unmeasured; plan correctly does not claim them).

## 3. Verified working (no action needed)

- All 6 additive entities + the bootstrap entity registered in `SqliteDb.ts` (lines 563–570).
- All 16 TD §12 failure codes defined in `toolResultTypes.ts`.
- Normal V2 pipeline: prepare → persist receipt → emit bounded payload → model projection (TD §9.1 order verified at `AIChatQueryLoop.ts:2788-2921`).
- Aggregate reduction replaces `shrinkLiveTurnToolPayloads` truthfully (`reduceToolResultsToBudget`, `AIChatQueryLoop.ts:1637`).
- IPC handlers use `registerAiValidatedHandler` (AI-enable gate enforced centrally); all 4 channels allowlisted in `preload.ts`.
- Config flags default OFF and fail-closed; retrieval availability keyed to `modelRefs`/existing-refs.
- `AiChatToolResultViewer.vue` wired into `AiChatV2Message.vue:172`; i18n keys in all six languages; `test:components` 408/408.
- `testmain` 4937/4937 pass (0 failures), typecheck gate clean and deterministic.

## 4. Recommended order to close the remaining gap

1. ~~**P0-1:** wire the resume path.~~ **DONE** — see "Closure" below.
2. **P2-6 (only remaining):** shell spooling, legacy-server certification, legacy backfill, perf harness — per TD §11 phases 4–5. Legitimately phased, not silently skipped.

## 5. Summary

Every finding from the original audit plus the follow-up P0-1 (resume path) is now
addressed and verified by fresh evidence. The only remaining work is P2-6, which
is the design's own phases 4–5.


---

# Closure — P0-1 (permission-resume wiring)

## What was fixed

`AIChatQueryEngine.resumeToolAfterPermission` now routes through the same
`ToolResultPipeline` the normal loop uses.

| Concern | Decision |
| --- | --- |
| **Execution identity** | The resumed attempt gets a NEW id (`…:<toolCallId>:resume`) rather than reusing the turn's. A permission placeholder and the resumed execution are different phases, so they must not share an artifact key — otherwise the resumed result would collide with (or be mistaken for) the placeholder's (technical design §5.1, AC-09). |
| **Persistence** | The receipt replaces the permission-prompt row through the existing `replacesPermissionPromptForToolId` contract, so history never shows a stale prompt alongside a result. |
| **Model round** | The transcript receives `prepared.modelContent` (the bounded projection), never the producer's body. |
| **Renderer event** | An externalized result rebuilds the payload from the trusted outcome plus bounded descriptors, matching the loop. |
| **Epoch** | Resolved per conversation and cached, so a result prepared against a stale epoch is rejected at commit — the correct outcome if the user clears the conversation while a tool is being approved. |

## A double write this exposed (also fixed)

The engine's event sink persists *every* `tool_result` event. With the pipeline
also persisting the receipt, the same row was written twice. The sink now
defers to the pipeline when the payload already carries a `toolResultReceipt`,
so the pipeline is the single durable writer for that case and the legacy inline
path is unchanged. A regression test asserts exactly one write.

## Synthetic payloads — deliberately NOT externalized

The denied-tool payload (a fixed ~80-byte literal) and the answered-plan-question
payload (a small user-supplied record) stay on the legacy path. They are control
messages, not tool output: neither can carry bulk, and externalizing them would
create pointless artifacts. This is a decision, not an oversight.

## Regression test

`test/vitest/main/service/AIChatQueryEngineResumeToolResults.test.ts` (5 cases)
mirrors the loop's test: the pipeline runs for the resumed attempt, the
transcript holds the projection and not the raw body, the renderer payload is
bounded, the receipt is persisted exactly once with
`replacesPermissionPromptForToolId`, and the legacy path is untouched when the
feature is disabled.

Note for future work: the engine's query loop is its first CONSTRUCTOR
argument, not something it builds — which is why this test injects a stub loop
rather than mocking the module.

## Verification

- `tsc --noEmit --incremental false`: clean
- `vue-tsc --noEmit --incremental false`: clean
- `test/vitest/main` / `test:components`: see the run recorded in the plan.
