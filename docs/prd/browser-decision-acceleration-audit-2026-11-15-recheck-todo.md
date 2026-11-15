# Browser decision acceleration — November 15 recheck TODO

Audited HEAD 10c793903 and the current uncommitted edits to AgentDefinitionRegistry.ts, BrowserControlCards.vue and BrowserTaskBatchCard.vue. This is a new report alongside the earlier [November 15 audit](browser-decision-acceleration-audit-2026-11-15-todo.md). Specifications are [PRD](browser-decision-acceleration-prd.md) and [technical design](browser-decision-acceleration-technical-design.md).

**Requirements remain incomplete.** Hosted/native route construction, planner, field helper, credential/account/site cards, cookie restoration, root ownership work and configurable concurrent-session UI now exist. Earlier reports describing those entire features as absent are superseded. Current failures and remaining acceptance cases follow.

## Current bugs and related cases

**2026-11-15 closure pass:** V01–V06 are CLOSED — commits
`d3ee8afd3`(V01 via the resume-dialog commit chain) → `b01d564be` → the
V-fix commits. V01: the Resume button opens the dialog (component
regressions cover open/submit/cancel/empty); V02: SIGN_IN handoff blocks
in-job via awaitHandoff and resumes fresh; V03: hosted re-checks config
after the response, native aborts via a 500ms config watch; V04: the
inner gate catch maps task_interrupted/task_failed exactly; V05:
oversized option values are omitted (unsupported) instead of offered
unmatchable; V06: readElementDescriptor reports disabled/occluded and
withElement refuses before dispatch (element_disabled/element_occluded).
CI run 43697743380 SUCCESS on all three jobs at `d3ee8afd3`; the
follow-up commits are covered by the next CI run.

### V01 — P1 — Resume with instructions has no reachable opener

- [x] Wire the actual Resume button to openResumeDialog and verify the whole card→container→IPC→runner path.

BrowserTaskBatchCard.vue:52 still emits resume directly. The new openResumeDialog function at line 142 has no caller. resumeDialogOpen remains false, so users cannot enter instructions. This defect is in the uncommitted UI change and contradicts the sixth-pass completion note. Cover clicking the real button, entering text, Enter/button submit, cancel, empty instructions, task removal while the dialog is open and IPC failure. Add the component regression in the same change. C-FR-04/07, PRD §7.

### V02 — P1 — sign-in handoff still terminates the runner job

- [x] Use the existing blocking handoff lifecycle for SIGN_IN results and resume with a fresh observation after user resolution.

BrowserTaskRunner.ts:577 returns terminal partial/sign_in_handoff when the credential service returns handoff_required. Action-triggered handoff has an in-job waiting mechanism, but this separate branch exits the job. Login verification can succeed later while the original runner remains finished. Test no-account manual choice, wrong password, CAPTCHA/OTP, card cancellation, expiry, Stop and successful resume. Preserve task identity, active-time freeze and remaining budgets. D-FR-10a, A-FR-09/14, C-FR-01–03/09.

### V03 — P1 — provider invalidation differs across three clients

- [x] Apply one abort-and-discard rule to chat, hosted, native, recovery, planner, helper and verifier requests.

HostedDecisionClient.decide in DecisionClients.ts checks configChanged before postDecision but does not recheck after its response. Its correlation checks do not establish that the provider configuration stayed frozen. SystemOneDecisionClient checks again after response but does not abort the in-flight call when settings change. The chat client has a polling abort path. Reproduce a config change while each endpoint is held open, during retry backoff and before dispatch. Assert no obsolete decision can act and the UI reports an interrupted/re-admission state. D-FR-02, design §§5/12.

### V04 — P1 — the inner gate catch still hides interrupted/failed states

- [x] Apply exact terminal-reason mapping at every wait boundary.

BrowserTaskRunner.ts:495–498 catches every waitUntilOpen exception and returns task_cancelled. The outer catch has the improved exact task_interrupted/task_failed handling, but this inner catch prevents it from seeing those errors. Pause expiry or a failed task while inference finishes can therefore be labelled user cancellation. Test each terminal control state before inference, during inference, during persistence and final verification. Check the returned reason and durable record together. D-FR-09, C-FR-08/12/16.

### V05 — P1 — exact SELECT validation still receives truncated values

- [x] Keep exact native option identity in worker-owned snapshot state, or explicitly mark oversized options unsupported before offering them.

BrowserObservationService.ts:188 truncates values to 512 characters and shapeElementRecord repeats that bound at line 327. The executor compares expected_values with the full native option.value. An unchanged 513-character value is rejected as stale_select_option. Increasing the earlier 200-character limit did not close the whole supported-input case. Cover 511/512/513 and much larger values, repeated values, changed labels, disabled options, reordering and missing expected identity through the real collector→runner→executor path. D-FR-12/16/17, D-AC-04.

### V06 — P1 — live target validation lacks disabled/occlusion checks

- [x] Revalidate enabled state and hit-testability immediately before every mutating element operation.

BrowserActionExecutor.withElement checks role/name and viewport intersection, but no disabled attribute or elementFromPoint hit test. A control can become disabled or be covered after observation while retaining the same descriptor. Filtering disabled candidates earlier cannot protect this later transition. Cover disabled/read-only controls, overlays, detach, focus changes, hover-triggered overlays and select/fill/click/clear operations. Report known no-effect before dispatch and unknown only after input might have occurred. D-FR-12/15/26.

## Remaining requirement groups

### V07 — Provider capabilities, planning and verification

- [ ] Complete negotiated JSON Schema→forced tool→strict JSON fallback with bounded upstream attempts. Current chat capability flags disable the first two modes.
- [ ] Report native/chat/structured-output capability tests separately in settings.
- [ ] Complete separately budgeted optional provider verification and full usage/cost accounting.
- [ ] Measure shortlist recall and task relevance beyond focused/dialog prioritization.
- [ ] Verify helper cache invalidation after goal, field, page, provider and uncertain-effect changes through the production route.

The clients, planner and helper are now wired. Completion requires their full configuration, failure and budget matrices. D-FR-04/14/18/20–25, D-AC-08/10, design §§5/8–12.

### V08 — Account, registry and credential completion

- [ ] Add per-account AI opt-in editing for existing accounts and avoid duplicate creation when an existing disabled account is selected.
- [ ] Complete authoritative BrowserSite consumers in account labels, filters and detail/controller paths.
- [ ] Demonstrate same-site-frame field handling, native-setter fallback with focus checks and bounded recipe disambiguation.
- [ ] Run sentinel checks through actual observations, notices, transcripts, logs and worker messages.
- [ ] Resolve the registration scope explicitly against A-FR-12. The PRD still specifies confirmation/Create account wording, while Q-02 proposes login-only v1. An implementation note documenting a cut does not itself amend the normative requirement.

Account/card/cookie-first implementations exist. Remaining work includes failure/expiry, SSO identity, post-login binding and encrypted storage verification. A-FR-03–21, S-FR-01–06, A-AC-01–05.

### V09 — Proxy completion

- [ ] Preserve structured connect/auth/tunnel reasons through health check, switch and rollback.
- [ ] Expose browser_usable, actual check timestamp, host/country/direct session labels without credentials.
- [ ] Qualify bundled Chromium WebRTC behavior and country-derived locale/timezone.
- [ ] Verify successful switch and rollback retain exact effective proxy, cookies, unique task ownership and replacement-session binding.
- [ ] Validate migration and every secondary proxy storage/worker/renderer consumer using legacy, encrypted and unavailable-key cases.

Country-strict selection, proxy secret handling and task-owner switch fixes are present. Their complete acceptance matrix remains open. P-FR-01–09, P-AC-01/02.

### V10 — Parallel consent, lifecycle and UX

- [ ] Implement a batch-scoped routine-action consent grant and enforce the child prohibition on consequential actions in policy.
- [ ] Complete batch-wide token/cost/provider concurrency limits and the separately selectable sub-agent model/fast-runner executor.
- [ ] Preserve and restore live cards and notices across chat switching/remount and app interruption.
- [ ] On resume, recheck site/account identity and append user instructions plus a resume note to the transcript.
- [ ] Queue handoff dialogs, show the waiting count and implement task-window focus or hide unavailable controls.
- [ ] Connect session-card takeover/pause to AgentTaskControlService, including late action results and no automatic replay.
- [ ] Verify queued account starts and cleanup when a child crashes before emitting session_id.

Root ownership and child-exit cleanup now have implementations. The new child allow-list edit removes browser_site_upsert. Verify sibling isolation, keep-open transfer, stop-one/stop-all, Return now, 45-minute handoff and extended handoff expiry through real processes. M-FR-01–13, C-FR-01–16.

## Acceptance and validation

- [ ] Complete the real app drivers for currently fixme-marked decision, parallel and sign-in tests. Verify tool→IPC→worker→storage→renderer journeys.
- [ ] Complete held-out paired evaluation across six languages with independent success checks, p50/p95, all-attempt cost per verified success, shortlist recall and declared success margin.
- [ ] Keep evidence tied to the exact revision and distinguish committed CI results from current uncommitted UI behavior.
- [ ] Investigate the observed SQLite-lock failure under concurrent focused-suite execution and isolate database fixtures/lifetimes if it is test interference.

Initial focused run used vite.main.config.mjs across browserDecision/browserLogin/browserAgents/managedBrowser, including its TypeScript precheck. Result was 579 passed and one failed out of 580 in 49 files. cooldownScope.test.ts failed during TypeORM schema initialization with database is locked, rather than at the account/site assertion. This alone does not establish incorrect cooldown behavior. Log is %TEMP%/bda-nov15-recheck.log.

The isolated cooldownScope rerun passed its one test and TypeScript precheck. Log is %TEMP%/bda-nov15-cooldown.log. The test constructs SocialAccountModule before replacing its row lookup, so database initialization still occurs despite the mocked row. Investigate fixture isolation and initialization teardown under parallel execution. The combined suite was not repeated after the isolated pass.

Targeted component checks for BrowserControlCards and ManagedBrowserSettingsPanel passed all 33 tests. They do not cover opening the new instructions dialog through the actual batch-card button. Log is %TEMP%/bda-nov15-components.log.

No local Forge packaging was attempted. The latest user-provided AGENTS.md forbids local package/make and assigns packaged evidence to operator/CI. Full Electron E2E, remote CI and performance qualification were not rerun.

## Requirement mapping

**Sixth pass continuation (2026-11-15):** commits `7f4681cc9`→`309df90f0`
— G01/D-FR-12: DISABLED candidates are EXPOSED as disabled instead of
omitted; G01/D-FR-14: task-lexical shortlist ranking threaded through
all five builder call sites; G03/P-FR-09: session-card proxy
host/country labels + Direct-traffic badge (no credentials, six
languages); G05/C-FR-16: session-card pause/take-over resolves the
runner task and drives BOTH layers (control gate + intervention);
G06: the cooldownScope fixture is fully isolated from TypeORM init —
the observed SQLite-lock failure was test interference. CI run
43717139584 SUCCESS on all three jobs at `309df90f0`. Remaining:
V07 negotiation/verification configuration matrices, V08 opt-in UI +
registry consumers + sentinel scope, V09 proxy presentation matrix,
V10 batch confirmation card + concurrency + root-conversation notices,
real E2E drivers, held-out evaluation.

| Requirement IDs | Open work |
| --- | --- |
| D-FR-01–04 | V03/V07 provider configuration, capability and model behavior |
| D-FR-05–10c | V02/V04/V07/V10 planning, lifecycle, handoff and progress |
| D-FR-11–15a | V05/V06/V07 observation identity, control state and recall |
| D-FR-16–21 | V05/V07 operation values, formatting and helpers |
| D-FR-22–27 | V03/V04/V06/V07 recovery, verification, effect and approval evidence |
| A-FR-01–21 | V02/V08/V10 sign-in, credential and manual resolution flows |
| S-FR-01–06 | V08 registry consumers and domain/upgrade acceptance |
| P-FR-01–09 | V09 complete proxy transport, storage and presentation |
| M-FR-01–13 | V10 scoped consent, resources, ownership and parallel evidence |
| C-FR-01–16 | V01/V02/V04/V10 pause, user wait, resume, terminal state and UI |

The six concrete source-confirmed defects V01–V06 require the described targeted regressions. V07–V10 group the remaining feature and acceptance work so similar missing paths can be completed together. This audit creates documentation only.
