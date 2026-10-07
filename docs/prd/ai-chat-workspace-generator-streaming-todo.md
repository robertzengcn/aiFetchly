# Generator streaming implementation audit and TODO

Audit date: 2026-10-04  
Implementation reviewed: `generator-streaming`, commit `fcb734fa`  
Scope: the two user-supplied documents, compared with this worktree's implementation and focused tests.

- [PRD](./ai-chat-workspace-generator-streaming-prd.md), version 1.1.
- [Technical design](./ai-chat-workspace-generator-streaming-technical-design.md).
- [Existing completion/operations record](./generator-streaming-operations.md).

The documents in this worktree are byte-identical to the supplied files under `/home/robertzeng/project/aiFetchly/docs/prd/`.

## Conclusion

**No: not all requirements are complete, and implementation defects remain.** The core architecture exists: one generator loop, callback facades, typed outcomes, coordinator-owned queue dispatch/resume, and localized persistence-failure cards. However, required-write ordering is incomplete, cancellation and cleanup have defects, lifecycle persistence is detached, and mandatory release evidence is missing. Neither stage can be declared fully done against PRD §13 on the evidence available.

This is an audit backlog, not an implementation change. “Confirmed” below means directly demonstrated by a focused probe or a concrete code path; it does not mean every finding was reproduced in Electron. “Evidence gap” means missing verification, not proof that the capability is broken. Existing failures outside streaming are reported separately rather than attributed to this branch.

Priority: **P1** = correctness/release blocker; **P2** = required hardening, coverage, documentation, or bounded-resource work. Source line numbers refer to the reviewed commit.

## Confirmed defects and incomplete implementation

### TODO-01 — P1: Await tool-result persistence in callback mode

- [x] Fix the callback facade's required-write barrier.
- **Requirements:** FR-006/007/017; AC-02/08; design §3.3, §8.
- **Evidence:** `src/service/AIChatQueryLoop.ts:964–974` calls `eventSink.flush()` only for `tool_call`. `src/service/AIChatQueryEngine.ts:2906–2930` starts result writes asynchronously; `handleLoopResult()` flushes only after the loop returns. Callback is the default delivery mode.
- **Failure:** after yielding a tool result, the loop can start the next provider request while the save is pending or already rejected. A later flush is too late to prevent that dependent request. Rejected result promises also have an interval without an attached rejection handler.
- **Reproduction observed:** a controlled generator yielded `tool_result`, then recorded advancement; invoking the real `AIChatQueryLoop.prototype.run()` advanced and returned with **zero flush calls**.
- **Fix:** flush both required event types before requesting the next generator value; attach rejection handling when writes are created without swallowing their eventual failure. Keep original persistence error classification.
- **Acceptance:** in callback and generator modes, delayed result saves block the next model round; rejected saves produce `tool_result_persist_failed`, no next request, no automatic tool replay, and no unhandled rejection. Test the actual facade/loop, not only a fake loop that supplies its own flush calls.

### TODO-02 — P1: Flush the approved tool's result before permission continuation

- [x] Apply the required-write barrier to permission resume outside the loop.
- **Requirements:** FR-006/010/017/024; AC-05/08.
- **Evidence:** `src/service/AIChatQueryEngine.ts:2123–2217`, `resumeClaimedPermission()`: emits `tool_result`, then builds context and calls `runLoopSegment()`. It flushes immediately only when the tool returns another permission prompt.
- **Failure:** both delivery modes can send an approved tool's unpersisted result to the model. Generator mode's per-yield barrier cannot protect this event because the engine emitted it before entering the generator.
- **Fix:** await the required result save on every branch before continuing; preserve trusted intent/authorization and never repeat the external tool when storage fails.
- **Acceptance:** delay/reject the approved tool's result save and verify zero continuation provider calls until success; on failure, the run and tool card fail and the approved tool executes once.

### TODO-03 — P1: Keep local-provider cancellation connected through body consumption

- [x] Preserve the abort link until the streaming body is finished or closed.
- **Requirements:** FR-008/015/026; AC-04/08/19; design §7, §11.
- **Evidence:** `src/service/aiProvider/OpenAICompatibleProviderClient.ts:99–135`, `fetchWithResponseTimeout()`, removes the caller's abort listener when fetch returns headers. `streamEvents()` subsequently reads the body at lines 210–240. `OpenAIStreamParser.parseBodyStream()` checks the signal only before reading and installs no abort listener for a pending read.
- **Reproduction observed:** fake fetch returned headers and one chunk, then held the body open. After starting the next read and aborting the caller, the signal passed to fetch remained **not aborted**, and the next read remained pending. The probe explicitly closed its body afterward to clean up.
- **Impact:** Stop can leave the run/scheduler slot waiting indefinitely on a stalled local/OpenAI-compatible provider. Suppressing late chunks does not release the request.
- **Fix:** separate the response-header timeout lifetime from the request cancellation lifetime; abort/cancel pending reads during streaming and remove listeners in the outer streaming cleanup.
- **Acceptance:** abort after headers and during a pending read promptly returns a cancelled outcome, cancels the transport, releases the reader/listeners, and starts no further round.

### TODO-04 — P1: Correct provider end-of-stream and early-close cleanup

- [x] Stop strictly at `[DONE]` and cancel unfinished owned response bodies.
- **Requirements:** FR-003/015/017; AC-01/08; design §7.
- **Evidence:** `src/service/aiProvider/OpenAIStreamParser.ts:132–178` processes its trailing buffer after seeing `[DONE]`, sets `completedNaturally = true` even when the underlying body has not reached EOF, and therefore skips cancellation. Hosted `_iterateOpenAIStreamResponse()` in `src/api/aiChatApi.ts:3216–3250` has the same trailing-buffer problem. Hosted generator cleanup at lines 1301–1302 and 3304–3305 only calls `releaseLock()`; releasing a lock does not cancel a response body. The hosted request has no generator-owned abort controller that closes it on ordinary consumer return.
- **Reproduction observed:** a still-open response containing `data: [DONE]\n\ndata: {valid chunk JSON}` with no final newline emitted the trailing chunk and never called the body's cancel hook. Existing DONE tests pass because their fixture does not cover this partial-final-line case.
- **Fix:** track protocol completion separately from physical EOF; never parse trailing content after a terminal marker; cancel unfinished bodies on terminal markers, early return, and failure for both hosted formats and the local parser. Define and test the intended early-EOF classification.
- **Acceptance:** test post-DONE payloads both with and without final newlines, a server that holds the socket open after DONE, early consumer return, split UTF-8, truncated JSON, and errors during reads. Assert cancellation and unlocked bodies, not merely that iteration stops.

### TODO-05 — P1: Serialize finalization and make terminal side effects exactly once

- [x] Put side effects behind durable message **and run** finalization and deduplicate Stop hooks.
- **Requirements:** FR-007/008/023; AC-04/18; design §3.6, §11.
- **Evidence:** `AIChatQueryEngine.ts:2554–2560` calls `onTurnTerminalCb` for compatibility owners before assistant-message persistence. Completed side effects at lines 2597–2660 execute before the coordinator's run transition at `AIChatCoordinator.ts:795`. `stopConversation()` fires `dispatchStop` at engine line 1888; normal cancelled handling fires it again at line 2687. The coordinator derives final status directly from the returned outcome without resolving a late Stop against an in-flight completion save through a shared finalization guard.
- **Failure examples:** Stop on an active turn runs the Stop hook immediately and again when cancellation settles; delayed/failed run persistence can occur after desktop completion notification/auto-dream/compaction have already started; a compatibility queue can hear completion before the assistant save succeeds. Stop during a completion save needs an explicit winner rather than a previously selected completed result.
- **Fix:** one serialized, idempotent finalization protocol shared with the owner; acknowledge durable writes before running eligible side effects. Preserve outcome-specific rules, including no effects on pause, and make a late Stop a no-op only after terminal commit.
- **Acceptance:** count every listed side effect for completed, cancelled, failed, permission pause, question pause, repeated Stop, and queued-resume cancellation. Delay/fail message and run writes; assert no premature effects, one terminal outcome, and one queue notification.

### TODO-06 — P1: Await and handle lifecycle-state persistence

- [x] Serialize waiting/resume transitions with dispatch completion and subsequent actions.
- **Requirements:** FR-009/021/024; AC-03/05/06; design §3.2.
- **Evidence:** `AIChatCoordinator.ts:919–950` sets `live.status` before starting a detached `void runModule.transition(...)`; failure is only logged. The pause branch at lines 741–768 sees `alreadyParked` and skips its awaited transition. Its fallback also catches and logs transition errors before broadcasting.
- **Failure:** engine dispatch can finish and release capacity while the durable row is still running. A failed write leaves memory parked and storage running, with no classified failure or recovery decision. A fast response can race the detached waiting write with the queued-resume write.
- **Fix:** maintain a run-owned transition promise/serialization mechanism and await it before exposing acceptance of the next lifecycle action or releasing dispatch. Handle persistence failures explicitly instead of marking the in-memory transition complete first.
- **Acceptance:** use delayed/rejected waiting writes and immediate approval/answer. Verify durable order, truthful snapshots, no stale waiting write after resume/terminal, and an explicit failure/recovery path when persistence cannot commit.

### TODO-07 — P2: Make tool-progress bounds and cleanup real

- [x] Enforce a bounded minimal payload and close nested progress iterators.
- **Requirements:** FR-015/016; AC-08/09; design §12.
- **Evidence:** `src/service/aiChat/runToolWithProgress.ts:88–109` spreads the entire oversized event and clears only `message`; it uses JS string length rather than serialized byte size and passes unserializable values through. Its tool starts before the returned generator's first `next()` (lines 49–56). `AIChatQueryLoop.ts:2241–2258` manually drains `progressStream` without a `finally` that closes it. `LatestValueSlot.close()` wakes waiters but does not clear its retained latest value. No abort wakeup is installed by the helper itself.
- **Reproduction observed:** progress with a 100,000-character extra `payload` field still serialized to over 64 KiB after “replacement.” The replacement flag is discarded by the loop and no diagnostic counter is recorded.
- **Impact:** payload bounds are not enforced; abandoning the outer generator at a progress yield does not forward close to the inner generator, so its slot cleanup is skipped. An abort-ignoring producer can leave a helper read waiting.
- **Fix:** explicitly whitelist bounded identity/phase/count fields; measure UTF-8 bytes; handle unserializable payloads safely; clear stored values on close; ensure nested close in `finally`; define abort behavior and lazy/pre-abort admission without duplicating a tool side effect.
- **Acceptance:** oversized non-message fields, multibyte strings, circular values, sync/async tools, pre-abort, hanging tools, consumer failure during progress, and late callbacks all remain bounded and release owned references. No progress volume aborts a tool; required events are never coalesced.

### TODO-08 — P1: Capture delivery mode when the owner accepts the run

- [x] Move mode capture into durable-run acceptance context and share startup configuration.
- **Requirements:** FR-018; AC-14; design §16.
- **Evidence:** `AIChatQueryEngine.ts:1738` captures the mode only after admission and preparation, immediately before running the loop. `captureStreamMode()` at lines 3030–3035 stores it by conversation. `AIChatCoordinator` does not capture/pass a mode when accepting the queued run. Each engine constructs its own environment configuration at lines 521–522, including later-created scheduled engines.
- **Failure:** accept a run while scheduler capacity is full, change an injected provider, then release capacity: that already-accepted run starts with the new mode. Production environment reads occur at engine construction rather than necessarily once at application startup. Same-process pause/resume pinning exists, but it is not acceptance-time pinning.
- **Fix:** pass an immutable accepted-run configuration through direct/queue/resume paths; use a startup-owned production provider. Remove retained mode entries on every terminal/stop path.
- **Acceptance:** actually run the AC-14 matrix: change mode while accepted-but-queued, running, and paused; resume both permission and question pauses; a subsequent newly accepted run alone gets the new mode. Current config tests check the provider setter and individual mode paths, not this full matrix.

### TODO-09 — P1: Preserve partial history on consumer/persistence failure

- [x] Finalize unexpected consumer failures with safe accumulated partial output.
- **Requirements:** FR-015/017; AC-08; design §13.
- **Evidence:** `AIChatQueryEngine.ts:1771–1773` and resume catch paths call synchronous `handleFailure()` (`:3093–3124`), which emits an error and clears state without persisting partial assistant content. An exception in the external generator consumer/flush does not produce the loop's normal failed result containing partial content.
- **Failure:** text can already be visible before a later required tool save fails; the generator is forcibly closed and that partial text is absent after history reload.
- **Fix:** retain a safe run/segment output snapshot or an explicit failed-finalization payload at the engine boundary; attempt the required partial-history write through the normal module path, while preserving the original persistence error and reporting further storage failure honestly.
- **Acceptance:** stream text/reasoning, then fail a tool call/result save or event consumer. Compare live and reloaded history; no synthetic success or repeated tool work; cleanup errors never replace the primary failure.

### TODO-10 — P2: Complete repeated-permission-pause lifecycle and cleanup

- [x] Route a resumed tool that asks permission again through the common parking path.
- **Requirements:** FR-009/010/015/021; AC-05.
- **Evidence:** `AIChatQueryEngine.ts:2140–2151` re-adds `pendingPermissions` and returns paused without `notifyAwaiting()` or updating the pending sink. `resumeClaimedPermission()` uses a new owner sink when supplied, but the old side-map sink is retained. `stopConversation()` removes pending records but does not clear `pendingSinks`/`runStreamModes` or perform the common terminal cleanup.
- **Impact:** the owner outcome fallback can hide the missing lifecycle notification, and compatibility repeated resumes can lose their sink after it was taken from the map. Cancelling parked turns retains stale per-run references.
- **Fix:** centralize park/terminal bookkeeping, refresh the current destination and lifecycle listener, and clear side maps on all terminal paths.
- **Acceptance:** approve → tool returns permission prompt again → approve/deny/Stop. Every pause sends exactly one lifecycle notification; each resume uses the current destination and increasing sequence; maps/listeners return to baseline at termination.

### TODO-11 — P2: Migrate scheduled owners to the outcome-returning contract

- [x] Consume typed segment outcomes for scheduled execution rather than reconstructing them from sink events.
- **Requirements:** FR-013/022; AC-11/17; design §3.1, §15.
- **Evidence:** `src/service/ScheduledAiMessageRunner.ts:349–370` and `:654–677` still call `engine.submitMessage()` and infer outcomes via `ownerSink.getOutcome()` / `sink.getOutcome()`, falling back to `NO_TERMINAL_EVENT`.
- **Impact:** these run owners do not receive the explicit engine outcome promised for all owners; event/outcome disagreement, pauses, or consumer failures remain a separate interpretation path. The temporary callback facade may remain, but should not replace owner consumption of the returned classification.
- **Fix:** use `runTurn()` for scheduled owners and explicitly map supported waiting/blocked/terminal outcomes under scheduled policy, retaining existing event presentation and message deduplication.
- **Acceptance:** per-caller tests for scheduled, queue, subagent, legacy send and compatibility resume in both consumer modes; no additional user-message saves/tool calls, no success on unclassified exit, no orphaned pending scheduled work.

## Mandatory verification and design reconciliation

### TODO-12 — P1: Restore reproducible test/typecheck gates and add missing regression coverage

- [ ] Resolve current dependency/test-runner incompatibilities and run the prescribed gates.
- [x] Add regression tests for TODO-01 through TODO-11 using real loop/facade boundaries and controlled provider/tool fixtures.
- [ ] Add critical Electron E2E coverage for capacity-limited resume, Stop during queued resume, failed required saves, background/detached streaming, and both delivery modes.
- **Requirements:** PRD §10/12/13; design §17; AC-01 through AC-19 as applicable.
- **Evidence:** no E2E changes relative to inventory baseline `fd5f43c8` (`git diff fd5f43c8 --stat -- test/e2e` is empty), and no E2E `AI_CHAT_STREAM_IMPLEMENTATION` configuration was found. Existing E2E flows are useful but do not demonstrate the new failure/capacity/mode matrix. The Stage B config suite does not actually pause a run and change its mode across resume.
- **Current environment blockers:** installed Vitest reports **4.1.11**, whereas this worktree's package declaration requests `^3.2.6`. Constructor mocks implemented as arrow functions fail before engine assertions. Typecheck reports 26 diagnostics including `nodemailer` namespace and mock typing errors; see the execution record below. These are not established streaming regressions; repair/pin the intended environment or update the affected tests before making a release claim.
- **Acceptance:** record exact versions and passing focused/main/service/component/E2E/typecheck/vue-typecheck gates. Keep unrelated baseline failures explicit. Exercise assertions about ordering and cancellation, not just eventual outcomes.

### TODO-13 — P1: Complete performance and rollout gates; correct completion claims

- [ ] Collect Stage A and Stage B comparative performance evidence.
- [ ] Exercise rollback without replay and record the controlled-release decision.
- [ ] Change the operations document's “complete”/“non-blocking” claims to reflect unmet mandatory gates until evidence exists.
- **Requirements:** PRD §5/10/13; design §16/18.
- **Evidence:** `generator-streaming-operations.md` has an empty performance table, labels Stage B COMPLETE, and classifies performance/controlled-rollout evidence as a non-blocking follow-up. The PRD makes these release requirements. The production fallback remains `callback`; no reviewed evidence establishes generator selection for a controlled release or a rollback drill.
- **Acceptance:** identical scripted text/reasoning/multi-tool/progress-burst/cancellation fixtures, at least 30 measured runs after warmup per fixture on the same machine; baseline and variance; added p95 chunk-to-**presenter-intake** latency ≤20 ms; duration and peak application streaming-buffer growth ≤10% outside noise; preserve 50 ms batching. Record Stage A vs baseline and Stage B vs Stage A separately. Rollback affects only new runs and never replays tools. Callback-facade removal remains a later rollback-window task, not a reason to remove compatibility now.

### TODO-14 — P2: Finish diagnostics and privacy-safe counters

- [x] Add the promised count/time diagnostics and cleanup accounting.
- **Requirements:** PRD §6.1 and success measures; design §12/18.
- **Evidence:** no coalesced-progress/late-progress counters or active-consumer accounting were found in the new slot/helper/consumer. `oversizedReplaced` is ignored by the loop. `AIChatStreamImplementationConfig.ts:36–38` logs the entire invalid environment value despite the documented “chosen mode only” policy.
- **Fix:** instrument coalescing, oversized/late callbacks, active consumers, cancelled reads, required-write timing/failures, segment outcomes/unclassified exits, resume wait, cleanup errors and terminal latency. Log only validated mode/count/time information where required; avoid user content, credentials and full paths.
- **Acceptance:** deterministic tests restore consumer/listener/timer counts to baseline for terminal, pause, abort and abandoned iteration; invalid configuration does not echo arbitrary input; metrics contain no content payloads.

### TODO-15 — P2: Record requirement conflicts and finish the V2 inventory

- [x] Resolve FR-026/AC-19 against the current queue/busy policy and document an explicit decision.
- [x] Resolve literal FR-014/AC-12 enablement wording against intentional local-provider eligibility.
- [x] Inventory workspace imports of V2 components/APIs/utilities/handlers, with preservation tests.
- **Evidence:** engine `runPersistedTurn()` (`AIChatQueryEngine.ts:1537–1543`) rejects busy conversations rather than superseding them; the loop still uses `isActiveTurn()` to filter chunks (`AIChatQueryLoop.ts:1273–1278`) without aborting a provider when ownership becomes false. No complete AC-19 supersede/close evidence was found. Queue policy must not be silently replaced just to satisfy this scenario.
- `canUseChat()` (`ai-chat-v2-ipc.ts:450`) delegates to `AIProviderResolver`; that resolver intentionally allows configured local providers independently of `USER_AI_ENABLED`. Handler gating exists before parsing, but it is not the literal universal Token gate in the supplied rules/design. Record affected IDs and approved semantics, and test hosted-disabled and local-provider-disabled separately; do not accidentally remove supported local AI.
- `generator-streaming-p0-inventory.md` inventories backend callers but does not enumerate workspace V2 component/utility/API imports. Shared V2 code has been retained; there is no demonstrated deletion regression. Complete the inventory before any legacy removal.
- **Acceptance:** explicit conflict decisions with FR/AC IDs and executable tests. If supersession remains supported anywhere, losing ownership aborts the request and closes the iterator, not merely suppresses token callbacks; otherwise revise the incompatible acceptance scenario through the product decision process.

## Requirement-by-requirement status

“Implemented foundation” means code/evidence exists, not that the full release gate passed. Cross-cutting release blockers remain applicable to every row.

| Requirement | Audit status | Evidence / outstanding task |
| --- | --- | --- |
| FR-001 | Implemented foundation | Single `iterate()`; `run()` facade; result-preserving consumer; infrastructure tests pass. |
| FR-002 | Implemented foundation; full UI evidence pending | Native provider iteration and incremental presenter path; complete delayed Electron fixture in TODO-12. |
| FR-003 | Partial | Event families retained; termination defect TODO-04; normalized differential traces still needed. |
| FR-004 | Implemented foundation | Coordinator owns direct/drained/resumed workspace runs; coordinator tests pass; full detach/E2E gate pending. |
| FR-005 | Implemented foundation | Run-owned adapter and durable queue run identity; coordinator/owner-adapter tests pass. |
| FR-006 | Incomplete | Missing result barriers TODO-01/02. |
| FR-007 | Partial | Message persistence and held workspace terminal implemented; cross-owner/finalization ordering TODO-05. |
| FR-008 | Incomplete | Local cancellation defect TODO-03; finalization race coverage TODO-05. |
| FR-009 | Partial | Explicit pause outcomes exist; waiting persistence and repeat-pause gaps TODO-06/10. |
| FR-010 | Partial | Claim/owner machinery exists; complete repeat-pause and trusted resume regression gates TODO-02/10/12. |
| FR-011 | Implemented foundation; parity unverified | Existing loop/retry suites and native retry events; full normalized hosted/local differential traces pending TODO-12. |
| FR-012 | Implemented foundation | Focused presenter, transcript, coordinator tests pass; complete E2E gates TODO-12. |
| FR-013 | Partial | Facades/wiring exist; scheduled outcome adoption TODO-11; full shared-caller matrix TODO-12. |
| FR-014 | Needs documented reconciliation | Early provider-aware gating exists; universal Token wording conflicts with local AI policy, TODO-15. |
| FR-015 | Incomplete | Request/progress/side-map cleanup TODO-03/04/07/10. |
| FR-016 | Partial | Latest-slot coalescing exists; payload bound/cleanup/diagnostics TODO-07/14. |
| FR-017 | Partial | Error classification exists; consumer failure loses partial history, TODO-09; barriers TODO-01/02. |
| FR-018 | Incomplete | Mode provider and resume map exist; capture is late, TODO-08. |
| FR-019 | Existing mechanism retained; acceptance not rerun | Durable restart reconciliation retained; fresh restart/no-replay E2E evidence pending TODO-12/13. |
| FR-020 | Partial documentation | Shared files retained, but comprehensive workspace V2 import inventory missing, TODO-15. |
| FR-021 | Partial | Notifications replace sampling; detached writes and repeat-pause notification gaps TODO-06/10. |
| FR-022 | Partial | Workspace owner consumes outcome and fails unclassified exits; scheduled owners still infer from events, TODO-11. |
| FR-023 | Incomplete | Duplicate Stop and premature side effects, TODO-05. |
| FR-024 | Implemented foundation with persistence gaps | Claim/queue/scheduler resume and queued Stop tests pass; lifecycle/result-save gaps TODO-02/06. |
| FR-025 | Existing semantics retained; full acceptance pending | Loop plan submit continues rather than becoming approval-resume; plan-state/UI trace matrix pending TODO-12. |
| FR-026 | Incomplete / policy conflict | Busy queue behavior vs supersession acceptance; ownership filter does not abort, TODO-15. |

## Acceptance scenario disposition

| Scenarios | Disposition |
| --- | --- |
| AC-01 | Focused provider/consumer tests pass; termination/cleanup edge cases fail probes, TODO-04. |
| AC-02, AC-08 | Call-save implementation exists; result-save barriers/partial history incomplete, TODO-01/02/09. |
| AC-03 | Coordinator foundation tested; lifecycle persistence and Electron detach/reload matrix pending. |
| AC-04 | Queued-resume Stop tests pass; local pending-read cancellation broken; side-effect/finalization races pending. |
| AC-05, AC-06 | Owner resume/claim and plan foundation exists; delayed writes, repeated permission pause and E2E matrix pending. |
| AC-07 | Existing loop tests pass in focused run; complete hosted/local retry parity evidence pending. |
| AC-09 | Basic coalescing tests pass; oversized payload probe disproves promised bound. |
| AC-10 | Focused presenter/coordinator tests pass; end-to-end resumed/queued identity matrix pending. |
| AC-11 | Compatibility exists; scheduled owners not fully outcome-driven; full caller matrix not rerun. |
| AC-12 | Early eligibility gates exist; disabled-AI/local-provider semantics need explicit reconciliation. |
| AC-13 | Restart mechanism retained; no fresh restart acceptance run in this audit. |
| AC-14 | Acceptance-time mode pinning incomplete; existing tests do not exercise full mode-change/resume scenario. |
| AC-15 | Focused transcript/failure-card components pass; full component/E2E release gates not rerun. |
| AC-16 | Focused durable queue-owner/coordinator tests pass; full Electron status/sequence flow pending. |
| AC-17 | Focused coordinator unclassified-exit test passes; shared owners still need migration/coverage. |
| AC-18 | Not satisfied: duplicate/premature effects established by code, TODO-05. |
| AC-19 | Not demonstrated; supersede contract conflicts with busy-send behavior, TODO-15. |

## Commands and evidence from this audit

No live/paid model requests were made. Temporary probes asserted the *current erroneous behavior*, were removed after execution, and are not regression tests committed to the repository. Convert their described fixtures into expected-correctness tests with the corresponding fixes.

| Check | Result |
| --- | --- |
| `yarn vitest --config vitest.service.config.mjs run` with `AIChatQueryEngine.runTurn`, `AIChatQueryEngine.requiredPersistence`, `aiChatGeneratorInfrastructure`, `AIChatStreamImplementationConfig`, and `AIChatQueryLoop` test files | **56 passed, 19 failed**, 5 files. Engine/config failures include non-constructible arrow-function mocks under installed Vitest 4.1.11. Infrastructure and loop files passed. |
| Utility parser/provider/presenter command with normal typecheck gate | **Blocked before tests** by `tsc`: 26 diagnostics. Examples: `src/modules/lib/emailService.ts:12`, `replyEmailService.ts:29`, `smtpTransport.ts:15` (`nodemailer` namespace); `test/vitest/main/aiContentReportService.test.ts:391` and other mock typing sites. Not established as introduced by this work. |
| Same utility command with `AIFETCHLY_SKIP_TSC=1`, plus four temporary audit probes | **28 passed**, 4 files: 24 existing tests plus 4 defect-reproduction probes. This does not constitute a passing typecheck gate. |
| `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run test/vitest/main/aiChatWorkspaceCoordinator.test.ts test/vitest/main/aiChatRunOwnerAdapter.test.ts` | **24 passed**, 2 files; explicit typecheck bypass. |
| `yarn test:components AiChatExecutionRow.persistFailure AiChatWorkspaceTranscript` | **21 passed**, 2 files. This is a focused subset, not the full component gate. |
| Full main/service/component suites, Electron E2E, separate vue-typecheck, performance, controlled rollout/rollback | **Not run in this audit.** Historical operations-document results do not establish current passing evidence. |

Local raw logs for this session: `/tmp/generator-audit-service.log`, `/tmp/generator-audit-utility.log`, `/tmp/generator-audit-probes.log`, `/tmp/generator-audit-coordinator.log`, `/tmp/generator-audit-components.log`. These are ephemeral; the findings, counts, fixtures and command descriptions above are the durable audit record.

The pre-existing untracked `test/vitest/utilitycode/__snapshots__/` directory was left untouched and is not part of this audit change.

---

## Completion record (2026-10-07)

TODO-01 through TODO-11, TODO-14, and TODO-15 are implemented with regression
coverage and recorded in `generator-streaming-operations.md` §4–5 and
`generator-streaming-p0-inventory.md` §7–8. TODO-12's gates pass (main 6312,
service 2726 serial, components 827, tsc 0; vitest ^4.1.11 aligned) — its
Electron E2E matrix items remain the shared release gate: the existing E2E
suite is unchanged on this branch and the NEW failure/capacity/mode scenarios
(failed required saves, capacity-limited resume, both delivery modes in
Electron) still need spec authoring + a quiet-enough environment to run. The
single caveat is documented where it applies rather than waived.
