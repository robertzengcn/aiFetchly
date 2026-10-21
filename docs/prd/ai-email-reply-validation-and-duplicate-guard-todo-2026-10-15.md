# Email reply validation and duplicate guard — 2026-10-15 audit TODO

## Scope and conclusion

- Worktree: `/Users/cengjianze/project/aiFetchly/.claude/worktrees/email-reply-validation-phase1`.
- Branch: `worktree-email-reply-validation-phase1`.
- Reviewed code: **`95979925d591ba8d6ca15c127322003e6d7ed7b8`**.
- Previous audit baseline: `c3de07cd` (2026-10-11 report).
- Contract: current [PRD](ai-email-reply-validation-and-duplicate-guard-prd.md) and [technical design](ai-email-reply-validation-and-duplicate-guard-technical-design.md), FR-025–FR-039. PRD SHA-256: `08116d4c6ffd64b1dd6f7d8597f1bbfd8c53fbfcb91d46dc2e0d38f17a65bafd`.
- This new report preserves both earlier TODO files. Old “fixed/landed” annotations are implementation history, not substitutes for the current evidence below.

**The full PRD is not yet complete.** Most previously requested implementation is present, and many earlier defects have been fixed. Remaining blockers include incomplete legacy identity resolution, reopening a recovered attempt without proving the original sender stopped, ignoring newly positive evidence after claim, and writing fresh negative evidence after a probe timed out. Provider deadlines, refusal contracts, upgrade gating, and acceptance coverage also need work.

This is a focused source audit with fresh automated tests and small read-only source-execution reproductions. It is not exhaustive production certification. Source references describe the reviewed revision; line numbers will move after edits. **P1** items should block release of guarded replies. **P2** items must be resolved before declaring the associated requirement complete. Missing acceptance activities are listed separately from confirmed control-flow defects.

## Fresh verification

| Check | Result |
|---|---|
| Focused main-process suites, normal file parallelism | **37 files / 595 tests passed**; no database-lock/setup failure in this run |
| Focused utility suites | **16 files / 228 tests passed** |
| Complete component suite | **70 files / 447 tests passed** |
| Targeted Electron E2E: audit evidence + workflow specs | **7 tests passed** after building E2E bundles |
| TypeScript integration in focused runners | Zero errors reported |

The main selection includes generation, response formatting, tools, structured IPC, sync/provenance, canonical cluster eligibility, reservations, approval/reopen, send claims, recovery, populated upgrades, audit mirrors, POP3 UIDL stability, and temporary-directory isolation. The E2E specs exercise real preload/IPC/service/database refusal and audit paths; they do not complete a successful mailbox-backed generation/send or quiescent reconciliation flow.

Read-only harnesses executing current function bodies reproduced:

1. Normalized seed plus legacy sent sibling → **zero sent attempts found, no cluster sent projection, phase `idle`** (N01).
2. Probe returns `probe_timeout` with no write, then abandoned probe writes negative freshness at approximately **81 ms after a 20 ms deadline** (N04).
3. Capability lookup leaves **1,000 ms** of the invocation budget, but provider request receives **120,000 ms** (N05).
4. Post-claim message contains both positive evidence and `replyStatus = sent`, plus a recent negative timestamp → **gate returns without refusal** (N03).

These harnesses use current TypeScript function bodies with controlled ports/clocks; they are not full production database/network integrations. The corresponding durable regression tests remain TODOs.

Temporary local logs: `/tmp/email-reply-audit-2026-10-15-main.log`, `-utility.log`, `-components.log`, and `-e2e.log`. No live IMAP or hosted AI pilot was executed. No application source was changed by this audit.

## Requirement-by-requirement assessment

“Implemented / covered” means the reviewed implementation and focused tests cover the stated code contract; it is not a claim that every possible deployment scenario was tested. “Partial” identifies remaining implementation or explicit acceptance work.

| Requirement | Assessment | Evidence and remaining work |
|---|---|---|
| FR-025 — shared generation contract | Implemented / covered | Shared intent enum drives prompts/correction; original context retained; optional review metadata persisted and returned. Operational completion of human review still needs G02. |
| FR-026 — JSON compatibility | Partial | Hint forwarding, explicit-parameter matching, bounded correction and per-invocation unsupported-route memory exist. Live hosted compatibility evidence remains G03; capability invalidation remains G01. |
| FR-027 — completion/output limits | Partial | Truncation/refusal/tool-call checks and telemetry exist; provider output cap added. Model/context-aware budgeting remains incomplete (G01). |
| FR-028 — guarded generation and reuse | Partial | Reservation, read-side reuse revalidation and transaction eligibility check added. Legacy cluster omission still defeats those checks (N01). |
| FR-029 — shared local rules | Partial | Shared transaction classification exists; legacy evidence omission and post-claim positive handling remain (N01/N03). |
| FR-030 — flag provenance/targeted writes | Implemented / covered | Future Answered flags now create sticky evidence without rewriting app reply lifecycle; sync/model regressions pass. Historical duplicate discovery remains an FR-029/038 issue (N01). |
| FR-031 — fresh draft/send detection | Partial | Forced checks and five-second claim/post-claim gates exist; post-claim evidence handling, late negatives and unsent outcomes remain incorrect (N03/N04/N06). |
| FR-032 — detector and diagnostic tool | Partial | Tool/catalog/IPC/preload/safe DTO and real-adapter bounds fixes exist. Expired probe persistence still violates unknown/freshness semantics (N04). |
| FR-033 — structured safe results | Partial | Tool correlation and summary evidence landed. Claim-time refusals still lose stable fields (N07). |
| FR-034 — one refusal audit/localization/E2E | Partial | Reservation audit, lifecycle correlation and UI mirror landed; transaction denials and reconciliation presentation remain incomplete (N07/N09). Success/reconciliation E2E remains G04. |
| FR-035 — persistent ownership/deadline | Partial | Owner/phase/lease and transaction commit checks, exception cleanup and non-model stage races exist. Provider budget can become stale; outstanding awaited stages remain G01 (N05). |
| FR-036 — atomic send/recovery/idempotency | Partial | Failed-draft reopening and consumed-token replay implemented. Recovery is not proof of submitter quiescence; post-claim outcomes remain wrong (N02/N03/N06). |
| FR-037 — evidence cache safety | Partial | Queue serialization, rejected-write handling, sticky positives and sender recheck fixed. Late writes and incomplete identity/source coverage remain (N01/N04, G01). |
| FR-038 — upgrade/legacy consistency | Partial | Exact index validation and startup invocation added; legacy resolver still misses historical rows, and validation is not an admission barrier (N01/N08). |
| FR-039 — bounds/metrics/rollout | Partial | Real-adapter overflow/failure counts, abort-before-connect and telemetry implemented. Timed-out writes/provider deadline gap remain; corrected live pilot is still unexecuted (N04/N05, G03). |

## Confirmed defects and required fixes

### N01 — Legacy raw-ID siblings are still omitted from canonical evidence [P1]

- **Evidence:** `src/model/replyClusterEvidence.ts:90–111`; `src/model/EmailReceivedMessage.model.ts:295–310`; `src/modules/EmailReceivedMessageModule.ts:261–284`.
- **Trigger:** row A is historical, with `normalizedMessageId = null`, raw `messageId = <same@example.com>`, and sent/unknown/positive evidence. Row B stores `normalizedMessageId = same@example.com`. Evaluate B.
- **Actual:** the resolver normalizes the seed's raw ID, but queries other rows only by their stored normalized column. A is omitted. Always including the seed fixes the previous seed-loss direction but does not discover other legacy siblings. Existing aggregation cannot protect evidence it never reads.
- **Reproduced:** current `readClusterEvidence` returned no sent attempts, `clusterHasRowLevelSent = false`, and `evidenceToPhase = idle`, despite A and its sent attempt being in the controlled store.
- **Impact:** local checks, generation commit, send claim and recovery can miss a reply for the same inbound identity. Two null-normalized legacy equivalents are also not resolved reliably.
- [ ] Use one transaction-aware canonical resolver that discovers null-normalized raw-equivalent rows in the same service, with a bounded safe strategy or explicit conflict on incomplete discovery. Never merge by subject/thread or across services.
- [ ] Regression: normalized seed → legacy sent/unknown/positive sibling; legacy seed → multiple legacy equivalents; bracketed IDs and no cross-service merge. Assert no model/SMTP, and test actual mutation transactions, not only the module wrapper.

### N02 — Recovery still does not prove the original SMTP submitter stopped [P1]

- **Evidence:** `src/service/emailReply/EmailReplySendRecoveryService.ts:40–80`; `src/model/EmailReplyDraft.model.ts:1297–1367,1401–1427`; late-success match at `1026–1041`.
- **Trigger:** hold the original SMTP promise past the five-minute recovery threshold. Recovery changes that attempt from submitted to delivery_unknown. Operator then invokes confirm_not_sent while the original transport remains alive.
- **Actual:** reconciliation now correctly rejects claimed/submitted and sent targets, but accepts the recovered unknown target. It checks other active attempts, not whether the original operation is still running. Optional operator evidence is not a cancellation/quiescence fence. The target becomes failed and the guard reopens.
- **Impact:** fresh approval can authorize a second submission while the original still might succeed. Original late success cannot update an attempt already changed to failed, because sent finalization matches only claimed/submitted/delivery_unknown. The original R04 is therefore only partially resolved.
- [ ] Require verified submitter quiescence or a cancellation/ownership protocol before negative reconciliation. A timeout/status change alone must never prove non-delivery. Preserve late actual acceptance as terminal evidence.
- [ ] Regression: deferred original SMTP → recovery → negative reconciliation → fresh retry → original late acceptance. Assert no overlapping second SMTP and no lost accepted evidence. Include restart evidence and known-sent downgrade refusal.

### N03 — Post-claim freshness gate ignores newly positive local evidence [P1]

- **Evidence:** `src/service/emailReply/EmailReplyDeliveryService.ts:976–993,1021–1028`; SMTP follows at `707`.
- **Trigger:** a reply is detected or sent locally after the atomic claim, during awaited markSubmitted/message read. The row retains a recent replyNegativeCheckAt alongside new replyDetectedAt or replyStatus = sent.
- **Actual:** the gate rereads the row but checks only the negative timestamp. A recent negative returns immediately, ignoring positive fields already available in that same row. The refreshed-negative branch also returns without a final observation-age/eligibility check.
- **Reproduced:** current gate returned successfully with replyDetectedAt present, replyStatus sent and a recent negative.
- [ ] Apply positive/sent/unknown/conflict precedence before freshness permission, including equivalent rows and excluding only this exact owned attempt. Revalidate refresh observation age immediately before handoff; refuse a second delay.
- [ ] Regression: install seed/sibling positive during markSubmitted; SMTP must remain uncalled. Add delayed refresh completion/persistence with an observation older than five seconds.

### N04 — An abandoned timed-out probe can still persist fresh negative evidence [P1]

- **Evidence:** `src/service/emailReceive/EmailReplyDetectionService.ts:648–678` races results; `981–1027` awaits closing configuration/identity then persists; `1323–1335` stamps the negative with the time of the late write.
- **Trigger:** mailbox reads finish, but closing configuration/identity read or persistence is delayed beyond the 15-second deadline.
- **Actual:** caller receives unknown/probe_timeout and the mailbox queue releases. The underlying promise continues. There is no abort/expiry fence before the evidence write, so it can write a successful-negative timestamp after timeout. A later request can reuse that persisted negative even though the expired result was never cached in memory.
- **Reproduced:** with a 20 ms deadline and delayed closing read, caller returned timeout with zero writes; at approximately 81 ms the abandoned probe wrote negative freshness.
- [ ] Fence evidence writes using current probe ownership/expiry/cancellation; check cancellation after every awaited closing step. Preserve the actual observation time rather than replacing it with delayed write time. A check before an awaited write alone is insufficient if that write can complete late.
- [ ] Regression: delay closing reads and the evidence write independently beyond deadline, resolve them later, and assert no usable negative is persisted/cached and no later call skips its required probe. Sticky verified positives must retain an explicit separate safe persistence policy.

### N05 — Capability lookup consumes time after model-call budget was calculated [P2]

- **Evidence:** `src/service/emailReply/EmailReplyDraftGenerationService.ts:1911–1914,1932–1945`; capability lookup itself is raced at `1861–1864`.
- **Trigger:** the model catalog/capability resolver consumes most of the remaining five-minute budget, then resolves successfully just before expiry.
- **Actual:** callBudgetMs was computed before that await and is passed unchanged to the provider. The model call is not otherwise raced against the updated overall deadline.
- **Reproduced:** remaining invocation budget at provider start = 1,000 ms; request callBudgetMs = 120,000 ms. Lease checks may reject eventual persistence, but cannot make the invocation/model request end on time.
- [ ] Recompute/recheck remaining budget immediately after capability lookup and before provider submission; keep cancellation through headers/error/success bodies. Do not submit when the budget is exhausted.
- [ ] Regression: advance controlled clock during capability resolution to near/past expiry; assert provider gets the remaining amount or is never called. Cover correction/fallback too.

### N06 — A known-unsent pre-SMTP refusal is recorded as delivery_unknown [P2]

- **Evidence:** `src/service/emailReply/EmailReplyDeliveryService.ts:634–674,1052–1094` marks submitted before the final gate and finalizes gate refusal with outcome delivery_unknown, although sendReplyEmail has not been called.
- **Trigger:** post-claim delayed refresh yields unknown/positive, or the source message disappears before SMTP.
- **Actual:** an operation known never to have contacted SMTP becomes ambiguous-delivery history, consumes approval and blocks future work until manual reconciliation. The design explicitly says a refusal before SMTP must not manufacture an accepted/unknown send.
- [ ] Represent confirmed-unsent gate refusal distinctly or finalize it as definitely not submitted under the owned claim, without clearing any pre-existing sibling/positive protection. Require fresh explicit approval for any permitted retry.
- [ ] Regression: post-claim probe failure with a sender spy showing zero calls; attempt/draft must not claim possible SMTP acceptance. Positive evidence must still block independently, while a transient check failure remains safely retryable after a new successful check.

### N07 — Claim-time denials lose typed results and the required refusal audit [P2]

- **Evidence:** `src/model/EmailReplyDraft.model.ts:853–870,885–892` returns precondition_failed with English reason only; `src/service/emailReply/EmailReplyDeliveryService.ts:627–629` throws a plain Error. Generation's fenced-owner return at `EmailReplyDraftGenerationService.ts:1630–1638` similarly lacks stable denial code/event.
- **Trigger:** outside read policy/detection passes, then the transaction observes a new positive, sibling send/conflict, or changed guard phase. For generation, ownership expires before final commit.
- **Actual:** local safety may refuse correctly, but renderer/tool loses code/next_action/request correlation and there is no owned reply_skipped audit for the resolved-message invocation. The fixed entry-path audits do not cover these final transaction outcomes.
- [ ] Return typed transaction refusal reasons; compose one correlated service-owned refusal audit and typed IPC/tool envelope. Keep exact-attempt idempotent replay separate; never infer codes from reason text.
- [ ] Regression: change evidence only after pre-send checks and before claim, then assert stable code, request ID, exactly one skip event and zero SMTP through actual IPC. Cover owner-fenced generation without treating invalid/unresolved IDs as message audits.

### N08 — Upgrade validation is not an admission barrier, and disable misses AI drafting [P2]

- **Evidence:** `src/background.ts:1247–1273` launches validation fire-and-forget and only logs launch failures; `src/service/EmailReceiveAiTools.ts:343–357` directly invokes generation without the reply kill-switch check. Generation entry at `EmailReplyDraftGenerationService.ts:505–525` checks AI enable, not that kill switch. The draft IPC handler does check it.
- **Trigger A:** validation is pending/stuck or fails to launch, while a request reaches registered handlers/background work.
- **Trigger B:** validation fails and sets the emergency reply kill switch; an enabled AI invokes create_email_reply_draft.
- **Actual:** guarded work is not uniformly held until validation succeeds. Setting the flag blocks the IPC path but does not disable AI-tool/service drafting. Startup wiring is present now, so the old “not called anywhere” finding is resolved; effective fail-closed admission is not.
- [ ] Add a shared readiness/disable check at authoritative generation/new-send boundaries. Keep ordinary app startup responsive if desired, but refuse new guarded work while validation is pending/failed. Handle import/rejection/Token-write failures explicitly and preserve audit/recovery access.
- [ ] Regression: deferred/throwing validator and failed schema through actual startup; IPC, tool and automation must all refuse new work. With kill switch already true, create tool must do no reservation/retrieval/model work.

### N09 — Leave-unresolved reconciliation appears as a send failure in the UI [P2]

- **Evidence:** `src/model/EmailReplyDraft.model.ts:1433–1464` chooses reply_sent only for confirm_sent and send_failed for every other action; `src/service/emailReply/EmailReplyAuditMirror.ts:19–25` maps send_failed to decisionStatus failed.
- **Trigger:** operator chooses leave_unresolved for ambiguous delivery.
- **Actual:** database delivery state remains unknown, but the new UI mirror records a failed-send decision. The operator chose to retain ambiguity, not verify non-delivery. The misleading audit presentation is newly visible through the mirror.
- [ ] Record a reconciliation-note/unresolved event with typed delivery_unknown state; mirror it with correct guidance. Do not present a no-op as confirmed failure or imply retry eligibility.
- [ ] Regression: leave_unresolved keeps attempt/draft/guard unknown and displays unresolved delivery/human review; confirm_not_sent and actual definite failure remain distinguishable.

## Remaining implementation and acceptance tasks

### G01 — Complete capability, context and deadline coverage

- [ ] Key output-capability memoization by actual model/provider/context version. resolvedMaxTokens is reset per invocation but cached once (`EmailReplyDraftGenerationService.ts:1854–1878`); changing lastReturnedModelId at `1955` does not invalidate it before a correction. The shared catalog is loaded once and needs an explicit provider/model configuration invalidation path.
- [ ] Account for available input context as well as max output tokens. Current clamp narrows output allowance only; large original/conversation/retrieved input can still exceed a small model's context window. Respect the PRD's actual-model context/output limits without silently removing safety instructions.
- [ ] Audit all awaits against the full invocation deadline, not only profile/knowledge/envelope/model capability. Initial connection/message/policy/reservation, audit and cleanup calls still need bounded behavior. Late database mutations must use owner/expiry fences rather than relying on a Promise.race response alone.
- [ ] Verify provider support/route decisions against the actual hosted and local provider configurations (G03), preserving two validation attempts/four generation submissions and separately bounded classification.
- [ ] Bind negative cache validity to source identity and search coverage changes. Current empty-scope persisted hash cannot itself establish that a changed resolved Sent set was previously checked; prove an explicit invalidation/version strategy and fail closed on identity conflicts (FR-037).

### G02 — Provide a usable explicit human-review completion path

- [ ] Define and implement how a human resolves the persisted requiresHumanReview flag. `EmailReplyApprovalService.ts:142–146` always refuses when it is 1; user revision append (`EmailReplyDraft.model.ts:517–532`) changes content but leaves review metadata unchanged. No review-acknowledgment input/path clears or supersedes the flag.
- [ ] Keep the original model reasons immutable as provenance, but allow an authorized, revision-bound human review resolution under the intended product policy. If the product intentionally requires discard/regeneration/manual webmail instead, expose that boundary clearly rather than an unfinishable “await human review” instruction.
- [ ] Add component/IPC/E2E coverage: flagged draft → human reviews/edits → explicit resolution → fresh approval/detection → permitted send; unresolved and stale review acknowledgment remain blocked. This must not create an AI-accessible bypass.

### G03 — Execute live compatibility and release acceptance

- [ ] The corrected pilot procedure in `docs/prd/emailreply-pilot-and-rollout-plan.md` is an improvement; live IMAP/Sent and hosted/local provider results are still absent. Record actual provider results, Sent discovery/header matching, JSON hints/fallback/ignored hints, and honest missing-metadata behavior.
- [ ] Capture baseline/rollout evidence for validation/correction/truncation/fallback rates, unknown reasons, detection latency, cache and guard conflicts. Review availability impact for unsupported/ambiguous mailboxes; do not fabricate pass numbers or baseline thresholds.
- [ ] Verify rollback/readiness controls with N08 fixed; mandatory local duplicate protection must remain active. Obtain the release signoff described by the PRD/design.

### G04 — Complete success and reconciliation E2E scenarios

- [ ] Retain the seven passing audit/refusal E2E cases, but add eligible reuse success → explicit approval → successful fresh send and unknown-delivery reconciliation/quiescence flows.
- [ ] `test/e2e/specs/emailReplyWorkflow.test.ts:1–37` explicitly excludes reuse success, happy-path SMTP, delayed-send freshness and recovery races. Its failed-retry scenario ends in receive_unavailable before a new send claim; it does not prove a successful retry.
- [ ] Use loopback fake IMAP/SMTP where needed to exercise real cross-layer production wiring. Injected Vitest integration tests are valuable but do not satisfy the PRD's separate critical-flow E2E requirement by themselves.
- [ ] Check six-language failure/review guidance and new N09 unresolved presentation, including missing audit persistence and loading/disabled states.

### G05 — Reconcile documentation against current evidence

- [ ] Update the old coverage matrix and “complete” notes only after the corresponding residual finding is fixed. It currently contains contradictory partial/landed language and marks R03/R04 fully fixed despite N01/N02.
- [ ] Keep three claims separate: code implemented, automated acceptance exercised, and live release acceptance completed. The first two have advanced substantially; the third remains pending.

## Disposition of the October 11 findings

| Previous item | Current disposition |
|---|---|
| R01 final generation commit eligibility | Transaction owner/phase/cluster check implemented; effectiveness still depends on complete canonical resolution (N01). |
| R02 positive timestamp accepted by claim | Fixed in claim path; post-claim positive omission remains N03. |
| R03 canonical seed/legacy/positive evidence | Seed inclusion and aggregation fixed; null-normalized sibling discovery remains N01. |
| R04 running submitter reconciliation | Direct claimed/submitted/sent rejection added; recovered-but-live submitter remains N02. |
| R05/R06 truncation and missing-header completeness | Overflow/completeness/failed-fetch accounting implemented; focused real-adapter regressions pass. |
| R07 mailbox queue fan-out | Release-token chaining implemented; queue/single-flight focused tests pass. |
| R08 abort-after-connect | Abort attaches before connect/retry; focused adversarial tests pass. |
| R09 rejected evidence writes | Boolean return honored and row reread; late write after expiry remains N04. |
| R10 sender recheck | Fresh sender/config reread implemented; context/coverage invalidation still needs G01. |
| R11 Answered overwrites app lifecycle | Fixed; sticky evidence-only sync regressions pass. |
| R12 missing post-claim freshness check | Gate added; positive handling and known-unsent outcomes remain N03/N06. |
| R13 failed draft approved retry | Fenced reopen/approval added; focused tests pass. Full successful retry E2E remains G04. |
| R14 finalized token replay | Trusted exact-attempt replay added; focused tests pass. |
| R15 stale reuse snapshot | Transactional reuse validation added; still depends on N01 canonical completeness. |
| R16 reservation exception leak | Encompassing owner-fenced cleanup added; focused generation tests pass. |
| R17 fallback matching/error-body deadline | Parameter-specific matching and error-body timeout implemented; stale computed budget remains N05. |
| R18 reservation denial audit | Reservation-outcome auditing added; final claim/fenced-owner outcomes remain N07. |
| R19/R20 tool and lifecycle correlation | Correlation propagated at reviewed ordinary boundaries; transaction refusals still need N07. |
| R21 optional review signals discarded | Metadata persisted/returned and approval gated; explicit review completion remains G02. |
| R22 unsafe already-replied guidance | Refusal/reuse maps separated; focused guidance/component tests pass. |
| R23 upgrade validator test-only | Production invocation/exact index checks added; shared admission barrier/disable remains N08. |
| G01 generation capabilities | Shared enums and initial output cap added; residual context/model/deadline work is G01 above. |
| G02 ordinary summary evidence | Persisted evidence/freshness fields and tests added; no repetition of the old missing-fields finding. |
| G03 critical-flow E2E | Refusal/audit workflow spec added and passes; excluded success/reconciliation flows remain G04. |
| G04 incorrect pilot procedure | Procedure corrected; execution/signoff remains G03 above. |
| V01 parallel database isolation | Per-worker temporary-directory isolation added; current 37-file normal parallel run passes without database locks. This is evidence for this run, not a universal flake guarantee. |
| V02 POP3 sequence identity | Stable UIDL implementation and focused stability/security tests added and passing. POP3 external reply detection intentionally remains unavailable. |

## Recommended order

1. Close N01–N04 with database/transport race regressions before enabling release.
2. Correct deadline, unsent outcome, typed refusal/audit and readiness behavior (N05–N08), then unresolved audit presentation (N09).
3. Finish capability/context and human review workflows, complete successful cross-layer E2E, then run corrected live pilots (G01–G04).
4. Update completion claims from the resulting evidence (G05). Re-run relevant suites after each fix and broader checks when new changes justify them.

No bug fixes were applied in this review. The requested deliverable is this detailed TODO; fixing and deploying the application are separate work.
