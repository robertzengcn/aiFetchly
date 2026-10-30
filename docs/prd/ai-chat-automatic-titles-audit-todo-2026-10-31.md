# AI Chat Automatic Titles — Implementation Audit and Remaining TODOs

Audit date: 2026-10-31

Branch: worktree-ai-chat-automatic-titles

Audited implementation: c00fa04c7, before this report's documentation commit

Requirements: [PRD](ai-chat-automatic-titles-prd.md) and [technical design](ai-chat-automatic-titles-technical-design.md)

## Verdict

**Not all requirements are complete.** The feature has substantial implementation and passing happy-path tests, but confirmed correctness, privacy, provider-routing, synchronization, and accessibility gaps remain. It should not be treated as acceptance-complete.

Implemented foundations include lifecycle columns and a registered migration; atomic claim/generated-title/manual-rename methods; a single background worker and bounded memory queue; deterministic greeting detection; hosted strict-model-fallback and custom literal-model options; title events and renderer revision handling; a shared rename dialog/action for header and sidebar; automatic-title settings and a custom title-model field; translations for all six languages; 60 evaluation fixtures; and four Electron E2E cases.

The Chat titles switch, usage notice, and hosted/custom explanations **are present** in the parent settings page, [ai_provider.vue](../../src/views/pages/systemsetting/ai_provider.vue:20). They are not missing simply because they are outside AIProviderSettingsPanel. Their state synchronization has a separate bug below.

This audit changes documentation only. All checkboxes below are open. P1 means a high-priority correctness/privacy issue; P2 means a functional or required-design gap. Release evidence tasks are distinguished from demonstrated runtime bugs. B08 is an unclosed design/concurrency guarantee, B20 is a contract-interpretation check, and B23 is a scope-lifecycle implementation gap; these are not claimed as experimentally reproduced end-to-end failures. Passing existing tests does not establish coverage of the reproduced counterexamples.

## Verification performed

| Check | Result |
| --- | --- |
| Main title service, persistence, and projection-backfill race suites | 3 files / 43 tests passed; normal TypeScript gate passed |
| Existing coordinator and pending-turn queue regression suites | 2 files / 54 tests passed; normal TypeScript gate passed |
| Title prompt/text/eligibility/fixtures and provider-routing/client utility suites | 6 files / 119 tests passed; normal TypeScript gate passed |
| Full component suite, yarn test:components | 176 files / 1,534 tests passed |
| Vue type check, yarn vue-typecheck | Passed |
| Safe Electron E2E build, yarn build:e2e | Passed |
| Automatic-title Electron E2E spec under xvfb | 4 tests passed in 58.6s |
| Additional temporary audit probes | Reproduced store event/bootstrap failures, clear/rename loss, missing excerpt revision increment, invalid candidate pairing/window/epoch, attachment enrichment disclosure, provider-change-before-pump dispatch, truncated response acceptance, background unhandled rejection, hidden HTTP replay, and serialized-budget overflow |

Commands used:

~~~sh
yarn testmain aiChatTitleService.test.ts aiChatTitlePersistence.test.ts aiChatWorkspaceProjectionBackfillRace.test.ts
yarn testmain aiChatWorkspaceCoordinator.test.ts AIChatTurnQueueService.test.ts
yarn vitest --config vite.utilityCode.config.mjs run \
  test/vitest/utilitycode/aiChatApiProviderRouting.test.ts \
  test/vitest/utilitycode/openAICompatibleProviderClient.test.ts \
  test/vitest/utilitycode/aiChatTitlePrompt.test.ts \
  test/vitest/utilitycode/aiChatTitleText.test.ts \
  test/vitest/utilitycode/aiChatTitleEligibility.test.ts \
  test/vitest/utilitycode/aiChatTitleFixtures.test.ts
yarn test:components
yarn vue-typecheck
yarn build:e2e
xvfb-run -a yarn playwright test test/e2e/specs/aiChatTitles.test.ts
~~~

Temporary probes lived under /tmp and did not modify tracked implementation/tests. Persistence race probes executed actual transpiled Model methods against temporary in-memory SQLite; candidate probes executed the actual Module method with controlled dependencies. They demonstrate the failures but must be converted into committed regression tests during fixes. No paid provider calls or developer user-database migrations were performed. No local packaging command was run. The full unrelated main/utility suites were not run.

## Requirement coverage

“Partial” means relevant code exists but at least one required behavior or acceptance test is incomplete.

| Requirement | Assessment | Remaining work |
| --- | --- | --- |
| FR-01 placeholder/provisional title | Partial | Revision/event propagation for seeded, replaced, and cleared excerpts: B15 |
| FR-02 durable completion/eligibility | Partial | Trusted pairing, safe typed text, first-three window, source epoch: B01–B02, B07 |
| FR-03 lightweight routing | Partial | Provider identity across queue/dispatch, hosted pinning, transport replay: B03–B05 |
| FR-04 budgets/frequency/priority | Partial | Serialized byte bound, hidden replay, actual foreground priority, output acceptance: B05, B10, B12–B13 |
| FR-05 title quality | Partial | Output artifact/claim rejection and real model evaluation: B13–B14, R03–R04 |
| FR-06 manual rename | Mostly implemented; incomplete | Module validation and real focus/selection behavior: B21–B22; successful offline/inactive-row integration evidence: R02 |
| FR-07 ownership/concurrent updates | Partial | Clear/manual race, revisions, bootstrap/event convergence: B06, B15–B18 |
| FR-08 settings/control | Partial | Toggle changes provider; title-model identity and cancellation/commit races: B03–B04, B08–B09, B19–B20 |
| FR-09 persistence/lifecycle | Partial | Clear races, source-epoch consistency, scope reset, old-schema upgrade evidence: B06–B07, B15, B23, R01 |
| FR-10 errors | Partial | Unhandled background preparation errors, invalid outputs, incomplete cancellation and diagnostics: B08–B14, B24 |
| PRD §7 accessibility/i18n | Six-language keys implemented; interaction evidence incomplete | Real field focus/selection and stable focus return; scaling/keyboard/touch checks: B22, R02 |
| PRD §8 privacy | Partial | Persisted attachment-enriched input and incomplete generated-output rejection: B01, B14 |
| PRD §10–12 evaluation/release | Incomplete evidence | Human scoring, deployed hosted route, adapter caps, latency and enable/disable drill: R03–R05 |

| Acceptance criterion | Assessment / outstanding task |
| --- | --- |
| AC-01 | Basic automatic naming implemented and exercised; controlled delayed-title/usability proof still needed (R02), provisional propagation incomplete (B15) |
| AC-02 | Greeting utility exists; durable exchange counting/window is wrong (B02) |
| AC-03 | Durable claim protects the main service path; hidden HTTP replay and source/lifecycle tests remain (B03, B05, B07, R02) |
| AC-04 | Strict 404 fallback test passes; no-replay policy is absent from the underlying HTTP layer (B05), deployed strict route unverified (R04) |
| AC-05 | Custom literal model exists; source binding and hosted re-resolution fail (B03–B04), while title-model save semantics need clarification (B20) |
| AC-06 | Limits are requested; serialized input accounting, rejected completion envelopes, real foreground integration and adapter evidence incomplete (B10, B12–B13, R04) |
| AC-07 | Multilingual corpus exists; output guard/claim checks and scored generated results incomplete (B14, R03) |
| AC-08 | Shared dialog and entry points exist; real focus/selection, inactive-row and recoverable-error integration coverage incomplete (B22, R02) |
| AC-09 | Basic delayed-write ownership CAS exists; clear/manual, bootstrap and renderer lifecycle races remain (B06, B15–B18) |
| AC-10 | Title-only events and narrow writes preserve unrelated metadata by design; extend ordering/unread assertions to all repaired paths (R02) |
| AC-11 | Version checks/epochs exist; settings cancellation and apply serialization, source pinning, clear preparation race remain (B03–B09) |
| AC-12 | Legacy/duplicate/manual lifecycle code exists; clear races and actual old-schema upgrade evidence remain (B06–B07, R01) |
| AC-13 | Rename IPC is local and ungated; E2E only proves missing-row failure while disabled, not successful offline rename of a saved row (R02) |
| AC-14 | Six-language keys and text interpolation exist; safe input, output checks, scope/reset, real accessibility evidence incomplete (B01, B14, B22–B23, R02–R03) |
| AC-15 | Dedicated interactive trigger exists; candidate scan can still select excluded/cancelled/attachment-only historical input (B01–B02) |
| AC-16 | Ordinary transport failure preserves fallback; preparation errors escape the detached pump and malformed completions may be saved (B11, B13–B14) |

## Confirmed bugs and incomplete implementation

### B01 — P1: Select safe typed text instead of attachment-enriched persisted content

- [ ] **Requirement:** FR-02, PRD §8; AC-14/15; design §7.2.
- **Evidence:** [AIChatQueryEngine.ts:1143](../../src/service/AIChatQueryEngine.ts:1143) appends attachment instructions, filename, attachment reference and local path; [AIChatQueryEngine.ts:1874](../../src/service/AIChatQueryEngine.ts:1874) uses that enriched text for persistence; [AIChatQueryEngine.ts:2045](../../src/service/AIChatQueryEngine.ts:2045) saves it. [AIChatConversationModule.ts:336](../../src/modules/AIChatConversationModule.ts:336) then uses persisted content as the title's user request.
- **Failure:** An attachment-only opening becomes “substantive” because the injected English instructions contain text. Executed preparation retained file_name="secret-campaign.csv", attachment_ref="ref123", and a quoted file_path="/home/user/tmp/file". The path sanitizer does not remove that quoted assignment. This spends a title request on an excluded input and sends enrichment/private path metadata beyond the allowed visible typed request.
- **Fix:** Persist a reliable raw visible typed-text projection at submission and use only it for naming, including queue-drained turns. Do not strip injected blocks with delimiter heuristics. Apply eligibility before enrichment and keep attachment-only exchanges on their fallback.
- **Regression:** Document-only opening makes zero title calls; typed request with an attachment sends neither attachment metadata/content nor hidden mention/retrieval/system/reasoning content. Inspect the serialized provider payload.

### B02 — P1: Pair trusted successful turns and enforce the first-three window

- [ ] **Requirement:** FR-02; AC-02/03/15; design §6–7.1.
- **Evidence:** [AIChatTitleService.ts:154](../../src/service/AIChatTitleService.ts:154) discards assistantMessageId. [AIChatConversationModule.ts:329](../../src/modules/AIChatConversationModule.ts:329) pairs the first unmatched user with the next nonempty assistant among 40 generic message rows; it checks neither durable turn status/IDs nor owner/epoch. The substantive search at line 346 has no three-exchange limit.
- **Failure:** A cancelled partial answer can supply the title after a later successful completion. A cancelled user with no answer can be paired with a later user's assistant. Three greeting exchanges followed by a fourth substantive exchange can become eligible when evaluation is delayed; preparation directly reproduced this. Noninteractive content in a mixed-owner history is not filtered by this query.
- **Fix:** Carry trusted user/assistant IDs, completed interactive owner, run association and epoch in notifications; query a bounded ordered page of completed interactive exchanges and inspect only the first three. Preserve the earliest qualifying exchange when earlier eligibility was skipped for configuration/capacity reasons.
- **Regression:** Cancellation with/without partial assistant, failed/interrupted/tool-only/permission-only turns, mixed owners, duplicate queue/coordinator notifications, and delayed preparation after a fourth exchange. No excluded input may dispatch.

### B03 — P1: Bind queued candidates to the provider of the source exchange

- [ ] **Requirement:** FR-03/08; AC-05/11; design §6 and §8.3.
- **Evidence:** Notifications and [QueueEntry](../../src/service/AIChatTitleService.ts:101) retain only conversation ID/time. The configuration version is first captured inside [process](../../src/service/AIChatTitleService.ts:269); the provider is resolved later at line 288.
- **Failure:** Complete with provider A, enqueue, then change settings before the deferred pump starts. The job captures provider B's version and sends A's exchange to B. A temporary service probe changed the version immediately after notification and still observed one dispatch. A later completion can also select an earlier exchange made under a different provider because per-exchange identity is absent.
- **Fix:** Capture opaque provider identity/config version at source turn execution and carry it with the eligible exchange/candidate. Recheck before claim/dispatch; discard any mismatch. Do not put plaintext credentials in notifications or durable job metadata.
- **Regression:** Switch endpoint, credentials, preset and hosted/custom mode before pump, while queued behind work, and between exchanges. The newly selected endpoint must receive zero requests containing old-source excerpts.

### B04 — P1: Pin hosted dispatch instead of re-resolving the global provider

- [ ] **Requirement:** FR-03/08; AC-05/11; design §8.3.
- **Evidence:** [aiChatWorkspaceRuntime.ts:156](../../src/service/aiChatWorkspaceRuntime.ts:156) awaits an import and calls public openAIChatCompletion. [aiChatApi.ts:2288](../../src/api/aiChatApi.ts:2288) awaits the resolver and reads the current provider again.
- **Failure:** A mode change during these awaits can route the hosted title job to a custom endpoint. The hosted request has no literal-model flag, so "small" can become that provider's default chat model. The service's earlier version check does not protect this asynchronous transport boundary.
- **Fix:** Use a hosted-specific completion seam pinned to the authorized snapshot, with entitlement/config/cancellation rechecked at actual dispatch. Preserve the separate custom pinned-client path.
- **Regression:** Gate import/resolver readiness, switch to custom, release, and assert zero calls to the custom endpoint/default model.

### B05 — P1: Disable HTTP authentication replay for title requests

- [ ] **Requirement:** FR-04; AC-03/04; design §5.1/8.5.
- **Evidence:** The strict policy in [aiChatApi.ts:2439](../../src/api/aiChatApi.ts:2439) only prevents small-model fallback. [httpclient.ts:242](../../src/modules/lib/httpclient.ts:242) still refreshes on 401/403 and [httpclient.ts:197](../../src/modules/lib/httpclient.ts:197) replays the original POST.
- **Failure:** Actual transpiled HttpClient code with fake 401→200 responses and refresh dependencies produced **two completion POSTs**. Mocking postJson in routing tests hides this replay.
- **Fix:** Add a request-local no-replay policy through every transport layer for title work, including auth refresh retries. Existing callers retain their current behavior. Refresh before dispatch where necessary, without replaying an already attempted completion.
- **Regression:** Test the real HttpClient boundary for 401, 403, 404, 429 and transport loss, asserting exactly one completion POST and no fallback/default model.

### B06 — P1: Preserve manual ownership atomically when clearing history

- [ ] **Requirement:** FR-07/09; AC-09/12; design §5.3–5.4.
- **Evidence:** [AIChatConversation.model.ts:388](../../src/model/AIChatConversation.model.ts:388) reads ownership, then the nonmanual clear UPDATE at line 420 filters only by conversation ID.
- **Failure:** Clear reads nonmanual → rename commits → clear applies its old branch. A real SQLite reproduction ended with title=null, titleIsUserSet=true, titleSource=placeholder: the manual name was erased.
- **Fix:** Make preservation/reset conditional on current ownership in the database, using a transaction/conditional update/CASE as appropriate; coordinate transcript deletion and epoch invalidation so failures cannot leave an apparently successful partial clear.
- **Regression:** Barrier-test clear versus rename in both commit orders, manual names equal to the current excerpt, and clear lifecycle persistence failure.

### B07 — P1: Never attach old prepared text to a new cleared epoch

- [ ] **Requirement:** FR-09; AC-11/12; design §5.4/7.1.
- **Evidence:** [AIChatConversationModule.ts:363](../../src/modules/AIChatConversationModule.ts:363) conditionally updates the old epoch, then reloads the row and returns its current epoch/revision alongside previously read message text.
- **Failure:** Clear between message selection and excerpt update makes the old conditional update miss. Preparation nevertheless adopts the cleared epoch and can claim/title the new empty lifecycle using deleted history. Executed preparation returned old text with the new epoch.
- **Fix:** Keep source epoch fixed throughout preparation; reject any changed/missing row or failed conditional update. Initialize cancellation tracking before awaited preparation as well as before the provider call.
- **Regression:** Clear/delete during each preparation await; assert no claim, excerpt rewrite or dispatch from old history, including subsequent fresh content.

### B08 — P1: Serialize settings invalidation with the generated-title commit

- [ ] **Requirement:** FR-08/10; AC-11; design §5.4 explicitly rejects a standalone check before an awaited write.
- **Evidence:** [AIChatTitleService.ts:418](../../src/service/AIChatTitleService.ts:418) checks version/enabled state, then awaits applyGeneratedTitle at line 436. [AIChatConversationModule.ts:418](../../src/modules/AIChatConversationModule.ts:418) delegates after connection readiness without a policy version in the database predicate. Settings mutation only bumps an in-memory counter.
- **Static concurrency gap; runtime race not reproduced:** If settings change while the delegated apply is suspended after the service check, the database predicate has no policy version/invalidation guard. The old result can still match its request/epoch/revision. This does not establish that every ready synchronous-SQLite call exposes an interleaving; the design explicitly requires a serialized guarantee rather than relying on awaited-write scheduling.
- **Fix:** Serialize the short policy-check/commit with settings mutation, or add an equivalent durable policy version. Do not serialize the network request. Invalidate running claims as part of the policy transition.
- **Regression:** Hold the result at the Module/connection boundary, disable or switch provider, then release. Saved title and title-event count must stay unchanged.

### B09 — P2: Connect cancellation to every required lifecycle transition

- [ ] **Requirement:** FR-07–09; AC-09/11; design §8.5.
- **Evidence:** [AIChatTitleService.ts:172](../../src/service/AIChatTitleService.ts:172) provides cancelConversation/cancelAll, but active cancellation fields are assigned only after prepare/claim at line 353. Rename at [ai-chat-workspace-ipc.ts:721](../../src/main-process/communication/ai-chat-workspace-ipc.ts:721) does not cancel the service; settings save at [ai-provider-ipc.ts:83](../../src/main-process/communication/ai-provider-ipc.ts:83) only changes the flag/version. No title-service shutdown participant invokes cancellation.
- **Failure:** Rename, disable and provider change allow already-running network work to continue until response/deadline. Cancel during preparation/waiting misses the popped active entry. An off→on transition can leave previously queued candidates available because cancelAll was never called.
- **Fix:** Provide a lifecycle-safe invalidation API for preparation, queued and dispatched work; invoke it on rename, clear/delete, settings changes, shutdown and authenticated DB-scope change. Seal shutdown against new enqueue; preserve the consumed-attempt rule.
- **Regression:** AbortSignal assertions at each transition and preparation await; disable→enable cannot revive old queued work. Already accepted provider work cannot be guaranteed refundable.

### B10 — P2: Detect active foreground runs, not just scheduler queue depth

- [ ] **Requirement:** FR-04; AC-06; design §6.
- **Evidence:** [aiChatWorkspaceRuntime.ts:163](../../src/service/aiChatWorkspaceRuntime.ts:163) considers only queueDepth()>0. Dispatched foreground runs move out of the queue into the scheduler's active map.
- **Failure:** An actual scheduler probe had active=1, queued=0, while the title runtime's busy expression returned false. Naming can start alongside foreground work, and the 250ms preemption poll misses a new foreground run admitted immediately.
- **Fix:** Use active/admitted foreground ownership plus queued provider demand, with dispatch-time recheck/preemption. Integrate ordinary queue-owned foreground turns too.
- **Regression:** Exercise the production shared scheduler/runtime with an already-running foreground request and a request starting mid-title; a fake isForegroundBusy callback alone does not verify the wiring.

### B11 — P2: Catch background preparation/claim errors

- [ ] **Requirement:** FR-10; AC-16; design §6.
- **Evidence:** [AIChatTitleService.ts:214](../../src/service/AIChatTitleService.ts:214) detaches pump without a rejection handler. pump has finally but no catch; the network try/catch begins only at line 366, after createModule, preparation, provider resolution and claim.
- **Failure:** A temporary probe made prepareTitleCandidate reject with “database unavailable”; process unhandledRejection received that error. A background metadata failure escapes its feature boundary even though the chat already completed.
- **Fix:** Contain all detached work and all job phases, record bounded failure metadata, clean up resources and continue the queue without changing the chat's terminal state.
- **Regression:** Inject failures at module creation, preparation, claim, provider resolution and post-claim failure persistence; assert no unhandled rejection and a subsequent job can proceed.

### B12 — P2: Measure the complete serialized input budget

- [ ] **Requirement:** FR-04; AC-06; design §7.3.
- **Evidence:** [AIChatTitlePrompt.ts:60](../../src/service/aiChatTitle/AIChatTitlePrompt.ts:60) budgets content bytes rather than the final serialized messages, omitting outer framing and another JSON escaping layer.
- **Failure:** User “Draft an outreach email ” plus 10,000 backslashes and assistant “Suggested email ” plus 10,000 backslashes produced reported bytes=2723 but JSON.stringify(messages) encoded to **4932 UTF-8 bytes**, exceeding 4096. Current tests repeat the contents-only calculation.
- **Fix:** Bound the final serialized message representation, including roles/keys/escaping/instructions, trimming on Unicode boundaries. Keep counts explicitly estimated when no supported tokenizer is wired.
- **Regression:** Assert actual serialized UTF-8 size for quotes, backslashes, control characters, CJK and emoji; independently verify the accounting result.

### B13 — P2: Reject truncated, tool-call, refusal and malformed completion envelopes

- [ ] **Requirement:** FR-04/05/10; AC-06/16; design §9.
- **Evidence:** [AIChatTitleService.ts:124](../../src/service/AIChatTitleService.ts:124) extracts only choices[0].message.content; acceptance at line 373 ignores finish_reason, tool calls and refusal metadata.
- **Failure:** A service probe supplied valid short text with finish_reason="length"; applyGeneratedTitle was called. Tool-call/content-filter/refusal responses with text can similarly pass text validation.
- **Fix:** Require an eligible final-text completion envelope and reject truncation/refusal/tool-call/malformed responses before persistence. Retain fallback with no corrective retry.
- **Regression:** Each rejected envelope with otherwise valid short content must make zero apply/broadcast calls; normal successful content must still work.

### B14 — P2: Complete deterministic generated-title rejection rules

- [ ] **Requirement:** FR-05, PRD §8; AC-07/14; design §9.
- **Evidence:** [AIChatTitleValidator.ts:38](../../src/service/aiChatTitle/AIChatTitleValidator.ts:38) has only a small subset of artifact guards.
- **Failure:** Actual validator calls accepted password=supersecret123, “Files in /Users/alice/private/report.txt”, “www.example.com campaign”, “**Sydney Dentist Outreach**”, and “Title: Leads successfully collected”. These include explicit credential/path/URL/Markdown/explanation artifacts; required deterministic completion-claim fixtures are not implemented.
- **Fix:** Reuse/align the credential/contact/path vocabulary with input sanitation, enforce the supported plain-title format and known unsupported-claim fixtures. Preserve arbitrary ordinary manual names; semantic topic accuracy still requires model evaluation.
- **Regression:** Negative output fixtures across six languages and quoted/Markdown/path variants. The [fixture test named claim rejection](../../test/vitest/utilitycode/aiChatTitleFixtures.test.ts:107) currently only checks nonempty claim strings and prompt budgets; replace that assertion gap with actual validator checks.

### B15 — P2: Version and publish every visible provisional/clear title change

- [ ] **Requirement:** FR-01/07/09; AC-01/09/10; design §10.2–10.3.
- **Evidence:** [AIChatConversation.model.ts:169](../../src/model/AIChatConversation.model.ts:169) seeds an excerpt without incrementing titleRevision. [AIChatConversationModule.ts:363](../../src/modules/AIChatConversationModule.ts:363) can replace a greeting excerpt during preparation, but publishes no corresponding title event. [ai-chat-v2-ipc.ts:1740](../../src/main-process/communication/ai-chat-v2-ipc.ts:1740) clears the title lifecycle without publishing the new null title/revision.
- **Failure:** A real Model probe changed null/revision 2 to a visible excerpt/revision 2. An in-flight bootstrap captured before seeding can therefore replace the new excerpt at the same revision. Other windows may retain cleared/greeting titles until a later bootstrap, especially when generation fails or is unavailable.
- **Fix:** Increment revisions atomically on visible seed/ownership changes and broadcast authoritative provisional/replacement/clear events after commit. Keep unrelated run/unread/activity fields unchanged.
- **Regression:** Delayed null bootstrap versus new excerpt, greeting replacement with failed/missing title model, and clear in one window observed in another.

### B16 — P1: Restore title subscriptions after teardown/remount

- [ ] **Requirement:** FR-07/10; AC-09; design §10.3.
- **Evidence:** [chatWorkspace.ts:460](../../src/views/store/chatWorkspace.ts:460) calls titleUnsubscribe but clears summaryUnsubscribe instead of titleUnsubscribe.
- **Failure:** bootstrap → teardown → bootstrap leaves a truthy obsolete title unsubscribe handle. The subscription setup skips reinstalling the listener; subsequent title changes stop arriving live. A temporary store test reproduced this.
- **Fix:** Dispose and null each handle independently and make repeated teardown/setup safe.
- **Regression:** Remount/authentication transition followed by generated and manual title events updates header/sidebar/search exactly once.

### B17 — P1: Buffer title events during initial bootstrap

- [ ] **Requirement:** FR-07/10; AC-09; design §10.3.
- **Evidence:** [chatWorkspace.ts:149](../../src/views/store/chatWorkspace.ts:149) subscribes before requesting bootstrap, but [applyTitleUpdate](../../src/views/store/chatWorkspace.ts:275) discards an event for any locally unknown ID.
- **Failure:** Initial server snapshot at revision 1 → revision 2 event before response installation → event dropped because the local index is empty → old bootstrap installs revision 1. A barrier-controlled store probe reproduced the lost update.
- **Fix:** Buffer/reconcile events during bootstrap, applying only to conversations confirmed by normal discovery and preserving deletion/scope ordering. Merely moving subscription earlier is insufficient.
- **Regression:** Newer event before initial response, concurrent bootstrap responses, and deleted/unknown IDs without resurrecting rows.

### B18 — P2: Reject stale unversioned titles and make equal revisions idempotent

- [ ] **Requirement:** FR-07; AC-09/11; design §10.3.
- **Evidence:** [chatWorkspace.ts:218](../../src/views/store/chatWorkspace.ts:218) allows an unversioned title whenever existing.title is empty, even after a positive revision. Summary/title-event application at lines 221 and 278 also permits conflicting equal-revision title replacement.
- **Reproduced failure:** Clear to empty title/revision 5 → old unversioned summary → old excerpt is restored while retaining revision 5. A temporary probe reproduced this. **Additional design gap:** conflicting equal-revision events are permitted to replace content rather than being harmless duplicates; no separate end-to-end equal-revision race was reproduced.
- **Fix:** Track whether authoritative versioned title state is known, including an empty cleared title. Accept legacy initialization only before that state exists; equal revisions must not change known title content. Continue merging unrelated summary metadata.
- **Regression:** Cleared versioned title plus legacy summary, equal/lower conflicting events, and first-ever legitimate legacy title initialization.

### B19 — P1: Prevent the title toggle from switching the active AI provider

- [ ] **Requirement:** FR-08; AC-05/11; design §8.1.
- **Evidence:** [ai_provider.vue:97](../../src/views/pages/systemsetting/ai_provider.vue:97) hydrates providerMode once. Its child [AIProviderSettingsPanel.vue:363](../../src/views/components/settings/AIProviderSettingsPanel.vue:363) saves provider changes independently. The toggle sends the parent's stale mode at line 108, and [ai-provider-ipc.ts:103](../../src/main-process/communication/ai-provider-ipc.ts:103) applies that mode.
- **Failure:** Load page in hosted mode → save custom mode in the child form → toggle automatic titles → provider silently switches back to hosted. The reverse transition has the same stale-state problem.
- **Fix:** Make a toggle-only mutation preserve the authoritative current mode, or use shared synchronized settings state. Keep model/provider changes explicit and refresh the explanatory hint.
- **Regression:** Mount the whole settings page, change/save provider then toggle both ways; assert mode, endpoint, model and credentials remain the selected provider's.

### B20 — Contract check: Clarify carried title-model selection on identity changes

- [ ] **Requirement:** FR-08; AC-05; design §8.1.
- **Evidence:** [AIProviderSettingsPanel.vue:259](../../src/views/components/settings/AIProviderSettingsPanel.vue:259) always sends the loaded titleModel explicitly. Endpoint/preset changes clear test state but do not clear that field; preset handling starts at line 275.
- **Ambiguity, not a confirmed bug:** The backend clears an omitted model when identity changes, as designed. The design also explicitly permits a model supplied in the same save. The UI always supplies its visible field, so it satisfies that literal exception even when the user has not touched the carried value. No additional unintended provider request was reproduced for this item.
- **Decision/check:** Confirm whether saving the unchanged visible field is intended to count as explicit selection for the new endpoint. If yes, close this item with a test documenting that behavior. If fresh selection is required, clear on normalized endpoint/preset change or track post-change reselection.
- **Regression:** Cover identity-change save with untouched/cleared/reselected title-model fields and equivalent normalized URL edits; assert the agreed contract.

### B21 — P2: Validate manual titles at the Module boundary

- [ ] **Requirement:** FR-06; AC-08/13; design §10.1.
- **Evidence:** [AIChatConversationModule.ts:281](../../src/modules/AIChatConversationModule.ts:281) and [applyManualRename](../../src/modules/AIChatConversationModule.ts:292) skip shared validation. [AIChatConversation.model.ts:213](../../src/model/AIChatConversation.model.ts:213) silently slices input to 200 UTF-16 units.
- **Failure:** Non-IPC callers can store whitespace/control-containing names or silently truncate overlength names, even though renderer/schema validation rejects them.
- **Fix:** Canonicalize/validate at both IPC and Module boundaries; reject invalid/oversize names instead of clipping, preserving valid ordinary Unicode/punctuation.
- **Regression:** Direct Module calls for whitespace, newlines, controls/bidi, 200/201 UTF-16 units, astral characters and saving the current name to take ownership.

### B22 — P2: Focus and select the actual rename input; verify focus return

- [ ] **Requirement:** FR-06, PRD §7; AC-08/14; design §10.4.
- **Evidence:** [AiChatRenameDialog.vue:114](../../src/views/components/aiChatWorkspace/AiChatRenameDialog.vue:114) calls focusTarget; at line 130 it resolves a component's $el. With real VTextField this is a wrapper, while select is called only for HTMLInputElement.
- **Failure:** The custom open handler cannot select the existing name through the real wrapper. Vuetify's native autofocus may still focus the input; this finding does not claim autofocus itself always fails. The component test's root-input stub conceals the wrapper structure. Header/sidebar entry points also capture a closing menu item for focus return, which needs a real interaction check for a hidden/detached target.
- **Fix:** Use the component's forwarded input methods or its native input after dialog activation. Return focus to a stable overflow activator, preserving IME-safe Enter/Escape behavior.
- **Regression:** Realistic wrapped VTextField or real Vuetify test asserts activeElement and selection range, stable focus return, keyboard/touch actions, and Chinese/Japanese composition.

### B23 — P2: Reset title state and pending bootstrap work on authenticated scope changes

- [ ] **Requirement:** Design §10.3; PRD persistence/consistency boundaries.
- **Evidence:** [chatWorkspace.ts:460](../../src/views/store/chatWorkspace.ts:460) tears down listeners but retains conversation/title maps, selection and bootstrap state. The new title singleton has a reset hook in [aiChatWorkspaceRuntime.ts:176](../../src/service/aiChatWorkspaceRuntime.ts:176), with no production call site found.
- **Gap:** Scope changes lack the explicitly required title-state reset and a guard against a previous scope's in-flight bootstrap/job. This audit does not claim a demonstrated cross-account disclosure.
- **Fix:** Tie renderer reset/bootstrap generation and main title cancellation/reconciliation to authenticated data-scope changes without instantiating unused services during shutdown.
- **Regression:** Switch temporary authenticated DB scopes with bootstrap/title work held in flight; no old response/event/result populates the new scope.

### B24 — P2: Complete content-free operational diagnostics

- [ ] **Requirement:** PRD §10; design §12.
- **Evidence:** [AIChatTitleService.ts:81](../../src/service/AIChatTitleService.ts:81) exposes counters plus only the last reported provider usage. eligible is initialized but never incremented. buildTitleMessages budget estimates are discarded, and no duration samples/latency percentiles or per-attempt usage/claim-lost diagnostics are recorded. Abort classification at line 467 maps most invalidations to timeout.
- **Gap:** The implementation cannot demonstrate the specified success/fallback rates, latency target, estimated-versus-measured input accounting, duplicate-prevention count or meaningful cancellation reasons.
- **Fix:** Record bounded local metadata for candidate/skip/claim/dispatch/result, duration, prompt version, provider kind, attempt count and measured/estimated/unknown usage. Distinguish timeout, foreground interruption, manual/settings cancellation and stale results. Keep title usage separate from transcript usage and log no text/secrets.
- **Regression:** Assert emitted diagnostics/counters and privacy for each outcome, including unknown usage; do not invent currency estimates without provider pricing.

## Remaining verification and release tasks

### R01 — P1 release gate: Prove both pre-feature database upgrade paths

- [ ] Construct a real pre-feature SQLite schema with legacy names, user-set names, empty titles and old projection rows. Apply the registered CLI migration and, separately, the actual desktop synchronization setup.
- [ ] Verify title/ownership preservation, safe defaults, idempotent provenance repair, restart handling of running claims, and zero model requests during upgrade/reopen.
- **Evidence gap:** Existing title persistence tests initialize the current schema; seeding a current-schema legacy row does not exercise old-schema migration. Registering the migration is implemented, but this does not prove desktop release startup runs it. Use temporary DB copies only.

### R02 — P1 acceptance gate: Add the missing behavioral/integration tests

- [ ] Convert the confirmed reproductions above into committed regression tests in the same logical commits as their fixes.
- [ ] Extend coordinator/queue tests to verify both production title triggers after durable success, rejected/cancelled owners, correct trusted message IDs, duplicate notifications and nonblocking queue drainage.
- [ ] Extend E2E with a controlled delayed title response and an enabled composer/next-send assertion before releasing it; rename while the request is actually in flight; assert exact request count/model/endpoint.
- [ ] Rename an inactive grouped and unassigned sidebar row while another row is selected; cover save failure/draft retention and target capture across selection changes.
- [ ] Successfully rename an existing saved row while offline/hosted-disabled. The current disabled E2E case tests a missing row's error, not a successful offline save.
- [ ] Cover close/reopen/restart, clear/manual retention, delete during work, settings change/disable, no replay, and stored title preservation across UI locale changes.
- [ ] Verify 1,366 × 768, 200% scaling, long translated labels, keyboard/touch controls, IME and focus behavior; extend title-only invariants for unread/activity/run/count state.
- **Evidence:** [aiChatTitles.test.ts](../../test/e2e/specs/aiChatTitles.test.ts) has four cases. Its rename test waits for generation before renaming, and its automatic naming case has no held-response barrier. Passing these cannot establish the missing races.

### R03 — P1 release gate: Execute and record model quality and latency evaluation

- [ ] Run the existing 60-fixture corpus against declared supported title models/providers and retain generated outputs plus evaluation metadata in an appropriate reviewed artifact.
- [ ] Record human topic accuracy/specificity/readability scores; require at least 5/6 for a passing substantive title, 90% overall and 80% per language, correct language, and zero observed privacy/unsupported-completion failures.
- [ ] Record declared environment, actual/unknown usage and timing; verify at least 95% of successful calls within 5s and all calls bounded by the 10s client deadline, including body consumption.
- **Evidence gap:** The fixture corpus/harness exists; no scored real-output/human-review or measured latency record was found. Deterministic fixture classification is not model quality evidence. These checks require an authorized evaluation environment/provider.

### R04 — P1 release gate: Verify hosted strict routing and supported adapter limits

- [ ] Obtain integration evidence that deployed hosted "small" honors strict routing with no internal server/default fallback or hidden retries.
- [ ] For each declared supported custom adapter/model, verify the 64-token allocation uses the supported total-output parameter, body/header deadlines and cancellation work, and noncompliant/reasoning-budget-incompatible adapters are excluded.
- [ ] Exercise provider errors and debug/error serialization, inspecting serialized payloads and logs for metadata-only handling.
- **Evidence gap:** Desktop fake-provider tests cannot establish deployed server behavior or arbitrary custom-model cap compliance. Do not assume capability from model names.

### R05 — P1 release gate: Record staged enablement and rollback evidence

- [ ] Verify the internal kill switch in the actual release configuration, new-conversation-only rollout, and no dispatch before the hosted/model gates pass. The internal environment switch exists but defaults on when absent.
- [ ] Drill disable during queued/preparing/in-flight work and re-enable on a future completion, preserving saved/manual names and local rename without replay/backfill.
- [ ] Resolve P1 findings before marking acceptance complete; record remaining deliberate limitations explicitly.
- [ ] Any required packaged-delivery evidence is OPERATOR/CI-only. Local yarn package/yarn make/electron-forge packaging remains forbidden by AGENTS.md; use safe build/e2e routes locally.

### R06 — P2: Reconcile requirement/implementation documentation after fixes

- [ ] Update the PRD/design's “Proposed; implementation has not started” status and the implementation plan's unchecked tasks to accurately describe delivered, outstanding and externally verified work.
- [ ] Link passing acceptance/evaluation evidence and keep this TODO's completed items tied to fix commits. Do not mark requirements complete solely from commit subjects or passing tests that omit their failure scenarios.

## Suggested completion order

1. Fix safe source text/trusted turn association and provider identity/dispatch/replay: B01–B05.
2. Fix lifecycle atomicity, cancellation, foreground admission and error containment: B06–B11.
3. Fix budget/output validation, revisions, renderer synchronization and settings: B12–B21.
4. Complete real accessibility/scope/diagnostics behavior: B22–B24.
5. Add the required regression/integration tests while fixing each unit; then close R01–R06 with recorded evidence.

Keep commits scoped to completed logical units, include UI tests and all six translations for any changed UI text, and preserve the Model/Module/IPC database boundary.
