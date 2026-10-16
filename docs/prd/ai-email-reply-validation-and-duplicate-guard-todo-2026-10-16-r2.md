# Email reply validation and duplicate guard — October 16 re-audit, round 2

## Verdict and scope

**The complete PRD cannot yet be accepted.** The two previously reported P1 send/recovery defects are fixed in the reviewed source, as are late reservation acquisition, default-open readiness, and incorrect guidance after human review. Ten correctness or UI issues remain below. The normal focused backend run also had one failure that did not reproduce when rerun alone or with its complete test file; this is an unresolved test-reliability issue, not proof of an application defect.

- Worktree: `/Users/cengjianze/project/aiFetchly/.claude/worktrees/email-reply-validation-phase1`.
- Reviewed source HEAD: **`ac1419f776f61929953f88dfdc6a584fed74e99c`**; branch `worktree-email-reply-validation-phase1`.
- Change baseline: `28b7fefdc`, the preceding review report.
- Contract: [PRD](ai-email-reply-validation-and-duplicate-guard-prd.md), FR-025–FR-039, and [technical design](ai-email-reply-validation-and-duplicate-guard-technical-design.md).
- Review date: October 16, 2026, Asia/Shanghai. References identify source at the reviewed HEAD. This report changes documentation only.

P2 means a concrete issue to fix before accepting the affected requirement. Source inspection and controlled execution establish the findings described here; this review does not establish that every possible bug has been found. Live hosted-AI and real mailbox acceptance remain separate from loopback tests.

## Fresh verification

| Check | Result |
|---|---|
| Focused backend, normal file parallelism | **39 files passed, 1 failed; 647 tests passed, 1 failed, 648 total** |
| Failed test alone | **Passed**; 142 other tests excluded by name selection |
| Entire generation test file rerun | **143 tests passed** |
| Focused utility tests | **16 files / 228 tests passed** |
| Full component suite | **71 files / 455 tests passed** |
| Four focused Electron E2E specs | **13 tests passed**, including the new visible review-button interaction, loopback generation/reuse/SMTP and reconciliation |
| Read-only execution of selected current methods with controlled dependencies | Reproduced R01, R02, R03, R04 and R09; details below |

The backend failure was `EmailReplyDraftGeneration.test.ts:2835`, **“two invocations for the same message get DISTINCT requestCorrelationIds and each result carries its own.”** Its first result unexpectedly had `success: false`. Both subsequent checks passed without source changes. The initial run must not be described as green, nor this observation as a demonstrated broken correlation-ID algorithm. T01 specifies the remaining investigation.

Temporary evidence is under `/tmp/email-reply-audit-2026-10-16-r2-`: `main.log`, `failure-confirm.log`, `generation-confirm.log`, `utility.log`, `components.log`, `e2e.log`, `repro.cjs` and `repro.log`. These are local scratch evidence, not committed test fixtures. The reproductions transpile selected current source methods and substitute controlled ports; they do not constitute a full real-database/network race test.

## Requirements assessment

| Requirement | Assessment at reviewed HEAD | Remaining acceptance work |
|---|---|---|
| FR-025: prompt/schema and correction | Implemented in reviewed scope | Preserve shared enums, bounded correction and local validation. Context correctness depends on R04–R06. |
| FR-026: JSON compatibility | Code and controlled local route covered | Real hosted compatibility and provider-specific fallback/ignored-hint acceptance remain T02. |
| FR-027: actual model limits/completion handling | Partial | Rendered fitting/output reservation added, but context provenance and token bound remain R04/R05. |
| FR-028: guarded generation/reuse | Core path implemented | Late acquisition now fenced; supplied-source audit provenance remains R06. |
| FR-029: shared enforcement | Prior critical defect fixed | Deliberate sibling refusal now propagates. Final submission freshness remains R01 under FR-031. |
| FR-030: flags and targeted writes | Implemented in reviewed scope | No recurrence of lifecycle promotion or clearing sticky positives found. |
| FR-031: fresh evidence at submission | Partial | Final ownership lookup introduces an unchecked delay after the age gate (R01). |
| FR-032: detector/diagnostic tool | Partial | Expired negative persistence remains visible before compensating cleanup (R02). |
| FR-033: safe typed results and guidance | Backend guidance fixed | Human-facing completion still has R07/R08. |
| FR-034: audit/localization/UI | Partial | Missing terminal timeout audit (R03), audit provenance (R06), review usability/race (R07/R08); T01. |
| FR-035: ownership/deadline/atomic creation | Partial | Acquisition lease clamp closes F04, but commit uses stale time (R09); terminal/post-commit awaits remain R03/R10. |
| FR-036: atomic send/recovery | Prior claim-to-SMTP liveness defect fixed | Preserve whole-operation tracking and final ownership fence while fixing R01. |
| FR-037: cache integrity | Partial | Compensating deletion cannot prevent another reader consuming expired-owner evidence (R02). |
| FR-038: upgrades/legacy/readiness | Implemented in reviewed scope | Production now starts pending; explicit fixture state replaces permissive production defaults. |
| FR-039: bounds/metrics/release | Partial | R01–R05/R09/R10, test reliability T01, and actual pilot/measurement/signoff T02 remain. |

“Implemented in reviewed scope” is a source/test assessment, not an exhaustive production guarantee. This matrix includes the cross-cutting dependencies rather than treating a passing helper test as full acceptance.

## Remaining issues and tasks

### R01 — Final ownership lookup can outlive the five-second freshness permission [P2]

- **Source:** `src/service/emailReply/EmailReplyDeliveryService.ts:775–783,813–836,1099–1101`.
- **Trigger:** the post-claim freshness gate succeeds, then the last attempt read waits more than five seconds. It eventually returns the same `submitted` attempt.
- **Actual:** `checkClaimOwnershipBeforeSmtp` checks only attempt status. SMTP follows without checking the age of the negative observation again. A seed/sibling positive arriving during that await is also outside the earlier evidence read.
- **Controlled reproduction:** actual `runClaimedSendToFinalization` and actual final ownership method, with a successful freshness port and a final read advancing the clock by 6,001 ms, reached the sender once and returned `sent`; observation age at submission was **6,001 ms**. This demonstrates the ordering defect without waiting six real seconds.
- **Impact:** FR-031 requires evidence at most five seconds old at claiming/submitting and bounded refresh on delay. The new fence fixes lost ownership but does not preserve the freshness permission across its own await.
- [ ] Carry the actual observation timestamp to the final handoff, combine current ownership/cluster evidence checks where possible, and check age after the last awaited read immediately before transport.
- [ ] If stale, use the single permitted delayed refresh while holding the claim; refuse when fresh evidence cannot be established or that allowance is exhausted. Preserve whole-operation liveness and known-unsent refusal finalization.
- [ ] Regression: hold the final attempt lookup beyond five seconds, then return an active attempt. Require fresh evidence or zero SMTP. Separately introduce current positive evidence while that lookup waits.

### R02 — Expired negative evidence is reusable until compensating deletion finishes [P2]

- **Source:** `src/service/emailReceive/EmailReplyDetectionService.ts:1404–1443`; `src/model/EmailReceivedMessage.model.ts:203–247`; module cleanup at `src/modules/EmailReceivedMessageModule.ts:163` area.
- **Trigger:** a negative write starts within budget, finishes after probe timeout, and cleanup is delayed or fails.
- **Actual:** the model UPDATE has positive/monotonic-time conditions, but no probe-owner/expiry eligibility condition at commit. The service detects expiry only after that write and starts another awaited call to void it. Another detector can read the expired observation during this gap. Cleanup exceptions are logged and swallowed, leaving it reusable for the rest of its 60-second TTL.
- **Controlled reproduction:** executing actual `persistNegative` with a port that completes after expiry and a held cleanup call left `replyNegativeCheckAt` present and inside TTL while the probe was expired. Successful eventual cleanup does not remove this earlier consumption window.
- **Improvement already verified:** preserved observation time, newer-negative protection, and timestamp-targeted cleanup are useful. They do not provide atomic exclusion of expired writes.
- [ ] Enforce expiry/owner eligibility at the actual persistence transaction boundary. Readers must never consume an expired owner's result; cleanup after exposure cannot be the validity mechanism.
- [ ] Regression: release a real late write after timeout while holding cleanup, then run another detection before cleanup finishes. Require another probe or unknown, never cached `not_replied` from that write. Repeat with cleanup failure and concurrent newer negative/positive observations.
- [ ] Extend the F03 integration test around `EmailReplyAuditN01N09G02.integration.test.ts:547`: it currently awaits cleanup before checking the next invocation, missing this interval.

### R03 — Exhausted generation deadline skips the mandatory refusal audit [P2]

- **Source:** `src/service/emailReply/EmailReplyDraftGenerationService.ts:1105–1143,2916–2937,2949–2978`.
- **Trigger:** correction, retrieval, or another stage actually exhausts the invocation deadline before a terminal audit has started.
- **Actual:** `returnDeadlineExceededOutcome` calls `recordFailure`, whose lazy factory is rejected by the same exhausted deadline before any audit write starts. The terminal handler catches that timeout and returns a structured failure without the required `reply_skipped` event. Marking `auditMutationAttempted` before starting the factory also does not prove a write was attempted.
- **Controlled reproduction:** actual terminal handler, actual deadline race and actual `recordFailure`, with an expired deadline and a resolved message, returned `provider_error`/`discard_and_retry` with **zero audit writes**. Cleanup also skipped its write. The earlier uncaught-timeout/double-audit behavior is fixed; the remaining issue is absence of required evidence.
- [ ] Reserve a bounded terminal audit/cleanup slice within the five-minute invocation, or provide an explicitly bounded terminal transaction with one owner. Keep persistence failure distinguishable from timeout and preserve no duplicate events.
- [ ] Regression: consume the work budget during correction and retrieval; assert one correlated terminal refusal, no draft, structured outcome, and bounded completion. Include terminal persistence rejection/hang and late work rejection.
- [ ] Do not report the old stranded five-minute live lease as still present: F04 now clamps every granted lease to invocation expiry, so a full timeout no longer establishes that old defect.

### R04 — A fabricated model context fallback is reported as provider-confirmed [P2]

- **Source:** `src/service/AIChatModelCatalogService.ts:65–69,140–154`; `src/service/emailReply/EmailReplyDraftGenerationService.ts:302–321`.
- **Trigger:** the models endpoint lists the selected/default model but omits context-window metadata.
- **Actual:** the catalog substitutes its default **256,000** tokens and later labels the entry `limitSource: "provider"`. The reply context resolver trusts that label, so the generation layer's intended unknown-model fallback is bypassed. A small model with omitted metadata is budgeted as a large one.
- **Controlled reproduction:** actual catalog class fed `{default_model: "small-model", data: [{id: "small-model"}]}` returned `{contextLimit: 256000, outputLimit: 16384, limitSource: "provider"}`.
- [ ] Retain provenance per capability field. An inferred context limit must remain unknown/fallback; only actual reported or explicitly verified configured limits may count as provider-confirmed.
- [ ] Regression: listed default model with missing context fields, missing model, explicit small/large windows, and malformed capability values. Assert the reply resolver distinguishes each case.
- [ ] Verify settings-change invalidation too: the output resolver uses process-wide `sharedModelCatalog` (`DraftGenerationService.ts:279,328–345`), and `ensureLoaded` (`AIChatModelCatalogService.ts:86–88`) never refreshes an already populated cache. Exercise provider A → B with the same model ID and a lower output cap; invalidate/key by provider/config version so a previous provider cannot supply the current cap.

### R05 — Average character ratios do not enforce the actual model token window [P2]

- **Source:** `src/service/emailReply/EmailReplyContextBudget.ts:22–25,38–58`; fitting in `EmailReplyDraftGenerationService.ts:1441–1484`.
- **Actual:** measuring the exact rendered strings fixes the old disagreement with prompt rendering, but dividing ASCII by four and non-ASCII code points by 1.5 is still an average estimate. Code, encoded text, rare characters and emoji can use more actual tokens. A fixed 512-token margin does not bound underestimation as input grows. Nor does a generic 32,768-token fallback prove the limit of an unknown smaller model.
- **Impact:** the admission check can declare a request fitting while actual input plus reserved output exceeds the selected model's window. This remains an FR-027 gap even though ordinary English inputs and the current ratio-based tests pass.
- [ ] Use a tokenizer matching the supported model families, or a documented safe upper bound with explicitly supported families/configured limits. Include message framing and correction additions in admission.
- [ ] Treat unknown limits explicitly rather than claiming 32,768 is safe for any unreported model. Provide a verified configurable limit or a refusal path where necessary.
- [ ] Regression: compare admitted near-limit prompts with real tokenizer counts for code/encoded ASCII, CJK, rare Unicode and emoji. Test output reservation and known small/large windows. Existing tests only assert the ratios themselves and cannot establish that they are conservative.
- [ ] Do not invent a separate correction-prefix overflow finding: no independent failure from that bounded prefix alone was established in this review.

### R06 — Audit serialization loses supplied-versus-retrieved source provenance [P2]

- **Source:** `EmailReplyDraftGenerationService.ts:1914–1921,2117–2125,2678–2684`; audit DTO count at `src/main-process/communication/emailReceive-ipc.ts:793–798`; display at `src/views/pages/emailreply/auditdetail.vue:69–70`.
- **Trigger:** fitting removes one or more retrieved sources from the actual prompt.
- **Actual:** draft JSON correctly adds `suppliedToPrompt`, and the fresh result returns fitted sources. However, `writeAutoAudit` receives all marked candidates and serializes only tool/chunk/document/name, discarding the flag. The UI DTO counts all serialized candidates and the audit page displays that total as the knowledge source count. Omitted candidates are indistinguishable from supplied grounding in this audit surface.
- [ ] Preserve supplied/omitted status through audit serialization, DTO and display, or restrict this surface to supplied sources and retain retrieval diagnostics separately.
- [ ] Persist supplied/dropped identities and coverage in revision metadata if that metadata is the durable provenance record; currently its conversation context also reflects pre-fit context metadata.
- [ ] Regression: force one candidate out, inspect the actual request, draft JSON, revision metadata, audit DTO and page. Counts and grounding labels must identify the sources actually supplied.

### R07 — Human-review screen is unreachable through normal navigation and omits the reply body [P2]

- **Source:** `src/views/pages/emailreply/draftdetail.vue:10`; `src/views/pages/emailreply/widgets/ReplyDraftReviewCard.vue:32–46,66–85`; route at `src/views/router/index.ts:874`; E2E at `test/e2e/specs/emailReplyGuardedSuccess.test.ts:605`.
- **Actual:** the new page renders only the review card. The card displays subject, original review reasons and questions, then permits acknowledgment; it does not display `bodyText`/`bodyHtml`. The ordinary detail IPC already supplies that content (`emailReceive-ipc.ts:391–393`). The route has no incoming product link; the new E2E reaches it by manually assigning the location hash.
- **Impact:** the user cannot discover this review action through the normal product flow and cannot inspect the complete reply on the screen that marks its revision reviewed. Backend revision binding and the visible button are implemented, but the requested human-facing interaction remains incomplete.
- [ ] Link the review-required draft from the applicable draft/audit view. Display the exact revision content and relevant envelope before acknowledgment, with safe rendering.
- [ ] Preserve revision-bound human authority: acknowledgment must still precede independent approval and must not bypass policy, content or send checks.
- [ ] Add component assertions for displayed content plus an E2E that follows the real product link, reads the revision, resolves it, then verifies an edit restores pending review. Update all six languages for new visible text.

### R08 — Out-of-order detail responses can display the wrong draft [P2]

- **Source:** `ReplyDraftReviewCard.vue:165–173,176–185,204–210`.
- **Trigger:** request A is pending; the route/prop changes to B and starts request B; B resolves, then A resolves last.
- **Actual:** both loads assign the same `draft` ref without an ID/request-generation check. A overwrites B while `props.draftId` remains B. Review then submits B's draft ID with A's revision ID. The backend's binding check refuses safely, but the user sees incorrect content/state and cannot finish review without reloading. A stale failure can similarly clear a newer successful result.
- [ ] Capture the requested ID and request generation; ignore responses/errors from superseded loads. Clear previous content on navigation and keep loading/resolve state attached to the active draft.
- [ ] Regression: defer two requests, resolve B then A, and require B's content/revision to remain displayed and submitted. Repeat with A rejecting after B succeeds and with navigation during acknowledgment.

### R09 — Queued atomic commit can persist after its generation owner expires [P2]

- **Source:** `src/service/emailReply/EmailReplyDraftGenerationService.ts:1983–1996`; `src/modules/EmailReplyDraftModule.ts:196–201`; `src/model/EmailReplyDraft.model.ts:649–660,767–778`; mutex admission in `src/model/replyTxn.ts`.
- **Trigger:** the service samples `input.now` just before lease expiry, then the module waits for connection readiness or the commit waits for another transaction. The queue opens after expiry, with no intervening owner reclaim.
- **Actual:** the model compares the lease against that old caller timestamp. The final guard transition checks only ID/owner token. The unchanged old owner can therefore persist draft, revision, projection and audit after its absolute expiry. F04 correctly fixes acquisition; it does not fix this distinct commit boundary.
- **Controlled reproduction:** actual `commitGeneratedDraft` with request time 200,000 ms, lease expiry 200,100 ms and mutation time 200,200 ms returned **`committed`** and performed the draft insert. Manager/cluster ports were controlled and eligible; the tested defect is the actual method's stale-time fence, not a real database contention measurement.
- [ ] Read an advancing clock after actual transaction admission and at the final mutation fence. Require the current owner, expected generating phase and an unexpired lease, rolling back all earlier writes if the final condition fails.
- [ ] Keep deterministic tests by injecting a clock function at the model boundary, rather than making a pre-queue timestamp authoritative.
- [ ] Regression with the real shared transaction mutex: hold it, request commit before expiry, pass expiry, then release it. Require fenced/no draft, revision, creation audit or message promotion. Repeat with lease expiry during in-transaction reads and an intervening owner replacement.

### R10 — Optional post-commit audit can hang the complete generation invocation [P2]

- **Source:** `src/service/emailReply/EmailReplyDraftGenerationService.ts:2113–2128,2668–2695`.
- **Trigger:** required atomic creation succeeds, then the optional auto-reply audit persistence never settles.
- **Actual:** the service directly awaits `writeAutoAudit`, which directly awaits the module's `create` without a deadline race. Its best-effort catch handles rejection but cannot bound a pending promise. The draft exists, yet the caller never receives its ID/success result, even after the complete invocation's five-minute deadline.
- **Controlled helper check:** the actual optional-audit method started its persistence port even with an already-expired service deadline and remained pending against a held port. This is a selected-method check, not a five-minute end-to-end timing test; the unbounded complete-invocation path is established by the direct awaits above.
- [ ] Bound optional post-commit reporting within the remaining budget and return the already committed draft when optional reporting cannot finish. Observe detached rejection safely; do not report this as a fresh generation failure inviting replacement generation.
- [ ] Audit remaining direct awaits, including the commit wait itself, against the complete invocation deadline. Preserve atomic commit-outcome certainty when bounding persistence; a timeout wrapper alone cannot undo a later write.
- [ ] Regression: successful real commit plus a held optional audit promise. Advance/exhaust the deadline, require bounded completion returning the committed draft ID, and assert exactly one draft/revision. Include a late optional-audit rejection.

## Remaining acceptance tasks

### T01 — Diagnose the intermittent backend failure and establish a truthful green run

- [ ] Investigate why the normal 40-file run returned a failed reuse result at the correlation test while both isolated checks passed. Capture the actual failure outcome, not just its success assertion; check shared fixture/state, retained evidence and mock isolation under normal parallel execution.
- [ ] Keep the existing behavioral assertions. Do not remove the test or accept all refusals just to turn the suite green.
- [ ] After changes, run the normal focused backend selection again and record the complete result. The present evidence is **647/648 in the normal run**, followed by passing isolation checks; those are different facts.
- [ ] Add meaningful regressions for R01–R10 at the persistence/transport/UI boundaries described above. Current passing helper tests miss these intervals or presentation boundaries.

### T02 — Complete actual provider and rollout acceptance

- [ ] Execute the real IMAP/Sent and hosted-AI pilots from [pilot and rollout plan](emailreply-pilot-and-rollout-plan.md), including supported provider families, JSON supported/unsupported/ignored behavior, read-message flags and Sent coverage.
- [ ] Record first-pass validation, correction/fallback/truncation, unknown reasons, latency/cache/guard conflict metrics and availability impact against a real baseline. Keep private message bodies and credentials out of telemetry.
- [ ] Verify negative-cache context invalidation across identity/Sent configuration changes and capability invalidation across provider/model setting changes, then collect release signoff.
- [ ] Preserve the distinction between code implemented, deterministic/loopback checks executed, and live acceptance completed. Existing documentation explicitly leaves live pilot baselines/signoff open; no live result was fabricated in this review.

## Disposition of the previous report

| Previous item | Verified disposition at this HEAD |
|---|---|
| F01: swallowed final sibling refusal | **Fixed.** Catch encloses only the cluster read; deliberate refusal propagates, and failed cluster read cannot use the fresh-negative fast path. |
| F02: pre-SMTP operation missing from tracker | **Fixed for the original recovery race.** Tracker encloses successful claim through gate/SMTP/finalization, with finally cleanup; terminal-state handoff fence added. R01 concerns freshness after that new fence. |
| F03: expired negative write | **Partially fixed.** Monotonic write and cleanup landed; atomic validity is still R02. |
| F04: late acquire creates live lease | **Fixed in reviewed source.** Absolute owner expiry is checked at mutation and granted leases are clamped to it. |
| F05: repeated timeout/audit exception | **Original throw/re-audit fixed.** Structured timeout returns now work, but required terminal audit remains R03. |
| F06: wrong rendered/context budget | **Partially fixed.** Exact rendered fitting/output reservation and typed oversized-input audit landed; capability provenance and real token bounds remain R04/R05. |
| F07: inaccurate grounding | **Partially fixed.** Fresh DTO/draft JSON distinguish supplied context; audit serialization still loses it (R06). |
| F08: default-open readiness | **Fixed.** Zero-import state defaults pending; test fixtures explicitly authorize readiness. |
| F09: resolved review gets unresolved guidance | **Fixed.** Shared revision-aware effective status drives approval and reuse guidance while retaining original model provenance. |
| T01: prior three deterministic main failures | They did not fail in this run. One different intermittent failure remains current T01. |
| T02: no renderer review control | Visible card/page/component test and click E2E added. Discoverability, content visibility and response ordering remain R07/R08. |
| T03: provider/release acceptance | Controlled integration has improved; live pilots/measurements/signoff remain current T02. |

## Suggested order

1. Close final submission freshness and expired-evidence persistence (R01/R02).
2. Fence commit expiry and complete invocation bounds (R09/R10), terminal audit behavior and trustworthy model/context budgeting (R03–R05).
3. Correct audit provenance and human-review presentation/state (R06–R08), establish a green normal backend run (T01), then complete live acceptance (T02).

This is a new review deliverable. Earlier TODO files remain historical evidence; their remaining-work lists should not be treated as the current defect list without this disposition table.
