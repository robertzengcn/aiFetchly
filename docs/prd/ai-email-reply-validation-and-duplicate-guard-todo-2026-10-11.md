# AI email reply validation and duplicate guard — re-audit TODO

## Scope and verdict

- Review date: **2026-10-11**.
- Worktree: `/Users/cengjianze/project/aiFetchly/.claude/worktrees/email-reply-validation-phase1`.
- Branch: `worktree-email-reply-validation-phase1`.
- Reviewed implementation: **`ffbc2c0e7791168c165a9e2420a032382903177a`**.
- Baseline for changes since the first audit: `22f40e1e`.
- Contract: this worktree's current [PRD](ai-email-reply-validation-and-duplicate-guard-prd.md) and [technical design](ai-email-reply-validation-and-duplicate-guard-technical-design.md), including FR-025–FR-039. PRD SHA-256: `08116d4c6ffd64b1dd6f7d8597f1bbfd8c53fbfcb91d46dc2e0d38f17a65bafd`.
- This is a new report. The earlier TODO is retained as history; its mixture of old findings and later “landed” annotations is not a current completion certificate.

**The full PRD is still not complete.** The branch now contains substantial implementation for every requirement, including mailbox detection, persisted evidence, generation ownership, atomic draft creation, send guards, structured IPC failures, translated audit UI, and upgrade tests. The remaining problems are mainly incomplete safety checks, inaccurate completeness/budget accounting, integration gaps, and unexecuted live acceptance work—not the wholesale missing modules found in the first audit.

In particular, incomplete mailbox searches can become cacheable negatives, transaction boundaries do not reject all newly positive evidence, and reconciliation can reopen a still-running submitter. These are release-blocking correctness issues. Passing current tests cannot establish the guarantees those tests omit or contradict.

All source line references below describe the reviewed revision. **P1** means fix before release of guarded drafting/sending; **P2** means fix before declaring the relevant requirement complete. Findings are source-supported trigger paths, not claims of an observed production incident. No application code was changed for this review.

## Verification evidence

- Main suite, default file parallelism: **31 files passed; one suite failed at setup** with `QueryFailedError: SqliteError: database is locked`. **338 tests passed and 102 were skipped** because `EmailReplyDraftGeneration.test.ts` could not initialize its database. See V01; this is not 102 failing assertions.
- Main suite serial rerun (`--no-file-parallelism`): **32 files / 440 tests passed**; TypeScript checking reported zero errors. This confirms the skipped generation suite passes when run without competing file workers.
- Utility suite: **15 files / 218 tests passed**.
- Full component suite: **70 files / 446 tests passed**.
- Targeted Electron E2E, `emailReplyAuditEvidence.test.ts`: **one test passed** after building the E2E bundles. This checks audit evidence/recheck, not the complete approval/reconciliation race workflow.
- Read-only execution of the actual `policyFailure` function confirmed that a supplied `requestCorrelationId` is absent from the tool result (R19).
- Local logs: `/tmp/email-reply-reaudit-2026-10-11-{main,main-serial,utility,components,e2e}.log`. These are temporary evidence, not committed test artifacts.
- Live IMAP/hosted provider pilots and production availability baselines were not executed. A written pilot plan is not a completed pilot.

## Requirement coverage

“Partial” means implementation exists but at least one explicit contract or acceptance obligation remains. It does not mean all behavior in that row is broken.

| Requirement | Current coverage | Remaining work |
|---|---|---|
| FR-025 — schema-aligned generation | Partial | Prompt/correction field alignment works; optional review metadata is discarded; enums remain duplicated (R21, G01). |
| FR-026 — bounded JSON compatibility | Partial | Hints and fallback exist; unrelated errors trigger fallback; capability memory and hosted end-to-end evidence incomplete (R17, G01/G04). |
| FR-027 — budget/completion checks | Partial | Truncation/refusal/tool-call checks and metadata exist; model-specific limit clamping remains deferred (G01). |
| FR-028 — guarded generation/reuse | Partial | Pre-model checks and reuse exist; final commit and awaited reuse races remain; failed reuse lacks a usable retry transition (R01/R13/R15). |
| FR-029 — shared local enforcement | Partial | Shared draft/attempt checks exist; canonical legacy/positive evidence and transaction-time checks incomplete (R01–R03). |
| FR-030 — flag provenance | Partial | Columns, timestamps, targeted writes exist; fresh Answered still overwrites app delivery projection (R11). |
| FR-031 — automatic fresh checks | Partial | Draft/send detector and claim freshness exist; false negatives, positive claim acceptance, and delayed SMTP freshness violate contract (R02/R05/R06/R12). |
| FR-032 — shared detector/tool | Partial | Diagnostic tool, IPC, preload and DTO exist; detector completeness/cancellation/context cases remain (R05–R10). |
| FR-033 — safe structured results | Partial | IPC preserves typed fields; AI failures lose correlation, summaries omit evidence/freshness, and next action can contradict denial (R19/R22, G02). |
| FR-034 — audit/localization | Partial | Strict generation/reuse auditing and translated audit UI exist; reservation denials lack events, send lifecycle correlation remains message-scoped, full workflow E2E pending (R18–R20, G03). |
| FR-035 — persistent reservation | Partial | Unique guard, owner/lease, atomic draft/revision/audit persistence exist; final reconciliation, exception cleanup, and complete deadlines remain (R01/R16/R17). |
| FR-036 — message-level send/recovery | Partial | Atomic guard binding and sibling checks exist; reconciliation, post-claim freshness, failed retry, and finalized replay remain (R02–R04/R12–R14). |
| FR-037 — cache safety | Partial | TTL, sticky single-row positives and cache hash exist; rejected writes, cluster positives, sender/scope changes and queued concurrency incomplete (R03/R07/R09/R10). |
| FR-038 — upgrade/legacy consistency | Partial | Populated upgrade tests exist; legacy identity aggregation and production validation wiring incomplete (R03/R23). |
| FR-039 — bounds/metrics/rollout | Partial | Limits/constants/metrics/plan exist; real adapter truncation and socket cancellation violate limits; error-body timeout and live pilot acceptance pending (R05–R08/R17, G04). |

## Release-blocking defects

### R01 — Final draft commit does not reconcile current reply evidence [P1]

- [ ] **Fix:** in the commit transaction, resolve the canonical cluster and reject current positive/sent/unknown/in-flight/conflicting evidence. Require the expected generating phase and binding as well as owner/lease. Return a typed refusal without writing a draft or downgrading lifecycle state.
- Evidence: `src/model/EmailReplyDraft.model.ts:419–438,489–511`; outer recheck at `src/service/emailReply/EmailReplyDraftGenerationService.ts:950–953`, awaited envelope resolution at `1072–1074`, commit at `1180–1194`.
- Trigger: sync/diagnostic detection records a positive or a conflicting sibling after the read-policy check, while the generator still owns its lease.
- Actual behavior: commit checks ownership/expiry only, creates the draft, and writes `replyStatus = draft_created`. External evidence can appear during model work too because policy does not consistently include it.
- Regression: pause after the outer check, add positive/sent/unknown/conflicting evidence, resume. Assert no draft/revision/creation audit, no sent downgrade, and exactly one correlated refusal. Include changed guard phase with an otherwise matching owner.

### R02 — Send claim treats positive evidence as acceptable freshness [P1]

- [ ] **Fix:** reject row/cluster positive evidence inside the claim; require a complete, context-matching fresh **negative** separately. Never use a positive timestamp as permission to send.
- Evidence: `src/model/EmailReplyDraft.model.ts:623–638` uses `replyNegativeCheckAt ?? replyDetectedAt`; sibling checks do not aggregate all row-level positives. `test/vitest/main/modules/EmailReplySendClaim.integration.test.ts:1040` explicitly expects a fresh sticky positive to permit claim.
- Trigger: the forced detector returns negative, then sync/another detector records a reply before the transaction. A recent negative or positive timestamp passes the freshness fence.
- Actual behavior: a new send attempt can be claimed despite known reply evidence and proceed to SMTP.
- Regression: introduce positive evidence between detection and claim, both on the seed and an equivalent row. Assert typed `already_replied`, no attempt and no SMTP. Replace the test expectation that currently codifies acceptance of positive evidence.

### R03 — Canonical clusters omit legacy rows and sibling positives [P1]

- [ ] **Fix:** use one transaction-aware resolver that always includes the seed, safely normalizes legacy raw IDs, and aggregates each equivalent row's historical sent/external-positive state plus its drafts/attempts. Fail closed if legacy equivalence cannot be established completely; retain mailbox isolation.
- Evidence: `src/modules/EmailReceivedMessageModule.ts:248–267`; `src/model/EmailReceivedMessage.model.ts:287–302`; `src/model/replyClusterEvidence.ts:56–73,105–115`; `src/service/emailReceive/EmailReplyDetectionService.ts:293–303,719–726`.
- Trigger A: a legacy seed has null `normalizedMessageId`, a valid raw ID, and a sent/unknown attempt. A newer unanswered row stores the normalized ID. The module returns only normalized matches and can omit the seed itself.
- Trigger B: the normalized seed has an equivalent legacy sibling, or a sibling has only historical `replyStatus = sent` / `replyDetectedAt` without a sent draft/attempt.
- Actual behavior: local policy/detection and transactions can miss authoritative history and return eligible/negative state for the same inbound identity.
- Regression: test both directions of legacy/normalized duplicates, bracketed raw IDs, orphan attempts, and sibling-only sent/external-positive projections. Assert zero network/model/SMTP when already replied; identical IDs in another service remain separate.

### R04 — Negative reconciliation can reopen the original live submitter [P1]

- [ ] **Fix:** conditionally reconcile only eligible unknown attempts, with positive evidence and complete sibling inspection. Require original-submitter quiescence/fencing and the specified non-delivery evidence. Preserve terminal accepted evidence, including late actual success.
- Evidence: `src/model/EmailReplyDraft.model.ts:1036–1047` refuses only a **different** active attempt; `1081–1104` unconditionally marks the target failed and reopens the draft/guard. Automatic finalize at `815–818` excludes an attempt changed to failed. `src/service/emailReply/EmailReplySendRecoveryService.ts:155–186` checks existence rather than this eligibility contract.
- Trigger: original SMTP is still pending, or recovery marked it unknown while transport is alive; the operator invokes `confirm_not_sent`. A known-sent target can also be downgraded through this endpoint.
- Actual behavior: the same running attempt can reopen the guard and permit a fresh submission. Its later success may be ignored because reconciliation changed its status to failed. Retained message sent protection in some known-sent cases does not make the ledger downgrade correct.
- Regression: hold original SMTP, recover/reconcile negatively, then deliver late success; no second submission or loss of accepted protection. Also attempt negative reconciliation of sent targets and a different active sibling.

### R05 — Adapter and folder truncation can produce false complete negatives [P1]

- [ ] **Fix:** expose overflow, completeness, and actual fetch-attempt counts from the real IMAP adapter. If required folders/candidates remain unexamined within limits, return `probe_limit_exceeded`, not negative. A verified direct positive can settle the outcome within the searched scope.
- Evidence: `src/service/emailReceive/ImapEmailReceiveClient.ts:339–350,379` truncates UIDs without reporting overflow; `src/service/emailReceive/EmailReplyDetectionService.ts:995–1004,1006–1054` slices folders to five and counts only returned candidates. Exactly exhausting the last batch falls through to `no_match`.
- Trigger A: six Sent folders; first five empty; verified reply only in sixth.
- Trigger B: one folder with 201 substring candidates; first 200 are false matches and candidate 201 is the verified direct reply.
- Actual behavior: the bounded portion can be declared complete and cached as `not_replied`, authorizing guarded work despite incomplete evidence. Existing multi-folder exhaustion coverage does not exercise the real adapter's silent truncation.
- Regression: use the actual adapter plus FakeImapFlow for both triggers. Assert unknown, no negative write/cache, at most five folder searches and 200 header attempts. Bound the search response/memory footprint too.

### R06 — Missing candidate fetches count as successful non-matches [P1]

- [ ] **Fix:** propagate failed/malformed requested-header reads as incomplete coverage, and account for attempted fetches even when no candidate DTO is returned.
- Evidence: `src/service/emailReceive/ImapEmailReceiveClient.ts:352–379`, especially `366`; detector budget accounting at `EmailReplyDetectionService.ts:1031–1038`.
- Trigger: search finds a relevant UID but `fetchOne` returns false or lacks requested headers. Across several folders, false fetches return no candidates to decrement the shared budget.
- Actual behavior: an unreadable possible reply may yield a negative; actual network header attempts can exceed 200 because only successful candidate records are counted.
- Regression: false/missing-header candidate produces unknown and no negative cache unless a verified direct positive settles the result. Multiple folders with failed reads stay within 200 total attempts.

## Other confirmed correctness defects

### R07 — Queued mailbox probes fan out after one predecessor [P2]

- [ ] Replace snapshot-await locking with a synchronously chained mailbox queue or ownership-checked semaphore; include queue acquisition in cancellation/deadline accounting.
- Evidence: `src/service/emailReceive/EmailReplyDetectionService.ts:515–536,540–602`.
- Trigger/result: probe A is active; distinct-message B and C both await A. When A completes, B and C both start and replace the mailbox map entry. Same-message single-flight does not serialize different messages.
- Regression: gate A then B; C must make no network call until B releases. Assert maximum active physical probes per mailbox is one, including timeout/queue cancellation.

### R08 — IMAP abort is attached after connect [P2]

- [ ] Attach abort before connect, reject already-aborted work, and cancel implicit-TLS retry clients as well as active searches.
- Evidence: `src/service/emailReceive/ImapEmailReceiveClient.ts:183–188,201–205,236–241,299–304`.
- Trigger/result: TCP/TLS/login connect hangs. Detector's 15-second deadline releases logical ownership, but connect has no abort listener yet and can linger while retries open another socket.
- Regression: fake connect settles only when closed; deadline must close/reject it, leave no orphan connection, and prevent a post-cancellation retry socket.

### R09 — Failed conditional evidence writes are ignored [P2]

- [ ] Honor the boolean write result. On a rejected negative, reread and return current positive evidence or unknown; do not cache the rejected negative.
- Evidence: `src/service/emailReceive/EmailReplyDetectionService.ts:1143–1152,1184–1192`; `src/model/EmailReceivedMessage.model.ts:187–201`.
- Trigger/result: another request persists positive evidence, so negative UPDATE guarded by `replyDetectedAt IS NULL` affects zero rows. Detector still reports/caches `not_replied`. A deleted row can likewise be reported as a successfully persisted positive.
- Regression: evidence port returns false; concurrent positive immediately before negative write; deleted-row positive write. Assert no successful rejected negative/cache entry and truthful outcome.

### R10 — Post-probe context fence reuses the old sender identity [P2]

- [ ] Reread sender identity and receive/source/Sent configuration at the closing fence. Compare complete versioned coverage context; a change returns `identity_conflict` without negative persistence.
- Evidence: `src/service/emailReceive/EmailReplyDetectionService.ts:903–940,1213–1226` uses the original `configuredSender` in both hashes. Persisted context also omits resolved Sent scope/source-folder details.
- Trigger/result: only configured From changes during I/O. Receive host/login remains constant, so a negative checked against the old sender is accepted for this invocation. Later cache invalidation does not protect the current call.
- Regression: change only `readIdentity().fromAddress` while search waits; require unknown/no negative write. Add source/Sent scope/version invalidation cases.

### R11 — New Answered flags still overwrite app lifecycle state [P2]

- [ ] Preserve historical sent projections but record future Answered positives in evidence/provenance fields without promoting every new/existing non-sent row to app `sent`.
- Evidence: `src/model/EmailReceivedMessage.model.ts:67–89,96–107,492–496`; `test/vitest/main/modules/EmailReceiveSyncProvenance.test.ts:334` onward asserts the conflicting promotion.
- Trigger/result: fresh Answered observation on a failed/drafted/in-flight message changes `replyStatus` to sent. It erases the distinction FR-030 makes between app delivery and mailbox-positive evidence.
- Regression: fresh and existing Answered rows retain lifecycle projection, gain sticky external positive; cleared flags retain protection; historical sent remains sent. Update the tests that currently require new promotion.

### R12 — Observation age is not checked immediately before SMTP [P2]

- [ ] Recheck freshness after claim and intervening awaits, retaining exact-attempt ownership for one bounded refresh. Positive/unknown/expired refresh must finalize safely without SMTP.
- Evidence: `src/service/emailReply/EmailReplyDeliveryService.ts:450–522,527,560` claims, awaits `markSubmitted`, then starts transport without another age check.
- Trigger/result: DB/queue delay after claim exceeds five seconds; SMTP submits using an observation older than the required window.
- Regression: hold submission persistence for six seconds, then reveal positive/unknown on refresh; assert zero SMTP and retained protection. Verify normal exact-attempt replay is unaffected.

### R13 — Failed draft reuse has no complete approved retry flow [P2]

- [ ] Provide a fenced same-draft retry transition and fresh explicit approval for definitely rejected delivery, excluding unknown/sent/in-flight states.
- Evidence: `src/service/emailReply/EmailReplyApprovalService.ts:76–79`; `src/model/EmailReplyDraft.model.ts:262–279`; `src/service/EmailReceiveAiTools.ts:379–383` accept only `draft` while reuse can return `failed`.
- Trigger/result: definite SMTP rejection → reuse original failed ID → approve/send unchanged content. Approval/tool refuses unless the operator edits/resets the draft through another path.
- Regression: reject definitely, reuse same ID, explicitly approve and retry successfully without a sibling. Ambiguous delivery remains blocked. An existing approved draft's confirmation/token restrictions are not by themselves this defect.

### R14 — Finalized same-token replay fails before idempotency lookup [P2]

- [ ] Resolve the trusted token record and exact existing attempt for replay while keeping consumed tokens unauthorized for new work.
- Evidence: `src/service/emailReply/EmailReplyDeliveryService.ts:219–225,347–361`; `src/model/EmailReplyApproval.model.ts:47`; finalization consumes approval at `EmailReplyDraft.model.ts:855–859`.
- Trigger/result: finalized sent/unknown attempt replay with the exact same token fails active-approval lookup instead of returning its existing attempt. The earlier in-flight replay fix does not cover consumed tokens.
- Regression: replay sent and delivery-unknown completions; return original attempt/outcome with no extra SMTP. A different token/draft remains subject to binding/approval rules.

### R15 — Reuse success can return a draft that became ineligible while waiting [P2]

- [ ] Validate the current draft/cluster again after awaited detection/audit, using a short transaction for a coherent reuse decision. Return current denial states, not an earlier draft snapshot.
- Evidence: `src/service/emailReply/EmailReplyDraftGenerationService.ts:507–530,547–559`.
- Trigger/result: reusable draft is read, detector waits, and another request claims/completes it. Service returns the old draft as allowed/reused even when current state is sending/sent/unknown.
- Regression: defer detector after its local-state check, transition the draft/attempt, resume; assert the appropriate typed denial and exactly one owned audit decision.

### R16 — Unexpected exceptions leave a live generation reservation [P2]

- [ ] Enclose the entire acquired section in owner-fenced `try/finally`; successful commit clears the held reservation, while every failure/exception releases only the current owner.
- Evidence: `src/service/emailReply/EmailReplyDraftGenerationService.ts:488–599,647,745–747,1072–1074,1208–1213,1532–1535`.
- Trigger/result: profile/database/envelope lookup throws after acquisition, or an unexpected non-transport exception escapes generation. No encompassing finally releases ownership; immediate retry is blocked until the five-minute lease expires.
- Regression: inject each exception after acquisition and retry without advancing time; acquisition must succeed and an older owner's cleanup must not release a newer owner.

### R17 — Provider compatibility matching and error-body deadlines are incomplete [P2]

- [ ] Require an explicit unsupported `response_format` parameter signal for hint fallback. Keep a deadline active through successful **and error** response-body consumption; classify timeout independently of compatibility.
- Evidence: `src/service/emailReply/EmailReplyDraftGenerationService.ts:219–245,1373–1385`; `src/service/aiProvider/OpenAICompatibleProviderClient.ts:249–275`; `src/service/aiProvider/AIProviderError.ts:57–61` awaits `res.text()`.
- Trigger A/result: 400 “invalid parameter max_tokens” or “unsupported parameter temperature” triggers hint-free retry because matching alternatives are OR-ed, despite no JSON-format rejection.
- Trigger B/result: non-2xx headers arrive but error body stalls. Headers timer was cleared and success-body timer is not yet armed; `toProviderError` can hang beyond call/invocation budget.
- Regression: unrelated parameter errors make one submission; explicit unsupported response_format makes one no-hint retry. Use a stalled non-2xx streaming response under a tiny budget; abort, no fallback/draft, reservation released.

### R18 — Reservation losers return without the required refusal audit [P2]

- [ ] Centralize audit ownership for reservation outcomes, with stage/code/request ID and persistence-failure propagation. Do not double-audit initial-policy denials.
- Evidence: `src/service/emailReply/EmailReplyDraftGenerationService.ts:565–595`.
- Trigger/result: concurrent calls both pass initial read policy; one wins acquisition, other returns `generation_in_progress` or a newly blocked outcome without a `reply_skipped` event. Disappeared reusable-draft refusal also needs coverage.
- Regression: force both callers beyond the read policy before acquisition; loser gets exactly one correlated refusal and winner creates one draft. Cover blocked/disappeared outcomes and audit failure.

### R19 — AI draft failures drop the request correlation ID [P2]

- [ ] Copy `requestCorrelationId` in `policyFailure`, and preserve correlation/IDs/next action in other tool outcome/typed-error mappings where the service provides them.
- Evidence: `src/service/EmailReceiveAiTools.ts:121–133`; create tool invokes this mapper at `339` area. Send tool result/error branches similarly build smaller envelopes.
- Reproduction: execute actual mapper with `{success:false, error:'refused', code:'already_replied', requestCorrelationId:'request-unique-123'}`. Returned object has success/error/code/next_action but **no requestCorrelationId**.
- Regression: every typed generation refusal carries the service request ID through tool and IPC results; verify send mappings separately. This is a boundary loss despite unique IDs now being generated correctly.

### R20 — Send transaction audits still correlate by message [P2]

- [ ] Add invocation IDs to claim/finalize/reconcile inputs and audit metadata; keep deterministic message correlation as a separate field.
- Evidence: `src/model/EmailReplyDraft.model.ts:768,909,1118` calls `correlationIdForMessage`; `ClaimSendInput` / `FinalizeOutcomeInput` omit invocation correlation.
- Trigger/result: different send requests for one message share lifecycle audit correlation, while the service result/refusal can contain a unique request ID. Claim/outcome events cannot reliably join that result.
- Regression: two invocations have different request IDs; each invocation's claim/outcome events share its returned ID and keep the separate message identifier.

### R21 — Optional generated review metadata is parsed then discarded [P2]

- [ ] Persist and return bounded `requiresHumanReview`, `reviewReasons`, and `unresolvedQuestions`; preserve them on reload/reuse and apply the intended review/approval contract.
- Evidence: `src/service/emailReply/EmailReplyGenerationSchema.ts:49–51`; generation consumes result at `872`, persists at `1100–1177`, returns at `1234–1246` without these fields.
- Trigger/result: valid JSON asks for human review or lists unresolved questions, but the resulting draft loses those signals. The authoritative classification fix should remain intact.
- Regression: provide each optional field, create/reload/reuse, and verify review signals survive with bounded values and cannot silently become lighter-review output.

### R22 — Already-replied next action suggests approving an existing draft [P2]

- [ ] Separate eligible reuse from already-replied denial. A draft ID on a refusal is context, not evidence it is eligible for approval/send; show review/locate/discard guidance instead.
- Evidence: `src/service/emailReply/EmailReplyNextAction.ts:35–38` returns `approve_existing_draft` for `already_replied` plus any draft ID. `src/views/pages/emailreply/auditdetail.vue` passes the audit's draftId into this mapper.
- Trigger/result: an already-replied audit refers to the draft whose send was blocked or previously completed. UI/tool tells the operator to approve it, contrary to the refusal. Service enforcement may still prevent sending; the guidance itself is wrong.
- Regression: already-replied with/without draft ID always provides a safe denial action; eligible `reused:true` has its separate approval guidance.

### R23 — Upgrade validation is not wired to production initialization [P2]

- [ ] Invoke validation in the actual startup/upgrade path and implement the documented failure gating. Validate exact unique index columns and preserve pre-upgrade invariants when claiming historical preservation.
- Evidence: `src/service/emailReply/EmailReplyUpgradeValidation.ts` is invoked by tests, not production; `src/config/SqliteDb.ts:687–712` and reliability startup do not call it. Commented `applyUpgradeValidationFailure` has no implementation. Validator `204–219` checks index SQL substrings; `256–268` accepts any nonnegative sent count.
- Trigger/result: corrupted/misconfigured upgraded schema can start guarded work without the promised validation refusal. `COUNT(sent) >= 0` cannot detect wiped/downgraded historical rows without a baseline.
- Regression: actual initialization with corrupted schema/wrong composite unique index fails new guarded work without destructive repair; populated upgrades run twice and verify pre/post IDs, bindings, status/protection. Helper-only tests are not production wiring evidence.

## Remaining contract and acceptance tasks

### G01 — Finish the generation contract and capability support

- [ ] Derive prompt and correction enum instructions from one shared schema contract. Current literals are duplicated in `EmailReplyGenerationSchema.ts:20–29,131` and `EmailReplyPromptBuilder.ts:98` (FR-025).
- [ ] Clamp the 1,500 default allowance against actual model context/output capabilities; constructor overrides alone are not capability detection. Current deferral is explicit at `EmailReplyDraftGenerationService.ts:290–295` (FR-027).
- [ ] Remember capability-confirmed unsupported JSON routes and omit the hint there; record capability invalidation when provider/model changes. Prove the two-validation/four-generation-submission cap across all lower-level retries, with separately bounded classification (FR-026).
- [ ] Bound every awaited stage against the remaining five-minute invocation budget, including retrieval/profile/envelope work; checkpoint-only expiry checks do not abort a hanging awaited stage (FR-035/039).

### G02 — Expose safe evidence and freshness in ordinary message summaries

- [ ] Extend `AiEmailMessageSummary` and `toMessageSummary` with safe persisted reply evidence/freshness/context fields (FR-033). `src/service/EmailReceiveAiTools.ts:594–621` currently returns only coarse `replyStatus`, not the new evidence; fetch/get tools use this mapper.
- [ ] A freshly Answered row will need separate evidence to explain blocking after R11 stops projecting every flag into sent. Use nullable legacy timestamps and three-state semantics; never expose credentials/raw mailbox exceptions.
- [ ] Test list/fetch/get summaries for legacy, external-positive, stale-negative and unknown messages, as well as diagnostic DTO compatibility.

### G03 — Verify complete user workflows, not only audit rendering

- [ ] Add/run critical E2E cases for eligible reuse → explicit approval → fresh send check; positive/unknown refusal after draft; definitely failed retry; unknown reconciliation with quiescence; and translated failure guidance (FR-034).
- [ ] The new audit-evidence spec seeds local sent state and renders/rechecks it. It cannot prove real mailbox detection, approval binding, delayed-send freshness or recovery races.
- [ ] Check all new keys in en/zh/es/fr/de/ja and actual renderer outcomes, including next-action correctness, disabled/loading/error states, and audit-persistence failure. Component passing results are useful but are not a substitute for these cross-layer cases.

### G04 — Correct and execute live pilot/release acceptance

- [ ] Fix `docs/prd/emailreply-pilot-and-rollout-plan.md:134–143`: the current procedure sends an original **from** the configured mailbox and asks the third party to reply. That reply is in configured Inbox, authored by the third party, and cannot prove a configured-sender reply in Sent.
- [ ] Correct procedure: send the inbound original from a third party **to** the configured mailbox, sync its stored received-row ID, then reply from configured webmail/client so a direct reply is saved in configured Sent; run detection against the stored inbound row.
- [ ] Execute corrected IMAP/Sent and hosted/local JSON compatibility pilots. Capture provider/capability results, first-pass/correction/truncation/fallback rates, unknown reasons, detection p95, cache and guard conflicts, and release signoff (FR-026/039).
- [ ] Mark the pilot plan and old TODO accurately: code/plan landed is distinct from pilot executed. Do not invent baselines or claim all Phase 2 complete. Keep local duplicate checks active during rollback and block unavailable automated workflows.

### V01 — Fix main-suite database isolation

- [ ] Give each test worker/suite a unique temporary database and close connections deterministically, or explicitly serialize suites that intentionally share one fixture. `EmailReplyDraftGeneration.test.ts:51–65` seeds through `EmailServiceModel('')`; `src/model/Basedb.ts:17` falls back to shared `aifetchly-test` storage.
- [ ] Reproduce and eliminate the observed setup `database is locked` failure under the supported normal parallel runner. The obtained serial pass is a diagnostic workaround rather than proof normal execution is reliable.
- [ ] Ensure failure artifacts distinguish skipped-by-setup tests from exercised assertions and never touch the real user database.

### V02 — Retained POP3 receive identity issue (outside guarded IMAP scope)

- [ ] Replace mutable POP3 sequence-number identity with actual stable UIDL handling. `src/service/emailReceive/Pop3EmailReceiveClient.ts:87–92,140–143` still uses `String(uid)` despite a UIDL comment.
- Trigger: deleting an earlier server message renumbers later messages; stored content can be replaced under another message's local lifecycle/evidence. This is retained receive behavior, not a new guard regression; POP3 guarded replies deliberately remain unavailable.
- Regression: sync, delete first server message, resync; remaining messages keep their own IDs/content/status and no cross-message evidence is adopted.

## Earlier audit reconciliation

| Earlier finding | Current disposition |
|---|---|
| B01 classification before local guard | Fixed: local guard/reservation/reuse precede classifier; injection seam exists. |
| B02 missing authoritative attempts | Implemented for indexed cluster; legacy/row-positive aggregation still incomplete (R03). |
| B03 hand-filtered post-generation recheck | Fixed read-side filter; transaction/evidence race remains (R01). |
| B04 same-attempt replay | In-flight lookup improved; finalized consumed-token replay remains (R14). |
| B05 refusal/tool-call payload discarded | Fixed: actual payloads captured/rejected. |
| B06 unconditional JSON incompatibility failure | Fallback added; matching/capability behavior remains partial (R17/G01). |
| B07 suggested intent overwrites classification | Fixed: suggestion is stored separately. |
| B08 failed draft ignored/stranded | Existing failed ID can be reused; complete approval/retry remains blocked (R13). |
| B09 warnings/reuse audit missing | Stored warnings and strict reuse audit added; awaited eligibility can change (R15). |
| B10 audit error caught as provider error | Original catch-boundary defect fixed. |
| B11 per-message request correlation | Generation ID allocation fixed; tool/lifecycle boundary losses remain (R19/R20). |
| B12 IPC strips structured error | Typed IPC/renderer envelopes implemented; complete tool/summary guidance still incomplete (R19/R22/G02). |
| B13 header-only timeout | Success body timed; error body and all-stage deadline remain incomplete (R17/G01). |

## Suggested completion order

1. Fix R01–R06 together around one canonical eligibility/evidence contract, adding real-adapter and transaction-race regressions.
2. Fix mailbox queue/cancellation/cache context and future flag provenance (R07–R11).
3. Close send/reuse/retry/owner cleanup and provider deadline behavior (R12–R17).
4. Complete auditing, result metadata, review guidance and real startup validation (R18–R23, G01–G03).
5. Restore reliable parallel tests, execute corrected pilots, and update requirement completion claims using actual evidence (V01, G04).

Do not mark a checkbox complete based only on adding a helper or changing the existing tests to accept unsafe behavior. Each fix needs its stated adversarial regression, passing relevant existing suites, and integration through the production entry path. Full-feature completion also requires the explicitly external pilot/release evidence.
