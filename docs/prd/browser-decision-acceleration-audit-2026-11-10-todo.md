# Browser decision acceleration — implementation audit TODO, November 10

Reviewed the worktree at `94d8f8834` (CI green) against the [PRD v1.1](browser-decision-acceleration-prd.md) and the [technical design](browser-decision-acceleration-technical-design.md). The review traces production callers, so it does not rely on earlier audit claims or unit-test coverage. Earlier TODO files (`…-audit-todo.md`, `…-2026-11-04*`, `…-2026-11-05-pass4`, `…-2026-11-07`) are historical. **This file supersedes them** where they disagree.

**Verdict: the PRD is not fully implemented.** CI is green, but several features are dead or broken on the production path:

- `browser_execute_task` (the runner) cannot execute a single action, because it blocks itself.
- The hosted decision route is a stub.
- The credential, account-picker, and site-confirmation cards are never mounted.
- `browser_start_session` ignores the requested proxy.
- Sub-agent sessions, cards, and dialogs belong to an invisible child conversation instead of the parent chat.

Line numbers below refer to `94d8f8834`.

## 0. Coverage summary

| Area | PRD IDs | Done | Partial | Missing / broken |
| --- | --- | --- | --- | --- |
| Admission and provider | D-FR-01–04 | 1 | 3 | — |
| Task lifecycle | D-FR-05–10c | 3 | 7 | runner execution broken (P0-1) |
| Observations | D-FR-11–15a | — | 6 | — |
| Decisions and field values | D-FR-16–21 | — | 3 | 3 (D-FR-18 negotiation, 20, 21) |
| Recovery and verification | §6.5, D-FR-22–25 | 1 | 4 | LLM verifier, recovery for user input |
| Effect and approval | D-FR-26–27 | — | 2 | approval bypass (P0-3) |
| Sign-in | A-FR-01–15 | 2 | 10 | 3 (A-FR-12, 14, card wiring) |
| Password-field safety | A-FR-16–21 | 1 | 5 | — |
| Site registry | S-FR-01–06 | 1 | 3 | 2 (S-FR-04 end-to-end, S-FR-06) |
| Proxy | P-FR-01–09 | — | 6 | 3 (P-FR-01 broken, P-FR-03, P-FR-09) |
| Parallel sub-agents | M-FR-01–13 | 1 | 8 | 4 (M-FR-08, 10, 12, 13) |
| Takeover / pause / resume / stop | C-FR-01–16 | 1 | 11 | 4 (C-FR-07, 10, 15, and the sub-agent half of C-FR-02/05) |
| Settings and UX | §7 | — | some | browser-decision section, native profile, capability tests, privacy copy, per-engine switches, sub-agent model, concurrency setting UI |
| Acceptance | §9 | D-AC-03, 11, 12 | most | A-AC-05, M-AC-03, C-AC-01–03, D-AC-08 |

---

## 1. P0 blockers (verified by direct source inspection)

- [ ] **P0-1 — The runner blocks itself; `browser_execute_task` never executes an action.** D-FR-06/08, D-AC-02.
  - **Where:** `executeTask` reserves the session in `runnerOwnedSessions` (`ManagedBrowserAiToolService.ts:1166`, upgraded at `:1402`). The runner executes through `runAuthorizedForRunner` (`:1076`), which calls the public `this.runActions(...)` (`:1087`). That method first calls `assertNoRunnerOwnership` (`:570`), which throws `session_not_owned / session_owned_by_active_runner`.
  - **Effect:** the error is not an approval or handoff stop, so it is rethrown (`:1132`). The runner's outer catch ends the task `failed` with `runner_error:session_not_owned` (`BrowserTaskRunner.ts:637-646`). Before that, one observation and one decision request have already sent page data to the provider, and an action intent was journaled with no outcome.
  - **Why tests miss it:**
    - the `runAuthorizedForRunner` tests never set ownership (`managedBrowserAiToolService.test.ts:208-260`);
    - the runner tests use fake deps;
    - no `executeTask` test reaches `runActions`.
  - **Fix:** split `runActions` into a guarded public wrapper and an internal core. The runner calls the core with a private lease token that matches `runnerOwnedSessions.get(sessionId) === taskId`.
  - **Test:** integration test `executeTask` → one CLICK decision → `ACTION_RESULT` → terminal `completed`.

- [ ] **P0-2 — The hosted decision route is a stub.** D-FR-01/03, D-AC-01/02, phase 8.
  - **Where:** `executeTask` returns `{status:"unavailable", reason:"hosted_decision_unavailable"}` for every hosted user (`ManagedBrowserAiToolService.ts:1196-1205`). `HostedDecisionClient` is imported (`:29`) but never instantiated anywhere in `src`.
  - **Fix:** wire hosted availability and capability discovery, plus the hosted decision client against server contract v1.

- [ ] **P0-3 — Approval bypass: an unresolvable ref is classified as an unnamed, auto-approved target.** D-FR-27, D-AC-04/05.
  - **Where:** `descriptorFor` looks only in `lastObservation` (`ManagedBrowserAiToolService.ts:581-586`). For a ref that is not there, the classifier receives `targetName:null`, so a click or select becomes `reversible_write` and is auto-approved (`BrowserActionRiskClassifier.ts:147-158, 302-306`). No `expectedRole/expectedName` is stamped (`:692-699`). The worker then falls back to the registry's own descriptor (`BrowserActionExecutor.ts:639-642`) and clicks.
  - **How it is reachable:**
    - refs from the previous (still live) observation;
    - pinned observations;
    - a stale `lastObservation` (P1-OBS-1);
    - model-authored `expectedRole/expectedName`, which the schema accepts despite its "NEVER model-authored" comment (`schemas/worker/managedBrowser.ts:319-325`).
  - **Fix:**
    - fail closed: a targeted ref missing from `lastObservation` becomes `stale_page_reference`;
    - strip model-supplied `expected*` at the tool boundary;
    - the worker also requires the ref's observation ID to equal the attested one.
  - **Test:** a "Publish" ref from observation N-1 must require approval or be rejected, never auto-execute.

- [ ] **P0-4 — `press_key` is classified as a read.** D-FR-27, D-AC-05.
  - **Where:** `READ_ACTION_TYPES` includes `press_key` (`BrowserActionRiskClassifier.ts:76`), so Enter in a comment or message box submits without approval. `clear`, `hover`, `go_back` and `reload` fall through to "unknown → reversible_write → auto" (`:182-185`).
  - **Fix:** classify Enter/Space by the focused element, and require approval when the focused element is unknown.

- [ ] **P0-5 — The page revision regresses after a handoff, so old approvals and refs can match again.** D-FR-11/27, D-AC-03.
  - **Where:** `WorkerSession.ts:356, 679, 721` call `registry.reset(this.runtime.pageRevision + 1)`. `ManagedBrowserRuntime.bumpRevision()` (`:283`) has no callers, so `runtime.pageRevision` stays 0 and the registry resets to revision 1 after every handoff resume or manual-login verify.
  - **Effect:**
    - revisions are reused, so an approval bound to revision N can match again;
    - the main-process cache rule `observation.pageRevision >= record.pageRevision` (`ManagedBrowserModule.ts:1145`) rejects every new `ACTION_RESULT` observation, so `lastObservation` goes stale, which feeds P0-3.
  - **Fix:** use `this.registry.currentRevision + 1` at all three sites, and delete or wire up `bumpRevision`.

- [ ] **P0-6 — `browser_start_session` ignores the requested proxy.** P-FR-01, P-AC-01.
  - **Where:** the tool passes the raw Zod shape (`{proxy_id}`, `{auto, country_code}` or `"direct"`, from `schemas/aiTools/browserProxy.ts:12-24`) straight through (`ManagedBrowserAiToolService.ts:437`). `ManagedBrowserModule.ts:546-549` hands it to `selectProxyForSession`, which switches on `selection.kind` (`BrowserProxySelectionService.ts:106,114`).
  - **Effect:** `kind` is undefined, so every request falls into the `auto` branch:
    - an explicit `proxy_id` and `"direct"` are ignored;
    - account sessions get the first linked proxy;
    - account-free sessions always fail with `proxy_no_usable_proxy`.
  - **Why the compiler misses it:** `BrowserModuleLike.start` (`:159-167`) omits `proxy`.
  - **Fix:** map the shape the way `setProxy` does (`:1052-1057`), and add `proxy` to the interface type.

- [ ] **P0-7 — A proxy switch destroys the working session before validating.** P-FR-02/03/04.
  - **Where:** `switchSessionProxy` (`ManagedBrowserModule.ts:2042-2087`) stops the session first. Confirmation-required checks (a different proxy, or direct on an account), SOCKS rejection, unusable credentials and `auto` with no candidates all run inside the subsequent `start()`.
  - **Effect:** a refused switch leaves the user with no session. Nothing is restored on failure, and the call is not serialized, so two concurrent switches can double-stop or start two sessions.
  - **Fix:**
    - run `selectProxyForSession` and the health check before `stop()`;
    - serialize per session;
    - await the cookie persist;
    - restore the old session if `start()` fails.

- [ ] **P0-8 — Scraper workers receive proxy ciphertext as the password, and plaintext still reaches the renderer and the search table.** P-FR-08, P-AC-02.
  - **Where:** see §5 E1 for the full read/write table. The worst instances:
    - `googleMaps-ipc.ts:86-93` and `yandexMaps-ipc.ts:94-101` pass raw `entity.pass` (now `ENC1:` ciphertext) to the worker, which breaks proxy auth;
    - `Proxy.model.ts:52-61` (`getProxyList`) sends decrypted plaintext to the renderer;
    - `ProxyModule.ts:101` → `proxydetail.vue:152` shows ciphertext, or plaintext for legacy rows;
    - `SearchModule.ts:609,656,1232` stores proxy passwords in plaintext in `search_task_proxy`.

- [ ] **P0-9 — Credential and site-confirmation cards are dead UI.** A-FR-03/05/06, S-FR-04, A-AC-05, §7.
  - **Where:**
    - `BrowserCredentialCard.vue`, `BrowserAccountPickerCard.vue` and `BrowserSiteConfirmCard.vue` exist under `src/views/components/aiChatV2/` and are imported only by tests;
    - no renderer subscribes to `MANAGED_BROWSER_CREDENTIAL_REQUEST` (it is only in the preload allowlist, `preload.ts:1527`);
    - the request event omits `conversationId` (`managed-browser-ipc.ts:121-129`);
    - the several-matches branch returns `awaiting_user_credentials/account_picker_required` immediately, with no picker IPC and no in-job wait (`BrowserCredentialLoginService.ts:289-297`);
    - `proposeExtraDomainsFromSession` (`ManagedBrowserModule.ts:1760`) and `applyAdditionalDomains` (`BrowserSiteModule.ts:286`) have no production caller.
  - **Effect:** the no-account path silently waits out the 10-minute TTL, then hands off.
  - **Fix:**
    - subscribe in `AiChatV2` and render each card in the **root** conversation;
    - add a picker-choice IPC and wait in-job like the credential card;
    - call the domain proposal after sign-in, through IPC that carries a one-time confirmation token minted at proposal time.

- [ ] **P0-10 — Sub-agent sessions, cards, approvals and handoffs go to an invisible conversation.** M-FR-07/08, M-AC-03, C-AC-01.
  - **Where:** `AgentRuntime` runs each child under its own `agent-v2-*` conversation. The loop input built at `AgentRuntime.ts:558-581` carries no `ownerAgentId` (it is set only on the tool-result grant path at `:795`, and only to `definition.id`, which is not unique per task). Every browser sink event (`managed-browser-ipc.ts:134-165`) therefore carries the child conversation ID, so the parent chat never shows the session card, notices, approval, credential card or handoff dialog.
  - **Fix:**
    - thread `{rootConversationId: parentConversationId, agentTaskId: <unique task id>}` into the loop input and the tool context;
    - map child to root plus a task label at emit time;
    - compare both fields in `ensureSession`.

---

## 0. Fix round 2026-11-11 (implementation HEAD: `ba6b2b54e`)

The execution/safety blocker group (§10 order step 1) is closed and integration-proven:

| Defect | Fix and evidence | Commit |
| --- | --- | --- |
| **P0-1 — the runner blocks itself** | `runActions` split into the guarded public wrapper (legacy tools keep the ownership guard) and the private UNGUARDED `runActionsCore`; `runAuthorizedForRunner` calls the core directly — the runner's lease IS the ownership. **The audit's requested integration test now exists and PASSES**: `executeTask → one CLICK decision → ACTION_RESULT → terminal completed with verified criteria`, going through the REAL service (mocked only at the AI-transport/module boundary) — before the fix this exact path died with `runner_error:session_not_owned`. | `e0375d9a9` |
| **P0-3 — approval bypass via unresolvable refs** | fail-closed: a targeted ref missing from the attested observation throws `stale_page_reference / target_ref_not_in_attested_observation` BEFORE classification; model-authored `expectedRole/expectedName` are stripped at the boundary and only main-process-attested descriptors are stamped. Tests: a ghost ref is rejected with nothing dispatched; an attacker-authored descriptor never reaches the worker (the attested one is stamped). | `e0375d9a9` |
| **P0-4 — press_key classified as read** | `press_key` removed from READ_ACTION_TYPES; press_key/clear/hover/go_back/reload classify `consequential_write / side_effect_unverifiable` (approval). Matrix test updated. | `e0375d9a9` |
| **P0-5 — revision regression after handoff** | all three `registry.reset(runtime.pageRevision + 1)` sites now use `registry.currentRevision + 1` (runtime.pageRevision never advanced) — revisions are no longer reused after handoff/manual-login, and the main-process cache rule no longer rejects every post-handoff observation. | `e0375d9a9` |
| **X6 — tool result drops stopCode/extracted/handoffReason** | the core's ACTION_RESULT return carries `stopCode` + `extracted`; a `HANDOFF_REQUIRED` message passes through with its reason (the executor-forced handoff is now awaited in-job by the runner instead of counting a failure and dying `observation_unavailable`); the seam maps all three. | `e0375d9a9` |
| **P0-6 — start-session ignores the proxy** | the model-facing zod union is mapped into the discriminated `BrowserProxySelection` (`mapProxySelection`) before `start` — proxy_id/direct/auto now behave as requested (public+auto no longer fails unconditionally). | `ba6b2b54e` |
| **P0-7 — proxy switch destroys the session before validating** | `switchSessionProxy` serialized per session (`proxy_switch_in_progress` error code added); selection + health-check prevalidation runs BEFORE `stop()` (a refused switch leaves the working session untouched); a start failure after validation restores a session on the same lineage. | `ba6b2b54e` |

Validation: `tsc --noEmit` exit 0; browserDecision + browserLogin + browserAgents + managedBrowser + i18n **666 tests pass**; utility managedBrowser **150 pass**. The cache-module flake seen once mid-round passes in isolation (load-sensitive, same class as CI round 3).

Remaining from the §10 order: X1 (tldts), P0-8 (proxy ciphertext readers — googleMaps/yandexMaps-ipc, Proxy.model, SearchModule), P0-9 (card mounting + picker/domain-confirmation IPC), P0-10 (root-conversation threading), X2/X4/X5 sweeps, and the missing-feature groups.

## 2. Cross-cutting defect patterns (fix every instance together)

### X1 — Registrable domain (eTLD+1) is not a public-suffix library (security)

- [ ] `src/service/browserDecision/RegistrableDomain.ts:1-98` uses a hand-curated list; its header admits `tldts` was not installed.
  - **Missing suffixes:**
    - private public-suffix entries such as `github.io`, `herokuapp.com`, `vercel.app`, `netlify.app`, `pages.dev`, `blogspot.com`, `web.app`, `appspot.com`, `azurewebsites.net`, `cloudfront.net` and `s3.amazonaws.com`;
    - many country second-level suffixes such as `co.ke`, `com.sa`, `gob.mx`, `ltd.uk`, `plc.uk`, `edu.cn`, `ac.in`, `gov.ph` and `co.at`.
  - **Effect:** unknown suffixes fall back to "last two labels", and the comment "never widens" is false. `*.localhost`, `.local` and `.internal` hosts are accepted.
  - **Consequences**, all from one root cause:
    1. Sign-in: `victim.github.io` creates the site `github.io` with allowed suffix `github.io`. `matchByUrl` (`BrowserSiteModule.ts:147-163`) and the in-page `hostAllowed` then release the stored password on `attacker.github.io` (A-AC-03).
    2. Site registry: unrelated tenants dedupe into one site, and `school.edu.cn` registers the public suffix `edu.cn` (S-FR-03).
    3. Runner NAVIGATE: the "same-site" check (`BrowserTaskRunner.ts:405-420`) allows cross-tenant navigation, and rejects `localhost` and IP fixtures (`:78-83`).
  - **Fix:** add `tldts` with private domains enabled. Reject sites whose eTLD+1 is a private suffix. Reject `localhost`, `.local` and `.internal` for credential sites, but allow loopback for E2E fixtures behind an explicit test flag.
- [ ] `socialAccountModule.ts:444-448` checks the **registrable domain** against the allowed suffixes instead of the live hostname. Host-specific allowlists such as `accounts.google.com` can never match, and the check is broader than intended. The sign-in path passes `site.registrableDomain` (the database record) rather than the live hostname (`BrowserCredentialLoginService.ts:383-387`), which makes the A-FR-07 gate nearly tautological.
- [ ] `BrowserSiteModule.matchByUrl` ignores the session's site. On `accounts.google.com` during a YouTube sign-in, it matches Google (ID 4), and the sign-in loads Google accounts instead of YouTube accounts. Prefer the session's `platformId`/`site_id` when the hostname is allowed there.
- [ ] `RegistrableDomain` accepts `http` (`:108`), so runner NAVIGATE allows https→http downgrades.

### X2 — Synchronous-reservation races (the same bug class F/P0 fixed for runner admission)

Each item checks state, awaits, then commits. Reserve synchronously before the first `await`, and release on every exit path.

- [ ] AI site ID allocation: `BrowserSite.model.ts:80-90` (`nextAiSiteId`) plus `repository.save` (`BrowserSiteModule.ts:228,240`). Two parallel upserts get the same ID, and the second `save` becomes an UPDATE that **re-points an existing (possibly credentialed) site to another domain**. Use `insert` in a transaction with a unique primary key and retry on conflict. (S-AC-01)
- [ ] Per-site session cap: `ManagedBrowserModule.ts:606-618` counts registered sessions after `await getEffectiveSettings()` and before the record is created (`:682`), so three parallel starts on one domain all pass. Settings are also read twice (`:611`, `:621`).
- [ ] Sign-in reservation: keyed per account **or** per session, never both (`BrowserCredentialLoginService.ts:302-313, 349-363`). Two `browser_sign_in` calls on one session with different accounts run concurrent `FILL_LOGIN_FORM` on one page. Always reserve `session:<id>` as well.
- [ ] Edited-username branch: `:460-470` switches `chosen` to another account **after** the reservation and cooldown check for the original account. Re-reserve and re-check the cooldown for the new ID.
- [ ] Proxy switch: not serialized (P0-7).
- [ ] Pending runner approvals are keyed only by session (`ManagedBrowserAiToolService.ts:653-657`), so an approval recorded for a legacy `runActions` call can be picked up by a runner on the same session. Key by `taskId`/`requestId`.
- [ ] Lease `already_active` matches on conversation only (`ManagedBrowserLeaseService.ts:83-87`), so two tasks in one conversation (main chat plus runner, or two sub-agents once P0-10 is fixed) share a session. Also match `ownerAgentTaskId`; otherwise queue.
- [ ] Worker command concurrency: `WorkerSession.runActions` (`:460-470`) has no `assertCommandAllowed`, unlike `FILL_LOGIN_FORM`. The worker message handler (`childprocess/managed-browser/index.ts:184-284`) does not serialize mutating commands. `ACTION_RESULT` resolves before `CHALLENGE_DETECTED` arrives, so the next `RUN_ACTIONS` passes the main-process guard and runs during challenge detection or handoff.

### X3 — Swallowed errors that turn failures into false success or fail-open

Each instance should at least log a reason code. Instances marked **fail-open** must change behaviour.

- [ ] **Fail-open:**
  - `probeInputType` returns `null` on throw (`BrowserActionExecutor.ts:661-667`), so the sensitive-field check passes and the fill proceeds. Treat `null` as sensitive for fill/clear.
  - `detectChallenge.catch(() => null)` (`WorkerSession.ts:991-993`): a failing probe means "no challenge".
  - `loadProxyRowsForAccount` returns `[]` on any error (`ManagedBrowserModule.ts:1675-1682`), so account-proxy confirmation is skipped (P-FR-03). Return an unresolvable result instead.
- [ ] **False success:**
  - `requestHandoff(...).catch(() => undefined)` at `BrowserCredentialLoginService.ts:172-174, 260-262, 446-448, 578-583`: the result says `handoff_required` even when no dialog opened;
  - `observe(...).catch` (`:184`) leaves the sign-in using a stale origin (`ManagedBrowserModule.ts:1109`: `origin || record.currentOrigin`);
  - `saveLoginRecipe(...).catch` (`:530`);
  - pause and resume IPC return `{ok:true}` after swallowed failures (`managed-browser-ipc.ts:197, 220, 245`; `ManagedBrowserModule.ts:1954, 1956`).
- [ ] **Lost journal and evidence:**
  - `persistActionOutcome` and `persistCursor` use `.catch(() => undefined)` (`ManagedBrowserAiToolService.ts:1339, 1363`);
  - the `recordAdmission` catch drops the cause (`:1417-1423`);
  - the `recordTerminal` catch is empty (`:1440-1442`);
  - the observe dependency returns `null` on any error (`:1256-1258`), hiding `ai_disabled`, `session_not_owned` and worker crashes behind `observation_unavailable`;
  - `recoverOnce` swallows provider errors (`BrowserTaskRunner.ts:773-775`);
  - `extractElementDataFn.catch(() => null)` silently drops extract items (`BrowserActionExecutor.ts:592`);
  - an observation build failure becomes `observation = null` with no notice (`WorkerSession.ts:500-504`).
- [ ] **Other silent catches:**
  - the startup interrupted-task sweep (`managed-browser-ipc.ts:101-103, 115-117`);
  - site seeding (`BrowserSiteModule.ts:58-70`): the seed promise resolves after a failure and is never retried, so later upserts can claim builtin domains with 100000+ IDs. One ID collision (`BrowserSite.model.ts:69-71`) also aborts the whole seed loop. Use per-row try/catch, reset `seedPromise` on failure, and preferably seed in a startup migration;
  - `ProxyCredentialCodec.ts:43-47` (decrypt failure, no log);
  - `setObservationPin` and `cancelActiveRequest` (`ManagedBrowserModule.ts:426, 1175`);
  - `runBrowserTasksTool.ts:196-198, 358`;
  - `HandoffCoordinator.ts:72-77`;
  - `ManagedBrowserAiToolService.ts:399-401`;
  - `AgentRuntime.ts:507-511`;
  - `ManagedBrowserModule.ts:1740-1742, 2026-2032`.

### X4 — Untruthful terminal states (D-FR-09, D-AC-07/09, §6.5)

- [ ] Renderer Stop ends the runner `failed`: `BROWSER_TASK_STOP` → `control.cancel` (`managed-browser-ipc.ts:232`), then `gate.waitUntilOpen` throws `task_cancelled` (`AgentTaskControlService.ts:231-233`). That is uncaught at `BrowserTaskRunner.ts:233`, so the outer catch records `failed` with `runner_error:task_cancelled`, and `setState` allows cancelled→failed (`AgentTaskControlService.ts:122-127`). The in-flight decision is not aborted either, because only `context.signal` is wired. **Fix:** link `control.cancel` to a runner-owned `AbortController`, and make cancelled terminal.
- [ ] A Stop during the in-job approval wait returns `"expired"`, which becomes `approval_expired` (`ManagedBrowserAiToolService.ts:903-904`).
- [ ] Handoff expiry returns `partial`/`handoff_expired` (`BrowserTaskRunner.ts:851-856, 1053-1056`), and `recordTerminal` maps it to `failed` (`ManagedBrowserAiToolService.ts:1432-1437`). The PRD requires `interrupted`.
- [ ] The runner hard-codes every handoff reason as `"challenge_unresolved"` (`BrowserTaskRunner.ts:843-846`), losing the login and credential-field reasons.
- [ ] Sign-in handoff reasons are wrong: a rejected password becomes `login_required`, and 2FA becomes `captcha_sensitive_flow` (`LoginFormFiller.ts:579-582`). The UI never says "Saved password was rejected" or "Verification code required" (A-FR-09).
- [ ] `HandoffCoordinator.ts:102-106` treats any state outside the waiting set as `resolved`, **including `login_required`**. Use an explicit allow-list.
- [ ] Pause becomes `waiting_for_user`: the IPC calls `setState("paused")` and then `beginIntervention`, which sets `waiting_for_user` (`managed-browser-ipc.ts:187-190`; `AgentTaskControlService.ts:161-169`). "Paused by you" is never shown. `beginIntervention` also opens interventions on terminal tasks, which leaks the sweep timer.

### X5 — Unknown effects reported as known or lost (D-FR-26, D-AC-06)

- [ ] Exceptions escape the executor: `runComposite` and the `if`/`repeat` `checkCondition` (`BrowserActionExecutor.ts:293, 303`) are outside any `try`. `WorkerSession.runActions` catches at `:552` and sends `WORKER_ERROR internal_error`, which drops every step result even after dispatched input. The runtime also stays `running`, because the `ready` transition is skipped. **Fix:** a catch-all in `executeProgram` → `finish("unknown_effect", anyDispatched || effectUnknown)`, plus a `ready` transition in `finally`.
- [ ] A main-process timeout or a worker crash is surfaced as an error, not `effect:"unknown"`.
  - **Where:** `ManagedBrowserModule.runActions` uses a timeout of exactly `programWallTimeMs` (`:1134-1139`). `worker_request_timeout`, `worker_exited` and `WORKER_ERROR` become plain errors (`:1612-1624`). The tool service turns them into a thrown error (`:779-780`), and the runner rethrows (`:1132`).
  - **Fix:** map any failure after dispatch to `{effect:"unknown", stopCode:"unknown_effect"}`. Add a timeout margin, and send `CANCEL_REQUEST` on timeout.
- [ ] `doWaitFor` ignores `run.deadline` (`:525`), and the schema allows `timeoutMs` up to 240 s (`schemas/worker/managedBrowser.ts:370-374`). Cap each step at `deadline - now()`.
- [ ] A failed navigation (`goto` throw `:510`; go_back/forward/reload throws `:444-456`) skips `registry.reset`, so the revision is not bumped even though the page may have changed. Reset in a `finally` once dispatch has started.
- [ ] `ElementHandle.click({ timeout: 5_000 })` (`:361`) is a no-op, because Puppeteer has no such option. Race the click against an explicit timer and classify the timeout as unknown.
- [ ] Mid-step cancellation is impossible: `shouldCancel` is checked only between actions (`:211, :300`), so Stop never interrupts a runner single-leaf program. Either document this or race against the abort signal.
- [ ] Over-classification: a `resolveSelectOptionsFn` throw (`:390-396`) is a read-only evaluate, yet it is marked unknown, which blocks the D-AC-06 reobserve.
- [ ] `this.cancelled` is never set to `true` (`WorkerSession.ts:189, 483, 888`). Dead guard.
- [ ] The `ManagedBrowserModule.cancelActiveRequest` comment still claims that cancelled consequential steps keep effect unknown. That is false, because cancellation only takes effect between actions.

### X6 — The tool result drops `stopCode`, `extracted` and `handoffReason`

- [ ] `ManagedBrowserAiToolService.runActions:761-778` returns only effect, revision, results and observation.
  - **Consequences:**
    - (a) the LLM cannot tell `unknown_effect` or `consecutive_failures` from success;
    - (b) LLM extract results vanish;
    - (c) `runAuthorizedForRunner` reads `message.extracted` and `message.type === "HANDOFF_REQUIRED"` (`:1101, 1113`), which never exist, so the runner's EXTRACT and `extract_nonempty` criteria never receive data;
    - (d) an executor-forced handoff is never awaited in-job: the runner counts an equivalent failure, then its next `observe` fails in handoff and the task ends `observation_unavailable`. The `result.type !== "ACTION_RESULT"` fallback (`:754-760`) is dead.
- [ ] A model-authored `request_handoff.reason` is a free string (`schemas/worker/managedBrowser.ts:413-414`), cast and forwarded (`WorkerSession.ts:546`). `HANDOFF_REQUIRED.reason` must be in `handoffReasonSchema`, so the main process likely drops it as malformed: the worker is in handoff and the main process is not. Map the reason to the enum in the worker.

### X7 — Ownership and model-reachable controls (D-FR-08, M-FR-07, C-FR-03/04)

- [ ] `ensureSession` (`ManagedBrowserAiToolService.ts:345-372`) checks only the conversation, never the agent task. Ownerless sessions, or calls with no `conversationId`, accept any caller (`:357-370`). Parent read access to child sessions and take-over of `keep_open` sessions are not implemented.
- [ ] While a runner owns a session, these tools are still allowed (D-FR-08):
  - `evaluateScript` (can write);
  - `captureScreenshot`;
  - `requestHandoff`;
  - `resumeAfterHandoff`;
  - `stopSession`;
  - `setProxy` (restarts the session mid-task);
  - `signIn` (fills credentials mid-task).

  `ManagedBrowserModule.runnerOwnedSessions` (`:282`) is declared and unused.
- [ ] `browser_resume_after_handoff` is still a main-chat model tool (`skillsRegistry.ts:5126`; `ManagedBrowserAiToolService.ts:1000`), so a model can end a takeover (C-FR-03, C-AC-04). Remove it from the model registry; resume only from the renderer.
- [ ] Task-control IPC (`managed-browser-ipc.ts:201-263`) validates shape with Zod but not ownership: any `taskId`/`sessionId` pair is accepted. Look up the control record and confirm its conversation and session.
- [ ] Approval IPC: `recordApproval` (`managed-browser-ipc.ts:350-366`) accepts any `requestId`, digest and revision from the renderer, without checking that the main process issued that request. Keep pending approvals in the main process keyed by `requestId`, and copy the digest and revision from there.
- [ ] A deny is session-wide: `consumeApprovalForProgram`/`peek` return deny for **any** program (`ManagedBrowserModule.ts:1021-1023, 1053-1059`). An expired approve returns `null` immediately without checking other valid entries (`:1071-1074`).

### X8 — Dead or unwired production code (exists, has tests, no production caller)

- [ ] **Sign-in cards and requests:** `BrowserCredentialCard.vue`, `BrowserAccountPickerCard.vue`, `BrowserSiteConfirmCard.vue`; the `MANAGED_BROWSER_CREDENTIAL_REQUEST` subscriber; `browserCredentialRequestEventSchema`; `BrowserCredentialLoginService.listForConversation` (`:135`). (P0-9)
- [ ] **Hosted decision client:** `HostedDecisionClient` (P0-2), and `getCapabilities()` on both decision clients, never called. `allowed_operations` is always the global `RUNNER_OPERATIONS` (`BrowserTaskRunner.ts:698`).
- [ ] **Site domain proposals:** `proposeExtraDomainsFromSession`, `applyAdditionalDomains` (S-FR-04).
- [ ] **Proxy failure classifier:** `classifyProxyError` (`BrowserProxySelectionService.ts:35-46`), test-only. Its default also mislabels unknown errors as `proxy_connect_failed`.
- [ ] **Budget constants nobody reads:**
  - `CHAT_ROUTE_PROGRESS_CHECK_INTERVAL_STEPS`;
  - `attemptsPerDecision`, `plannerCallsHard`, `verifierCallsHard`, `fieldHelperCalls*`, `requestTimeoutHardMs` (`BrowserTaskLimits.ts`). The two attempts are hard-coded in `DecisionClients.ts:141`; the progress interval is a literal 5 for every route (`BrowserTaskRunner.ts:783-819`).
- [ ] **Unused types and fields:**
  - `BrowserDecisionAttempt` (`browserDecisionTypes.ts:196`);
  - `RunnerObservation.option_values` (`BrowserTaskRunner.ts:141`);
  - `ManagedBrowserModule.runnerOwnedSessions` (`:282`).
- [ ] **Runtime and pilot leftovers:**
  - `ManagedBrowserRuntime.bumpRevision` (P0-5);
  - `MANAGED_BROWSER_PILOT_PLATFORM_IDS`, still imported (`ManagedBrowserModule.ts:11`); the tool text still says "YouTube pilot" (`skillsRegistry.ts:4930`).
- [ ] **Stubs and dead branches:**
  - the `BROWSER_TASK_FOCUS_WINDOW` stub returns `focus_not_supported_yet` (`managed-browser-ipc.ts:265-273`);
  - `HandoffCoordinator.ts:68-84`: `void handoffOpened`, and a no-op `onAbort`;
  - `void revalidated` (`LoginFormFiller.ts:368`) and `void request` (`BrowserCredentialLoginService.ts:223, 410`);
  - the `PRESS_KEY` case in `toRunnerAction` (`BrowserTaskRunner.ts:995-996`) is unreachable;
  - the "register" mode in the filler and the card's "Create account" wording are unreachable (A-FR-12).
- [ ] **Settings drift:**
  - `MANAGED_BROWSER_GLOBAL_SESSION_LIMIT = 1` (`config/managedBrowser.ts:29`) contradicts the PRD default of 3 and its own comment;
  - `maxSessionsPerSite` defaults to a literal 2 instead of `MANAGED_BROWSER_MAX_SESSIONS_PER_SITE_DEFAULT` (`ManagedBrowserSettingsModule.ts:160`).
- [ ] **Stale comment:** `BrowserDecisionValidator`, referenced in a comment (`schemas/api/browserDecision.ts:118-119`), does not exist.

### X9 — Project-rule violations (constitution and CLAUDE.md)

- [ ] **Dynamic `import()`, which is forbidden.** Convert all of these to static imports. The async `setUserWait` import in `HandoffCoordinator.ts:55` can also apply `true`/`false` out of order.
  - `BrowserTaskRunner.ts:406` (inside the hot loop);
  - `ManagedBrowserAiToolService.ts:1190, 1209, 1214, 1266, 1334, 1342, 1356, 1357, 1378, 1381, 1404, 1407, 1427`;
  - `ManagedBrowserModule.ts:506, 915, 1661, 1688-1690, 1766, 1784, 2015/2016`, plus `require` at `:2296, 2470`;
  - `managed-browser-ipc.ts:111, 142, 237, 258`;
  - `BrowserCredentialLoginService.ts:227-229, 420-422`;
  - `socialAccountModule.ts:436-437, 442-443`;
  - `runBrowserTasksTool.ts:108, 114, 354`;
  - `skillsRegistry.ts:4424-4427, 5369`;
  - `HandoffCoordinator.ts:55`.
- [ ] **`any` and type lies:**
  - `socialAccountModule.ts:181, 207` (`null as any`);
  - `ProxyModule.ts:61` (`Promise<any>`);
  - `LoginFormFiller.ts:212` (`null as unknown as HTMLInputElement`);
  - `as never` at `ManagedBrowserAiToolService.ts:1090, 1218, 1283`;
  - `as unknown as …` at `ManagedBrowserAiToolService.ts:298-299, 507, 778`, `runBrowserTasksTool.ts:279`, `Proxy.model.ts:113` and `ProxyAiTools.ts:471`;
  - `ManagedBrowserSettingsPanel.vue:481-485, 577`: the patch type omits the five feature keys, hidden behind `as Parameters<typeof persist>[0]`.
- [ ] **Unvalidated persisted data and debug output:**
  - the login recipe is read with an `as` cast instead of Zod (`BrowserCredentialLoginService.ts:603-633`), which breaks the "Zod at load boundaries" rule;
  - debug `console.log` block in `socialaccountdetail.vue:404-422`; `console.warn` instead of `log` in `Proxy.model.ts:144`;
  - formatting: `ManagedBrowserModule.ts:2024` has `}); const results` on one line.
- [ ] **E2E rule:** `test/e2e/specs/browserSignIn.test.ts:2` imports `@/`, but the E2E layer must use relative imports only.

### X10 — Missing i18n (all six languages: en/zh/es/fr/de/ja)

Existing `browserSignIn.*`, `browserTasks.*` and `browserSite.*` keys have parity. Strings for the missing UI do not exist yet. Add each one to all six files together:

- [ ] Task states: `taskResuming`, `taskStopping` (the card wrongly reuses `taskCancelled` at `BrowserTaskBatchCard.vue:92`), `taskInterrupted` (the card maps interrupted to `taskFailed`), and "Paused by you".
- [ ] "N tasks need you" badge; waiting reason and countdown; batch confirmation (task and site list).
- [ ] Take control; Resume with instructions; Open browser.
- [ ] Settings labels: maximum concurrent browsers, sub-agent model, browser-decision model override, native profile, separate capability-test results, and the privacy disclosure (§12, including "usernames are sent to the active LLM provider").
- [ ] Proxy: direct badge, host and country label, account-proxy change confirmation, and failure reasons (`proxy_connect_failed`, `proxy_auth_failed`, `tunnel_failed`).
- [ ] Sign-in: per-account "allow AI to use this account" toggle, the one-time opt-in prompt, and handoff reasons ("Saved password was rejected", "Verification code required").

---

## 3. Runner, provider and decisions (D-FR-01–25, §7, §8, §10)

### Defects

- [ ] **Custom→hosted leak during a mode switch (D-AC-01, D-03).**
  - **Where:** the runner freezes only a version key. `ChatCompletionDecisionClient` checks `configChanged()` before and after its `await` (`DecisionClients.ts:148, 160, 182`), but `AiChatApi.openAIChatCompletion` re-resolves the provider on every call (`aiChatApi.ts:2254-2264`).
  - **Effect:** a local→hosted switch between the check and `resolveForChat()` sends the decision prompt to hosted. The answer is discarded afterwards, but the page data has already left the device.
  - **Fix:** resolve the local configuration and key once at admission, call `OpenAICompatibleProviderClient` with that frozen configuration, and refuse if the live mode is no longer `local`.
- [ ] **Untargeted operations bypass `validateDecisionActionStructure`.** SCROLL, GO_BACK, PRESS_KEY, NAVIGATE and EXTRACT run at `BrowserTaskRunner.ts:392-518`, and DONE, ESCALATE and WAIT at `:352-391`, all before validation at `:520`. So `operation_not_allowed` and `unexpected_fields` are never checked for them.
  - EXTRACT is in `TARGETED_OPERATIONS` (`schemas/api/browserDecision.ts:37`), but no candidate role offers it, so it works only because of the bypass. Validate first for every operation.
- [ ] **Loops that spend the budget without feedback.**
  - `recent_actions` is always `[]` (`BrowserTaskRunner.ts:697`), so the model cannot see what it already tried.
  - These rejections `continue` without counting an equivalent failure or telling the model why:
    - NAVIGATE not same-site (`:418`);
    - EXTRACT ref missing (`:427`);
    - key or URL missing (`:449`; a URL-less NAVIGATE is mislabelled `key_required`, `:448-450`);
    - unsupported operation (`:549`);
    - WAIT (`:387-391`).
  - A DONE that fails verification gives no signal, so the model re-proposes DONE (`:376-382`).
  - `target_not_in_observation` increments the equivalent-failure counter with no threshold check (`:540-543`).
  - Invalid-decision and missing-target paths increment the counter regardless of `failureKey` (`:523, 542`), so they are not truly equivalent failures (D-FR-25).
- [ ] **No-criteria tasks can never complete.** With no `completion_criteria`, `verifyCompletion` returns `no_completion_criteria` (`:1007-1012`), and the task ends `verification_failed_budget_exhausted`. The criteria are optional in the tool schema (`skillsRegistry.ts:5314`). Require at least one criterion, or ship the LLM verifier. `element_present` also uses a loose `name.includes`/role match (`:1027-1029`).
- [ ] **Budget enforcement mismatches with §8:**
  - The per-leaf timeout ignores the budget and always uses `perStepWorkerTimeoutDefaultMs` (`ManagedBrowserAiToolService.ts:1266-1271`).
  - A DONE that fails verification consumes `recoveryCalls` (`BrowserTaskRunner.ts:377-381`); verification must be counted separately.
  - The contract contradicts itself on raising budgets: the tool schema says "budget REDUCTIONS (never raises)" (`schemas/aiTools/browserTask.ts:7`), but `buildTaskBudget` clamps to the hard ceiling (`BrowserTaskLimits.ts:79-101`), so a model can raise steps from 30 to 100. Pick one behaviour.
  - The "every 5 steps (chat route)" progress check applies to every route.
  - `run_browser_tasks` defaults to concurrency 2 (`skillsRegistry.ts:5384`); the PRD says 3.
- [ ] **Decision client issues:**
  - Retry: every error is retried (401, 400 and parse errors), not just 429 and transient failures, and the 1 s backoff sleep ignores the abort signal (`DecisionClients.ts:141, 155`).
  - `normalizeWireResult` accepts a bare action for hosted responses too (`:313-331`).
  - Code fences are not stripped before `JSON.parse` (`:186`).
  - Token usage is stuffed into `calibration_version` (`:199-206`), which misattributes calibration (D-AC-08).
- [ ] **Runner abort and timing races:**
  - An abort that has already fired is never seen: the runner checks `signal.aborted` (`:468, 568`) and then awaits a dynamic import (`ManagedBrowserAiToolService.ts:1266`) before adding its listener (`:1274`). `runActions` never rechecks `context.signal.aborted` before dispatch (`:747-751`).
  - After `step_timeout` (`:1294-1303`), the original authorized call keeps running and its abort listener is never removed, while the runner observes concurrently.
  - The runner ignores the observation returned with `ACTION_RESULT` and always calls `observe` again (`BrowserTaskRunner.ts:504, 616`), which costs a worker round per step.
- [ ] **`page_revision: 0` fails validation.** `runAuthorizedForRunner` sends `status.pageRevision`, which can be 0 (`:1091`), but the schema requires a positive integer (`schemas/aiTools/managedBrowser.ts:74`).
- [ ] **D-FR-10 startup sweep:** `markUnfinishedInterrupted` runs inside `registerManagedBrowserIpcHandlers(win)` (`managed-browser-ipc.ts:108-118`). If that runs per window, it marks live tasks as interrupted. Move it to one-time app startup.
- [ ] **D-FR-10c routing guidance:** `BuiltInToolCapabilitiesPromptSection.ts:62-67` is unconditional. It advertises `browser_execute_task` to hosted users (always unavailable) and ignores the kill switches. Gate each guidance row on availability.
- [ ] **D-FR-01 gate gaps:**
  - `browser_site_upsert` skips `ensureBrowserEnabled()` (`ManagedBrowserAiToolService.ts:1507-1527`);
  - `run_browser_tasks` parses arguments (`skillsRegistry.ts:5372`) before the AI gate (`runBrowserTasksTool.ts:108-113`).
- [ ] **D-FR-02:** nothing listens for provider-setting changes, so in-flight inference is not cancelled; it is only discarded after the request finishes. Subscribe to provider-configuration changes and abort.
- [ ] **D-FR-07:** `emitProgress` is never called by `executeTask` or the runner, so there is no streamed progress. Admission does not record `toolCallId`, `jobId` or `ownerAgentId`, and `agentTaskId` is always null (`BrowserTaskModule.ts:40`).
- [ ] **§10:** disabling acceleration is checked only at admission (`ManagedBrowserAiToolService.ts:1171`). Active tasks are not cancelled safely.

### Missing features (not started)

- [ ] **D-FR-05:** bounded planner (one call), known value bindings, and a distinct planning-failure outcome. Today `subgoal: null` (`BrowserTaskRunner.ts:687`).
- [ ] **D-FR-16:**
  - NAVIGATE provenance: the URL must come from an observed link (`hrefOrigin` exists at `schemas/worker/managedBrowser.ts:653` but the candidate builder never uses it) or from the trusted plan, not just the same registrable domain;
  - EXTRACT into a declared schema;
  - per-page offered operations from capabilities.
- [ ] **D-FR-18:** formatting negotiation (verified JSON Schema → tool calling → strict JSON, with bounded repair). Only `response_format: json_object` is sent (`DecisionClients.ts:171`). A provider that rejects it fails both attempts.
- [ ] **D-FR-19 / §6.5:** ESCALATE and `llm_required` end the task immediately as `partial` (`BrowserTaskRunner.ts:306-313, 384-386`). They must enter LLM recovery. Bounded alternative-model routing is missing.
- [ ] **D-FR-20/21:** a field-text helper (bounded, type- and length-checked, rejects credential-shaped values), plan-binding resolution, and the helper-result reuse rules. Today FILL text comes straight from the decision model (`:950-964`).
- [ ] **D-FR-22:**
  - recovery input lacks visible page text (the prompt never includes `visibleText`, `DecisionClients.ts:289-303`);
  - its `recent_actions` entry is fabricated (`operation` defaults to `"CLICK"`, `:724-729`);
  - it cannot request a richer observation or user input;
  - "Recovery needs user input → ask in parent and wait in-job" is missing.
- [ ] **D-FR-24:** an optional selected-provider LLM verifier, budgeted separately.
- [ ] **D-FR-13/14:**
  - the candidate shortlist is the first 16 elements in document order, with no goal ranking (`BrowserCandidateBuilder.ts:70-75`), and `candidate_id` is the raw ref, not the opaque label its comment claims (`:4-5, 93-94`);
  - constraints and the goal are silently truncated (`BrowserTaskRunner.ts:685-687`);
  - no bounded scroll or reobserve coverage loop;
  - no shortlist-recall measurement.
- [ ] **A-FR-14:** the runner must call the sign-in service at a login wall instead of going to a generic handoff (`BrowserTaskRunner.ts:840-854`).
- [ ] **§7 settings:**
  - a browser-decision section: "Use my chat provider", a model override that must exist at that provider, and a native decision profile;
  - connection tests that report chat, structured-output and native capabilities separately (`AIProviderConnectionTester.ts:22-27`);
  - plain-language §12 privacy copy;
  - a visible provider-change interrupt.

  Today only a "Fast browser decisions" switch exists (`ManagedBrowserSettingsPanel.vue:101-110`).
- [ ] **§10:** per-engine switches (hosted, chat, native). Phase 9 native pilot (Jev/Laya adapters, calibration).

---

## 4. Observations and approval binding (D-FR-11–15a, D-FR-27)

- [ ] **D-FR-11, challenge order:** the worker sends `ACTION_RESULT` with a `state:"ready"` observation (`WorkerSession.ts:510`; `buildObservation` hard-codes `ready` at `:1149`) and **then** runs challenge detection (`:532`). The comment at `:487-489` says the opposite.
  - The main process caches that observation, but `CHALLENGE_DETECTED`/`HANDOFF_REQUIRED` handling (`ManagedBrowserModule.ts:1498-1517`) does not update `pageRevision` or clear `lastObservation`, even though detection reset the worker registry (`WorkerSession.ts:1013`).
  - When `observation` is null, the main process ignores `outcome.pageRevision`.
  - **Fix:** detect before building the observation. On a challenge, send `observation:null` plus the new revision, and have the main process clear its cache.
- [ ] **D-FR-12, secret leaks through `valueSummary`.** The observation's `inputType` is the raw `type` attribute (`BrowserObservationService.ts:155-156`), and `summarizeInputValue` masks by type only (`ResultSanitizer.ts:155`).
  - **What leaks:** `<input type=text|tel|number autocomplete=one-time-code|cc-number|cc-csc|cc-exp>`, and textareas.
  - **Dead entries:** `SENSITIVE_INPUT_TYPES` values `pin`, `security-answer` and `text_password` can never match a real `type`.
  - **Fix:** reuse the executor's autocomplete/inputmode probe rules (`BrowserActionExecutor.ts:121-129`) in the collector.
- [ ] **D-FR-12, `[credential]` depends on the page-mutable `data-mb-cred`** (`LoginFormFiller.ts:452-454`; collector `:154`). A page re-render strips it and exposes the username raw. Also track stamped fields on the worker side.
- [ ] **D-FR-12, descriptor mismatches make elements permanently unactionable.**
  - Password fields: the registry stores the raw name (`:373-376`), but the main process stamps `expectedName:"[credential]"` (`ManagedBrowserAiToolService.ts:692-698`). Every click or hover on a password field fails as stale.
  - Redacted names: the registry stores the redacted name (`:277`), but `readElementDescriptor` returns the raw name (`:215-222`).
  - **Fix:** compare digests, or apply the same transforms on both sides.
- [ ] **D-FR-12, control state:** expanded, required, readonly and focused are missing from control state. Per-element allowed operations exist only in runner candidates.
- [ ] **D-FR-13:** focused and dialog controls are prioritized, then re-sorted into document order (`BrowserObservationService.ts:131-132`). Suggestions and task-relevant regions are not prioritized.
- [ ] **D-FR-15:** the executor never checks disabled or occluded state (`isIntersectingViewport` is declared but unused). `scrollIntoView` runs **after** revalidation. The legacy `select.values` passes arbitrary strings through (`BrowserActionExecutor.ts:150-157`, D-AC-04).
- [ ] **D-FR-15a, registry eviction and pins:**
  - **Partial eviction:** `register()` evicts single entries from committed observations (`PageReferenceRegistry.ts:154-161`). With 120 elements and 200 entries, a second observation routinely clips about 40 of the first one's refs. Evict whole buckets, or size the registry as `maxObservations × maxInteractiveElements`.
  - **Pin leaks:** `recordApproval` unpins the **current** `lastObservation`, not the one pinned (`ManagedBrowserModule.ts:430-436, 1001` vs `ManagedBrowserAiToolService.ts:638-641`). Undecided approvals stay pinned forever, and pinned buckets are excluded from every bound (`:296-318`), so the registry saturates into `e_nohandle` (`BrowserObservationService.ts:386-395`). Store the pinned observation ID with the pending approval, and unpin it on decision or expiry.
  - **Unpinned decisions:** pending runner decisions and LLM think time are never pinned.
  - **Leaked pending buckets:** `beginObservation` (`:318`) has no `try/finally` around `commitObservation` (`:424`), so a throw leaves a permanent pending bucket.
  - **Silent pin failures:** `pinObservation` on an evicted ID returns false silently, and the pin request is fire-and-forget.
- [ ] **D-FR-27, fingerprint gaps:**
  - `context` is null for fill and click (`ManagedBrowserAiToolService.ts:1649-1655`; the comment claims fill carries the form action), so two "Submit" buttons in different forms collide;
  - the observation ID is not bound (`BrowserApprovalFingerprint.ts:13-16`), contrary to the PRD;
  - `page_revision` comes from the model and is never compared with `record.pageRevision` in `runActions` (only `evaluateScript` compares, `ManagedBrowserModule.ts:1201`);
  - consume requires an exact revision match, so any reobservation after navigation (or P0-5) forces a fresh approval, which is the loop D-AC-05 forbids.

---

## 5. Sign-in and password safety (A-FR-01–21, Q-01, Q-02)

### Defects

- [ ] **P0-9** (cards never mounted) and **X1** (eTLD+1) apply here.
- [ ] **A-FR-16/19, safety refusals must hand off but return `failed`.** Every instance:
  - the worker outcome `unknown` covers `password_field_unsafe`, `origin_mismatch`, `ambiguous_*`, `password_field_mutated`, `unexpected_field_change`, `recipient_set_changed`, `fill_readback_mismatch`, `form_not_found` and `two_step_no_transition` (`BrowserCredentialLoginService.ts:591-595`);
  - service-level `insecure_page` and `origin_mismatch` (`:186-194`);
  - `domain_mismatch` (`:392-398`).

  Call `requestHandoff` with a specific reason for every refusal after the session check.
- [ ] **A-FR-10, a rejected password is retried after the cooldown.** `isSignInCoolingDown` (`socialAccountModule.ts:495-507`) is purely time-based. On `wrong_password`, mark the credential version as rejected and refuse automated use until the password changes.
- [ ] **A-FR-10, no cooldown when the fill throws.** `fillAndAssess` is `try/finally` with no `catch` (`BrowserCredentialLoginService.ts:506-599`). A worker timeout (45 s), worker exit or `guard()` throw skips `recordLoginFailure` even though the password may have been submitted. Catch, record the failure, and hand off.
- [ ] **A-FR-10, the cooldown is recorded for refusals before any typing** (`:567-572`), including `fill_aborted_user_control`. Record only `wrong_credential`, `challenge` and post-submit unknowns.
- [ ] **A-AC-04, the password field's type is not rechecked after the password is set** (`LoginFormFiller.ts:390-473`). A page `input` handler can flip it to `type=text` before submit. After setting the value, recheck `pw.type === "password"`, `pw.isConnected` and `pw.form === chosen.form`; clear the fields and abort on mismatch.
- [ ] **Worker errors are mis-routed.** `WorkerSession.fillLoginForm` has no `catch` (`:780-811`). Exceptions reach `index.ts:280-284`, which logs the raw `error.message` (not `toSafeErrorMessage`) and sends `WORKER_ERROR` with request ID `"evt-handler"`, so the main request hangs to the 45 s timeout. Catch inside the method, call `emitError(requestId, …, toSafeErrorMessage(e))`, and wipe the fields in `finally`.
- [ ] **Field detection gaps and false refusals** (`LoginFormFiller.ts`):
  - any form with two visible password fields aborts login (`:185-187`);
  - `querySelector('input[type=password]')` takes the first, possibly hidden, password input, so `sameNode` fails as "mutated" (`:352-356`);
  - `hitTestable` does no `scrollIntoView`, so off-screen fields are refused (`:108-114`);
  - untyped `<input>` elements (which default to text) are ignored (`:189-192, 246-249`);
  - formless SPA logins are unsupported (`:154`), and the Enter branch (`:469-471`) is unreachable;
  - a stolen focus returns `ok:true` without submitting (`:462-464`).
- [ ] **A-FR-21:** the step-1 username-only round has no other-field snapshot, read-back or tamper scan before `requestSubmit` (`:236-291`). An SPA step change with no URL change just waits 4 s.
- [ ] **A-FR-08, the "wipe" is cosmetic.** Only the local `input` object is cleared (`WorkerSession.ts:807-811`). The password survives in:
  - `message.password` and `target.password` in the worker;
  - `submitted.password`, the registry promise value and the IPC JSON in the main process;
  - `password.value` in the card on non-success paths (`BrowserCredentialCard.vue:97-99`).

  Clear every field you control, and document that JavaScript strings cannot be zeroed.
- [ ] **Credential card issues** (`BrowserCredentialCard.vue`):
  - `submit`, `signSelf` and `cancel` have no `try/catch` (`:84-128`);
  - Cancel needs dummy `"-"` values because of `min(1)` (`:110-111, 122-123`);
  - Cancel and "I'll sign in myself" look identical to the service; both open a handoff (`BrowserCredentialLoginService.ts:253-263`);
  - the title is not reactive to locale (`:74`);
  - "Save" defaults to `true` (`:78`), and saving silently turns on `ai_use_enabled` (`socialAccountModule.ts:529`);
  - a saved account with a username but no password still shows an editable username (A-FR-05 says "password only").
- [ ] **Weak request IDs and sender checks:** the card request ID uses `Math.random` (`BrowserCredentialLoginService.ts:95`); use `crypto.randomUUID()`. The submit IPC has no sender-frame check.
- [ ] **B16:** `list_social_accounts` (`skillsRegistry.ts:4463`) and `getAccountDetail` (`socialAccountModule.ts:190`) decrypt every password even though the tool strips them. Add a non-decrypting list method for the tool path.
- [ ] **A-FR-09:** success and failure come from the filler's own probe, not the adapter's `assessAuthentication`, so YouTube's adapter is bypassed on the credential path.

### Missing features

- [ ] **A-FR-01:** the worker never suggests `browser_sign_in` on `LOGIN_REQUIRED` or `sensitive_field_visible`; the notices (`ManagedBrowserModule.ts:1485-1496`; `BrowserObservationService.ts:421`) carry no hint.
- [ ] **A-FR-03:** for a single match, "try the account's encrypted cookie snapshot first, then the password" does not exist.
- [ ] **A-FR-04:** settings copy stating that usernames go to the active LLM provider. The panel shows only a bare switch (`ManagedBrowserSettingsPanel.vue:61-70`).
- [ ] **A-FR-12 / Q-02:** registration. `intent:"register"` always hands off (`BrowserCredentialLoginService.ts:171-176`). Missing: a separate switch, the approval path and the "Create account" card. The tool description (`skillsRegistry.ts:5406`) misleadingly promises confirmation.
- [ ] **A-FR-15 / A-AC-01:** the sentinel test only checks `JSON.stringify(result)`. Extend it to logs, transcripts, notices, observations, screenshots and worker→main messages through the real app path.
- [ ] **A-FR-16:** same-site frame support. Today the filler is top frame only, which is safe but unsupported.
- [ ] **A-FR-19:** the checked keystroke fallback, with focus checks before and after.
- [ ] **A-FR-20:**
  - missing "LLM chooses among offered references" step: ambiguity fails as `ambiguous_login_form`;
  - `new-password` is not used for registration detection;
  - the recipe always records one step and `submitVia:"form"`, even for two-step logins.
- [ ] **Q-01:**
  - UI and IPC for the per-account "AI may use this account" toggle;
  - a one-time prompt listing existing accounts (`ai_use_enabled` defaults to `false` with no way to enable it, so pre-existing accounts can never be used);
  - expose eligibility and `last_login_failure_reason` in `list_social_accounts` and the account page.
- [ ] **A-AC-02:** the cooldown E2E test is `test.fixme` (`test/e2e/specs/browserSignIn.test.ts:94-101`).

---

## 6. Site registry (S-FR-01–06)

- [ ] **X1, X2 (ID race) and X3 (seed swallow)** apply here.
- [ ] **S-FR-04, end to end:**
  - wire `proposeExtraDomainsFromSession` → card → confirmed apply (P0-9);
  - the visited-domain ledger (`ManagedBrowserModule.ts:1716-1745`) covers the **whole session** and stores **registrable domains** (`google.com`) instead of the hostnames visited (`accounts.google.com`). Restrict it to the sign-in redirect window, so prompt-injected navigation elsewhere cannot be proposed;
  - `applyAdditionalDomains` (`BrowserSiteModule.ts:286-313`) has no confirmation-token or ownership check.
- [ ] **S-FR-03:** every rejection reason collapses into `site_upsert_failed` (`ManagedBrowserAiToolService.ts:1547`). Return structured reasons (`public_suffix`, `ip_literal`, `http_only`, `duplicate`).
- [ ] **S-FR-05:** unverified AI-created sites with no recipe are eligible for account sessions. The PRD requires a verified recipe or the generic adapter. Remove the pilot leftovers (X8).
- [ ] **S-FR-06, still not done.** Static `SocialPlatformList` / `PlatformSessionManifest` lookups remain at:
  - `socialaccountdetail.vue:232, 409-420`;
  - `socialaccount-controller.ts:42, 268`;
  - `socialAccountModule.ts:130`;
  - `socialaccount-ipc.ts:175`;
  - the `list_social_accounts` filter (`skillsRegistry.ts:4427-4459`);
  - `AccountSessionService.ts:299`;
  - `BrowserImportCoordinator.ts:114, 208`;
  - `ManagedBrowserModule.ts:529, 1410, 1897, 2100`.

  Add a site-list IPC for the renderer. AI-created sites (ID ≥ 100000) currently show as blank platforms and cannot be filtered.

---

## 7. Proxy (P-FR-01–09)

- [ ] **P0-6, P0-7 and P0-8** apply here.
- [ ] **P-FR-01, `auto` mode:** `auto` searches only account-linked proxies (`BrowserProxySelectionService.ts:141-165`), never the general pool, and silently picks another country when none matches. `lastCheckPassed` is never filled in (`ManagedBrowserModule.ts:1666-1674, 1696-1704`), so "recent passing check" has no effect.
- [ ] **P-FR-02:**
  - it does not wait for in-flight actions;
  - the cookie save is fire-and-forget (`:714`);
  - account-free sessions lose their in-memory cookies (`:1401`);
  - the session ID changes, and the sub-agent owner (`agentTaskId`) is dropped;
  - it returns a status instead of a fresh observation and revision.
- [ ] **P-FR-03:**
  - no confirmation card or flow;
  - no country comparison;
  - the proxy is never linked to the account after a successful proxied sign-in;
  - fail-open on a database error (X3).
- [ ] **P-FR-04:** the health check is reduced to a boolean (`ManagedBrowserModule.ts:2013-2033`), so structured reasons (`proxy_connect_failed`, `proxy_auth_failed` on 407, `tunnel_failed`) are never returned; see `classifyProxyError` in X8. `auto` targets get no health check at all.
- [ ] **P-FR-05:** the switch counter is keyed per conversation, account and platform, not per task. It never expires or is deleted (`:281`). It increments before the health check, so failed attempts use up the cap. Nothing blocks a switch while a challenge or handoff is pending.
- [ ] **P-FR-06:**
  - locale and `timezoneId` are never derived from `country_code` (`buildDefaultLaunchPolicy()` takes no options at `ManagedBrowserModule.ts:778`, and `composeLaunchArgs` gets no locale at `WorkerSession.ts:253-257`);
  - the timezone relies on the `TZ` environment variable (`:268`), which may not take effect on Windows Chromium;
  - the WebRTC flag (`BrowserFingerprintPolicy.ts:216-218`) is not verified by the fingerprint self-test.
- [ ] **P-FR-07:** `browser_usable` is computed (`Proxy.model.ts:68-71`) but dropped by `toSafeProxySummary` (`proxyAiToolTypes.ts:339-353`). `checktime` is actually the row's `updatedAt` (`Proxy.model.ts:65`), not the last check time.
- [ ] **P-FR-08:**
  - migration is lazy (rows migrate only when listed, `Proxy.model.ts:52-55`); add an eager, idempotent startup migration;
  - the lazy path can write back the encrypted **old** password if it races a user edit (`:132-150`); use a compare-and-set update;
  - clearing a password with `null` does nothing (`:109-118`: `null` → `?? undefined` → TypeORM skips the field), although the tool promises it clears (`skillsRegistry.ts:4604`);
  - `ProxyAiTools.ts:458` compares plaintext input with stored ciphertext, so it always reports "changed";
  - a real password starting with `ENC1:` is stored unencrypted;
  - a decrypt failure launches with the username and no password in `resolveAccountProxy` (`ManagedBrowserModule.ts:2505-2516`). That is still fail-closed, but it is logged nowhere;
  - `socialaccount-controller.ts:128-135` reads `randomProxy.password`, but the entity field is `pass`.
- [ ] **P-FR-09:** the session card shows only a generic "Proxy" chip when `proxyActive` (`ManagedBrowserSessionCard.vue:11-18`). It needs a host label, a country and a "direct" badge, and `SafeManagedBrowserStatus` needs those fields.
- [ ] **Proxy transport:**
  - proxy authentication covers only `pages[0]` (`WorkerSession.ts:280-291`), so SSO popups and new tabs get HTTP 407;
  - `https` proxies are launched as `https://host:port` (TLS to the proxy, `:246-248`), while the checker treats them as HTTP CONNECT (`proxy-controller.ts:216`). The two disagree.

---

## 8. Parallel sub-agents and user control (M-FR-01–13, C-FR-01–16)

### Defects

- [ ] **P0-10** (wrong conversation and owner) applies here.
- [ ] **C-FR-05, Pause and Take control do not stop sub-agents.**
  - **Where:** only `BrowserTaskRunner` checks the control gate (`:207-233`); `AgentRuntime` never does. The batch card never sends `sessionId` (`BrowserControlCards.vue:96-103`; the task events at `runBrowserTasksTool.ts:167-184` carry none), so `pauseSession` (`ManagedBrowserModule.ts:1946-1958`) never moves the browser to user control.
  - **Fix:** check the gate before each model call, each tool call and between actions, and carry `sessionId` in task events.
- [ ] **C-FR-09 / C-AC-03, user-wait accounting.**
  - **Global flag:** `isAnyWaitingForUser()` is true if **any** job anywhere is waiting (`runBrowserTasksTool.ts:285-286`; `ToolJobRegistry.ts:416-423`), so one handoff freezes every child's runtime everywhere. Use a per-task check.
  - **Pause time counts:** the runtime `setInterval` (`AgentRuntime.ts:526-547`) ignores the `paused` state, and its 1 s wall-clock ticks drift. Derive the deadline from `control.activeTimeMs(taskId)`.
  - **Parent poll not frozen:** the parent 30-minute poll (`AIChatQueryLoop.ts:345, 6486-6524`) freezes only when the `run_browser_tasks` job is flagged waiting, which never happens. Set the parent job's flag while any child is waiting or paused.
  - **Pause hits handoff expiry:** `pauseSession` uses `requestHandoff`, so a pause hits the 10-minute handoff expiry, which stops the session, before the 60-minute pause cap. Add a separate `user_paused` control state with no handoff expiry.
- [ ] **M-FR-09, sessions and leases leak when the child returns no `session_id`.** Cleanup happens only when the child output includes it (`runBrowserTasksTool.ts:350-359`; catch `:373-398`). Crash, cancel, Return-now and parent Stop all leak, and the leak counts against the global limit.
  - Conversation deletion does no browser cleanup (`AIChatConversationModule.ts:335-341`).
  - **Fix:** keep a `{taskId → sessionIds}` map, filled when sessions start with an `agentTaskId`, and stop every entry in the per-task `finally`.
- [ ] **C-FR-07, resume:** no page-revision advance, no transcript note, no allowed-site check and no same-account recheck (`ManagedBrowserModule.ts:1350-1371`). "Resume with instructions" text is echoed to the renderer and **dropped** (`managed-browser-ipc.ts:214-226`). Push the note and instructions into the agent transcript through `AgentRuntime`.
- [ ] **C-FR-02, sub-agent handoff does not block.** `browser_request_handoff` in a sub-agent returns immediately (`ManagedBrowserAiToolService.ts:979-998`); the blocking `HandoffCoordinator` is wired only into the runner (`:1377-1394`). The task label is not shown in the dialog.
- [ ] **M-FR-05, the consequential-action block is prompt-only.** `browser_run_actions` routes consequential actions to the normal approval card (`ManagedBrowserAiToolService.ts:619-645`). If the user approves, a sub-agent can submit or send. When the context carries a sub-agent owner and approval is required, return `needs_user: {type:"approval", proposed_action}` without opening a card.
- [ ] **M-FR-04:** the batch uses the generic tool confirmation (`skillsRegistry.ts:5362`), with no task or site list and no scoped grant of routine actions that expires with the batch. Children run with `allowInteractivePermissionPrompts:false` (`runBrowserTasksTool.ts:276`), so an ungranted "automation" category becomes a blocked tool (`AgentRuntime.ts:397-424`).
- [ ] **M-FR-02:**
  - `getDefaultAgentRuntimeDeps()` (`AgentRuntimeRegistry.ts:14-19`) supplies no `toolResultModule`, so large results are never externalized or granted;
  - `extracted`, `evidence` and the 1000-character `summary` limit are not enforced by the collector (`runBrowserTasksTool.ts:360-372`);
  - Return-now partial results drop the evidence gathered so far (C-FR-11).
- [ ] **M-FR-06:**
  - the same-account second task fails with `account_in_use` instead of queueing (`ManagedBrowserModule.ts:643-644`);
  - the memory check is a fixed 800 MB floor, not scaled by session count (`:600-603`);
  - the global limit constant is 1 (X8);
  - the per-site cap has a race (X2).
- [ ] **M-FR-01:** `agent-browser-operator` (`AgentDefinitionRegistry.ts:129-157`) lacks `browser_execute_task`, `check_tool_job_status` and `cancel_tool_job`, but **includes `browser_site_upsert`**, which is not in the PRD list and lets a child write shared site config (M-FR-11).
- [ ] **C-FR-12:** sub-agent waits are never recorded against the batch task ID, so `user_interventions` is empty in practice.
- [ ] **C-FR-14:** batch and sub-agent control state is in memory only, so nothing is marked `interrupted` after a restart (only runner rows are swept).
- [ ] **Batch card UI** (`BrowserControlCards.vue`, `BrowserTaskBatchCard.vue`):
  - finished batches are filtered out (`:65-67`), so the 30 s "linger for review" (`:124`) never renders;
  - nothing restores batches from the main process on mount or chat switch (`:121-133`); add a snapshot channel;
  - IPC rejections are unhandled (`:141-155`);
  - the buttons ignore task state (Resume shows while running);
  - Take control, Resume with instructions, Open browser, the "N tasks need you" badge, the waiting reason and the countdown are all missing (`BrowserTaskBatchCard.vue:28-55`).
- [ ] **Batch event sink:** wired through a dynamic import (`managed-browser-ipc.ts:142-147`), so early batch events can be lost. Use a static import (X9).

### Missing features

- [ ] **M-FR-10:**
  - per-provider concurrency limits;
  - 429 backoff (`transientRetryConfig.baseDelayMs: 0`, `AgentRuntime.ts:577`);
  - a total token and cost budget per batch, reported next to the parent context size.
- [ ] **M-FR-12:** a separately selectable sub-agent model (a real model at the same endpoint for custom providers), and a pluggable executor (`llm_agent` → `fast_runner`).
- [ ] **M-FR-13:**
  - Chromium anti-throttling flags for managed browsers (they exist only in legacy `browserManager.ts:247-249`), verified against the fingerprint self-test;
  - window tiling or offset.
- [ ] **C-FR-10:**
  - a handoff-dialog queue (first come, first served) with a "N tasks need you" badge;
  - a working Open browser action (the `BROWSER_TASK_FOCUS_WINDOW` stub);
  - never steal focus.
- [ ] **C-FR-15:** an "AI is controlling this window" window title, and auto-pause on repeated unexpected page changes.
- [ ] **C-FR-06:** hold and discard tool calls from a model response that was in flight at pause time, for sub-agents.
- [ ] **§7 settings UI:** maximum concurrent browsers (default 3, maximum 5; backend only at `ManagedBrowserSettingsModule.ts:154-159`) and a sub-agent model selector.

---

## 9. Acceptance evidence still missing (PRD §9)

| ID | Status | What must be shown |
| --- | --- | --- |
| D-AC-01 | Fail | Decision and recovery requests reach only the frozen provider (fix C3 / frozen client). Test a local→hosted switch mid-request. |
| D-AC-02 | Fail | An unsubscribed custom-provider user runs a real `browser_execute_task` end to end (P0-1). |
| D-AC-04/05 | Fail | P0-3, P0-4, the revision loop, and fingerprint gaps closed. |
| D-AC-06/07 | Partial | Main-process timeout, crash and executor exceptions become unknown (X5). Stop aborts inference and ends the task `cancelled` (X4). |
| D-AC-08 | Missing | Native adapter, honest usage attribution, model-specific budgets. |
| D-AC-09 | Partial | LLM verifier, or required criteria (no-criteria tasks never succeed today). |
| D-AC-10 | Missing | Electron E2E for `browser_execute_task`, and a paired performance evaluation across six languages: shortlist recall, p50/p95, cost per verified success. |
| A-AC-01 | Partial | A sentinel scan across logs, transcripts, notices, observations and worker messages on the real app path. |
| A-AC-02 | Partial | Un-`fixme` the cooldown E2E test; wrong password is not retried after the cooldown either. |
| A-AC-03 | Fail | Shared-host suffix (X1). Same-site frame behaviour. |
| A-AC-04 | Partial | Type flip after the password is set; decoy without autocomplete. |
| A-AC-05 | Fail | Card mounted and submitted through the real chat UI (P0-9). |
| S-AC-01 | Partial | ID allocation race (X2). |
| S-AC-02 | Untestable | Path not wired. Must hold once wired, with a confirmation token. |
| P-AC-01 | Fail | P0-6, P0-7, structured failure reasons. |
| P-AC-02 | Fail | P0-8, eager migration. |
| M-AC-01 | Partial | Crash isolation works; the crashed child's session leaks. |
| M-AC-02 | Partial | Holds only because conversation IDs are unique; there is no task-level owner check. |
| M-AC-03 | Fail | P0-10. |
| C-AC-01 | Fail | A sub-agent handoff that blocks while another task completes. |
| C-AC-02 | Fail | Gate in `AgentRuntime`; revision bump on resume. |
| C-AC-03 | Fail | A 45-minute wait without tripping the parent poll, child runtime or handoff expiry. |
| C-AC-04 | Partial | Remove `browser_resume_after_handoff` from the model; Stop also stops sessions. |

The browser E2E specs other than sign-in are still marked `fixme` (commit `16203c51c`) until the Electron app-hook layer lands.

---

## 10. Suggested fix order

1. **Execution and safety blockers:** P0-1 (runner lease), P0-3, P0-4 and P0-5 (approval bypass, `press_key`, revision regression), and X6 (return `stopCode`/`extracted`). Each needs an integration test that goes through `ManagedBrowserAiToolService` → `ManagedBrowserModule`, not fake dependencies.
2. **Security:** X1 (`tldts` plus live-hostname checks), P0-8 (proxy password readers), and the C3 provider-leak race.
3. **Broken wiring:** P0-6/P0-7 (proxy start and switch), P0-9 (cards and S-FR-04), P0-10 (root conversation and task owner).
4. **Truthful outcomes and races:** X2, X4 and X5.
5. **Sub-agent control:** gate in `AgentRuntime`, per-task wait accounting, the parent-poll freeze, session cleanup, a separate pause state, resume notes and instructions.
6. **Missing features:** planner and bindings, field helper, verifier, format negotiation, hosted client, §7 settings, per-engine switches, Q-01 opt-in, registration, M-FR-10/12/13, C-FR-10/15.
7. **Rule cleanup:** X9 (dynamic imports, casts) and X10 (i18n for every new string).
8. **Acceptance:** un-`fixme` the E2E specs, then run the §8/§9 evaluation.
