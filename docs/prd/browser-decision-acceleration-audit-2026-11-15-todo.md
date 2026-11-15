# Browser decision acceleration — 2026-11-15 completeness audit and TODO

Date: 2026-11-15. Audited worktree: `E:/project/aiFetchly-bda`. Branch: `feature/browser-decision-acceleration`. HEAD: `f4fa052f7` (`docs: record the fifth pass (Phase E settings UI + busy-account queueing)`).

Specifications:

- [PRD](browser-decision-acceleration-prd.md) v1.1 (2026-11-01)
- [Technical design](browser-decision-acceleration-technical-design.md)
- Prior pass: [2026-11-14 audit](browser-decision-acceleration-audit-2026-11-14-todo.md)

**Verdict: the PRD is not complete.** The custom and hosted decision loops, credential cards, site registry, and feature switches exist. This pass found live defects in paths the November 14 note marked closed, plus requirement gaps that were never built. The coverage table at the bottom of the 2026-11-14 file is stale: do not treat planner, hosted client, credential-card submit, or the native profile as missing. The native profile is built and then discarded (E01).

This document is a source audit of HEAD `f4fa052f7`. The focused Vitest suites were not re-executed in this pass. Line numbers refer to that commit.

## Already present — do not reopen

| Area | Evidence |
| --- | --- |
| Provider-aware gate on browser tools (D-FR-01, D-AC-12) | `BrowserAiAvailabilityService`; `executeTask` is the only path that checks `browserDecisionEnabled` |
| Hosted decision client when the server advertises the contract (D-AC-11) | `ManagedBrowserAiToolService.ts` 1428–1457; 404 probe returns `hosted_decision_unavailable` and does not start the runner |
| Route budgets (design §5.2) | Hosted 120s/240s, custom 300s/600s in `BrowserTaskLimits.ts` |
| One planner call; `planner_failed` is its own terminal (D-FR-05) | `BrowserTaskRunner.ts` 302–320 |
| Observe–decide–act loop inside one tool call (D-FR-06, D-FR-10b) | `BrowserTaskRunner.run`; compact final observation on `terminal` |
| Routing prompt rows only when the feature is available (D-FR-10c) | `BuiltInToolCapabilitiesPromptSection.ts` 85–115 |
| Chat confidence is not treated as calibrated; `ESCALATE` goes through recovery (D-FR-19) | `DecisionClients.ts`; `BrowserTaskRunner.ts` 547–585 |
| Per-observation reference buckets (D-FR-15a) | `PageReferenceRegistry` pins pending observations |
| Semantic approval match, single-use, SELECT value included (D-FR-27) | `BrowserApprovalFingerprint.ts`; `consumeApprovalForProgram` |
| Stale SELECT before `select()` is a known no-effect (old B07) | `BrowserActionExecutor.ts` 409–422 |
| Option values collected and parsed at 512 (old B05) | `BrowserObservationService.ts` 186–188; `schemas/worker/managedBrowser.ts` 674–677 |
| Credential card, account picker, and site-confirm card mounted with `conversationId` (old B01, B02, B03) | `AiChatV2.vue` → `BrowserControlCards.vue` |
| Cooldown per account and site; in-flight lock released in `finally` (old B14, A-FR-10) | `BrowserCredentialLoginService.ts` 569–590, 761–789; `socialAccountModule.ts` 527–571 |
| Password-only card (A-FR-05) | `BrowserCredentialLoginService.ts` 671–681; `BrowserCredentialCard.vue` |
| `browser_sign_in` accepts no password; notices name the tool (A-FR-01) | `schemas/aiTools/browserSignIn.ts`; `ManagedBrowserModule.ts` 1219–1226, 1611–1622 |
| Live HTTPS origin is the site identity (A-FR-02, for listed suffixes) | `BrowserCredentialLoginService.ts` 367–377 |
| Dedicated decrypt checks the live host (A-FR-07) | `SocialAccountModule.getCredentialForLogin` |
| Runner `SIGN_IN` calls the credential service and does not type a password (A-FR-14) | `BrowserTaskRunner.ts` 517–535 |
| `BrowserSite` entity, seed IDs, AI ids from 100000 (S-FR-01, S-FR-02) | `BrowserSite.entity.ts`, `BrowserSiteModule` seed |
| Extra-domain apply requires a single-use token (S-FR-04 write gate) | `BrowserSiteModule.applyAdditionalDomains` |
| Account-session eligibility is registry-based; YouTube stays on its adapter (S-FR-05, A-FR-13) | `ManagedBrowserModule.ts` 524–554 |
| Feature switches checked on the matching tools | sign-in, site upsert, proxy switch, parallel agents, acceleration |
| Decision settings section and six-language privacy copy (part of §7) | `ManagedBrowserSettingsPanel.vue`; `en.ts` 4294 and zh/es/fr/de/ja |
| Restart does not resume mutations (D-FR-10, C-FR-14) | `markUnfinishedInterrupted` and `sweepNonTerminalToInterrupted` on IPC registration |
| Busy-account batch task waits 8s and retries once | `runBrowserTasksTool.ts` 271–333. This is not the queue M-FR-06 requires; see G06 |

## Confirmed defects

**2026-11-15 closure pass:** E01–E20 are CLOSED (commits `3b08383c9` →
`5a1f0dc8d`): native route reaches the runner (E01); decision-model
override + alias fail-closed (E02); all tools enforce ownership (E03);
handoff waits on the owning task + model resume removed (E04); helper
wired + secret fields refused (E05); proxy secrets fail closed (E06);
country-strict auto (E07); task-owner switch + strict restore (E08);
proxy link after sign-in (E10); criteria bounds + role slice (E11);
regional PSL suffixes (E12); worker nav gate (E13); fresh-obs recovery +
real recent actions (E14); dispatch-aware timeouts (E15); cookie
snapshot before typing (E16); registration cut documented (E17); safety
handoff + dialog copy (E18); memory wipe documented (E19);
conversation-scoped release (E20). CI run 43684430278 at `5a1f0dc8d`.

Each box is open. Close it only when the production path behaves as the requirement states and a regression covers that path.

### E01 — P0 — a native decision profile is built and then replaced by the chat client

- [x] After a complete `native_profile` is selected, pass `SystemOneDecisionClient` to the runner. Do not enter the chat-client branch. Refuse an incomplete profile. Never send chat aliases (`small`, `haiku`) on the native protocol.

**Requirements:** D-FR-04, D-06, D-AC-08, design §5.3 and §9.3.

**What the code does:** `executeTask` builds `SystemOneDecisionClient` when `route === "chat"` and the native profile is complete, and assigns it to `decisionClient` (`ManagedBrowserAiToolService.ts` 1390–1408). The next branch is `if (route === "hosted") { ... } else { ... decisionClient = chatClient }` (1458–1518). Every custom-provider task, including one with a native profile, overwrites the native client.

**Observed result:** the settings UI can store an inert-until-selected native profile, and selecting it still sends chat completions. Native distributions, `/systemone`, and the separate native credential are never used.

**Closure:** a test that a complete native profile produces `SystemOneDecisionClient` requests and zero chat-completion calls; an incomplete profile returns `native_profile_incomplete`; hosted mode with a native profile returns `native_profile_hosted_mode`.

### E02 — P0 — the browser decision model override is stored and ignored

- [x] Read `decisionRoute.chatDecisionModel` at admission and send that real model on the chat decision route. Resolve `small` / `haiku` to a configured real model, not the first id returned by `/models`. If no real model can be resolved, fail the task with a structured reason instead of sending the alias.

**Requirements:** D-FR-04, D-05, PRD §7.

**What the code does:** the panel persists `chatDecisionModel` (`ManagedBrowserSettingsModule.ts` 51–55, 355–360; `ManagedBrowserSettingsPanel.vue` 145–157). `executeTask` never reads it. Alias handling (`ManagedBrowserAiToolService.ts` 1466–1496) lists `/models` and takes the first id that is not `small` or `haiku`. If that lookup throws, `decisionModel` stays undefined and `OpenAICompatibleProviderClient.resolveModel` sends `defaultModel`, which may still be the alias (`OpenAICompatibleProviderClient.ts` 86–90).

**Observed result:** “Use a cheaper browser model” in settings has no effect. An alias default can be replaced by an arbitrary model from the provider’s list.

**Closure:** the decision request model equals the saved override when set, and equals a resolved non-alias when the override is empty and the default is `small` or `haiku`.

### E03 — P0 — seven browser tools drop the execution context, so the owner check never runs

- [x] Pass `(args, context)` into every managed-browser tool method. `ensureSession` must reject a missing caller when the session has an owner. Cover each tool below with a test that a second conversation is rejected and the owning conversation is accepted.

**Requirements:** D-FR-08, M-FR-07, M-AC-02, D-19.

**What the code does:** `managedBrowserToolWrapper` forwards `conversationId`, `jobId`, `ownerAgentId`, and `rootConversationId` (`skillsRegistry.ts` 4893–4902). These registrations ignore the second argument:

| Tool | Line | Method still accepts context |
| --- | --- | --- |
| `browser_get_status` | 4990 | `getStatus` 488–497 |
| `browser_navigate` | 5044 | `navigate` 546–557 |
| `browser_request_handoff` | 5123 | `requestHandoff` 1112–1142 |
| `browser_resume_after_handoff` | 5146 | `resumeAfterHandoff` 1169–1178 |
| `browser_screenshot` | 5171 | `captureScreenshot` 1084–1093 |
| `browser_stop_session` | 5254 | `stopSession` 1945–1956 |
| `browser_clear_cache` | 5486 | `clearCache` 1972–1981 |

`ensureSession` skips the owner comparison when `callerConversationId` is missing (`ManagedBrowserAiToolService.ts` 371–380). `browser_observe`, `browser_run_actions`, `browser_start_session`, `browser_sign_in`, `browser_set_proxy`, and `browser_execute_task` do pass context.

**Observed result:** any caller that knows a session id can read it, navigate it, screenshot it, stop it, clear that account’s cache, open a handoff, or end a handoff. The runner-ownership guard on `navigate` and `stopSession` still runs, because it does not need the conversation id.

**Closure:** each row above passes context. A foreign conversation receives `session_not_owned`. The root conversation is still allowed.

### E04 — P0 — handoff and resume are callable without a job, and a model can end a takeover

- [x] `browser_request_handoff` must block on the owning task id, call `setUserWait` on that task’s parent job, and map expiry to `interrupted` for that task only. Remove `browser_resume_after_handoff` from the model tool list. Only the user’s dialog action may leave handoff.

**Requirements:** C-FR-02, C-FR-03, C-FR-09, C-AC-03, C-AC-04, D-21.

**What the code does:** E03 drops context, so `requestHandoff` records a new id `handoff-${random}` (`ManagedBrowserAiToolService.ts` 1128–1136) and passes `jobId: null` (1142). `HandoffCoordinator` returns without `setUserWait` when `jobId` is null. The parent poll freezes only while `isWaitingForUser(jobId)` is true (`AIChatQueryLoop.ts` 6522–6527). The tool also ignores the model’s `reason` and always sends `user_requested` (1139). `browser_resume_after_handoff` stays registered (`skillsRegistry.ts` 5129–5147). The operator allow-list omits it; the tool itself does not. `executeTask` handoff does pass `jobId` (`ManagedBrowserAiToolService.ts` 1731–1748).

**Observed result:** a 45-minute sub-agent handoff still hits the 30-minute parent poll. User interventions land on `handoff-*`, so the batch result’s `user_interventions` stays empty (C-FR-12). A model that knows the session id can call `browser_resume_after_handoff` and end the takeover.

**Closure:** a sub-agent handoff sets the parent job’s user-wait flag for the whole interval; expiry interrupts only that task; no model tool can call resume.

### E05 — P0 — secret-field rejection and the field helper never change what gets typed

- [x] When the field name is secret-shaped, refuse the fill. Do not keep the model’s text. Wire the bounded field-text helper into `resolveText`. Cache only a full identical helper input, and drop the cache on goal, field, context, provider-revision, or unknown-effect change.

**Requirements:** D-FR-20, D-FR-21, A-FR-14, D-13.

**What the code does:** `resolveText` returns `null` for forbidden names (`FieldValueService.ts` 108–112) and returns `null` again when `input.helper` is missing (125–127). `executeTask` calls `resolveText` with `fieldName`, `goal`, and `bindings` only (`ManagedBrowserAiToolService.ts` 1649–1657). No `helper` is passed, so the helper and its cache never run. The runner replaces the fill value only when the resolver returns a non-null string (`BrowserTaskRunner.ts` 818–825). A `null` result leaves `programAction.value` as the model’s text. The executor blocks `type=password` inputs (`BrowserActionExecutor.ts` 376–385). It does not block a text input whose accessible name matches password, OTP, or card.

**Observed result:** a text field named like a password is filled with the model’s string. Plan bindings work only for the unambiguous non-secret case. D-FR-21’s cache is dead code.

**Closure:** a forbidden field name ends the step as handoff or a known no-effect refusal, and the typed value is never the model string. A non-secret field with no binding calls the helper at most once per identical input.

### E06 — P1 — search-task proxy create can store plaintext, and the editor returns the secret

- [x] If `encryptForStorage` returns null, abort the search-task create. Do not write `proxy.pass`. `getTaskDetailsForEdit` must return `hasPassword` and must not return `pass`. The editor submits a new password only when the user types one.

**Requirements:** P-FR-08, P-FR-07, P-AC-02.

**What the code does:** `saveSearchTask` and `saveSearchtaskOnly` use `encryptForStorage(proxy.pass) ?? proxy.pass` (`SearchModule.ts` 614–616 and 665–667). `updateSearchTask` already throws `proxy_encrypt_failed` (1263–1268) and replaces rows. The worker path throws `proxy_decrypt_failed` when a stored secret will not decrypt (1141–1143). `getTaskDetailsForEdit` copies `item.pass` into the IPC payload (1371–1375) via `search-ipc.ts`. `PROXYLIST` / `PROXYDETAIL` use `hasPassword` (`Proxy.model.ts` 61–74). `ProxyModule.getProxiesByIds` still maps a failed decrypt to `pass: ""` (287–290) for the proxy-check path.

**Observed result:** a failed encrypt on search-task create persists the password in plaintext. Opening a search task for edit sends that stored value to the renderer. A failed decrypt on `getProxiesByIds` becomes an empty password and the check continues.

**Closure:** create and update both abort when encryption returns null. The edit payload has `hasPassword` and no `pass`. A decrypt failure on a row that had a secret does not launch or check with an empty password.

### E07 — P1 — `auto` plus a country with no match uses any proxy

- [x] When `country_code` is set and no usable row matches that country and a passing check, return `proxy_no_usable_proxy`. Do not fall through to a different country. Do not treat a never-checked row as a pass. Public-session `auto` must select from browser-usable proxies, not from an empty account-linked list.

**Requirements:** P-FR-01, P-FR-04, P-AC-01.

**What the code does:** `BrowserProxySelectionService.ts` 152–161 filters to the country, then if that list is empty uses every usable row. `lastCheckPassed !== false` treats `undefined` as a pass, and if no passing row exists the code uses a failed row. `auto` only sees `linkedProxies`. A public session loads an empty list (`ManagedBrowserModule.ts` around 1783–1784).

**Observed result:** “use a US proxy” can launch a proxy in another country. An account-free session cannot use `auto` at all.

**Closure:** a country miss is `proxy_no_usable_proxy`. A public session can select a checked HTTP(S) proxy by country. Direct is never the fallback.

### E08 — P1 — a successful proxy switch drops the task owner, and rollback can re-run `auto`

- [x] Pass `agentTaskId` on the new session, not only on the restore. Charge the switch only after the new session is ready (already true). Restore by `effectiveProxyId` only. If that id is missing, fail closed. Do not start `{ kind: "auto" }` again. Persist cookies before stop, reopen the last URL with a plain GET, and return a fresh observation.

**Requirements:** P-FR-02, P-FR-05, P-AC-01.

**What the code does:** the ready session is started without `agentTaskId` (`ManagedBrowserModule.ts` 2319–2326). The restore path passes it (2352–2354). The cap key is `task:<agentTaskId>` only while that id is on the record (2237–2242); the next switch falls back to the conversation/account/platform key. Rollback uses `effectiveProxyId` when set, otherwise `startProxySelection`, which can be `{ kind: "auto" }` (2338–2341). The relaunch navigates with `RUN_ACTIONS`, and the return value is `toSafeStatus`, not a fresh observation (2332).

**Observed result:** two switches in one sub-agent task can share a conversation budget with unrelated sessions, or exceed three switches. A failed switch can come back on a different proxy than the one that was in use. The caller does not receive a new observation and revision.

**Closure:** the new session keeps `ownerAgentTaskId`. Three switches in one task are the cap. A failed switch restores the same proxy id or leaves the session stopped with a structured error.

### E09 — P1 — the saved-account fallback start drops sub-agent ownership

- [ ] The `account_not_found` / `platform_not_in_pilot` fallback must copy `agentTaskId` and `rootConversationId` onto the account-free session.

**Requirements:** M-FR-07, D-19.

**What the code does:** the first `start` passes both ids (`ManagedBrowserAiToolService.ts` 449–457). The fallback `start` passes purpose, URL, and `conversationId` only (474–478).

**Observed result:** a sub-agent whose saved account cannot start gets a public session the parent cannot own, and notices stay on the agent conversation.

**Closure:** the fallback session has the same root conversation and agent task id as the attempt that failed.

### E10 — P1 — a public session that signs in never links the proxy it used

- [x] After a successful sign-in, link `effectiveProxyId` to the account even when the session’s `accountId` is still 0, then bind the account. A later move to a different country or to `direct` still requires confirmation.

**Requirements:** P-FR-03, A-FR-11.

**What the code does:** linking requires `postStatus.accountId === credential.accountId` (`BrowserCredentialLoginService.ts` 905–912). `bindAccountToSession` runs after that check (917–922). `handleRefreshedCookies` also drops the snapshot while `accountId` is still 0 (`ManagedBrowserModule.ts` 1527–1528). Country is not part of the confirmation. `BrowserProxySelectionService.ts` 111–135 confirms a different proxy id or `direct`, not a different country on an already linked proxy.

**Observed result:** an account-free browser that signs in with a proxy does not remember that proxy. The next account session can start direct or on another proxy. A linked proxy in another country is not confirmed.

**Closure:** the account row points at the proxy used for that sign-in. Changing country or choosing `direct` returns `proxy_change_requires_confirmation`.

### E11 — P1 — a legal completion criterion cannot be sent to the decision model

- [x] Make the tool criterion value, the composed `kind:value` string, and `decisionInputSchema.completion_criteria` the same limit. Parse must succeed for every criterion the tool accepts.

**Requirements:** D-FR-05, D-FR-24, D-AC-09. Same class as the old option-value bound mismatch (B05).

**What the code does:** `browserCompletionCriterionSchema` allows `value` up to 500 characters (`schemas/aiTools/browserTask.ts` 12–16). The runner stores `` `${criterion.kind}:${criterion.value}` `` (`BrowserTaskRunner.ts` 1041–1043). `decisionInputSchema` requires each string `max(256)` (`schemas/api/browserDecision.ts` 67). `decisionInputSchema.parse` at `BrowserTaskRunner.ts` 764 throws. The outer catch turns that into `runner_error`.

**Observed result:** a criterion value longer than 256 minus the kind prefix and the colon aborts the task before a decision. Values of 200 characters or fewer still work. A long `role` attribute has the same shape: the collector copies it unsliced (`BrowserObservationService.ts` around 150) and the worker schema is `max(48)` (`schemas/worker/managedBrowser.ts` 654), so one long role drops the whole observation.

**Closure:** a 500-character criterion round-trips through collect → decision input → runner. A role longer than 48 characters is sliced and the observation still parses.

### E12 — P1 — regional S3 hosts and `blogspot.co.uk` still share one registrable domain

- [x] Derive eTLD+1 from a maintained public-suffix list, including the private suffixes the curated set misses. Add regression cases for the hosts below. Do not treat “last two labels” as safe for unlisted suffixes.

**Requirements:** A-FR-02, A-AC-03, S-FR-03, D-15.

**What the code does:** `RegistrableDomain.ts` is a curated set. It lists `s3.amazonaws.com` and `s3.dualstack.amazonaws.com` (51–55) and `blogspot.com` (52), plus `co.uk` (19). It does not list `s3.us-east-1.amazonaws.com`, `s3.eu-west-1.amazonaws.com`, or `blogspot.co.uk`. Unlisted hosts fall through to the last public label. `github.io` and `*.ck` were fixed earlier; these were not.

**Observed result:** `evil.s3.us-east-1.amazonaws.com` and `victim.s3.eu-west-1.amazonaws.com` both become `amazonaws.com`. Every `tenant.blogspot.co.uk` becomes `blogspot.co.uk`. A credential saved for one tenant can be offered to another. `bucket.s3.amazonaws.com` and `tenant.blogspot.com` stay distinct.

**Closure:** the two S3 hosts and two `blogspot.co.uk` tenants produce four different registrable domains. A test refuses to release a stored password across them.

### E13 — P1 — the worker still allows any path on an allowed host

- [x] `evaluateNavigationTarget` must allow a URL only when it is the current page, an observed `href_full`, or an explicit trusted plan binding, compared as origin + path + query + fragment, and still on the site’s registrable domain. Public browsing must not allow an arbitrary HTTPS URL from the accelerated path.

**Requirements:** D-FR-16, D-AC-04.

**What the code does:** the runner’s own `NAVIGATE` check compares the full URL (`BrowserTaskRunner.ts` 605–662, `urlKeyOf` 1475–1477). A plan binding is not an allowed navigation target. The worker gate that performs `goto` allows any path, query, and fragment on an allowed host, and public browsing allows any HTTPS URL (`NavigationPolicy.ts` around 128).

**Observed result:** a decision that the runner would reject can still be executed if another caller reaches `goto` with only an allowed host. A link to one path on an allowed CDN host authorizes every other path at the worker.

**Closure:** an unobserved path on an observed origin is rejected in the worker, with a regression through runner and `NavigationPolicy`.

### E14 — P1 — no-progress recovery decides against the observation it will not execute on

- [x] Re-observe, rebuild candidates, then ask recovery. Execute only a candidate id from that new observation. Send a real `recent_actions` list (operation, role, name, error class) on the main path, not only inside recovery.

**Requirements:** D-FR-22, D-FR-25. Same class as old B17. `ESCALATE` recovery already re-observes (`BrowserTaskRunner.ts` 555–566).

**What the code does:** `checkProgress` calls `recoverOnce(decisionInput, ...)` with the pre-action input (`BrowserTaskRunner.ts` 1165–1168). The next loop iteration builds candidates from the post-action observation. `buildDecisionInput` sets `recent_actions: []` (1047). A reused `e_` ref can miss (`target_not_in_observation`, 804–807) or hit a different control. Approval replay dispatches the same `programAction` closure after the wait and does not re-observe first (720–732, 881–885, replay at 1225–1235).

**Observed result:** five unchanged steps can produce a click on a stale reference. The equivalent-failure counter may increment instead of applying the recovered action. The model never sees the real recent actions on the fast path.

**Closure:** the recovery decision’s `target_id` is a member of the observation that is executed next. `recent_actions` on the next decision contains the failed step.

### E15 — P1 — unknown effect is set before input is dispatched, and a step timeout is always unknown

- [x] Set `inputSent` only after the mutating browser call has been invoked. A throw from `scrollIntoView` or from argument setup is a known no-effect. A step timeout is `effect: "unknown"` only when input may have been dispatched. Unknown effect must be reconciled against a fresh observation and must not be blindly replayed.

**Requirements:** D-FR-26, D-AC-06, D-FR-10.

**What the code does:** `dispatch.inputSent = true` is set and then the input API is called for click (370–371), fill clear/type (392–394), select (428–429), press (433–434), and the navigate `goto` (around 541–543). The catch reports `effectUnknown` from that flag (509–517). The SELECT stale-option throw above `inputSent` is correctly `effectUnknown: false` (409–422). `executeTask`’s step-timeout path returns `effect: "unknown"` with no dispatch check (around 1596–1605). Unknown effect ends the task as `partial` / `unknown_execution_effect` (`BrowserTaskRunner.ts` 1261–1263). It does not enter a reconciling state.

**Observed result:** a click that throws before the browser accepts the click stops the task as an unknown mutation and is never retried, including when nothing was dispatched. A timeout that fired during candidate lookup is classified the same way.

**Closure:** a throw before the input call is `effectUnknown: false` and the runner may re-observe. A throw after `click` / `type` / `select` / `press` / `goto` is unknown and is not replayed.

### E16 — P1 — one saved account never tries its cookie snapshot

- [x] On one match, restore the account’s encrypted cookie snapshot and re-observe. Type the password only if the page still shows a login form.

**Requirements:** A-FR-03, A-FR-11.

**What the code does:** cookie restore exists when an account session starts (`ManagedBrowserModule.ts` 823–826). `signIn` with one candidate goes to decrypt and `FILL_LOGIN_FORM` (`BrowserCredentialLoginService.ts` 628–811). There is no cookie attempt on that path.

**Observed result:** a still-valid cookie session is logged in again with the password. That burns the 15-minute attempt budget and can flag the account.

**Closure:** a local fixture with a valid cookie snapshot reaches authenticated without `FILL_LOGIN_FORM`. An expired snapshot still fills the form once.

### E17 — P1 — registration never shows a confirmation card

- [x] Either keep Q-02 (login only) and document it as the accepted v1 cut, with the register tool returning a stable `registration_disabled` reason and no handoff, or implement A-FR-12: a “Create account” card, explicit confirmation, then handoff for verification, and store the new account on the encrypted path. Do not leave both.

**Requirements:** A-FR-12, Q-02.

**What the code does:** `intent === "register"` calls `requestHandoff(..., "recovery_flow")` and returns `registration_not_confirmed` (`BrowserCredentialLoginService.ts` 353–361). The card’s “Create account” label (`BrowserCredentialCard.vue` 41) is unreachable.

**Observed result:** the model is told registration was not confirmed. The user sees a generic handoff, not a create-account choice. No account is stored.

**Closure:** the chosen cut has one test. If the card is in scope, submit creates an encrypted account only after the user confirms, and a missing confirmation does not type credentials.

### E18 — P1 — several password-safety failures return `failed` instead of handoff, and the dialog text is generic

- [x] Every password-field safety failure opens handoff. Map `wrong_credential` to “Saved password was rejected” and `challenge_2fa` to “Verification code required”. Do not start a cooldown on 2FA. Call the adapter’s `assessAuthentication` for sites that have one.

**Requirements:** A-FR-09, A-FR-16, A-AC-02.

**What the code does:** the filler can return `wrong_password` or `challenge_2fa` (`LoginFormFiller.ts` 607–655). It does not call `assessAuthentication`. Handoff is opened only for `wrong_credential`, `challenge`, and four reason codes (`BrowserCredentialLoginService.ts` 969–986). `password_field_mutated`, `insecure_page`, and `unexpected_field_change` fall through to `failed` (995–998). The dialog uses the generic login and CAPTCHA strings (`en.ts` 4208, 4270). Cooldown is skipped for `form_not_found`, `ambiguous_password_field`, and `outcome === "challenge"` (953–959), which is the right shape for 2FA, but the user-facing reason is still generic.

**Observed result:** a show-password toggle or a tampered second field can end the tool as `failed` while the page still shows the secret. A rejected password opens the dialog titled like a normal login wall.

**Closure:** each safety reason opens handoff. The dialog title for a rejected password and for a verification challenge matches A-FR-09. The cooldown test is no longer `test.fixme`.

### E19 — P1 — password-field rules stop short of A-FR-08 and A-FR-16 through A-FR-20

- [x] Overwrite the password string in worker memory before dropping it. Re-check `type === "password"` after the input event (already present) and walk same-site frames on the site’s allowed domains. Fall back to keystrokes only when the native setter does not stick, with focus checks before and after. Treat `autocomplete="new-password"` as registration. If the form is ambiguous, offer references to the model and still validate them in the worker.

**Requirements:** A-FR-08, A-FR-16, A-FR-19, A-FR-20, A-AC-04.

**What the code does:** `WorkerSession.ts` 818–821 assigns `input.password = ""`. That drops the property. The filler checks the top document only (`LoginFormFiller.ts` 121–136, 351–400). Values use the native setter and length read-back (143–150, 402–455). There is no keystroke fallback. `autocomplete="new-password"` is a selector in `GenericSignInAdapter.ts` 54 and is not treated as registration. Ambiguous forms abort (`LoginFormFiller.ts` 263–270) instead of offering refs. A successful fingerprint is saved (`BrowserCredentialLoginService.ts` 876–890).

**Observed result:** a password in a same-site iframe is not filled, or is filled without the frame checks. A form the detector cannot classify fails closed with no model choice. A “show password” toggle during keystrokes is untested because keystrokes are not used. The sentinel tests cover tool JSON and filler results, not notices, transcripts, or electron logs (A-FR-15).

**Closure:** a same-site iframe fixture, a native-setter miss that falls back to keystrokes, a `new-password` form that hands off for registration, and a sentinel scan of notices, transcripts, and logs.

### E20 — P1 — the busy-account wait can start two sessions, and a crash without `session_id` leaks the lease

- [x] Queue a second task for the same account until the lease is free or the task is stopped. Hold a reservation across the wait so two waiters cannot both pass `start`. On any child exit, release the lease even when the output has no `session_id`.

**Requirements:** M-FR-06, M-FR-09, M-AC-01.

**What the code does:** `runBrowserTasksTool.ts` 271–333 sleeps 8 seconds with no lock, then calls `runOnce()` again. `start` still throws `account_in_use` (`ManagedBrowserModule.ts` 707–708). Cleanup stops a session only when the child output includes `session_id` (`runBrowserTasksTool.ts` 399–407). The per-site cap is checked at start only (`ManagedBrowserModule.ts` 641–665), not when a public session later navigates onto a capped domain.

**Observed result:** two tasks for one busy account can both wake and start. A child that crashes before it reports `session_id` leaves the account lease and the global slot held until restart. A public session can navigate onto a domain that already has two sessions.

**Closure:** a second task stays queued and starts once. Two concurrent waiters produce one session. A crash fixture releases the lease. Navigation onto a capped domain is rejected.

## Incomplete requirements

These are missing behavior. Each box is still open.

### G01 — Decision route honesty (phase 8–9)

- [ ] Chat output negotiation is JSON Schema, then forced tool calling, then JSON, with at most two upstream attempts (D-FR-18). Today both attempts are `json_object` then plain text (`DecisionClients.ts` 247–293). Capabilities hardcode `supportsStructuredJsonSchema: false` and `supportsForcedToolDecision: false` (226–234). `response_format` is typed only as `"json_object" | "text"` (`aiChatApi.ts` 585).
- [ ] Abort the in-flight HTTP call when the provider config key changes on the hosted and native clients, not only on the chat client (D-FR-02). The chat client polls every 500ms and aborts (`DecisionClients.ts` 272–284). Hosted checks before `postDecision` and does not abort the body (around 129–134). Native discards the body after it returns (`SystemOneDecisionClient.ts` 89–108).
- [ ] A provider change must interrupt the active task in the UI, not only return `provider_config_changed` (PRD §7, D-FR-02).
- [ ] Connection tests report chat, structured-output, and native capabilities separately. A passing `/models` or chat test does not certify native decisions (PRD §7, design §5.3).
- [ ] `llm_required` from the wire is an immediate terminal (`BrowserTaskRunner.ts` 435–443). Route it through the same bounded recovery table as `ESCALATE`.
- [ ] A `SIGN_IN` result of `handoff_required` returns `partial` / `sign_in_handoff` immediately (`BrowserTaskRunner.ts` 539–542). Wait inside the job the way action handoff does (D-FR-10a).
- [ ] Optional selected-provider LLM verifier, separately budgeted. `verifierCallsHard` is unused (`BrowserTaskLimits.ts` 48) (D-FR-24).
- [ ] There is no shortlist-recall measurement (D-FR-14, D-AC-10). Focused and dialog elements are sorted ahead of document order; the remainder is not ranked by the task.
- [ ] Pre-input revalidation checks role, name, and viewport intersection (`BrowserActionExecutor.ts` 688–731). It does not read `disabled` or hit-test occlusion (D-FR-15). Disabled controls are omitted from candidates instead of exposed as disabled (D-FR-12).
- [ ] `requestHandoff`, `resumeAfterHandoff`, and `clearCache` do not call `assertNoRunnerOwnership`. `navigate`, `runActions`, `signIn`, `evaluateScript`, `setProxy`, and `stopSession` do (D-FR-08).

### G02 — Sign-in and site switch-over

- [ ] Per-account AI opt-in UI (Q-01). `ai_use_enabled` defaults false. The only writer that sets it true is `saveSubmittedCredential` (`socialAccountModule.ts` 592–594). Existing accounts miss the one-account path and the card can create a duplicate. No Vue control toggles it.
- [ ] Point these callers at `BrowserSite` through IPC (S-FR-06). They still read `SocialPlatformList` or `PLATFORM_SESSION_MANIFEST`, with the registry only as a fallback: `src/views/pages/socialaccount/socialaccountdetail.vue` around 404–410, `src/config/skillsRegistry.ts` 4427–4455, `src/modules/socialAccountModule.ts` 133–135, `src/controller/socialaccount-controller.ts` 42–44 and 268–272, `src/main-process/communication/socialaccount-ipc.ts` 175–177, and `ManagedBrowserModule.ts` 2377–2378.
- [ ] Sentinel scan of tool results, observations, notices, transcripts, logs, and worker messages other than the fill request (A-FR-15, A-AC-01). Current tests cover the sign-in tool JSON, filler results, and one e2e page-text check.

### G03 — Proxy product surface

- [ ] Return structured switch failures `proxy_connect_failed`, `proxy_auth_failed` (HTTP 407), and `tunnel_failed` (P-FR-04). The classifier strings exist in `BrowserProxySelectionService.ts` 35–45 and on worker navigate (`BrowserActionExecutor.ts` 549–558, 820–832). The switch throws `proxy_check_failed` (`ManagedBrowserModule.ts` 2297–2300).
- [ ] `proxy_list` returns `country_code`, the last check result, and `browser_usable`, and never a password (P-FR-07). The tool drops `browser_usable` and maps `checktime` from `updatedAt` (`proxyAiToolTypes.ts` 324–354, `ProxyAiTools.ts` 92–109).
- [ ] Session card shows the proxy host label, country, and a badge when traffic goes direct (P-FR-09). `ManagedBrowserSessionCard.vue` 11–18 shows `proxyActive` only. `toSafeStatus` has `effectiveProxyId` and `proxyActive`, not host or country (`ManagedBrowserModule.ts` 2385–2404).
- [ ] WebRTC `--force-webrtc-ip-handling-policy=disable_non_proxied_udp` is added when a proxy server is set (`BrowserFingerprintPolicy.ts` 212–218). There is no assertion that the bundled Chromium does not leak the real IP over UDP (P-FR-06). Locale and timezone from `country_code` are set (`ManagedBrowserModule.ts` 848–880).

### G04 — Parallel sub-agents

- [ ] One batch confirmation card that lists the tasks and sites, grants routine automation only for that batch’s task ids, and expires with the batch (M-FR-04). `run_browser_tasks` is `requiresConfirmation: true` (`skillsRegistry.ts` 5361). Children run with `allowInteractivePermissionPrompts: false` (`runBrowserTasksTool.ts` 284).
- [ ] Sub-agents do not submit, send, publish, delete, or upload. A consequential action returns `needs_user: { type: "approval", proposed_action }` (M-FR-05). `browser_run_actions` throws `approval_required` (`ManagedBrowserAiToolService.ts` 732–777). `browser_site_upsert` is on the operator allow-list (`AgentDefinitionRegistry.ts` 155) and writes the shared site table (`ManagedBrowserAiToolService.ts` 1914–1919).
- [ ] Remove `browser_site_upsert` from the child allow-list. The parent dedupes extracted rows before save. Children do not write shared tables (M-FR-11). The comment in `runBrowserTasksTool.ts` 9–10 is the only dedupe.
- [ ] A real sub-agent model on the same custom endpoint, and a pluggable executor (`llm_agent` now, `fast_runner` when the runner is qualified) (M-FR-12). The batch always starts `agent-browser-operator` (`runBrowserTasksTool.ts` 279). There is no `executor` field and no settings control.
- [ ] Per-provider concurrency with backoff that reads HTTP 429, and a total token/cost budget per batch (M-FR-10). `DecisionClients.ts` 260–262 comments “429” and then sleeps 1 second with no status check. `run_browser_tasks` has no budget.
- [ ] Publish session cards, notices, credential cards, approval prompts, and handoff dialogs on the root conversation, labelled by task (M-FR-08). Batch events use the parent conversation (`runBrowserTasksTool.ts` 237). Notices use `record.conversationId` (`ManagedBrowserModule.ts` 1760–1762), which for a sub-agent is `agent-v2-*` (`AgentRuntime.ts` 238, 590).
- [ ] Chromium flags that keep occluded windows from throttling, verified against the fingerprint self-test, and tiled or offset windows (M-FR-13). Those flags exist on `browserManager.ts` 248–249 and are not in `composeLaunchArgs` (`BrowserFingerprintPolicy.ts` 193–224). `WorkerSession.ts` 295 calls `bringToFront()` on every launch, which also violates C-FR-10.
- [ ] Settings for maximum concurrent browsers (default 3, maximum 5) and an optional sub-agent model (PRD §7). The cap is stored and enforced (`ManagedBrowserSettingsModule.ts` 253–258, `ManagedBrowserModule.ts` 683–692). The panel has no control for it.
- [ ] `browser_execute_task` is on the operator allow-list unconditionally (`AgentDefinitionRegistry.ts` 129–159). Include it only when the runner is the selected executor (M-FR-01). `browser_evaluate_script`, `browser_clear_cache`, and `browser_resume_after_handoff` are omitted from that list. E04 still leaves resume callable.

### G05 — Takeover, pause, resume, and stop

- [ ] The agent loop checks the per-task gate before each model call and before each tool call (C-FR-05). `AgentRuntime.ts` 386–407 checks before tools only. The runner checks before decide and before act (`BrowserTaskRunner.ts` 343, 454–458). The worker honors `PAUSE_REQUEST` between actions (`WorkerSession.ts` 890–891).
- [ ] A model response already in flight when the user pauses may finish, and its tool calls are discarded on resume. Stop aborts immediately (C-FR-06). The runner discards a decision if the resume generation changed (`BrowserTaskRunner.ts` 465–474, 715–718). The agent loop does not. A later tool call returns `agentTaskPaused` (`AgentRuntime.ts` 394–405).
- [ ] On resume: advance the page revision (done, `ManagedBrowserModule.ts` 1487–1491), resume the session, append the transcript note, append “Resume with instructions” text, recheck allowed sites, and confirm the same account is still signed in (C-FR-07). The runner folds stored instructions into the next subgoal once (`BrowserTaskRunner.ts` 361–365). There is no transcript note, no site recheck, and no signed-in check.
- [ ] The batch card sends the user’s instruction text. Today Resume sends no text (`BrowserControlCards.vue` 383–385). Add the field, or stop advertising “Resume with instructions” (C-FR-04).
- [ ] An action result that arrives after pause is recorded on the paused state and is not retried (C-FR-08). The in-flight program is aborted. There is no separate record-and-never-retry path.
- [ ] The 60-minute pause cap must not shorten the handoff window (C-FR-09). `AgentTaskControlService.ts` 343–357 applies the pause cap to `waiting_for_user`. `manualLoginHandoffMaxMs` is 60 minutes (`managedBrowser.ts` 69–71), so the cap can expire a handoff that the user extended.
- [ ] Queue handoff dialogs one at a time with an “N tasks need you” badge. Do not call `bringToFront()` on launch. “Open browser” focuses that task’s window, or the button stays hidden (C-FR-10, C-FR-15). No queue exists. `BROWSER_TASK_FOCUS_WINDOW` returns `focus_not_supported_yet` (`managed-browser-ipc.ts` 323–329). The “Open browser” string exists (`en.ts` 4552 and the other five languages) and no Vue button calls the channel.
- [ ] “Return results now” marks unfinished tasks `interrupted` with partial results in both the batch result and the control record (C-FR-11). The result status is `partial` (`runBrowserTasksTool.ts` 363–365). The control record is set to `cancelled` first (`AgentTaskControlService.ts` 366–372), and `setState` will not move `cancelled` to `interrupted` (123–132). The card labels `interrupted` as “Failed” (`BrowserTaskBatchCard.vue` 106).
- [ ] Window title “AI is controlling this window”, set on the BrowserWindow, not injected into the page. Repeated unexpected page changes pause the task (C-FR-15). `framenavigated` only resets refs (`WorkerSession.ts` 1089–1096).
- [ ] Session-card Pause and Take over drive `AgentTaskControlService`, not only the browser session (C-FR-16). `ManagedBrowserSessionCard.vue` 448–471 does not. `browser_execute_task` itself uses the runner gate.

### G06 — Settings, copy, and qualification

- [ ] Session settings UI: concurrent browsers (default 3, maximum 5) and optional sub-agent model. See G04.
- [ ] Six-language strings for every new card, dialog title, and error added while closing E01–E20 and G01–G05. Existing `browserSignIn` keys are present in en, zh, es, fr, de, and ja. New strings must land in all six in the same change.
- [ ] Component tests for every card and control that changes, in the same change (PRD §7).
- [ ] Replace the `test.fixme` drivers with real tool → IPC → worker → storage → renderer runs:
  - `test/e2e/specs/browserDecisionTask.test.ts` lines 25, 50, and 69 (verified completion, mid-task provider change, unverifiable DONE)
  - `test/e2e/specs/browserParallelTasks.test.ts` lines 22 and 54 (one CAPTCHA does not block the sibling; Stop releases every lease)
  - `test/e2e/specs/browserSignIn.test.ts` line 94 (wrong-password cooldown). The decoy-password test at line 34 is a real test.
- [ ] Paired held-out evaluation: current app, improved action/observation flow, hosted Jev, hosted Laya, and a custom chat provider. Report p50/p95, all-attempt cost per verified success, sample size, and the predeclared success-rate margin (PRD §8–§9, D-AC-10). The hosted contract is an external dependency (PRD §11). Do not mark this done from desktop unit tests.
- [ ] Design §6.3 names phases `reconciling`, `verifying`, and `awaiting_approval`. The runner is one `while` (`BrowserTaskRunner.ts` 338). Either implement those phases or document the loop as the accepted substitute and test every terminal in the design table against it. Unknown effect, denied approval, and sign-in handoff currently terminate instead of entering those phases.

## Requirement coverage

“Partial” means a production path exists and at least one clause is open above. “Broken” means the path runs and does the wrong thing.

| IDs | Status | Open work |
| --- | --- | --- |
| D-FR-01, D-AC-12 | Complete for the gate | Keep the gate in front of parsing and session creation |
| D-FR-02 | Partial | G01 in-flight abort on hosted/native; UI interrupt |
| D-FR-03 | Complete on the chat path | Native credential is unused until E01 |
| D-FR-04, D-05 | Broken | E01, E02 |
| D-FR-05 | Partial | Planner exists; E11 can turn a legal criterion into `runner_error` |
| D-FR-06, D-FR-10b | Complete for the custom and hosted loops | Native never enters the loop (E01) |
| D-FR-07 | Complete for admission fields | Control state stores `partial` and `interrupted` as `failed` in `BrowserTaskRunner.terminal` (around 1424–1427) |
| D-FR-08 | Broken | E03; G01 runner-ownership holes on handoff, resume, and clear-cache |
| D-FR-09 | Partial | Step timeout is always unknown (E15) |
| D-FR-10, C-FR-14 | Complete for task rows and control records | Do not auto-resume |
| D-FR-10a | Partial | Action approval waits in-job; sign-in handoff does not (G01) |
| D-FR-10c | Complete | Keep the rows feature-conditional |
| D-FR-11 | Partial | Worker probes before the snapshot; `CHALLENGE_DETECTED` is still sent after `ACTION_RESULT` (`WorkerSession.ts` 517–542). The runner then calls `observe()` again |
| D-FR-12, D-FR-15 | Partial | G01 disabled and occlusion |
| D-FR-13 | Partial | Focused and dialog elements are preferred; no task-lexical ranking |
| D-FR-14 | Partial | `ESCALATE` is offered; no recall measurement (G01) |
| D-FR-15a | Complete | Keep pins for approval and handoff |
| D-FR-16, D-AC-04 | Partial | E13 worker gate; plan bindings are not navigation targets |
| D-FR-17 | Complete on the runner and executor | Native client does not run (E01) |
| D-FR-18 | Partial | G01 negotiation |
| D-FR-19 | Complete for chat `ESCALATE` | `llm_required` is still an immediate terminal (G01) |
| D-FR-20, D-FR-21 | Broken | E05 |
| D-FR-22, D-FR-25 | Partial | E14 |
| D-FR-23 | Complete | Recovery does not spawn agents or reset budgets |
| D-FR-24, D-AC-09 | Partial | Predicate check exists; verifier and E11 do not |
| D-FR-26, D-AC-06 | Partial | E15 |
| D-FR-27, D-AC-05 | Complete | Reobservation of the same semantic action matches; approvals are single-use |
| D-AC-01, D-AC-08, D-AC-11 | Partial | Hosted probe is honest; E01 and E02 break custom and native attribution |
| D-AC-02 | Complete for the gate | Custom-provider browser tools stay usable when acceleration is off |
| D-AC-07 | Partial | Stop aborts the runner signal; in-flight click/type is not aborted mid-call (E15, G05) |
| D-AC-10 | Missing | G06 |
| A-FR-01, A-FR-04, A-FR-06, A-FR-07, A-FR-13, A-FR-14, A-FR-17, A-FR-18 | Complete for the listed paths | Keep passwords out of tool results |
| A-FR-02, A-AC-03 | Partial | E12 |
| A-FR-03, A-FR-11 | Partial | E16 cookie snapshot; E10 proxy link and cookie persist while `accountId` is 0 |
| A-FR-05 | Complete | Card, password-only mode, and `conversationId` submit |
| A-FR-08, A-FR-16, A-FR-19, A-FR-20 | Partial | E18, E19 |
| A-FR-09, A-AC-02 | Partial | E18; cooldown e2e is `test.fixme` |
| A-FR-10 | Complete | Do not move the cooldown onto `form_not_found` or 2FA |
| A-FR-12 | Missing | E17 |
| A-FR-15, A-AC-01 | Partial | G02 sentinel scope |
| A-FR-21 | Complete for the bounded two-step loop | Password-only step exists in `LoginFormFiller.ts` 545–604 |
| S-FR-01, S-FR-02, S-FR-04, S-FR-05 | Complete | Token gate and seed ids |
| S-FR-03, S-AC-01 | Partial | Distinct upsert errors exist; E12 makes dedupe wrong |
| S-FR-06, S-AC-02 | Partial | G02 callers; confirmation token is required, the journey is post-sign-in only |
| P-FR-01, P-AC-01 | Broken | E07, E08 |
| P-FR-02, P-FR-05 | Partial | E08 |
| P-FR-03 | Broken | E10 |
| P-FR-04 | Partial | G03 reason codes; E06 empty password on `getProxiesByIds` |
| P-FR-06 | Partial | Locale and timezone exist; WebRTC leak is unverified (G03) |
| P-FR-07, P-FR-08, P-AC-02 | Partial | E06; G03 `proxy_list` |
| P-FR-09 | Missing | G03 |
| M-FR-01 | Partial | Allow-list includes `browser_execute_task` always and `browser_site_upsert` (G04) |
| M-FR-02 | Complete for the result schema and `grantAccess` task id | `AgentRuntime.ts` 827–834 uses `ownerAgentId` |
| M-FR-03 | Complete | 1–5 tasks, concurrency 1–3 |
| M-FR-04, M-FR-10, M-FR-11, M-FR-12, M-FR-13 | Missing | G04 |
| M-FR-05, M-FR-06, M-FR-09 | Partial | E20, G04 |
| M-FR-07, M-AC-02 | Broken | E03, E09 |
| M-FR-08, M-AC-03 | Partial | G04 notices still use `agent-v2-*` |
| C-FR-01 | Partial | Both state owners exist; pause sets both (`managed-browser-ipc.ts` 236–246) |
| C-FR-02, C-FR-03, C-FR-09, C-AC-03 | Broken | E04 |
| C-FR-04 | Partial | Pause, Take control, Resume, Stop, and Return now exist. Resume sends no instructions (G05) |
| C-FR-05, C-FR-06, C-FR-07, C-FR-08 | Partial | G05 |
| C-FR-10, C-FR-15, C-AC-02 | Missing | G05 |
| C-FR-11, C-FR-12 | Partial | G05; E04 writes interventions on the wrong id |
| C-FR-13 | Complete for account sessions | Public sessions (`accountId === 0`) skip cookie persist |
| C-FR-14 | Complete | Startup sweep |
| C-FR-16, C-AC-01, C-AC-04 | Partial | Runner uses the gate; session card and model resume do not (E04, G05) |
| Q-01 | Missing | G02 |
| PRD §7 settings | Partial | Section and privacy copy exist; E02, G01 connection tests, G04 session controls |
| PRD §8–§9 evaluation | Missing | G06 |

## Delivery phases still open

| Phase | State |
| --- | --- |
| 0 Provider-aware gate | Present |
| 1 Baseline correctness | Open: E11, E13, E14, E15, D-FR-11 challenge event order |
| 2 Sessions and ownership | Open: E03, E09, E20 |
| 3 Proxy | Open: E06, E07, E08, E10, G03 |
| 4 Site registry | Entity, seed, and token gate present; E12 and G02 open |
| 5 Sign-in | Open: E16, E17, E18, E19, G02 |
| 6 Sub-agents and control | Open: E04, E20, G04, G05 |
| 7 Runner | Custom and hosted loops present; E05, E14, G01 verifier open |
| 8 Provider parity | Open: E01, E02, G01 negotiation and abort |
| 9 Native pilot | Broken: E01 discards the client |
| 10 Controlled rollout | Missing: G06 |
| 11 Specialization | Out of scope until phase 10 has evidence |

## Suggested order

1. E01, E02, E03, E04, E05. The native route does not run, the model override does nothing, session ownership is bypassed, a model can end a takeover, and secret-looking text fields are still filled.
2. E06, E07, E08, E10, E12. Proxy secrets, country selection, switch rollback, and registrable-domain collisions.
3. E11, E13, E14, E15. The runner mis-parses, mis-authorizes, or mis-classifies actions it already executes.
4. E16, E18, E19, then E17 once Q-02 is chosen. Sign-in journeys.
5. E20, G04, G05. Parallel tasks and user control.
6. G01, G02, G03, G06. Remaining product surface, switch-over, and release evidence.

Do not mark a requirement complete because a unit test of a helper exists. Close it when the production path in this list behaves as the PRD states and the named regression covers that path.
