# Puppeteer-Managed Social Browser and LLM Automation - Product Requirements Document

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-09-01
- **Owner**: Engineering Team
- **Priority**: P0 foundation, followed by staged platform rollout
- **Related areas**: AI Chat V2, social accounts, account cookies, Puppeteer,
  child-process workers, tool permissions, browser automation, proxies
- **Related documents**:
  - [`social-account-secure-browser-profile-import-prd.md`](social-account-secure-browser-profile-import-prd.md)
  - [`social-account-secure-browser-profile-import-technical-design.md`](social-account-secure-browser-profile-import-technical-design.md)
  - [`../AI_SCRAPE_ASSIST_OBSERVE_EXECUTE_DESIGN.md`](../AI_SCRAPE_ASSIST_OBSERVE_EXECUTE_DESIGN.md)
  - [`../AI_PUPPETEER_RECOVERY_ARCHITECTURE.md`](../AI_PUPPETEER_RECOVERY_ARCHITECTURE.md)
  - [`ai-chat-workspace-ui-redesign-prd.md`](ai-chat-workspace-ui-redesign-prd.md)
  - [`../superpowers/specs/2026-06-25-ai-tool-timeout-resilience-prd.md`](../superpowers/specs/2026-06-25-ai-tool-timeout-resilience-prd.md)
- **Current related implementation**:
  - `src/modules/AccountSessionService.ts`
  - `src/modules/accountSession/cookieNormalize.ts`
  - `src/modules/PlatformSessionManifest.ts`
  - `src/controller/socialaccount-controller.ts`
  - `src/modules/browserManager.ts`
  - `src/childprocess/utils/ObserveExecuteExecutor.ts`
  - `src/childprocess/utils/PageStateCapture.ts`
  - `src/config/skillsRegistry.ts`
  - `src/service/StreamEventProcessor.ts`
  - `src/service/ToolJobRegistry.ts`
  - `src/service/ToolTimeoutPolicy.ts`

## 1. Summary

AiFetchly must provide a visible, Puppeteer-controlled Chrome browser optimized
for authorized social-platform automation. A user must be able to select one of
their saved Tool Accounts, reuse its authenticated cookie session, describe a
job in AI Chat, watch the managed browser perform the job, intervene when
needed, and stop the browser immediately.

Electron remains the application shell. The automation browser is a normal,
headed Chrome or Chromium process launched and controlled by Puppeteer from one
disposable Electron utility process per session. It is not an Electron
`BrowserWindow`, and the product
must not pretend that an externally launched Chrome window is literally
embedded in the Electron renderer. AiFetchly presents browser status, controls,
approvals, progress, screenshots, and task results inside the application while
the user observes or takes over the visible managed Chrome window.

The managed browser must reuse the existing encrypted account-cookie system.
The Electron main process decrypts and domain-filters the selected account's
cookie snapshot, transfers it directly to the browser worker through validated
process IPC, and never exposes cookie values to the renderer, LLM, logs,
analytics, or tool results. The worker applies those cookies before navigation
and returns a refreshed cookie snapshot to the main process after the session.
Only the main process persists the refreshed snapshot.

The browser must expose a small, typed LLM tool family for observation,
interaction, structured multi-step actions, screenshots, user handoff, and a
privileged page-context script tool. The script tool runs JavaScript inside the
web page only. It must not run arbitrary Node.js, Electron, shell, filesystem,
or unrestricted Puppeteer code supplied by the model.

The browser launch and page configuration must replace the current collection
of hard-coded and contradictory fingerprint overrides with a single verified
fingerprint policy. By default, Chrome reports its own executable-matched user
agent and browser properties. AiFetchly must not randomly claim a browser,
version, operating system, GPU, locale, or device profile that conflicts with
the real runtime.

This feature is for automation of accounts the user owns or is authorized to
operate. It must not bypass multi-factor authentication, login/security
challenges, platform safety controls, access restrictions, or account ownership
checks. Optional external CAPTCHA-provider use is limited to the explicitly
authorized, non-sensitive policy described in §8.7 and always retains manual
handoff as the fallback.

## 2. Product Decision

AiFetchly will use a **Puppeteer-managed headed Chrome browser** as the primary
runtime for LLM-driven social-platform automation.

The decision separates two concerns:

| Concern                               | Product choice                                                                                |
| ------------------------------------- | --------------------------------------------------------------------------------------------- |
| Application shell and AI conversation | Electron and Vue                                                                              |
| Visible social automation browser     | Headed Chrome/Chromium                                                                        |
| Browser controller                    | Puppeteer with reviewed stealth support                                                       |
| Account authentication source         | Existing encrypted account-cookie snapshot                                                    |
| Browser execution location            | One disposable utility process under `src/childprocess/` per session                          |
| Database access                       | Main process through existing Model/Module layers only                                        |
| Default LLM interaction               | Typed browser tools and structured actions                                                    |
| Advanced page logic                   | Privileged page-context JavaScript with approval                                              |
| Human challenges                      | Manual handoff by default; narrowly policy-gated provider only for eligible non-login CAPTCHA |

Electron `WebContentsView` remains appropriate for application UI and simple
content display, but it is not the selected runtime for authenticated social
automation. The primary reason is that a normal Chrome runtime gives Puppeteer
the complete automation surface and avoids the persistent Electron-specific
fingerprint that social platforms can observe.

## 3. Problem Statement

### 3.1 The LLM cannot control the browser users rely on

AiFetchly has AI tool execution, Puppeteer scrapers, social-account sessions,
and visible login windows, but these are not assembled into a general browser
runtime the LLM can operate. The model can call domain-specific scraping tools,
yet it cannot reliably perform a user-described sequence such as:

```text
Open my YouTube account, find videos with unanswered comments from the last
seven days, prepare replies in my tone, and let me approve them before posting.
```

The missing product surface is not a single `click` function. It is a managed
browser session with account selection, observation, actions, scripts,
approvals, cancellation, progress, handoff, and session persistence.

### 3.2 Existing authenticated sessions are not connected to a general browser worker

`AccountSessionService` already encrypts, normalizes, domain-filters, decrypts,
applies, captures, and persists account cookies. The existing Electron login
window reuses a stable persistent partition. Puppeteer workers also have several
one-off cookie application paths.

There is no single browser-session contract that:

1. leases a selected account to one automation session;
2. decrypts cookies only in the main process;
3. transfers a bounded snapshot to a browser worker;
4. applies the cookies before the first platform navigation;
5. captures refreshed cookies after navigation and login renewal;
6. returns them to the main process for encrypted persistence; and
7. prevents the renderer and LLM from observing the secret values.

### 3.3 Fingerprint configuration is inconsistent

Browser configuration is spread across `BrowserManager`, individual workers,
scraper managers, platform adapters, and local stealth helpers. Current code
includes incompatible behaviors:

- `BrowserManager` selects Chrome build `136.0.7103.94` while its random
  user-agent list claims Chrome 118, 119, or 120.
- Some workers correctly leave the user agent empty so Chrome reports its
  native version, while other workers overwrite it with a hard-coded value.
- Some workers spoof Windows properties even when running on another operating
  system.
- Some scripts force static GPU, plugin, language, hardware, or timing values
  that may contradict the real browser and machine.
- The launch configuration contains security-reducing flags such as
  `--no-sandbox`, `--disable-web-security`, and certificate-error bypasses.
- Multiple workers implement different stealth behavior, so fixes drift and
  cannot be verified once.

This inconsistency can make the browser easier to classify as automated and can
weaken the security of a browser carrying authenticated social sessions.

### 3.4 Arbitrary model-generated automation code is unsafe

Complex social jobs need loops, conditional extraction, and page-specific
logic. A fixed list of click and fill calls alone is insufficient. However,
executing arbitrary model-generated Node.js or Puppeteer code would allow access
to local files, environment variables, processes, unrestricted network
resources, and cookie material.

AiFetchly needs an advanced script capability that is expressive inside the
current page without turning the browser worker into a general remote-code
execution service.

### 3.5 Long-running browser work does not fit one synchronous tool call

Social automation can require browser startup, session verification,
navigation, user handoff, multiple pages, approval waits, retries, and final
cookie capture. This can exceed synchronous AI tool timeouts. The task must
continue locally without keeping one remote LLM stream open for the entire job.

## 4. Goals

1. Make a visible, headed Puppeteer-controlled Chrome browser the primary
   runtime for new LLM-driven social-platform automation.
2. Let the user select an existing Tool Account before starting an authenticated
   browser session.
3. Seed the managed browser from the selected account's existing encrypted,
   allowlisted cookie snapshot without exposing cookie values outside the main
   process and browser worker.
4. Capture refreshed platform cookies and persist them through
   `AccountSessionService` after the browser session.
5. Provide typed LLM tools for browser observation, navigation, interaction,
   structured action programs, screenshots, user handoff, and session closure.
6. Provide a privileged page-context script tool for complex DOM work while
   prohibiting model-generated Node.js, Electron, filesystem, shell, and raw
   worker-level Puppeteer code.
7. Replace hard-coded user-agent rotation with an executable-matched,
   internally consistent fingerprint policy.
8. Centralize browser launch, fingerprint configuration, proxy configuration,
   cookie application, cancellation, and cleanup so individual workers do not
   implement conflicting behavior.
9. Make every consequential browser action visible, attributable, cancellable,
   and subject to a risk-based approval policy.
10. Support user handoff for login expiry, CAPTCHA, MFA, consent, and ambiguous
    actions, then allow the LLM to resume from the resulting page state.
11. Keep all Puppeteer runtime and browser-specific code in
    `src/childprocess/` and all database access in the main-process
    Model/Module architecture.
12. Reuse the existing AI tool loop, permission system, async job registry,
    timeout policy, and progress event pipeline.
13. Establish automated fingerprint consistency tests that fail when the
    claimed browser identity contradicts the executable or configured account
    environment.
14. Ship platform-by-platform behind feature flags, beginning with one
    controlled pilot platform before broad social-platform enablement.
15. Provide a user system setting for the built-in managed browser, enabled by
    default, while retaining an application-controlled release flag for
    emergency rollout control.
16. Reuse an account-isolated persistent resource cache to improve repeat page
    load time without making a persistent Chrome profile the source of login
    state.
17. Let users inspect and clear one account's cache or all managed-browser
    caches without deleting encrypted account cookies.

## 5. Non-Goals

1. Do not embed a native Chrome window inside Electron through screenshot
   streaming, OS window reparenting, or unsupported Chromium embedding hacks.
2. Do not replace every existing domain-specific scraper in the first release.
3. Do not let the LLM read raw cookies, authorization headers, password fields,
   local-storage tokens, or browser-profile secrets.
4. Do not let model-generated code run as Node.js, import modules, access the
   filesystem, execute shell commands, spawn processes, or call Electron APIs.
5. Do not expose a raw Chrome DevTools Protocol endpoint to the renderer or
   local network.
6. Do not share an Electron partition directory with Chrome or point two
   running browsers at the same user-data directory.
7. Do not clone a user's external Chrome, Edge, or Brave profile.
8. Do not automate MFA entry, password-manager confirmation, passkeys,
   account recovery, or login/security challenges. CAPTCHA provider use is
   limited to explicitly authorized, non-login domains and challenge types;
   third-party social-platform challenges default to manual handoff.
9. Do not promise that stealth configuration makes automation undetectable.
10. Do not defeat platform rate limits, access controls, paid-content gates, or
    enforcement systems.
11. Do not silently publish, send, purchase, delete, upload, or change account
    security settings without the required user approval.
12. Do not persist full page HTML, screenshots, entered values, or script output
    indefinitely by default.
13. Do not store an unencrypted duplicate of account cookies in a managed Chrome
    profile during the first release.
14. Do not introduce a new browser-session database entity in the first release;
    operational sessions remain in memory and durable authentication continues
    through the existing account-cookie record.
15. Do not share HTTP cache entries between Tool Accounts, platforms, external
    Chrome profiles, or incompatible Chrome cache versions.
16. Do not make **Clear browser cache** delete cookies, local storage,
    IndexedDB, service workers, downloads, account records, or saved login
    sessions.

## 6. Target Users

### 6.1 Marketing operator

The operator manages approved company accounts on YouTube, Facebook, X, or
another supported platform. They want the assistant to perform repetitive
browser workflows while they retain visibility and final control over public or
irreversible actions.

### 6.2 Agency account manager

The manager works with several client accounts, often through different proxies
and sessions. They need strict account isolation so automation for one client
cannot read or modify another client's session.

### 6.3 Power user

The power user wants to describe complex browser jobs or approve a
page-context script when the standard browser actions cannot express the task.
They expect the generated script, target domain, time limit, and expected effect
to be visible before execution.

### 6.4 Support and engineering maintainer

The maintainer needs deterministic diagnostics for browser startup, executable
version, fingerprint consistency, cookies applied, session verification,
worker lifecycle, and action failure without exposing authentication secrets.

## 7. Core User Stories

1. As a user, I can select a Tool Account and start a visible managed browser
   already authenticated with that account when its stored session is valid.
2. As a user, I can see which Tool Account, platform, proxy, and conversation
   currently own the browser session.
3. As a user, I can ask AI Chat to perform a multi-step browser task and watch
   progress in both the application and the visible browser.
4. As a user, I can approve or reject consequential actions before they occur.
5. As a user, I can inspect a generated page script before allowing it to run.
6. As a user, I can pause automation, take over the browser, complete a login,
   CAPTCHA, or MFA challenge, and return control to the assistant.
7. As a user, I can stop a browser job immediately and expect Chrome and its
   worker to terminate cleanly.
8. As a user, my refreshed login session remains available for later authorized
   tasks without another manual cookie export.
9. As a user, a failure in one account browser does not affect another account
   or the main AiFetchly application.
10. As a maintainer, I can compare the real Chrome version with the reported
    user agent and fail startup when a configured override is inconsistent.
11. As a maintainer, I can enable the managed browser for one platform without
    enabling it globally.
12. As a maintainer, I can add browser actions without adding database access to
    a worker or IPC handler.
13. As a user, when saved cookies are missing or invalid, I receive a notice in
    AI Chat, complete login in the same visible browser, and receive a second
    notice when verification succeeds or fails.
14. As a user who configured a CAPTCHA provider and explicitly authorized its
    use for an eligible domain, I can let AiFetchly attempt that provider for a
    non-login challenge; otherwise the task safely requests manual handoff.
15. As a user, I can disable the built-in browser in System Settings; the LLM
    then explains that it is disabled and does not start a worker or decrypt
    cookies.
16. As a user, repeat visits load faster from my account's isolated managed
    browser cache, which is enabled by default.
17. As a user, I can see approximate cache size and clear the selected account's
    cache or all managed-browser caches while preserving saved login sessions.

## 8. Product Experience

### 8.1 Entry points

The feature must be reachable from:

1. AI Chat, when the model requests a managed-browser tool.
2. A Tool Account action labeled **Open managed browser**.
3. A browser-session indicator in the AI workspace when a session is running.

Starting from AI Chat without a selected account must not guess an account. The
application must ask the user to select from compatible active Tool Accounts.

### 8.2 Browser session header

While a session is active, the AI workspace must display:

- account display name;
- platform name;
- browser state: starting, applying session, ready, AI controlling, waiting for
  approval, user controlling, stopping, stopped, or failed;
- current origin, without query string or fragment;
- whether a proxy is active, without proxy credentials;
- elapsed time;
- **Pause AI**, **Take over**, and **Stop browser** controls.

All new user-facing text must be translated in English, Chinese, Spanish,
French, German, and Japanese.

### 8.3 Start flow

```text
User request or tool call
  -> choose compatible Tool Account
  -> show browser permission and account/domain preview
  -> acquire exclusive account-session lease
  -> start managed-browser worker
  -> launch headed Chrome
  -> report executable and fingerprint health
  -> main process decrypts approved cookie snapshot
  -> transfer cookies to worker through validated IPC
  -> worker applies cookies to isolated browser context
  -> navigate to platform verification URL
  -> verify logged-in state where a platform adapter supports it
  -> if cookies are missing, invalid, or unauthenticated:
       keep the same Chrome context open
       pause LLM control
       add a login-required notice to AI Chat
       ask the user to log in manually
       user clicks "I've finished logging in"
       add a verifying notice to AI Chat
       verify account and origin
       capture and encrypt the refreshed session
       add a success/failure notice to AI Chat
  -> ready for LLM actions, or remain in user handoff
```

The browser must not navigate to the target platform until proxy setup,
fingerprint validation, request policy, cookie application, and cancellation
handlers are installed.

### 8.4 AI control indication

When the LLM controls the browser:

- the application must show a persistent, non-color-only control indicator;
- the managed Chrome window title must identify it as an AiFetchly managed
  browser and name the selected account without exposing an email address when
  the account display name is sufficient;
- action progress must identify the current step in plain language;
- the user must be able to stop automation without waiting for the next LLM or
  browser action boundary.

### 8.5 Manual-login and user handoff

The runtime must request handoff when it encounters:

- CAPTCHA or human-verification interstitial;
- MFA, passkey, password-manager, or security-key prompt;
- login expiry requiring credentials;
- account-selection ambiguity;
- browser permission prompt that cannot be safely automated;
- destructive action whose target or scope remains unclear;
- three failed attempts at the same action or equivalent selector strategy.

Missing cookies are not a terminal error. The system must start the same
isolated headed-Chrome context that the LLM will later control, navigate to the
platform login or verification URL, and place the session in
`login_required`. The user logs in directly in that visible window. AiFetchly
must not close it and open a second login browser, because that would lose the
new in-memory session state.

During handoff, the LLM cannot send browser actions or scripts. Observation is
limited to safe navigation, origin, challenge, and authentication-state
signals; automated screenshots are disabled while a credential, one-time-code,
passkey, payment, or recovery field is present or focused.

The handoff UI must provide **I've finished logging in**, **Continue task**,
**Extend time**, and **Cancel task** as applicable. Clicking **I've finished
logging in** does not blindly resume. It starts a verification step. On success,
the worker captures an allowlisted cookie snapshot, the main process encrypts
and persists it, the page revision increments, and the LLM receives a new safe
observation. On failure, the browser remains under user control with an
actionable explanation.

The session may also detect likely completion automatically, but automatic
detection may only prompt the user to verify/resume; it must not infer that an
ambiguous account or partially completed SSO flow is safe to use.

### 8.6 Chat notices for login and challenges

Login, challenge, verification, crash, and resume transitions must be visible
inside AI Chat as structured notices, not only in a browser-session card. The
required notice lifecycle is:

```text
login_required
  -> user_login_in_progress
  -> login_verifying
  -> login_verified -> task_resuming
                    or
     login_verification_failed -> user_login_in_progress
```

Each notice has an event ID, session ID, bounded message key, severity, creation
time, and `requiresUserAction` flag. The renderer localizes the message key.
Raw page text, cookie information, credentials, provider tokens, and OAuth URL
parameters are forbidden. Repeated redirects must not produce duplicate cards;
the main process deduplicates notices by session, transition, and challenge ID.

Clicking **I've finished logging in** must add a visible user-action receipt to
the chat followed by a `login_verifying` notice. The terminal verification
notice must say whether authentication was confirmed and whether the refreshed
session was saved. If saving fails after login succeeds, the current task may
continue, but chat must warn that the session might not survive restart.

**FR-HANDOFF-001**: Missing, invalid, expired, or rejected cookies must enter
manual-login handoff in the same managed browser context.

**FR-HANDOFF-002**: LLM actions and page scripts must be rejected while the
user has control.

**FR-HANDOFF-003**: Login completion must be verified by a platform adapter or
an approved generic verification contract before AI control resumes.

**FR-HANDOFF-004**: Successful verification must attempt refreshed-cookie
persistence without replacing an existing valid snapshot on failure.

**FR-HANDOFF-005**: Every handoff transition must produce one deduplicated,
localized chat notice and a synchronized browser-session status event.

**FR-HANDOFF-006**: Manual-login handoff defaults to ten minutes, warns before
expiry, and allows an explicit extension without keeping a remote LLM stream
open.

### 8.7 CAPTCHA decision policy

A detected CAPTCHA or robot-verification challenge outside login/security flow
must pause the current browser program before any resolution decision. The main
process then evaluates, in order:

1. whether the challenge belongs to login, MFA, password recovery, account
   security, payment, or another sensitive flow;
2. whether the domain and platform policy permit an external solver;
3. whether the user enabled 2Captcha, supplied a token, accepted the current
   data-disclosure version, and authorized this exact domain or a reviewed
   platform policy;
4. whether the detected challenge type is supported without sharing cookies,
   authorization headers, private surrounding page content, or credentials;
5. whether the current action could already have taken effect.

If every eligibility check passes, AiFetchly may create one bounded 2Captcha
resolution request. Merely setting a token or enabling the existing toggle is
not sufficient authorization. Third-party social-platform CAPTCHA use is
denied by default and falls back to user handoff unless a separately reviewed
platform policy explicitly permits it. Login and security challenges always use
manual handoff.

The chat must report `challenge_detected`, the selected resolution mode, and
the terminal `challenge_resolved`, `challenge_failed`, or
`challenge_manual_action_required` state. It must not display or store the
provider token, raw solution, challenge image, site key, or private page URL.

**FR-CAPTCHA-001**: Challenge detection must stop LLM actions immediately and
create a stable challenge ID so repeated DOM scans cannot submit duplicates.

**FR-CAPTCHA-002**: `CaptchaResolutionPolicy` in the main process, not the LLM
or worker, decides `manual_handoff`, `provider`, or `blocked`.

**FR-CAPTCHA-003**: Login, MFA, recovery, account-security, payment, and
ambiguous challenges are never sent to an external provider.

**FR-CAPTCHA-004**: Provider configuration, explicit domain authorization,
disclosure consent, challenge support, and a valid token are all required.

**FR-CAPTCHA-005**: An eligible configured-provider request is request-scoped,
time-bounded, cancellable, deduplicated, and limited to one automatic attempt
before manual handoff.

**FR-CAPTCHA-006**: Provider credentials are retrieved in the main process and
must not appear in renderer payloads, LLM context, generic worker environment
variables, logs, analytics, or audit details.

**FR-CAPTCHA-007**: After any challenge resolution, the worker must increment
the page revision, re-check origin and authentication, and re-observe before
continuing. Consequential actions are never automatically replayed.

**FR-CAPTCHA-008**: When provider use is unavailable, denied, unsupported,
fails, or times out, AiFetchly must keep the browser available for manual
handoff instead of looping or silently continuing.

### 8.8 Stop and close behavior

Stopping must:

1. abort the current action and pending navigation;
2. reject new browser commands;
3. capture allowlisted refreshed cookies when safe and time-bounded;
4. send the refreshed snapshot to the main process;
5. close pages, browser contexts, Chrome, and the worker;
6. release the account-session lease; and
7. produce a terminal result stating completed, cancelled, or failed.

If cookie capture fails, the existing encrypted snapshot must remain unchanged.
Failure to save refreshed cookies must not keep Chrome alive indefinitely.

### 8.9 System settings and cache controls

System Settings must include a **Managed Browser** group with:

| Setting                               | Default         | User effect                                                                                        |
| ------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------- |
| **Use built-in managed browser**      | On              | Permits new AI-controlled managed-browser sessions when the release flag and other gates also pass |
| **Use managed browser cache**         | On              | Reuses account-isolated eligible resource responses between sessions                               |
| **Maximum managed-browser cache**     | 500 MB globally | Bounds total local disk use; accepted range is 100-2048 MB                                         |
| **Clear cache when AiFetchly closes** | Off             | Removes managed-browser resource caches during bounded app shutdown                                |

The effective browser enablement is:

```text
application release flag
AND user managed-browser setting
AND USER_AI_ENABLED for AI-controlled entry points
AND supported platform/account
AND compatible browser dependency
```

The user preference defaults to enabled. A release flag may suspend new
sessions without overwriting the preference. A missing browser dependency is
reported as a diagnostic and must not silently turn the preference off.

Disabling the built-in browser blocks new sessions and removes or deactivates
its LLM tool family. If a session is active, the UI asks whether to stop it now
or let it finish; changing a toggle must not abruptly close a browser during
login or a consequential action.

The settings page must show approximate current cache size, last successful
clear time, **Clear selected account cache**, and **Clear all managed-browser
caches**. Clearing requires a scope-and-size confirmation. It must state that
saved login cookies are preserved and that the next page load may be slower.

When the selected account has an active session, the choices are **Stop and
clear now**, **Clear when this browser closes**, or **Cancel**. AiFetchly must
not delete cache files while Chrome has them open. The LLM may request a clear
for its current account through a dedicated confirmed capability, but it never
receives or supplies a filesystem path.

All labels, confirmations, progress, errors, and completion notices must exist
in all six supported languages.

**FR-SETTING-001**: The user setting `managed-browser-enabled` defaults to
`"1"`/enabled and is read from the main-process settings Module before worker
startup or cookie decryption.

**FR-SETTING-002**: `MANAGED_BROWSER_ENABLED` remains a separate release flag;
effective enablement requires both controls and neither may be overridden by
renderer or LLM arguments.

**FR-SETTING-003**: Disabling the preference blocks new starts and returns a
localized `managed_browser_disabled` chat/tool result with a route to settings.

**FR-SETTING-004**: Disabling while active requires an explicit stop/finish
choice and never silently terminates user handoff or an in-flight consequential
action.

**FR-CACHE-001**: `managed-browser-cache-enabled` defaults to enabled and may be
changed independently from the global browser setting.

**FR-CACHE-002**: Persistent resource cache is isolated by opaque account scope
and compatible Chrome cache version; no cache directory is shared by accounts
or concurrently opened by multiple sessions.

**FR-CACHE-003**: Durable cookies remain exclusively in
`AccountSessionService`; a cache directory is never an authentication source.

**FR-CACHE-004**: Clear selected/all cache operations are validated main-process
capabilities with explicit scope, confirmation, progress, cancellation before
deletion begins, and a safe terminal result.

**FR-CACHE-005**: Renderer and LLM inputs may specify an account ID or approved
scope but never a path. The main process derives and validates every cache path.

**FR-CACHE-006**: Clear cache preserves encrypted cookies, account records,
local login partitions, downloads, and unrelated application caches.

**FR-CACHE-007**: Active cache clearing is deferred until the owning Chrome
process closes, or explicitly stops/restarts that managed session first.

**FR-CACHE-008**: The cache has a 500 MB default global limit, a 200 MB default
per-account target, a 30-day inactive retention target, and least-recently-used
inactive-account eviction.

**FR-CACHE-009**: Cache size, eviction, and deletion run off the Electron main
event loop in a dedicated maintenance utility process under
`src/childprocess/managed-browser-cache/`.

**FR-CACHE-010**: Clearing is idempotent: repeated requests for an already empty
scope succeed with zero deleted bytes and cannot escape the managed cache root.

**FR-CACHE-011**: Clear completion returns only scope, approximate deleted byte
count, retained-cookie status, and safe reason codes; it never lists cached URLs
or private response data.

**FR-CACHE-012**: Cache content, cache paths, opaque account-scope identifiers,
and cached URLs are excluded from logs, analytics, AI context, and support
exports by default.

**FR-CACHE-013**: Removing a Tool Account must queue its inactive managed cache
for deletion after the account/session transaction succeeds; failure to delete
cache must not restore or corrupt the removed account.

**FR-CACHE-014**: Clear-on-exit must prevent queued cache namespaces from being
reused after shutdown begins. If the shutdown deadline expires before physical
deletion completes, the next startup resumes the deletion queue before those
namespaces can be opened.

## 9. Browser Session and Cookie Requirements

### 9.1 Account selection and lease

**FR-COOKIE-001**: Every authenticated managed browser session must be bound to
exactly one saved Tool Account.

**FR-COOKIE-002**: The main process must acquire an exclusive in-memory lease for
the selected account before decrypting or transferring cookies.

**FR-COOKIE-003**: A second request for the same account must return the active
session or ask the user to stop it; it must not launch a concurrent browser with
the same authentication snapshot.

**FR-COOKIE-004**: Separate accounts must use separate browser contexts and must
not share cache, storage, cookies, downloads, or page references.

### 9.2 Secret handoff

**FR-COOKIE-005**: Only `AccountSessionService` may decrypt persisted account
cookies.

**FR-COOKIE-006**: The renderer may send an account ID but may never receive the
decrypted snapshot.

**FR-COOKIE-007**: The LLM request, system prompt, tool arguments, tool results,
and conversation database must never contain cookie values.

**FR-COOKIE-008**: Main-to-worker cookie messages must use a strict schema
validated with the repository's installed Zod version and a session-specific
request ID.

**FR-COOKIE-009**: The main process must reapply the platform manifest's domain
allowlist before transferring cookies, even if the stored snapshot was filtered
when saved.

**FR-COOKIE-010**: The worker must acknowledge how many cookies were accepted and
rejected using counts only. It must not echo names or values.

**FR-COOKIE-011**: Cookie payloads must not be written to stdout, stderr, debug
logs, crash reports, temporary files, or process environment variables.

### 9.3 Applying cookies

**FR-COOKIE-012**: The browser worker must create an isolated browser context,
apply cookies before the first platform navigation, and reject cookies outside
the selected platform manifest.

**FR-COOKIE-013**: Cookie attributes must preserve domain, path, secure,
HTTP-only, SameSite, expiry, and host-only semantics where Puppeteer supports
them.

**FR-COOKIE-014**: One malformed or browser-rejected cookie must not prevent
other approved cookies from being applied.

**FR-COOKIE-015**: After applying cookies, the worker must navigate to the
platform verification URL and report one of: authenticated, unauthenticated,
verification_unknown, challenge_required, or navigation_failed.

### 9.4 Refresh and persistence

**FR-COOKIE-016**: The worker must capture cookies after successful login
handoff, after a platform-authentication refresh, and during orderly close.

**FR-COOKIE-017**: The worker sends the refreshed raw browser cookie snapshot to
the main process through private process IPC. It never writes the database.

**FR-COOKIE-018**: The main process must call
`AccountSessionService.persistSnapshot()` with source `worker_refresh`.

**FR-COOKIE-019**: Empty, invalid, key-unavailable, or persistence-failed refresh
results must not overwrite the last valid snapshot.

**FR-COOKIE-020**: The user-facing result may report status and cookie counts but
not cookie names, domains beyond the reviewed platform manifest, or values.

### 9.5 Persistent profile deferral

The first release uses an isolated browser context seeded from the encrypted
cookie snapshot. A persistent Chrome `userDataDir` per account is deferred
because it creates a second durable store of authentication material and may
contain local storage, IndexedDB, history, cache, autofill, service workers, and
other secrets outside the existing encrypted-cookie lifecycle.

A later persistent-profile design requires a separate security review covering
storage encryption, operating-system key integration, profile locking, cleanup,
backup behavior, account deletion, portability, and incident response.

The managed resource cache in §9.6 is not a persistent profile and must not
retain cookies or other authentication stores.

### 9.6 Managed resource cache

P0 uses a unique disposable Chrome profile for each browser session and a
separate persistent disk-cache directory for eligible HTTP resources. The
temporary profile is deleted after shutdown; the resource cache may survive and
is reused only for the same opaque account scope and compatible Chrome version.

Because authenticated responses can still contain private information even
when marked cacheable, the cache is treated as sensitive local application
data. AiFetchly must respect server cache-control behavior, never deliberately
cache `no-store` responses, use restrictive filesystem permissions, and clear
the cache when an account is removed or the user requests all browser data.

Implementation must prove with the packaged Chrome versions that cookies,
local storage, IndexedDB, service workers, history, autofill, permissions, and
credential state remain in the disposable profile rather than the persistent
resource-cache directory. Failure of that containment test disables persistent
cache for the affected platform/OS/browser combination.

## 10. LLM Browser Tool Requirements

### 10.1 Tool family

The first release must register these built-in tools:

| Tool                           | Purpose                                                               | Default risk      |
| ------------------------------ | --------------------------------------------------------------------- | ----------------- |
| `browser_start_session`        | Start or bind to a managed browser for a selected account             | automation        |
| `browser_get_state`            | Get safe session status and current sanitized URL                     | automation-read   |
| `browser_observe`              | Capture the page's semantic interactive state                         | automation-read   |
| `browser_navigate`             | Navigate to an approved URL                                           | automation-write  |
| `browser_run_actions`          | Execute a bounded structured action program                           | action-dependent  |
| `browser_evaluate_script`      | Execute reviewed JavaScript in the page context                       | privileged-script |
| `browser_screenshot`           | Capture the visible page for the current conversation                 | automation-read   |
| `browser_request_handoff`      | Pause and ask the user to take control                                | automation-read   |
| `browser_resume_after_handoff` | Resume after explicit user action                                     | automation-write  |
| `browser_clear_cache`          | Clear the current account's managed resource cache after confirmation | local-data-delete |
| `browser_stop_session`         | Stop and close the current browser                                    | automation-write  |

The exact public names may be refined in technical design, but the capabilities
and risk separation are required.

All tools must be contextual or deferred in the tool catalog. The model should
load them when the user explicitly asks to browse, interact with a social
platform, operate a Tool Account, or continue an existing browser session.

### 10.2 Observation contract

`browser_observe` must return a bounded semantic snapshot, not the full raw DOM
by default:

```text
session: mb_7f2...
page_revision: 18
url: https://www.youtube.com/feed/history
title: Watch history

@e1 [textbox] "Search"
@e2 [button] "Search"
@e3 [link] "Video title"
@e4 [button] "More actions"
```

The observation should contain:

- opaque session ID;
- monotonically increasing page revision;
- sanitized URL without credentials and with query/fragment redaction when
  fields may contain sensitive data;
- title;
- visible text within a configured budget;
- accessibility roles, names, states, and generated element references;
- focused element and viewport information;
- frame identity where relevant;
- optional screenshot reference;
- navigation, dialog, challenge, and download state;
- a statement that webpage content is untrusted data, not assistant
  instructions.

The observation must exclude:

- cookies and authorization headers;
- hidden password or token values;
- local/session storage values;
- browser extension pages;
- unsupported privileged URLs;
- raw cross-origin response bodies not visible to the page;
- unbounded HTML or accessibility trees.

### 10.3 Stable action references

**FR-TOOL-001**: Every interactive element reference is valid only for the page
revision that produced it.

**FR-TOOL-002**: Every action using a reference must include the expected page
revision.

**FR-TOOL-003**: The worker must reject stale references after navigation,
reload, frame replacement, or material DOM change and return a new observation.

**FR-TOOL-004**: The runtime must prefer role, accessible name, label, text, and
verified DOM identity over model-generated CSS selectors.

**FR-TOOL-005**: Raw CSS or XPath selectors are a fallback and must be bounded,
validated, and scoped to the current page or frame.

### 10.4 Structured action programs

`browser_run_actions` must support a bounded program of reviewed action types:

- observe;
- find by role, label, text, or selector fallback;
- click;
- fill and clear;
- select option;
- press key;
- hover;
- scroll;
- wait for element, navigation, URL, text, or network-idle condition;
- navigate, back, forward, and reload;
- extract visible text or selected attributes;
- screenshot;
- repeat over a bounded set of matched elements;
- conditional branch over safe, observable page state;
- stop with a structured result;
- request user handoff.

Limits must include:

- maximum actions per call;
- maximum loop iterations;
- maximum runtime;
- maximum pages or tabs opened;
- maximum extracted records and output bytes;
- cancellation checks between actions;
- no recursion;
- no dynamic tool invocation from inside the action program.

Every action must return its ID, success, safe error code, URL/title before and
after where useful, whether an element was found, and the resulting page
revision. Error results must not include page secrets.

### 10.5 Page-context script tool

`browser_evaluate_script` exists for page-specific DOM logic that cannot be
expressed economically with structured actions.

It must execute JavaScript inside the current webpage context using
Puppeteer's page-evaluation mechanism. It must not evaluate the script in the
Node.js worker context.

Required input:

```json
{
  "session_id": "opaque session id",
  "page_revision": 18,
  "purpose": "Extract visible comment authors and unanswered text",
  "script": "() => { /* bounded page-context function */ }",
  "timeout_ms": 5000,
  "expected_output": "Array of author and comment text objects"
}
```

**FR-SCRIPT-001**: The tool must require a function body that returns
JSON-serializable data.

**FR-SCRIPT-002**: The tool must reject stale page revisions.

**FR-SCRIPT-003**: The tool must impose script length, runtime, result-size, and
serialization-depth limits.

**FR-SCRIPT-004**: The tool must reject attempts to return values associated
with cookies, authorization, passwords, tokens, local storage, session storage,
IndexedDB authentication records, or browser credentials.

**FR-SCRIPT-005**: The browser surface must have no Node integration, Electron
bridge, privileged preload API, or local filesystem capability available to the
page.

**FR-SCRIPT-006**: The permission dialog must display the selected account,
origin, purpose, complete script, timeout, expected output, and risk warning.

**FR-SCRIPT-007**: Approval may be granted once or for the current browser task
and current origin. It must not become a permanent global approval.

**FR-SCRIPT-008**: A script that changes location, submits a form, clicks an
element, opens a window, triggers a download, sends a request, or mutates
page-visible state must be classified as write-capable and must follow the
consequential-action policy where applicable.

**FR-SCRIPT-009**: The runtime must terminate or invalidate the page when a
script exceeds its execution deadline and cannot be safely interrupted.

**FR-SCRIPT-010**: Script source may be retained in the local tool audit record,
but arguments and results must be sanitized and bounded. Scripts must not be
sent to analytics.

### 10.6 Prohibited script capability

The feature must never expose a tool that directly evaluates model-generated
code equivalent to:

```typescript
async (page, browser, require, process, fs, childProcess) => { ... }
```

The worker must not use Node's `vm` module as the sole security boundary for
untrusted model code. If a future release needs programmable logic outside the
page, it must use a separately reviewed interpreter or process sandbox with a
narrow browser-command API.

## 11. Approval and Consequential-Action Policy

Browser automation needs a second policy layer beyond the existing generic
`automation` category because reading a page, clicking a tab, and publishing a
post do not have the same impact.

### 11.1 Risk classes

| Class                      | Examples                                                                          | Required behavior                                                                         |
| -------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Observe                    | Read visible text, inspect elements, screenshot                                   | Session-level browser approval                                                            |
| Reversible interaction     | Search, filter, paginate, open menu, draft text                                   | Session-level approval unless platform adapter raises risk                                |
| Sensitive input            | Fill email, phone, private message, upload path                                   | Preview and explicit approval unless the user directly supplied the value for this action |
| Consequential              | Send, publish, comment, follow, invite, upload, delete, purchase, change settings | Explicit just-in-time approval                                                            |
| Privileged script          | Any page-context script                                                           | Script preview and task/origin-scoped approval                                            |
| Authentication             | Password, MFA, login/security CAPTCHA, passkey, account recovery                  | Mandatory user handoff                                                                    |
| Eligible non-login CAPTCHA | Authorized non-sensitive challenge outside login/security flow                    | Main-process provider policy; one attempt; manual handoff fallback                        |
| Local data deletion        | Clear selected/all managed-browser resource cache                                 | Explicit scope/size confirmation; preserve saved login unless separately selected         |

### 11.2 Approval invariants

1. Page content cannot lower an action's risk classification.
2. The model cannot mark its own action safe or approved.
3. An explicit user denial remains authoritative.
4. A consequential action requires a preview of the account, platform, target,
   content or effect, and action count.
5. Bulk consequential actions must show a bounded count and representative
   preview before approval.
6. If the target changes after approval, approval is invalidated.
7. If the page revision changes materially before execution, the runtime must
   revalidate the target and may require approval again.
8. `full_access` mode may remove generic tool prompts, but it must not bypass
   authentication handoff, platform security challenges, or policy-defined
   always-confirm actions.

## 12. Fingerprint Consistency Requirements

### 12.1 Design principle

The product goal is **internal consistency and predictable authorized
automation**, not a claim of invisibility. Native browser values are preferred
over synthetic values. Every override adds a consistency obligation and must
have a documented reason and an automated check.

### 12.2 Single fingerprint policy

The browser worker must obtain all launch and page identity settings from one
versioned `BrowserFingerprintPolicy`. Individual platform workers must not set
their own unrelated user agent, platform, languages, WebGL identity, plugins,
hardware values, or timing patches.

The policy must include:

- policy version;
- actual executable path and product version;
- headful/headless mode;
- operating system and architecture;
- native or explicitly configured user agent;
- locale and `Accept-Language`;
- timezone;
- viewport, screen size, and device scale factor;
- proxy presence and optional configured region metadata;
- stealth plugin version and enabled evasions;
- permitted launch flags;
- deviations from native behavior with a reason code.

The policy must not contain account-cookie values or proxy credentials.

### 12.3 User-agent requirements

**FR-FP-001**: The default managed browser must use Chrome's native user agent.

**FR-FP-002**: Random user-agent rotation is disabled by default and must not be
used for authenticated account sessions.

**FR-FP-003**: If a platform-specific override is necessary, the browser major
version reported in the user agent must equal the launched executable's actual
major version.

**FR-FP-004**: An override claiming Chrome must not report Firefox, Safari,
Edge, a different operating system, or an incompatible architecture unless the
entire reviewed profile supports that identity.

**FR-FP-005**: The current hard-coded Chrome 118-120 user-agent pool must not be
used with the configured Chrome 136 build or any other mismatched executable.

**FR-FP-006**: Startup must fail with a safe `fingerprint_mismatch` error when a
configured override does not pass validation.

### 12.4 Locale, timezone, and proxy requirements

**FR-FP-007**: `navigator.language`, `navigator.languages`, Chrome locale,
`Accept-Language`, and the configured account locale must not contradict each
other.

**FR-FP-008**: AiFetchly must not infer or spoof a timezone from an unverified
proxy location. If the user or proxy configuration provides a reviewed
timezone, apply it consistently; otherwise use the host's native timezone.

**FR-FP-009**: Proxy diagnostics may report configured region and timezone
consistency but must not log credentials or full proxy URLs.

**FR-FP-010**: WebRTC and DNS behavior must not silently bypass the selected
proxy policy. A technical design must define supported proxy protocols and leak
tests before enabling platform rollout.

### 12.5 Viewport and hardware requirements

**FR-FP-011**: The viewport must fit the visible headed window and must not
claim dimensions incompatible with the actual screen or device scale factor.

**FR-FP-012**: Hardware concurrency, device memory, touch capability, platform,
plugins, and WebGL values should remain native unless a reviewed compatibility
case requires an override.

**FR-FP-013**: Static values such as a Windows-only GPU identity must not be
injected on macOS or Linux.

**FR-FP-014**: The runtime must not globally modify `Object.prototype`,
`HTMLIFrameElement.prototype`, `Date.now`, console behavior, or other broad page
primitives solely to pass a synthetic detection test.

### 12.6 Launch-flag security

The managed authenticated browser must use a minimal allowlist of launch flags.

The default desktop configuration must not include:

- `--no-sandbox`;
- `--disable-setuid-sandbox`;
- `--disable-web-security`;
- `--ignore-certificate-errors`;
- `--ignore-ssl-errors`;
- `--allow-running-insecure-content`;
- `--disable-site-isolation-trials`;
- broad disabling of safe browsing or browser security controls.

Any environment-specific exception requires an explicit configuration, a
visible diagnostic warning, and a security review. It must not be silently
enabled for packaged desktop users.

### 12.7 Fingerprint self-test

Before platform navigation, the worker must run a local self-test page or CDP
inspection and produce a non-secret report containing:

- actual browser product and version;
- claimed user-agent product and major version;
- platform and architecture consistency;
- locale and language consistency;
- timezone source;
- viewport/screen consistency;
- headful mode confirmation;
- automation-policy version;
- unsafe launch-flag findings;
- proxy configured status;
- overall result: pass, warning, or fail.

The report must never use third-party bot-detection sites as a production
dependency. Third-party sites may be used manually during development only,
subject to their terms and without production account cookies.

## 13. Browser Runtime Requirements

### 13.1 Worker boundary

All managed browser entry points and Puppeteer-specific session code must live
under:

```text
src/childprocess/managed-browser/
```

The worker may:

- launch and control Chrome;
- create browser contexts and pages;
- apply the cookie payload received from the main process;
- configure a reviewed proxy;
- observe page state;
- execute validated actions and page-context scripts;
- capture screenshots and refreshed cookies;
- emit progress and terminal results;
- close browser resources.

The worker must not:

- import a Model or Module that accesses SQLite;
- construct a database path;
- use Electron's `app`, `safeStorage`, or renderer IPC;
- decrypt persisted cookies;
- call the remote AI server directly;
- decide whether a consequential action is approved;
- persist browser results.

### 13.2 Main-process orchestration

The main process owns:

- AI enable checks using `Token` and `USER_AI_ENABLED` at the beginning of
  AI-facing IPC handlers;
- Tool Account lookup through the Module layer;
- account-session leases;
- cookie decryption and encrypted persistence through `AccountSessionService`;
- worker start, validated messaging, cancellation, and crash recovery;
- permission decisions and approval UI events;
- async job state and progress;
- audit persistence through existing services;
- forwarding safe state to the renderer and LLM.

No IPC handler may access TypeORM repositories directly.

### 13.3 Worker lifecycle

**FR-RUNTIME-001**: One worker owns one managed browser session.

**FR-RUNTIME-002**: The worker must send `ready` before receiving cookies or
commands.

**FR-RUNTIME-003**: Every message must include schema version, session ID,
request ID, and discriminated message type.

**FR-RUNTIME-004**: Unknown, malformed, stale-session, oversized, or
out-of-sequence messages must fail closed.

**FR-RUNTIME-005**: The main process must terminate a worker that does not become
ready within the startup deadline.

**FR-RUNTIME-006**: Cancellation must propagate from AI Chat and UI Stop to the
current action, Puppeteer page, browser context, Chrome process, and worker.

**FR-RUNTIME-007**: On unexpected worker exit, the main process must release the
account lease, mark the job failed, and attempt bounded orphan-Chrome cleanup
using a validated process identity.

**FR-RUNTIME-008**: Browser concurrency defaults to one managed session for the
application and must be configurable within a safe global resource budget.

**FR-RUNTIME-009**: The main process must start exactly one disposable Electron
`utilityProcess` per managed-browser session. Puppeteer and all browser-specific
session state run there, never on the main-process event loop.

**FR-RUNTIME-010**: The worker must launch and own its Chrome process tree and
report a bounded process identity containing worker PID, browser PID,
executable fingerprint, session nonce, and launch time.

**FR-RUNTIME-011**: The worker must emit a heartbeat every five seconds. Three
missed heartbeats mark it unresponsive, reject pending work, and start bounded
cleanup. A busy page or manual handoff must not suppress the worker heartbeat.

**FR-RUNTIME-012**: Worker error, exit, protocol violation, missed heartbeat,
Chrome disconnect, and app shutdown must converge on one idempotent cleanup
routine.

**FR-RUNTIME-013**: Orphan cleanup may terminate a Chrome process only after
validating that its PID, executable identity, launch time, and session nonce
belong to the managed session. PID alone is insufficient.

**FR-RUNTIME-014**: A worker/Chrome crash must not crash or block Electron's
main process. The main process must remain usable, preserve the last valid
cookie snapshot, release leases, fail affected jobs, and send a sanitized chat
notice.

**FR-RUNTIME-015**: The managed-browser supervisor must participate in the
application `before-quit` sequence: cancel jobs, request graceful session stop,
wait within a global deadline, then force verified remaining workers/processes
to exit.

### 13.4 Async jobs

Long browser tasks must use `ToolJobRegistry` or its successor:

```text
LLM calls browser_run_actions
  -> tool returns async job ID
  -> local browser job continues
  -> worker emits bounded progress
  -> LLM or UI polls/subscribes to status
  -> job completes, fails, cancels, or requests handoff
  -> final structured result is supplied to the next AI turn
```

The remote AI completion stream must not remain open while the user completes
MFA or a long browser task runs.

## 14. Navigation, Network, and Data Safety

### 14.1 Navigation policy

1. Initial navigation is limited to the selected platform manifest.
2. Same-site and explicitly approved SSO domains may be allowed without a new
   browser session.
3. Navigation to a new registrable domain requires policy validation and may
   require user approval.
4. Block `file:`, `javascript:`, `data:` top-level navigation, browser-internal
   schemes, extension URLs, loopback, private networks, link-local ranges, and
   cloud metadata endpoints unless a separately reviewed local-development
   mode explicitly permits a target.
5. Validate redirects and subresource requests where the worker's network
   architecture supports interception.
6. Downloads, popups, permission requests, protocol handlers, and file choosers
   must enter explicit controlled states rather than silently proceeding.

### 14.2 Prompt-injection defense

Webpage content is untrusted. A page may tell the assistant to ignore prior
instructions, reveal secrets, call another tool, download a file, or perform an
unrelated account action.

The browser system prompt and runtime must enforce:

1. Page text is evidence about the page, never authorization.
2. Page instructions cannot widen allowed domains, tool permissions, account
   scope, file access, or consequential-action approval.
3. Browser tool results cannot trigger shell, filesystem, email, or other tools
   without normal policy evaluation.
4. Cookies, credentials, hidden tokens, and local browser secrets are never
   supplied as page observations.
5. Unexpected requests to reveal secrets or change the task are surfaced to the
   user and recorded as a safe security event.

### 14.3 Sensitive fields

- Password, MFA, passkey, recovery-code, payment-card, and security-answer
  fields require user handoff.
- The model may fill ordinary user-provided search, draft, comment, or form text
  only within the approved task.
- Tool results must redact values typed into password-like or token-like fields.
- Screenshots containing sensitive inputs must not be persisted by default.

## 15. Platform Adapter Requirements

The generic browser runtime must not encode every platform's login selectors,
challenge pages, or consequential actions. Platform-specific knowledge belongs
in reviewed adapters used by the worker.

Each enabled platform adapter may provide:

- platform ID and manifest reference;
- landing and verification URLs;
- authenticated-state signals;
- logged-out and challenge-state signals;
- SSO domain rules;
- known consequential action descriptors;
- safe readiness checks;
- page-specific observation hints;
- maximum action and rate policies;
- recovery guidance that does not bypass human challenges.

An adapter must not contain database access, raw account-cookie persistence, or
remote AI calls.

Platform rollout requires adapter tests against saved, sanitized HTML fixtures
or controlled local pages. Live-account tests remain manual and must use
authorized test accounts.

## 16. Failure Model and Recovery

| Failure                             | Required behavior                                                                                    |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Browser executable missing          | Return dependency diagnostic and installation path; do not attempt platform navigation               |
| Browser/version mismatch            | Fail startup with fingerprint health report                                                          |
| Cookie key unavailable              | Keep snapshot intact and request reauthentication or retry                                           |
| No valid cookies                    | Start unauthenticated browser and request user login handoff                                         |
| Some cookies rejected               | Continue with accepted cookies, report counts only                                                   |
| Proxy unavailable                   | Stop before platform navigation unless user explicitly chooses approved direct fallback              |
| Proxy authentication fails          | Return safe proxy error without credentials                                                          |
| Login expired                       | Request user handoff                                                                                 |
| CAPTCHA in login/security flow      | Request user handoff; never call an external solver                                                  |
| CAPTCHA outside sensitive flow      | Pause; apply main-process provider policy; make one eligible attempt or request handoff              |
| Element reference stale             | Re-observe and replan; do not guess coordinates immediately                                          |
| Action fails once                   | Return structured failure and fresh observation                                                      |
| Equivalent action fails three times | Stop retrying and request handoff or fail                                                            |
| Page-context script timeout         | Invalidate or recreate affected page, then return safe timeout                                       |
| Consequential target changes        | Invalidate approval and request a new preview                                                        |
| Worker/Chrome crashes               | Keep main app alive, fail job, release lease, verify orphan identity, preserve snapshot, notify chat |
| Worker misses three heartbeats      | Mark unresponsive and run the same idempotent crash-cleanup path                                     |
| Cookie refresh persistence fails    | Preserve existing snapshot and close browser normally                                                |
| User presses Stop                   | Cancel locally without waiting for another AI response                                               |

Recovery must be bounded. The browser must not loop indefinitely between model
plans, selector failures, page reloads, and retries.

## 17. Observability and Audit

### 17.1 Safe operational events

Record locally:

- session ID and conversation ID;
- selected account ID and platform ID;
- browser executable version and fingerprint-policy version;
- start, ready, handoff, resume, stop, and terminal timestamps;
- action type, target role or safe descriptor, outcome, and duration;
- approval request and decision;
- page revision changes;
- cookie counts applied/rejected/refreshed, never values or names;
- worker exit code and sanitized error class;
- Chrome cleanup result;
- proxy enabled status and safe provider/region identifier when configured.

### 17.2 Forbidden logging

Never log:

- cookie names or values;
- authorization headers;
- proxy username or password;
- passwords, MFA codes, recovery codes, or payment fields;
- unredacted query strings containing user data;
- complete page HTML;
- unbounded extracted private messages or comments;
- screenshot image data in normal application logs;
- page-context script results before sanitization.

### 17.3 Product metrics

Measure aggregated, non-secret metrics:

- managed-browser startup success rate;
- median time to ready;
- stored-session authentication success rate;
- user-login handoff rate;
- browser task completion rate;
- consequential-action approval and rejection rate;
- page-script usage and failure rate;
- stale-reference rate;
- repeated-action stop rate;
- worker crash and orphan-process rate;
- cookie refresh success rate;
- fingerprint self-test pass, warning, and fail rates by app/browser version;
- platform-specific manual intervention rate.

Do not use stealth success or platform enforcement avoidance as a product metric.

## 18. Functional Requirements Summary

### P0: Foundation

- **FR-P0-001**: Launch one visible headed Chrome session from a dedicated
  managed-browser worker.
- **FR-P0-002**: Bind it to one selected Tool Account and acquire an exclusive
  account lease.
- **FR-P0-003**: Transfer approved cookies main-to-worker without renderer or
  LLM exposure.
- **FR-P0-004**: Apply cookies before navigation and return refreshed cookies to
  main-process persistence.
- **FR-P0-005**: Use native executable-matched user agent by default.
- **FR-P0-006**: Remove hard-coded random user-agent use from the managed
  browser path.
- **FR-P0-007**: Run fingerprint consistency self-test before platform
  navigation.
- **FR-P0-008**: Support observe, navigate, structured actions, screenshot,
  handoff, resume, and stop.
- **FR-P0-009**: Show visible browser status, pause/takeover/stop controls, and
  localized approvals.
- **FR-P0-010**: Support cancellation through worker and Chrome cleanup.
- **FR-P0-011**: Pilot on one platform with an authenticated-state adapter.
- **FR-P0-012**: Enforce AI-enabled gating before AI browser work.
- **FR-P0-013**: When authentication is unavailable, keep the same browser
  context open, pause AI control, guide manual login, verify completion, and
  resume with a fresh observation.
- **FR-P0-014**: Mirror login, challenge, resume, crash, and terminal states to
  AI Chat through localized, deduplicated structured notices.
- **FR-P0-015**: Run each browser session in its own disposable utility process
  with heartbeat supervision and verified cleanup.
- **FR-P0-016**: Detect CAPTCHA and robot-verification states, apply the
  main-process resolution policy, and always support manual handoff.
- **FR-P0-017**: Add the built-in-browser and persistent-cache system settings,
  both enabled by default, with release-flag precedence.
- **FR-P0-018**: Reuse an account-isolated resource cache while keeping the
  authentication profile disposable.
- **FR-P0-019**: Support confirmed selected-account and all-cache clearing that
  preserves saved login sessions.

### P1: Advanced automation

- **FR-P1-001**: Add page-context script execution with complete preview and
  task/origin-scoped approval.
- **FR-P1-002**: Add conditional and bounded repeat actions.
- **FR-P1-003**: Add popup, dialog, download, and file-chooser state handling.
- **FR-P1-004**: Add per-platform consequential-action descriptors.
- **FR-P1-005**: Add multiple controlled tabs within one account context.
- **FR-P1-006**: Add async browser job continuation and progress integration.
- **FR-P1-007**: Expand to additional platforms only after platform gates pass.
- **FR-P1-008**: Add the policy-gated 2Captcha provider adapter for explicitly
  authorized non-login domains, with one attempt and manual fallback.

### P2: Session durability and scale

- **FR-P2-001**: Evaluate an opt-in persistent Chrome profile only after a
  separate security design.
- **FR-P2-002**: Add a global browser resource budget and bounded multi-account
  concurrency.
- **FR-P2-003**: Add platform adapter/plugin extensibility without exposing the
  host's private browser internals.
- **FR-P2-004**: Add richer local replay fixtures and deterministic browser-job
  simulation for development.

## 19. Non-Functional Requirements

### 19.1 Security

1. No cookie value crosses into renderer or LLM data.
2. Browser workers have no direct database access.
3. No model-generated Node.js or Puppeteer code execution.
4. Authenticated managed browsers retain Chromium sandbox and web security in
   normal desktop operation.
5. Worker messages and tool inputs are validated with the repository's
   installed Zod version at both receiving boundaries.
6. Browser commands are scoped to session, conversation, account, and page
   revision.
7. Consequential actions use just-in-time approval.
8. Page content is treated as untrusted input.

### 19.2 Reliability

1. One failed cookie or action does not crash the browser session.
2. Every terminal path attempts bounded browser cleanup.
3. Existing valid cookies are never replaced by an empty or failed refresh.
4. Duplicate or retried browser commands are idempotent by request ID where
   their semantics permit it.
5. Stale page references fail safely.
6. Repeated equivalent failures stop after a configured threshold.
7. A worker or Chrome crash cannot terminate or block the Electron main
   process.
8. Worker heartbeats continue during navigation, long actions, and manual
   handoff; missed-heartbeat cleanup is idempotent.
9. CAPTCHA provider failure cannot create an infinite submission or polling
   loop.
10. Cache cleanup failure cannot block browser startup, shutdown, or the main
    process; it returns a safe retryable result.
11. An active cache directory is never deleted while its owning Chrome process
    is running.

### 19.3 Performance

1. Median managed-browser startup to ready should be under 8 seconds on a
   supported workstation with the browser already installed and a responsive
   proxy.
2. A semantic observation should complete within 1 second for normal pages and
   return within a strict size budget.
3. Stop should begin cancellation immediately and close Chrome within 5 seconds
   in the normal case.
4. Progress events must be rate-limited to avoid flooding AI Chat or renderer
   IPC.
5. Browser concurrency defaults to one until resource measurements justify an
   increase.
6. A warm repeat fixture load should demonstrate a measurable improvement over
   a cold load before persistent cache is enabled for a platform/OS combination.
7. Cache size scanning, eviction, and deletion must not block the Electron main
   event loop for more than one normal event-loop turn.

### 19.4 Privacy

1. Browser screenshots and extracted page data stay local unless the active AI
   request explicitly needs them and the user has approved the relevant tool.
2. Screenshot retention defaults to ephemeral.
3. The application must state when visible page content is being supplied to a
   remote AI model.
4. Private messages, comments, account names, and form content must be bounded
   and redacted in diagnostics.
5. Persistent browser cache is treated as sensitive local data and is isolated
   per opaque account scope with restrictive permissions.
6. Clearing cache reports only size/count status and never cached URLs,
   response bodies, headers, or filenames.

### 19.5 Maintainability

1. One central browser manager owns executable discovery and launch policy.
2. One fingerprint policy owns identity-related configuration.
3. One action schema is shared across AI tool validation and worker validation.
4. Platform-specific behavior lives in adapters.
5. Worker-specific code remains under `src/childprocess/`.
6. All functions have explicit return types and no new `any` types are allowed.

### 19.6 Accessibility and localization

1. Browser status and controls must be keyboard accessible.
2. State must not be communicated by color alone.
3. Approval dialogs must expose complete accessible labels for account, target,
   script, and action.
4. Every user-facing string must exist in all six supported language files.

## 20. Proposed Component Boundaries

The detailed technical design may refine names, but implementation must preserve
these responsibilities:

```text
Electron renderer
  Browser status, approval, handoff, pause, stop
             |
             | validated contextBridge IPC, no cookies
             v
Main process
  ManagedBrowserModule
    - AI enable gate coordination
    - account lookup and lease
    - AccountSessionService cookie read/write
    - permission and audit coordination
    - worker client and lifecycle
    - safe renderer/LLM results
  CaptchaResolutionPolicy
    - sensitive-flow and domain eligibility
    - configured-provider authorization
    - disclosure consent and single-attempt budget
  CaptchaProviderService
    - request-scoped provider token use
    - cancellation, timeout, and safe result
  ManagedBrowserSettingsModule
    - effective enablement and validated user preferences
  ManagedBrowserCacheModule
    - opaque account scope and trusted path derivation
    - active-session coordination and safe clear API
             |
             | validated process messages, ephemeral cookies
             v
src/childprocess/managed-browser/
  ManagedBrowserWorker
    - BrowserRuntime
    - BrowserFingerprintPolicy
    - BrowserObservationService
    - BrowserActionExecutor
    - PageScriptExecutor
    - PlatformBrowserAdapter
    - ChallengeDetector (detection only; no provider credential)
    - cancellation and cleanup
src/childprocess/managed-browser-cache/
  ManagedBrowserCacheMaintenanceWorker
    - bounded size scan, eviction, and validated deletion only
             |
             v
       Headed Chrome
```

Expected new or changed areas:

```text
src/childprocess/managed-browser/
src/entityTypes/managedBrowserTypes.ts
src/schemas/worker/managedBrowser.ts
src/schemas/aiTools/managedBrowser.ts
src/service/ManagedBrowserWorkerClient.ts
src/modules/ManagedBrowserModule.ts
src/service/ManagedBrowserAiTools.ts
src/config/skillsRegistry.ts
src/service/BuiltInToolCapabilitiesPromptSection.ts
src/service/ToolTimeoutPolicy.ts
src/main-process/communication/managed-browser-ipc.ts
src/views/components/aiChatV2/
src/views/lang/{en,zh,es,fr,de,ja}.ts
forge.config.js
```

No worker may import `AccountCookiesModel`, `SocialAccountModel`, `SqliteDb`, or
TypeORM repositories.

## 21. Migration and Compatibility

1. Existing Electron manual-login windows and browser-profile import remain
   available.
2. Existing encrypted cookie snapshots remain the source of authentication and
   require no schema migration for P0.
3. Existing domain-specific scrapers continue working during rollout.
4. The new central fingerprint policy should be adopted first by the managed
   browser. Migration of legacy workers follows separately to avoid one large
   behavioral change.
5. Hard-coded user-agent use in a worker must be removed or moved behind the
   validated policy before that worker can share managed-browser components.
6. `BrowserManager.getRandomUserAgent()` is considered legacy for authenticated
   browser work and must not be used by the managed browser.
7. Existing Electron persistent partitions must not be opened as Chrome
   `userDataDir` values.
8. Existing `ObserveExecuteExecutor` behavior may be extracted into shared
   types and worker-local executors, but main-process code must not import
   worker entry points.

## 22. Rollout Plan

### Phase 0: Diagnostics and fingerprint correction

1. Inventory all current browser launch paths and user-agent overrides.
2. Add executable-version detection and fingerprint consistency validation.
3. Make native user agent the default for the new path.
4. Define the safe launch-flag allowlist.
5. Add local self-test fixtures and CI tests.
6. Do not enable account-cookie transfer or LLM actions yet.

Exit gate: the managed-browser launch configuration passes consistency and
security tests on Windows, macOS, and Linux packaging targets supported by the
project.

### Phase 1: Authenticated visible browser pilot

1. Add default-enabled browser and cache settings with the release-flag gate.
2. Add account lease and worker lifecycle.
3. Transfer cookies through private validated IPC.
4. Apply cookies before navigation.
5. Add platform verification, same-context manual login, and chat notices.
6. Capture and persist refreshed cookies through the main process.
7. Add disposable profile plus account-isolated resource-cache directories.
8. Add selected/all cache inspection, confirmation, clear, eviction, and safe
   completion notices.
9. Add observe, screenshot, stop, and status UI.
10. Add utility-process heartbeat, disconnect handling, verified process-tree
    cleanup, and application-shutdown integration.

Exit gate: an authorized pilot account can reuse a valid session, complete a
manual handoff when required, close cleanly, and reuse refreshed cookies later
without secret leakage.

### Phase 2: LLM structured control

1. Register deferred browser tools.
2. Add semantic observation and revision-bound references.
3. Add structured action programs and bounded recovery.
4. Integrate approvals, async jobs, progress, cancellation, and audit.
5. Add platform-specific consequential-action descriptions.

Exit gate: the assistant can complete the pilot workflow reliably while the
user can pause, take over, approve, and stop at every required boundary.

### Phase 3: Page-context scripts

1. Add script schema and preview UI.
2. Add page-context execution and result sanitizer.
3. Add write-capability detection and policy integration.
4. Add timeout/page invalidation behavior.
5. Add security and prompt-injection tests.

Exit gate: complex extraction can use scripts without exposing Node, Electron,
cookies, local storage, filesystem, or unrestricted Puppeteer capability.

### Phase 3.5: Optional CAPTCHA provider

1. Add the main-process `CaptchaResolutionPolicy` and domain authorization
   settings.
2. Add disclosure consent/versioning and token-health diagnostics.
3. Add a request-scoped provider service without renderer, LLM, or generic
   worker-environment token exposure.
4. Add bounded challenge correlation, cancellation, timeout, one-attempt limit,
   manual fallback, and safe chat notices.
5. Enable only on controlled fixtures and explicitly authorized non-login
   domains. Social-platform policies remain denied until separately reviewed.

Exit gate: every sensitive or ineligible challenge uses manual handoff, every
eligible provider request is traceable without secrets, and failures cannot
loop or replay an action.

### Phase 4: Platform expansion

Enable each additional platform only after:

- manifest and adapter review;
- authenticated-state fixtures;
- consequential-action mapping;
- rate policy;
- handoff behavior;
- cookie refresh test;
- fingerprint self-test on supported operating systems;
- authorized manual QA account sign-off.

## 23. Testing Requirements

### 23.1 Unit tests

Test:

- fingerprint version matching and mismatch rejection;
- native user-agent default;
- locale, timezone, platform, viewport, and unsafe-flag validation;
- account lease acquisition, reuse, collision, release, and crash release;
- cookie domain revalidation before worker transfer;
- worker message schemas and size limits;
- cookie application counts without secret echo;
- page revision and stale-reference rejection;
- action-program limits, branching, loops, and cancellation;
- page-script length, timeout, output, and sensitive-result rejection;
- approval risk classification;
- prompt-injection strings cannot change policy;
- repeated-action failure threshold;
- safe logging and redaction;
- cookie refresh never replaces a valid snapshot with empty data.
- login-notice transition deduplication and localization keys;
- provider configuration is insufficient without domain authorization and
  current disclosure consent;
- sensitive-flow challenges always select manual handoff;
- challenge IDs enforce one provider submission and one terminal event;
- heartbeat health, missed-heartbeat threshold, idempotent cleanup, and stale
  PID rejection.
- effective enablement precedence: release flag, user setting, AI entitlement,
  dependency, platform, and account;
- default settings, validated cache-size bounds, and runtime toggle behavior;
- opaque cache-scope derivation, Chrome-version segregation, canonical path
  containment, symlink rejection, and active-session locking;
- cache clear idempotency, account/all scoping, deletion-queue recovery,
  least-recently-used eviction, retention, and size accounting;
- account-removal queueing and clear-on-exit restart completion;
- cache clearing never invokes `AccountSessionService.clearAccountSession()` or
  removes account-cookie rows.

### 23.2 Worker integration tests

Use a controlled local test server to verify:

- browser startup and ready handshake;
- cookies are applied before first navigation;
- authenticated fixture state is visible after cookie application;
- observation returns stable roles and references;
- click, fill, wait, navigation, extraction, and screenshot actions;
- stale references after navigation;
- script execution in page context;
- page scripts cannot access Node or Electron;
- popup, dialog, download, and handoff states;
- cancellation during navigation, action, script, and handoff;
- refreshed cookies return to main-process test doubles;
- Chrome closes after normal completion, cancellation, and worker failure.
- missing/invalid cookies enter same-context login handoff;
- **I've finished logging in** triggers verification rather than blind resume;
- CAPTCHA during login always hands off;
- eligible fixture CAPTCHA follows the provider policy and provider failure
  falls back to handoff;
- heartbeat continues while the user controls the browser;
- simulated worker hang and Chrome disconnect leave Electron responsive.
- repeat fixture loading demonstrates cache reuse and cache-disabled cold
  behavior;
- temporary profiles contain cookies/storage and are removed, while only
  validated cache artifacts survive;
- selected-account clear preserves encrypted cookies and forces the following
  fixture load cold;
- an active cache clear is deferred or stops/restarts only after confirmation.

### 23.3 Main-process tests

Place main-process and IPC tests under `test/vitest/main/`. Verify:

- AI enable check occurs before request parsing or browser work for AI-facing
  handlers;
- IPC handlers call `ManagedBrowserModule`, never database repositories;
- cookie values do not enter renderer responses;
- permission decisions block unapproved scripts and consequential actions;
- async jobs are conversation-scoped;
- cancellation reaches the worker client;
- worker crashes release account leases;
- browser status and progress events are bounded and sanitized.
- chat receives exactly one notice per login/challenge/crash transition;
- the provider token never enters worker environment variables, renderer/LLM
  payloads, jobs, audit details, or logs;
- provider policy is evaluated in the main process and cannot be overridden by
  page content or LLM arguments;
- worker exit, error, missed heartbeat, Chrome disconnect, and app shutdown all
  release the same lease through one cleanup path.
- disabled browser preference rejects start before cookie decryption or worker
  creation and returns the settings route;
- cache IPC accepts scope/account identifiers but rejects all renderer paths;
- cache operations use `ManagedBrowserCacheModule`, never direct database access
  or recursive deletion from an IPC handler;
- cache-maintenance worker messages and result sizes are strictly validated.

### 23.4 Component tests

Every new or modified browser UI component requires tests under
`test/vitest/main/components/` covering:

- account selection;
- starting, ready, controlling, handoff, stopping, stopped, and failed states;
- script preview and approval;
- consequential-action preview;
- Pause AI, Take over, Resume AI, and Stop browser interactions;
- login-required, verifying, verified, verification-failed, challenge,
  provider-attempt, manual-fallback, and crash chat notices;
- **I've finished logging in**, **Continue task**, **Extend time**, and
  **Cancel task** behavior;
- default-enabled browser/cache toggles, size display, last-clear status, and
  clear-on-exit control;
- selected-account/all-cache confirmations and active-session choices;
- clear success, empty, deferred, cancelled, partial-failure, and retry states;
- keyboard and accessible-label behavior;
- six-language translation-key parity;
- long account names and narrow layouts.

Run `yarn test:components` as a hard gate.

### 23.5 End-to-end tests

Add Playwright Electron tests under `test/e2e/specs/` for:

1. start a managed browser with a fake account and local platform fixture;
2. show safe session status without cookie values;
3. execute an observed multi-step action flow;
4. require approval before a simulated publish action;
5. hand control to the user fixture and resume;
6. stop the browser and verify no worker or Chrome process remains;
7. restart the app and verify the sanitized refreshed session can be reused;
8. reject a fingerprint mismatch before navigation.
9. start with no cookies, complete fixture login, click **I've finished logging
   in**, verify chat notices, persist the refreshed session, and resume;
10. detect a non-login fixture CAPTCHA, exercise permitted-provider success and
    failure/manual-fallback paths without an external network dependency;
11. crash and hang the worker, verify the main window remains interactive, and
    confirm no lease or verified child process remains.
12. disable the built-in browser, verify its tools cannot start work, re-enable
    it, and verify the user preference survives the release flag changing;
13. warm a fixture cache, verify repeat-load reuse, clear it while preserving
    login cookies, and verify the next load is cold;
14. request clear during an active browser and verify stop/defer/cancel choices
    without unsafe live-directory deletion.

Live third-party platforms must not be required for CI.

### 23.6 Packaging tests

Verify:

- the managed-browser worker is registered in `forge.config.js`;
- the packaged worker resolves required Puppeteer dependencies;
- a compatible browser executable can be discovered or diagnosed;
- packaged paths work on supported operating systems;
- production builds do not expose remote-debugging endpoints;
- no source map or log artifact contains cookie test values.
- app shutdown supervises and terminates active managed-browser utility
  processes and their verified Chrome descendants;
- provider tokens and challenge payload canaries do not appear in packaged logs
  or environment diagnostics.
- cache roots remain within the application-managed cache directory on every
  packaged OS and reject symlinks/path traversal;
- browser-version changes select a new compatible cache namespace and old
  namespaces become eviction candidates.

## 24. Acceptance Criteria

The P0/P1 release is accepted only when all of the following pass:

1. A user can select a saved Tool Account and start one visible managed Chrome
   browser.
2. The browser worker has no database imports or database path resolution.
3. The renderer and LLM never receive cookie values during start, operation,
   failure, or close.
4. A valid stored cookie snapshot is applied before platform navigation.
5. Refreshed cookies return to the main process and are encrypted through
   `AccountSessionService`.
6. An empty or failed refresh does not overwrite the last valid snapshot.
7. The launched browser's actual major version equals the default reported
   user-agent major version because the browser uses its native user agent.
8. A deliberately mismatched configured user agent fails the fingerprint
   self-test before any platform request.
9. The authenticated managed-browser launch path does not use disabled web
   security, ignored certificate errors, or no-sandbox flags in normal desktop
   operation.
10. The user can Pause AI, Take over, Resume AI, and Stop browser.
11. Login CAPTCHA, MFA, password, recovery, security, and passkey flows always
    request user handoff; an eligible non-login CAPTCHA uses a provider only
    after all policy and authorization gates pass.
12. Consequential actions require a correct just-in-time preview and approval.
13. Cancellation closes Chrome and releases the account lease within the normal
    five-second target.
14. Worker crash recovery leaves the Electron application usable and does not
    corrupt the stored session.
15. Component tests, main-process tests, worker tests, and relevant E2E tests
    pass.
16. All new UI text exists in all six supported language files.
17. Missing or invalid cookies open a same-context manual-login handoff and
    generate the complete chat notice lifecycle.
18. Clicking **I've finished logging in** verifies authentication before
    resuming and reports session-persistence success or failure in chat.
19. A worker crash, Chrome crash, or simulated hang leaves Electron responsive,
    releases leases, preserves stored cookies, and produces one sanitized chat
    notice.
20. Configuring a 2Captcha token alone cannot authorize use; domain policy,
    disclosure consent, supported challenge type, and non-sensitive context are
    also required.
21. **Use built-in managed browser** and **Use managed browser cache** default
    to enabled for new settings rows, while the release flag can still block
    starts without rewriting either preference.
22. Disabling the built-in browser prevents worker creation and cookie
    decryption; an active session receives an explicit stop-or-finish choice.
23. Two Tool Accounts never reuse the same persistent cache scope, and a Chrome
    major/cache-format change cannot silently reuse an incompatible namespace.
24. Clearing selected or all managed-browser caches preserves encrypted cookies
    and unrelated application data, rejects caller-provided paths, and reports
    safe deleted-size status.
25. Repeat-load, cache-disabled, eviction, active-session, crash, symlink, and
    packaged-path tests pass on every supported operating system.
26. Removing an account or enabling clear-on-exit prevents its queued cache
    namespace from being reused, even when physical deletion resumes after an
    interrupted shutdown.

The P1 script release is accepted only when:

1. the complete script, account, origin, purpose, timeout, and expected output
   are shown before approval;
2. the script executes only in page context;
3. Node, Electron, filesystem, shell, raw Puppeteer, cookie, and storage-secret
   access are unavailable or blocked;
4. stale revision, timeout, oversized result, cyclic result, and sensitive-result
   cases fail safely;
5. script approval is limited to the current task and origin;
6. a write-capable script receives the appropriate consequential-action
   treatment.

## 25. Success Metrics

Within the pilot cohort and authorized test accounts:

- at least 95% of managed-browser startups reach ready or a clear actionable
  handoff state;
- at least 90% of valid stored-session starts reach an authenticated platform
  state without manual cookie re-import;
- zero cookie values appear in renderer payloads, LLM transcripts, logs, or
  analytics in automated secret-scanning tests;
- zero known orphan Chrome processes remain after normal completion and
  cancellation test suites;
- 100% of deliberately mismatched user-agent/browser-version fixtures fail
  before platform navigation;
- at least 80% of pilot structured browser tasks complete without manual
  selector intervention;
- 100% of MFA, passkey, password, recovery, and ambiguous challenge fixtures
  enter user handoff;
- 100% of login/security CAPTCHA fixtures enter user handoff;
- 100% of eligible provider fixture attempts are single-shot, cancellable, and
  fall back to handoff on failure;
- 100% of simulated publish/delete/send actions request the required approval;
- browser Stop begins immediately and closes within five seconds in at least
  95% of normal test runs.
- zero cross-account cache hits occur in isolation fixtures;
- 100% of cache-clear fixtures preserve the saved cookie snapshot unless the
  user separately chose **Clear login session** or **Clear all browser data**;
- warm repeat-load fixtures show a documented improvement before persistent
  cache is enabled for that platform/browser/OS combination;
- automatic eviction keeps managed-browser cache within the configured global
  bound after its next maintenance pass.

Metrics are diagnostic, not a license to automate around platform protections.

## 26. Risks and Mitigations

### Risk: account suspension or platform enforcement

**Mitigation**: authorized accounts only, conservative defaults, visible
automation, platform-specific rate policies, human challenges, staged rollout,
and no guarantee of undetectability.

### Risk: authenticated session leakage

**Mitigation**: main-process-only decryption, private worker IPC, no renderer or
LLM exposure, strict domain filtering, redacted audit, isolated contexts, and no
persistent Chrome profile in P0/P1.

### Risk: malicious page prompt injection

**Mitigation**: treat page content as data, immutable host policy, risk
classification outside the LLM, origin/account scoping, secret exclusion, and
normal cross-tool permission checks.

### Risk: page-context script abuse

**Mitigation**: page context only, full preview, bounded runtime/output,
sensitive-result rejection, task/origin scope, write classification, and no
Node/Puppeteer execution.

### Risk: stealth changes break websites or increase detection

**Mitigation**: native values by default, one central policy, minimal overrides,
local consistency tests, pinned browser compatibility, and platform rollout
gates.

### Risk: worker or Chrome resource leaks

**Mitigation**: global concurrency budget, cancellation propagation, active
browser registry, five-second heartbeat, three-miss health threshold, one
idempotent supervisor cleanup path, application-shutdown integration, bounded
shutdown, orphan identity validation, and packaging tests.

### Risk: cookies are insufficient for some login sessions

**Mitigation**: same-context manual login, explicit chat notices, verified
resume, refreshed cookie capture, persistence-status reporting, and a separately
reviewed future persistent-profile option rather than silently duplicating
complete browser profiles now.

### Risk: persistent cache exposes authenticated response data

**Mitigation**: treat cache as sensitive local data, isolate by opaque account
scope and Chrome version, respect server cache directives, use restrictive
permissions, exclude cache details from logs/exports, offer clear controls, and
disable persistence when containment tests fail.

### Risk: cache clear removes unrelated or authentication data

**Mitigation**: derive paths only in the main process, validate canonical paths
under a dedicated root, reject symlinks and renderer paths, separate cache from
cookies/profiles/downloads, coordinate active sessions, and test planted files
outside the root remain untouched.

### Risk: cache maintenance freezes Electron or races Chrome

**Mitigation**: use a dedicated maintenance utility process, never delete an
active scope, bound scanning and deletion work, atomically move inactive scopes
to a deletion queue, and make retry/cleanup idempotent.

### Risk: CAPTCHA provider violates expectations or leaks private data

**Mitigation**: login/security challenges are never outsourced; third-party
social platforms default to manual handoff; configured does not mean
authorized; domain policy and versioned disclosure consent are mandatory;
provider requests are request-scoped, data-minimized, single-attempt,
cancellable, secret-redacted, and followed by origin/authentication recheck.

### Risk: CAPTCHA appears after a consequential action

**Mitigation**: mark the action effect as unknown, resolve or hand off, then
re-observe. Never replay publish, send, delete, follow, upload, or purchase
automatically after challenge resolution.

### Risk: external Chrome cannot be embedded in Electron

**Mitigation**: make the visible managed window an explicit product behavior;
keep status, approvals, progress, artifacts, and controls inside Electron. Do
not build a fragile screenshot-streaming pseudo-browser.

## 27. Remaining Product and Rollout Decisions

The technical architecture is specified. These rollout decisions still require
product, security, legal, or platform-owner sign-off:

1. Confirm that an authorized YouTube/Google QA account is available for the
   default pilot; otherwise choose the first platform with an authorized test
   account and equivalent adapter fixtures.
2. Approve distribution size, update cadence, and licensing for the pinned
   Chrome for Testing build and its system-Chrome fallback policy.
3. Decide which non-login domains, if any, receive an approved 2Captcha policy.
   The default allowlist is empty and social platforms are denied.
4. Approve the exact provider data categories and versioned disclosure text for
   each supported challenge type before enabling the provider feature.
5. Decide whether the future persistent-profile option is justified by measured
   cookie-only session failures; it remains out of P0/P1.
6. Approve the remote-AI screenshot disclosure language and the platforms/pages
   on which screenshots remain prohibited.
7. Confirm the supported Windows, macOS, and Linux packaging matrix for the
   worker heartbeat, process-identity, and descendant-cleanup gates.
8. Confirm whether users may raise the cache maximum above the 500 MB default
   in P0 or whether the UI should initially expose only on/off and clear.
9. Confirm the cache-performance threshold and privacy test evidence required
   to enable persistent cache for each pilot platform and operating system.

## 28. Implementation Companion

The implementation-level contracts, algorithms, settings, state machines,
limits, and file plan are defined in the
[Puppeteer-Managed Social Browser Technical Design](./puppeteer-managed-social-browser-technical-design.md),
including:

- exact worker schemas, heartbeat, crash isolation, and state machine;
- default-enabled browser/cache settings and effective gating;
- disposable authentication profile plus account/version resource cache;
- safe cache status, limits, eviction, clearing, and maintenance-worker design;
- same-context manual login and structured AI Chat notices;
- CAPTCHA decision policy and request-scoped provider boundary;
- browser executable resolution and fingerprint validation;
- account leases and secure cookie conversion/persistence;
- tool schemas, action references, scripts, and approvals;
- supervisor cancellation, app shutdown, and verified orphan cleanup;
- platform adapters, UI/IPC contracts, fixtures, packaging, and phased delivery.
