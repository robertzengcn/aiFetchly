# Browser decision acceleration — 2026-11-15 pass 8 recheck TODO

Date: 2026-11-15. Audited worktree: `E:/project/aiFetchly-bda`. Branch: `feature/browser-decision-acceleration`. HEAD: `cf5d9a861` (`docs: record the seventh pass (G01/G03/G05/G06 items) in the recheck audit`).

**2026-11-16 closure pass:** W01–W09 are CLOSED — commits
`d1ef9afb4`(W01) → `d408583ec`(W02) → `79fafaf04`(W03) →
`15c413b5c`(W04) → `199806a72`(W05) → `a04514994`(W06) →
`562737526`(W07) → `ddc2fbfb1`(W08) → `2891c7c7d`(W09) →
`3ee00c3f8`(R02/R03/R04 quick items). Summary: W01 the hosted client
aborts held-open requests on a config change; W02 partial/interrupted
are their own terminal states across the control record, DB phase, and
batch card (six-language labels); W03 the helper cache key carries the
provider revision and invalidation matches the parsed field name; W04
a failed proxy decrypt fails the check with proxy_auth_failed without
launching the checker, and typed connect/auth/tunnel reasons flow
through switch errors; W05 an alias chat default fails closed instead
of picking the first /models id; W06 sub-agent notices, credential
cards, and approval prompts publish on the ROOT conversation with the
task label; W07 the agent loop consults the control gate BEFORE the
model call (pause-before-request sends nothing; pause-during-request
executes none of the response's tool calls; pause ends blocked, never
cancelled); W08 a child's consequential action returns the structured
needs_user proposal instead of throwing, and the batch confirmation
card gates the start (tasks+sites preview, grant expires with the
batch); W09 the busy-account queue emits `queued` (never
waiting_for_user), polls the lease, holds a per-account reservation,
and a crash before session_id releases the lease. R-items closed: the
social-account detail page no longer console.logs platform data, the
worker never calls bringToFront on launch (C-FR-10), proxy_list
carries browser_usable + country + last check (P-FR-07), and the
runner's resume appends the C-FR-07 note ("the user controlled the
browser; observe before acting") with instructions on every resume.
Focused sweep at the closure HEAD: 609 tests passed across 49 files
(browserDecision, browserAgents, managedBrowser, proxy suites,
AgentRuntime.permission, agentTaskCancel) plus 23 component tests.
Still open: R01 (negotiation modes, verifier, recall measurement),
remaining R02/R03/R04 feature work (registry switch-over, password
bytes, sentinel scope, sub-agent model, dedupe save, handoff dialog
queue, window title), R05 (real E2E drivers, held-out evaluation),
and the pre-existing Windows-only outbound-email-gate SQLite fixture
interference (verified failing identically before this pass).

Specifications:

- [PRD](browser-decision-acceleration-prd.md) v1.1 (2026-11-01)
- [Technical design](browser-decision-acceleration-technical-design.md)
- Prior passes: [2026-11-15 audit](browser-decision-acceleration-audit-2026-11-15-todo.md), [recheck](browser-decision-acceleration-audit-2026-11-15-recheck-todo.md)

**Verdict: the PRD is not complete.** E01–E20 and V01–V06 are closed in this tree. The seventh pass also exposed disabled candidates, ranked the shortlist by the task, labelled the session-card proxy, and wired session-card pause and take-over into the control service. This pass found the same defect classes still open on neighboring paths, plus requirement groups that were never built.

This document is a source audit of HEAD `cf5d9a861`. Suites were not re-executed. Line numbers refer to that commit. Do not reopen a closed item unless a row below names the remaining hole.

## Closed — do not reopen

| Area | Evidence at this HEAD |
| --- | --- |
| Native profile reaches the runner (E01) | Chat client is built only when `decisionClient === undefined` (`ManagedBrowserAiToolService.ts` 1487–1565) |
| Settings model override is sent; an alias override fails closed (E02, the override half) | `chatDecisionModel` read at 1505–1514 |
| Browser tools pass execution context and reject a foreign conversation (E03) | No `(a) => service.method(a)` registrations remain in `skillsRegistry.ts` |
| Model cannot call `browser_resume_after_handoff`; handoff waits on the job (E04) | Tool removed from the model list; runner `awaitHandoff` at `BrowserTaskRunner.ts` 594–600 |
| Secret-named fills are refused before typing; helper is wired (E05) | `BrowserTaskRunner.ts` 908–918; helper passed at `ManagedBrowserAiToolService.ts` 1715–1719 |
| Search-task proxy create/update fail closed; editor does not return `pass` (E06, those paths) | `SearchModule.ts` 1149–1150 throws `proxy_decrypt_failed`; update throws `proxy_encrypt_failed` |
| Country-strict `auto`, task-owner proxy switch, proxy link after sign-in (E07, E08, E10) | `BrowserProxySelectionService.ts`; switch passes `agentTaskId` |
| Criterion and role bounds, worker full-URL gate, fresh-observation recovery, dispatch-aware timeout (E11–E15) | Runner and worker gates |
| Cookie snapshot before password fill (E16) | `BrowserCredentialLoginService` |
| Registration returns `registration_disabled` and does not open a handoff (E17 cut) | `BrowserCredentialLoginService.ts` 357–364. A-FR-12’s card is still a product gap; see R02 |
| Safety failures open handoff; dialog copy names a rejected password and a verification code (E18) | Credential service and language files |
| Regional S3 and `blogspot.co.uk` are distinct suffixes (E12) | `RegistrableDomain.ts` 57–69 |
| SIGN_IN handoff blocks in-job (V02) | `BrowserTaskRunner.ts` 594–600 |
| Chat and native clients abort an in-flight call when provider config changes (V03, those two clients) | `DecisionClients.ts` 283–288; `SystemOneDecisionClient.ts` 98–100 |
| Inner gate maps `task_interrupted` / `task_failed` (V04, that catch) | `BrowserTaskRunner.ts` 509–510 |
| Oversized SELECT values are omitted, not offered truncated (V05) | Observation collector |
| Disabled and occluded targets are refused before dispatch (V06) | `BrowserActionExecutor.ts` 762–778 |
| Disabled candidates are exposed; shortlist is task-ranked (G01 part) | Candidate builder |
| Session card shows host, country, and a direct-traffic badge (P-FR-09) | `ManagedBrowserSessionCard.vue` 12–31 |
| Session-card pause and take-over drive the control service (C-FR-16, that card) | Seventh-pass commit `ffcf0c218` |
| Concurrent-browser cap is in settings (default 3, max 5) | `ManagedBrowserSettingsPanel.vue` 238, 768–771 |
| `browser_site_upsert` is off the child allow-list | `AgentDefinitionRegistry.ts` 155–157 |
| Resume button opens the instructions dialog (V01, C-FR-04 opener) | `BrowserTaskBatchCard.vue` 80 |

## Confirmed defects

Each box is open. Close it on the production path, with a regression for that path.

### W01 — P1 — the hosted decision call is not cancelled when provider settings change

- [ ] Abort the in-flight hosted HTTP call the same way chat and native already abort. Discard a body that returns after the abort. Apply the same watch to planner and helper calls, because they use the same client. Surface the interruption in the chat UI, not only as `provider_config_changed` inside the tool result.

**Requirements:** D-FR-02, PRD §7. Same class as V03. Chat (`DecisionClients.ts` 283–288) and native (`SystemOneDecisionClient.ts` 98–100) poll every 500ms and abort. Hosted does not.

**What the code does:** `HostedDecisionClient.decide` checks `configChanged()` before `postDecision` and again after the body returns (`DecisionClients.ts` 130–142). The request itself uses the outer `signal`. Nothing aborts that signal when the config key changes during the wait. A late body is dropped only if the check after return happens to see the new key. The settings UI has no interrupt notice.

**Observed result:** a provider change during a hosted decision lets the old request finish. Page data for that call has already left the machine. The user is not told the task must be admitted again.

**Closure:** a held-open hosted request is aborted when the config key changes, the late body cannot act, and the chat transcript says the task was interrupted.

### W02 — P1 — the runner stores every non-completed, non-cancelled ending as `failed`

- [ ] Persist `partial` and `interrupted` as those states. Keep `failed` for failures. The tool result and the control record must use the same state.

**Requirements:** D-FR-09, C-FR-11, C-FR-12. Same class as V04: one wait boundary was fixed, the terminal writer was not.

**What the code does:**

```1566:1569:src/service/browserDecision/BrowserTaskRunner.ts
    control.setState(
      this.taskId,
      status === "completed" ? "completed" : status === "cancelled" ? "cancelled" : "failed",
      reason
    );
```

`terminal("partial", ...)` and `terminal("interrupted", ...)` therefore write `failed`. The returned tool object still carries the original status.

**Observed result:** a verification miss, a sign-in handoff that has no waiter, an escalation after the recovery budget, and an interrupted pause all show as failed in the control record. A batch card that reads the control record labels them Failed.

**Closure:** a partial runner result stays `partial` on the control record. An interrupted one stays `interrupted`. A test reads both the tool result and the record.

### W03 — P1 — the field-helper cache key drops the provider revision, and invalidation matches a substring

- [ ] Include provider revision in the cache key. Drop the entry when the goal, field, context, provider revision, or an unknown effect on that field changes. Invalidate by parsed field name, not by `String.includes`.

**Requirements:** D-FR-21.

**What the code does:** `cacheKey` is `goal`, `field`, and `context` only (`FieldValueService.ts` 74–79). `invalidate` deletes every key that contains the raw field name as a substring (83–92). `invalidate("pass")` matches a cached field named `password`. `invalidate("a")` matches almost every key.

**Observed result:** a helper value typed under one provider can be reused after the user switches provider. Invalidating a short field name drops unrelated fields, so the next fill calls the helper again or, worse, a short name can clear a secret-adjacent cache that should have been a hard miss.

**Closure:** two provider revisions with the same goal and field produce two misses. `invalidate("pass")` leaves a `password` entry in place. An unknown effect on `email` drops only `email`.

### W04 — P1 — a failed proxy decrypt on the check path becomes an empty password, and switch errors stay boolean

- [ ] If `decryptForUse` returns null for a row that had a secret, fail that proxy with `proxy_auth_failed` and do not call the checker. Thread `proxy_connect_failed`, `proxy_auth_failed`, and `tunnel_failed` from the health check through switch and rollback. Do not collapse them to `proxy_check_failed`.

**Requirements:** P-FR-04, P-FR-08, P-AC-02. Same class as E06. The search-task worker path throws (`SearchModule.ts` 1149–1150). This path does not.

**What the code does:** `ProxyModule.getProxiesByIds` pushes `pass: ""` and `user: "__decrypt_failed__"` (`ProxyModule.ts` 294–299). Nothing in `src/` reads `__decrypt_failed__`. `checkProxyHealthy` returns a boolean (`ManagedBrowserModule.ts` 2295–2307). A failed check throws `proxy_no_usable_proxy` / `proxy_check_failed` (2430–2432). The typed classifier exists on navigate (`BrowserActionExecutor.ts` 896–904) and is not used by the switch.

**Observed result:** a row whose ciphertext cannot be decrypted is checked as a proxy with no password. A connect failure, an HTTP 407, and a tunnel failure all look the same to the model, so it cannot choose another proxy for the right reason.

**Closure:** a decrypt failure does not start a check. A 407 on switch returns `proxy_auth_failed` and does not fall back to direct.

### W05 — P1 — an alias chat default is replaced by whichever model `/models` lists first

- [ ] Resolve `small` and `haiku` only to a model the user configured for browser decisions. If the override is empty and the chat default is an alias, fail with `decision_model_alias_unresolved` unless a real browser model is configured. Do not pick `models.data[0]`.

**Requirements:** D-FR-04, D-05. The override half of E02 is closed. This branch is the same class: a stored alias is replaced by an unrelated model.

**What the code does:** when `chatDecisionModel` is empty and `defaultModel` is `small` or `haiku`, `executeTask` takes the first listed id that is not itself an alias (`ManagedBrowserAiToolService.ts` 1516–1540).

**Observed result:** a user whose chat default is `small` gets an arbitrary provider model for browser decisions, not the model they selected for chat and not a browser-specific choice.

**Closure:** with no override, an alias default fails closed. With an override, that exact id is sent.

### W06 — P1 — sub-agent notices are still addressed to the hidden agent conversation

- [ ] Publish session notices, credential cards, approval prompts, and handoff dialogs on `rootConversationId`, with the task label. Keep `record.conversationId` as the agent conversation for ownership checks that already allow the root.

**Requirements:** M-FR-08, M-AC-03, D-19. Same class as E03: the owner id is stored and then the wrong id is used at the publish site.

**What the code does:** sessions store both ids (`ManagedBrowserModule.ts` 757). `publishNotice` always sends `record.conversationId` (1853–1855). For a sub-agent that value is `agent-v2-<uuid>`. Batch progress events use the parent conversation (`runBrowserTasksTool.ts` emit sites). Notices do not.

**Observed result:** a CAPTCHA or login notice for “Browser task 2/3” is emitted on a conversation the chat UI does not show. The parent batch card can still show task state. The handoff dialog for that session does not.

**Closure:** a sub-agent challenge notice is visible in the parent conversation and names the task. A second parent conversation does not see it.

### W07 — P1 — the agent loop checks the control gate only after the model has already run

- [ ] Check the per-task gate before the model call and before each tool call. A response already in flight may finish. Its tool calls are held and discarded on resume. Stop aborts the model call.

**Requirements:** C-FR-05, C-FR-06. The runner checks before decide and before act. The agent runtime does not.

**What the code does:** `AgentRuntime.ts` 386–407 reads the control record immediately before `executeClaudeCompatibleTool`. There is no check before the completion request that produced those tool calls. Pause returns `agentTaskPaused` as a tool result. It does not drop the rest of the planned calls from a response that was already generated.

**Observed result:** the user pauses, the in-flight model call still spends tokens, and the first tool of that response runs the pause check only after the model committed to it. Later tools in the same response are not held as a set.

**Closure:** a pause issued before the request is sent does not send it. A pause issued during the request lets the body finish and executes none of its tool calls. Stop aborts the request.

### W08 — P1 — a sub-agent can still submit, because the ban is only prompt text

- [ ] Reject submit, send, publish, delete, and upload in the tool policy for `agent-browser-operator`. Return `needs_user: { type: "approval", proposed_action }` from the child result. Do not throw `approval_required` inside the child, where interactive prompts are disabled.

**Requirements:** M-FR-05, M-FR-04.

**What the code does:** the agent instructions say to return `needs_user` (`AgentDefinitionRegistry.ts` 139, `runBrowserTasksTool.ts` 521). `browser_run_actions` is on the allow-list (147). The tool still throws `approval_required` (`ManagedBrowserAiToolService.ts` around 732–777). Children run with `allowInteractivePermissionPrompts: false` (`runBrowserTasksTool.ts` 284). There is no batch confirmation card that grants routine automation for those task ids. `run_browser_tasks` remains a generic `requiresConfirmation`.

**Observed result:** a child that calls a consequential program fails the tool with `approval_required` and cannot show the parent an approval card. A child that ignores the prompt and the throw does not happen for a non-consequential classification can still perform the action. The user never saw a batch card listing the sites.

**Closure:** a submit inside a child returns `needs_user` on that task only. The sibling keeps running. The batch does not start until the user confirms the listed tasks and sites, and that grant expires with the batch.

### W09 — P1 — the busy-account “queue” is one unlocked sleep, labelled as a user wait

- [ ] Queue the second task until the account lease is free or the task is stopped. Hold a reservation so two waiters cannot both pass `start`. Do not mark that wait `waiting_for_user`. On child crash, release the lease even when no `session_id` was reported.

**Requirements:** M-FR-06, M-FR-09, C-FR-09. Same class as E20. The seventh pass did not replace this wait.

**What the code does:** after `account_in_use`, the batch emits `state: "waiting_for_user"` and sleeps 8 seconds, then calls `runOnce()` again (`runBrowserTasksTool.ts` 310–323). There is no lease reservation across the sleep. Two tasks can both wake and call `start`. The UI state is the user-wait state, so a clock that treats `waiting_for_user` as a human handoff stops active time for an account lock.

**Observed result:** two tasks for one account can start together after the sleep. The batch card says the task is waiting for the user while nobody is waiting.

**Closure:** one account produces one session. The queued task’s state is `queued`, not `waiting_for_user`. A crash before `session_id` releases the lease.

## Incomplete requirements

These are missing behavior. Each box is still open.

### R01 — Decision route, helper, and verification

- [ ] Negotiate chat output as verified JSON Schema, then forced tool calling, then JSON, with at most two upstream attempts (D-FR-18). `ChatCompletionDecisionClient.getCapabilities` hardcodes `supportsStructuredJsonSchema: false` and `supportsForcedToolDecision: false` (`DecisionClients.ts` 237–238). Attempts are `json_object` then plain text (295–298).
- [ ] Settings connection tests report chat, structured-output, and native capabilities separately. A passing `/models` or chat test does not certify native decisions (PRD §7). The decision panel stores the route and the model. It does not run those three probes.
- [ ] Optional selected-provider verifier, separately budgeted (D-FR-24). `verifierCallsHard` is only a constant (`BrowserTaskLimits.ts` 48).
- [ ] Measure shortlist recall on a held-out set (D-FR-14, D-AC-10). Ranking exists. No counter or eval writes a recall number.
- [ ] Document the single `while` loop as the accepted substitute for design §6.3, or add `reconciling`, `verifying`, and `awaiting_approval`. Unknown effect still terminates instead of reconciling (`BrowserTaskRunner` unknown-effect stop).

### R02 — Accounts, registry, and password-field rules

- [ ] Per-account AI opt-in control (Q-01). `ai_use_enabled` defaults false. The only writer that sets it true is `saveSubmittedCredential` (`socialAccountModule.ts` 594). Existing accounts miss the one-account path and a new card can create a duplicate.
- [ ] Point account labels, filters, the detail page, the social-account controller, and IPC at `BrowserSite` (S-FR-06). These still read `SocialPlatformList`: `socialaccountdetail.vue` 404–410 (and it `console.log`s the list at 404–407), `skillsRegistry.ts` 4427–4455, `socialAccountModule.ts` 133, `socialaccount-controller.ts` 42 and 268, `socialaccount-ipc.ts` 175. `ManagedBrowserModule.ts` 2521 still looks up `PLATFORM_SESSION_MANIFEST`.
- [ ] Same-site frames on the site’s allowed domains, keystroke fallback with focus checks, and `autocomplete="new-password"` treated as registration (A-FR-16, A-FR-19, A-FR-20). `LoginFormFiller.ts` has none of those branches.
- [ ] Overwrite the password bytes in the worker before dropping the reference (A-FR-08). `WorkerSession.ts` 878–883 assigns `input.password = ""`. The comment calls that an overwrite. A JavaScript string assignment does not write over the previous string.
- [ ] Sentinel scan of observations, notices, transcripts, logs, and worker messages other than the fill request (A-FR-15, A-AC-01).
- [ ] A-FR-12 still specifies a “Create account” confirmation card. The code follows Q-02 and returns `registration_disabled` (`BrowserCredentialLoginService.ts` 357–364). Amend the PRD or implement the card. Do not leave both as the contract.

### R03 — Proxy acceptance matrix

- [ ] `proxy_list` returns `country_code`, the last check result, and `browser_usable`, and never a password (P-FR-07). `ProxyAiTools.ts` does not mention `browser_usable`.
- [ ] Session-card host, country, and direct badge are present (P-FR-09). Keep passwords off that payload.
- [ ] WebRTC `--force-webrtc-ip-handling-policy=disable_non_proxied_udp` is set when a proxy is set. There is still no assertion that the bundled Chromium does not leak the host IP over UDP (P-FR-06).
- [ ] W04’s typed switch reasons and decrypt failure.
- [ ] Every secondary store (search-task rows, checker, renderer edit) fails closed for legacy plaintext, valid ciphertext, and a missing encryption key.

### R04 — Parallel tasks and takeover

- [ ] W06, W07, W08, W09.
- [ ] Batch token and cost budget, per-provider concurrency, and backoff that reads HTTP 429 (M-FR-10). The chat client’s second attempt always sleeps 1 second (`DecisionClients.ts` 267–268). It does not read a 429.
- [ ] A real sub-agent model on the same custom endpoint, and a pluggable executor (`llm_agent` now, `fast_runner` when qualified) (M-FR-12). The batch always starts `agent-browser-operator` (`runBrowserTasksTool.ts` 279). Settings have a session cap and no sub-agent model.
- [ ] Parent dedupe of extracted rows before save (M-FR-11). The allow-list comment says the parent dedupes. No save path dedupes.
- [ ] On resume: recheck the session’s allowed sites, confirm the same account is still signed in, and append the transcript note “the user controlled the browser; observe before acting” plus the instruction text (C-FR-07). The runner records `resume_with_instructions` in evidence (`BrowserTaskRunner.ts` 376) and folds the text into the next subgoal. It does not recheck the site or the account, and it does not write the agent transcript.
- [ ] Queue handoff dialogs one at a time with an “N tasks need you” badge. Do not call `bringToFront()` on launch (C-FR-10, C-FR-15). `WorkerSession.ts` 304 still calls `page.bringToFront()`. `BROWSER_TASK_FOCUS_WINDOW` returns `focus_not_supported_yet` (`managed-browser-ipc.ts` 348).
- [ ] Window title “AI is controlling this window”, set on the browser window, not injected into the page. Repeated unexpected navigations pause the task (C-FR-15). No such title exists.
- [ ] Occluded-window throttle flags and tiled windows, checked against the fingerprint self-test (M-FR-13). Flags remain on the old `browserManager.ts` path only.

### R05 — Release evidence

- [ ] Replace `test.fixme` with real tool → IPC → worker → storage → renderer runs:
  - `test/e2e/specs/browserDecisionTask.test.ts` lines 25, 50, and 69
  - `test/e2e/specs/browserParallelTasks.test.ts` lines 22 and 54
  - `test/e2e/specs/browserSignIn.test.ts` line 94 (wrong-password cooldown)
- [ ] Paired held-out evaluation across the six UI languages: current app, improved observation flow, hosted Jev, hosted Laya, and a custom chat provider. Report p50/p95, all-attempt cost per verified success, sample size, shortlist recall, and the predeclared success-rate margin (PRD §8–§9, D-AC-10). The hosted contract is an external dependency. Do not mark this done from unit tests.
- [ ] Six-language strings and component tests for every card, dialog title, and error added while closing W01–W09 and R01–R04, in the same change.

## Requirement coverage

“Partial” means a production path exists and at least one clause above is open. “Broken” means the path runs and does the wrong thing.

| IDs | Status | Open work |
| --- | --- | --- |
| D-FR-01, D-AC-02, D-AC-12 | Complete for the gate | Keep acceleration off from disabling existing browser tools |
| D-FR-02 | Broken on the hosted client | W01 |
| D-FR-03 | Complete on chat and native secret storage | Native profile is selectable |
| D-FR-04, D-05 | Partial | Override works; W05 still picks the first listed model |
| D-FR-05, D-FR-06, D-FR-10, D-FR-10b, D-FR-10c | Complete for the loop that ships | Planner, compact observation, conditional prompt |
| D-FR-07, D-FR-09 | Partial | W02 control-record collapse |
| D-FR-08, D-FR-27, D-AC-05 | Complete | Ownership and semantic approval |
| D-FR-10a | Complete for action and sign-in waits that have `awaitHandoff` | Bare fakes without the waiter still terminate |
| D-FR-11, D-FR-12, D-FR-13, D-FR-15, D-FR-15a | Complete for the checks that landed | Challenge probe, disabled/occluded refusal, reference pins |
| D-FR-14 | Partial | Ranking exists; recall measurement is R01 |
| D-FR-16, D-FR-17, D-AC-04 | Complete on the runner and worker URL gate | Plan bindings are still not navigation targets |
| D-FR-18 | Missing the first two negotiation modes | R01 |
| D-FR-19, D-FR-22, D-FR-23, D-FR-25 | Complete for recovery routing | `ESCALATE` and `llm_required` use the recovery budget |
| D-FR-20 | Complete for secret refusal and the helper call | W03 is the cache half of D-FR-21 |
| D-FR-21 | Broken | W03 |
| D-FR-24, D-AC-09 | Partial | Predicate check exists; verifier does not (R01) |
| D-FR-26, D-AC-06 | Complete for pre-dispatch refusal | Disabled, occluded, and stale SELECT are known no-effect |
| D-AC-01, D-AC-08, D-AC-11 | Partial | Hosted probe is honest; W01 and W05 break attribution |
| D-AC-07 | Partial | Stop aborts the runner signal; W07 does not abort the agent model call |
| D-AC-10 | Missing | R05 |
| A-FR-01, A-FR-04, A-FR-05, A-FR-06, A-FR-07, A-FR-10, A-FR-13, A-FR-14, A-FR-17, A-FR-18, A-FR-21 | Complete for the paths that landed | |
| A-FR-02, A-AC-03 | Complete for the suffixes now listed | Unlisted public suffixes still use the last-label fallback |
| A-FR-03, A-FR-09, A-FR-11 | Complete for cookie-first, handoff copy, and proxy link | |
| A-FR-08, A-FR-16, A-FR-19, A-FR-20, A-AC-01, A-AC-04 | Partial | R02 |
| A-FR-12 | Cut, not implemented | R02 versus Q-02 |
| A-FR-15 | Partial | R02 sentinel scope |
| S-FR-01, S-FR-02, S-FR-04, S-FR-05 | Complete | |
| S-FR-03, S-AC-01 | Complete for listed suffixes and distinct upsert errors | |
| S-FR-06 | Missing switch-over | R02 |
| P-FR-01, P-FR-02, P-FR-03, P-FR-05, P-FR-09 | Complete for the fixes named above | |
| P-FR-04, P-FR-07, P-FR-08, P-AC-02 | Partial | W04, R03 |
| P-FR-06 | Partial | Locale and timezone exist; WebRTC leak is unverified (R03) |
| M-FR-01 | Partial | Allow-list includes `browser_execute_task` always (M-FR-12) |
| M-FR-02, M-FR-03 | Complete | Result schema, grant task id, bounds of 5 and concurrency 1–3 |
| M-FR-04, M-FR-05 | Missing as policy | W08 |
| M-FR-06, M-FR-09 | Partial | Cap and memory check exist; W09 queue does not |
| M-FR-07, M-AC-02 | Complete when context is passed | |
| M-FR-08, M-AC-03 | Broken | W06 |
| M-FR-10, M-FR-11, M-FR-12, M-FR-13 | Missing | R04 |
| C-FR-01, C-FR-02, C-FR-03, C-FR-04, C-FR-13, C-FR-14, C-FR-16 | Complete for the controls that landed | Session card and runner share the gate |
| C-FR-05, C-FR-06 | Partial | Runner yes; agent loop no (W07) |
| C-FR-07 | Partial | Instructions reach the next subgoal; site, account, and transcript note do not (R04) |
| C-FR-08 | Partial | In-flight program abort exists; late results are not recorded on the paused state |
| C-FR-09 | Partial | Per-conversation wait probe exists; W09 mislabels an account lock as a user wait |
| C-FR-10, C-FR-15 | Missing | R04 |
| C-FR-11, C-FR-12 | Partial | Return-now on the batch was fixed earlier; W02 still collapses runner terminals |
| Q-01 | Missing | R02 |
| PRD §7 | Partial | Route, override, privacy copy, and session cap exist; connection tests and sub-agent model do not |
| PRD §8–§9 | Missing | R05 |

## Suggested order

1. W01, W02, W04, W06. A hosted request is not cancelled, terminal state is rewritten, a decrypt failure becomes an empty proxy password, and sub-agent notices go to a hidden conversation.
2. W03, W05, W07. Helper cache and alias selection pick the wrong model input; the agent loop acts after pause.
3. W08, W09. Parallel tasks can submit and can double-start an account.
4. R02 and R04. Registry switch-over, password-field rules, handoff queue, and resume checks.
5. R01, R03, R05. Negotiation, verifier, proxy list, and the release evaluation.

Do not mark a requirement complete because a helper has a unit test. Close it when the production path named here behaves as the PRD states and the regression covers that path.
