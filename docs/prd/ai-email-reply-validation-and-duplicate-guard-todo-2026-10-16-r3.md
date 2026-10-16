# Email reply validation and duplicate guard — October 16 re-audit, round 3

## Verdict and scope

**The full PRD is still incomplete.** The reviewed changes fix several previous findings, including visible review content/navigation, stale UI loads, audit grounding provenance, ordinary model-limit provenance, queued commit admission, terminal refusal auditing, and the optional post-commit audit hang. Five current correctness findings remain below, plus the unresolved actual-token-budget requirement, backend suite reliability and live acceptance. Do not treat the checked boxes in the previous report as current acceptance evidence for these narrower residuals.

- Worktree: `/Users/cengjianze/project/aiFetchly/.claude/worktrees/email-reply-validation-phase1`.
- Reviewed source: **`f9cd4c4881d1798587b464280d5b9eb1e228441f`**, branch `worktree-email-reply-validation-phase1`.
- Baseline: previous review commit `95b51297b`.
- Contract: [PRD](ai-email-reply-validation-and-duplicate-guard-prd.md), FR-025–FR-039, and [technical design](ai-email-reply-validation-and-duplicate-guard-technical-design.md).
- Date: October 16, 2026, Asia/Shanghai. Source references identify the reviewed revision. This deliverable changes documentation only.

**P1** blocks release of the affected send path. **P2** requires correction before accepting the affected requirement. This review combines source inspection, fresh tests and selected current method bodies executed with controlled dependencies; it does not prove absence of every possible bug.

## Fresh verification

| Check | Result |
|---|---|
| Focused backend, normal file parallelism | **43 files passed, 1 failed; 700 tests passed, 1 failed, 701 total** |
| Complete generation file rerun, without source changes | **149 tests passed** |
| Focused utility suite | **16 files / 228 tests passed** |
| Full component suite | **71 files / 465 tests passed** |
| Four focused Electron workflow specs | **14 tests passed**, including real product navigation, visible review/edited-revision behavior and loopback generation/reuse/send/reconciliation |
| Selected-method controlled checks | Reproduced N01–N05 below; details distinguish helper/port evidence from full integration evidence |

The backend failure was `test/vitest/main/EmailReplyDraftGeneration.test.ts:2069`, **“reuses an eligible draft with zero AI calls even when classification is unknown.”** It returned `success: false` in the normal run; the complete file subsequently passed. This is a current intermittent suite-level failure. It is not evidence that the old correlation-ID assertion is still failing, nor proof that the reuse algorithm always fails.

The first test launch could not find Node in the shell PATH. Tests were then rerun using the existing Node 22 installation; the table reports those actual completed runs, not that launch failure. No dependency or application source was changed.

Local temporary evidence: `/tmp/email-reply-audit-2026-10-16-r3-main.log`, `-generation-confirm.log`, `-utility.log`, `-components.log`, `-e2e.log`, `-repro.cjs` and `-repro.log`. Controlled checks transpile selected current source and substitute ports/clocks; they are not full real-database/network race tests. The TODOs below specify the integration regressions still needed.

## Requirement assessment

| Requirement | Assessment | Remaining work |
|---|---|---|
| FR-025 — schema/correction contract | Implemented in reviewed scope | Retain shared contract and original-context correction; actual context admission remains G01. |
| FR-026 — JSON compatibility | Controlled route implementation covered | Current capability-switch race N05 and real hosted compatibility T02. |
| FR-027 — model/output/context limits | Partial | Missing-context provenance fixed; in-flight catalog invalidation N05 and actual-token bound G01 remain. |
| FR-028 — guarded generation/reuse | Core implementation present | Negative-evidence validity N02/N03 and suite reliability T01 affect acceptance. |
| FR-029 — shared local enforcement | Partial | Final handoff can use independently stale snapshots, including known sibling-positive evidence (N04). |
| FR-030 — flags and metadata isolation | Implemented in reviewed scope | No recurrence of lifecycle promotion/cleared sticky evidence established. |
| FR-031 — fresh evidence before draft/send | Partial | Pending evidence N01, late confirmation N02, extended TTL N03, final snapshot consistency N04. |
| FR-032 — detector and diagnostic tool | Partial | Late-confirmation/negative-cache validity N02/N03. Tool contract remains present. |
| FR-033 — typed results and guidance | Implemented in reviewed scope | Effective revision-aware guidance remains fixed; keep diagnostics safe. |
| FR-034 — audit/localization/UI | Major previous gaps fixed | Terminal refusal tests, supplied-source audit and review UI now exist. T01/T02 still gate acceptance; G02 concerns literal deadline semantics. |
| FR-035 — reservation/atomic creation/deadline | Partial | Old queued-expiry commit case fixed; complete five-minute bound needs G02. |
| FR-036 — atomic send/recovery | Partial | Preserve whole-operation tracking, but final snapshot consistency remains N04. |
| FR-037 — cache integrity | Partial | Pending/confirmation validity N01/N02 and observation-based memory TTL N03. |
| FR-038 — upgrade/legacy/readiness | Implemented in reviewed scope | Default-pending readiness and advancing commit checks retained; no new upgrade defect established here. |
| FR-039 — bounded rollout/measurements | Partial | G01/G02, a truthful green normal backend run T01, and real pilot/signoff T02. |

“Implemented in reviewed scope” is bounded by this review and its checks; it is not an exhaustive production guarantee. The full PRD includes release evidence as well as code.

## Confirmed correctness findings

### N01 — Send consumers omit the pending-negative marker [P2]

- **Source:** `src/service/emailReceive/EmailReplyIdentity.ts:91–105`; atomic claim at `src/model/EmailReplyDraft.model.ts:974–977`; delivery helper at `src/service/emailReply/EmailReplyDeliveryService.ts:1300–1313`.
- **Trigger:** a concurrent/late probe stages a fresh negative with `replyNegativeContextHash = "PROBE_PENDING"` after the send's own forced check and before claim/final handoff. The staged result has not been confirmed.
- **Actual:** the shared helper rejects the marker only when its optional context-hash property is supplied. Both authoritative send readers pass timestamp and owner expiry but omit context. Their freshness check can therefore accept staged, unconfirmed evidence.
- **Controlled check:** the actual predicate returned **false** for a complete pending row and **true** for the same row projected into the actual send-reader argument shape. This demonstrates the admission defect; it is not a demonstrated end-to-end duplicate SMTP submission. The normal send path does await its own forced detector, so a competing observation/interleaving must be included in integration coverage.
- [ ] Make confirmation/context state mandatory in the shared usability input and pass it through atomic claim, post-claim gate and final handoff. Missing or pending context must not establish a successful negative.
- [ ] Regression with a real staged SQL row: current observation, future owner expiry, pending marker. Claim and final handoff must refresh/refuse and must never derive permission from that pending row. Include failed confirmation and crash between stages.

### N02 — The second confirmation write can finish after probe expiry and become reusable [P2]

- **Source:** `src/service/emailReceive/EmailReplyDetectionService.ts:1469–1489`; UPDATE boundary in `src/model/EmailReceivedMessage.model.ts:206–227`; usability comparison in `EmailReplyIdentity.ts:101–105`.
- **Trigger:** phase-one pending staging finishes on time. The probe passes its liveness check, then waits in the **second**, confirming UPDATE until after its 15-second deadline.
- **Actual:** confirmation writes the real context hash without a commit-time expiry predicate. The shared helper compares original observation time against owner expiry, not confirmation completion time; an observation made before the deadline naturally passes. There is no post-confirmation rollback/fence. The completed timed-out probe can leave a matchable negative inside the 60-second TTL.
- **Controlled check:** actual `persistNegative` with the second port held until time 116,000 ms against owner expiry 115,000 ms returned **true**; actual `readCachedNegative` then returned **`not_replied`, `fromCache: true`** for that late confirmation. Original observation time was 100,000 ms.
- [ ] Confirm conditionally at the actual model transaction boundary, matching the exact pending observation/owner and requiring a still-live probe. Preserve observation time separately from confirmation validity; monotonic timestamps alone are not ownership/expiry fencing.
- [ ] Regression: delay the **second** real write past timeout, release it, inspect persisted state and invoke another detection. Require a fresh probe/unknown, never reuse of expired-owner confirmation. Include replacement/newer observation and positive-evidence races.
- [ ] Extend the current regression around `EmailReplyAuditN01N09G02.integration.test.ts:671–702`: delaying only staging verifies one phase, not the confirmation boundary.

### N03 — In-memory negative cache restarts freshness at probe completion [P2]

- **Source:** `src/service/emailReceive/EmailReplyDetectionService.ts:445–465,625–629`.
- **Trigger:** a complete negative is observed, then closing reads/confirmation consume ten seconds while remaining within the 15-second probe budget. A later check occurs 65 seconds after the original observation.
- **Actual:** persisted timestamp/result `checkedAt` retain the original observation time, but the memory entry uses `observedAt: this.now()` at completion. The persisted-cache path expires correctly; the memory path sees only 55 seconds elapsed and returns the 65-second-old observation.
- **Controlled check:** actual cache insertion and actual memory-cache read returned **`not_replied`, `fromCache: true`** with observation age **65,000 ms** and insertion age **55,000 ms**, while actual persisted-cache read rejected it.
- [ ] Set negative memory expiry from a valid original `result.checkedAt`, not completion/insertion time. Validate that timestamp and avoid extending freshness when moving evidence between cache layers.
- [ ] Regression: delay successful closing work within the probe budget, then advance beyond observation + 60 seconds but before completion + 60 seconds. Require a new network probe. Cover exact TTL boundary and invalid/future timestamps.

### N04 — Final SMTP gate combines separately stale ownership and cluster snapshots [P1]

- **Source:** `src/service/emailReply/EmailReplyDeliveryService.ts:1128–1132,1154–1178,1190–1223,1240–1291`; SMTP follows the helper in `runClaimedSendToFinalization`.
- **Trigger:** final attempt lookup returns `submitted`; canonical cluster lookup returns clean. While the subsequent seed read is awaited, recovery changes the attempt to `delivery_unknown`, or a diagnostic persists sticky positive reply evidence on an equivalent sibling. The seed itself retains a fresh negative.
- **Actual:** the helper checks the earlier attempt/cluster snapshots and the later seed independently. Its fast path never rechecks attempt or sibling state. The optional delayed refresh likewise finishes by rereading only the seed, leaving earlier ownership/cluster observations stale. The original R01 six-second observation-age bug is improved, but the replacement sequence is not a coherent final admission decision.
- **Controlled check:** actual claimed-send method and actual final handoff helper, with state changes injected during the last seed read, reached SMTP once and returned `sent` while stored attempt state was `delivery_unknown` and the sibling had become positive. Ports represented the separate snapshots; this was not a real SMTP/database concurrency run and does not prove two submissions.
- **Impact:** current positive local evidence can be ignored before SMTP. Whole-operation tracking prevents certain reconciliation/retry races, but does not make these separately awaited reads coherent.
- [ ] Obtain attempt/guard ownership, canonical-cluster eligibility and the negative evidence together in a short Model transaction. After it returns, enforce observation age synchronously before transport. After any refresh, repeat the complete admission validation.
- [ ] Regression: hold the final seed read after clean ownership/cluster snapshots, then separately introduce sibling positive evidence or recovery state. Resume and assert zero SMTP, stable refusal code, safe known-unsent finalization and one owned skip event. Preserve tracker cleanup and the single-refresh allowance.

### N05 — Provider invalidation can be undone by an outstanding catalog fetch [P2]

- **Source:** `src/service/AIChatModelCatalogService.ts:57–74,113–118,133–151`; unkeyed production lookups in `src/service/emailReply/EmailReplyDraftGenerationService.ts:339,366`; settings invalidation at `src/main-process/communication/ai-provider-ipc.ts:88–92`.
- **Trigger:** provider A's models request is pending; settings switch to B and invalidate the cache; B's generation joins the outstanding request; A's response completes.
- **Actual:** invalidation clears cache/key but does not fence the old fetch. Its completion unconditionally reinstalls A's capabilities/default model. Production resolvers omit the optional config key, so they do not force B's refresh after joining the old work. Subsequent unkeyed lookups retain that stale catalog.
- **Controlled check:** actual catalog class with deferred A response, invalidation and a B lookup made **one** network-port call and returned A's **4,096** output cap even though B's port would report **128** for the same model ID.
- [ ] Version invalidations with an epoch/config snapshot, discard old-epoch responses, and refetch the current epoch after joining stale work. Supply actual provider/config identities in production; keep output/context capability provenance separate.
- [ ] Regression: deferred A response → settings change/invalidate → B lookup → A resolves with high cap. Require a B fetch and B's lower cap/default model. Include fetch failure and multiple rapid settings changes.

## Incomplete implementation and acceptance

### G01 — Actual model-context admission remains a heuristic [P2 / previous R05 partial]

- **Source:** `src/service/emailReply/EmailReplyContextBudget.ts:19–45,57–86`; correction preflight in `EmailReplyDraftGenerationService.ts:2707–2733`.
- **Current improvement:** comments now acknowledge undercounting, chat framing is counted, and correction has an explicit preflight. These are useful and should remain.
- **Remaining requirement:** ASCII/4 and non-ASCII/1.5 are still average ratios, not an actual supported-model token bound. Dense machine text/rare Unicode can exceed the real window despite those checks; a fixed 512-token margin cannot bound arbitrary underestimation. A 32,768-token unknown-model ceiling limits the application's request size, but does not prove an unknown smaller model can accept it.
- [ ] Use a suitable model tokenizer or a verified conservative bound for explicitly supported tokenizer families. Establish a verified configured context limit or an explicit unavailable/refusal path where limits are unknown.
- [ ] Test near-limit code/encoded ASCII, CJK and emoji against actual tokenizer counts, including output reservation, framing and correction additions. Ratio-based tests alone do not establish compliance with FR-027.
- [ ] Update completion claims accurately: documenting the heuristic limitation does not complete the requirement to respect actual model limits.

### G02 — Resolve the literal complete-invocation deadline contract

- **Source:** `GENERATION_INVOCATION_BUDGET_MS = 300000` and separate `TERMINAL_AUDIT_BUDGET_MS = 3000` in `EmailReplyGenerationBudget.ts`; terminal helper at `EmailReplyDraftGenerationService.ts:1175–1205`; intentionally unraced commit at `:2065–2070`.
- **Current improvement:** terminal audit now starts after work-budget exhaustion, and optional post-commit reporting is bounded while preserving committed-draft success. The old zero-audit and optional-audit hang findings should not be repeated.
- **Remaining contract issue:** FR-035 says the complete invocation has a five-minute deadline. A full work budget plus a separate terminal slice can exceed that, and waiting for commit admission/completion has no caller bound. The source explicitly explains the choice to preserve commit certainty; that is a tradeoff, not literal completion of the documented deadline.
- [ ] Reserve terminal work within the complete invocation budget and make queue admission deadline-aware while preserving truthful commit outcome, or explicitly approve/update the product contract for the bounded terminal allowance and persistence-outcome handling. Do not claim both incompatible guarantees.
- [ ] Add aggregate wall-time checks for work expiry plus terminal audit, and a held commit queue. A naive timeout wrapper must not manufacture failure while a detached commit can still succeed.

### T01 — Restore a truthful green normal backend run

- [ ] Capture the actual failure outcome in the intermittent B01 reuse test, then diagnose shared fixture/evidence/mock/timing state under normal file parallelism. The isolated 149/149 result does not erase the 700/701 normal-run failure.
- [ ] Retain the reuse-before-classification and zero-model-call assertions. Do not weaken them to accept arbitrary refusal results.
- [ ] Add the boundary regressions for N01–N05 and G01/G02, rerun the ordinary focused selection and record full results.

### T02 — Complete live provider and rollout acceptance

- [ ] Execute the real IMAP/Sent and hosted-AI pilots in [pilot plan](emailreply-pilot-and-rollout-plan.md): supported mailbox families, actual JSON hint supported/unsupported/ignored behavior, read-message flags and Sent coverage.
- [ ] Record first-pass/correction/fallback/truncation, unknown reasons, latency/cache/guard conflicts and availability against a real baseline; obtain release signoff. Keep private bodies, raw model output and credentials out of telemetry.
- [ ] Verify identity/Sent configuration cache invalidation and provider/model switching, including N05. Loopback success is controlled integration evidence, not real provider acceptance.

## Previous findings: current disposition

| Previous round-2 item | Current disposition |
|---|---|
| R01: freshness after final ownership read | Original delayed-age case fixed; final snapshots remain inconsistent (N04). |
| R02: expired write exposed before cleanup | Pending staging removes the original cleanup window; confirmation and send consumers remain N01/N02. Memory TTL is N03. |
| R03: no terminal refusal audit | Original defect fixed by dedicated terminal audit and new written-row regression. Aggregate deadline is G02. |
| R04: false provider context provenance | Missing/malformed fields now retain fallback provenance. Ordinary invalidation exists; outstanding-fetch race remains N05. |
| R05: average ratio as actual bound | Partial: framing/correction checks and honest documentation added; G01 remains. |
| R06: audit loses supplied-source flags | Fixed in reviewed source: flag survives serialization, DTO/UI distinguish supplied/retrieved, revision metadata records context fitting. |
| R07: no navigation/body before review | Fixed in reviewed source: audit-to-draft link, escaped full body, recipient and associated tests added. |
| R08: stale detail responses | Fixed in reviewed source: request generation/ID guards, clearing old content, and mismatched-submit protection. |
| R09: old caller timestamp allows queued late commit | Original queue-admission case fixed with advancing transaction clock and rollback-capable final fence. Keep persistence completion within the explicit G02 contract. |
| R10: optional post-commit audit hangs | Fixed: remaining-budget race, detached rejection observation, and truthful committed success retained. |
| T01: intermittent backend result | Different reuse test failed in this normal run and passed in file isolation. Still open; do not conflate tests across rounds. |
| T02: live acceptance | Still open. No live provider measurements/signoff were established by this audit. |

Suggested order: fix N04 before releasing the send path; close evidence validity/TTL N01–N03 and provider invalidation N05; finish G01/G02 and T01, then execute T02. Earlier reports remain historical; this file records the reviewed HEAD and current evidence.
