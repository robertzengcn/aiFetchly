# Workspace capability parity — R9 audit and remaining TODOs

Date: 2026-10-24. Audited implementation: `44d88793c7c362cf3262f691a6b0cff4eb0a1e4e`, branch `workspace-v2-capability-parity`, worktree `/home/robertzeng/project/aiFetchly/.worktrees/workspace-parity`.

**Verdict: not all requirements are complete, and reproducible errors remain.** Most capability families have reachable workspace implementations. This audit identifies seven implementation defects, two differences from the supplied requirements, failing validation gates, and unfinished acceptance/release evidence. Passing typechecks and five selected Electron journeys do not establish the PRD's Definition of Done.

This is an audit, not a fix round. No application code was changed. Existing untracked R8 and 2026-10-20 audit files were preserved. Earlier findings are not automatically reopened: R7 selection-buffer, overflow, reload-pointer and durable-sidebar repairs are present; R8 repairs were checked against current code and new findings below describe remaining failures.

---

## Remediation status (2026-10-24 fix session, branch `workspace-v2-capability-parity`)

Every §3 confirmed defect is fixed with its named regressions, and the §5 test-infrastructure/acceptance items T01–T03 are closed. Commits, oldest first:

| Audit item | Commit |
| --- | --- |
| B05 preload invoke allowlist | `fb04b39cd` |
| B06 context-window sentinel translations (×6) | `d8035b157` |
| B01/B02 skill-install ordered state owner + retryable status error | `14e444228` |
| B01/B02 i18n completion (×6) | `aee767f20` |
| B07 stale denial no-op bound to a fresh claim | `a447f14f2` |
| B03/B04 report markers + mode parity | `8a41a083d` |
| T01 partial-mock usersetting constants (5 suites collect) | `09dafacee` |
| T02 controlled remote-linked fixture + legitimate credential gate | `5557308f6` |
| T04 stdio EPIPE uncaught-exception fix | `bc36fb6d2` |
| T03 rejected-send retention on both surfaces + AC 11/12 plan journeys | `c851883b6` |
| T04 gate stabilization — shared-DB Token-mock isolation + B22 timeout budgets | `c577219cf` |
| T04 gate fix — delivery-unknown reopen entry on the outbound receipt (FR-OUT-007/009) | `be644a2c1` |

**C01/C02 dispositions** are recorded inline above — both stay owner decisions, neither is marked implemented against the supplied wording, and B07 is fixed under either contract.

**T04 final gate CLOSED:** both typechecks, the component suite (169 files / 1,441 tests, zero unhandled errors), two consecutive full default-concurrency main runs (8,672/12 each), and a fully green full-Electron run (188 passed / 2 documented live/platform-gate skips, 28.0m) on the final revision — exact commands, counts, skips, and the flake inventory are in the T04 evidence block below.

**Not agent-completable (unchanged):** V01 (real speech runtime/devices), V02 (assistive-tech/platform review), V03 (authenticated managed-browser lifecycle + full security review), V04 (14-day soak + sign-off). These are release certification artifacts requiring physical devices, assistive technology, authenticated external accounts, and human sign-off — not code or test work this environment can produce.

---

## 1. Requirement baseline and evidence rules

The user explicitly supplied these **main-checkout** documents; these are the comparison baseline:

- `/home/robertzeng/project/aiFetchly/docs/prd/ai-chat-workspace-v2-capability-parity-prd.md` — SHA-256 `4bfb4cb9a6d4b37900426f728e3cec5ba294b0dc803d7f2ea7e3c1db468a2396`.
- `/home/robertzeng/project/aiFetchly/docs/prd/ai-chat-workspace-v2-capability-parity-technical-design.md` — SHA-256 `245ce1f393daf67563fe95d05c85ea351f6ecde2b7f5fc0e3327e158791f2409`.

The worktree copies contain additional extraction-deferral paragraphs and a changed FR-PER-006. The supplied copies do not. C01/C02 below record this discrepancy rather than silently applying the worktree exceptions or treating previously recorded owner decisions as newly approved here.

Evidence levels:

- **Reproduced:** a current test or focused executable probe demonstrated the failure.
- **Source-confirmed:** the current implementation directly establishes the behavior; this is not a complete end-to-end certification.
- **Verification outstanding:** implementation or test scaffolding exists, but the required final-revision journey, platform evidence, review, or soak is not supplied by this audit. This is not an assertion that the feature is absent.

Source line numbers below refer to the audited revision. Paths are relative to this worktree unless absolute.

## 2. Fresh validation results

| Check | Result | Interpretation |
| --- | --- | --- |
| `yarn typecheck` | Passed, exit 0 | TypeScript gate passes. |
| `yarn vue-typecheck` | Passed, exit 0 | Vue/TypeScript gate passes. |
| `yarn test:components` | ~~**Failed**, exit 1: 168 files / 1,429 assertions passed, **7 unhandled rejections**~~ **Green on the final revision: 169 files / 1,441 tests passed, exit 0, zero unhandled errors (B01 fixed).** | ~~B01; passing assertions do not make the command green.~~ Fixed. |
| `yarn testmain` | ~~**Failed**: 21 files failed, 777 passed, 2 skipped; 23 tests failed, 8,595 passed, 13 skipped; 1 unhandled EPIPE~~ **GREEN on the final revision — two consecutive full default-concurrency runs, exit 0, 798/2 skipped files, 8,672/12 skipped tests each (see the T04 evidence block).** | Timeout attribution stays per-run. |
| Failed main files rerun with `yarn testmain run --maxWorkers=2 <21 failed files>` | **Failed**: 8 files failed, 13 passed; 8 tests failed, 213 passed, 1 skipped | Reproduces B05, B06, T01 and T02. The original timeout failures did not reproduce in this rerun; the EPIPE-producing suite was not part of this failed-file set. |
| Focused component probes | Three expected-behavior assertions fail | B02, B03 and B04 reproduced using existing mount fixtures. |
| Isolated production deny-handler control-flow probe | Stale validation fails, but cancellation is still called once and handler returns success | B07. Real handler body, stubbed owner router; not an Electron race reproduction. |
| `xvfb-run -a yarn test:e2e test/e2e/specs/workspaceParityAcJourneys.test.ts` | **5 passed**, 0 skipped, approximately 1.3 minutes after rebuild | Command routing, ambiguity/cancel, AI-disabled reporting, inactive-conversation summary, and rollback happy path. See T03: the test labelled AC 36 does not test the actual AC 36. |
| Full Electron suite, full module suite, physical speech/browser/platform certification | Not rerun in this audit | V01–V04 remain required. |

Local execution logs are `/tmp/workspace-parity-audit-r9-{typecheck,vue-typecheck,components,main,main-recheck,probes,deny-probe,e2e}.log`. These are session-local evidence, not durable release artifacts. The failed-file list is `/tmp/workspace-parity-audit-r9-failed-files.txt`.

Probe hygiene: temporary component files were removed from the repository after use; copies remain at `/tmp/R9AuditProbes.temp.test.ts` and `/tmp/R9SkillProbes.temp.test.ts`. An initial probe-only invalid `nextAction: "none"` value was corrected before the final probe run; the full main runner's live typechecker briefly observed it. That transient diagnostic is **not** an application defect. Both standalone typechecks passed, and the clean failed-file rerun reported zero type errors.

## 3. Confirmed implementation defects

### B01 — P1: installation refresh failures escape as unhandled promises

- [x] Handle rejected installation-status reads, render a localized retryable error, and keep historical approval controls safe while status is unknown.
- **Requirements:** FR-SKL-003/004, FR-REC-004, PRD §18 failure behavior, §28.5 component gate.
- **Evidence:** `src/views/components/aiChatV2/SkillInstallCard.vue:485–516` calls `void refreshSnapshot()` on mount and progress events. `refreshSnapshot()` awaits `getSkillInstallStatus()` without a catch. `src/views/api/skillInstallation.ts:105–109` delegates to `windowInvoke`, which throws on an unavailable/error response.
- **Reproduction:** mount a historical install card and reject its status IPC. The actual component run produces seven `Error: unknow error` rejections from `SkillInstallCard.vue:513`, originating in `AiChatWorkspaceTranscript.test.ts` and `SkillInstallCard.states.test.ts`. The tests' incomplete IPC mocks trigger the error; the production rejection path is also unhandled.
- **Impact:** refresh fails without a controlled recovery state; the stale card can remain visible. The required component command exits 1.
- **Closure:** add explicit status-rejection and retry tests, update successful-read mocks in affected suites, and require `yarn test:components` to exit 0 with zero unhandled errors. Do not suppress unhandled-error reporting to make the gate green.

### B02 — P1: refreshed installation state permanently shadows later action results

- [x] Reconcile authoritative action responses, parent snapshots and progress refreshes through one ordered state owner; discard obsolete refresh replies.
- **Requirements:** FR-SKL-002/003/004, AC 29; design §12.9.
- **Evidence:** `SkillInstallCard.vue:475–478` computes `localSnapshot ?? props.snapshot`. The initial successful refresh sets `localSnapshot`. Approve/dependency/secret/cancel/retry handlers emit `updated` but generally do not replace this local override. `src/views/components/aiChatV2/AiChatV2Message.vue:110–115` handles `updated` by updating the parent snapshot, which the card now ignores. Progress events received while `busy` are also dropped (`SkillInstallCard.vue:486–493`).
- **Reproduction:** return `awaiting_approval` from the mount refresh; then update the card's `snapshot` prop to `cancelled`, exactly as the parent action handler does. The review panel remains rendered. Focused assertion: expected `skill-install-review` to disappear; received `true`.
- **Impact:** a successful cancellation/approval/credential transition can leave stale review or input controls until another accepted progress event or remount. This does **not** establish an authorization bypass; main-process validation still applies.
- **Closure:** regress approve, decline, dependency approval, secret submission, cancel and retry after a non-null initial refresh. Include progress arriving while busy, out-of-order refresh responses, and a new session ID. The displayed state must match the latest authoritative result.

### B03 — P2: successful plan-continuation retry leaves the selector in Plan mode

- [x] Apply the same mode transition on successful recovered/retried continuation as on initial plan approval.
- **Requirements:** FR-PLN-006, journey §17.3 step 5; design §12.1.
- **Evidence:** `AiChatCenterSurface.vue:3437–3447` sets `mode.value = "chat"` after initial continuation acceptance. `onRetryPlanContinuation()` at `3473–3540` clears the recovery intent on success but never resets mode.
- **Reproduction:** recover an approved plan intent, select Plan mode, click the continuation retry button, and accept `sendMessage`. The request correctly uses `mode: "chat"`, but the selector remains `plan`. Focused assertion: expected `chat`, received `plan`.
- **Impact:** the next manual message unexpectedly runs in plan mode despite successful approved-plan execution.
- **Closure:** assert both continuation payload mode and visible selector mode after retry/recovery acceptance; rejected retries and replies after selection changes must not mutate another conversation's controls.

### B04 — P2: conversation-report success never marks selected outputs as reported

- [x] Merge successful conversation-report message IDs into session report state and preserve that state across center remounts.
- **Requirements:** FR-RPT-009; design AD-005 and §12.5.
- **Evidence:** `AiChatCenterSurface.vue:1256–1263` discards the success payload with `void payload`. Only the single-output handler adds to `reportedMessageIds` (`1630–1645`). The rollback surface already merges `payload.selectedMessageIds` in `AiChatV2.vue:6557–6568`. The workspace set is a component-local ref, although AD-005 requires report state to survive component remounts within the session.
- **Reproduction:** open the conversation-report dialog and emit successful submission with `selectedMessageIds: ["output-r9"]`. The transcript's `reportedMessageIds` does not contain the output. Focused assertion: expected `true`, received `false`.
- **Impact:** successfully reported outputs continue to look unreported, encouraging repeat reports. Single-output markers also reset on center remount; this second issue is source-confirmed, not separately runtime-probed here.
- **Closure:** retain the open success dialog/reference, mark every successfully selected output, and verify selection changes and route remounts preserve session markers without transferring results to unrelated messages.

### B05 — P2: renderer action telemetry cannot cross preload

- [x] Import and allowlist `AI_CHAT_WORKSPACE_ACTION_COUNT` in the production preload invoke list; verify the complete renderer → preload → handler → counter path.
- **Requirements:** PRD §20; design §18.1 and AD-009 evidence collection.
- **Evidence:** the channel exists at `src/config/channellist.ts:565`, its renderer client is `src/views/api/aiChatWorkspaceActions.ts`, and its registered handler is `src/main-process/communication/aiChatWorkspaceActionCountIpc.ts`. It has **no entry in `src/preload.ts`**. Unknown invoke channels return undefined at `preload.ts:1562–1565`; the client catches and discards the resulting error.
- **Reproduction:** `test/vitest/main/preloadInvokeChannelParity.test.ts` fails in both full and reduced-concurrency runs, naming exactly this missing channel.
- **Impact:** renderer-originated report-open, image chooser/batch, voice and fallback action counts silently disappear. Main-originated counters are not all broken; this finding concerns the renderer bridge.
- **Closure:** make the parity test pass and exercise an actual preload-backed action with a counter delta assertion. A mocked handler unit test alone cannot detect this defect.

### B06 — P2: context-window error key is missing in every supported locale

- [x] Add accurate translations for `aiChatV2.context_window_exceeded` in all six language files, or consistently reuse an existing equivalent key.
- **Requirements:** FR-REC-004, PRD §16, AC 25, rollback compatibility.
- **Evidence:** `src/views/components/aiChatV2/AiChatV2.vue:3968–3973` requests the key when the error is `CONTEXT_WINDOW_EXCEEDED`; no corresponding key exists in `src/views/lang/{en,zh,es,fr,de,ja}.ts`.
- **Reproduction:** `test/vitest/main/i18n/touchedCapabilities.i18nRuntime.test.ts` fails for all six locales in both runs: `1 of 528 static keys missing: aiChatV2.context_window_exceeded`.
- **Impact:** the rollback surface can display the raw translation key. `t(key) || English` does not help when vue-i18n returns the nonempty missing-key string. Equal key trees alone cannot detect a key absent from every locale.
- **Closure:** all six runtime cases pass and the sentinel renders actionable localized recovery copy in the rollback surface.

### B07 — P1: stale permission denial can cancel a different active turn

- [x] Reject obsolete permission decisions without cancelling the currently owned run; bind denial to the exact run/tool claim before any mutation.
- **Requirements:** FR-PER-005/007, FR-LIF-002, design §12.2 continuation identity. This defect remains even if C02's deny-equals-stop policy is accepted.
- **Evidence:** `src/main-process/communication/ai-chat-v2-ipc.ts:1533–1554` calls `resumeRun` to validate `toolId`, but calls `cancelOwnedRun(conversationId)` even when validation returns `ok: false`. `AIChatCoordinator.ts:405–422` owns/cancels by conversation, not the stale tool identity.
- **Reproduction:** let the owner router report a live run for a conversation, reject an old permission ID with `ok:false`, and call `handleDenyToolPermission` with that ID. A probe executing the transpiled production handler body records **one cancellation** and `{status:true,data:{ok:true,handled:true}}`. Expected cancellation count: zero. A delayed old-card action after a new turn begins is the user-facing scenario.
- **Impact:** a rejected/stale decision can stop valid current work in the same conversation. No cross-conversation execution or privilege escalation is claimed.
- **Closure:** add a real-handler regression for mismatched tool IDs, old run IDs, duplicate denial after a subsequent turn, and denied validation while another action is pending. Stale decisions must be no-ops with recoverable feedback; valid decisions retain the explicitly chosen policy.

## 4. Differences from the supplied requirements

### C01 — Shared orchestration extraction remains incomplete against the linked baseline

- [x] Complete shared submission/image/plan orchestration extraction, or reconcile the supplied PRD/design with the already-recorded worktree deferral and its scope before claiming compliance. **Disposition (2026-10-24):** the extraction remains DEFERRED under the worktree PRD §10.5/§11.2 owner exception (until V03 and a separate cleanup decision); this audit does not reopen the extraction and does not claim the supplied wording as implemented. The behavior drift B03/B04 is fixed and locked with regressions on both surfaces; the discrepancy between the supplied main-checkout copies and the worktree copies stays recorded in §1.

### C02 — Interactive denial stops the turn instead of returning a denied tool result

- [x] Resolve the behavior discrepancy with the supplied FR-PER-006 and align implementation with one authoritative contract. **Disposition (2026-10-24):** this branch implements the WORKTREE contract (interactive deny-equals-stop, the owner decision recorded on 2026-10-18); the supplied main-checkout copy does not contain that exception and is NOT marked implemented. Independently of the policy question, R9 B07 (a stale denial cancelling a different live run) is fixed at the handler with real-handler regressions, which is required under EITHER contract.

## 5. Test and acceptance work still incomplete

### T01 — Five main suites cannot load because their settings mocks are stale

- [x] Repair the settings mocks/transitive test isolation and run the suites' actual assertions. **Done: `09dafacee` — all five formerly uncollected suites execute and pass (51 tests).**
- **Reproduction:** both main runs fail collection with `No "AI_CHAT_MESSAGE_QUEUE_ENABLED" export is defined on the "@/config/usersetting" mock`, reached through `AIChatWorkspaceRollout.ts:47` and the IPC/login import chain.
- **Affected files:** `test/vitest/main/AIChatQueryLoopCancellation.test.ts`, `AIChatQueryLoopOutboundEmailGate.test.ts`, `ConversationHistoryTools.test.ts`, `service/AIChatQueryLoopAsyncPermission.test.ts`, `service/AIChatQueryLoopOperationGuard.test.ts`.
- **Impact:** cancellation, outbound safety, history, permission and operation-guard suites supply no current assertion evidence when import fails. This is a test-infrastructure defect, not proof that all those product behaviors are broken.
- **Closure:** preserve realistic setting exports (for example partial mocks) and verify every formerly uncollected suite executes and passes.

### T02 — Skill lifecycle fixture stops at credentials and never tests its intended invariant

- [x] Make the remote linked-install fixture deterministic and advance it through the legitimate credential gate before checking activation refusal.
- **Evidence:** `test/vitest/main/SkillInstallationLifecycle.test.ts:691–719`, case `linked mode with a REMOTE source never links staging`, fails in both runs: expected `failed`, received `awaiting_secret`. It calls `resumeAfterSecret()` without supplying required credentials; the module checks required credentials at `SkillInstallationModule.ts:1190–1204` and correctly keeps the hold.
- **Impact:** the test does not reach its asserted `LINK_CREATION_FAILED` invariant. It also uses a live GitHub source, so network and upstream changes affect the branch exercised. This audit does not establish an unsafe linked activation.
- **Closure:** use a controlled source/credential fixture, retain the credential gate, and assert both no premature activation and the intended remote-linked refusal. Do not weaken the secret gate to satisfy the test.

### T03 — AC 11/12 and the actual AC 36 still lack the claimed Electron proof

- [x] Add default-route plan approval failure/success journeys with provider continuation counts and durable pending/run identity assertions (AC 11/12). **Done: the AC 11/12 journeys in `workspaceParityAcJourneys.test.ts` — EnterPlanMode+SubmitPlanForApproval chains on the fake provider; approve dispatches exactly one continuation (count pinned), a stale currentVersion bumps via the sqlite3 CLI and never dispatches (count unchanged, decision error surfaced).**
- [x] Add rejected-validation draft-retention journeys on **both** chat surfaces covering text, attachments, pasted bodies, image references and selected history (AC 36). **Done: the workspace leg retains text+attachment+paste chip+image tray+history chip on an oversized refusal; the legacy-dock leg (after real SET_FLAG rollback) retains the draft past the 32_000 bound; the successful rollback journey is renamed to its accurate §23.2 name.**
- **Evidence:** the R8 addendum explicitly leaves plan continuation counting open; current `aiChatPlanPermissionReload.test.ts` covers question/permission continuation, not the full approved-plan document journey. `workspaceParityAcJourneys.test.ts:392–460` is named “AC 36” but sends two **successful ordinary text turns** around rollback. It never rejects validation or checks the required draft fields. Its fresh pass is useful rollback evidence, not AC 36 completion.
- **Closure:** extend the fake provider with deterministic plan-document responses, assert zero execution after null/stale/failed decisions and exactly one continuation after retries, and pin the real rejected-send behavior across both surfaces. Keep the successful rollback journey with an accurate name.

### T04 — Final regression gate is still red; preserve a truthful failure inventory

- [x] After fixes, rerun both typechecks, all components, affected main/module tests and the full Electron suite on the same final revision; archive exact commands, counts and skips. **Done on the final revision (see the evidence block below): both typechecks, the component suite, two consecutive full default-concurrency main runs, and a fully green full-Electron run. Two gate-stabilization fixes landed first (shared-DB Token-mock isolation `c577219cf`, delivery-unknown reopen entry `be644a2c1`); every flake each run produced was individually re-verified in isolation.**
- [x] Investigate the unhandled EPIPE in `SupervisedStdioTransport.test.ts` and recurring timeouts under the documented CI configuration. **EPIPE root-caused (stdin/stdout stream 'error' with no listener) and fixed — routed through the transport's error surface; 8/8 consecutive focused runs clean. The broad-gate timeouts did not reproduce at two workers (per this audit's own rerun) — the T04 final gate below re-archived counts on the final revision.**
- **Evidence:** the broad run's additional timeout failures did not repeat with two workers; 13 of its 21 failed files passed the rerun. `SupervisedStdioTransport.test.ts` emitted the unhandled EPIPE but was not among those failed files, so its error still needs a dedicated investigation. Persistent failures are separately listed above. No claim of a newly introduced portable-memory/privacy defect is supported by the timeout alone.
- **Closure:** all required commands exit 0 without unhandled errors; skipped tests are justified explicitly. Earlier R7/R8 green logs are not certification for this later revision.

### T04 final gate — evidence block (2026-10-24, revision `be644a2c1`)

Exact commands and results on the final revision (`be644a2c1`, on top of the R9 remediation commits through `f567f5c66`):

| Command | Result |
| --- | --- |
| `yarn typecheck` | exit 0 |
| `yarn vue-typecheck` | exit 0 |
| `yarn test:components` | exit 0 — 169 files / 1,441 tests passed, zero unhandled errors (B01's gate contract) |
| `yarn testmain run` (full, default concurrency) — run 1 | exit 0 — 798 passed / 2 skipped files; 8,672 passed / 12 skipped tests |
| `yarn testmain run` (full, default concurrency) — run 2 | exit 0 — identical counts (two consecutive green full runs; "one retry is not proof" answered with two) |
| `yarn test:e2e` (full Electron suite, `workers: 1`, xvfb) | exit 0 — 188 passed / 2 skipped (28.0m) |

Skips, justified explicitly:

- Main suite (12 tests in 2 files): `AIChatArchivePerf100k.test.ts` — deliberate `AIFETCHLY_PERF_100K=1` perf gate; `USonarYellowPageAdapter.test.ts` — 2 quarantined WS-2 selector tests with a documented PRD reference in-file.
- E2E suite (2): the standing documented live/platform gates — e.g. the live-provider case inside workspace-shell (owns `AIFETCHLY_E2E_LIVE_AI`), the tray-host gate, and `managedBrowser.test.ts` (skips unless `AIFETCHLY_MB_E2E=1` on a machine with a display — the V03 evidence item).

Gate-stabilization fixes landed during this closure (test-only except where noted):

- `c577219cf` — the blanket Token mock (`getValue → "true"`) fed `USERSDBPATH` too, so eleven DB-touching suites all opened the same cwd-relative `./true/scraper.db`; under full-suite parallel load concurrent workers hit `SqliteError: database is locked` during `DataSource.initialize`/`synchronize`, which surfaced two ways: 5s timeouts in import-heavy tests (`SqliteDb.ensureInitialized.test.ts`, `SearchModule.test.ts` — fixed with the repo's existing B22 30s-budget convention) and, in `AIChatQueryLoop.imageArtifacts.test.ts`, a turn failing between rounds so the image handoff never reached round 2 (`expected '[]' to contain '[AIFETCHLY_IMAGE_HANDOFF_V1]'`). Reproduced deterministically by holding an exclusive lock on the shared DB (RED), fixed by making the mocked Token key-aware (`user_ai_enabled` → "true", `user_dbpath` → "" so the per-worker isolated TMPDIR fallback applies) across all eleven files; lock-probe GREEN with the lock held; `rm -rf true` recreation sweep clean afterwards.
- `be644a2c1` — FR-OUT-009's Electron journey ("receipt stays after dialog close and reopening shows delivery progress") had been green only because of the R8 P1-6 frozen-draft defect it predates; P1-6's terminal-refresh fix hid the Review entry for `delivery_unknown` (already in the terminal set pre-P1-6) and the journey — never rerun since — went red deterministically. Ruling: delivery_unknown is inconclusive, not settled (design table lists the "email dialog reopen" journey; FR-OUT-007 renders progress for delivery-unknown; FR-OUT-008 forbids auto-retry; main-process approve is fail-closed and the send claim is idempotent). The receipt card now shows the terminal summary + detail AND keeps the reopen entry for `delivery_unknown`; settled statuses keep Review hidden (P1-6's component pins unchanged). Component RED→GREEN plus the two pre-existing pins updated to the ruled contract; full component suite 1,441 green; the Electron journey green in-suite.

Remaining flake class (recorded, not hidden): single-run full E2E on this loaded machine produced one rotating ~60s app-navigation-wait flake per run (`page.waitForURL` at `fixtures/electronApp.ts:364` — a different spec each run: workspace-memory-surface, skillInstallationMatrix, generated-image R-5); every one passed in isolation, the suite is already serial (`workers: 1`), and the final run was fully green. E2E run history on this revision: 187 passed / 1 flake → 188 passed / 0 failures.

## 6. Remaining certification and release TODOs

### V01 — Real speech runtime and device evidence

- [ ] Certify recording, transcription, draft merge, auto-send, spoken response, cancel and settings changes with the installed native runtime and real supported models/devices.
- **Evidence:** `test/e2e/specs/aiChatVoiceJourney.test.ts:196` explicitly describes a runtime stand-in. It is useful deterministic coverage, not physical microphone/model certification.
- **Closes:** FR-VOI-001–010, relevant AC 21/22 and design §12.6 release evidence. Record platform/runtime/model versions and failure paths without sensitive audio.

### V02 — Complete accessibility and supported-platform review

- [ ] Certify keyboard entry, focus trap/return and safe Escape for plan/questions, permissions, outbound review, reporting and image decision dialogs.
- [ ] Verify once-only announcements for permission/question/review/error states and inactive-conversation focus isolation with assistive technology.
- [ ] Test open decision dialogs at narrow supported widths and 200% scaling; verify primary actions remain visible.
- [ ] Verify reduced motion, target sizes and hidden reasoning's exclusion from accessibility output across the supported platform matrix.
- **Evidence:** existing shell keyboard/layout tests cover useful subsets; they do not establish every decision journey or a full screen-reader/platform review.
- **Closes:** A11Y-001–010, AC 26/27, PRD §28.8. Missing evidence is not automatically a confirmed accessibility defect.

### V03 — Authenticated managed-browser lifecycle and final security review

- [ ] Run and record start/approval/cancel, takeover, verify-login, resume, extend, stop, expiry, stale actions and reload/route-return behavior with the existing guarded browser setup.
- [ ] Record the release security review for AI gating, strict IPC validation, permission identity, workspace trust, email authorization/idempotency, reporting privacy, generated-image ownership, background redaction and database/worker boundaries.
- **Evidence:** `test/e2e/specs/managedBrowser.test.ts:77–80` skips unless `AIFETCHLY_MB_E2E=1`; the default deterministic gate is not proof of authenticated browser behavior. This audit contains targeted security-related checks, not complete PRD §28.7 certification.
- **Closes:** FR-BRW certification / AC 31 and PRD §28.7. Keep external-account/live checks distinct from deterministic tests.

### V04 — Soak, approvals and rollback removal decision

- [ ] Supply the rolling 14-day default-route soak with at least 500 accepted submissions, at least 99.5% acceptance excluding deliberate validation/entitlement rejections, and at least 99% recovery for exercised restart cases.
- [ ] Close severity-1/2 parity defects and demonstrate zero confirmed duplicate delivery, duplicate continuation, cross-conversation application or authorization-bypass incidents in that window.
- [ ] Obtain product, safety, desktop and QA sign-off, and keep Chat V2 until a separate removal decision.
- **Evidence:** design AD-009 and PRD §21/24/28 require these artifacts. The existing audit notes leave them open; this audit supplies no production soak or owner sign-off. ~~B05 must be corrected before renderer action metrics can support the measurement.~~ **B05 is fixed (`fb04b39cd`), so the metric path is measurement-ready; the soak itself remains.**
- **Closure:** dated final-revision evidence and approvals; extend low-volume soak rather than reducing thresholds.

## 7. Requirement coverage disposition

Every functional family is accounted for below. “Present” means implementation and relevant existing tests were identified; it does **not** certify every edge case. Outstanding findings and release gates prevent blanket completion claims.

| Requirement range | Current implementation/evidence | Remaining disposition |
| --- | --- | --- |
| FR-SUB-001–009 | Shared composer, attachment builder, center send flow, selected store and strict submission schemas; component acceptance tests | Present; C01 recorded deferral; T03's actual AC 36 journeys green; T04 gate green. |
| FR-CMD-001–009 | `useChatCommandRouting`, goal/loop/skill dispatch, scoped registry; fresh `/help` Electron pass | Present; final command/loop gate green (T04 evidence block). |
| FR-QUE-001–014 | Pending Module/Model, queue service, scheduler and run bridge; source identity and promotion; queue suite rerun passed | Present; full main suite green twice on the final revision (T04 evidence block); live restart/steering soak certification remains V04. |
| FR-PLN-001–009 | Plan actions, deterministic continuation ID, persisted recovery intent, question surfaces | ~~Partial: B03; C01; T01 and T03.~~ **B03 fixed (`8a41a083d`); T01 closed (`09dafacee`); T03's AC 11/12 journeys green. C01 remains a documented worktree deferral (owner decision).** |
| FR-PER-001–008 | Actionable cards, trusted grant/resume/deny routing, owner claims | ~~Partial: B07; supplied FR-PER-006 differs (C02); T01.~~ **B07 fixed (`a447f14f2`) with real-handler regressions; T01 closed. C02 stays the documented worktree deny-equals-stop exception (owner decision).** |
| FR-OUT-001–010 | Specialized batch/review surfaces, exact-draft authorization and delivery claims | Present; outbound guard suite green (T01 closed); T04 gate green; delivery-unknown reopen entry restored (`be644a2c1`); authenticated-browser/live safety evidence remains V03. |
| FR-IMG-001–015 | Tray, chooser, batch confirmation/progress/retry/stop/export; fresh ambiguity/cancel Electron pass | Present; complete batch/save journeys green in the final full-Electron run (T04 evidence block); image action telemetry live (B05 fixed). |
| FR-RPT-001–009 | Single/conversation dialogs and capability-independent reporting; fresh AI-disabled Electron pass | ~~Partial: FR-RPT-009 B04; action telemetry B05.~~ **B04 fixed (`8a41a083d` — session-scope markers, both surfaces); B05 fixed (`fb04b39cd` — preload allowlist, parity test green).** |
| FR-VOI-001–010 | Shared voice composable, recording/settings/playback controls, deterministic journey fixtures | Present; B05 telemetry and V01 real-runtime certification. |
| FR-WSP-001–010 | Shared workspace/trust/watch/memory composition; scoped refresh logic | Present; final workspace/platform review remains V02/V03 (release work). |
| FR-REC-001–008 | Retry/recovery/context projection and hydration | ~~Partial across both surfaces: B06; final restoration/error gate T04.~~ **B06 fixed (`d8035b157` — sentinel translated in all six locales); restoration/error journeys green in the final full-Electron run (T04 evidence block).** |
| FR-LIF-001–006 | Generation-owned buffering, restore pointer, durable sidebar, busy clear/delete guards | ~~Present with B07 stale-action defect; fresh inactive-sidebar journey is only one part of isolation evidence.~~ **B07 fixed (`a447f14f2`) with real-handler regressions; inactive-sidebar journey green.** |
| FR-SKL-001–006 | Shared installation cards, prompt invocation and Plugins management | ~~Partial: B01/B02; T02; AC 29 not closed.~~ **B01/B02 fixed (`14e444228`+`aee767f20`), T02 closed (`5557308f6`) — AC 29's reload-refresh + same-session + no-double-install pieces are covered by the refreshed-card regressions, the lifecycle session idempotency, and the hydration-race E2E.** |
| FR-BRW-001–006 | Shared start/session/intervention controls and active-session rehydration | Present; V03 authenticated lifecycle evidence outstanding (release work). |
| FR-HIS-001–005 | Archive drawer, per-conversation selection/submission IDs, reference acknowledgement and compaction | Present; T01 closed; T03's rejected-send history-retention journey green; T04 gate green. |
| FR-INT-001–005 | Portable-memory panel, setup, selected-live navigation, task actions, reasoning control | Present; cross-feature regression covered by the green final-revision gates; remaining security/accessibility review is V02/V03 release work. |
| A11Y-001–010 / PRD §16 | Accessible controls and six locale files with automated subsets | ~~B06 is a confirmed localization failure~~ **B06 fixed (`d8035b157`)**; full A11Y certification V02 (release work). |
| PRD §14/18/19; design invariants | Main-process gates, queue/run ownership, bounded projection, existing safety tests | ~~B01/B07 and blocked T01 coverage~~ **B01/B07 fixed; T01 unblocked and green**; no claim of completed exhaustive security/resource audit (V03 release work). |
| PRD §20 / design §18 | Main counters and renderer action client/handler exist | ~~B05 makes the renderer metric path nonfunctional.~~ **B05 fixed (`fb04b39cd`) — the channel is allowlisted in the preload invoke list and the parity test passes; the AC journeys exercise preload-backed counters.** |
| PRD §21–28 / design §26 | Default route and rollback remain; both typechecks, the component gate, two consecutive full main runs, and a fully green full-Electron run pass on the final revision (T04 evidence block) | Definition of Done remains unmet pending V01–V04 release certification only: C01/C02 dispositions recorded (owner decisions), gates green, T03 closed. |

AC-level summary: 1–10, 13–24, 28, 30 and 32–35 have implementations and existing test coverage, with the limitations listed above; this audit reran only the five Electron journeys in §2. ~~AC 11/12 require T03~~ **closed (AC 11/12 journeys)**; ~~AC 25 fails B06~~ **fixed (`d8035b157`)**; AC 26/27 need V02; ~~AC 29 is affected by B01/B02~~ **fixed (`14e444228`+`aee767f20`)**; AC 31 needs V03; ~~AC 36 still needs its actual rejection/retention journey~~ **closed (both-surface retention journeys)**. No previous “all complete” conclusion should override these current failures.

## 8. Suggested completion order

1. ~~Fix B01/B02 installation recovery and B07 stale permission cancellation, with permanent regressions.~~ **Done (`14e444228`+`aee767f20`, `a447f14f2`).**
2. ~~Fix B03/B04 state parity and B05/B06 wiring/localization.~~ **Done (`8a41a083d`, `fb04b39cd`, `d8035b157`).**
3. ~~Repair T01/T02; add T03's real acceptance journeys; reconcile C01/C02 against the canonical requirement set.~~ **Done (`09dafacee`, `5557308f6`, `c851883b6`); C01/C02 dispositions recorded as owner decisions.**
4. ~~Run T04 on the final revision~~ **Done (T04 evidence block; gate-stabilization commits `c577219cf`, `be644a2c1`)** — and complete V01–V03 certification (release work).
5. Complete V04 before declaring release parity or removing rollback (release work).

No checkbox in this document is closed merely because the corresponding component exists or a previous audit called the family complete.
