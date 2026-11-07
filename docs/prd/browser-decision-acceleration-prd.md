# Browser Decision Acceleration and Browser-Use Expansion — Desktop PRD

## Document information

| Item | Value |
| --- | --- |
| Status | Proposed implementation contract; no feature is implemented by this document |
| Version / date | 1.1 / 2026-11-01 (1.0 / 2026-10-30) |
| Repository / owners | AiFetchly / Desktop, AI Runtime, Browser Automation, QA |
| Baseline inspected | `c01e6cd9c` (1.0); re-verified at `2b898c2ef` (1.1) with no drift in referenced files |
| Companion | [Desktop technical design](browser-decision-acceleration-technical-design.md) |
| Server requirements | [Server PRD](../../../aifetchserver/doc/decision-model-routing-prd.md) |
| Wire authority | [Server technical design, contract v1](../../../aifetchserver/doc/decision-model-routing-technical-design.md#5-public-contract-v1) |

“Must” defines required behavior. Numerical limits and performance targets marked proposed are initial engineering defaults, not measured results or commercial promises. Existing browser security and account policies continue to apply unless this document explicitly replaces them. This document extends browser AI availability to a user's configured provider; it does not unlock unrelated hosted AI features.

### Revision 1.1 summary

Version 1.1 incorporates a review of 1.0 against the code and five follow-up product requirements:

1. **Review corrections** to 1.0: the missing unknown-effect classification, the approval/reference-token loop, reference-registry lifetime, the rollback gap for custom-provider users, the state-machine holes, route-specific budgets, the operation set, outer-LLM context, tool routing, privacy and billing statements, a glossary, and editorial errors.
2. **Saved-account sign-in** (§6.7): use an existing `SocialAccount` to log in, ask for credentials in a chat card when none exists, and hand off to the user on failure. The LLM may see the username; it must never see the password.
3. **Password-field safety** (§6.8): the password can only ever be typed into a single, visible, HTTPS, on-domain `type=password` input.
4. **LLM-addable sites** (§6.9): replace the hardcoded platform list with a site registry the LLM can extend under domain guardrails.
5. **Proxy support** (§6.10): choose a proxy at session start and switch it during a session.
6. **Parallel browser sub-agents** (§6.11): the LLM delegates browser tasks to sub-agents that run several browsers concurrently and return compact results.
7. **User takeover, pause, resume, and stop for sub-agent browsers** (§6.12).

## 1. Problem and evidence

Browser automation currently requires repeated generative-model decisions. Each round can resend conversation context, tool definitions, and page observations. This increases latency and cost, particularly for routine clicking, filtering, and filling. Beyond speed, the current browser-use function stops at every login wall, works only with one hardcoded set of sites, cannot change proxy, and runs one browser at a time.

Verified implementation facts (decision path):

- `src/service/AIChatQueryLoop.ts` dispatches repeated completion requests with the current messages and exposed tools; tool results enter the transcript. Existing context budgeting/compaction already bounds this behavior, but does not eliminate repeated inference.
- `src/childprocess/managed-browser/WorkerSession.ts` returns `observation: null` after an action program and sends `ACTION_RESULT` **before** `detectAndReportChallenge()`. Only `observe()` updates the main process `lastObservation` and `pageRevision`. The model can need an additional observation tool round before deciding the next action. Batching means this is not necessarily two calls for every individual action.
- `BrowserObservationService.ts` provides sanitized semantic observations, registered references, and bounded text. The current budgets are 120 interactive elements, 12,000 text characters, and 64 KiB serialized observation size. Text-input values are reported as `valueSummary`; `ResultSanitizer.summarizeInputValue` masks only password-type and secret-looking values.
- `ManagedBrowserAiToolService.ts` already enforces target-based risk checks, exact-program approvals, challenge handoff, and cancellation. Its AI gate checks hosted entitlement (`USER_AI_ENABLED`) for **every** browser tool.
- `AIProviderResolver.ts` already routes chat to hosted or user-managed providers. The persisted name `local` includes remote third-party endpoints.
- The existing action program (`src/schemas/worker/managedBrowser.ts`) already supports `navigate`, `click`, `fill`, `select`, `press_key`, `scroll`, `wait_for`, `extract`, `hover`, and `go_back`.

Verified implementation facts that 1.0 did not account for:

- **No unknown-effect outcome exists.** `BrowserActionExecutor` never sets `effectUnknown: true`; its catch-all returns `{ success: false, errorCode: "internal_error", effectUnknown: false }`. A click that throws after dispatch (the click uses `{ timeout: 5_000 }`) or a fill that fails halfway is reported as “failed, nothing happened”. The `ManagedBrowserModule.cancelActiveRequest` comment claiming cancelled consequential steps keep effect=unknown is not true today.
- **Approval digests include random reference tokens.** `computeProgramDigest` hashes the raw actions JSON, which contains `e_<random>` references. `PageReferenceRegistry` creates a new random reference on every observation. Approval works by reject-and-recall: the tool throws `approval_required`, the user decides, and the outer LLM calls the same program again (`consumeApprovalForProgram`). Any reobservation changes every reference and therefore the digest.
- **The reference registry is small and short-lived:** 200 entries, 60-second TTL, oldest-first eviction. Clicks do not reset the revision; only navigation does.
- **Login walls always stop the task.** `BrowserActionRiskClassifier` routes credential URLs and password-like fields to handoff, and the executor forces handoff on fill/clear of sensitive inputs. This is intentional for LLM-driven input and stays.
- **Saved accounts are ignored for every site except YouTube.** `MANAGED_BROWSER_PILOT_PLATFORM_IDS = [2]`; for any other platform `browser_start_session` catches `platform_not_in_pilot`/`account_not_found` and silently opens an account-free browser.
- **Sites are hardcoded** in three places: `SocialPlatformList` (`src/config/generate.ts`), `PLATFORM_SESSION_MANIFEST` (`src/modules/PlatformSessionManifest.ts`, IDs 1, 2, 3, 4, 5, 14), and the pilot list. `SocialAccountEntity` has no site/domain column; its only link to a site is `social_type_id`. The renderer platform list also comes from the remote `/api/socialplatform/list`.
- **Passwords:** `social_accounts.pass` is encrypted at rest with `FieldCipher` in `socialAccountModule`, but list/get methods return it decrypted. `proxy.pass` is stored in plain text.
- **The username already reaches the LLM:** `list_social_accounts` returns `user`, and `listEligibleAccounts` falls back to `user` as the label. Under 1.1 this is acceptable (§6.7).
- **Proxy is fixed at launch and account-only.** `resolveAccountProxy` takes the first usable HTTP(S) proxy linked to the account; the worker passes it as `--proxy-server` with credentials through CDP authentication; failures are closed (never fall back to direct). Account-free sessions always connect directly; SOCKS is rejected; there is no mid-session switch.
- **One browser at a time.** `MANAGED_BROWSER_GLOBAL_SESSION_LIMIT = 1`. Leases are keyed by account ID, so every account-free session uses account `0` and a second one gets `account_in_use`. Each session is already its own worker process and headed Chrome; only the controlling loop runs in the main process.
- **Tool calls in one round run sequentially** (`for (const call of parsedCalls)` in `AIChatQueryLoop.ts`).
- **Sub-agents cannot use the browser or wait for the user.** `AgentRuntime` runs in-process under a hidden conversation ID `agent-v2-<uuid>`; `AgentDefinitionRegistry` gives no agent browser tools; a permission prompt becomes `agentPermissionDenied`, and `paused_for_permission` fails the task. `ToolJobRegistry` statuses are `queued`, `running`, `completed`, `failed`, `cancelled`; there is no paused state. The agent's runtime limit is a wall-clock `setTimeout(maxRuntimeMs)`, and the parent's `pollAsyncJobToCompletion` gives up at `ASYNC_POLL_MAX_MS = 30 min` while a handoff may last 60 minutes.
- **No session ownership check.** `ensureSession` checks only that a session exists, not who owns it.
- **Handoff already exists at session level:** `requestHandoff`, `verifyManualLogin`, `resumeAfterHandoff`, `extendHandoff`, the 10-minute default / 60-minute maximum window, `ManagedBrowserHandoffDialog.vue` (Verify, Extend, Cancel), and `guard()`/`assertCommandAllowed` rejecting AI commands while the session is in `handoff`. In the main chat the LLM's turn ends at handoff; the `task_resuming` notice is informational and does not restart the model.

These facts establish potential overhead and capability gaps, not a measured production bottleneck. Instrumentation must establish the actual baseline before claiming savings.

## 2. Product outcome

Let an LLM establish the task, constraints, and reusable text values. Let a fast decision engine select routine operations and observed targets. Keep execution on the desktop and invoke an LLM only for planning, necessary text generation, ambiguous decisions, recovery, and final verification when deterministic checks are insufficient.

The decision engine must work with:

1. AiFetchly-hosted Jev or hosted Laya through the AI server.
2. A user-managed native decision API, including a compatible hosted Laya service.
3. An ordinary user-managed OpenAI-compatible chat API through a compact chat-based decision adapter.

Native discriminative inference and chat-based decision generation are distinct implementations. Structured JSON from a chat model does not make it a discriminative model or guarantee equivalent latency/calibration.

In addition, browser use must:

4. Sign in with a saved account without the password reaching any LLM, ask the user for credentials in a chat card when no account exists, and hand off to the user when automated sign-in fails.
5. Work on sites the LLM discovers during use, not only a hardcoded list, without letting a page redirect saved credentials to another domain.
6. Reach sites through a user-configured proxy chosen at start or switched during a session.
7. Run several browser tasks in parallel through sub-agents that return compact results to the parent conversation.
8. Let the user take over, pause, resume, or stop any browser task, including tasks run by sub-agents.

## 3. Users and primary stories

| User | Story | Required result |
| --- | --- | --- |
| Hosted subscriber | Search a site and apply filters without waiting for a full chat round per action | Bounded fast loop; normal browser visibility and progress |
| Custom-provider user | Run the same task through my chosen endpoint and credentials | Direct desktop-to-provider requests; no silent hosted requests; browser tools work without a hosted subscription |
| Advanced user | Use a cheaper browser model while retaining a stronger planning model | Optional real model override on the same provider |
| Native-model user | Configure a dedicated Jev/Laya-compatible endpoint | Native capability validation and typed decisions |
| User with a saved account | The AI meets a login wall on a site I have an account for | The app signs in with my saved account; the password never reaches the LLM |
| User without a saved account | The AI meets a login wall on a new site | A chat card asks me for username and password (username may be pre-filled by the AI); I can save the account |
| User facing a challenge | Sign-in fails, or 2FA/CAPTCHA/passkey appears | Existing handoff dialog with a clear reason; I complete it myself |
| User exploring new sites | The AI visits a site that is not in the platform list | The AI can register the site; adding extra credential domains needs my confirmation |
| Proxy user | A site is geo-blocked or unreachable | I or the AI pick a proxy at start or switch it; my real IP is never used silently |
| Power user | Research several sites at once | The AI delegates tasks to parallel browser sub-agents and summarizes their results |
| Any user | A sub-agent's browser needs me, or I want it to stop for a moment | I can take over, pause, resume with instructions, or stop each task |
| Operator | Explain failures and actual task cost | Correlated task/step/attempt records with redacted metadata |

## 4. Scope and non-goals

### In scope

- A single managed-browser task runner exposed through `browser_execute_task`.
- Existing Puppeteer worker, session lifecycle, accounts, and browser dependencies.
- Post-action observation, compact candidates, provider adapters, budgets, and capability discovery.
- Reusable planned field values, bounded field-text helper, recovery, and outcome verification.
- Provider-aware browser availability for **all** browser tools, independent of the acceleration feature; configuration UI, progress, stop, approval, and handoff behavior.
- Hosted and custom-provider parity for browser tasks, with route-specific capabilities and honest limitations.
- Executor unknown-effect classification and approval binding that survives reobservation.
- A privileged, deterministic sign-in service for saved or user-supplied credentials, with a secure credential card.
- A database-backed site registry seeded from the current hardcoded lists, extendable by the LLM and the user.
- Proxy selection at session start and controlled proxy switching.
- A browser-operator sub-agent, a bounded parallel fan-out tool, per-session leases, session ownership, and notices routed to the parent conversation.
- Takeover, pause, resume (with optional instructions), and stop for main-chat and sub-agent browser tasks.
- Offline tests, local fixture E2E, shadow evaluation, and phased deployment.

### Out of scope for v1

- Moving authenticated Chrome sessions, cookies, or DOM handles to the server.
- Replacing Puppeteer, rewriting legacy scrapers, or reusing the legacy selector-generating scrape-assist protocol as this contract.
- Training/deploying a local desktop model, automatically downloading weights, or automatically provisioning GPU services. The app already downloads local models through `src/service/localAiRuntime/` (computer-use grounding, embeddings, voice); hosting a native decision model there is a deliberate later choice, not an oversight.
- Universal iframe, shadow-root, canvas, multi-tab, upload, or arbitrary widget support. Unsupported interactions use existing authorized paths or handoff.
- Exposing model-generated selectors, coordinates, scripts, shell commands, or arbitrary tools in the accelerated path.
- Automatically publishing, sending, deleting, or bypassing approvals because a model is confident.
- Changing subscription eligibility of embeddings, keywords, email generation, or other hosted-only services.
- Automated entry of passwords by the LLM, OTP/2FA codes, payment secrets, or CAPTCHA solving. Passwords are entered only by the privileged sign-in service (§6.7).
- Automatic registration with stored account data without explicit user confirmation; third-party SSO (“Sign in with Google”) automation.
- Rotating proxies to evade bans or CAPTCHAs; SOCKS proxies.
- Automatically resuming paused or interrupted tasks after an app restart.

## 5. Confirmed design decisions

| ID | Decision |
| --- | --- |
| D-01 | Desktop owns the browser and execution authority; inference returns proposals only. |
| D-02 | The runner executes multiple browser steps inside one outer chat tool invocation. Intermediate observations are not appended to main chat history by default; the final result carries a compact final observation so follow-up turns have context. |
| D-03 | Browser decisions, text helpers, recovery, and verification follow the user's selected provider boundary. No automatic custom-to-hosted fallback. |
| D-04 | Support hosted, user-native, and user-chat decision adapters behind one desktop interface. |
| D-05 | Default custom decisions use the configured chat provider/model; optionally select another real model on that provider. |
| D-06 | A native endpoint is explicitly configured/tested. OpenAI compatibility alone does not imply `/systemone` support. |
| D-07 | Token checks happen where the final provider request is constructed: AI server for hosted calls, desktop for direct custom calls. |
| D-08 | Capability discovery is advisory; every request is validated. Routing uses evaluated quality, language, options, budgets, health, cost, and latency. |
| D-09 | Stale state, approval, handoff, uncertain inference, and unsupported inputs have distinct outcomes. They do not all trigger LLM recovery. |
| D-10 | `DONE` requires independent verification. Unknown mutation effects are inspected and never blindly replayed. |
| D-11 | The provider-aware browser gate ships as its own phase and applies to every browser tool, independent of the acceleration kill switch. Disabling acceleration must never strand custom-provider users. |
| D-12 | Approvals bind to a semantic action fingerprint and observation identity, not to random reference tokens, and the runner waits for approval inside its job. |
| D-13 | The LLM may see usernames. Passwords never reach any LLM, tool result, chat message, transcript, log, or crash report. |
| D-14 | Sign-in is a privileged main-process service triggered by a credential-free tool. LLM-driven password entry stays blocked by the risk classifier and executor. |
| D-15 | Credentials and cookies are released only to the registrable domains of the site record; the site identity comes from the live page URL, never from the LLM. |
| D-16 | A database-backed site registry replaces the hardcoded lists, seeded with the existing platform IDs. The LLM may add a site for its own domain; adding domains to a site, or changing domains of a site with credentials, needs user confirmation. |
| D-17 | Proxy failures stay fail-closed. Switching proxy restarts the session in a controlled way; an account keeps a consistent proxy unless the user confirms a change. |
| D-18 | Parallel browser work uses a dedicated fan-out tool with bounded concurrency rather than making the chat loop run all tool calls concurrently. |
| D-19 | Each session has an owner (root conversation and agent task). Only the owner may drive it. Sub-agent notices, cards, and dialogs appear in the parent conversation, labelled by task. |
| D-20 | Takeover and pause set two states at once: the browser moves to user control (AI commands rejected) and the agent loop stops at a safe point. Only the user can end a takeover; no model can resume itself. |
| D-21 | Time spent waiting for the user never counts against agent, task, or parent-poll runtime budgets; it has its own limits. |

## 6. Functional requirements

### 6.1 Admission and provider ownership

- **D-FR-01:** Check provider-aware AI availability before request parsing, network calls, session creation, or work admission. Hosted requires `USER_AI_ENABLED`; custom requires enabled/valid user configuration (`USER_LOCAL_AI_ENABLED`, `USER_AI_PROVIDER_MODE`). Retain managed-browser release/settings gates and account/platform policies. This gate applies to all browser tools (existing and new) and ships before the runner (D-11).
- **D-FR-02:** Resolve and freeze a provider/configuration revision for a task segment. Cancel pending inference if provider settings change; discard late results and require fresh admission before resuming through a new provider.
- **D-FR-03:** Keep user API keys in main-process secret storage. Never send them to the renderer, browser worker, AI server, or an unrelated provider.
- **D-FR-04:** Host-specific aliases such as `small` must be resolved locally to a configured real model before custom requests. Native protocols must not receive chat aliases.

### 6.2 Task lifecycle

- **D-FR-05:** Accept a goal, explicit constraints, and completion criteria. Establish a bounded plan and known value bindings once, using the selected chat provider when planning is needed. A planning failure is a distinct terminal or recovery outcome.
- **D-FR-06:** Run observe → prepare candidates → decide → validate → execute → observe without reentering the main chat loop after each step.
- **D-FR-07:** Stream concise progress through existing job/event mechanisms. Keep a task associated with its conversation, tool call, browser session, provider revision, and cancellation owner.
- **D-FR-08:** Preserve session ownership and limits. Serialize mutation commands and prevent the old browser tools, the runner, and other agents from controlling the same session concurrently.
- **D-FR-09:** Stop on cancellation, deadline, step/model-call budget exhaustion, challenge, denied permission, unsupported interaction, or unresolved execution effect. Preserve useful partial results and a truthful terminal reason.
- **D-FR-10:** After restart/crash, do not automatically resume mutations. Saved task metadata can explain interruption; resuming requires a live session and fresh observation/admission.
- **D-FR-10a:** Approval and handoff waits happen inside the runner's job: the job stays alive, the active-time clock stops, and the user's decision resumes the pending step. The generic tool confirmation for `browser_execute_task` is requested once per task; consequential-action approvals inside the task remain separate and per action.
- **D-FR-10b:** The final tool result includes a compact final observation (URL, title, key visible state, and extracted output) so the outer LLM can handle follow-ups such as “open the second result”.
- **D-FR-10c:** Update the browser tool-routing guidance (`BuiltInToolCapabilitiesPromptSection.ts`) so the model knows when to call `browser_execute_task`, `browser_sign_in`, `browser_set_proxy`, and `run_browser_tasks` instead of `browser_observe`/`browser_run_actions`/`browser_request_handoff`.

### 6.3 Observations and candidates

- **D-FR-11:** Return a fresh sanitized observation after an action program where possible. Detect challenges before presenting a ready next-step state; update the main-process observation/revision cache before subsequent risk classification.
- **D-FR-12:** Expose observed IDs, roles, names, allowed operations, relevant control state, and bounded native options. Exclude secret values and retain the untrusted-page-content boundary. Fields filled by the sign-in service report `[credential]` as their value summary.
- **D-FR-13:** Prefer focused controls, active dialogs, visible suggestions, and task-relevant regions. Maintain coverage through bounded scrolling/reobservation. Do not assume the first controls in document order contain the target.
- **D-FR-14:** For small-budget models, shortlist candidates without silently dropping critical goal/constraint information. Include an escalation route when no offered candidate fits. Measure shortlist recall independently.
- **D-FR-15:** Handle disabled, detached, occluded, changed, sensitive, and unsupported controls explicitly. Revalidate live targets immediately before input.
- **D-FR-15a:** Element references must stay resolvable for the lifetime of the observation that produced them, including pending decisions, approvals, and handoffs. The registry is scoped per observation and its expiry is aware of pending work; a new observation must not evict a pending one's references.

### 6.4 Decisions and field values

- **D-FR-16:** V1 operations are `CLICK`, `FILL`, `SELECT`, `PRESS_KEY` (bounded set: Enter, Escape, Tab, arrows), `NAVIGATE` (same-site URL from an observed link or plan), `GO_BACK`, `HOVER`, `SCROLL_UP`, `SCROLL_DOWN`, `WAIT`, `EXTRACT` (into a declared schema), `DONE`, and `ESCALATE`. Offer only operations supported by the observed page/executor. The executor already supports these actions; the server contract's operation enum must be widened in the same version. If a server cannot accept an operation, task families needing it (search submitted by Enter, URL pagination, menus, extraction) are ineligible for acceleration and use the existing tools.
- **D-FR-17:** Native adapters may ask operation and operation-specific target questions in one request. Consume only the selected operation's target. `SELECT` chooses an observed option ID, not generated text.
- **D-FR-18:** Chat adapters send compact task state and a constrained output request, preferring verified JSON Schema support, then tool calling, then JSON with strict validation. Unsupported formatting features must not cause unlimited repair calls.
- **D-FR-19:** Never treat a chat model's self-reported confidence as calibrated native uncertainty. Report unknown uncertainty honestly and rely on schema/candidate checks, evaluated policy, and recovery. The chat prompt must explicitly allow and encourage `ESCALATE` when no candidate clearly fits.
- **D-FR-20:** Resolve a selected field to an existing plan binding only when the mapping is unambiguous. Otherwise use a bounded field-text helper. Validate text length/type and reject secret/credential entry through this path; credential entry goes only through the sign-in service (§6.7).
- **D-FR-21:** Reuse a helper result after a stale read only when its complete helper input is identical and no corresponding mutation could have executed. Arbitrary cached field text must not survive a changed goal, field, context, or provider revision.

### 6.5 Usability checks and recovery

| Condition | Required behavior |
| --- | --- |
| Structurally valid, supported, sufficiently reliable decision | Revalidate page/target and pass through local risk/permission checks |
| Stale observation / detached target before execution | Observe again; spend a new decision within remaining budgets |
| Missing candidates / relevant state omitted | Gather bounded additional observation; escalate if coverage remains inadequate |
| Selected model cannot fit the request | Route only within allowed provider policy, or return input-budget failure |
| Uncertain operation or selected target | Bounded alternative decision model if allowed, then LLM recovery |
| Chat decision with no calibrated uncertainty | Explicit `ESCALATE`, a cheap progress check every N steps, and no-progress detection |
| Approval required | Wait inside the job, bound to the semantic action fingerprint and observation; never ask an LLM to approve |
| Approval denied | Stop the proposed operation; terminal or bounded recovery that cannot retry the same action |
| Login wall | Saved-account sign-in service (§6.7); handoff on failure |
| Credential field, 2FA, CAPTCHA, security challenge | User handoff (§6.12) |
| Handoff timeout | Session stops (existing expiry); task ends `interrupted` with partial results |
| Execution effect unknown | Reconcile observed outcome; never automatically retry the mutation |
| Repetition or no progress | LLM recovery with specific evidence; stop if recovery is exhausted |
| Recovery needs user input | Ask through the parent conversation and wait inside the job, or end with `needs_user` |
| `DONE` | Fresh independent check of completion criteria |

- **D-FR-22:** LLM recovery receives the current subgoal, trusted constraints, fresh relevant observation, ambiguous candidates, and recent action outcomes. It may select an observed target, revise a bounded subgoal, request richer observation, or identify needed user input.
- **D-FR-23:** Recovery may not recursively create unbounded browser agents, reset task budgets, invent selectors/code, or override execution policy. The loop returns to the fast path after recovery.
- **D-FR-24:** Verification uses deterministic URL/control/result predicates where possible. An optional selected-provider LLM verifier is separately budgeted and cannot use the decision's `DONE` assertion as proof.
- **D-FR-25:** Define “equivalent failure” as the same operation on the same semantic target (role, name, context) with the same error class, and “progress” as a change in URL, a completion-criterion predicate, a target control's value/state, or result content. Three equivalent failures in a row trigger recovery.

### 6.6 Execution effect and approval correctness

- **D-FR-26:** The executor must classify a failure that can occur after input dispatch (click/press timeout after dispatch, partial typing, detach during input, worker crash, cancellation mid-step) as `effectUnknown: true`, and must stop the program at the first unknown effect. Only failures proven to occur before dispatch may be reported as known-no-effect.
- **D-FR-27:** Approval binds to a semantic fingerprint: operation, target role/name/context descriptor, a digest of the value, the observation ID, and the page revision. Reobservation that yields the same semantic action must match the existing approval; a changed action requests a new approval. Approvals stay single-use and cannot be bypassed by full-access chat or model confidence.

### 6.7 Saved-account sign-in and credentials

- **A-FR-01:** Add a credential-free tool, `browser_sign_in(session_id, intent: "login" | "register", account_id?, username_hint?)`. It never accepts a password, field reference, or selector. The LLM calls it at a login wall; the worker also suggests it when `LOGIN_REQUIRED` or the `sensitive_field_visible` notice fires.
- **A-FR-02:** The main process derives the site from the live top-frame URL reported by the worker, normalized to its registrable domain (eTLD+1), and requires HTTPS. It never uses an LLM-claimed site identity.
- **A-FR-03:** Match `SocialAccount` records by site (§6.9).
  - **No match:** post a credential card in the parent conversation and wait inside the job.
  - **One match:** try the account's encrypted cookie snapshot first; if the page still shows a login form, sign in with the stored credential.
  - **Several matches:** the LLM may choose by `account_id`; if it does not, show an account-picker card to the user.
- **A-FR-04:** The LLM may see the username: `list_social_accounts` may return `user`, the tool result may include it, and the LLM may fill a username field with a normal `fill` action. The password is never visible. Settings and card copy must state that usernames (often email addresses) are sent to the active LLM provider.
- **A-FR-05:** The credential card shows the site domain (from the main process), a username field (optionally pre-filled with the LLM's `username_hint`), a password field, “Save for future use”, and “I'll sign in myself” (opens the handoff dialog). If a saved account has a username but no password, the card asks for the password only.
- **A-FR-06:** Credentials submitted in the card travel over a renderer-only, Zod-validated IPC channel modeled on `SKILL_INSTALL_SUBMIT_SECRET`. They go straight to encrypted account storage or a one-time in-memory store, never into chat messages, tool results, transcripts, or logs.
- **A-FR-07:** Decrypt a password only through a dedicated method that returns it only when the stored site domain matches the current page's registrable domain. Existing list/get methods must not be used by the sign-in path.
- **A-FR-08:** Form filling is deterministic and runs in the worker through a dedicated message; values are wiped from worker memory after use and never included in results (§6.8).
- **A-FR-09:** Success: the adapter's `assessAuthentication` reports authenticated, or (generic sites) the password field is gone and the URL left the login path. Failure: still on the login page, visible error text, or a 2FA/OTP/CAPTCHA/passkey challenge. Failure opens the handoff dialog with a clear reason (“Saved password was rejected”, “Verification code required”).
- **A-FR-10:** At most one automated attempt per account and site per cooldown window (proposed 15 minutes). Never retry a password the site rejected. Record `last_login_failure_at`/reason instead of silently disabling the account.
- **A-FR-11:** After success, save refreshed cookies to the account (existing `handleRefreshedCookies` path) and bind the account to the session.
- **A-FR-12:** Registration (`intent: "register"`) requires explicit user confirmation through the approval path and a card with “Create account” wording, and normally hands off for verification steps. Never auto-register with an existing account's data without confirmation. Store the resulting account through the same encrypted path.
- **A-FR-13:** Credential login works on any session for a registered site, not only the YouTube pilot. YouTube keeps its dedicated adapter; other sites use a generic sign-in adapter.
- **A-FR-14:** The decision runner never types credentials; it calls the sign-in service as a step.
- **A-FR-15:** A sentinel-password test must prove the password never appears in tool results, observations, notices, transcripts, logs, or worker messages other than the fill request itself.

### 6.8 Password-field safety

- **A-FR-16:** Immediately before typing, the worker must verify in the live page: the element is an `HTMLInputElement` with `type === "password"`; it is enabled, not read-only, visible, and hit-testable; its frame is the top frame or a same-site frame on the site's allowed domains; the page is HTTPS; and in login mode exactly one visible password input exists in the form. Any failure aborts and hands off. A “show password” toggle that changes the type to `text` causes a refusal.
- **A-FR-17:** The username may go only into an `email`, `text`, or `tel` input in the same form as the password field.
- **A-FR-18:** Submit through the password field's own form (`requestSubmit()`) or Enter in that field; never click a button that is not in the same form.
- **A-FR-19:** Set values with the native value setter and `input`/`change` events first; fall back to keystrokes only when needed, with focus checks before and after. Read back only the value length. Snapshot other inputs' value lengths before and after; any unexpected change clears all fields, stops, and hands off.
- **A-FR-20:** Field detection order: saved login recipe for the site → deterministic detection (`autocomplete="username"`/`"current-password"`; `"new-password"` means registration) → if ambiguous, the LLM chooses among offered references (still validated by A-FR-16/17) → after success, save the recipe (field name/ID/autocomplete, form action, one- or two-step) to the site record. If the recipe stops matching, fall back to detection.
- **A-FR-21:** Two-step logins (username page, then password page) are handled in a bounded loop.

### 6.9 Site registry

- **S-FR-01:** Add a database-backed site registry (`BrowserSite`): ID, name, homepage URL, registrable domain, allowed domain suffixes, required domain suffixes, login URL, verification URL, login recipe, source (`builtin`/`ai`/`user`), status (`unverified`/`verified`), and the conversation that created it.
- **S-FR-02:** Seed it from `SocialPlatformList` and `PLATFORM_SESSION_MANIFEST` with the same IDs, because `social_accounts.social_type_id` already references them. AI- and user-created IDs start in a high range (proposed 100000+) so they cannot collide with remote `/api/socialplatform/list` IDs.
- **S-FR-03:** Add `browser_site_upsert(name, url)`. The main process derives the registrable domain with a public-suffix library, rejects public suffixes, IP-address and HTTP-only URLs, and dedupes by registrable domain.
- **S-FR-04:** Creating a site restricted to its own registrable domain may happen automatically. Adding domains (for example SSO domains such as `accounts.google.com`), or changing domains on a site that has saved credentials or cookies, requires user confirmation in a card showing the domains. Only domains the session actually visited during the login redirect may be proposed.
- **S-FR-05:** Replace the pilot gate: any site with a verified recipe or the generic sign-in adapter is eligible for account sessions. YouTube keeps its special adapter.
- **S-FR-06:** Switch the account detail page (`socialaccountdetail.vue`), the platform filter in `list_social_accounts`, the platform lookup in `socialAccountModule` and the social account controller, and `PlatformSessionManifest` callers to the registry (renderer through IPC).

### 6.10 Proxy support

- **P-FR-01:** `browser_start_session` accepts an optional `proxy_id`, or `"auto"` with an optional `country_code`. Account sessions default to the account's linked proxy as today.
- **P-FR-02:** Add `browser_set_proxy(session_id, proxy_id | "direct")`. Switching is a controlled restart: wait for in-flight actions, persist cookies, relaunch with the new proxy, reopen the last URL with a plain GET, and return a fresh observation and revision. Account-free sessions may later use a per-proxy browser context instead of a relaunch.
- **P-FR-03:** Keep each account on a consistent proxy: after an account signs in through a proxy, link and reuse it. Moving an account to a proxy in a different country, or to `direct`, needs user confirmation.
- **P-FR-04:** Health-check the target proxy (existing `proxy_check`, basic mode) before switching. Return structured reasons (`proxy_connect_failed`, `proxy_auth_failed` for HTTP 407, `tunnel_failed`) and stay fail-closed so the LLM can choose another proxy. Never fall back to direct.
- **P-FR-05:** Cap switches per task (proposed 3). Switching is allowed for reachability and geo-blocks; rotating proxies to get past a CAPTCHA or ban is not automatic, and challenges still hand off to the user.
- **P-FR-06:** Make the browser consistent with the proxy: set `locale` and `timezoneId` from `country_code`, and prevent WebRTC from leaking the real IP over UDP (verified against the bundled Chromium).
- **P-FR-07:** `proxy_list` returns `country_code`, the last check result, and a `browser_usable` flag (HTTP/HTTPS only). Passwords stay hidden.
- **P-FR-08:** Encrypt `proxy.pass` at rest with `FieldCipher`, migrating existing rows.
- **P-FR-09:** The session card shows the active proxy (host label and country) and a badge when traffic goes direct.

### 6.11 Parallel browser sub-agents

- **M-FR-01:** Add an `agent-browser-operator` agent definition. Allowed tools: `browser_start_session`, `browser_observe`, `browser_navigate`, `browser_run_actions`, `browser_get_status`, `browser_request_handoff`, `browser_stop_session`, `browser_sign_in`, `browser_set_proxy`, `browser_execute_task` when available, plus `check_tool_job_status`/`cancel_tool_job`. Excluded: `browser_evaluate_script`, `browser_clear_cache`, and `browser_resume_after_handoff`. Proposed limits: 40 tool calls, 10 minutes of active time.
- **M-FR-02:** The sub-agent returns a strict result: `status`, `summary`, bounded `extracted`, `final_url`, `evidence`, `needs_user` (approval, login, or input), `user_interventions`, and `session_id` only when `keep_open` was requested. Large results use the existing externalized tool-result access (`ToolResultModule.grantAccess`), not inline text.
- **M-FR-03:** Add `run_browser_tasks({ tasks: [{ goal, start_url?, account_id?, proxy_id?, keep_open? }], concurrency })`, at most 5 tasks and concurrency 1–3. It runs as one async job with per-task progress, and the parent receives all results together.
- **M-FR-04:** One confirmation before the batch shows the tasks and sites. It grants routine automation (observe, navigate, click, fill, select) scoped to that batch's agent tasks and expires with the batch.
- **M-FR-05:** In v1, sub-agents do not perform consequential actions (submit, send, publish, delete, upload). They return `needs_user: { type: "approval", proposed_action }`; the parent asks the user and runs it or starts a follow-up task. In-job approval waiting for sub-agents follows the §6.12 mechanism in a later phase.
- **M-FR-06:** The global session limit becomes a setting (proposed default 3, hard maximum 5) with a free-memory check before each start (each session is roughly 300–800 MB). Account-free sessions get leases keyed by session ID and their own temporary profile directory. One session per account remains; a second task for the same account is queued, not failed. A per-site cap (proposed 2 sessions per registrable domain) limits rate-limit and CAPTCHA risk.
- **M-FR-07:** Every session records its owner `{ rootConversationId, agentTaskId }`. Browser tools reject calls from non-owners. The parent may read child sessions and may take over a `keep_open` session after the child finishes.
- **M-FR-08:** Sub-agent session cards, notices, credential cards, approval prompts, and handoff dialogs appear in the parent conversation, labelled per task (for example “Browser task 2/3: supplier prices”).
- **M-FR-09:** One parent abort signal with a child per task: Stop cancels every task, stops their sessions, and releases leases. One task's crash or worker exit fails only that task; the batch returns partial results. App quit and conversation deletion use the same cleanup.
- **M-FR-10:** Per-provider concurrency limits with backoff for HTTP 429, and a total token/cost budget per batch.
- **M-FR-11:** Sub-agents return extracted data; the parent dedupes before saving. Sub-agents do not write to shared tables directly.
- **M-FR-12:** A separately selectable sub-agent model (a real model at the same provider endpoint for custom providers). The batch tool's executor is pluggable: `llm_agent` first, `fast_runner` (the `browser_execute_task` runner) once available.
- **M-FR-13:** Prevent background throttling of occluded browser windows where it stalls tasks (Chromium flags), verified against the fingerprint self-test; tile or offset windows so the user can watch them.

### 6.12 User takeover, pause, resume, and stop

- **C-FR-01:** Two separate states: browser control (`ai_control` / `user_control`, represented by the existing `handoff`/`user_login_in_progress` session states) owned by `ManagedBrowserModule`, and agent task state (`running`, `waiting_for_user`, `paused`, `cancelling`, `completed`, `failed`, `cancelled`, `interrupted`) owned by a new main-process task-control service. Every takeover sets both.
- **C-FR-02 (agent-requested handoff):** Inside a sub-agent or runner, `browser_request_handoff` and detected challenges (login failure, CAPTCHA, 2FA) block in the tool call instead of returning an error. The task enters `waiting_for_user`, the existing handoff dialog appears in the parent conversation with the task label and reason, and the tool returns `resolved`, `expired`, or `cancelled` when the user acts or the window lapses. After `resolved`, the agent must observe before acting.
- **C-FR-03:** Only the user's dialog action ends a handoff. Sub-agents never receive `browser_resume_after_handoff`.
- **C-FR-04 (user-initiated):** Each task card has Pause, Take control, Resume, Resume with instructions, and Stop. These actions travel over renderer-only, Zod-validated IPC; no model can call them.
- **C-FR-05:** Pause and Take control close a per-task control gate checked at safe points: before each model call, before each tool call, and between actions of a running program. A running program stops between actions with reason `user_paused`, keeping results of actions already executed. The session moves to user control so AI commands are rejected even if the agent misbehaves.
- **C-FR-06:** A model response that is already in flight when the user pauses is allowed to finish, but its tool calls are held and discarded on resume. Stop aborts immediately.
- **C-FR-07:** On resume: advance the page revision (invalidating old references), resume the session, add a note to the agent transcript (“The user controlled the browser from T1 to T2; the page may have changed; observe before acting; do not repeat earlier actions blindly”), recheck the page against the session's allowed sites, and for account sessions confirm the same account is still signed in. “Resume with instructions” adds the user's text to the agent transcript like a steering message.
- **C-FR-08:** An action whose result arrives after the pause is recorded against the paused state and never retried; unknown effects follow D-FR-26.
- **C-FR-09:** Active-time accounting stops while `waiting_for_user` or `paused`. User waiting has its own limits: the existing handoff window (10 minutes default, extendable to 60) and a proposed 60-minute pause cap. The parent's async poll must not time out while a child is waiting for the user, and the account lease is kept.
- **C-FR-10:** Other tasks continue while one waits. Handoff dialogs are queued and shown one at a time with a “N tasks need you” badge. The app never steals window focus automatically; an “Open browser” button brings that task's window to the front.
- **C-FR-11:** “Return results now” on a batch finishes unfinished tasks as partial so the parent is not blocked indefinitely.
- **C-FR-12:** Each task result reports `user_interventions: [{ reason, started_at, duration_ms }]` so the parent knows a human was involved.
- **C-FR-13:** Manual sign-in during takeover saves cookies through the existing refresh path; the password stays with the user.
- **C-FR-14:** Paused or waiting tasks are not resumed after an app restart; they are marked `interrupted` with partial results, consistent with D-FR-10.
- **C-FR-15:** The app cannot reliably tell user clicks from automation input, because Puppeteer input is also marked trusted. Rely on the explicit Pause button, show “AI is controlling this window” in the window title (not injected into the page), and treat repeated unexpected page changes as a reason to pause automatically.
- **C-FR-16:** The same mechanism applies to main-chat runner tasks (`browser_execute_task`), so takeover behaves the same everywhere.

## 7. Settings and user experience

Extend the existing AI Provider settings with a simple browser-decision section:

- “Use my chat provider” is the default for custom-provider mode.
- Optional browser decision model override; show that it must exist at that provider.
- An advanced native decision profile allows endpoint, optional separate credential, model/checkpoint, protocol, and explicit limits. It is inert until selected.
- Connection tests report chat/structured-output/native capabilities separately. A passing `/models` or chat test does not certify native decisions or browser accuracy.
- Use “Fast browser decisions” as user-facing wording; expose model/protocol details only where users configure or diagnose them.
- Show progress, pause/approval/handoff, partial result, cancellation, and clear terminal errors. Do not expose raw probabilities or internal prompts in ordinary task flow.
- A provider configuration change must clearly interrupt/rebind an active task rather than silently redirecting page data.
- State what page data leaves the device in each mode (§12), including that usernames go to the active LLM provider.

Browser-use additions:

- **Credential card** (A-FR-05) and **account-picker card** in chat; the domain shown always comes from the main process.
- **Site confirmation card** for adding or changing credential domains (S-FR-04).
- **Proxy** choices in session start and a proxy/direct badge on the session card (P-FR-09); confirmation for account proxy changes.
- **Parallel tasks:** batch confirmation, per-task cards with states Running, Waiting for you (reason and countdown), Paused by you, Resuming, Stopped, Completed, Failed; queued-handoff badge; Open browser; Return results now.
- **Session settings:** maximum concurrent browsers (default 3, maximum 5), and an optional sub-agent model.
- **Per-account control:** whether a saved account may be used by AI automatically (see open question Q-01).

All added UI text needs English, Chinese, Spanish, French, German, and Japanese translations. All changed UI requires component tests in the same implementation change; critical flows also need Playwright coverage.

## 8. Proposed budgets and performance objectives

Runtime and step budgets are route-specific; a slower custom route must not be forced into the hosted route's limits.

| Budget | Hosted decision route (default / hard) | Custom chat or native route (default / hard) | Notes |
| --- | --- | --- | --- |
| Active task runtime | 120 s / 240 s | 300 s / 600 s | User approval/handoff/pause waiting is excluded and has its own limits |
| Executed leaf steps | 30 / 100 | 30 / 100 | Includes recovery-directed browser actions |
| Decision requests | 45 / 120 | 45 / 120 | Includes stale retries and alternatives at the logical request level |
| Per-request timeout | 3 s / 10 s | 10 s / 30 s | Capped by remaining task time |
| Per-leaf-step worker timeout | 15 s / 30 s | 15 s / 30 s | Separate from the 240 s action-program wall time |
| LLM recovery calls | 2 / 3 | 2 / 3 | Planning, field helpers, and verification are separately counted |
| Field helper calls | 4 / 10 | 4 / 10 | Reuse trusted plan bindings before invoking a helper |
| Planner / optional LLM verifier | 1 each | 1 each | Additional planning requires recovery budget |
| Upstream attempts per decision request | 2 total | 2 total | No nested retry multiplication |
| Consecutive equivalent failures | 3 | 3 | As defined in D-FR-25 |
| Progress check interval (chat route) | — | every 5 steps | Cheap deterministic check |

Browser-use budgets:

| Budget | Proposed default / hard ceiling |
| --- | --- |
| Concurrent browser sessions | 3 / 5, subject to a free-memory check |
| Sessions per registrable domain | 2 |
| Tasks per `run_browser_tasks` batch | 5 |
| Batch concurrency | 3 |
| Browser sub-agent tool calls / active time | 40 / 10 minutes |
| Automated sign-in attempts | 1 per account and site per 15-minute cooldown |
| Proxy switches per task | 3 |
| Handoff window | 10 minutes, extendable to 60 (existing) |
| User pause | 60 minutes, then the task ends `interrupted` |

Proposed pilot objectives: reduce median task time by at least 50% and expensive generative-model calls by at least 70% on eligible multi-step tasks, relative to the measured baseline, without a material task-success regression. The baseline already batches up to 25 actions per program, so achievable savings depend on how well the current model batches each task family; report savings per family. These are go/no-go targets to validate, not expected universal improvements. Before qualification, predeclare the acceptable success-rate margin (proposed maximum regression 5 percentage points) and confidence method. A 50–100-task pilot is exploratory; if confidence intervals do not resolve that margin, collect more evidence before promotion. Any execution-policy bypass blocks release regardless of average task success. Record p95 latency and cost per verified successful task, calculated as all-attempt cost divided by verified successes, including the cost of failed tasks.

Sub-agents save parent context, not necessarily total tokens: each sub-agent pays for its own prompt, tool definitions, and observations. Report total tokens and cost per batch next to parent-context size; real savings come from the smaller sub-agent tool set, a cheaper sub-agent model, bounded output, and the fast runner executor.

## 9. Evaluation and acceptance

Run paired evaluations with identical goals, initial states, task budgets, and independent outcome checks:

1. Current application.
2. Existing model plus improved action/observation flow.
3. Hybrid runner with Jev.
4. Hybrid runner with hosted Laya.
5. Hybrid runner with representative custom chat providers/models.

Start with 50–100 held-out tasks spanning search, forms, filters, pagination, navigation, and extraction. Include all six supported UI languages and mixed-language pages, slow pages, large candidate sets, ambiguous labels, overlays, stale nodes, challenges, provider failures, and cancellation. Split by website/template and task family; avoid tuning on the held-out set. Use repeated runs and report sample sizes/uncertainty. A single-step accuracy number is insufficient because errors compound across a task. Confirm Laya's language coverage against the six-language requirement before including it in multilingual arms.

| Acceptance ID | Evidence |
| --- | --- |
| D-AC-01 | Hosted/custom requests and recovery reach only the selected provider boundary |
| D-AC-02 | Unsubscribed custom-provider user can run eligible browser tasks and all browser tools; hosted-only APIs remain gated |
| D-AC-03 | Post-action observation updates both worker result and main cached descriptors/revision |
| D-AC-04 | No decision can execute a target outside its bound observation or invent an option |
| D-AC-05 | Consequential actions retain exact approval, including custom mode and full-access chat; reobservation does not cause an approval loop |
| D-AC-06 | Stale pre-action failures can reobserve; post-dispatch failures are classified unknown and never replay automatically |
| D-AC-07 | Stop cancels inference, helper/recovery, and worker execution; late responses cannot act |
| D-AC-08 | Native and chat adapters have honest uncertainty/usage attribution and model-specific budgets |
| D-AC-09 | Every successful task has fresh independent verification; partial failures are not shown as success |
| D-AC-10 | UI tests, E2E, six-language translations, and performance evaluation pass agreed release gates |
| D-AC-11 | Old servers/providers without decision metadata work through explicit supported paths without a hosted leak |
| D-AC-12 | Disabling acceleration leaves every existing browser tool usable for custom-provider users |
| A-AC-01 | A sentinel password never appears in any tool result, observation, notice, transcript, log, or worker message except the fill request |
| A-AC-02 | Saved-account sign-in succeeds on a local fake site; wrong password hands off with a reason and is not retried within the cooldown |
| A-AC-03 | A lookalike domain, HTTP page, or cross-origin frame never receives a stored credential |
| A-AC-04 | The password is never typed into a decoy search box, a text field, or a password field toggled to `type=text`; any unexpected change to another field aborts |
| A-AC-05 | No-account login shows the credential card; the submitted password reaches only encrypted storage |
| S-AC-01 | Seeded sites keep their existing IDs; AI-created site IDs do not collide with remote platform IDs |
| S-AC-02 | A prompt-injected request to add a domain to a credentialed site cannot succeed without user confirmation |
| P-AC-01 | Proxy selection and switching work; a failing proxy returns a structured reason and never falls back to direct |
| P-AC-02 | Proxy passwords are encrypted at rest and never returned to the LLM |
| M-AC-01 | Two to three browser tasks run concurrently on local fake sites; one crashing does not fail the others |
| M-AC-02 | A sub-agent cannot drive a session it does not own |
| M-AC-03 | Sub-agent cards and dialogs appear in the parent conversation with task labels |
| C-AC-01 | A sub-agent that hits a fake CAPTCHA waits while another task completes; after the user resolves it, the first task resumes and completes |
| C-AC-02 | Pause stops AI input at a safe point; resume invalidates old references and forces a fresh observation |
| C-AC-03 | A 45-minute handoff does not trip the parent's poll limit or the agent's runtime limit; a handoff expiry stops only its own task |
| C-AC-04 | No model can end a takeover; Stop cancels all tasks |

## 10. Delivery phases and rollback

0. **Provider-aware browser gate:** apply D-FR-01 to all existing browser tools, independent of acceleration.
1. **Baseline and correctness:** add timing/call-cost instrumentation, fix post-action observation, unknown-effect classification, per-observation reference scoping, and semantic approval binding. Preserve the old tool path for comparison.
2. **Sessions and ownership:** session-keyed leases for account-free sessions, configurable session limit with memory check, owner checks, notices routed to the parent conversation.
3. **Proxy:** selection at session start with reason codes, `browser_set_proxy`, proxy password encryption.
4. **Site registry:** `BrowserSite` seeded with existing IDs, UI switch-over, `browser_site_upsert` with domain guardrails.
5. **Sign-in:** credential card and secure IPC, worker password-field rules and read-back checks, generic sign-in adapter, recipe learning.
6. **Sub-agents and control:** active-time deadlines, `waiting_for_user` job state and poll-limit fix, blocking handoff for sub-agents, `agent-browser-operator`, `run_browser_tasks`, pause/take control/resume/stop, resume with instructions, return results now.
7. **Runner:** implement the desktop contract, command lease, state machine, mock decision client, verification, cancellation, and progress.
8. **Provider parity:** deliver hosted decision client and custom chat-decision client together; include settings.
9. **Native pilot:** add user-native profiles, Jev adapter compatibility, hosted Laya shadow evaluation, and versioned calibration.
10. **Controlled rollout:** enable selected eligible tasks, monitor successful-task cost and regressions, expand only after evidence; swap `run_browser_tasks` to the fast runner executor where qualified.
11. **Specialization:** if useful, fine-tune Laya with permitted, reviewed browser traces and recalibrate; this is a separate training project.

Provide global and per-engine feature switches, plus switches for sign-in, site upsert, proxy switching, and parallel sub-agents. Disabling acceleration returns future tasks to existing browser tools; active tasks cancel safely. Because phase 0 ships first, rollback never strands custom-provider users and never automatically redirects them to hosted AI. New settings are additive and old configuration remains readable.

## 11. Risks, dependencies, and evidence limits

- Laya's small default budgets, large option-set degradation, domain accuracy, language coverage, and calibration must be tested for browser tasks. Provider hosting does not remove those model constraints.
- Short input does not guarantee easy decisions. Candidate count, labels, language, and task ambiguity affect eligibility.
- Chat decisions have no calibrated uncertainty; a wrong but harmless action can look like progress until final verification. Mitigated by ESCALATE, periodic progress checks, and D-FR-25.
- The reference `jev-ultrafast` project uses hosted Jev, not redistributable Jev weights. Its measured browser protocol reduction is relevant inspiration, not an AiFetchly benchmark.
- Its 7.073-second Flights report includes 17 Jev requests and 90,558 Jev input tokens. The reported tiny text-helper charge excludes Jev/browser costs. Optimize total cost per verified task, not token count alone. These external numbers were not independently verified during the 1.1 review.
- Headed browser state, network, provider queues, and field generation can dominate latency even when decision inference is fast.
- Hosting gateway/proxy forwarding for new server endpoints must be verified before hosted launch; work in other repositories is an external dependency, not assigned here.
- **Account lockout and flags:** repeated automated logins, IP/country changes, and parallel sessions on one site can lock or flag accounts. Mitigated by the cooldown, consistent per-account proxy, per-site cap, and one session per account.
- **Phishing and prompt injection:** a page could try to redirect credentials or add domains. Mitigated by live-URL site identity, registrable-domain matching, HTTPS-only, and user confirmation for domain changes.
- **Resources:** each session is a worker plus a headed Chrome (roughly 300–800 MB). Mitigated by the configurable limit and memory check.
- **Provider rate limits:** parallel agents multiply concurrent requests; custom endpoints often return 429. Mitigated by per-provider concurrency limits and batch budgets.
- **Total token cost:** parallel sub-agents can cost as much or more in total than one agent; see §8.
- **Registration and terms of service:** automated account creation may violate site terms; v1 requires confirmation and usually hands off.

## 12. Privacy and data disclosure

| Data | Hosted mode | Custom-provider mode |
| --- | --- | --- |
| Goal, constraints, candidate names, bounded page text (up to 12,000 characters) | Sent to the AiFetchly AI server and its upstream model; request metadata/digests retained per server policy (30 days proposed by the server design) | Sent only to the user's configured endpoint |
| Usernames | Visible to the hosted LLM | Visible to the user's LLM |
| Passwords, OTPs, cookies, proxy passwords, API keys | Never leave the desktop except to the target site (passwords, cookies) or the proxy (proxy credentials) | Same |
| Screenshots | Only under the existing privileged/sensitive-state policy | Same, only to the selected provider |

The settings copy must state this table in plain language. How hosted decision calls count against a plan or quota, and what the user sees, must be specified with the server owners before hosted launch (commercial charging needs external sign-off per the server design).

## 13. Glossary

| Term | Meaning |
| --- | --- |
| Jev | A hosted fast decision model used by the reference `jev-ultrafast` project; available through the AiFetchly AI server in hosted mode |
| Laya | An open discriminative model family (see its model card) that chooses among offered options; can be hosted by AiFetchly or the user |
| `/systemone` | The native decision API protocol for Jev/Laya-style models: typed choice questions returning distributions, distinct from chat completions |
| TypeSafe | The provider documentation describing these models' limits, confidence, and fan-out patterns |
| Native decision | A discriminative model choosing among offered candidates with a probability distribution |
| Chat decision | A generative chat model producing a constrained JSON decision; no calibrated confidence |
| Handoff | The session state in which the user controls the browser and AI commands are rejected |
| Registrable domain (eTLD+1) | The domain one level below a public suffix, for example `example.co.uk` |
| Sub-agent | An in-process `AgentRuntime` loop with its own transcript and tool allowlist, started by the parent conversation |

## 14. Open questions

| ID | Question | Proposed default |
| --- | --- | --- |
| Q-01 | Should accounts saved before this feature be usable by AI immediately, or only after the user enables it per account? | Opt-in per account, with a one-time prompt listing existing accounts |
| Q-02 | Is registration in scope for v1? | Login only in v1; registration behind a separate switch with confirmation |
| Q-03 | Exact pause cap and handoff queue ordering | 60 minutes; first-come order |
| Q-04 | Default concurrent-browser limit on low-memory machines | Derived from free memory, never above the setting |
| Q-05 | Hosted billing/quota for decision calls | To be agreed with server owners |

## 15. Related documentation and sources

- [Existing managed browser PRD](puppeteer-managed-social-browser-prd.md) and [design](puppeteer-managed-social-browser-technical-design.md).
- [Custom provider PRD](local-ai-provider-chat-prd.md) and [design](local-ai-provider-chat-technical-design.md).
- [TypeSafe models and limits](https://docs.typesafe.ai/models), [confidence](https://docs.typesafe.ai/confidence), [speculative fan-out](https://docs.typesafe.ai/patterns/fan-out).
- [Laya model card and documented limitations](https://huggingface.co/convaiinnovations/laya).
- [Reference runtime and measurement boundaries](https://github.com/browser-use/jev-ultrafast/blob/main/docs/performance.md).

External model facts were reviewed on 2026-10-30 and not re-verified in 1.1. Capabilities and prices must be revalidated when implementing or changing providers; they are not hardcoded product promises.
