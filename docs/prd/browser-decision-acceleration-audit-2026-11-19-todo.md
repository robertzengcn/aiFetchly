# Browser decision acceleration audit and TODO — November 19

Reviewed the clean `feature/browser-decision-acceleration` worktree at `d20ac50f9cf5ed1927bef668929daceac648666e` in `E:/project/aiFetchly-bda`. The [PRD](browser-decision-acceleration-prd.md), [technical design](browser-decision-acceleration-technical-design.md) and [November 18 audit](browser-decision-acceleration-audit-2026-11-18-todo.md) define the scope and previous findings.

**Implementation is still incomplete.** The continuation adds capability discovery, resume identity evidence and transcript notes, and bounds on some batch output fields. The updated A-FR-12 explicitly defers registration from v1. The previous fixes for explicit completion criteria, scoped cleanup, focus wiring and credential-aware redaction are present. The paths below still have defects or missing behavior.

## Checks on the reviewed revision

| Check | Result |
| --- | --- |
| Focused main-process suites with the TypeScript precheck | **692 passed across 56 files**. Covered decision, login, parallel agents, managed browser, agent permissions, opt-in and proxy checks. |
| Full component suite | **1,625 passed across 184 files**. |
| Managed browser utility suite | **162 passed across 7 files**. |
| Extra boundary checks using production service and runner code with controlled collaborators | **All three reproduced defects**. A decision dispatched after a provider revision change, an excluded scroll operation dispatched, and filtering a prior SELECT option bound the wrong expected value. |
| Electron acceptance | Six feature tests are still marked `fixme`. The earlier notes record CI run 44383359610 at `cb40906c1`. The current app E2E, native-window and bundled-browser behavior were reviewed in source. |
| Local Forge packaging | Environment-blocked under AGENTS.md. Packaged delivery evidence belongs to operator/CI. |

Local logs in `%TEMP%` are `bda-nov19-main.log`, `bda-nov19-components.log`, `bda-nov19-utility.log` and `bda-nov19-boundaries.log`. The two temporary test sources are in `%TEMP%/bda-nov19-runner-boundaries.test.ts` and `bda-nov19-provider-boundary.test.ts`. They were removed from the worktree. The three Vitest reproductions use synthetic pages and mock provider/worker transport. Supplementary in-memory probes are identified in the applicable findings. The remaining items include source evidence and closure tests.

## Defects and related cases

### A01 — P0 — provider changes no longer invalidate the production decision clients

- [ ] Pass the live epoch getter to hosted, chat and native clients. Freeze only the admitted snapshot. Bind the endpoint, model and credential to that snapshot and recheck it at dispatch.

`src/service/ManagedBrowserAiToolService.ts:1527–1529,1578–1580,1664–1686` passes a callback that returns the captured admission epoch and freezes the client to the same value. The clients compare the callback to their frozen value, so their change checks cannot observe a newer epoch. The chat transport still resolves current settings through `AiChatApi.ts:2330`. A later request can therefore use a different route and a stale reply can still authorize input. A synthetic production-entry-point test advanced the live revision during the first decision request and observed one browser action dispatch.

Use the same snapshot and abort rules for capability discovery, planner, primary decision, recovery, helper and verifier calls. Cover provider mode, endpoint, key, model and feature toggles before the call, in flight, during backoff and between inference and worker dispatch. Retain the exact native URL and redirect refusal already landed. D-FR-01–04/09, D-AC-01/07/11/12, design §§5/9/12.

### A02 — P1 — advertised capabilities constrain the prompt while several actions bypass the check

- [ ] Validate every decided operation and its fields before branching into action execution or terminal verification. Bound capability discovery and use advertised limits when packing and scheduling work.

`BrowserTaskRunner.ts:339–352,1424–1429` filters the top-level offer when the client supplies a nonempty list. Its operation validation at line 1109 comes after DONE, SIGN_IN, ESCALATE, WAIT and the untargeted worker operations. Reproduced with capabilities that offered CLICK and DONE. The runner still sent a SCROLL_UP action to the worker seam. Candidate-local operations can still be built from the wider default set. A false advertisement, empty list or probe failure currently becomes an all-operations fallback. Distinguish explicit unsupported capability from a compatible legacy client whose list is absent.

The runner also ignores `maxCandidates` and deadline ceilings and performs another capability request for hosted admission without the normal decision deadline. An in-memory runner probe reported a 20 ms ceiling and the runner passed a 10,000 ms deadline to the decision client. Wire the configured request timeout where it applies. Bound the merged planner and caller criteria and normalize resume subgoals before serialized input validation. `BrowserTaskRunner.ts:396–403,450–460,520–555,1413–1415` can send up to 16 total criteria against a maximum of 8 or a subgoal wider than the 1,000-character contract. Test unsupported operations for targeted and untargeted branches, empty/old contracts, a slow probe, composed legal inputs, provider-specific candidate and payload limits, and valid fallback. D-FR-04/14/16–19, D-AC-04/08/11, design §§5/8–10/12.

### A03 — P1 — filtered SELECT options bind the wrong live value

- [ ] Store or resolve the exact expected value by the observed option token. Handle missing bindings before dispatch and keep sensitive identity in worker-owned state.

`BrowserObservationService.ts:364–390` filters credential-bearing options and then compacts labels and values while preserving original IDs such as `o_1` and `o_2`. That is the correct ID for the native option index. `BrowserTaskRunner.ts:1738–1752` then uses the number from the ID as an index into the compact values. Reproduced on a synthetic three-option list with the first removed. Selecting the first remaining option sent the next option's expected value. A later surviving ID can resolve past the end, omitting the expected value and weakening live stale-check coverage.

Test an omitted option at the first/middle/last position, smallest and largest accepted value, blank value, duplicate labels, reordered/changed DOM and malformed identities through observation, runner and worker. Route exact option checks through the trusted lookup without sending secrets to the model or renderer. D-FR-12/15–17, D-AC-04, design §§7–8.

### A04 — P0 — credential redaction still misses observation paths

- [ ] Apply exact-value containment to every worker output field and representation. Keep navigation provenance and other exact browser identities behind trusted IDs when publication would reveal a credential.
- [ ] Add end-to-end synthetic credential coverage across worker wire messages, renderer/model observations, tool results, notices, transcripts and logs.

N07 now registers short credentials, filters exact matches from options and redacts role/link text. `ResultSanitizer.summarizeInputValue` at lines 227–244 still uses only shape heuristics, and `BrowserObservationService.ts:391–394` uses it for ordinary controls. A value echoed into another nonsensitive input is therefore outside the trusted-value pass. The reported page URL retains its pathname via `NavigationPolicy.sanitizeUrlForReport` and raw origins still travel through `BrowserObservationService.ts:351,528–549`. Structured extraction redacts values while leaving object property names unchanged. Several text paths apply a length limit before the exact-value pass, so cutting through a known value can prevent a match. A long-lived page also needs an explicit rule for the eight-value FIFO and transformed values such as URL encoding.

Apply the same rules to login recipes. Raw field names and form metadata originate in `LoginFormFiller.ts:200–201,687–692,813–820`, move through `WorkerSession.ts:879–886` and can be stored through `BrowserCredentialLoginService.ts:908–924` and `BrowserSiteModule.ts:470–481`. Keep recipes limited to safe structural identity and enforce containment before worker emission and persistence.

Use synthetic values with ordinary shapes, all allowed lengths, repeated fills, URL/field/structured output normalization and teardown. Preserve the current credential field masking and rejected sensitive option behavior. A-FR-06/08/15, A-AC-01, D-FR-12, design §§7/13–14.

### A05 — P0 — browser and task controls can still disagree

- [ ] Use one verified task-to-session resolver for Pause, Take control, Resume and Stop. A successful reply must describe the worker and control states that actually changed.
- [ ] Carry the actual session ID into the batch row and bind session-card controls to the task gate.

In `managed-browser-ipc.ts:251–320`, Pause/Take control trusts a supplied task ID and can act on the browser before learning the task does not exist or cannot change state. Resume and Stop have added pair checks, but task-only Pause/Resume skip the worker operation. `ManagedBrowserModule.pauseSession` around lines 2338–2349 swallows failures from both PAUSE_REQUEST and handoff initiation. The IPC can report success and close the gate even when the browser did not enter user control. In `resumeAfterHandoff:1625–1650`, a worker `HANDOFF_REQUIRED` reply resolves the request and is treated as success by the caller. A handler that only checks for a throw can reopen the gate while the worker is still waiting.

`BrowserBatchEvent` and the row update in `BrowserControlCards.vue:348–369` omit the session ID. The renderer therefore uses the task-only branch in a normal batch. The control handlers around lines 455–475 do not present returned failure reasons. The session card's separate Pause AI, Take over and dialog Resume actions use session RPCs, leaving another path that can miss the task gate and resume instructions. Unknown task-only Stop and unknown batch Return Now can report success at `managed-browser-ipc.ts:428–469`. Resume writes instructions after attempting the worker transition, before confirming all task-control preconditions. The service also accepts Resume for running or cancelling states at `AgentTaskControlService.ts:309–319`.

Test both cards and every input shape, task/session mismatch, terminal task, worker failure, continued login challenge, active multi-step action and a second sibling session. Assert browser state, task gate, visible result and ownership even when one operation fails. D-FR-08/09, M-FR-07/08, C-FR-01–08/12/16.

Apply the running-child mutation guard to parent `requestHandoff`, `signIn` and relevant account cache actions in `ManagedBrowserAiToolService.ts:1180,2137,2274`. Route prompts for a hidden child to the root chat while retaining child ownership and including the task label. The sign-in/pass-picker/site-confirm paths currently use the child conversation (`ManagedBrowserAiToolService.ts:2157–2161`, `BrowserCredentialLoginService.ts:403,484,677,834`) and the renderer filters them by active conversation. Use the root routing already present for page notices. Automatic challenge and manual sign-in fallbacks can start a handoff and return immediately (`ManagedBrowserAiToolService.ts:427–440,907–922`, `BrowserCredentialLoginService.ts:449–452,528–532,722–726,1026–1033)). Route owned batch lanes through the blocking coordinator and publish waiting/paused events to the batch controls. C-FR-02, M-FR-07/08.

### A06 — P1 — resume and completion checks still use stale or advisory evidence

- [ ] Before reopening work, get a fresh observation and enforce HTTPS, the session's allowed sites and the same signed-in account where required. Apply the user's instructions to the next active model round as well as storing them in the transcript.
- [ ] Revalidate pause generation, lease, provider revision and both local and task deadlines after each awaited verification or recovery phase.

`BrowserTaskRunner.ts:418–518` refreshes only if the cached observation is null. The continuation checks a registry match only in a same-site branch and records site drift/unregistered or signed-out findings as evidence or subgoal text. It does not block work. `ManagedBrowserAiToolService.ts:1728` takes `authenticated` from session status. A cached boolean cannot prove the same account currently controls the page. `AgentRuntime.ts:671–689` writes the resume note and instructions to the persisted transcript after the wait, while the in-memory query messages used for the next inference are separate.

After DONE's fresh observation at `BrowserTaskRunner.ts:686–718`, the runner checks current pause state but can miss Pause→Resume during that await. The semantic verifier timer at lines 744–793 aborts a child signal. A callback that ignores it can still return a positive verdict while the enclosing budget remains. In-memory runner probes reproduced both completion races. The no-criteria URL-change fallback can certify an unrelated navigation. Pending recovery proposals are also stored separately from the snapshot and resume generation that produced them. A runner probe dispatched a stale recovery action after Pause→Resume. Cover those sibling awaits together.

Test Stop, Pause and Pause→Resume before a held response settles, new tab/site/account, failed auth recheck, local verifier timeout with a late reply, and independently verified completion. Include planner/helper/recovery results and ensure already finished effects are recorded without replay. D-FR-09/22–26, D-AC-07/09, C-FR-05–08/13, design §§11–12/18.

### A07 — P1 — child cleanup and keep-open still lack terminal lease consistency

- [ ] Keep the session record and lease owner in sync through transfer. Require an authoritative retained ID and close every other session owned by the completed or failed child.
- [ ] Propagate partial stop failures into the batch result and enforce bounded cleanup on all early returns.

The previous refused-transfer ID exposure and broad child-triggered conversation cleanup are fixed. `ManagedBrowserModule.transferSessionToConversation:1090–1100` now changes record ownership, while the lease retains separate owner fields in `ManagedBrowserLeaseService.ts:27–34,80–109`. Account reuse and ownership must use the transferred identity consistently. In `runBrowserTasksTool.ts:758–829`, a successful keep-open result with no ID or a thrown transfer can skip cleanup. A non-keep-open result with a valid reported ID may close just that session. `stopAllForAgentTask` now returns `failedSessionIds`, which its caller does not inspect before reporting release evidence. The conversation-clear handler at `ai-chat-v2-ipc.ts:1708–1742` has no session cleanup caller for browsers already transferred to the cleared conversation. Cover the combined clear and shutdown paths too.

Test normal, missing, invalid and valid keep-open results, lease reuse by the parent, launch/transfer rejected after work, multiple child sessions, child retry and partial stop failure. Verify no sibling or parent session is closed by the wrong lane. M-FR-02/06–09, M-AC-01/02, design §17.

### A08 — P1 — batch confirmation still has an abort gap and no scoped grant

- [ ] Recheck abort and ownership after preview lookup and before publishing the card. Connect confirmation to a revocable permission grant scoped by task, site, routine action and batch lifetime.

`runBrowserTasksTool.ts:385–455` retires the registry entry when an abort is observed during its wait and now reads credential-free account metadata. If abort arrives during the awaited preview, the listener attaches to a signal already aborted and no event reaches it. The request can still be created and wait for expiry. The cancellation at lines 319–326 emits no dismissal, so the visible card can remain until its timer expires. When there is no sink, the path returns true. The batch then starts with a Boolean result and no independent grant reaching the permission layer. The PRD requires a confirmation that allows routine actions within that batch. The continuation note explicitly records that piece as deferred.

Test Stop before/during lookup and card publication, renderer unavailable/remount, fresh profile without existing grants, invalid/reused confirmation, strict site scope and eventual parent result. Preserve separate handling for consequential proposals. M-FR-03–05, C-FR-09, design §17.2.

### A09 — P1 — batch output is only partially validated

- [ ] Validate the whole child result at the collector, with bounds and parent access for externalized data. Keep summaries and malformed output from changing task ownership or claiming success.

`runBrowserTasksTool.ts:831–866` now bounds summary, evidence entries and URL length. Evidence still assumes an array before calling `.filter`, so a malformed value throws. `extracted` and `needs_user` still pass through unchecked casts. The URL check uses a protocol prefix and a length bound without parsing the result. Dedupe later assumes structured rows. Reuse the generic AgentRuntime result access grants at lines 519–564 and 928–965 for batch-specific externalization. Add coverage for wrong container types, nested sizes, oversized data, a malformed proposal, malformed URL, externalized receipt with parent access and per-child error isolation. M-FR-02/09/11, design §§17.2/17.5.

### A10 — P1 — successful account opt-in saves leave the controlled checkbox stale

- [ ] Assign the saved value to the active account's state after a successful write. Keep loading, write failure and route-switch states separate.

`socialaccountdetail.vue:62–68,324–349` uses `:model-value="aiUseEnabled"` with an explicit change handler. The handler never assigns the new value after success. A successful true→false write can leave the ref true. A requested false→true update is then dropped by the equality guard. The mounted test around lines 173–185 checks one IPC write while omitting the rendered state and reverse toggle. A failed read still sets false and marks the value loaded. Test load without writes, two successful toggles in each direction, failed read, write failure and a route change during save. The registry-backed selector and explicit load/rollback write isolation are present. Q-01, PRD §7, A-FR-03/06, S-FR-06.

### A11 — P1 — proxy-switch consent, replacement and rollback remain incomplete

- [ ] Provide a real confirmation continuation tied to the account, current proxy, target and country/direct transition. Apply it consistently to explicit and automatic selection.
- [ ] Preserve full task and root-conversation ownership across restart and rollback, then return a fresh observation and revision.

`BrowserProxySelectionService.ts:115–203` can signal confirmation for explicit/direct selections but the callers only surface `proxy_confirmation_required`. There is no corresponding approval continuation. Auto selection does not apply a consistent cross-country comparison with the current effective proxy. `ManagedBrowserModule.ts:2489–2637` reselects the route at start, loses root ownership, rejects rollback for a known direct session, and can hide a failed rollback behind the original error. The saved URL comes from the report-safe observation, which strips query and fragment. Capture exact resume location in trusted state. `ManagedBrowserAiToolService.setProxy:1307–1313` returns status and a null notice, with no fresh observation.

Drain in-flight browser actions and await the cookie save before relaunch or rollback. The event save in `ManagedBrowserModule.ts:807–813` is asynchronous and switch relaunch at lines 2580–2585 does not wait for it. The worker handlers are dispatched independently in `src/childprocess/managed-browser/index.ts:148,192–194,307–310`. Exercise same-country and different-country change, decline, auto selection, changed selection between approval and use, failure in both start and rollback, known direct rollback, concurrent activity, cookie durability, child task notices and a usable fresh replacement observation. P-FR-02–06, P-AC-01, M-FR-07/08, design §16.

### A12 — P1 — persisted capability probes still race changes and restart

- [ ] Bind each result to a stable provider/endpoint/model identity and publish it only while its admitted revision is current. Report a genuinely unavailable or invalidated probe accurately.

The prior immediate invalidation on save is fixed. `managed-browser-ipc.ts:718–778` still gathers several checks through the dynamically routed chat API, saves them before checking for an epoch change and can return positive booleans alongside an invalidation error. A late old probe can overwrite a newer result. `ManagedBrowserSettingsPanel.vue:234–246` uses the flags for display without reflecting those errors. `AIProviderConfigVersion.ts:12–27` uses a process-local counter starting at zero, while settings persist the revision string. The same string can recur on a later process even when the route is different. Use the stable fingerprint to distinguish routes and test concurrent probes, restart, model override, unsupported format and native support separately. D-FR-02/18, D-AC-08/11, PRD §7, design §§5.3/5.4/9.

### A13 — P1 — parent polling, Return Now and restart lose interrupted batch state

- [ ] Reflect confirmation, pause and child handoff in the parent job. Freeze the effective parent deadline for the full user-wait interval, and wake on Stop, Resume or the appropriate wait deadline.
- [ ] Preserve available partial results on Return Now, pause expiry and restart, with consistent terminal state and cleanup evidence across the job, task and batch.

`AIChatQueryLoop.ts:6577–6580,6603–6628` observes the wait marker but extends the deadline only after the marker clears. It can wake at the original deadline and cancel a job that is still waiting. `skillsRegistry.ts:5376–5380` also leaves the parent job ID out of the batch call, so the batch cannot report its own confirmation and child waits through that path.

The child clock's new explicit-pause check also uses the wrong identity. `runBrowserTasksTool.ts:517` registers the control task against the root conversation. `AgentRuntime.ts:246` later registers the same task ID with the child conversation, but `AgentTaskControlService.ts:84–100` returns the existing record. The subsequent pause lookup uses only the child conversation ID (`AgentRuntime.ts:596`, `runBrowserTasksTool.ts:565–571`) and misses that record. Tool-job wait markers remain available for child jobs that publish them. Use the authoritative control task ID and a monotonic clock. `AgentTaskControlService.ts:80` uses the wall clock by default.

`runBrowserTasksTool.ts:675–717` synthesizes empty extraction/URL and a generic unfinished marker for active lanes on Return Now, dropping available lane results. The control service classifies expired pause as interrupted, while AgentRuntime and the batch store/report failure (`AgentTaskControlService.ts:378–395`, `AgentRuntime.ts:713–727`, `runBrowserTasksTool.ts:733–746`). Startup reconciles fast-runner BrowserTask rows (`managed-browser-ipc.ts:129–135`, `BrowserTaskModule.ts:157–165`). Parallel AgentTask lanes use a separate persisted record and an in-memory control map with no equivalent interruption repair.

Test a wait that straddles the original deadline, a 45-minute extension, multiple child waits, confirmation, explicit Stop, expiry, partial data before Return Now and a process restart with nonterminal lanes. Verify the same terminal state, returned data and lease outcome across each layer. C-FR-09/11/14, C-AC-02–04, M-FR-09, design §§12/18.

### A14 — P1 — unchanged pages can suppress no-progress recovery

- [ ] Compute progress from stable semantic page identity, relevant state and verified output. Give recovery a new correlated request when observations or subgoals change.

`BrowserTaskRunner.ts:1534–1559` includes volatile element refs in the digest. `PageReferenceRegistry.ts:174` generates a new ref per observation. An in-memory runner fixture produced ten identical semantic observations with fresh refs and every one counted as progress. The hash uses only the first 200 text characters and checks completion with an empty extraction list, so meaningful output changes can be missed as well. The failure key around lines 1667–1671 uses role/name without equivalent-control context. The untargeted branch at line 1079 stops after three equivalent failures, while the targeted branch at line 1263 starts recovery. On failed re-observation, lines 1551–1559 reuse the original input and lines 1456–1460 change content under the same request ID.

Test stable repeat observations, two controls with the same label and different scope, meaningful change beyond preview text, extracted progress, equivalent targeted and untargeted failures, and retry versus recovery correlation. Link these cases to the resume-generation tests in A06. D-FR-19/22–26, D-AC-07/09, design §§11–12.

### A15 — P1 — saved sign-in does not enforce the full attempt and recipe lifecycle

- [ ] Track automated attempts per account and site. Block retries of a rejected saved credential until it changes, and report terminal login outcomes with actionable handoff reasons.
- [ ] Store and consume an ordered login recipe for supported workflows. Preserve user choice among accounts and use the specified bounded candidate path for ambiguous forms, with the worker security checks at each step.

`SocialAccountModule.ts:529–573` and `BrowserCredentialLoginService.ts:875–884,929–930,982–994` implement a failure timestamp rather than the PRD's per-attempt window. A rejected password can be attempted when the cooldown expires. Success and cookie restoration can clear the failure state, and challenge/unknown outcomes can take different paths through the gate. `LoginFormFiller.ts:803–847` can classify a visible generic error as wrong password, while a form that remains open can become `login_outcome_unknown`. The service at lines 1009–1039 can return failure for an unknown outcome without handing off, and the wrong password and verification cases can surface the same general reason.

`WorkerSession.ts:861–868` takes only the first stored step. `BrowserCredentialLoginService.ts:908–924` records a single fixed form step even after a multi-step sign-in. Generic bounded two-step discovery is present. Test discovered and learned sequences separately, including ambiguous forms, wrong password, challenge, account lock and unknown outcomes, repeated attempts after success, and credential replacement after rejection. A-FR-09/10/14/17/20, A-AC-02/04–06, design §13.

### A16 — P1 — hosted, custom and native provider contracts diverge

- [ ] Align advertised schemas, prompt, parser and fallback. Require hosted correlation before accepting actions. Qualify a distinct native provider route, profile and budget.

In-memory adapter probes reproduced three contract failures. The custom adapter rejected the bare SIGN_IN action requested by its own prompt (`DecisionClients.ts:566–620`). In structured mode it rejected an answer allowed by its advertised schema and returned before trying the supported fallback (lines 245–266 and 521–535). The hosted adapter accepted a bare DONE without request/task/step/observation/revision/version correlation (lines 169–193 and 646–666). Resolve these together and cover status discriminants, optional/null fields, model/version mismatches, fallback after semantic schema failure and bounded retry.

`SystemOneDecisionClient.ts:24–29,102–121` has a small native profile and generic question envelope. The service persists native as chat and reads the current revision again for cursor metadata (`ManagedBrowserAiToolService.ts:1809–1814,2052–2053)). `TaskPlanner.ts:60–91` sends planning as an unrestricted DONE-shaped decision through the same endpoint, while design §11.3 specifies a selected same-boundary chat model for planning/recovery. Cover native eligibility, response/scoring and attribution, native credentials/profile identity, selected fallback and exact admission metadata. A-FR-14, D-FR-01–04/16–25, D-AC-08/11, design §§5/9/11.

### A17 — P1 — proxy read models and stored credentials disagree

- [ ] Share one proxy metadata contract across list/detail, renderer and selection. Classify unknown checks conservatively and derive password presence without returning the stored value.
- [ ] Complete and verify migration for every legacy row, with a compare-and-set update to preserve concurrent edits.

`Proxy.model.ts:48–74` returns `hasPassword`, while `ProxyAiTools.ts:92–109` forwards the old `record.password` and `proxyAiToolTypes.ts:350` derives presence from password/pass. AI list output can therefore claim a configured proxy has no password. The model places row update time into `checktime` and supplies a default status. `proxy-controller.ts:866–876` skips enrichment without a check result, so the AI mapper can report unchecked HTTP(S) rows as passed. The AI mapper and browser selector also disagree on the normalized protocol for legacy null rows.

Migration at `Proxy.model.ts:48–55,145–162` runs on selected reads, and `BrowserProxySelectionService.ts:93–108` ignores the migration indication. It updates by ID after encrypting older input, without guarding against replacement of the stored value during the operation. The dedicated proxy editor uses the safe DTO. `SocialAccountModule.ts:199–209` still passes the proxy relation through the account detail path. Use a credential-free proxy DTO there as well. Test false/true password presence, unchecked/failed/passed rows, null protocol compatibility, browser-only and unvisited legacy rows, concurrent password edit, key failure and rotation. P-FR-01/07/08, design §§13/16.

### A18 — P1 — ref lifetime, approval binding and unknown effects need one execution contract

- [ ] Pin the exact observation through pending model decisions and approvals. Release the same ID on resolution and await pin acknowledgment where eviction could race it.
- [ ] Bind approvals to the trusted page/target context and distinguish transport failures after dispatch from proven no-effect failures.

The registry supports pinned observations, but `BrowserTaskRunner.ts:520–555` has no pin around a provider decision. Its pending refs can hit the 60-second TTL in `src/config/managedBrowser.ts:104` or the unpinned observation count limit. `ManagedBrowserAiToolService.ts:796` fires an approval pin without awaiting it, and `ManagedBrowserModule.ts:469–473,1223–1225` unpins the latest observation instead of the ID held by the approval. Keep this safe for concurrent read-only observation and repeated waits.

`ManagedBrowserAiToolService.ts:2322–2357` fingerprints role/name and value/option but leaves context null for targeted actions, including same-labelled controls in different forms or dialogs. Consumption checks session and digest without proving that the current page context matches the approved one (`ManagedBrowserModule.ts:1266–1302`). Bind the issuing observation and its revision to the approval, and allow reuse across passive re-observation only after matching the same live semantic target and context. The single-use consumption and fill/selection value digests are present.

For worker transport failure after action intent, the targeted path at `BrowserTaskRunner.ts:1211–1231` stores unknown and returns partial. The untargeted dispatch at lines 1049–1052 can throw straight to the generic handler, leaving no matching outcome and producing a runner error. Cover timeout/crash/cancellation before and after dispatch for both branches, observe after uncertain effects without replay, and retain correct partial evidence. D-FR-09/15a/26/27, D-AC-05/06, design §§7/8/11–12.

## Other incomplete requirements and release work

- [ ] **Parallel scheduling and controls.** Implement per-provider concurrency and batch-wide token/cost limits, with actual 429 handling for the batch path. The batch still launches the fixed agent runtime route. Add the separately selectable sub-agent model and pluggable fast-runner route. The per-site cap uses the initial readonly launch domain (`ManagedBrowserModule.ts:157,664–681,772`). Track domain changes and account-free sessions launched without a URL. The account queue does one retry after an 8-second wait (`runBrowserTasksTool.ts:589–623`), while its reservation wait at lines 345–359/628 does not observe Stop itself. Verify long account contention, cancellation, one-child failure, whole-batch Stop, shutdown and retained-session ownership together. M-FR-06/09/10/12.
- [ ] **Handoff and window UX.** The Open browser call now reaches the worker with a failure response. `ManagedBrowserSessionCard.vue:428–446` still keeps one session and drops different session status updates while it is shown. Add a root-conversation queue/count and targetable per-task handoff/focus controls. Qualify the requested window title, tiling/occlusion behavior and automatic pause on repeated unexpected page changes. C-FR-10/15, M-FR-08/13.
- [ ] **Provider accounting and selection quality.** Attribute each actual attempt and model including planner, helper, recovery, verifier and retries. Treat interrupted unknown usage as unknown. Compare shortlist recall and prompt/token budget against task families and candidate limits. Native/provider and foreground budget checks need live qualification. D-FR-14/18/20–25, D-AC-08/10, PRD §§8–9.
- [ ] **Account/registry/proxy acceptance.** The v1 registration refusal now agrees with the revised PRD A-FR-12. Document the same scope consistently in technical design §13.7. S-FR-03 requires a public-suffix library. `RegistrableDomain.ts:1–17,220–260` uses a curated subset. Replace it and test public/private suffixes, IDNs, duplicates and hostile/invalid URLs. Verify seeded/custom account upgrade, allowed-frame and credential containment across real Electron transport, redirect-domain approval, proxy credential migration/secondary consumers, and bundled-browser country/locale/WebRTC behavior. A-FR-01–21, S-FR-01–06, P-FR-01–09 and their acceptance IDs.
- [ ] **Implement the app drivers behind the six skipped tests.** The three decision scenarios reference absent `window.__e2eExecuteTask*` hooks. The two parallel cases reference a fixture route and cleanup endpoint without handlers in the app harness and contain hardcoded task IDs. The saved-account wrong-password/cooldown scenario has no app driver. The current active login fixture tests the page function and does not cover the app's credential store or worker transport. Run these through the actual Electron tool → IPC → worker → persistence → renderer route. Include a 45-minute extended handoff, sibling isolation and zero leaked leases after Stop. D-AC-02/06/07/09/10, A-AC-01/02/05, M-AC-01–03, C-AC-01–04, design §20.
- [ ] **Run held-out qualification and record release evidence.** Use the six-language paired evaluation, independent outcomes, shortlist recall, p50/p95, all-attempt cost per verified success, batch costs and the predeclared success margin. Capture upgrade/rollback and packaged process-tree evidence in operator/CI against the release revision. PRD §§8–10, design §21.

| Requirement group | Remaining work references |
| --- | --- |
| D-FR-01–04 | A01, A02, A12, A16 and provider qualification |
| D-FR-05–10c | A01, A05–A09 and lifecycle/app acceptance |
| D-FR-11–15a | A02–A04, A18 and shortlist/live observation evidence |
| D-FR-16–21 | A02–A04, A12, A14, A16 and provider action/value compatibility |
| D-FR-22–27 | A01, A05–A06, A13–A14, A16, A18 and verification, approval and accounting evidence |
| A-FR-01–21 | A04, A06, A10, A15–A16 and account/sign-in acceptance. A-FR-12 registration is deferred by the revised PRD. |
| S-FR-01–06 | A08, A10 and registry/domain acceptance |
| P-FR-01–09 | A11, A17 and bundled browser, proxy transport and migration acceptance |
| M-FR-01–13 | A05, A07–A09, A13 and parallel scheduling, cleanup and window acceptance |
| C-FR-01–16 | A05–A08, A13 and live takeover, hold, resume and Stop journeys |
