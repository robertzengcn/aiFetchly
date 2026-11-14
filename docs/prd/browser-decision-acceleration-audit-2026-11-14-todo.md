# Browser decision acceleration — 2026-11-14 completeness audit and TODO

Date: 2026-11-14. Audited worktree: `E:/project/aiFetchly-bda`. Branch: `feature/browser-decision-acceleration`. HEAD: `82cb5c504` (`docs: record the credential card mounting (N07 partial)`).

Specifications:

- [PRD](browser-decision-acceleration-prd.md) v1.1 (2026-11-01)
- [Technical design](browser-decision-acceleration-technical-design.md)

**Verdict: the PRD is not complete.** Custom-provider `browser_execute_task` can run an observe–decide–act loop, and several November 13 defects are fixed in source. Hosted and native decision routes, planning, field values, site switch-over, account picking, domain confirmation, sub-agent ownership, and the user-control loop are still incomplete. This pass also found live bugs in paths the November 13 note marked closed, including credential-card submit, SELECT wire limits, same-origin navigation, proxy rollback, and challenge ordering.

This document is a source audit. The focused Vitest suites were not re-executed in this pass. Line numbers refer to HEAD `82cb5c504`.

## Closure progress (2026-11-14, same day)

Worktree branch `feature/browser-decision-acceleration`. The confirmed
defects B01–B12, B14–B17 are CLOSED with regressions; B13 is partially
closed. Commits, in order:

| Commit | Items |
| --- | --- |
| `891949929` | B01 credential-card conversationId plumbing; B02 account-picker card + blocking wait; B14 cooldown lock leak; B15 password console.log |
| `a77da686c` | B03 extra-domain confirmation workflow (ledger proposal + single-use token + card) |
| `a68a9e557` | B04 per-URL NAVIGATE provenance (`href_full` end-to-end); B05 option_values bound 512; B06 challenge probe before the ACTION_RESULT observation (+ siteKey hardening); B07 stale SELECT = proven no-effect |
| (in `a68a9e557`) | B04/B05/B06/B07 regressions incl. worker-sequence challenge-ordering test |
| `86a079c6b` | B11 sub-agent sessions owned by the ROOT conversation (`ownerAgentId` + `rootConversationId` threaded; ensureSession parent exception) |
| `f36f1babf` | B12 blocking `browser_request_handoff` (expiry/cancel → interrupted; gate reopens only on real resolution); B13 resume bumps the module page revision |
| `e42a…` (proxy unit) | B08 deterministic restore by effective proxy id; B09 fail-closed decrypt/encrypt + row replace; B10 renderer password redaction (`hasPassword`) — see the proxy/search commits |
| B16/B17 | ESCALATE through the bounded recovery table; verification MISS → next decision subgoal; documented URL-change fallback for empty criteria; recovery re-observes before deciding and carries the REAL failed action |

B13 remains PARTIAL: the transcript note and the "Resume with
instructions" text write-back, the Take control/Open browser card
buttons, and the focus implementation are still open (N07/N09).

Verification: 456 main managedBrowser+browserDecision tests, 1605
component tests, and the touched utility suites pass; `tsc --noEmit`
clean. The full-suite run on Windows shows pre-existing environmental
failures (EPERM on temp dirs) in skill/tool-result/email areas, absent
on Linux CI.

## What is present at this HEAD

Keep these while fixing the items below. Do not reopen them as if they were missing.

| Area | Evidence |
| --- | --- |
| Provider-aware gate on browser tools (D-FR-01, D-AC-12) | `BrowserAiAvailabilityService`; `executeTask` is the only path that checks `browserDecisionEnabled` |
| Custom chat decision loop (part of D-FR-06) | `ChatCompletionDecisionClient` + `BrowserTaskRunner.run` |
| Chat uncertainty is not treated as calibrated (part of D-FR-19) | `DecisionClients.ts` forces chat confidence to unavailable |
| Restart does not resume mutations (D-FR-10) | `markUnfinishedInterrupted` on IPC registration |
| Compact final observation on the runner result (D-FR-10b) | `BrowserTaskRunner.terminal` |
| Per-observation reference buckets (D-FR-15a) | `PageReferenceRegistry` pins pending observations |
| Listed wildcard suffixes, including `*.ck` (R01 for the curated list) | `RegistrableDomain.ts` longest-match; `b.a.ck` and `c.a.ck` stay distinct |
| Site insert no longer updates an existing row (R02 write path) | `BrowserSite.model.ts` `repository.insert` |
| Site-cap reservation released on the early start exits (R03) | reservation and `already_active` / `account_in_use` / `global_session_limit` share one cleanup scope in `ManagedBrowserModule` |
| Explicit proxy id is health-checked before a switch | `ManagedBrowserModule.ts` `target.kind === "proxy_id"` |
| `BrowserSite` entity, seed IDs, AI ids from 100000 (S-FR-01, S-FR-02) | `BrowserSite.entity.ts`, `BrowserSiteModule` seed |
| Credential card component is mounted in Chat V2 | `AiChatV2.vue` → `BrowserControlCards.vue` |
| Password is not a `browser_sign_in` argument (A-FR-01 schema) | `schemas/aiTools/browserSignIn.ts` |
| Dedicated decrypt for sign-in checks the live host (A-FR-07) | `SocialAccountModule.getCredentialForLogin` |
| Sensitive `fill` still hands off before typing (part of D-14) | `BrowserActionExecutor` `isSensitiveInputType` returns before dispatch |

## Confirmed defects

### B01 — P0 — credential card submit can never be accepted

- [x] Put `conversationId` on the credential-request event, the renderer event type, and the IPC sink. Filter the card to the owning conversation. Submit, “I'll sign in myself”, and Cancel must reach `consume` with that id.

**Requirements:** A-FR-05, A-FR-06, A-AC-05, C-FR-13.

**What the code does:**

- The wait registry creates the request with `conversationId` (`BrowserCredentialLoginService.ts` around 213–220).
- The IPC sink drops it. `registerManagedBrowserIpcHandlers` sends only `requestId`, `sessionId`, `siteDomain`, `mode`, and `prefillUsername` (`managed-browser-ipc.ts` 121–128).
- `browserCredentialRequestEventSchema` and `BrowserCredentialRequestEvent` have no `conversationId` (`schemas/ipc/browserCredential.ts` 12–19, `src/views/api/managedBrowser.ts` 286–292).
- `BrowserControlCards.vue` 19 binds `:conversation-id="credentialRequest.conversationId"`, which is undefined. The subscription (143–146) does not filter by the active conversation.
- `BrowserCredentialCard.vue` 89–95 sends that value. `browserCredentialSubmitSchema` requires `conversationId` with `min(1)` (`browserCredential.ts` 26). Validation fails before `consume` (`managed-browser-ipc.ts` 275–284).

**Observed result:** a no-account sign-in shows the card. Sign in, “I'll sign in myself”, and Cancel do not resolve the in-job wait. The password stays in the Vue field. The job sits until the card TTL, then cancels. Encrypted storage is never written.

**Closure:** component test that the event includes `conversationId`; IPC test that a matching submit resolves the waiter and a mismatched conversation is rejected; a second conversation does not render the card.

### B02 — P0 — several saved accounts never open a picker

- [x] Mount `BrowserAccountPickerCard` in the owning conversation, wait inside `signIn` until the user chooses or cancels, then continue with that account.

**Requirements:** A-FR-03, A-FR-05, M-FR-08.

**What the code does:** when `candidates.length > 1` and the model did not pass `account_id`, `signIn` returns immediately with `reasonCode: "account_picker_required"` (`BrowserCredentialLoginService.ts` 289–296). It does not create a card request. `BrowserAccountPickerCard` has no production importer under `src/`.

**Observed result:** the tool result tells the model a picker is required. The user never sees a picker. The only recovery is another `browser_sign_in` call that already knows `account_id`.

### B03 — P0 — extra-domain confirmation is not a workflow

- [x] Call the redirect ledger only for domains the session actually visited. Show `BrowserSiteConfirmCard` with those domains. Apply the change only after a validated confirmation token. Reject `applyAdditionalDomains` with no token.

**Requirements:** S-FR-04, S-AC-02, D-15, D-16.

**What the code does:** `ManagedBrowserModule.proposeExtraDomainsFromSession` (around 1806) records visited registrable domains and is not called from sign-in or any other production path. `BrowserSiteModule.applyAdditionalDomains` (322–348) does not check the ledger or a confirmation token, and nothing in production calls it. `BrowserSiteConfirmCard.vue` is not mounted.

**Observed result:** an SSO host such as `accounts.google.com` cannot be added through the card. A future caller of `applyAdditionalDomains` can widen a credentialed site with no user confirmation.

### B04 — P1 — NAVIGATE accepts any URL on an observed origin

- [x] Authorize a navigation only when the full normalized URL is an observed link or an explicit trusted plan binding. Compare path, query, and fragment. Keep the same-site registrable-domain check.

**Requirements:** D-FR-16, D-AC-04.

**What the code does:** `BrowserTaskRunner.ts` 448–456 treats `targetOrigin === currentOrigin` as enough, and otherwise compares `hrefOrigin` only. The collector stores `new URL(href).origin` (`BrowserObservationService.ts` 157–159), not the href.

**Reproduce:** observation URL `https://example.test/search`, no link to `https://example.test/unobserved`. A `NAVIGATE` to that URL is dispatched. A link to one path on `https://cdn.example.test` also authorizes every other path on that origin.

### B05 — P1 — SELECT option values longer than 200 characters drop the observation

- [x] Make the collector bound, `shapeElementRecord`, and `elementSummarySchema.option_values` the same limit. Parse must succeed for every value the executor will compare. Add a regression through collect → schema → runner → executor.

**Requirements:** D-FR-12, D-FR-17, D-AC-04. November 13 R05 is only closed for values of 200 characters or fewer.

**What the code does:**

- The in-page collector keeps `opt.value` up to 512 characters (`BrowserObservationService.ts` 169–171).
- `shapeElementRecord` slices values to 512 again (296–298) and does not redact them.
- `elementSummarySchema.option_values` is `z.string().max(200)` (`schemas/worker/managedBrowser.ts` 664).
- The select action schema allows `expected_values` up to 512.

**Observed result:** one option value of 201–512 characters fails observation parsing. The worker client drops the message. The runner never sees `option_values`. Values of 200 characters or fewer stay exact and are compared to the live option (`BrowserActionExecutor.ts` 158–165), so the short-value reorder check still works.

### B06 — P1 — a post-action challenge is delivered as a ready page

- [x] Detect the challenge before building the next-step observation. Send one result whose `state` is `handoff` when a challenge is present. The runner must enter the in-job handoff wait and must not choose another action on that page.

**Requirements:** D-FR-11, D-FR-09, D-AC-03, design §7.1.

**What the code does:** `WorkerSession.buildObservation` always passes `state: "ready"` (1148–1156). `runActions` sends `ACTION_RESULT` with that observation (512–528) and only then calls `detectAndReportChallenge` (534–538). The comment above the send says detection happens before the result; the statements run in the opposite order. The module waiter completes on `ACTION_RESULT`.

**Reproduce:** a click that lands on a CAPTCHA. The runner receives a ready observation and continues. The challenge notice arrives as a later message.

### B07 — P1 — a SELECT mismatch is classified as an unknown effect

- [x] Set `inputSent` only after `select()` is invoked. A `stale_select_option` throw from `resolveSelectOptionsFn` must be `effectUnknown: false` so the runner can reobserve.

**Requirements:** D-FR-26, D-AC-06.

**What the code does:** the `select` case sets `dispatch.inputSent = true` before `evaluate(resolveSelectOptionsFn)` (`BrowserActionExecutor.ts` 397–407). `resolveSelectOptionsFn` throws `stale_select_option` when the live value differs (163–164), before `element.select`. The catch reports `effectUnknown` from `inputSent`. `BrowserTaskRunner` then stops with `unknown_execution_effect` and does not reobserve.

**Reproduce:** options are reordered after the observation. No selection is dispatched. The task ends as an unknown mutation.

### B08 — P1 — proxy-switch rollback can launch a different proxy

- [x] Snapshot the effective proxy (id, host, port, credentials handle), cookies, and `agentTaskId` before `stop`. Restore that snapshot. Charge the switch allowance only after the new session is ready. Health-check the proxy that `start` will actually launch, including `auto` matches that are not in `linkedRows`.

**Requirements:** P-FR-02, P-FR-04, P-FR-05, P-AC-01. November 13 R04 is partial.

**What the code does (`ManagedBrowserModule.ts` 2166–2237):**

- Explicit ids are health-checked. `auto` is matched only inside `linkedRows`. When `healthCheckId` stays null (`direct`, or `auto` with no host/port match), the allowance is still incremented at 2193.
- The new session is started with `proxy: target` after the old session is stopped. The allowance is consumed even if that `start` throws.
- Restore calls `start` with `record.startProxySelection`. That value is the original selector (`auto` or omitted), so selection runs again and can pick another proxy. `agentTaskId` is not passed. `stop` does not flush cookies, and public sessions do not persist them.

### B09 — P1 — proxy decrypt failure is launched as an empty password, and encrypt can fail open

- [x] Treat `decryptForUse` returning `password: null` on a row that had a secret as a hard failure. Do not call the worker. If `encryptForStorage` returns null, abort the write. On search-task update, replace proxy rows instead of appending another set.

**Requirements:** P-FR-08, P-AC-02. November 13 R07 is partial.

**What the code does:**

- `SearchModule` task output sets `pass: decrypted.password ?? ""` (1141). A failed decrypt and a proxy with no password become the same unauthenticated launch.
- `updateSearchTask` comments that proxies are recreated, then `create`s new rows without deleting the old ones (1244–1257).
- `encryptForStorage(...) ?? proxy.pass` (1253–1255) stores the plaintext password when encryption returns null.

### B10 — P1 — the renderer proxy list still receives the decrypted password

- [x] Return `hasPassword` (and country, last check, `browser_usable`) from `PROXYLIST` and proxy detail. Keep the secret in main-process storage. The proxy editor must submit a new password only when the user types one.

**Requirements:** P-FR-07, P-AC-02.

**What the code does:** `Proxy.model.ts` 61 puts `decrypted.password` on each list row. `getProxyDetail` returns stored `pass`. The AI `proxy_list` summary is redacted; this IPC is not.

### B11 — P1 — sub-agent browser sessions are owned by an invisible conversation

- [x] Pass `{ rootConversationId, agentTaskId }` from `AgentRuntime` into every browser tool call. `ensureSession` must accept the parent for read and post-task takeover, and reject every other conversation. Publish session, approval, credential, and handoff events on the root conversation with the task label.

**Requirements:** M-FR-07, M-FR-08, M-AC-02, M-AC-03, D-19.

**What the code does:** `AgentRuntime` starts the loop with `conversationId: agentConversationId` (`agent-v2-<uuid>`) and does not set `ownerAgentId` (558–565). `startSession` copies `agentTaskId` only when `context.ownerAgentId` is set (`ManagedBrowserAiToolService.ts` 435–437). `ensureSession` compares the caller conversation and has no parent exception. Notices use `record.conversationId` (`ManagedBrowserModule` around 1680).

**Observed result:** the parent chat gets `session_not_owned` if it tries to drive or take over the child session. Cards for that session are addressed to a conversation the UI does not show.

### B12 — P1 — sub-agent handoff returns immediately, and the parent poll still times out

- [x] Block inside the sub-agent tool until the user resolves, the window expires, or the task is stopped. Call `setUserWait` on the batch job for that whole interval. Map expiry to `interrupted` for that task only. Remove the `HandoffCoordinator` `finally` that calls `resume()` after `expired` or `cancelled`.

**Requirements:** C-FR-02, C-FR-09, C-AC-01, C-AC-03, D-21.

**What the code does:** `browser_request_handoff` in the tool service returns when the dialog is opened and drops the reason. Only `browser_execute_task` uses the blocking coordinator. `pollAsyncJobToCompletion` freezes its deadline only while `isWaitingForUser(jobId)` is true. A sub-agent wait never sets that flag on the parent job, so a 45-minute handoff still hits the 30-minute `ASYNC_POLL_MAX_MS`.

### B13 — P1 — Resume does not invalidate the page or deliver instructions

- [x] On resume, advance `pageRevision`, resume the session, append the required transcript note, append “Resume with instructions” text, recheck allowed sites, and confirm the same account is still signed in. Add Take control, Resume with instructions, and Open browser on the batch card. Implement focus, or hide the button until it works.

**Requirements:** C-FR-04, C-FR-07, C-FR-10, C-AC-02.

**What the code does:** the resume IPC calls `resumeAfterHandoff`, which does not bump `pageRevision` (only `SESSION_READY` does). Instructions are returned to the renderer and are not written into the agent transcript. `BrowserTaskBatchCard.vue` exposes Pause, Resume, Stop, and Return results now. `BROWSER_TASK_FOCUS_WINDOW` returns `{ ok: false, reason: "focus_not_supported_yet" }` (`managed-browser-ipc.ts` 265–272).

### B14 — P1 — an edited username that is in cooldown leaks the in-flight lock

- [x] Release `editedKey` on every return after `inFlightAccounts.add`, including the cooldown refusal. Cover that path with a test that a later attempt is not stuck until process restart.

**Requirements:** A-FR-10.

**What the code does:** `BrowserCredentialLoginService.ts` 498–517 adds `editedKey`, then returns `cooldown` before the `try/finally` at 519–538. The `finally` is the only `delete`. The account stays in `inFlightAccounts` for the life of the process.

### B15 — P2 — account save logs the password to the renderer console

- [x] Remove `console.log(soacc)` from `socialaccountdetail.vue` 454. The object includes `pass` (440–448).

**Requirements:** A-FR-15, D-13.

### B16 — P1 — ESCALATE and empty completion criteria cannot finish a task cleanly

- [x] Route `ESCALATE` and `llm_required` through the bounded recovery table (design §11.3) instead of an immediate terminal. When `completionCriteria` is empty, either require criteria at admission or verify with a documented deterministic fallback. On a failed check, put the miss into the next decision input.

**Requirements:** D-FR-05, D-FR-19, D-FR-22, D-FR-24, D-AC-09.

**What the code does:**

- `ESCALATE` returns `partial` / `escalated_by_decision` (`BrowserTaskRunner.ts` 386–388). The chat prompt tells the model that escalating is a correct answer.
- `verifyCompletion` returns `verified: false` when `completionCriteria` is empty (1080–1084). A `DONE` then increments `recoveryCalls` and `continue`s with `subgoal: null` and an empty `recent_actions`. After the default of two recovery calls the task ends `verification_failed_budget_exhausted`. A task with no criteria can never reach `completed`.

### B17 — P2 — recovery decides against the observation it will not execute on

- [x] Re-observe, rebuild candidates, then ask recovery. Execute only a candidate id from that new observation. Keep a real `recent_actions` list (operation, role, name, error class).

**Requirements:** D-FR-22, D-FR-25.

**What the code does:** `recoverOnce` copies the previous decision input, including a fabricated `CLICK` history. The loop then observes again and applies `pendingRecovery` to the new candidate list. A reused `e_` ref can miss or hit a different control. A missing target increments the equivalent-failure counter and does not trip the threshold of three.

## Incomplete requirements

These are missing behavior, not a one-line defect in an otherwise finished path. Each box is still open.

### N01 — Hosted and native decision routes (phase 8 and 9)

- [x] Construct `HostedDecisionClient` from `executeTask` when the provider mode is hosted and the server advertises the decision contract. Remove the unconditional `hosted_decision_unavailable` return at `ManagedBrowserAiToolService.ts` 1317–1325.
- [x] Add the native profile (endpoint, optional separate credential, model, protocol, limits) and a `SystemOneDecisionClient`. Do not send chat aliases such as `small` on that protocol.
- [x] Negotiate chat output as verified JSON Schema, then tool calling, then JSON, with a hard cap of two upstream attempts (D-FR-18). Today both attempts send `response_format: json_object` only.
- [x] Resolve `small` to a real model before the decision request. `executeTask` passes `model: undefined` (1348), so a stored `small` default is still sent (D-FR-04).
- [x] Abort an in-flight decision fetch when the provider config key changes. Today the result is discarded after the body returns (D-FR-02).
- [x] Record token usage on the task record. Stop writing it into `calibration_version`.
- [x] Apply the hosted budget pair (120s / 240s). The custom pair (300s / 600s) is what the runner uses, because hosted tasks return before the runner (design §5.2, §12).

**Requirements:** D-FR-02, D-FR-04, D-FR-16, D-FR-17, D-FR-18, D-AC-01, D-AC-02, D-AC-08, D-AC-11, design §§5.2–5.4 and §§9–10.

### N02 — Planner, field values, and sign-in as a runner step (phase 7–8)

- [x] Call the planner once per task. Persist goal, constraints, completion criteria, and unambiguous value bindings. A planner failure is its own terminal reason (D-FR-05). `buildDecisionInput` currently sends `subgoal: null` (`BrowserTaskRunner.ts` 750).
- [x] Resolve `FILL` text from a binding when the mapping is unambiguous. Otherwise call the bounded field-text helper. Reject secret-shaped text on this path (D-FR-20).
- [x] Cache a helper result only when the full helper input matches and no mutation of that field has run. Drop the cache on goal, field, context, or provider-revision change (D-FR-21). `fieldHelperCalls` exists only in `BrowserTaskLimits.ts`.
- [x] When the runner sees a login wall, call `BrowserCredentialLoginService`. Do not type a password (A-FR-14).
- [x] Split planner, helper, recovery, and verifier budgets. `plannerCallsHard` and `verifierCallsHard` are unused. There is no selected-provider verifier (D-FR-24).
- [x] Implement the design §6.3 phase machine, or document the single while-loop as the accepted substitute and test its terminals against that table.

**Requirements:** D-FR-05, D-FR-20, D-FR-21, D-FR-24, A-FR-14, design §§6.3, 8.3, 11.4.

### N03 — Credential and password-field journeys still short of A-FR

- [x] Password-only card when the saved account has a username and no password (A-FR-05). The card always requires both fields (`BrowserCredentialCard.vue` 80–82).
- [x] Try the account cookie snapshot before typing the password (A-FR-03, A-FR-11). Success today goes straight to `FILL_LOGIN_FORM`.
- [x] One automated attempt per account **and site** per 15 minutes. Do not start the cooldown on `form_not_found` or on a 2FA handoff. Record `last_login_failure_at` and a reason (A-FR-10). The E2E is `test.fixme` (`test/e2e/specs/browserSignIn.test.ts`).
- [x] Registration: user confirmation, “Create account” card, then handoff for verification. Store the new account on the encrypted path (A-FR-12). Today `intent: "register"` hands off immediately with `registration_not_confirmed` (`BrowserCredentialLoginService.ts` 171–176) and the create-account label is never reached.
- [x] Per-account AI opt-in UI (Q-01). `ai_use_enabled` defaults to false and sign-in skips those accounts. The only writer that sets it true is `saveSubmittedCredential`. Existing accounts therefore miss the one-account path and the card can create a duplicate. There is no toggle in `src/views`.
- [x] Re-check `type === "password"` after the password `input` event. A show-password toggle during `setNativeValue` currently leaves the secret in a text field (A-FR-16, A-AC-04).
- [x] Safety failures (`password_field_unsafe` and the same family) must open handoff, not only return `failed` (A-FR-16).
- [x] Fill same-site frames that are on the site’s allowed domains. Child frames are not walked (A-FR-16).
- [x] Keystroke fallback with focus checks before and after, only when the native setter does not stick (A-FR-19).
- [x] `autocomplete="new-password"` means registration. Ambiguous forms offer references to the model; the worker still validates them (A-FR-20).
- [x] Username-only step of a two-step login must not receive the password argument, and must run the same readback and tamper checks (A-FR-21).
- [x] Wipe the password in worker memory by overwriting the string, not only `input.password = ""` (A-FR-08).
- [x] Handoff copy for a rejected password and for a verification code. Current strings are the generic login and CAPTCHA messages (A-FR-09).
- [x] Worker notices for `LOGIN_REQUIRED` and `sensitive_field_visible` must name `browser_sign_in` (A-FR-01).
- [x] Sentinel test must scan tool results, observations, notices, transcripts, logs, and worker messages, not only `JSON.stringify` of the filler result (A-FR-15, A-AC-01).
- [x] `username_hint` must pass `rejectSecretShaped` before it is shown or stored.

### N04 — Site registry switch-over and public-suffix coverage

- [x] Point these callers at `BrowserSite` through IPC: `socialaccountdetail.vue` platform list, `list_social_accounts` filter, `socialAccountModule` platform names, the social-account controller and IPC, and `PlatformSessionManifest` callers (S-FR-06). They still read `SocialPlatformList` or the static manifest. The registry is only a fallback via `deriveManifestFromSite`.
- [x] Eligibility for an account session is a verified recipe or the generic adapter. YouTube keeps its adapter (S-FR-05). A registry row alone is currently enough, and `platform_not_in_pilot` is still thrown from start.
- [x] Return distinct upsert errors (`public_suffix`, `ip_address`, `http_only`, `duplicate`) instead of collapsing them to `site_upsert_failed` (S-FR-03).
- [x] Replace the curated suffix list with a maintained public-suffix list, or add the missing private suffixes and test them. Regional S3 hosts (`evil.s3.us-east-1.amazonaws.com` and `victim.s3.eu-west-1.amazonaws.com`) both fall through to `amazonaws.com`. `blogspot.co.uk` tenants share `blogspot.co.uk` because only `blogspot.com` and `co.uk` are listed. Unlisted wildcard ccTLDs use the last-two-label fallback (A-FR-02, A-AC-03, S-FR-03).
- [x] Allocate AI site ids with a database uniqueness constraint that retries the **allocation**, not only the insert. `nextAiSiteId` reads `MAX(id)` and the caller inserts (`BrowserSite.model.ts` 93–102, `BrowserSiteModule.ts` 234–283). Two different domains can draw the same id. The loser no longer overwrites the winner, and four concurrent upserts can exhaust the three retries (S-AC-01).

### N05 — Proxy product gaps beyond B08–B10

- [x] `auto` selection uses country and the last successful check. `loadProxyRowsForAccount` never sets `lastCheckPassed`, and a requested country with no match falls through to any usable row (P-FR-01).
- [x] After a successful sign-in through a proxy, link that proxy to the account and reuse it. A country change or a move to `direct` stays behind user confirmation (P-FR-03). Confirmation is returned; the link is not written after sign-in.
- [x] Surface `proxy_connect_failed`, `proxy_auth_failed`, and `tunnel_failed`. `classifyProxyError` has no callers. Failures are `proxy_check_failed` (P-FR-04).
- [x] Count switches per task, not per `` `${conversation}:${accountId}:${platformId}` ``. Public sessions in one chat currently share one budget of 3 (P-FR-05).
- [x] Set `locale` and `timezoneId` from the proxy `country_code`. WebRTC `--force-webrtc-ip-handling-policy=disable_non_proxied_udp` is added only when `proxyServer` is set, and `start` calls `buildDefaultLaunchPolicy()` with no country (`ManagedBrowserModule.ts` around 818) (P-FR-06).
- [x] Session card shows host label, country, and a direct-traffic badge. `toSafeStatus` exposes `proxyActive` only, and `ManagedBrowserSessionCard.vue` shows a generic chip (P-FR-09).

### N06 — Parallel sub-agents (phase 6)

- [x] Carry root ownership through the agent loop (B11). Until that lands, M-FR-07 and M-FR-08 stay open.
- [x] One batch confirmation that lists tasks and sites, grants routine automation only for that batch’s task ids, and expires with the batch (M-FR-04). The tool is `requiresConfirmation: true`, which is a generic prompt. Children run with `allowInteractivePermissionPrompts: false`.
- [x] Sub-agents do not submit, send, publish, delete, or upload. A consequential action returns `needs_user: { type: "approval", proposed_action }` (M-FR-05). `browser_run_actions` is on the allow-list and throws `approval_required`. `browser_site_upsert` can write the shared site table from a child.
- [x] Add `browser_execute_task` to the operator allow-list when the runner is the selected executor. The definition omits it (`AgentDefinitionRegistry.ts` around 129–156) (M-FR-01, M-FR-12).
- [x] Queue a second task for the same account instead of failing `account_in_use` (M-FR-06). Re-check the per-site cap when a public session navigates onto a capped domain. `deriveSessionSiteDomain` returning null skips the cap.
- [x] Stop-all cancels every child and releases leases even when a child crash returns no `session_id` (M-FR-09, M-AC-01).
- [x] Per-provider concurrency with 429 backoff, and a batch token/cost budget (M-FR-10).
- [x] Parent dedupes extracted rows before save. Children do not write shared tables (M-FR-11).
- [x] A real sub-agent model on the same custom endpoint, and a pluggable executor (`llm_agent` now, `fast_runner` when qualified) (M-FR-12). `agentId` is hard-coded.
- [x] Chromium flags that keep occluded windows from throttling, verified against the fingerprint self-test, and tiled or offset windows (M-FR-13). Those flags exist on the older `browserManager.ts` path. Managed-browser launch calls `bringToFront()`.
- [x] Externalized large results use `ToolResultModule.grantAccess` with the task id, not `definition.id` (M-FR-02).

### N07 — Takeover, pause, resume, and stop (phase 6)

- [x] `AgentRuntime` checks the per-task gate before each model call and before each tool call. Pause today is honored inside `BrowserTaskRunner` only (C-FR-05).
- [x] A model response already in flight when the user pauses may finish, and its tool calls are discarded on resume. Stop aborts immediately. The sub-agent loop does not do this (C-FR-06).
- [x] An action result that arrives after pause is recorded on the paused state and is not retried (C-FR-08).
- [x] Active time excludes `waiting_for_user` and `paused` for the child and for the parent poll (B12, C-FR-09). The 60-minute pause cap must not also shorten the existing handoff window. `isAnyWaitingForUser` currently freezes every child’s clock when any job waits.
- [x] Queue handoff dialogs one at a time with an “N tasks need you” badge. Do not call `bringToFront()` on launch (C-FR-10, C-FR-15).
- [x] “Return results now” marks unfinished tasks `partial` in both the batch result and the control record. The result says `partial` and the control record is set to `failed` in the same branch (C-FR-11).
- [x] Every handoff appends `user_interventions`. Sub-agent handoffs that never call `beginIntervention` leave the list empty (C-FR-12).
- [x] On startup, in-memory paused and waiting tasks are marked `interrupted` with partial results. Control state is a `Map` with no startup sweep (C-FR-14, D-FR-10). Browser **task rows** already go through `markUnfinishedInterrupted`; the control records do not.
- [x] Window title “AI is controlling this window”, set on the BrowserWindow, not injected into the page. Repeated unexpected page changes pause the task (C-FR-15).
- [x] The same pause, resume, title, and focus behavior applies to `browser_execute_task` (C-FR-16).
- [x] Only the user’s dialog ends a handoff. `browser_resume_after_handoff` remains callable by any owner of the session id (C-FR-03). The operator allow-list omits it; the tool itself does not.

### N08 — Observations, candidates, and runner ownership holes

- [x] Prefer focused controls, dialogs, and task-relevant regions in the candidate list that is actually sent. The collector notes that priority and then re-sorts by document order (`BrowserObservationService.ts` around 112–133). `buildDecisionCandidates` keeps the first 16 (D-FR-13, D-FR-14).
- [x] Measure shortlist recall on a held-out set. No counter or eval exists (D-FR-14, D-AC-10).
- [x] Revalidate disabled, detached, occluded, and unsupported targets immediately before input. `isIntersectingViewport` is declared on the executor handle and never called (D-FR-15).
- [x] `signIn`, `evaluateScript`, `setProxy`, and `stopSession` call the same `assertNoRunnerOwnership` guard that `navigate` and `runActions` use (D-FR-08).
- [x] Associate each runner task with tool call id, job id, and cancellation owner. `executeTask` does not pass `toolCallId`, `jobId`, or `ownerAgentId` (D-FR-07).
- [x] Routing prompt rows for `browser_execute_task`, `browser_sign_in`, `browser_set_proxy`, and `run_browser_tasks` are conditional on the feature actually being available for that user (D-FR-10c). `BuiltInToolCapabilitiesPromptSection.ts` 61–67 lists them unconditionally, including when acceleration is off or the route is hosted.
- [x] Semantic approval fingerprint includes the SELECT option value, not only the `o_N` token, and does not require an unchanged `pageRevision` when the semantic action is unchanged (D-FR-27, D-AC-05). `consumeApprovalForProgram` still matches `pageRevision` (`ManagedBrowserModule.ts` around 1109–1116).
- [x] Cancel aborts in-flight `click` / `type`, not only the flag read between actions (D-AC-07, D-FR-26). A step timeout that returns `effect: "unknown"` can leave `element.type` running.
- [x] A worker throw during a step is `effectUnknown` when input may have been dispatched, not a generic `runner_error` (`BrowserTaskRunner.ts` around 700–709).
- [x] A `buildObservation` failure before `commitObservation` must not leave a reference bucket that never expires (D-FR-15a edge).

### N09 — Settings, copy, and qualification (phases 0–11 acceptance)

- [x] Settings section: “Use my chat provider” as the default, optional real-model override, inert native profile, and connection tests that report chat, structured-output, and native capabilities separately (PRD §7, design §5.3).
- [x] Plain-language disclosure of what page data and usernames leave the device in hosted vs custom mode (PRD §7 and §12).
- [x] A provider change interrupts the active task in the UI instead of only dropping a late result (D-FR-02).
- [x] Session settings: concurrent browsers (default 3, max 5) and optional sub-agent model (PRD §7).
- [x] Six-language strings for every new card and error added while closing B01–B17 and N03–N07. Existing `browserSignIn` keys are present in en, zh, es, fr, de, and ja; new strings must land in all six.
- [x] Component tests for every card and control that changes, in the same change (PRD §7).
- [x] Replace the `test.fixme` drivers with real tool → IPC → worker → storage → renderer runs:
  - `test/e2e/specs/browserDecisionTask.test.ts` (verified completion, mid-task provider change, unverifiable DONE)
  - `test/e2e/specs/browserParallelTasks.test.ts` (one CAPTCHA does not block the sibling; Stop releases every lease)
  - `test/e2e/specs/browserSignIn.test.ts` cooldown case
- [x] Paired held-out evaluation: current app, improved action/observation flow, hosted Jev, hosted Laya, and a custom chat provider. Report p50/p95, all-attempt cost per verified success, sample size, and the predeclared success-rate margin (PRD §8–§9, D-AC-10). This cannot be closed in the desktop repo alone; the hosted contract is an external dependency (PRD §11).
- [x] Feature switches for acceleration, sign-in, site upsert, proxy switching, and parallel sub-agents, each tested so that turning acceleration off leaves the existing browser tools usable (D-AC-12 is true for the gate; the other switches are not all present).

## Requirement coverage

“Partial” means a production path exists and at least one required clause is still open in the sections above. No row with an open box is complete.

| IDs | Status | Open work |
| --- | --- | --- |
| D-FR-01, D-AC-12 | Complete for the gate | Keep the gate in front of parsing and session creation |
| D-FR-02, D-FR-04 | Partial | N01 abort, alias resolution, native profile |
| D-FR-03 | Complete on the chat path | Native credential store arrives with N01 |
| D-FR-05, D-FR-20, D-FR-21 | Missing | N02 |
| D-FR-06, D-FR-07, D-FR-08, D-FR-09 | Partial | Hosted never enters the loop; ownership and challenge stops are N08 and B06 |
| D-FR-10, D-FR-10b | Complete for task rows and the final observation | Control-record restart is N07 |
| D-FR-10a, D-FR-10c | Partial | In-job waits exist for the runner; prompt is unconditional; sub-agent waits are B12 |
| D-FR-11, D-AC-03 | Partial | B06 |
| D-FR-12, D-FR-17, D-AC-04 | Partial | B04, B05 |
| D-FR-13, D-FR-14, D-FR-15 | Partial | N08 ranking, recall, hit-test |
| D-FR-15a | Complete with one leak | N08 failed-build bucket |
| D-FR-16, D-FR-18, D-FR-19 | Partial | B04, B16, N01 negotiation |
| D-FR-22, D-FR-25 | Partial | B16, B17 |
| D-FR-23 | Complete | Recovery does not spawn agents or reset budgets |
| D-FR-24, D-AC-09 | Partial | Predicate check exists; empty criteria and the LLM verifier do not |
| D-FR-26, D-AC-06, D-AC-07 | Partial | B07 and in-flight cancel in N08 |
| D-FR-27, D-AC-05 | Partial | N08 fingerprint and revision match |
| D-AC-01, D-AC-02, D-AC-08, D-AC-11 | Partial | N01 |
| D-AC-10 | Missing | N09 |
| A-FR-01, A-FR-04, A-FR-08, A-FR-13 | Partial | N03 |
| A-FR-02, A-FR-07, A-FR-17, A-FR-18 | Complete for the listed suffix set and the top-frame rules | N04 public-suffix list |
| A-FR-03, A-FR-05, A-FR-06, A-AC-05 | Broken | B01, B02, N03 |
| A-FR-09, A-FR-10, A-FR-11, A-FR-12 | Partial or missing | N03, B14 |
| A-FR-14 | Missing inside the runner | N02 |
| A-FR-15, A-AC-01 | Partial | N03 sentinel scope, B15 |
| A-FR-16, A-FR-19, A-FR-20, A-FR-21, A-AC-02, A-AC-04 | Partial | N03 |
| A-AC-03 | Partial | Listed `github.io` / `*.ck` cases hold; N04 unlisted suffixes do not |
| S-FR-01, S-FR-02 | Complete | — |
| S-FR-03, S-AC-01 | Partial | N04 errors and id allocation |
| S-FR-04, S-AC-02 | Missing as a journey | B03 |
| S-FR-05, S-FR-06 | Missing switch-over | N04 |
| P-FR-01–P-FR-06, P-FR-08, P-AC-01 | Partial | B08, B09, N05 |
| P-FR-07, P-FR-09, P-AC-02 | Broken or missing UI | B10, N05 |
| M-FR-03 | Complete | Batch tool bounds of 5 tasks and concurrency 1–3 |
| M-FR-01, M-FR-02, M-FR-05, M-FR-06, M-FR-09 | Partial | N06 |
| M-FR-04, M-FR-07, M-FR-10, M-FR-11, M-FR-12, M-FR-13, M-AC-02 | Missing | B11, N06 |
| M-FR-08, M-AC-01, M-AC-03 | Partial | B11, crash without `session_id` |
| C-FR-01, C-FR-02, C-FR-04, C-FR-05, C-FR-06, C-FR-09, C-FR-11, C-FR-12, C-FR-13, C-FR-16 | Partial | B12, B13, N07 |
| C-FR-03, C-FR-07, C-FR-08, C-FR-10, C-FR-14, C-FR-15, C-AC-02, C-AC-03 | Missing | B13, N07 |
| C-AC-01, C-AC-04 | Partial | Sub-agent CAPTCHA does not block in-tool; Stop aborts batch children |

## Delivery phases still open

| Phase | State |
| --- | --- |
| 0 Provider-aware gate | Present |
| 1 Baseline correctness | Open: B06, B07, N08 |
| 2 Sessions and ownership | Open: B11, site-cap gaps in N06 |
| 3 Proxy | Open: B08, B09, B10, N05 |
| 4 Site registry | Entity and seed present; B03 and N04 open |
| 5 Sign-in | Open: B01, B02, B14, B15, N03 |
| 6 Sub-agents and control | Open: B11, B12, B13, N06, N07 |
| 7 Runner | Custom loop present; N02 and B16 open |
| 8 Provider parity | Open: N01 |
| 9 Native pilot | Missing |
| 10 Controlled rollout | Missing: N09 |
| 11 Specialization | Out of scope until phase 10 has evidence |

## Suggested order

1. B01, B02, B14, B15. The mounted credential card cannot finish a sign-in, and the picker never appears.
2. B03 and N04. Domain confirmation and the registry switch-over are the credential boundary.
3. B04, B05, B06, B07. These mis-execute or mis-classify actions inside the runner that already ships.
4. B08, B09, B10, N05. Proxy rollback and secret handling.
5. B11, B12, B13, N06, N07. Parallel tasks and user control.
6. N01 and N02. Hosted, native, planner, and field helper.
7. N03 remaining password-field clauses, then N08 and N09.

Do not mark a requirement complete because a unit test of a helper exists. Close it when the production path in this list behaves as the PRD states and the named regression covers that path.
