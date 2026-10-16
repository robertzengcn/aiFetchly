# Email reply validation and duplicate guard — October 17 re-audit TODO

## Verdict and reviewed revision

**The complete PRD cannot yet be accepted.** Two correctness defects remain: the final send verdict can ignore positive evidence already present in its returned snapshot, and negative confirmation still uses a pre-admission timestamp. Several earlier defects are fixed. Remaining acceptance also includes unknown model-capacity handling, reliable ordinary test execution, deadline-document consistency and real provider pilots.

- Worktree: `/Users/cengjianze/project/aiFetchly/.claude/worktrees/email-reply-validation-phase1`.
- Source HEAD: **`b7775049de128979899c194a61461f4c33a7f57e`**, branch `worktree-email-reply-validation-phase1`.
- Baseline: previous report commit `7d79b95a8`.
- Contract: [PRD](ai-email-reply-validation-and-duplicate-guard-prd.md), FR-025–FR-039, and [technical design](ai-email-reply-validation-and-duplicate-guard-technical-design.md).
- Date: October 17, 2026, Asia/Shanghai. Source references below identify this reviewed HEAD. No application fixes were made during the audit.

P1 blocks acceptance of the affected sending path. P2 requires correction before the affected requirement is complete. Findings below distinguish real SQLite execution, source evidence and unexecuted live-provider acceptance.

## Fresh checks

| Check | Result |
|---|---|
| Ordinary focused backend run, 44 files | **43 files passed, 1 failed; 719 tests passed, 1 failed, 720 total** |
| Complete generation file in targeted rerun | **152 tests passed** |
| Two temporary diagnostic cases against real SQLite | **Both reproduced the unsafe behavior**; these passing diagnostic assertions are evidence of defects, not safety regressions passing |
| Same 44 focused backend files with process-isolated settings | **44 files / 720 tests passed**, using an audit-only preload; repository configuration was unchanged |
| Focused utility suites, including model normalizer | **17 files / 241 tests passed** |
| Full component suite | **71 files / 465 tests passed** |
| Four focused Electron workflow specs | **14 tests passed**, including visible review, edit invalidation, loopback generation/reuse/SMTP and reconciliation |

The ordinary backend failure was `EmailReplyDraftGeneration.test.ts:1448`, **“discards generated content when replyStatus flips to sent during generation.”** The actual returned error was **“Reply work is temporarily disabled by the kill switch”**, rather than the expected `already_replied`. The file passed in the targeted rerun. The complete 44-file selection also passed after an audit-only Node preload assigned each process a unique `ELECTRON_USER_DATA_PATH`. This supports cross-worker settings interference as the cause; the precise offending write was not traced. The result does not establish a broken concurrent-sent predicate, and the environment workaround has not fixed the repository's normal configuration (T01).

The two database diagnostic cases used current model/module/service implementations and a temporary TypeORM load subscriber or an admission barrier to control timing. They performed no SMTP/network submission. Temporary test source was removed from the worktree after execution; its copy and logs remain under `/tmp/email-reply-audit-2026-10-17-`: `boundary-proof.test.ts`, `boundary-proof.log`, `main.log`, `main-isolated-settings.log`, `utility.log`, `components.log`, `e2e.log` and `settings-preload.cjs`. An initial diagnostic launch was stopped by a type error in the temporary test; it was corrected, and the complete successful rerun executed 154 tests: 152 existing generation tests plus the two diagnostic cases. No test gate was bypassed.

## Requirement coverage

| Requirement | Assessment at this revision | Remaining work |
|---|---|---|
| FR-025 — schema and correction | Implemented in reviewed scope | Shared schema/enums, bounded correction and local checks retained. |
| FR-026 — provider JSON compatibility | Controlled implementation covered | Real hosted/provider compatibility acceptance T03. |
| FR-027 — actual model limits and truncation | Partial | Byte bound and configured-limit propagation fixed; unknown capacity still assumes 32K (G01). |
| FR-028 — guarded generation/reuse | Core implementation present | Expired negative confirmation C02 and normal test reliability T01 affect acceptance. |
| FR-029 — shared local enforcement | Partial | Final verdict skips newer positive seed evidence (C01). |
| FR-030 — flags and targeted metadata | Implemented in reviewed scope | Preserve sticky positives and lifecycle isolation while fixing C01 coordination. |
| FR-031 — fresh automatic evidence | Partial | C01 can ignore known positive; C02 can publish expired-owner negative confirmation. |
| FR-032 — detector and diagnostic tool | Partial | Conditional confirmation still uses stale caller time (C02). |
| FR-033 — typed results/guidance | Implemented in reviewed scope | Existing structured outcomes and revision-aware review guidance retained. |
| FR-034 — audit, languages and UI | Implementation and current UI checks covered | Normal backend reliability T01 and live acceptance T03 remain. |
| FR-035 — reservation, atomic creation, deadline | Code substantially improved; contract alignment pending | Terminal budget reserved and commit admission fenced. PRD versus documented commit-to-certainty exception needs T02. |
| FR-036 — atomic send/recovery | Partial | Current snapshot evaluator still misses authoritative positive evidence (C01). |
| FR-037 — safe caching | Partial | Pending-marker and memory TTL fixes present; confirmation-time validity remains C02. |
| FR-038 — upgrade/legacy/readiness | Implemented in reviewed scope | No new upgrade defect established; isolate validation/kill-switch fixtures under T01. |
| FR-039 — bounds and rollout | Partial | G01, T01/T02 and actual provider measurements/signoff T03. |

“Implemented in reviewed scope” is bounded by source inspection and these checks, not a guarantee that every possible bug has been excluded. Passing loopback/component tests does not complete the PRD's live release gates.

## Confirmed defects

### C01 — Final send verdict ignores a newer positive copy of the seed [P1]

- **Source:** snapshot read at `src/model/EmailReplyDraft.model.ts:950–969`; positive evidence UPDATE at `src/model/EmailReceivedMessage.model.ts:238–255`; verdict at `src/service/emailReply/EmailReplyDeliveryService.ts:1157–1193`; SMTP follows the fence at `:818–842`.
- **Trigger:** final admission loads a seed with a recent negative. A normal diagnostic evidence writer records a sticky positive before the canonical cluster is read. That later query returns a newer, positive copy of the same seed.
- **Actual:** the snapshot transaction uses `replyWriteMutex`, but the normal received-message evidence UPDATE does not. Both use the same SQLite connection, so that plain UPDATE can run during an awaited transaction callback. The returned snapshot can contain the old negative `seedMessage` and a positive seed inside `clusterRows`. The evaluator tests the old seed, then explicitly skips the newer cluster row with `if (row.id === seed.id) continue`, and returns `admit` from the old negative.
- **Real SQLite reproduction:** an async TypeORM load subscriber scheduled the actual `EmailReceivedMessageModel.updateReplyEvidence` after the seed materialized. Actual `readFinalSendAdmission` returned an old non-positive seed and a cluster containing the positive seed; the stored row was positive after the transaction. Actual `evaluateFinalAdmission` nevertheless returned **`admit`**. No SMTP was invoked by this diagnostic.
- **Impact:** positive local reply evidence already present at the decision is ignored, permitting the send path to proceed despite FR-029/031. The transaction fixes interleaving with other serialized draft/guard transactions; it does not automatically serialize every repository writer sharing that connection.
- [ ] Inspect positive evidence on **every** returned cluster row, including the seed. Do not discard a more recent positive merely because its ID matches the earlier seed snapshot.
- [ ] Coordinate all eligibility/evidence mutations with the snapshot's consistency mechanism, or construct the complete admission view through a truly atomic read. Audit normal sync/provider-metadata writers as well as diagnostic evidence writes.
- [ ] Add a permanent real-SQL regression for the demonstrated interleave. If positive evidence lands before admission completes, require `already_replied`, zero SMTP, safe known-unsent finalization and one owned skip event. Include canonical seed and legacy/sibling paths and avoid reentrant-lock deadlocks in the test scheduler.

### C02 — Conditional negative confirmation checks a timestamp captured before database admission [P2]

- **Source:** caller timestamp at `src/service/emailReceive/EmailReplyDetectionService.ts:1518–1523`; module await at `src/modules/EmailReceivedMessageModule.ts:196–198`; model clock/predicate at `src/model/EmailReceivedMessage.model.ts:180–203`; model connection guard at `src/model/Basedb.ts:60–62`.
- **Trigger:** the detector captures `now` while its probe is still live, then confirmation waits for module/model connection admission or another async delay until after owner expiry.
- **Actual:** the production module forwards the same input unchanged. The model uses `input.now` for `replyNegativeOwnerExpiresAt >= :now`, so the SQL condition compares against the earlier live timestamp and can confirm an already expired probe. Matching the exact pending observation/owner is an improvement, but does not make a pre-admission Date the execution clock.
- **Real SQLite reproduction:** stage an actual pending row with a 100 ms owner lifetime, call the actual module with a captured live Date, hold its connection-admission await for 150 ms, then resume without rewriting the input. The actual model returned **true** and persisted the real matchable context hash after expiry. This is not an unfenced mock port: the UPDATE and stored row were real SQLite.
- **Regression blind spot:** `EmailReplyAuditN01N09G02.integration.test.ts:1005–1012` replaces `input.now` with a fresh value **after** its test barrier. That differs from production forwarding and makes the regression pass while the original stale-Date route remains.
- [ ] Resolve an advancing clock after actual database admission, or use execution-time database clock semantics in the conditional UPDATE. For deterministic tests, pass a clock function rather than a frozen pre-queue Date.
- [ ] Preserve the exact staged timestamp/owner, pending marker, monotonic observation and sticky-positive predicates.
- [ ] Replace/extend the regression to delay actual module/model admission while preserving the detector's original input. Require zero affected rows, an unusable pending row, and a subsequent detection that probes again rather than reusing expired confirmation. Include replacement-owner/newer-positive races.

## Remaining implementation and acceptance tasks

### G01 — Unknown model capacity still authorizes an assumed 32,768-token window [P2]

- **Fixed:** UTF-8 byte length replaces the old average-ratio estimator for the stated supported tokenizer assumptions. Dense text/Unicode no longer have that particular undercount. An operator's configured default-model limit now reaches the normalizer/catalog, with provenance retained.
- **Remaining production route:** `contextSize` is optional (`src/entityTypes/aiProviderTypes.ts:58,79`); the provider's models response or synthetic fallback can omit a window (`OpenAICompatibleProviderClient.ts:171–186`). The resolver then correctly reports unknown, but `EmailReplyDraftGenerationService.ts:2537–2540` substitutes `FALLBACK_CONTEXT_WINDOW_TOKENS = 32768` and continues.
- **Gap:** an accurate byte bound cannot establish the capacity of a model whose actual context window is unknown. A smaller model without reported/configured metadata can still receive a request admitted against 32K. This is an unclosed requirement boundary, not an observed live-provider rejection in this audit.
- [ ] Require a verified reported/configured context limit before generation when capacity is unknown, or make a clearly bounded fallback policy an explicit product requirement with its limitation. Do not label an application ceiling as proof of actual model capacity.
- [ ] Test the real client → normalizer → catalog → generation chain with missing window/configuration, synthetic model discovery, an explicit small window and a configured override. Preserve the byte bound, framing allowance, output reservation and correction preflight.

### T01 — Isolate settings and restore the ordinary green backend run

- [ ] Fix the unexpected kill-switch refusal in the normal 44-file run. Preserve the concurrent-sent/no-draft assertions; do not make the test accept any refusal.
- [ ] Isolate Token/electron-store settings per test worker before imports, in addition to database TMPDIR. `isolatedTmpDir.ts` currently isolates SQLite fallback paths; `ElectronStoreService` instead chooses `ELECTRON_USER_DATA_PATH`, Electron userData or project-name settings storage. Upgrade-validation tests intentionally write/clear the kill switch, so database isolation alone does not establish settings isolation.
- [ ] Capture the actual admission error/correlation and active flag owner when diagnosing parallel failures. A full generation-file pass does not erase the ordinary run's failure.
- [ ] Make the temporary database proofs into permanent regressions that assert safe behavior after C01/C02 are fixed, and rerun the normal configured suite without an audit-only environment workaround.

### T02 — Align the PRD deadline with the documented commit-to-certainty exception

- **Fixed:** work stages now reserve their terminal slice inside the total budget, and commit admission/final fencing use an advancing invocation deadline. Do not repeat the old terminal-budget stacking, optional-audit hang or stale pre-queue commit timestamp findings.
- **Documentation mismatch:** PRD FR-035 still promises a five-minute deadline for the **complete invocation**. Technical design `:438–448` now explicitly allows an admitted atomic commit to finish to certainty beyond that wall. The addendum also says “never a past-deadline success” before describing completion beyond the wall, which needs precise wording.
- [ ] Make PRD, technical design, acceptance tests and completion claims consistent about deadline-gated admission versus an absolute return-time guarantee. Retain truthful commit outcomes and owner fencing; do not wrap an irreversible commit in a naive timeout that can report failure before a later success.
- [ ] Record which post-admission exception is accepted and how it is measured. This report treats it as a documented design tradeoff requiring contract alignment, not recurrence of the previous optional-write bug.

### T03 — Execute real provider and rollout acceptance

- [ ] Complete the real hosted-AI and IMAP/Sent pilots in [pilot plan](emailreply-pilot-and-rollout-plan.md), including actual JSON supported/unsupported/ignored behavior and the supported mailbox families.
- [ ] Record first-pass validation, correction/fallback/truncation rates, unknown reasons, detection latency/cache/guard conflicts, availability baseline and release signoff. Do not log private bodies, raw model output or credentials.
- [ ] Verify negative-cache identity/Sent configuration changes and provider/model setting transitions in actual supported configurations. Controlled loopback evidence is not a live provider baseline.

## Disposition of October 16 round 3

| Previous item | Current evidence |
|---|---|
| N01 — pending marker omitted by send readers | **Fixed:** context is mandatory and all readers pass it. |
| N02 — late second confirmation | **Partially fixed:** exact staged conditional UPDATE added; stale pre-admission Date remains C02. |
| N03 — memory TTL starts at completion | **Fixed:** memory expiry uses the original checked-at observation. |
| N04 — independently stale final snapshots | **Partially fixed:** shared Model snapshot replaces independent service reads; received-message writes can still interleave, and newer positive seed evidence is skipped (C01). |
| N05 — outstanding fetch reinstalls old catalog | **Fixed for the reported race:** epoch fencing and production config keys/versioning added. |
| G01 — actual token/context bound | Byte-counting and configured-limit chain fixed; unknown-capacity admission remains G01 above. |
| G02 — terminal slice/commit deadline | Implementation improved; explicit commit-to-certainty residual now documented. Align the remaining PRD contract under T02. |
| T01 — intermittent backend failure | Current normal-run failure identifies unexpected kill-switch state; settings-isolation comparison is recorded in final verification. |
| T02 — live acceptance | Still open as current T03; no live pilot results were fabricated. |

Suggested order: fix C01 before releasing guarded sending, close C02 with a production-faithful regression, resolve G01 and ordinary settings/test isolation, align deadline documentation, then complete live acceptance. Earlier TODOs remain historical records; this file reports current evidence only.
