# Email reply validation and duplicate guard — 2026-10-16 re-audit TODO

## Scope and verdict

- Worktree: `/Users/cengjianze/project/aiFetchly/.claude/worktrees/email-reply-validation-phase1`.
- Branch: `worktree-email-reply-validation-phase1`.
- Reviewed revision: **`456fb62f153bc5386a1260e5d234c952840c58c0`**.
- Change baseline: `fc8824f19`, the previous audit commit.
- Contract: current [PRD](ai-email-reply-validation-and-duplicate-guard-prd.md) and [technical design](ai-email-reply-validation-and-duplicate-guard-technical-design.md), FR-025–FR-039. The PRD remains the same contract reviewed previously.
- Review started October 15 and completed October 16, 2026, Asia/Shanghai. Earlier TODO files remain history; this file reports current evidence.

**The full PRD is not complete, and the focused main test suite currently fails.** This revision makes substantial progress: legacy raw-ID discovery, live-SMTP tracking, seed-positive checks, typed transaction refusals, known-unsent failure handling, human-review resolution, and successful loopback generation/reuse/send/reconciliation E2E are implemented. The remaining findings below describe narrower residual or newly introduced defects, not repetition of the original missing implementations.

The most serious issue is a broad catch in the final send gate that swallows a deliberate sibling-positive refusal and can continue to SMTP after finalizing the attempt as failed. The submitter tracker also starts too late to protect a paused operation between claim and SMTP.

This is a focused source review with fresh automated tests and read-only execution of selected current function bodies using controlled ports. It does not prove absence of every possible bug or establish live hosted/provider compatibility. **P1** blocks release of the affected send flow; **P2** must be fixed before claiming the corresponding requirement complete. Source line references refer to the reviewed revision. No application source was modified during this audit.

## Fresh checks and failures

| Check | Result |
|---|---|
| Focused main suites, normal file parallelism | **37 files passed, 2 failed; 608 tests passed, 3 failed (611 total)** |
| Serial targeted rerun of the three failures | **All 3 failures reproduced**, 156 other tests skipped by name selection; not a database-lock/setup failure |
| Focused utility suites | **16 files / 228 tests passed** |
| Full component suite | **70 files / 449 tests passed** |
| Four targeted Electron E2E specs | **12 tests passed**, including new loopback IMAP/provider/SMTP success and reconciliation paths |

The three main failures are:

1. `EmailReplyDraftGeneration.test.ts:673`, **“resolves the capability ONCE per invocation, not once per submission”**: expected one resolver call, received two. The implementation now keys the memo by model identity; update the obsolete assertion to test the intended same-model and changed-model behavior (T01).
2. `EmailReplyDraftGeneration.test.ts:3521`, **“blocks the correction call once the deadline expires mid-flight”**: createDraft rejects with `LlmTransportError: Generation deadline exceeded before stage "failure_audit"` instead of returning the tested typed failure. This exposes F05, not just a stale count.
3. `EmailReplyRecovery.model.test.ts:798`, **“recover→reconcile negative→late success: no second submission, accepted protection preserved”**: expected failed, received sent. The old assertion requires ignoring actual late acceptance, contrary to the newer protection contract. Replace the obsolete expectation and exercise a real outstanding operation/tracker (T01), while retaining the F02 race regression.

Temporary logs: `/tmp/email-reply-audit-2026-10-15-r2-main.log`, `-failures-confirm.log`, `-utility.log`, `-components.log`, and `-e2e.log`. They are local temporary evidence, not repository artifacts. Loopback success is verified; a real hosted AI/IMAP provider pilot remains unexecuted here.

## Requirement coverage

| Requirement | Current assessment | Remaining work |
|---|---|---|
| FR-025 — generation contract | Implemented in reviewed scope | Shared enums, context-preserving correction and persisted optional review metadata exist. Human-review presentation still needs F09/T02. |
| FR-026 — JSON compatibility | Partial | Local-compatible loopback generation and hint forwarding verified; real hosted compatibility/fallback acceptance remains T03. |
| FR-027 — model output/context limits | Partial | Output-cap memo invalidation and call-budget recomputation added. Input budgeting is still independent of actual model context/output reservation (F06). |
| FR-028 — safe generation/reuse | Partial | Legacy discovery and coherent reuse checks added; late acquire ownership and provenance still incomplete (F04/F07). |
| FR-029 — shared local enforcement | Partial | Shared checks exist, but final sibling-positive refusal can be swallowed (F01). |
| FR-030 — flags/provenance | Implemented in reviewed scope | Sticky evidence-only sync and targeted metadata writes remain covered; no recurrence of the old lifecycle-promotion defect found. |
| FR-031 — fresh automatic checks | Partial | Seed-positive/age rechecks implemented; sibling error path and pre-handoff operation ownership remain unsafe (F01/F02). |
| FR-032 — shared detector/tool | Partial | Catalog/IPC/tool/DTO and real-adapter limits exist; expired writes still persist reusable negatives (F03). |
| FR-033 — structured safe results | Partial | Typed claim denials/tool correlation implemented; swallowed final refusal and resolved-review next action remain incorrect (F01/F09). |
| FR-034 — audit/localization | Partial | Unresolved reconciliation mapping fixed and new E2E passes; deadline auditing is broken and oversized-input refusal has no required event (F05/F06). Renderer completion remains T02. |
| FR-035 — reservation/deadline | Partial | Owner fencing and more timed awaits exist; a losing acquire can mutate later, and terminal audit handling fails at expiry (F04/F05). |
| FR-036 — atomic send/recovery | Partial | Live SMTP is now tracked and late acceptance preserved; pre-SMTP owned operations remain untracked and final refusal can be bypassed (F01/F02). |
| FR-037 — cache safety | Partial | Detector version bumped; closing-read expiry checked. A database write already in flight has no persistence-time deadline/owner condition (F03). |
| FR-038 — upgrade/legacy | Partial | Bounded raw-ID discovery and readiness checks landed; readiness starts passed before validation is explicitly begun (F08). |
| FR-039 — operational/release bounds | Partial | More tests and loopback evidence exist; context/deadline/cache defects, non-green main suite and real pilot acceptance remain (F03–F06, T01/T03). |

“Implemented in reviewed scope” describes code and exercised behavior, not an exhaustive production guarantee. The remaining dependency defects still prevent full-feature acceptance.

## Confirmed defects

### F01 — Final send gate swallows a sibling-positive refusal [P1]

- **Evidence:** `src/service/emailReply/EmailReplyDeliveryService.ts:1063–1092`, helper `refusePostClaimGate` at `1180` area, SMTP at `761`.
- **Trigger:** after claim, the seed has a recent negative, but an equivalent row has positive/sent evidence. The loop calls refusePostClaimGate, which safely finalizes the known-unsent attempt as failed and throws SendPolicyRejection.
- **Actual:** the same broad try/catch encloses both the cluster read and the deliberate refusal. It catches the rejection, falls through to the recent-negative branch, returns permission and reaches SMTP. A failed cluster read also takes this path rather than the forced refresh promised by the comment. Audit/finalization failures inside that try can be swallowed too.
- **Read-only reproduction:** actual runPostClaimFreshnessGate with a positive sibling and recent seed negative called the refusal helper once, caught its rejection, and returned successfully.
- [ ] Restrict catch scope to the read; propagate deliberate refusals and persistence errors. Incomplete cluster evidence must return unknown/refuse or perform a verified refresh, never reuse the recent negative as permission.
- [ ] Regression: positive sibling and cluster-read rejection separately; assert zero SMTP, correct attempt state, stable refusal, one owned skip event. Include audit/finalization rejection; use the actual delivery method, not only a helper mock.

### F02 — Submitter tracking misses a paused operation before SMTP [P1]

- **Evidence:** delivery awaits final gate at `EmailReplyDeliveryService.ts:714–722`, registers the running submitter only at `747`, then sends at `761`; `src/model/EmailReplyDraft.model.ts:1429–1459` checks the tracker for negative reconciliation.
- **Trigger:** an operation has claimed/marked submitted, then pauses in final message/cluster read or detection long enough for recovery. Recovery marks it unknown; the tracker is still empty. Negative reconciliation reopens it. The original call later resumes.
- **Actual:** there is no final attempt/guard ownership check before registration/SMTP. The old call can send under a reconciled/released claim, potentially alongside a freshly approved retry. The fix correctly covers an already-running SMTP promise, but not the complete live claim-to-finalization operation.
- [ ] Track the entire successful-claim-to-finalization operation, including pre-handoff waits/refusals, or add a conditional final handoff fence that refuses recovered/reconciled ownership. Clear liveness in an encompassing finally. Negative reconciliation must establish the whole original operation is quiescent.
- [ ] Regression: pause the post-claim gate, advance recovery threshold, recover and negatively reconcile, then resume. Original operation must not reach SMTP under its old claim. Cover actual held SMTP too, cleanup rejection, and restart semantics.

### F03 — Expiry checks after a database write cannot undo persisted negative evidence [P2]

- **Evidence:** `src/service/emailReceive/EmailReplyDetectionService.ts:1066–1084,1381–1411`; `src/model/EmailReceivedMessage.model.ts:197–210` has only the row/positive-evidence condition, no probe owner/deadline.
- **Trigger:** a negative write starts before expiry but waits in a module/connection/database path. Probe times out; the write then completes.
- **Actual:** the helper returns false/unknown after the write, but the database retains replyNegativeCheckAt and its context. Preserving the original observation time is an improvement, yet a write finishing shortly after the 15-second deadline can still be within the 60-second negative TTL. Another invocation can reuse the expired probe's result.
- **Read-only reproduction:** actual persistNegative with an expiring signal and delayed evidence port returned false while the negative remained stored and within TTL. This specifically tests the awaited write, not the already-fixed delayed closing read.
- [ ] Move deadline/probe-owner eligibility into the persistence boundary with a conditional commit. Do not leave a reusable negative from an expired owner; prevent late writes from overwriting newer observations. Keep the original observation timestamp.
- [ ] Regression: defer real evidence persistence past the deadline, inspect the stored row, then invoke detection again. Require a fresh check/no reused expired negative. Include newer positive and newer negative races.

### F04 — Timed-out reservation acquisition can leave a later live lease [P2]

- **Evidence:** `src/service/emailReply/EmailReplyDraftGenerationService.ts:651–669,883–885,1919–1955`; cleanup scope starts only after successful acquisition is returned.
- **Trigger:** acquireReservation waits in the write queue; raceWithDeadline rejects before acquire returns. The original transaction continues detached and acquires later.
- **Actual:** this.reservation was never assigned, so the invocation cannot release that late owner. The lease is calculated as five minutes from acquire request time rather than the remaining invocation deadline. If earlier work consumed most of the budget, the late lease can remain live well after the caller failed.
- [ ] Pass an absolute invocation expiry into acquisition and check it at the actual mutation. If a losing acquisition can still complete, arrange owner-fenced cleanup of its late result; never turn a detached expired request into a new live owner.
- [ ] Regression: hold the write queue/acquire beyond remaining budget, return the failure, release the queue and inspect the guard. An immediate retry must not be blocked by the dead invocation. A mock promise that never writes is insufficient.

### F05 — Deadline failure auditing throws again and can start duplicate work [P2]

- **Evidence:** generation outer timeout handler `EmailReplyDraftGenerationService.ts:909–945`; audit `2602–2633`; deadline race `1927–1952`.
- **Trigger:** generation/correction/non-model stage exhausts the deadline. The handler tries recordFailure using that already-expired deadline.
- **Actual:** failure auditing throws a new LlmTransportError instead of the intended structured provider_error outcome. The audit work is eagerly started before raceWithDeadline checks expiry; an inner failed audit can be caught and audited again by the outer timeout handler. Already-expired calls return before attaching the detached-work rejection handler.
- **Evidence:** the existing correction-deadline test fails reproducibly. A read-only execution of recordFailure with an already-expired deadline started one audit write and still threw `Generation deadline exceeded before stage "failure_audit"`.
- [ ] Use lazy work factories and prevent new mutations after expiry. Define one bounded terminal audit/cleanup owner, reserve its budget, and distinguish audit persistence failure from the original timeout. Do not re-audit an audit failure; return or propagate the documented structured failure consistently.
- [ ] Regression: correction expiry, retrieval expiry, audit already expired, audit write hangs/rejects, and late rejection. Assert one attempted/committed refusal event as appropriate, no unhandled detached rejection, no draft and correct correlation/outcome.

### F06 — Input budget is not the actual model/prompt budget [P2]

- **Evidence:** `src/service/emailReply/EmailReplyContextBudget.ts:20–89`; generation `1242–1265`; actual prompt rendering `src/service/emailReply/EmailReplyPromptBuilder.ts:147–189`.
- **Actual:** the helper uses a fixed 6,000-input-token allowance and chars/4, independent of the provider's context window and reserved output. It counts full original/source text while the prompt builder separately caps the body at 2,000 characters and snippets at 800. It omits some rendered labels/framing. A fixed 6,000-input allowance plus output can exceed a small model's context; large models can be refused unnecessarily. A character heuristic is not a model-independent hard token bound.
- **Additional refusal gap:** fixedPromptExceedsBudget returns a resolved-message failure at generation `1257–1265` without the required correlated skip event/stable code.
- [ ] Budget the exact rendered messages, correction additions and output reservation against the selected model's context limits; use a suitable tokenizer or explicitly conservative supported-model bound. Keep safety instructions and bounded-original semantics consistent. Record a typed, correlated refusal when fixed content cannot fit.
- [ ] Regression: small and large reported context windows, non-ASCII/code-heavy inputs, framing overhead, output reservation, long source/body fields versus rendered caps, and oversized-input audit. Do not fix by silently deleting safety/context labels.

### F07 — Truncated retrieval is still reported as fully supplied grounding [P2]

- **Evidence:** generation computes fittedSources at `1267–1285` but persists all knowledge.audits at `1643`, writes all audits at `1846`, and returns all knowledge.sources at `1860`.
- **Trigger:** context fitting drops one or more retrieved sources from the model prompt.
- **Actual:** stored/returned source provenance includes documents the model never received. A generic truncation warning does not identify which sources were supplied. The helper comment says truncation forces human review, but requiresHumanReview is still based solely on the generated flag.
- [ ] Separate retrieved candidates from supplied context. Persist/return exact supplied source IDs and truncation coverage, preserving original retrieval diagnostics separately. Apply/document the intended review policy for omitted context instead of relying on a comment.
- [ ] Regression: force one source to be dropped, inspect the actual request, draft/revision metadata, audit and reuse DTO. No dropped source may be presented as supplied grounding; review signals remain coherent.

### F08 — Readiness starts passed before startup marks it pending [P2]

- **Evidence:** `src/service/emailReply/EmailReplyReadiness.ts:27–32`; `src/background.ts:1249–1264` dynamically imports readiness and then marks pending after earlier startup/database work.
- **Actual:** initial process state authorizes new work even though no validation has succeeded. The comment promises a pending initial state, but the code deliberately defaults passed for tests. Pending/failed checks and kill-switch enforcement are now present; the unvalidated initial admission window remains.
- [ ] Default production readiness to pending before handlers/windows/background work can admit requests. Explicitly mark isolated test fixtures passed instead of making production defaults permissive; preserve the deliberate policy-disabled path.
- [ ] Regression: invoke generation/send before validation setup, while validation is delayed, on import/Token failure, and after success. Only successful validation or an explicit authorized policy path opens admission; audit/recovery remains available.

### F09 — Resolved human review still returns unresolved approval guidance [P2]

- **Evidence:** approval service now recognizes humanReviewResolvedRevisionId, but generation reuse at `EmailReplyDraftGenerationService.ts:811,1074,1546` still feeds the original requiresHumanReview flag alone into `nextActionForReuse`; `src/service/emailReply/EmailReplyNextAction.ts:86–90` returns await_human_review whenever it is true.
- **Trigger:** user resolves the current revision using the new API, then requests/reuses that draft again.
- **Actual:** approval is allowed by the backend, but the result still instructs the caller to await human review. Original model provenance should remain true; effective pending-review status must be represented separately.
- [ ] Expose revision-bound review-resolution/effective-review status in safe DTOs and derive guidance from that status, retaining original model reasons. Editing invalidates the resolution and restores review-required guidance.
- [ ] Regression: flagged → resolved current revision → reuse gives correct approval guidance; edit → reuse requires review again. Verify both AI tool and renderer consumers.

## Remaining tasks and acceptance evidence

### T01 — Restore a truthful green main suite

- [ ] Fix F05; do not just change the test to accept an uncaught timeout/audit exception.
- [ ] Replace the once-per-invocation resolver expectation with same-model memo and changed-model invalidation tests. The current null/default → returned model transition legitimately resolves again.
- [ ] Replace the recovery test's “ignore late acceptance” assertions with preservation of accepted evidence, plus an actually held submitter/tracker scenario. Retain a separate regression for F02's pre-handoff window.
- [ ] Run the normal focused main command again and then the repository-required broader checks. Record counts/failures honestly; the current three failures are deterministic under isolated rerun.

### T02 — Complete the actual human-facing review interaction

- [ ] The resolution model/IPC/API exists and the new E2E invokes it through window.api, but no renderer page/component calls resolveHumanReview. Add a visible revision-bound review/acknowledgment flow with original reasons, current resolution, stale/error/loading states and six-language text. Expose the current reviewable revision ID in the ordinary safe detail DTO; the production flow cannot depend on the revision ID returned by an E2E-only seed channel.
- [ ] Add component coverage and an E2E that clicks the real user control. Programmatic IPC success proves backend wiring, not discoverability/usability of the product flow.
- [ ] Preserve the user-only authority boundary: no AI tool may acknowledge its own review request. Resolution alone must not bypass approval, content validation, reply evidence or atomic send ownership.

### T03 — Complete provider and release acceptance

- [ ] Retain the 12 passing loopback tests: generation → reuse → approve → actual loopback SMTP, explicit review resolution and ambiguous reconciliation are now exercised. Do not carry forward the old claim that no success E2E exists.
- [ ] Execute the corrected real IMAP/Sent and hosted AI compatibility pilots, including JSON support/fallback/ignored hints and the provider families/configurations actually supported. Loopback FakeAi is controlled integration evidence, not live hosted compatibility.
- [ ] Capture validation/correction/truncation/fallback rates, unknown reasons, latency/cache/guard conflicts and availability impact; record release signoff. No fabricated provider baselines.
- [ ] Prove cache invalidation for source identity/Sent coverage and provider/model configuration changes. Detector v2 invalidates old semantics, but a version bump alone does not establish every future context-change rule.
- [ ] Update the current completion addendum only after these findings and T01 are resolved. Preserve the distinction between implementation landed, automated checks executed and live release acceptance completed.

## Previous audit disposition

| October 15 item | Current evidence |
|---|---|
| N01 missing legacy raw-ID siblings | Fixed with same-service bounded null-normalized scan in both model and transaction helper; oversized scan fails closed. Add operational remediation for large legacy sets rather than bypassing the limit. |
| N02 unproven live submitter quiescence | Running SMTP promise is now tracked; late sent can restore accepted protection. The pre-handoff window remains F02. |
| N03 seed-positive post-claim bypass | Seed-positive check and refreshed-age check added. Sibling branch introduces F01. |
| N04 timed-out negative persistence | Delayed closing reads now fenced and observation time preserved; in-flight database write remains F03. |
| N05 stale model call budget | Recomputed after capability lookup; original stale-120-second allowance defect fixed. |
| N06 known-unsent marked unknown | Fixed: post-claim refusal finalizes known-unsent as failed. F01 can incorrectly continue after that finalization. |
| N07 untyped transaction refusals | Typed model codes and service-owned refusal auditing added. Deadline auditing regression is F05. |
| N08 missing shared admission | Checks added to generation/tool/delivery and pending/failed startup paths; default-open state remains F08. |
| N09 unresolved reconciliation shown failed | Fixed with reconciliation_noted and needs-human-review mirror semantics. |
| G01 model/context/deadline gaps | Call-budget recomputation and model-keyed memo added; input budgeting/late mutations remain F04/F06/F07. |
| G02 no human-review completion API | Backend revision-bound resolution implemented and tested; effective guidance and actual UI remain F09/T02. |
| G03/G04 pilot and success E2E | Success/reuse/reconciliation loopback coverage added and passing. Live provider acceptance remains T03. |
| Main-suite reliability | No new database-lock setup failure in this run, but three real assertion/timeout failures remain T01. |

## Suggested order

1. Fix F01/F02 before releasing guarded sending; add end-to-end race/persistence-error regressions.
2. Close late mutation and deadline/audit behavior (F03–F05), then correct input budgeting/provenance (F06/F07).
3. Finish readiness and effective human-review behavior (F08/F09/T02), restore the main suite (T01), and execute release acceptance (T03).

This report is the requested review deliverable. It changes documentation only; no application fixes or deployment were performed.
