# AI Chat Automatic Titles — Second Audit and Remaining TODOs

Audit date: 2026-10-31

Branch: worktree-ai-chat-automatic-titles

Implementation reviewed: 000a9288f, after remediation commits 049182e17, 313ca805b, 50f533fc9 and 000a9288f.

Sources: [PRD](ai-chat-automatic-titles-prd.md), [technical design](ai-chat-automatic-titles-technical-design.md), and [first audit](ai-chat-automatic-titles-audit-todo-2026-10-31.md).

## Verdict

**No: not all requirements are correctly implemented or fully verified.** The remediation fixes several earlier defects, but remaining production-path bugs and incomplete acceptance tests exist. The first audit's statement that B01–B24 are all fixed and only external release gates remain is too broad.

This is a fresh audit of the current implementation. It does not repeat the first audit's resolved findings as if they were still broken. Only this new documentation file is changed; no implementation fixes are included.

Verified improvements include the hosted-pinned completion entry point, HTTP no-auth-replay option, final-completion envelope checks, ownership-conditional single-conversation clear, provisional revision increments, safe-text persistence in queued/idempotent turns, canonical validation in the new rename action, title-listener resubscription, versioned-title guards, mode-less title-toggle saves, and inner rename-input selection.

Remaining work falls into three categories:

- **Confirmed defects:** demonstrated by executable probes or a concrete production call path.
- **Implementation/interaction gaps:** required guarantees without complete wiring or adequate proof; their evidence limits are stated.
- **Verification/release gates:** missing tests or deployment/model evidence, rather than demonstrated deployed failures.

P1 indicates high-priority correctness/privacy/lifecycle work. P2 indicates a functional or required-design gap. P3 indicates a lower-priority boundary-completeness issue.

## Current verification

| Check | Result at reviewed HEAD |
| --- | --- |
| Title service, persistence, schema upgrade, projection race, coordinator, queue and provider IPC main suites | 7 files / 132 tests passed; normal TypeScript gate passed |
| Title/provider/HTTP utility suites | 8 files / 150 tests passed; normal TypeScript gate passed |
| Full component suite | 176 files / 1,539 tests passed |
| Vue type check | Passed |
| Safe Electron E2E build | Passed |
| Title Electron E2E spec under xvfb | 6 tests passed; teardown-evidence limitation F19 applies |
| Additional current-code probes | Reproduced incorrect turn pairing, excluded-source selection, first-40-row starvation, attachment-window counting, cancel/dispose during claim, byte overflow, path leakage, validator false positives, scope-bootstrap races and settings-listener leakage |

Main command:

~~~sh
yarn testmain aiChatTitleService.test.ts aiChatTitlePersistence.test.ts \
  aiChatTitleSchemaUpgrade.test.ts aiChatWorkspaceProjectionBackfillRace.test.ts \
  aiChatWorkspaceCoordinator.test.ts AIChatTurnQueueService.test.ts ai-provider-ipc.test.ts
~~~

Utility command:

~~~sh
yarn vitest --config vite.utilityCode.config.mjs run \
  test/vitest/utilitycode/aiChatApiProviderRouting.test.ts \
  test/vitest/utilitycode/openAICompatibleProviderClient.test.ts \
  test/vitest/utilitycode/aiChatTitlePrompt.test.ts \
  test/vitest/utilitycode/aiChatTitleText.test.ts \
  test/vitest/utilitycode/aiChatTitleEligibility.test.ts \
  test/vitest/utilitycode/aiChatTitleFixtures.test.ts \
  test/vitest/utilitycode/httpclientNoReplay.test.ts \
  test/vitest/utilitycode/httpclientRefresh.test.ts
~~~

Additional commands:

~~~sh
yarn test:components
yarn vue-typecheck
yarn build:e2e
xvfb-run -a yarn playwright test test/e2e/specs/aiChatTitles.test.ts
~~~

Temporary probes executed actual utilities/service code or actual transpiled candidate code with controlled dependencies. They lived under /tmp and are not permanent regression coverage. Scope/listener probes used the actual store/component. Passing probe assertions described the current erroneous results; they do not mean the defects were repaired.

No paid/live model requests, developer user-database migrations, or local packaging commands were run. The full unrelated main/utility/E2E suites were not run. Human model scoring and deployed hosted behavior remain unverified.

## Requirement and acceptance coverage

| Requirement | Current assessment | Remaining work |
| --- | --- | --- |
| FR-01 placeholder/provisional title | Implemented foundation; incomplete privacy/clear presentation | F04, F09, F12 |
| FR-02 durable completion and eligibility | Partial: trusted completion ID is supplied, but association/source/window query is still incorrect | F02–F04 |
| FR-03 lightweight routing | Strict hosted/custom transport improvements present; source-exchange identity still missing | F01; R04 |
| FR-04 budgets/frequency/priority | Single-attempt claim, no-auth-replay, output allocation and active-foreground detection exist; hard input bound/cancellation still fail | F05, F08; R04 |
| FR-05 title quality | Improved validator and multilingual fixtures exist; valid topic rejection and path leakage remain | F09–F10; R03 |
| FR-06 manual rename | Shared dialog/action, local persistence, keyboard/IME logic and primary validation exist; focus return and compatibility validation incomplete | F14–F15; R02 |
| FR-07 manual ownership/convergence | Single-clear ownership fix present; scope-bootstrap and empty-title presentation remain inconsistent | F11–F12; R02 |
| FR-08 settings/control | Toggle no longer changes mode; cancellation/source identity and listener cleanup remain incomplete | F01, F05, F13; R05 |
| FR-09 lifecycle/persistence | Epochs, copies and CLI upgrade exist; bulk clear, stale suppression, shutdown and scoped reconciliation remain incomplete | F05–F07, F17; R01 |
| FR-10 errors | Detached preparation errors are contained; fallback quality, cancellation and diagnostics still need work | F05, F10, F16; R02 |
| PRD §7 accessibility/i18n | Six-language keys and inner-field selection exist; full interaction/scaling/locale evidence missing | F12–F14; R02–R03 |
| PRD §8 privacy | Queued safe-text projection improved; provider-source identity and quoted-path protection remain incomplete | F01, F09 |
| Design §8.4 hosted availability | Dispatch resolves entitlement, but required pre-context availability gate is still ordered incorrectly | F18 |
| PRD §10–12 evaluation/release | Not acceptance-complete | R01–R06 |

| Acceptance criterion | Current result |
| --- | --- |
| AC-01 | Basic naming E2E passes; controlled delayed naming/next-send evidence and all completion paths remain incomplete: F04, R02 |
| AC-02 | Greeting classification passes; first-three counting/query can violate the lifecycle window: F03 |
| AC-03 | Claim/no-replay protections improved; disposal/claim races and real restart/request-count evidence remain: F05, R02 |
| AC-04 | Desktop strict-route/no-auth-replay tests pass; deployed hosted strict-route evidence remains: R04 |
| AC-05 | Explicit custom model and hosted pinning exist; source-turn identity still fails across settings changes: F01 |
| AC-06 | Output/deadline settings are requested; actual serialized input can exceed 4096 bytes: F08; adapter compliance remains R04 |
| AC-07 | Correct topic titles can be rejected; model language/quality targets are unscored: F10, R03 |
| AC-08 | Inactive sidebar rename and validation cases pass; real focus return, recoverable integration errors and target/selection cases incomplete: F14, R02 |
| AC-09 | Manual ownership CAS improved; scope completion and title presentation remain inconsistent: F11–F12 |
| AC-10 | Narrow title events/writes exist; extend ordering/unread/run/count assertions to repaired lifecycle paths: R02 |
| AC-11 | Cancellation/clear invalidation incomplete, especially claim, bulk clear and stale greeting suppression: F05–F07 |
| AC-12 | CLI migration/copy logic exists; desktop old-schema upgrade and real restart evidence remain: F17, R01–R02 |
| AC-13 | Local ungated rename implementation exists; disabled E2E still only proves missing-row failure, not a successful offline saved-row rename: R02 |
| AC-14 | Translation keys exist; quoted-path privacy, bootstrap scope handling and accessibility evidence remain incomplete: F09, F11–F14, R02 |
| AC-15 | Dedicated interactive trigger exists; candidate scan can still select cancelled or scheduled content: F02 |
| AC-16 | Normal provider failure fallback is implemented; error/usage reporting and complete lifecycle behavior still need acceptance evidence: F05, F16, R02 |

## Remaining defects and implementation tasks

### F01 — P1: Capture provider identity when the source turn executes

- [ ] **Requirement:** FR-03/08; AC-05/11; design §6 and §8.3. Reopens the incomplete portion of old B03.
- **Current evidence:** [AIChatTitleService.ts:188](../../src/service/AIChatTitleService.ts:188) still accepts only conversationId/assistantMessageId, then captures the current config version at line 205. [AIChatCoordinator.ts:963](../../src/service/AIChatCoordinator.ts:963) and [AIChatTurnQueueService.ts:1293](../../src/service/AIChatTurnQueueService.ts:1293) supply no execution-time provider identity/version.
- **Failure:** Start a foreground exchange against A, switch settings to B before its durable completion, then receive its title notification. The entry records B's version and can send A's excerpt to B. The existing fix only prevents changes after notification. Earliest-qualifying history may also belong to a different provider from the latest trigger.
- **Fix:** Capture an opaque source identity/version at actual turn dispatch and retain it with the durable turn/eligible exchange. Carry it through both completion owners; compare before preparation, claim, dispatch and apply. Do not persist plaintext keys in notifications/jobs.
- **Regression:** Barrier-controlled source response; switch endpoint/mode/key during the source turn and between substantive exchanges. Assert zero old-excerpt calls to the new endpoint/model.

### F02 — P1: Replace sequential pairing with durable successful interactive-turn association

- [ ] **Requirement:** FR-02; AC-15; design §6–7.1. Old B02 is only partially repaired.
- **Evidence:** [AIChatConversationModule.ts:395](../../src/modules/AIChatConversationModule.ts:395) retains the first unmatched user's text and ignores later users until an assistant appears. Metadata source is parsed but never filtered. The trusted assistant ID proves presence, not association with the chosen user.
- **Reproduced failures:** Cancel “Find dentists in Perth” before any partial assistant text; later complete a Berlin email request. Preparation returns the Perth user text paired with the Berlin answer. An earlier scheduled report is also selected after a later interactive greeting. [AIChatQueryEngine.ts:5095](../../src/service/AIChatQueryEngine.ts:5095) only persists a cancelled assistant when partial text exists, so the first scenario is a real transcript shape.
- **Fix:** Query durable completed interactive turns using their user/assistant/run associations and owner. Cancellation/failure with zero assistant rows must terminate the old association. Filter scheduled/goal/subagent sources rather than trusting generic role order.
- **Regression:** Zero-text and partial-text cancellations, failed turns, consecutive user rows, mixed scheduled/interactive history, and a trusted assistant whose user is not the earliest unmatched message.

### F03 — P2: Bound relevant exchanges, not the first 40 arbitrary rows

- [ ] **Requirement:** FR-02; AC-02/06/15; design §7.1.
- **Evidence:** [AIChatConversationModule.ts:353](../../src/modules/AIChatConversationModule.ts:353) loads only 40 generic rows before filtering. Its exchange list requires typed text before counting completion.
- **Reproduced failures:** A first turn with 40 tool rows places the final trusted assistant outside the page, producing not_ready and no automatic title. Three completed attachment-only exchanges followed by a fourth typed task make the fourth eligible, because the first three were not counted.
- **Fix:** Retrieve a bounded page of relevant completed interactive turn records and separately validate the notified IDs. Count completed exchanges independently of whether their typed text is substantive; inspect only the first three.
- **Regression:** Tool-heavy first answer, assistant after the generic-row cutoff, attachment-only/empty typed openings, and delayed evaluation after a fourth exchange. No full-history scan.

### F04 — P2: Persist safe typed text in the direct plain-text save path

- [ ] **Requirement:** FR-01/02; AC-01/15; design §7.2.
- **Evidence:** [AIChatQueryEngine.ts:1998](../../src/service/AIChatQueryEngine.ts:1998) constructs safeTypedText, but hasUserMetadataBeyondSource at line 2025 does not include it. The non-idempotent plain-text branch passes metadata=undefined at line 2058.
- **Failure:** A direct ordinary request without submissionId, attachments or other metadata loses its safe typed-text projection. The title Module now refuses to use raw persisted content, so that request cannot become an eligible topic. Queue/idempotent paths preserve the projection correctly.
- **Fix:** Always persist the bounded typed-text field for supported direct interactive turns. Keep raw visible text distinct from enrichment and preserve Unicode boundaries when clipping.
- **Regression:** Exercise the real direct save/completion path with no submissionId and plain typed text; inspect the saved metadata and eventual candidate. This audit traced the branch; no browser reproduction of that legacy path was performed.

### F05 — P1: Preserve cancellation through claim and wire shutdown disposal

- [ ] **Requirement:** FR-04/07–09; AC-03/09/11; design §6/8.5. Old B09 remains incomplete.
- **Evidence:** [AIChatTitleService.ts:392](../../src/service/AIChatTitleService.ts:392) awaits claim after its last preparation-abort check. At line 445 it creates a new AbortController without checking the earlier signal/disposed state. No title-service dispose/cancel call was found in the production shutdown participants/background shutdown wiring.
- **Reproduced:** Hold claim, call cancelConversation or dispose, release claim=true. In both cases the actual service dispatches once with a fresh non-aborted signal and the fake persistence surface reports success. Disposal therefore fails to seal an already-popped claimant; creating a replacement singleton can also undermine process-wide concurrency.
- **Fix:** Carry one linked cancellation token throughout preparation/claim/transport/application, check immediately after claim and before dispatch, and prevent apply/publication after disposal. Explicitly connect existing-service disposal to shutdown without instantiating an unused service. Preserve consumed-attempt/no-replay semantics.
- **Regression:** Cancel, rename, clear/delete, dispose and shutdown at every await boundary; assert zero post-cancellation dispatch. Retain conditional DB ownership/epoch checks as the final result protection. The probe used injected persistence, so it does not claim the DB CAS would allow a manual overwrite.

### F06 — P1: Apply title clear policy to bulk history deletion

- [ ] **Requirement:** FR-09; AC-11/12; design §5.4/11.
- **Evidence:** [ai-chat-v2-ipc.ts:1787](../../src/main-process/communication/ai-chat-v2-ipc.ts:1787) clears the pending queue and invokes clearAllV2History without title cancellation/reset. [AIChatV2Module.ts:487](../../src/modules/AIChatV2Module.ts:487) clears message/artifact history directly, unlike the title-integrated single-conversation handler.
- **Failure:** Bulk clear leaves nonmanual titles, generation status, claims and epochs in their old lifecycle. An in-flight result can still match its row after messages disappear; fresh content cannot necessarily receive the required new attempt.
- **Fix:** Cancel all affected naming work, atomically invalidate each affected epoch/reset nonmanual titles while preserving manual names, and publish authoritative title changes. Surface lifecycle persistence failures instead of claiming a fully successful partial operation.
- **Regression:** Multiple conversations, manual/nonmanual names, pending/running/succeeded naming, delayed results and fresh content after clear-all.

### F07 — P2: Condition greeting suppression on the source epoch

- [ ] **Requirement:** FR-02/09; AC-11/12; design §5.4/7.1. The substantive branch's old B07 fix does not cover suppression.
- **Evidence:** [AIChatConversationModule.ts:476](../../src/modules/AIChatConversationModule.ts:476) calls suppressTitleGeneration with only conversation ID. [AIChatConversation.model.ts:425](../../src/model/AIChatConversation.model.ts:425) checks pending status but not epoch/revision.
- **Race:** Preparation reads three old greetings; clear advances the epoch and resets pending; stale preparation then suppresses the fresh empty lifecycle. Future substantive content loses its generation opportunity.
- **Fix:** Include captured epoch and appropriate title state in the suppression predicate, returning stale when they changed. Recheck cancellation before mutating preparation state.
- **Regression:** Barrier between reading the old greeting window and suppression; clear then release. The new epoch must remain pending. This is a traced conditional-update gap, not an executed end-to-end race in this audit.

### F08 — P2: Make the serialized 4096-byte ceiling unconditional

- [ ] **Requirement:** FR-04; AC-06; design §7.3. Old B12's accounting improved, but its hard bound is still broken.
- **Evidence:** [AIChatTitlePrompt.ts:78](../../src/service/aiChatTitle/AIChatTitlePrompt.ts:78) stops after eight trimming rounds and returns messages built before the final trim.
- **Reproduced actual input:** userText = “Draft email ” + 1988 ASCII u characters (2000 UTF-16 units, within the production safe-text limit); assistantExcerpt = “Suggested plan ” + 838 backslashes + 10000 ASCII a characters. Both reported and actual JSON-serialized message size are **4115 UTF-8 bytes**.
- **Fix:** Continue until final serialization fits, rebuilding after every trim, with an explicit safe result for impossible fixed framing. Maintain Unicode-safe truncation and user-intent preference.
- **Regression:** Mixed ordinary user text and partially escaped assistant content, using the production 2000-unit user limit; assert actual serialized bytes, not only the reported budget.

### F09 — P2: Redact/reject ordinary quoted and bracketed absolute paths

- [ ] **Requirement:** FR-01/05, PRD §8; AC-14; design §7.2/9.
- **Evidence:** [AIChatTitleText.ts:35](../../src/service/aiChatTitle/AIChatTitleText.ts:35) requires Unix paths to start the string or follow whitespace and recognizes a fixed root list. [AIChatTitleValidator.ts:22](../../src/service/aiChatTitle/AIChatTitleValidator.ts:22) repeats the restriction.
- **Reproduced:** Analyze "/Users/alice/private/report.txt", Analysis (/Users/alice/private/report.txt), and Analyze /srv/customer-secrets/report.csv remain unchanged by input sanitation and pass generated-title validation.
- **Fix:** Support common quote/bracket/backtick boundaries and supported absolute-path forms consistently in both input/excerpt sanitation and output rejection. This is protection for ordinary file-analysis syntax, not a promise to discover every possible secret.
- **Regression:** Quoted/parenthesized/backticked Linux/macOS paths, /srv and /Volumes, and legitimate topic punctuation; inspect prompt/excerpt output and saved-title rejection.

### F10 — P2: Stop rejecting harmless topic words as completion claims

- [ ] **Requirement:** FR-05; AC-07; design §9.
- **Evidence:** [AIChatTitleValidator.ts:28](../../src/service/aiChatTitle/AIChatTitleValidator.ts:28) lacks a leading English word boundary before completion verbs.
- **Reproduced:** “Email Consent Management”, “Consent-Based Outreach” and “Unsent Email Review” are rejected because sent matches a suffix. “AI-Generated Image Editing” is also blanket-rejected even when describing an artifact/topic rather than claiming the requested work occurred.
- **Impact:** Correct provider output is discarded permanently for that lifecycle because no second attempt is allowed.
- **Fix/regression:** Use bounded whole-word/explicit action-claim fixtures, preserving ordinary topic/artifact descriptions. Accept these examples while still rejecting supported unsupported-completion cases in all six languages.

### F11 — P1: Give bootstrap buffering, errors and finalization scope/request ownership

- [ ] **Requirement:** FR-07/10; AC-09/14; design §10.3. Old B17/B23 remain partially open.
- **Evidence:** [chatWorkspace.ts:168](../../src/views/store/chatWorkspace.ts:168) checks generation only in the successful response body. catch/finally at lines 187–196 unconditionally change current error/in-flight state and drain a shared title buffer.
- **Reproduced:** Old-scope response completes during the new scope's bootstrap, drains/discards its unknown-row revision-2 event, then the new response installs revision 1. A rejected old-scope bootstrap also sets the new scope's error. Concurrent same-scope requests share the same boolean/buffer and need equivalent ownership protection.
- **Fix:** Scope every completion branch and use a single-flight or request-owned buffering strategy. An invalidated request must not consume current events, clear current in-flight state or write current errors.
- **Regression:** Reset→new request→old success/rejection; overlapping same-scope responses; newer buffered title before row discovery; unknown/deleted rows remain unresurrected.

### F12 — P2: Preserve authoritative empty titles in the selected header

- [ ] **Requirement:** FR-01/07/09; AC-09/12; design §10.2–10.3.
- **Evidence:** [AiChatCenterSurface.vue:878](../../src/views/components/aiChatWorkspace/AiChatCenterSurface.vue:878) returns summary.title OR the old selection-snapshot title.
- **Failure:** A title-only null event after clear sets the workspace title to empty. The sidebar shows New chat, but a selected header falls back to the old nonempty snapshot name until reselection/reload.
- **Fix:** Fall back only when the authoritative summary is absent, preserving an intentionally empty title for localized placeholder rendering.
- **Regression:** Old selected snapshot plus a newer clear event; both header/sidebar show New chat without reload. The production value flow was traced; no dedicated browser reproduction was performed.

### F13 — P2: Move settings-listener cleanup into script setup

- [ ] **Requirement:** FR-08; renderer lifecycle correctness.
- **Evidence:** [ai_provider.vue:109](../../src/views/pages/systemsetting/ai_provider.vue:109) registers the settings-changed listener. Its onUnmounted call at line 146 is outside the closing script/style tags, so Vue never executes it.
- **Reproduced:** Unmounting the actual page leaves the listener active; dispatching the settings event still fetches settings. Route revisits accumulate requests and retain old component closures.
- **Fix/regression:** Register cleanup inside script setup. Mount→unmount→dispatch performs no fetch; remount handles one event once. Add a whole-page component test, not only a provider-panel test.

### F14 — P2 interaction gap: Restore focus to a stable control after the dialog closes

- [ ] **Requirement:** FR-06, PRD §7; AC-08/14; design §10.4. Inner-input selection is fixed, but old B22's return-focus portion is not.
- **Evidence:** [AuthenticatedWorkspaceLayout.vue:94](../../src/views/layout/AuthenticatedWorkspaceLayout.vue:94) and [AiChatCenterSurface.vue:3036](../../src/views/components/aiChatWorkspace/AiChatCenterSurface.vue:3036) capture the closing menu item via document.activeElement. [conversationRename.ts:76](../../src/views/composables/conversationRename.ts:76) calls focus synchronously while the dialog is closing.
- **Gap:** The saved element can be hidden/detached, and the active dialog focus trap can override the attempted focus. This audit did not reproduce a real-browser focus-return failure.
- **Fix/regression:** Retain the stable overflow/menu activator and restore after actual dialog deactivation. Verify keyboard Save/Cancel/Escape and inactive-row rename with real Vuetify focus handling.

### F15 — P3 boundary gap: Remove the compatibility rename validation bypass

- [ ] **Requirement:** FR-06; design §10.1.
- **Evidence:** [AIChatConversationModule.ts:282](../../src/modules/AIChatConversationModule.ts:282) still delegates rename directly to the Model. Only applyManualRename invokes the canonical validator. The Model now rejects oversize names but still accepts empty/whitespace/control values.
- **Scope:** No external production caller of this compatibility method was found; the primary IPC rename path is validated. This is an incomplete public Module boundary, not a demonstrated renderer bug.
- **Fix/regression:** Delegate to the validated action or remove the unused bypass. Direct Module calls must reject invalid input without mutating ownership/title; ordinary user punctuation/Unicode must remain valid.

### F16 — P2 diagnostics gap: Preserve per-attempt usage and explicit unknown values

- [ ] **Requirement:** PRD §10; design §12. Old B24 improved counters/durations but is not complete.
- **Evidence:** [AIChatTitleService.ts:499](../../src/service/AIChatTitleService.ts:499) updates only lastProviderUsage when both fields exist; later responses without usage retain previous counts. Invalid envelopes exit before usage capture. Diagnostics retain counts/last samples rather than the specified request-associated local outcome metadata.
- **Gap:** Usage from a prior request cannot establish a later request's consumption, including provider-charged invalid output. Byte estimates are not token measurements; prompt version/provider kind/request outcome and unknown usage need a traceable local record for the required evaluation.
- **Fix/regression:** Bound local per-attempt metadata or equivalent aggregates, representing measured/estimated/unknown independently. Capture reported usage even when output is rejected. Test known usage followed by absent usage and a charged invalid response. Keep transcript usage separate and log no content.

### F17 — P2 lifecycle gap: Reconcile title state per authenticated database scope

- [ ] **Requirement:** FR-09; AC-11/12; design §6/11.
- **Evidence:** [ai-chat-workspace-ipc.ts:224](../../src/main-process/communication/ai-chat-workspace-ipc.ts:224) owns a process-global backfillStarted flag; title reconciliation at line 332 is inside its one-time block. The DB-switch title-singleton reset does not reset this guard, and a reconciliation error is caught after the flag is already set.
- **Gap:** Opening another account/database in the same process, or a failed first reconciliation, can leave its running title claims unreconciled. Resetting the network singleton alone does not perform the required persisted-state repair.
- **Fix/regression:** Track schema-readiness/reconciliation by authenticated DB scope, safely retry failed readiness work, and never enqueue paid backfill jobs. Use two temporary DB scopes with abandoned claims and verify interrupted fallback/legacy-user repair in both.

### F18 — P2 ordering gap: Check hosted AI availability before title-context preparation

- [ ] **Requirement:** Design §8.4 explicitly requires a hosted gate before context preparation and again before dispatch.
- **Evidence:** [AIChatTitleService.ts:356](../../src/service/AIChatTitleService.ts:356) prepares/mutates the candidate before resolveTitleProvider at line 374 checks availability.
- **Gap:** With hosted AI disabled, the service still reads/evaluates context and may replace/suppress excerpts before the entitlement decision. The later gate prevents a paid title call; this audit does not claim a disabled-hosted model dispatch.
- **Fix/regression:** Establish eligible source provider/availability before context preparation, preserving the existing custom-provider-without-hosted-subscription path. Disabled hosted mode must make zero context-preparation calls; enabled custom mode still works.

### F19 — P2 test defect: Assert teardown on the app actually under test

- [ ] **Requirement:** Reliable acceptance evidence for AC-01/03/08/09/13.
- **Evidence:** [aiChatTitles.test.ts:64](../../test/e2e/specs/aiChatTitles.test.ts:64) requests app, titlesApp and disabledApp in every afterEach, then chooses app first.
- **Failure:** Playwright fixture dependencies initialize all requested fixtures. This launches extra Electron instances against the shared test root and can reset fake-provider/state-manifest setup. The plain app is always selected for assertCleanTeardown, so errors from the actual title-enabled/disabled test app can escape that assertion.
- **Fix/regression:** Use app-specific hooks/describes or fixture-owned teardown checks. Instantiate only the required app; collect errors from that instance. Confirm launch counts and absence of fake-server/state contamination. The six passing cases therefore provide functional evidence with a cleanup-observability limitation.

## Missing tests and release evidence

### R01 — Local test incomplete: Execute the desktop synchronization upgrade path

- [ ] Upgrade a real populated pre-feature database using the actual desktop synchronize/entity configuration, separately from the CLI migration.
- [ ] Verify legacy/manual/empty titles, defaults, ownership repair, abandoned claims, idempotence and zero model calls after reopening.
- **Current evidence:** [aiChatTitleSchemaUpgrade.test.ts](../../test/vitest/main/aiChatTitleSchemaUpgrade.test.ts) adds three real old-schema CLI migration tests. It does not run desktop synchronization against that schema. Equal entity/migration defaults are structural evidence, not this required execution.
- **Boundary:** This temporary-DB test is safe local work; it is not inherently an operator/packaging gate. Tests involving a packaged delivery remain CI/operator-only.

### R02 — Acceptance coverage incomplete: Add actual lifecycle/integration regressions

- [ ] Commit regressions for F01–F19 with the corresponding fixes; do not count temporary audit probes as completed coverage.
- [ ] Exercise both real coordinator/queue notification paths with execution-time provider identity, durable association, cancellation, exclusions and nonblocking next-message drainage.
- [ ] Add a controlled delayed title response; prove assistant/composer/next send remain usable before releasing it; rename while generation is genuinely in flight; assert exact dispatch count/model/endpoint.
- [ ] Successfully rename an existing saved row offline and with hosted AI disabled. The current disabled case still only proves missing-row failure.
- [ ] Test actual Electron close/reopen/process restart, duplicate/clear/delete, disable/re-enable and provider switching. The newly named “close/reopen” E2E uses renderer reload, which is different evidence.
- [ ] Cover both grouped/unassigned inactive rows, selection changes while editing, persistence failure/draft retention, settings-page mount/unmount, title-only unread/activity/run/count invariants, and repaired scope races.
- [ ] Verify 1366×768, 200% scaling, touch/keyboard operation, long translated labels, IME and real focus return.
- [ ] Change UI locale after saving generated/manual content and prove names are not translated. The i18n utility suite checks keys, not this stored-content behavior.

### R03 — Release evidence incomplete: Multilingual quality and latency

- [ ] Run the 60 existing fixtures against declared supported title models/providers; retain outputs and human topic-accuracy/specificity/readability scores.
- [ ] Require at least 5/6 per passing substantive title, 90% overall and 80% per language, correct language and no observed privacy/unsupported-completion failure.
- [ ] Include consent/unsent/generated-artifact false-positive cases, mixed-language cases and the UI-locale tie-breaker. The current job/prompt does not pass a locale hint; implement or demonstrate the specified tie-break behavior rather than assuming it.
- [ ] Record environment, measured/estimated/unknown usage, response-body deadlines and the 95%-within-5s target with a 10s hard client deadline.
- **Evidence gap:** Fixture shape/eligibility tests are present, but no scored model-output or measured deployment-latency record was found. A provider and human review are needed to close this gate.

### R04 — Release evidence incomplete: Deployed routing and adapter capability

- [ ] Verify the deployed hosted lightweight route honors strict no-default/no-model-fallback semantics internally.
- [ ] For each declared supported custom adapter/model, prove the requested 64-token total completion cap is supported, including reasoning-budget compatibility; exclude unsupported/noncompliant adapters.
- [ ] Inspect exact serialized requests, response-body/header deadlines, cancellation, error/debug logs and actual request counts. Desktop fake-provider tests do not prove server-side routing or arbitrary adapter compliance.

### R05 — Release evidence incomplete: Staged enablement and rollback

- [ ] Record internal flag behavior in the release configuration; ensure new-conversation-only rollout and no enablement before hosted/model gates pass.
- [ ] Drill disable during queue/preparation/claim/network/application, future-completion-only re-enable, no replay/batch, and retained manual/local rename.
- [ ] Verify scope switching and shutdown disposal after F05/F17 are fixed.
- [ ] Any packaged-delivery validation is OPERATOR/CI-only. Do not run local yarn package, yarn make or electron-forge packaging; safe local equivalents remain build/build:e2e.

### R06 — Documentation evidence incomplete: Correct broad completion claims

- [ ] Reconcile the PRD's “all FR-01–FR-10 coded with regression tests and Electron E2E coverage” status with this audit's actual missing paths.
- [ ] Update the technical design's still-Proposed/nonexistent-new-files status without erasing intended contracts.
- [ ] Mark earlier B02/B03/B07/B09/B12/B14/B17/B21/B22/B23/B24 closures with precise remaining scope. Distinguish repaired code, runtime verification, test additions and external gates.
- [ ] Correct the first TODO's stale four-test count, “every issue has a regression test” claim, renderer-reload-versus-process-restart claim, and unsupported statement that the i18n suite proves locale preservation.
- [ ] Link each completed task to an actual fix commit and acceptance evidence. Do not close requirements from commit subjects or broad suite totals alone.

## Recommended order

1. Fix source identity, trusted association, cancellation and all clear paths: F01–F07.
2. Close hard bounds/privacy/quality and renderer state failures: F08–F13.
3. Complete focus, compatibility boundaries, diagnostics, scoped reconciliation and availability ordering: F14–F18.
4. Repair E2E fixture evidence, add missing integration regressions and execute the desktop upgrade test: F19, R01–R02.
5. Close model/deployment/rollout gates and reconcile documentation: R03–R06.

Follow AGENTS.md: use Models/Modules for DB work, add UI tests and all six translations for changed UI text, commit completed logical units, and never package locally.
