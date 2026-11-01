# Automatic Chat Titles — Third Audit, Grouped Defects and Completion TODO

Date: 2026-11-01

Branch: worktree-ai-chat-automatic-titles

Sources: [PRD](ai-chat-automatic-titles-prd.md), [technical design](ai-chat-automatic-titles-technical-design.md), [previous audit](ai-chat-automatic-titles-audit-todo-2026-10-31-r2.md).

## Verdict and audit boundary

**Not all requirements are correctly implemented or acceptance-complete.** Several earlier repairs are present, but remaining issues include missing completion hooks, incomplete persisted turn/provider identity, cancellation/application races, provisional-title propagation, privacy recognition, and UI request ownership.

Related defects are grouped below by root cause. Each group lists the similar paths that must be fixed together and the regression matrix required before closure. This is not a claim that static review can prove absence of every possible bug.

The main review/test baseline was commit **9aa847c6f**. Additional uncommitted edits appeared during this audit and were inspected in five implementation files and two test files:

- src/main-process/communication/ai-chat-v2-ipc.ts
- src/model/AIChatConversation.model.ts
- src/modules/AIChatConversationModule.ts
- src/service/AIChatTitleService.ts
- src/service/aiChatTitle/AIChatTitleValidator.ts
- test/vitest/main/aiChatTitleService.test.ts
- test/vitest/utilitycode/aiChatTitlePrompt.test.ts

Those edits belong to the existing worktree and are not part of this documentation change. Findings distinguish the committed baseline from pending-code regressions/partial repairs. Test results are snapshots, not a claim that every later concurrent edit has been verified.

Reviewed implementation-content SHA-256 prefixes, for identifying the pending-code snapshot:

| File | Prefix |
| --- | --- |
| ai-chat-v2-ipc.ts | 68dba5872a82 |
| AIChatConversation.model.ts | 39b6c9a0f172 |
| AIChatConversationModule.ts | 2e5719985dcf |
| AIChatTitleService.ts | e08041d3a081 |
| AIChatTitleValidator.ts | 9ca500582e5b |

P1 means a high-priority correctness/privacy/lifecycle issue; P2 means a functional or required-design gap. Reproduced service/Module probes use actual code with controlled dependencies; they are not full live-provider/Electron proofs. Static races and uncertain contract decisions are explicitly labelled.

## Verification results and observed failures

| Check | Result / limitation |
| --- | --- |
| Baseline main title/persistence/upgrade/projection/coordinator/queue/provider IPC suites | 7 files, 145 tests passed; normal TypeScript gate passed |
| Baseline utility suites, including title/provider/HTTP/i18n | 9 files, 164 tests passed; utility invocation explicitly skipped its TSC gate |
| Full component suite, first run | 177 files / 1,542 assertions passed, but process exited 1 for an unhandled window-is-not-defined rejection in ManagedBrowserSessionCard.test.ts |
| Component isolated check and full rerun | Implicated file: 21 passed; full rerun: 177 files / 1,542 tests passed, exit 0 |
| Baseline Vue type check and safe E2E build | Passed |
| Baseline title Electron E2E | 5 passed, 2 failed in launch-fixture navigation before feature assertions |
| Pending-code title service/persistence follow-up | 2 files, 73 tests passed with normal TypeScript gate, before the later additional compatibility test |
| Pending-code prompt/text/fixture follow-up | 69 passed / 1 failed: multiline generated output accepted; later test additions do not repair the raw normalization issue |
| Focus, candidate, queue, service and privacy audit probes | Reproduced the specific failure variants below |

The E2E failures were at [electronApp.ts:364](../../test/e2e/fixtures/electronApp.ts:364): page.waitForURL timed out after 60 seconds for the manual-ownership and inactive-sidebar-rename cases. These are observed test blockers, not proof that the feature assertions themselves failed.

The component rejection came from vue-i18n rendering ManagedBrowserSessionCard after the DOM environment was unavailable. It did not reproduce in the isolated file or full rerun; do not attribute it to title changes without further evidence.

No paid/live provider evaluation, developer user-database migration, or local packaging was run. The full unrelated main/utility/E2E suites were not run. Temporary evidence logs/probes under /tmp are local audit aids, not committed regression coverage.

Representative commands:

~~~sh
yarn testmain aiChatTitleService.test.ts aiChatTitlePersistence.test.ts \
  aiChatTitleSchemaUpgrade.test.ts aiChatWorkspaceProjectionBackfillRace.test.ts \
  aiChatWorkspaceCoordinator.test.ts AIChatTurnQueueService.test.ts ai-provider-ipc.test.ts
yarn test:components
yarn vue-typecheck
yarn build:e2e
xvfb-run -a yarn playwright test test/e2e/specs/aiChatTitles.test.ts
~~~

## Grouped remaining defects

### G01 — P1: Establish one authoritative persisted exchange/provenance contract

- [ ] Persist and consume the same complete identity on every supported producer: user message, assistant message, turn/run, interactive owner, durable terminal outcome, content epoch and source-provider identity.
- **Affected writers/consumers:** [AIChatQueryEngine.ts:4874](../../src/service/AIChatQueryEngine.ts:4874), cancelled/failed/catch-partial assistant saves around 5100/5200/6204; [AIChatPendingMessage.model.ts](../../src/model/AIChatPendingMessage.model.ts) user promotion; [AIChatV2Module.ts:102](../../src/modules/AIChatV2Module.ts:102) user/assistant persistence; [AIChatConversationModule.ts:378](../../src/modules/AIChatConversationModule.ts:378) candidate metadata/pairing; both completion-owner notifications.
- **Committed-code association failures:** engine terminal assistant saves omit turnId; queued promotion users also omit it. The candidate accepts missing IDs, so its “durable association” often reduces to role order. A cancelled zero-row typed request followed by a separate attachment-only request can reuse the cancelled text; steering “yes” can replace the opening task; a scheduled assistant is saved as chat-v2 even though its user is scheduled-loop; local slash-command confirmations consume the interactive eligibility window. TrustedSeen is set before successful association. Owner-level cancelled status after engine success is never consulted.
- **Pending-edit consequence:** stricter missing-ID compatibility reduces some incorrect pairings, but a normal direct user's non-null turnId now cannot pair with the engine's assistant lacking turnId. Updating the consumer alone cannot fix incomplete producers. Both writers and selection must change together.
- **Provider identity remains incomplete:** [AIChatCoordinator.ts:727](../../src/service/AIChatCoordinator.ts:727) and [AIChatTurnQueueService.ts:1024](../../src/service/AIChatTurnQueueService.ts:1024) now capture execution-time config version. However, candidate selection still chooses the earliest substantive historical exchange, whose provider identity is not persisted or returned. First exchange with provider A and naming off/missing model → switch to B → later completion with B → selection reuses A's text while the job's version belongs to B. The transport is pinned to the wrong source's identity.
- **Fix together:** select verified completed interactive exchanges by durable identity/status, preserve steering as part of its parent turn, filter scheduled/goal/subagent/local-only owners, carry provider identity for the selected exchange, and reject ambiguous associations rather than borrowing another answer.
- **Regression matrix:** direct/queued/idempotent turns; all terminal save branches; cancelled with/without partial text; cancelled by owner after engine success; attachment-only next turn; typed/attachment steering; scheduled assistant/local slash confirmations; explicit incompatible trusted assistant; earliest skipped exchange under a different provider. Inspect actual production-persisted metadata, not only hand-built test metadata.
- **Requirements:** FR-02/03/08, AC-03/05/11/15; design §6–8.

### G02 — P1: Trigger naming from every successful durable terminal path

- [ ] Route all successful completed interactive owners through one idempotent post-persistence notification.
- **Affected paths:** normal queue drain invokes the callback at [AIChatTurnQueueService.ts:1298](../../src/service/AIChatTurnQueueService.ts:1298), but [settleParkedRunContinuation](../../src/service/AIChatTurnQueueService.ts:483) and [notifyExternalTurnTerminal](../../src/service/AIChatTurnQueueService.ts:832) finish resumed permission/plan turns without it. Production engine terminal wiring reaches this settlement path.
- **Reproduced:** a parked run's completed notification durably commits, flushes the terminal and projects the result, then deletes the parked identity with **zero title notifications**.
- **Fix:** retain source-provider and message/run identity in parked state and invoke the common successful-terminal hook after committed completion. Do not add the trigger to generic terminal hooks that also run for cancelled/failed/permission-only outcomes.
- **Regression matrix:** immediate completion, permission resume, plan-answer resume, repeated external notification, failed terminal persistence, cancel/deny, provider change while parked, and next queued message drainage. Assert exactly one eligible dispatch.
- **Requirements:** FR-02, AC-01/03/15/16; design §6.

### G03 — P2: Bound relevant exchanges and selected text, not a larger arbitrary transcript prefix

- [ ] Replace the first-40-then-200-row workaround with a bounded query of relevant verified exchanges and direct trusted-ID validation.
- **Evidence:** [AIChatConversationModule.ts:354](../../src/modules/AIChatConversationModule.ts:354) loads up to 200 generic rows, including tools, and only filters later. A first substantive answer after 201 tool rows reproduces not_ready. Every later notification repeats the same prefix.
- **Impact:** increasing the cutoff merely moves the failure; it can still miss the first three valid exchanges and unnecessarily materialize tool contents.
- **Fix/regression matrix:** query the first three completed interactive exchanges using G01's durable metadata; bound text at selection. Test first/third exchange behind hundreds of tool/scheduled rows, very large tool bodies, and a much later notification. Avoid an unbounded history scan.
- **Requirements:** FR-02/04, AC-02/06/15; design §7.1–7.3.

### G04 — P1: Use a single cancellation/policy fence across every asynchronous phase

- [ ] Make cancellation, disposal, foreground priority, deadline/queue expiry and settings invalidation authoritative immediately before dispatch and in the final commit decision.
- **Affected phases:** [AIChatTitleService.ts:384](../../src/service/AIChatTitleService.ts:384) foreground wait; awaited preparation/claim; transport controller around 506; post-response guard around 607; policyCheck passed to applyGeneratedTitle around 645; Module connection wait and Model update.
- **Reproduced phase matrix:**

| Interleaving | Current observed result |
| --- | --- |
| Cancel while provider response is held; response arrives despite abort | Transport signal aborted, but result applied |
| Foreground preemption aborts naming; held response is released | Transport signal aborted, but result applied |
| Cancel while delegated apply is suspended | Result applied; policy callback ignores cancellation |
| Foreground starts during preparation | One title dispatch still occurs |
| Preparation lasts beyond the 60-second queue TTL | Expired unclaimed entry still dispatches |

- **Root cause:** active cancellation switches to the transport controller, while the late guard reads the preparation signal; linking is one-way. The final policy callback checks only settings epoch. Foreground/expiry checks are not repeated after awaited preparation.
- **Fix together:** pass one monotonic linked cancellation/lifecycle generation through the whole job; include it, disposed state, source epoch/provider policy and deadline in the synchronous commit guard. Recheck eligibility after each suspension. Route API-key clear and direct settings mutations through the same invalidation mechanism; the settings-save IPC's cancelAll alone does not cover every settings entry point.
- **Evidence limit:** the late-response probes intentionally use a completion dependency that returns after abort. They prove service-side result acceptance, not that every fetch implementation ignores abort. DB ownership CAS still protects committed manual names; this finding does not claim that it is bypassed.
- **Regression matrix:** each phase × rename/clear/delete/settings/key clear/off→on/foreground/deadline/dispose/scope switch/shutdown; include noncooperative completion and cancellation during final apply.
- **Requirements:** FR-04/07–10, AC-06/09/11/16; design §5.4/6/8.5.

### G05 — P1: Own destructive lifecycle fencing and readiness in the Module/admission layer

- [ ] Fence old title work before destructive history operations and serialize clear/delete with new-run admission.
- **Affected paths:** [ai-chat-v2-ipc.ts:1746](../../src/main-process/communication/ai-chat-v2-ipc.ts:1746) single clear deletes messages before title reset/cancel; bulk clear around 1799 does the full transcript deletion before per-conversation title lifecycle work; direct [AIChatV2Module.ts:389](../../src/modules/AIChatV2Module.ts:389) clearConversation and clearAllV2History callers bypass the IPC-only title policy.
- **Failure windows:** crash/reset failure after transcript deletion leaves the old title/claim/epoch beside empty history. Single-clear lifecycle errors are swallowed and success is returned; bulk reports partial failure but is already destructive. Pending provenance-event guards do not change this order.
- **Related admission race, static/unverified:** clear/delete's busy check is separated from deletion by awaits and no held lifecycle/admission lock. A new send can be admitted after the check; later projection upsert can recreate a deleted row. The Model's no-upsert generated-title writer alone does not fence other projection writers.
- **Related readiness race, static:** startup title reconciliation is controlled by a mutable global flag/reset. Concurrent first bootstraps can both enter readiness, and retryable readiness can run after a current title claim exists; reconcileInterruptedTitleClaims fails all running claims without process ownership. Scope-reset readiness must not invalidate live work or be completed by an older scope.
- **Fix together:** Module-owned coordinated clear/delete with a lifecycle epoch/tombstone/admission fence before deletion; explicit partial-failure semantics; bounded bulk policy preserving manual names; per-scope single-flight readiness before admitting title work.
- **Regression matrix:** all direct/IPC single/bulk callers; old result at every deletion await; reset/delete failure; send admitted at busy-check boundary; duplicate bootstraps; scope reset with readiness held; readiness retry while a current process owns a claim.
- **Requirements:** FR-07/09/10, AC-09/11/12; design §5.4/6/11.

### G06 — P2: Publish and initialize every authoritative provisional title

- [ ] Treat first authoritative title state separately from an equal-revision duplicate, and emit committed seed/replacement/clear metadata from every producer.
- **Affected paths:** [AIChatConversation.model.ts:83](../../src/model/AIChatConversation.model.ts:83) creates a visible excerpt at revision 0; [chatWorkspace.ts:266](../../src/views/store/chatWorkspace.ts:266) and applyTitleUpdate around 345 reject the first revision-0 title against a local placeholder 0. The version-known set can then prevent legacy initialization too.
- **Missing queue path:** [broadcastQueueSummary](../../src/main-process/communication/ai-chat-v2-ipc.ts:670) carries no title/revision. [AIChatConversationModule.ts:633](../../src/modules/AIChatConversationModule.ts:633) discards the returned seeded projection without publishing. The title service only emits when excerptRefreshed; an unchanged first excerpt is not emitted, and off/unavailable exits earlier.
- **Result:** first sends can remain New chat in header/sidebar with naming disabled, a missing title model or queue-owned execution, despite a saved excerpt. A later bootstrap can repair the display, but FR-01 requires immediate propagation.
- **Fix/regression matrix:** use an explicit authoritative-initialization state or consistent initial revision policy, plus seed events after commit. Test revision 0 on unknown/local-placeholder rows; direct/queued first send; off/missing model/provider error; greeting replacement; post-clear reseed; stale/equal events after initialization. Preserve run/unread/activity metadata.
- **Requirements:** FR-01/07/10, AC-01/09/10; design §10.2–10.3.

### G07 — P1: Share one bounded privacy grammar across excerpts, both prompt fields and generated output

- [ ] Fix all ordinary credential/path recognition variants together, rather than adding a root/quote spelling per audit.
- **Affected callers:** [AIChatTitleText.ts:29](../../src/service/aiChatTitle/AIChatTitleText.ts:29) sanitation; live/post-clear Model excerpts; candidate replacement and user/assistant request text; [AIChatTitleValidator.ts:20](../../src/service/aiChatTitle/AIChatTitleValidator.ts:20) output guards.

| Family | Reproduced examples / current result |
| --- | --- |
| Quoted multiword credentials | password="hunter two" becomes [redacted] two"; api_key='secret token value' retains token value |
| Structured or spaced labels | JSON quoted password key/value and API key: secretToken evade recognition |
| Localized credentials | Quoted assignments in English, Chinese, Spanish, French, German and Japanese retain value suffixes |
| Input/output detector mismatch | Bearer huntertwo is sanitized on input but accepted as generated output |
| POSIX absolute paths | /workspace, /projects, /src, /app and root-level /customer-secrets.csv survive the finite root list |
| Windows syntax | C:/Projects/client-secrets.csv and UNC server/share paths survive |
| Quoted filenames with spaces | /home/alice/My Secrets.csv is only partly removed, retaining filename text |

- **Fix:** centralize bounded detection/redaction with complete quoted-value handling, common structured keys/labels and platform absolute-path syntax. Use the same detectors for output rejection. Do not transmit raw failures in diagnostics.
- **Regression matrix:** all six languages × quote/JSON/colon/equal/space forms; authorization/bearer values; drive slash/backslash/UNC/POSIX roots; brackets/backticks/quotes/spaces; both request fields, provisional excerpts and saved output. Include legitimate slash/topic punctuation negatives.
- **Limit:** this closes demonstrated obvious-artifact gaps. It does not promise perfect recognition of arbitrary secrets or de-identification of user text.
- **Requirements:** FR-01/05, PRD §8, AC-14; design §7.2/9.

### G08 — P2: Validate raw output structure before normalization and use complete lexical boundaries

- [ ] Separate raw response-format rejection, safe whitespace canonicalization, actual secret shapes and unsupported-action claim detection.
- **Still reproduced in pending code:** final sk- substring guard rejects Task-Based Outreach, Risk-Based Lead Scoring, Mask-Based Segmentation and Desk-Research Strategy. These are ordinary topics, not credentials.
- **Pending-code regression:** [AIChatTitleValidator.ts:53](../../src/service/aiChatTitle/AIChatTitleValidator.ts:53) normalizes whitespace before checking for newlines. “Sydney Dentist Outreach” followed by a newline and “Extra explanation” is accepted as one title. The existing malformed-output test fails. Check one-line/control/format rules on raw trimmed output before losing the evidence.
- **Partly repaired during audit:** committed French/German patterns rejected Collect Leads, Collecting, Envoy and unfinished-task topics; pending patterns add boundaries and fix those examples. Retain a multilingual matrix rather than reopening already-repaired examples as current bugs. Include genuine singular accented completion claims as well as harmless words.
- **Compatibility decision:** pending service code accepts absent/null finish_reason and adds a local-server compatibility test. That changes the earlier clean-terminal envelope policy. Document eligible adapter behavior and prove truncation/refusal/tool-call/malformed handling; do not silently treat unknown terminal status as measured successful completion capability.
- **Regression matrix:** benign credential/claim substrings across all languages; genuine supported completion claims; multiline explanations; tabs/controls/bidi; empty/refusal/truncated/tool-call outputs; supported adapter envelopes. Keep manual-name rules independent.
- **Requirements:** FR-04/05/10, AC-06/07/16; design §9.

### G09 — P2: Give all UI async completions target/scope/lifetime ownership

- [ ] Apply the bootstrap-generation principle to rename and settings hydration/save callbacks as well.
- **Rename:** [conversationRename.ts:41](../../src/views/composables/conversationRename.ts:41) applies a response, closes dialog state and restores focus without checking current authenticated scope, component lifetime or target generation. A probe resolves an old-scope rename into a new-scope row with the same conversation ID; a prior save can also close replacement dialog state.
- **Settings:** [ai_provider.vue:100](../../src/views/pages/systemsetting/ai_provider.vue:100) applies every hydration GET independently of save responses. Reproduced ordering: initial GET captures ON → OFF save succeeds → old GET resolves → switch displays ON while persistence remains OFF.
- **Fix/regression matrix:** generation/abort ownership for success, failure, finally and focus; reset/unmount/change target while rename is pending; delayed initial/settings-change GET after toggle; overlapping saves/hydration and provider changes. A same-ID cross-scope probe is not a claim that production conversation IDs routinely collide.
- **Requirements:** FR-06/07/08/10, AC-08/09/11/14; design §10.3–10.4.

### G10 — P2: Capture stable rename activators during setup and restore after actual deactivation

- [ ] Fix both header/sidebar return-focus paths and the shared composable timing.
- **Affected paths:** [AiChatCenterSurface.vue:3047](../../src/views/components/aiChatWorkspace/AiChatCenterSurface.vue:3047) calls getCurrentInstance inside a DOM handler, where it is null; [conversationRename.ts:76](../../src/views/composables/conversationRename.ts:76) restores synchronously while Vuetify's dialog focus trap remains active.
- **Reproduced with real VDialog:** even a connected stable opener does not regain focus immediately or after ticks when Cancel calls the shared synchronous close handler. Inner-input selection fixes do not establish return-focus correctness.
- **Fix/regression matrix:** capture the component/ref during setup, pass a stable header/row overflow control, and restore after dialog deactivation. Test real Vuetify Save/Cancel/Escape, header/sidebar/inactive-row entry, IME and selection/scope changes.
- **Requirements:** FR-06, PRD §7, AC-08/14; design §10.4.

### G11 — P2: Finalize diagnostics once per attempt on every outcome

- [ ] Centralize per-attempt outcome/usage recording, counter increments and cleanup in one finalization path.
- **Committed baseline:** invalid envelope/success/stale record attempts; null text, invalid/empty titles, transport errors, cancellation, settings changes and disable branches omit records.
- **Pending partial repair:** invalid/null/empty text now records more outcomes, but early invalidation and transport-error branches still do not. [AIChatTitleService.ts:692](../../src/service/AIChatTitleService.ts:692) now tests whether the global failedByCode bucket exists before incrementing, suppressing subsequent failures of that class rather than deduplicating a single attempt.
- **Fix:** use a per-attempt finalized/outcome flag, capture measured usage for every returned response, represent absent usage as unknown, and count each distinct attempt exactly once. Keep bounded local metadata, not prompts/titles or external analytics.
- **Regression matrix:** repeated same-code failures; failures while persisting failure metadata; every early-return/error/abort branch; known usage followed by absent usage; invalid charged response. Assert records and aggregate counters agree.
- **Requirements:** PRD §10, design §12; AC-06/16.

## Acceptance and completion matrix

| Requirement / acceptance criteria | Status and remaining groups |
| --- | --- |
| FR-01; AC-01 | Partial: provisional publication/initialization and privacy, G06–G07 |
| FR-02; AC-02/03/15 | Partial: authoritative exchanges, all terminal hooks and relevant-window query, G01–G03 |
| FR-03; AC-04/05 | Pinned strict desktop transport improved; selected-exchange provider identity still incomplete, G01; deployed strict route remains R02 |
| FR-04; AC-06 | Hard serialized cap repaired in baseline tests; cancellation, foreground/TTL revalidation and diagnostic completeness remain G04/G11 |
| FR-05; AC-07 | Partial: privacy/format/lexical checks and scored quality, G07–G08 and R02 |
| FR-06; AC-08/13 | Shared/local rename and offline saved-row E2E exist; async ownership/focus and reliable acceptance evidence remain G09–G10/R01 |
| FR-07; AC-09/10 | Narrow writes/revision guards exist; lifecycle fencing, initial title propagation and async ownership remain G04–G06/G09 |
| FR-08; AC-11 | Toggle mode isolation improved; source identity/cancellation and hydration ordering remain G01/G04/G09 |
| FR-09; AC-11/12 | CLI and desktop old-schema tests now exist; destructive ordering, admission and readiness guarantees remain G05 |
| FR-10; AC-16 | Ordinary transport failures retain fallback; all outcome/late-result handling and raw validation still incomplete, G04/G08/G11 |
| PRD §7/8; AC-14 | All six key sets and basic controls exist; privacy, async scope and real focus gaps remain G07/G09/G10 |
| PRD §10–12 | Model/deployment/rollout evidence remains incomplete, R01–R04 |

## Remaining test, release and documentation tasks

### R01 — P1 acceptance gate: Fix observed test blockers and add complete cross-path matrices

- [ ] Investigate the two launch-fixture timeouts at electronApp.ts:364; retain failed traces/screenshots and rerun the affected cases after stabilizing readiness. Do not report these as successful title acceptance cases.
- [ ] Investigate the intermittent component DOM-environment rejection. Record the initial exit-1 run, isolated pass and full rerun, rather than silently replacing evidence with the rerun.
- [ ] Repair the pending multiline-output regression without weakening the PRD's raw-format assertions. Re-run changed tests after all concurrent edits settle.
- [ ] Commit G01–G11 regression matrices with fixes, covering actual persistence/producer/transport/renderer wiring rather than only symmetric fake rows or fake isForegroundBusy state.
- [ ] Add controlled delayed naming with a usable composer/next send; genuine rename-during-flight; exact request model/endpoint/count; actual Electron process restart; queue/permission/plan continuations and settings/scope/clear interleavings.
- [ ] Verify 1366×768, 200% scaling, touch, long translated labels, IME and real focus return. The seven current E2E cases do not establish all of these.

### R02 — Release gate: Record multilingual model quality, latency and provider capability

- [ ] Execute the existing 60 fixtures against declared supported title models; retain outputs and human topic/specificity/readability scores. Require PRD thresholds: 5/6 per passing substantive case, 90% overall, 80% per language, correct language and no observed privacy/unsupported-completion leaks.
- [ ] Extend fixtures with all grouped privacy/lexical cases above, mixed-language ties and UI-locale tie-breaking; the title job/prompt currently carries no locale hint.
- [ ] Record environment and measured/estimated/unknown usage, 95%-within-5s latency and the 10s body-inclusive deadline.
- [ ] Verify deployed hosted strict small-model/no-default-fallback behavior and each supported custom adapter's 64-token output allocation/reasoning compatibility. Desktop mocks cannot prove server-side routing or arbitrary adapter compliance.

### R03 — Release gate: Run staged enablement/rollback and packaged checks in the proper environment

- [ ] Validate the internal release flag before enabling production naming; new conversations only, no history backfill/replay.
- [ ] Drill disable/re-enable, provider/key changes, shutdown and authenticated scope changes at every G04 phase; retain saved/manual names and offline rename.
- [ ] Run any required packaged checks through OPERATOR/CI. Local yarn package, yarn make and electron-forge packaging remain forbidden; use safe build/build:e2e locally.

### R04 — P2: Reconcile documentation and ownership of in-progress changes

- [ ] Replace broad “all B/F findings fixed, only operator gates remain” claims with precise code/test/evidence status.
- [ ] Update the technical design's still-Proposed/nonexistent-new-files header while preserving the intended acceptance contracts.
- [ ] Link each grouped fix to actual commits and completed regression matrices. Preserve historical reports as snapshots; do not leave unchecked old failure details indistinguishable from current status.
- [ ] Document pending compatibility decisions, especially absent terminal markers and title-model carryforward explicitly supplied with an identity-changing save. The latter remains a contract interpretation, not a demonstrated defect.
- [ ] Re-audit the final settled worktree, including pending test changes, before declaring completion. This report does not stage or incorporate anyone else's implementation edits.

## Suggested fix units

1. **Durable turn contract:** G01–G03 together, including every terminal writer and resumed owner.
2. **Lifecycle state machine:** G04–G05 together, including commit/admission/readiness fences.
3. **Title data contract:** G06–G08 together, including all publication/privacy/output consumers.
4. **UI lifetime/accessibility:** G09–G10 together across both rename entry points and settings.
5. **Evidence/finalization:** G11 and R01–R04, with no premature blanket completion claims.

Follow AGENTS.md: Models/Modules own DB operations; UI changes include matching UI tests and all six translations where text changes; commit completed logical units; never package locally.
