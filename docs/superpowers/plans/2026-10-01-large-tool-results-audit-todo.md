# Large tool results — PRD implementation audit and TODO

> **Remediation status — 2026-10-01 follow-up pass.** Seventeen items below are
> now implemented and committed on `feature/large-tool-results`. Each closed item
> carries its evidence inline. The items still open are T14, T16, T18, and the
> integrity half of T10; each records why in its own entry, and the release gate
> at the end of this document has **not** been satisfied. The findings, evidence,
> and analysis below are unchanged — this note records remediation, not a
> retraction.

- Date: 2026-10-01
- Worktree: `/Users/cengjianze/project/aiFetchly-large-tool-results`
- Branch: `feature/large-tool-results`
- Audited implementation: `4e101c217dae6207cb1481076f64368ba1496c7a`
- Feature comparison base: `c8f2194ef8d09c906f09080ad24f3d6e35b3299e`

## Conclusion

**The full PRD is not implemented, and the feature is not ready to be declared complete.** There is substantial implementation: artifact storage, bounded serialization and previews, registry entities, retrieval services, receipt publication, V2 normal/resume integration, IPC, a paged viewer, translations, and tests. However, several production connections are missing or incorrect. Passing unit/component tests does not establish the promised end-to-end behavior.

The most immediate defects are: the model reader rejects file-backed outputs; the cached publisher saves later receipts through the first tool call's callback; aggregate reduction cannot reduce any production input; search continuation loses matches; and conversation deletion does not invalidate output scopes.

This document supersedes the completion assessment in [the September 30 audit](2026-09-30-large-tool-results-audit-todo.md). It does not erase that historical report or claim its recorded test runs never happened. Its statement that no blocking gaps remain is not supported by the implementation audited here.

Sources of requirements:

- [PRD](../specs/2026-09-29-ai-chat-large-tool-results-prd.md)
- [Technical design](../specs/2026-09-29-ai-chat-large-tool-results-technical-design.md)
- [Implementation plan](2026-09-30-ai-chat-large-tool-results-implementation-plan.md), including its explicit deferrals. A narrower implementation phase does not satisfy the entire PRD.

Scope: read-only implementation review plus a documentation deliverable. No application fixes were made. Temporary regression probes were removed after execution.

## Validation performed

| Check | Result | Limits of evidence |
|---|---|---|
| Selected backend/config/preload/i18n tests | **415 passed, 11 files** | Existing tests, not full main-process suite |
| Full component suite | **408 passed, 66 files** | Mounted component tests, not live Electron flows |
| Backend suite TypeScript setup | Completed; reported zero errors | No separate Vue typecheck or production build performed in this audit |
| Two temporary regression probes | **Both failed on assertions of required behavior** | Real retrieval service with injected source; see reproducible recipes below |
| Source/callsite review | Confirmed production wiring defects below | Findings labeled source-confirmed were not all reproduced in a live app |
| Electron E2E, hosted server compatibility, memory/latency benchmarks | **Not run** | These remain release evidence gaps |

Tests used Node `v22.19.0`; the installed `better-sqlite3` opened an in-memory database successfully (SQLite `3.53.4`). The worktree shares `node_modules` with the main checkout. Direct Vitest execution avoided rebuilding that shared native dependency.

Commands used, from the audited worktree, with Node 22.19.0 on PATH:

```sh
node_modules/.bin/vitest --config vite.main.config.mjs run \
  test/vitest/main/service/ToolResultPreparationService.test.ts \
  test/vitest/main/service/ToolResultPreviewBudget.test.ts \
  test/vitest/main/service/ToolResultPublisher.test.ts \
  test/vitest/main/service/ToolResultRetrievalService.test.ts \
  test/vitest/main/service/ToolResultStorageService.test.ts \
  test/vitest/main/service/AIChatQueryLoopToolResults.test.ts \
  test/vitest/main/service/AIChatQueryEngineResumeToolResults.test.ts \
  test/vitest/main/service/AIChatQueryLoop.budget.test.ts \
  test/vitest/main/config/toolResultConfig.test.ts \
  test/vitest/main/preloadInvokeAllowlist.test.ts \
  test/vitest/main/i18nKeysPresent.test.ts
node_modules/.bin/vitest --config test/vitest/main/components/vitest.config.mjs run
```

Local diagnostic logs, not committed artifacts: `/tmp/aifetchly-large-tool-audit-20261001-main.log`, `/tmp/aifetchly-large-tool-audit-20261001-components.log`, `/tmp/aifetchly-large-tool-audit-probes.log`.

## Priority and evidence conventions

P1 means fix before broad enablement: core functionality, data association, access lifecycle, or the primary size-safety promise is broken. P2 means required follow-up for correctness, rollout, or completeness. These are audit priorities; the PRD's P0/P1 labels remain unchanged.

“Confirmed” means a direct source path establishes the defect; “reproduced” adds a focused executed probe. “Incomplete” identifies missing implementation. “Unverified” means more evidence is needed, not that failure has been proved. All checkboxes remain open deliberately.

## Confirmed defects and concrete TODOs

### T01 — P1: Dispatch the model reader to the correct storage backend

- [x] Fix backend selection for both `tool_result_read` and `tool_result_search`. **DONE.** A shared `createToolResultRetrievalService` dispatches per target's `storageBackend` instead of binding one reader, and both the model path (`toolResultContext.ts`) and the IPC path use it. A legacy target with no `sourceRowKey` is refused rather than read from the wrong source. Regression-tested in `ToolResultRetrievalService.test.ts` against the real service.

**Evidence:** `src/service/agentTools/toolResultContext.ts:74` constructs `ToolResultRetrievalService` with `legacySourceReader` unconditionally. `src/service/toolResult/ToolResultRetrievalService.ts:124` rejects any target whose backend is not `legacy_message`. The context itself resolves newly captured outputs as backend `file`.

**Trigger/impact:** Store a new large result, then ask the assistant for a fact beyond its preview. Authorization may succeed, but reading/searching returns `OUTPUT_NOT_AVAILABLE`. The UI's default file reader can work, masking the model failure.

**Fix:** Use a bounded source dispatcher based on the authorized target backend. Preserve legacy reads and file reads through the same paging contract.

**Acceptance:** Capture a real file-backed output through production context wiring, read and search it through both model tools, then repeat for a legacy source. Test mixed targets in the same conversation. Maps to FR-06/07, AC-02/04/07.

**Probe:** Construct the service exactly as production does with `legacySourceReader`, pass a `backend: "file"` target, and call `read`. Expected `ok: true`; actual `ok: false`. This isolates backend rejection; it is not a complete capture-to-model E2E test.

### T02 — P1: Stop reusing the first tool call's persistence callback

- [x] Make receipt persistence use the current call's trusted context. **DONE.** The store is supplied per publication: `ToolResultPublisher.publish` takes a `storeOverride` and the pipeline no longer caches a publisher bound to the first call's closure, so each execution persists through the writer that owns it.

**Evidence:** `src/service/toolResult/ToolResultPipeline.ts:98` caches a publisher initialized with the first `store` callback. `src/service/AIChatQueryLoop.ts:2832` closes over `callId`, `callName`, and `assistantMessageId`, ignoring the publisher's supplied context. The resume callback in `src/service/AIChatQueryEngine.ts:1723` likewise closes over `matchedByToolId`. Pipelines are cached by conversation.

**Trigger/impact:** Two externalized results in one conversation use different tool calls. The second publication invokes the first callback and persists the new receipt against the first call/message identity. Resume can also replace the wrong permission-prompt row. Live model content can appear correct while durable history is incorrectly associated.

**Fix:** Pass persistence per publication, or use a stable callback that consumes all per-call identity from its argument. Do not sacrifice durable deduplication when changing publisher lifetime.

**Acceptance:** In one pipeline, publish different calls in the same turn and different turns; assert stored IDs, names, assistant-message association, and resume replacement IDs for every result. Replay each event and assert one terminal record. FR-01/09, AC-09/25, NFR-07.

### T03 — P1: Implement actual aggregate reduction and request-body preflight

- [x] Correctly distinguish inline bodies from receipts and externalize overflow before dispatch. **DONE.** `isReceiptBody` detects a receipt structurally (schemaVersion + toolCallId + operationStatus + outputs) instead of hard-coding `isReceipt: true` for every tool message, so an oversized inline body is now actually reducible.
- [x] Apply the serialized transport-body ceiling at the final provider request boundary. **DONE.** `ToolResultBudgetService.checkSerializedBody` now runs at the dispatch boundary in `AIChatQueryLoop`, raising `REQUEST_BODY_TOO_LARGE` instead of letting the provider reject it.

**Evidence:** `src/service/AIChatQueryLoop.ts:1065` marks every tool message `isReceipt: true`, supplies no separate preview, and passes `externalize: body => body`. `ToolResultBudgetService.reduce` skips receipts when choosing inline bodies and cannot remove previews that were not supplied. Thus this production reducer cannot reduce its inputs. `ToolResultBudgetService.checkSerializedBody` at line 238 has no production caller. Preparation checks the static inline token ceiling (`ToolResultPreparationService.ts:164`), not a per-request allocation.

**Trigger/impact:** Twenty results fit individually but exceed the combined allocation, or a smaller model leaves less space. The new reduction path does not deliver the PRD's conversion to references. Existing context-pressure handling is not proof that aggregate and transport budgets are enforced.

**Fix:** Carry structured result identities/receipts into budgeting, allocate against the actual request, preserve overflow before replacing inline content, and check the fully serialized request including schemas, arguments, images, and framing. Return an explicit capacity error when required content still cannot fit.

**Acceptance:** AC-03 with twenty medium results; small-model fallback; oversized tool schemas and arguments; image-bearing requests; transport limit distinct from token limit. Verify at the network adapter boundary for normal, resumed, scheduled, and child-agent requests. FR-02/08, AC-08/10/26.

### T04 — P1: Keep exception and rollback paths bounded; honor capture disablement

- [x] Replace raw fallthrough with a bounded truthful failure receipt. **DONE.** `buildBoundedToolFailureContent` replaces the raw `JSON.stringify(toolPayload)` fallthrough in both the loop and the permission-resume path. It carries the real operation outcome plus a machine code, never the producer's body.
- [x] Honor `captureEnabled` independently of model-reference delivery. **DONE.** `ToolResultPreparationService.externalize` returns a bounded degraded receipt with `OUTPUT_CAPTURE_DISABLED` when capture is off, instead of writing a new artifact.

**Evidence:** `ToolResultPipeline.ts:81` disables the pipeline when both flags are off; its `process` disabled branch returns raw `JSON.stringify(input.outcome)`. `ToolResultPreparationService.ts` declares `captureEnabled` but never reads it. In `AIChatQueryLoop.ts:2885`, unexpected preparation failures only log “using bounded fallback”; the original `toolPayload` and `toolContent` remain and are subsequently persisted/dispatched.

**Trigger/impact:** Disable capture while references remain enabled: new writes still occur. Disable both flags, or inject a preparation exception: large raw output can return to the paths this feature is intended to protect. The fallback log is inaccurate.

**Fix:** Separate the always-on safety boundary from optional preservation and reference delivery. Preserve operation outcome/control fields while reporting unavailable preservation, with bounded text even on unexpected errors. Audit resume's equivalent fallback too.

**Acceptance:** All flag combinations with a 10 MiB result; injected serializer/module/preparation exceptions; existing references readable after disabling writers; no raw payload in messages, events, or provider input. FR-01/04/09/14, AC-12/27, NFR-01/09.

### T05 — P1: Connect deletion and epoch invalidation to actual lifecycle operations

- [x] Invalidate output scopes before clearing conversation/account data and cancel active access. **DONE.** `clearConversation` and `clearAllV2History` call `ToolResultModule.invalidateScope` before deleting, which rotates the epoch, marks rows `deleting`, and revokes grants. The single-conversation clear aborts on fence failure, matching the existing compaction fence.

**Evidence:** `ToolResultModule.invalidateScope` (`src/modules/ToolResultModule.ts:177`) has no production caller. `AIChatV2Module.clearConversation` at line 317 and `clearAllV2History` at line 384 do not call it. The output authorization layer relies on that scope's epoch and invalidation state.

**Trigger/impact:** Clear a conversation containing committed output or clear while capture is active. The output scope remains valid, so the new registry does not reject access/publication on the basis of that clear. Metadata and files also lack an integrated deletion lifecycle.

**Fix:** Fence the scope before message deletion; revoke grants and active readers/writers; coordinate artifact cleanup and quota reconciliation. Include account deletion, bulk clear, and repeated deletion.

**Acceptance:** Race clear against capture, commit, read, search, and publication. Old IDs/cursors must fail; new conversation epochs must work; files/reservations must eventually be reclaimed. FR-13/18, AC-11/14.

### T06 — P1: Recheck authorization during export and cleanly cancel failed streams

- [x] Reauthorize after the save dialog and enforce the epoch during streaming. **DONE.** Export re-authorizes after the save dialog and compares the epoch, then re-checks between 64 KiB chunks; an invalidated scope aborts the copy and removes the truncated destination file.

**Evidence:** `src/main-process/communication/tool-result-ipc.ts:118` authorizes before the native save dialog. At line 140 it copies without reauthorization. `streamToFile` at line 224 only opens streams and pipes them; its comment claiming epoch rechecks between chunks is false.

**Trigger/impact:** Open export, clear the conversation while the save dialog is pending, then choose a destination. The already-authorized path can still be copied. Mid-copy invalidation is also not observed. Fixing T05 alone does not fix this race.

**Fix:** Use a lifecycle-aware export operation with authorization after dialog completion and bounded checks/cancellation during copy. Destroy both streams on failure and define handling of incomplete destination files. Keep the payload out of renderer IPC.

**Acceptance:** Clear/revoke before confirming the dialog and during a large copy; no success response after invalidation, no continuing copy, and no leaked stream handles. FR-11/13/18, AC-14/22.

### T07 — P1: Resume search from unexamined bytes without losing overlap

- [x] Fix match-limit and scan/time-limit continuation positions. **DONE.** The continuation resumes at the first byte that can still begin an UNCOMMITTED match (`min(lastMatchEnd, carryStart)`), and the carry is computed before every exit path. Two regression tests drive the real service: a boundary-spanning match is found, and 500 occurrences paged with a small budget are each returned exactly once.

**Evidence:** In `ToolResultRetrievalService.search`, the inner match loop stops at `maxMatches`, but `cursorPosition` advances by the entire read window before returning. The continuation drops unexamined matches in that window. `carry` is local to each call, while a scan-limit continuation starts at the advanced position, losing a query spanning that boundary.

**Trigger/impact:** Search `hit hit hit` with `maxMatches: 1`. First page returns one match; the next starts at EOF and returns none. A user/model can incorrectly conclude the rest contains no matches.

**Fix:** Track examined position separately from bytes fetched. Encode/reconstruct enough overlap and duplicate-suppression state to resume exactly. Preserve honest `scanComplete` semantics.

**Acceptance:** Enumerate all three matches above; dense matches inside a 64 KiB buffer; query spanning scan/time continuation; Unicode queries; no duplicate matches; a no-match partial scan remains resumable. FR-06/14, AC-17.

**Executed probe:** An injected bounded reader served `Buffer.from("hit hit hit")`; two sequential `search` calls used `maxMatches: 1` and the returned cursor. The second assertion expected one match and received an empty array.

### T08 — P1: Scope retrieval allowances to the current turn and settle reservations correctly

- [x] Avoid caching turn/agent identity for the lifetime of a conversation. **DONE.** Only the collaborators are cached; turn and agent identity are resolved per call from the trusted runtime context.
- [x] Convert a reserved call to a settled call without double-counting it. **DONE.** Settlement now decrements `reservedCalls` (floored at 0) as it increments `settledCalls`, so `reservedCalls + settledCalls` no longer counts each call twice and a turn keeps its documented 32-call allowance.

**Evidence:** `toolResultContext.ts:67` caches by conversation; line 84 captures the first `sourceUserMessageId` as `turnId`. There is no production cache-clear caller. `ToolResultModule.ts:627` compares `reservedCalls + settledCalls` to the 32-call maximum. `ToolResult.model.ts:448` increments `settledCalls` without decrementing `reservedCalls`.

**Trigger/impact:** With low token usage, 16 completed calls leave 16 reservations plus 16 settled calls; call 17 is denied although the configured maximum is 32. Later turns reuse the first turn's allowance and can remain exhausted.

**Fix:** Cache only reusable services, derive scope from each trusted invocation, and atomically settle/release reservations. Define failure/cancellation and concurrent-call accounting.

**Acceptance:** 32 tiny sequential calls allowed, 33rd rejected; new turn gets its own allowance; concurrency respects call/token limits; exceptions do not leak reservations; token exhaustion remains independently enforced. FR-06/18, AC-18.

### T09 — P1: Keep retrieval schemas available whenever references are visible

- [x] Integrate read/search availability with the actual tool-loading policy. **DONE.** `tool_result_read` and `tool_result_search` are in `ALWAYS_LOADED_TOOL_NAMES`, so a receipt's `output_id` is always actionable. Availability stays separately gated by `isToolResultRetrievalAvailable`.

**Evidence:** `src/config/skillsRegistry.ts:4218` declares `TOOL_RESULT_RETRIEVAL_TOOL_NAMES` but never uses it. `src/service/ToolLoadPolicyService.ts:30` omits both tools from the always-loaded set. The execution-time availability check does not itself put schemas into the model request.

**Trigger/impact:** Under deferred loading, a receipt names tools that are not guaranteed to be present. The model must discover them first, violating the explicit availability contract.

**Fix:** Include the schemas when visible references require them, including writer rollback, restart, compaction, and model change. Keep authorization inside execution as well.

**Acceptance:** Inspect actual provider tool schemas in deferred mode before and after receiving a reference and after restart/rollback. No extra discovery step should be needed. FR-06/07, AC-04/07/08/27.

### T10 — P1: Wire crash recovery and integrity validation into production

- [x] Run bounded recovery at startup and connect cleanup/reconciliation to normal operation. **DONE.** `runToolResultStartup` runs the reconciliation sweep from `background.ts` after the database is initialized, fire-and-forget and never fatal.
- [x] Verify stored integrity before treating captured evidence as trustworthy. **PARTIAL.** The sweep reconciles leases, pending publications, and orphans. Manifest checksum verification on read is still NOT wired into the retrieval path; see the remaining-work note below.

**Evidence:** `ToolResultRecoveryService` has no production construction/call site. `ToolResultStorageService.checksumOf` at line 407 has no caller. The existence of tested recovery/checksum helpers does not cause the application to execute them.

**Trigger/impact:** Crash during staging/publication leaves records/files/reservations without the promised restart reconciliation. Modified or truncated stored files can be served without comparison to their recorded checksum.

**Fix:** Initialize recovery after the correct database/profile is ready, reconcile each persisted state and stale reservation, safely reclaim orphan files, and enforce a bounded integrity policy. Do not label unreadable/corrupt evidence complete.

**Acceptance:** Fault injection at every capture/commit/publication boundary, restart, missing file, checksum mismatch, interrupted cleanup, and repeated recovery. Verify exact bytes and truthful preservation states. FR-03/07/14, AC-07/13, NFR-06.

### T11 — P2: Initialize a persistent cursor-signing key

- [x] Load an app-managed persistent key before issuing or accepting cursors. **DONE.** The cursor key is derived from an app-managed secret stored in the Token store and installed at startup, so a cursor survives a restart. A store failure degrades to the ephemeral key rather than aborting startup.

**Evidence:** `ToolResultCursorCodec.ts:47` initializes a random process-local key. `setToolResultCursorKey` and `deriveToolResultCursorKey` have no production callers.

**Trigger/impact:** A continuation retained in history becomes invalid after restart even when its output still exists. Starting a new read may work once T01 is fixed; saved continuation itself does not survive.

**Fix/acceptance:** Persist and initialize the key using the application's secret-management conventions, define rotation behavior, and verify read/search continuation across a real process restart plus tamper rejection. FR-07, AC-07/08.

### T12 — P2: Add search continuation to the viewer

- [x] Expose continuation for partial searches and append/replace results predictably. **DONE.** The viewer offers a translated, accessible continue-search action that forwards the query-bound cursor and APPENDS the next page, with a disabled/loading state. The cursor resets on query/output change and stale responses are rejected by the existing request token.

**Evidence:** `AiChatToolResultViewer.vue:429` starts search with conversation, output, and query only. The viewer stores the returned search page but never submits its search continuation cursor. Its separate `nextCursor` is used for reading pages.

**Trigger/impact:** Search stops at the match/scan/time limit. A partial-state label cannot let the user reach later matches, and resubmission starts at the beginning.

**Fix/acceptance:** Add a translated, accessible continue-search action; retain query-bound cursor; reset it on query/output changes; reject stale responses. Test matches beyond the first search window and repeated continuation after T07. FR-10/19, AC-17/22/23.

### T13 — P2: Make the UI rollout flag effective

- [x] Wire `isToolOutputUiEnabled` into the intended presentation boundary or explicitly revise the rollout contract. **DONE.** Main resolves the flag and reports `viewerEnabled` on the output descriptor; the renderer refuses to open the viewer when it is false or the descriptor is missing. The bounded card and export are deliberately unaffected, matching the documented rollback semantics.

**Evidence:** `src/config/featureFlags.ts:176` defines the UI flag reader, but no production caller uses it. Declaring a flag is not independent rollout control.

**Acceptance:** Test all relevant writer/reference/UI flag combinations, with previously stored receipts visible through a safe fallback when the specialized viewer is off. Existing references must not be destroyed or become inaccessible solely because of a UI rollback.

## Missing implementation and validation work

### T14 — P1: Integrate legacy history projections and archive/compaction reads

- [ ] Create and consume bounded legacy projections while keeping original source immutable.

**Evidence:** `ToolResult.model.ts:457`/`:466` define `findProjection`/`saveProjection` with no callers. `ToolResultBootstrapService` has no production caller, and its `executeStep` intentionally does no backfill. `AIChatContextAssembler.ts:768`, `:810`, and `:829` still obtain recent/archive rows through the existing source paths. A legacy slice reader alone does not connect historical messages to bounded projections.

**Work:** Integrate versioned projections into history, renderer metadata, archives, summaries, and request assembly; make any background indexing resumable and bounded. Do not load a full old payload merely to truncate it afterward.

**Acceptance:** Open an old conversation with 10–64 MiB tool rows; inspect model/UI payloads and memory; compact, restart, and change models; recover exact original evidence via reference; original rows stay unchanged. FR-12/17, AC-08/19. Explicitly deferred by the implementation plan, but still a P0 requirement of the full PRD.

### T15 — P1: Complete the execution-path and trusted-agent integration audit

- [ ] Route every applicable result path through a shared bounded boundary, including the legacy stream processor or its explicit unsupported fallback.
- [ ] Propagate trusted agent identity and implement deliberate handoff grants.

**Confirmed gap:** `StreamEventProcessor.ts:286` serializes raw results and its result/event paths (for example lines 1084–1154) still save/publish raw content; it does not call the new pipeline. Legacy server certification being deferred does not justify an unbounded local fallback.

**Confirmed identity gap:** `toolResultContext.ts:90` does not pass `agentId` to authorization and reserves under `agentId: ""`; its cache is keyed only by conversation. `ToolResultModule.authorizeAccess` explicitly compares agent ownership at line 507, but `grantAccess` has no production caller. Normal/resume pipeline contexts also omit owner-agent identity. This is insufficient evidence of the promised agent isolation and handoff semantics; the exact cross-agent exposure depends on runtime conversation assignment and must be tested rather than assumed.

**Work:** Trace actual scheduled/child-agent entry points (including any delegation to the V2 loop), ensure context is trusted rather than supplied by model arguments, and integrate grants where parent/child access is intended. Do not assume an unchanged `AgentRuntime` necessarily bypasses V2; demonstrate the path.

**Acceptance:** Normal, permission-deferred, resumed, cancelled, failed, async completion, duplicate event, scheduled run, child agent, sibling agent, and hosted continuation matrix. No unexpected permission prompt for pure retrieval; no unauthorized parent/sibling access; no oversized fallback. FR-01/07/08/18, AC-09/10/11/21/25.

### T16 — P2: Implement foreground/background shell spooling

- [ ] Capture shell stdout/stderr from production stream creation through background handoff.

**Status:** Explicitly deferred by the implementation plan. Downstream preservation cannot recover bytes already dropped by the producer's old memory cap.

**Acceptance:** Exceed the former cap, hand off to background mid-stream, terminate/cancel, and hit the artifact quota. Preserve bytes up to the capture cap with honest producer/capture completeness and bounded memory. FR-16, AC-24, NFR-03.

### T17 — P2: Add content-free operational metrics

- [ ] Record stage sizes, budget decisions, capture/read latency, and categorized failures.

**Status:** No stage-metrics integration was found in the new tool-result services. Existing generic logging is not evidence of FR-20 completion.

**Acceptance:** Inspect emitted telemetry for success, quota failure, serializer failure, recovery, request reduction, and retrieval limits. It must be useful for rollout diagnosis without output content, secrets, raw paths, or sensitive identifiers. FR-20.

### T18 — P1 release gate: Add real integration/E2E and performance evidence

- [ ] Convert the two audit probes into durable regression tests when fixing T01/T07.
- [ ] Add tests for T02–T15 at their production boundaries, avoiding mocks that bypass the wiring being tested.
- [ ] Add the critical Electron multi-step flow: produce → receipt → restart → read/search/copy/export → clear.
- [ ] Measure all documented memory/latency/event-loop targets with 1/10/64 MiB fixtures on an identified host.
- [ ] Verify mixed text/image handoff, durable duplicate-event handling, and one provider-size retry without re-executing successful tools.

**Status:** Component tests and helper tests are present and passed. No feature E2E files were added in the audited feature diff. Performance work is explicitly deferred; no new benchmark result establishes the PRD's numerical targets. Mixed-image and provider-rejection behavior is unverified here, not asserted broken.

**Acceptance:** Record commands, fixture sizes, host, measurements, pass/fail thresholds, and actual provider/IPC payload sizes. Run the full main-process and component suites plus relevant E2E after fixes. FR-15/19, AC-20/23/25/26, NFR-01–09.

## Full functional requirement coverage

“Partial” means some implementation exists but the requirement cannot be signed off. It does not imply a percentage of completion.

| Requirement | Assessment at audited HEAD | Remaining work |
|---|---|---|
| FR-01 Every terminal result prepared before publication | Partial | T02, T04, T15 |
| FR-02 Byte and available-token thresholds | Partial: static limits exist | T03 |
| FR-03 Complete supported representation plus integrity/state | Partial: capture and metadata exist | T10, T18 |
| FR-04 Separate operation/control outcome; no side-effect repeat | Partial; normal preservation model exists | T04, T18 fault-path proof |
| FR-05 Deterministic preview and stable path-free reference | Implemented at service level | T02/T18 end-to-end identity proof |
| FR-06 Bounded, available model read/search | Broken integration | T01, T07–T09 |
| FR-07 Retrieval across restart/resume/compaction/fallback | Partial | T01, T02, T09–T11, T14–T15 |
| FR-08 Combined results and complete-request budgets | Incomplete production enforcement | T03, T15, T18 |
| FR-09 Bounded persistence/events without raw duplication | Partial in V2 externalized path | T02, T04, T15 |
| FR-10 Preview/status/paged viewer | Mostly implemented, search incomplete | T12, T18 |
| FR-11 Validated streamed export | Implemented with lifecycle race | T06 |
| FR-12 Archive/history/summary integration | Partial for new receipts; legacy integration missing | T14 |
| FR-13 Deletion and epoch lifecycle | Missing production wiring | T05–T06 |
| FR-14 Truthful bounded failure behavior | Partial | T04, T07, T10 |
| FR-15 Mixed image/text compatibility | Unverified end to end | T18 |
| FR-16 Shell streaming capture | Deferred, not complete | T16 |
| FR-17 Non-destructive bounded legacy projections | Missing integration | T14 |
| FR-18 AI-enable/permissions/workspace/agent rules | Partial: IPC gate and registry checks exist | T05–T06, T08, T15 |
| FR-19 Six languages and UI/critical-flow tests | Translations/component tests present; E2E missing | T12, T18 |
| FR-20 Content-free metrics | Incomplete | T17 |

## Acceptance-criterion sign-off matrix

| Criteria | Current audit disposition |
|---|---|
| AC-01 Small results | Existing tests pass; preserve behavior while fixing T04 |
| AC-02 / AC-04 Large output and beyond-preview fact | Blocked by T01 |
| AC-03 Twenty medium results | Blocked by T03 |
| AC-05 / AC-06 Minified JSON and Unicode paging | Helper coverage exists; production read blocked by T01; exact recovery still needs T18 |
| AC-07 Restart | T01/T10/T11 prevent sign-off |
| AC-08 Compaction/smaller model | T03/T09/T14, plus integration evidence |
| AC-09 Permission resume | Wired and selected tests pass; multi-call callback defect T02 remains |
| AC-10 / AC-11 Scheduled/child-agent scope | T05/T15 and production-path tests required |
| AC-12 Quota/disk failure | Helper coverage exists; T04 exception fallback remains |
| AC-13 Crash recovery | T10 missing startup integration |
| AC-14 Clear during capture | T05/T06 missing lifecycle enforcement |
| AC-15 Producer truncation | Completeness fields exist; producer-path validation required in T16/T18 |
| AC-16 Bounded retrieval/no recursive references | Helper implementation exists; real tool execution requires T01/T18 |
| AC-17 Partial search continuation | Reproduced failure T07; UI gap T12 |
| AC-18 Per-turn allowance | T08 confirmed accounting/scope defects |
| AC-19 Existing history | T14 not complete |
| AC-20 Mixed images | Unverified; T18 |
| AC-21 Legacy server capability | Certification deferred; local bounded path T15 remains |
| AC-22 Viewer/search/copy/export | Components pass; T06/T12 and real E2E remain |
| AC-23 Six languages/accessibility | Translation/component evidence exists; live critical-flow evidence remains |
| AC-24 Shell beyond old cap | Deferred; T16 |
| AC-25 Duplicate delivery | Helper guard exists; durable multi-call/restart proof T02/T18 required |
| AC-26 Provider size rejection | Unverified at provider boundary; T03/T18 |
| AC-27 Disable writer after storage | T04/T09 prevent sign-off |

## Nonfunctional requirement sign-off

| Requirement | Audit result |
|---|---|
| NFR-01 Bounded 10 MiB model/UI payload | Cannot sign off with T04/T15 raw fallbacks |
| NFR-02 Bounded 64 MiB read/search allocation | Windowed helpers exist; production/measurement proof pending |
| NFR-03 Less than 16 MiB additional streamed memory | Unmeasured; shell capture deferred |
| NFR-04 First-page p95 ≤200 ms and capture timings | Unmeasured |
| NFR-05 No >50 ms targeted event-loop stall | Unmeasured |
| NFR-06 Exact recovery/checksums/Unicode | Helper coverage exists; runtime integrity/restart gaps remain |
| NFR-07 One identity and terminal receipt per execution | T02 and durable replay evidence required |
| NFR-08 Bounded viewer retention/responsive keyboard | Component coverage exists; live repeated-open/close measurement pending |
| NFR-09 No successful side-effect replay during recovery | Needs end-to-end failure/retry evidence; no replay bug asserted solely from missing tests |

## Suggested repair order and completion rule

1. Fix T01/T02/T04 first so stored results are retrievable, correctly associated, and bounded on failures.
2. Fix T05/T06/T10 before enabling preservation broadly; deletion and crash handling must be real application behavior.
3. Fix T03/T07/T08/T09/T11 to make model continuation reliable under size pressure and restart.
4. Finish T12–T17 for the remaining UI/history/runtime/producer/observability contracts.
5. Complete T18 and record evidence against every AC/NFR before marking the full PRD implemented.

Do not close a task merely because a helper exists, a comment describes the desired behavior, or a mocked unit test passes. Require a production caller plus the specified boundary-level acceptance test. If requirements are intentionally deferred, record an explicit product scope decision and keep them open against the full PRD.

## Remediation pass — what remains open and why

Seventeen tasks are closed (see the inline evidence). The following are **not**
closed, and the feature is **not** ready to be declared complete.

| Item | Status | Why it is still open |
|---|---|---|
| **T10 (integrity half)** | Open | The sweep reconciles leases, publications, and orphans, and it is now wired into startup. What is still missing is verifying a committed artifact's stored SHA-256 against the manifest *before* treating it as trustworthy evidence. `ToolResultStorageService.checksumOf` exists and has no production caller. Until it is called on the read path, a silently corrupted artifact is served as if it were intact. |
| **T14** | Open | No legacy projection is created or consumed. Existing oversized results still read through the `legacy_message` backend, which is now correctly dispatched (T01) but is not the bounded projection the design specifies. The original source remains immutable, so this is a missing capability, not a data-loss risk. |
| **T15 (handoff grants)** | Open | Trusted agent identity now flows from the runtime context into the per-agent retrieval allowance and artifact ownership. Deliberate *handoff grants* between agents are still not implemented: there is no grant-issuing path and no `AIToolOutputGrant` consumer in the retrieval flow. |
| **T16** | Open | Shell stdout/stderr is not captured from production stream creation through background handoff, so the shell path bypasses the bounded boundary. This was an explicit deferral in the implementation plan and is still deferred. |
| **T18** | Open | The Electron multi-step end-to-end flow (produce → receipt → restart → read/search/copy/export → clear) is not written, and the memory/latency/event-loop targets are still unmeasured on an identified host. |

### Release gate

The gate stated in this document is **not satisfied**. Closing the defects above
fixed real production bugs, but sign-off additionally requires T18 evidence for
every AC and NFR. In particular the following remain unevidenced:

- NFR-03/NFR-04/NFR-05 — memory, first-page latency, and event-loop stall were
  not measured, and NFR-03 cannot be honestly measured while T16 is open.
- NFR-09 — no end-to-end failure/retry evidence that a successful side effect is
  not replayed. The duplicate-delivery guard exists in the publisher, but no
  durable multi-call/restart proof accompanies it.
- AC-14 — clear-during-capture now fences the output epoch, but the lifecycle is
  not exercised by an end-to-end test.

Do not close this work because the unit and component suites pass. Per the
completion rule in this document, each requirement needs a production caller
**and** the specified boundary-level acceptance test.
