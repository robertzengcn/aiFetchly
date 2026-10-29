# Puppeteer-Managed Social Browser Technical Design

## Document Information

| Field                       | Value                                                                             |
| --------------------------- | --------------------------------------------------------------------------------- |
| Status                      | Proposed                                                                          |
| Date                        | 2026-09-02                                                                        |
| Product                     | AiFetchly                                                                         |
| Owners                      | Desktop, AI Runtime, Social Automation, Security                                  |
| Source PRD                  | [Puppeteer-Managed Social Browser PRD](./puppeteer-managed-social-browser-prd.md) |
| First implementation target | P0 foundation and one-platform pilot                                              |

## 1. Purpose

This document defines the implementation architecture for a visible Chrome
browser that AiFetchly's LLM can operate on authorized social-platform
accounts. It turns the PRD into concrete process boundaries, schemas, state
machines, limits, security controls, file changes, and test gates.

The central decision is:

> Electron remains the application shell. A dedicated Electron utility process
> owns one headed Chrome session controlled by Puppeteer. The main process owns
> accounts, cookie decryption and persistence, permissions, audit, and worker
> lifecycle. The renderer and LLM receive only sanitized observations and
> status.

This is a new managed-browser path. It does not initially rewrite legacy
scrapers or the existing Electron manual-login flow.

## 2. Design Decisions

### 2.1 Resolved PRD decisions

| Topic           | Decision                                                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pilot           | YouTube/Google is the default pilot, subject to an authorized QA account. Its adapter verifies both Google login and YouTube identity.                                          |
| Browser source  | Support a managed, pinned Chrome for Testing build and a validated system Chrome fallback. Never silently download during a browser task.                                       |
| Runtime         | Headed Chrome controlled through Puppeteer 25.x from a dedicated utility process.                                                                                               |
| Browser setting | `managed-browser-enabled` defaults on; effective use also requires the release flag, AI entitlement for AI entry points, platform/account support, and a compatible dependency. |
| Profile         | One unique temporary `userDataDir` and default context per session; the profile is deleted after shutdown and never reused as durable authentication.                           |
| Resource cache  | A separate account-isolated, Chrome-versioned disk cache persists by default for speed; it is independently disableable and clearable without deleting cookies.                 |
| Tabs            | One controlled tab in P0. Popups pause for policy handling. Multi-tab control is P1.                                                                                            |
| User agent      | Native browser user agent by default. An override is exceptional and must match the actual Chrome major version.                                                                |
| Stealth         | `puppeteer-extra-plugin-stealth` is a reviewed compatibility layer, not a promise of invisibility. Evasions that contradict native values are disabled.                         |
| Cookies         | Main decrypts; worker applies; worker returns refreshed cookies; main normalizes, filters, encrypts, and persists.                                                              |
| LLM API         | Small typed tools plus a bounded action-program DSL. Raw Puppeteer, CDP, Node.js, and Electron APIs are not exposed.                                                            |
| Scripts         | Page-context scripts are privileged, exact-source approved, origin scoped, time bounded, and result sanitized. They are not described as a security sandbox.                    |
| Approval        | Publish/send/delete/security changes and every page script are always-confirm, even in `full_access`.                                                                           |
| Long work       | Browser sessions are resources; long action programs run as `ToolJobRegistry` jobs with progress and cancellation.                                                              |
| Screenshots     | Local UI preview is allowed. Sending a screenshot to a remote AI provider requires the existing image disclosure/attachment path and explicit task intent.                      |
| Proxy           | One proxy configuration is fixed for the lifetime of an authenticated session. Direct fallback is never silent. P0 supports direct and HTTP(S) proxy modes.                     |
| Missing login   | Missing, invalid, or expired cookies enter manual-login handoff in the same headed Chrome context; successful verification persists the refreshed session and resumes.          |
| Chat notices    | Login, verification, challenge, resume, crash, and terminal transitions are published as localized, deduplicated structured notices in AI Chat.                                 |
| CAPTCHA         | Sensitive/login challenges always use manual handoff. A configured 2Captcha provider is eligible only for explicitly authorized non-login domains and one bounded attempt.      |
| Isolation       | Exactly one disposable Electron utility process owns each browser session and its Chrome tree; the main process supervises it with heartbeat and idempotent cleanup.            |

### 2.2 Hard invariants

1. A worker never imports a Model, TypeORM, `SqliteDb`, `Token`, or Electron
   `app` API.
2. Only `AccountSessionService` decrypts or persists stored account cookies.
3. Cookie values never cross to the renderer, AI prompt, tool arguments, tool
   results, audit details, analytics, or logs.
4. One account has at most one active managed-browser lease.
5. Every worker message is size-bounded and Zod-validated at the receiving
   boundary.
6. No platform navigation occurs until launch and fingerprint validation pass.
7. The managed browser does not use `--no-sandbox`,
   `--disable-web-security`, `--ignore-certificate-errors`, or a public remote
   debugging endpoint in normal desktop operation.
8. Page text is untrusted data and cannot alter host permission policy.
9. Login, MFA, passkey, password, recovery, security, payment, and ambiguous
   challenges always enter user handoff. An external CAPTCHA provider is
   possible only after main-process policy authorizes a non-sensitive domain
   and challenge.
10. Provider configuration is not provider authorization; token, enabled flag,
    versioned disclosure consent, domain policy, supported type, and an
    attempt budget must all pass.
11. Stop, crash, timeout, missed heartbeat, Chrome disconnect, and app shutdown
    converge on one cleanup path that closes verified child processes and
    releases leases.
12. Puppeteer, browser events, and browser-specific session state never run on
    the Electron main-process event loop.
13. Renderer and LLM requests never supply cache filesystem paths. Only the
    main process derives cache roots and opaque account scopes.
14. Persistent cache directories never contain the durable cookie snapshot,
    temporary profile, downloads, or another account's cache.
15. Cache deletion never runs against an active Chrome scope and never invokes
    account-session deletion.

## 3. Current Repository Baseline

The implementation should extend these existing components:

- [`AccountSessionService`](../../src/modules/AccountSessionService.ts) already
  decrypts, normalizes, applies, captures, and encrypts account-cookie
  snapshots. `persistSnapshot()` already refuses empty replacement.
- [`PlatformSessionManifest`](../../src/modules/PlatformSessionManifest.ts)
  defines platform login URLs and suffix-exact cookie-domain allowlists.
- [`cookieNormalize`](../../src/modules/accountSession/cookieNormalize.ts)
  provides the canonical normalized cookie representation.
- [`SkillWorkerClient`](../../src/service/SkillWorkerClient.ts) demonstrates
  `utilityProcess.fork`, packaged worker-path resolution, request correlation,
  timeout handling, and cleanup.
- [`worker/_shared`](../../src/schemas/worker/_shared.ts) establishes the
  repository convention of discriminated Zod unions and `safeParse` at worker
  boundaries.
- [`ToolJobRegistry`](../../src/service/ToolJobRegistry.ts) provides
  conversation-scoped asynchronous jobs, progress, cancellation, retention,
  and a bounded job count.
- [`AIChatToolApprovalPolicyService`](../../src/service/AIChatToolApprovalPolicyService.ts)
  and `SkillPermissionService` provide existing approval and permission
  integration points.
- [`ObserveExecuteExecutor`](../../src/childprocess/utils/ObserveExecuteExecutor.ts)
  contains reusable lessons for Puppeteer actions, but its selector contract is
  not the new semantic reference contract.
- [`PageStateCapture`](../../src/childprocess/utils/PageStateCapture.ts)
  demonstrates accessibility capture and sanitization, but its raw HTML and
  base64 screenshot payloads are too broad for the normal managed-browser
  observation result.
- [`BrowserManager`](../../src/modules/browserManager.ts) is legacy for this
  path. Its random user-agent and browser installation behaviors must not be
  called by the managed browser.
- [`settinggroupInit`](../../src/config/settinggroupInit.ts) already declares
  `2captcha-enabled` and `2captcha-token`. The managed browser may read these
  only through the main-process settings Module and must add separate domain
  authorization and disclosure-consent state before provider use.
- [`background.ts`](../../src/background.ts) already coordinates bounded worker
  shutdown during `before-quit`. The managed-browser supervisor must join that
  sequence instead of adding an independent quit handler.
- [`SystemSettingGroupModule`](../../src/modules/SystemSettingGroupModule.ts)
  and `SystemSettingModule` provide the required Model/Module route for browser
  and cache preferences. Managed-browser IPC must not access their repositories
  directly.

The repository currently declares Electron 43.4.1, Puppeteer/Puppeteer Core
25.8.x, Puppeteer Extra 3.3.6, Stealth 2.11.2, and Zod 3.24.x. Implementation
must use the installed Zod API rather than assuming Zod 4.

## 4. System Architecture

```text
Vue renderer
  Account picker, session status, approvals, handoff, stop
  NO cookie values, worker handles, CDP endpoints, or raw secrets
             |
             | contextBridge + validated IPC
             v
Electron main process
  managed-browser-ipc.ts       AI-enable gate for AI-facing channels
  ManagedBrowserModule         orchestration and safe API
  ManagedBrowserLeaseService   account/session exclusivity
  AccountSessionService        decrypt + encrypted persistence
  BrowserActionRiskClassifier  host-enforced approval class
  ManagedBrowserWorkerClient   utility process lifecycle
  ManagedBrowserSupervisor     heartbeats, Chrome identity, shutdown
  BrowserChatNoticePublisher   safe AI Chat transition events
  CaptchaResolutionPolicy      main-process eligibility decision
  CaptchaProviderService       request-scoped 2Captcha call
  ManagedBrowserSettingsModule effective browser/cache preferences
  ManagedBrowserCacheModule    trusted scopes, locks, clear orchestration
  ToolJobRegistry              long action programs
             |
             | private utilityProcess messages
             | cookie payload exists only during start/refresh
             v
src/childprocess/managed-browser/
  index.ts                     entry point and message validation
  ManagedBrowserRuntime        state machine and cleanup
  BrowserExecutableResolver    validated executable descriptor
  BrowserFingerprintPolicy     launch plan + self-test
  BrowserObservationService    compact semantic state
  PageReferenceRegistry        revision-bound element handles
  BrowserActionExecutor        typed actions and bounded programs
  PageScriptExecutor           privileged page-context execution
  PlatformBrowserAdapter       login/challenge/action classification
             |
             v
Headed Chrome, isolated temporary profile, one controlled page
  +-- disposable authentication/profile directory
  +-- account/version resource-cache directory
```

### 4.1 Trust boundaries

| Boundary         | Trusted input                                           | Untrusted input                             | Enforcement                                                               |
| ---------------- | ------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------- |
| Renderer to main | Numeric account choice and UI commands after validation | All renderer payloads                       | Strict IPC schemas, sender validation, AI-enabled check                   |
| LLM tool to main | Conversation identity injected by host                  | Tool arguments and page-derived values      | Tool schemas, risk classifier, permission service                         |
| Main to worker   | Main-created session/request IDs                        | Serialized payload after transport          | Inbound Zod union, message byte limit, state validation                   |
| Worker to main   | Nothing implicitly                                      | Page content, URLs, titles, errors, cookies | Outbound Zod union, origin/size checks, redaction, main-side revalidation |
| Worker to page   | Approved action                                         | DOM and page scripts                        | Navigation policy, action limits, handoff and approval gates              |

### 4.2 Process ownership

The main process owns durable and policy state. The worker owns volatile browser
objects. No Puppeteer `Browser`, `Page`, `ElementHandle`, or CDP session crosses
the process boundary.

```text
Main owns                       Worker owns
----------------------------    ------------------------------
accountId                       Browser
lease token                     BrowserContext
conversationId/taskId           Page
permission decisions            PageReferenceRegistry
decrypted cookie handoff        page revision
encrypted cookie persistence    transient returned cookies
worker process handle           runtime cancellation signal
safe audit entries              browser event listeners
trusted cache root/scope        temporary profile + open cache handle
cache settings/active locks     bounded cache-use metrics
```

## 5. Proposed File Layout

```text
src/
  childprocess/managed-browser/
    index.ts
    ManagedBrowserRuntime.ts
    BrowserExecutableResolver.ts
    BrowserFingerprintPolicy.ts
    BrowserObservationService.ts
    PageReferenceRegistry.ts
    BrowserActionExecutor.ts
    PageScriptExecutor.ts
    NavigationPolicy.ts
    ResultSanitizer.ts
    ChallengeDetector.ts
    adapters/
      PlatformBrowserAdapter.ts
      YouTubeBrowserAdapter.ts
  childprocess/managed-browser-cache/
    index.ts
    ManagedBrowserCacheMaintenanceWorker.ts
    CachePathValidator.ts
    CacheEvictionPlanner.ts
  config/
    managedBrowser.ts
    skillsRegistry.ts                         # register deferred AI tools
  entityTypes/
    managedBrowserTypes.ts                    # shared non-secret contracts
  modules/
    ManagedBrowserModule.ts
    ManagedBrowserSettingsModule.ts
    ManagedBrowserCacheModule.ts
  schemas/
    aiTools/managedBrowser.ts
    ipc/managedBrowser.ts
    worker/managedBrowser.ts
  service/
    ManagedBrowserWorkerClient.ts
    ManagedBrowserLeaseService.ts
    ManagedBrowserAiToolService.ts
    BrowserActionRiskClassifier.ts
    ManagedBrowserSupervisor.ts
    BrowserChatNoticePublisher.ts
    CaptchaResolutionPolicy.ts
    CaptchaProviderService.ts
    ManagedBrowserCacheScopeService.ts
  main-process/communication/
    managed-browser-ipc.ts
  views/components/aiChatV2/
    ManagedBrowserSessionCard.vue
    ManagedBrowserApprovalDialog.vue
    ManagedBrowserHandoffDialog.vue
test/
  fixtures/managed-browser-site/
  vitest/utilitycode/managedBrowser/
  vitest/main/managedBrowser/
  vitest/main/components/
  e2e/specs/managedBrowser.test.ts
vite.managedBrowserWorker.config.mjs
vite.managedBrowserCacheWorker.config.mjs
```

`forge.config.js` must register `src/childprocess/managed-browser/index.ts` as a
separate Vite build entry and register the cache-maintenance worker separately.
Shared files used by main and workers must remain free of DB and renderer
imports.

## 6. Shared Domain Types

`src/entityTypes/managedBrowserTypes.ts` contains transport-independent types.
It must contain no cookie-bearing renderer result type.

```ts
export type ManagedBrowserSessionState =
  | "starting"
  | "validating_fingerprint"
  | "applying_session"
  | "verifying_login"
  | "login_required"
  | "user_login_in_progress"
  | "verifying_manual_login"
  | "ready"
  | "running"
  | "awaiting_approval"
  | "challenge_detected"
  | "challenge_resolving"
  | "handoff"
  | "stopping"
  | "stopped"
  | "failed";

export type BrowserRiskClass =
  | "read"
  | "reversible_write"
  | "consequential_write"
  | "credential_or_security"
  | "local_data_delete"
  | "privileged_script";

export interface BrowserExecutableDescriptor {
  readonly path: string;
  readonly source: "managed" | "configured" | "system";
  readonly product: "chrome";
  readonly version: string;
  readonly majorVersion: number;
  readonly architecture: string;
}

export interface SafeManagedBrowserStatus {
  readonly sessionId: string;
  readonly accountId: number;
  readonly platformId: number;
  readonly state: ManagedBrowserSessionState;
  readonly currentOrigin: string | null;
  readonly pageTitle: string | null;
  readonly pageRevision: number;
  readonly authenticated: boolean | null;
  readonly handoffReason: string | null;
  readonly lastErrorCode: ManagedBrowserErrorCode | null;
}

export type BrowserChatNoticeType =
  | "login_required"
  | "login_verifying"
  | "login_verified"
  | "login_verification_failed"
  | "session_persistence_failed"
  | "challenge_detected"
  | "challenge_provider_started"
  | "challenge_resolved"
  | "challenge_failed"
  | "challenge_manual_action_required"
  | "task_resuming"
  | "browser_crashed"
  | "cache_clear_deferred"
  | "cache_clear_completed"
  | "cache_clear_failed";

export interface SafeBrowserChatNotice {
  readonly eventId: string;
  readonly sessionId: string;
  readonly type: BrowserChatNoticeType;
  readonly messageKey: string;
  readonly severity: "info" | "warning" | "success" | "error";
  readonly requiresUserAction: boolean;
  readonly createdAt: string;
}

export interface EffectiveManagedBrowserSettings {
  readonly browserEnabled: boolean;
  readonly cacheEnabled: boolean;
  readonly cacheMaxBytes: number;
  readonly clearCacheOnExit: boolean;
  readonly disabledReasonCode: string | null;
}

export interface SafeManagedBrowserCacheStatus {
  readonly scope: "account" | "all";
  readonly accountId?: number;
  readonly approximateBytes: number;
  readonly lastClearedAt: string | null;
  readonly active: boolean;
  readonly pendingClear: boolean;
}

export interface SafeManagedBrowserCacheClearResult {
  readonly state: "cleared" | "empty" | "deferred" | "cancelled" | "failed";
  readonly scope: "account" | "all";
  readonly approximateDeletedBytes: number;
  readonly savedLoginSessionPreserved: true;
  readonly reasonCode: string | null;
}
```

Account display labels are resolved separately for renderer display. They are
never accepted from the LLM as account authority. Notice payloads contain no
free-form page text. `eventId` is derived from session, transition, and a random
transition nonce; it is not derived from cookies, URLs, or provider data.

## 7. Main-Process Session Orchestration

### 7.1 `ManagedBrowserModule`

`ManagedBrowserModule` is the only application-level entry point. IPC handlers
and built-in AI tools call it; neither calls a Model directly.

```ts
export interface StartManagedBrowserInput {
  readonly accountId: number;
  readonly requestedStartUrl?: string;
  readonly purpose: string;
  readonly conversationId?: string;
}

export interface ManagedBrowserModuleApi {
  start(input: StartManagedBrowserInput): Promise<SafeManagedBrowserStatus>;
  observe(sessionId: string): Promise<BrowserObservation>;
  runActions(input: RunBrowserActionsInput): Promise<BrowserProgramResult>;
  executeScript(input: ExecutePageScriptInput): Promise<PageScriptResult>;
  beginHandoff(sessionId: string): Promise<SafeManagedBrowserStatus>;
  resumeFromHandoff(sessionId: string): Promise<SafeManagedBrowserStatus>;
  stop(sessionId: string, reason: StopReason): Promise<StopResult>;
  getStatus(sessionId: string): SafeManagedBrowserStatus;
  getCacheStatus(accountId?: number): Promise<SafeManagedBrowserCacheStatus>;
  clearCache(
    input: ClearManagedBrowserCacheInput
  ): Promise<SafeManagedBrowserCacheClearResult>;
}
```

Start order is fixed:

1. Check the application release flag, then read effective user browser/cache
   preferences through `ManagedBrowserSettingsModule`.
2. For an AI entry point, check `USER_AI_ENABLED`; reject disabled work before
   account lookup, cookie decryption, or worker creation.
3. Validate input and resolve the account through `SocialAccountModule`.
4. Resolve platform manifest and configured proxy reference.
5. Acquire an account lease and cache-scope active lock.
6. Resolve a compatible browser executable in the main process.
7. Resolve a unique temporary profile and, when enabled and compatible, the
   trusted account/version cache directory.
8. Start a dedicated worker and wait for `WORKER_READY`.
9. Call `AccountSessionService.getDecryptedSnapshot(accountId)`.
10. Revalidate cookie domains against `PlatformSessionManifest`.
11. Send `START_SESSION` with executable, non-secret policy, trusted profile and
    cache configuration, proxy, and cookie
    snapshot.
12. Zero/release the local cookie array reference after the send completes.
13. Wait for `SESSION_READY`, `LOGIN_REQUIRED`, `HANDOFF_REQUIRED`, or a typed
    failure.
14. For missing/invalid cookies or failed authentication, keep the worker and
    same Chrome context alive, publish `login_required`, and wait locally for
    the user's completion action without holding a remote AI stream open.
15. Return a safe status without cookie or cache-path details.

Any failure after lease acquisition enters the same cleanup path.

### 7.2 Account leases

`ManagedBrowserLeaseService` is an in-memory singleton in the main process.

```ts
interface AccountLease {
  readonly accountId: number;
  readonly sessionId: string;
  readonly leaseToken: string;
  readonly acquiredAt: number;
  readonly ownerConversationId: string | null;
}
```

Rules:

- `acquire(accountId, sessionId)` is atomic within the event loop.
- Repeating start from the same conversation returns the active safe status;
  it does not start another Chrome process.
- A different owner receives `account_in_use` with no conversation details.
- `release` requires both `sessionId` and an unguessable `leaseToken`.
- Worker exit, explicit stop, startup timeout, app `before-quit`, and module
  disposal all release the lease.
- P0 has a global limit of one active managed browser, independently of
  `ToolJobRegistry`'s job count.
- A periodic watchdog may identify stale records, but it must first confirm
  that the associated worker client is not live.

The lease spans manual login and CAPTCHA handoff. It is not released merely
because AI control is paused. Handoff timeout, cancellation, crash, or stop
releases it through the supervisor cleanup path.

### 7.3 AI enable gate

Every AI-facing IPC handler must begin by reading `USER_AI_ENABLED` through
`Token`, before parsing request data or starting work. UI-only account login or
manual browser management may use separate non-AI channels. The built-in AI
tool path must perform the same entitlement check inside
`ManagedBrowserAiToolService`, because tool execution does not necessarily pass
through renderer IPC.

### 7.4 Browser and cache settings

`ManagedBrowserSettingsModule` uses `SystemSettingModule` for data access and
normalizes missing/legacy values. Proposed settings under a new
`managed-browser-group` are:

```text
managed-browser-enabled = "1"                 # toggle, default true
managed-browser-cache-enabled = "1"           # toggle, default true
managed-browser-cache-max-size-mb = "500"     # integer, clamp 100..2048
managed-browser-cache-clear-on-exit = "0"      # toggle, default false
```

The module returns `EffectiveManagedBrowserSettings`; IPC and tools never read
the Model or setting rows directly. The release flag is evaluated separately
and takes precedence without mutating stored user values.

`browser_start_session` returns `managed_browser_disabled` before cookie access
or process creation when the effective browser setting is off. Tool-catalog
loading should omit or mark the browser tools unavailable, but every tool still
checks at execution time so a previously loaded schema cannot bypass a runtime
toggle.

Turning the browser setting off while a session is active records the new
preference immediately but does not kill the session. The UI requests
`finish_active`, `stop_now`, or `cancel_setting_change`; `stop_now` uses normal
supervisor cleanup. Cache-setting changes affect new sessions. Turning cache
off never deletes existing bytes automatically; the user may clear them
separately.

## 8. Worker Protocol

### 8.1 Transport rules

- Transport: Electron `utilityProcess.fork` and `postMessage`.
- Encoding: structured object where reliable; JSON string is accepted only for
  compatibility and is parsed before schema validation.
- Protocol version: integer `1` on every message.
- Correlation: `sessionId`, `requestId`, and monotonic `sequence`.
- Maximum inbound/outbound serialized size: 2 MiB generally; 8 MiB only for a
  separately typed screenshot response.
- Unknown fields are rejected with strict Zod objects.
- Malformed messages are dropped and counted. Three malformed messages stop the
  session as `worker_protocol_violation`.
- Raw validation errors are never echoed when their input could contain cookie
  values.

### 8.2 Main-to-worker union

`src/schemas/worker/managedBrowser.ts` defines strict discriminated schemas:

```text
START_SESSION
OBSERVE
RUN_ACTIONS
EXECUTE_PAGE_SCRIPT
BEGIN_HANDOFF
RESUME_HANDOFF
VERIFY_MANUAL_LOGIN
CAPTURE_SCREENSHOT
APPLY_CHALLENGE_RESPONSE
CANCEL_REQUEST
STOP_SESSION
```

The secret-bearing `START_SESSION` schema contains:

```ts
interface StartSessionPayload {
  readonly protocolVersion: 1;
  readonly type: "START_SESSION";
  readonly sessionId: string;
  readonly requestId: string;
  readonly executable: BrowserExecutableDescriptor;
  readonly launchPolicy: BrowserLaunchPolicy;
  readonly storagePolicy: WorkerBrowserStoragePolicy;
  readonly platform: WorkerPlatformDefinition;
  readonly proxy: WorkerProxyConfig | null;
  readonly cookies: readonly NormalizedCookie[];
}
```

It must not include an account display name, database path, encryption key,
Electron partition, conversation transcript, or permission grant.

### 8.3 Worker-to-main union

```text
WORKER_READY
WORKER_HEARTBEAT
SESSION_STATE_CHANGED
SESSION_READY
LOGIN_REQUIRED
OBSERVATION_RESULT
ACTION_PROGRESS
ACTION_RESULT
SCRIPT_RESULT
SCREENSHOT_RESULT
HANDOFF_REQUIRED
CHALLENGE_DETECTED
CHALLENGE_RESPONSE_APPLIED
REFRESHED_COOKIES
REQUEST_CANCELLED
SESSION_STOPPED
WORKER_ERROR
```

`REFRESHED_COOKIES` is the only outbound message that may carry cookie values.
The client routes it directly to a private handler; it is not stored in a
generic event list and is never forwarded to the renderer.

`CHALLENGE_DETECTED` carries a random challenge ID, origin, sensitivity
classification evidence codes, supported-type code, and bounded provider input
descriptor. It carries no cookies, authorization headers, surrounding HTML,
credentials, or complete private URL. `APPLY_CHALLENGE_RESPONSE` is a private,
ephemeral main-to-worker message and is never a tool or renderer contract.

### 8.4 Worker client lifecycle

Unlike `SkillWorkerClient`, each managed-browser session gets its own
`ManagedBrowserWorkerClient`. It maintains:

- one utility-process handle;
- pending requests keyed by request ID;
- an `AbortController` per request;
- last accepted sequence number;
- startup, graceful-stop, and forced-kill timers;
- last heartbeat time, worker PID, and validated Chrome process identity;
- a single cleanup promise so concurrent stop paths are idempotent.

Timing defaults:

| Operation                       |                                 Limit |
| ------------------------------- | ------------------------------------: |
| Worker ready                    |                            10 seconds |
| Chrome launch and self-test     |                            30 seconds |
| Initial cookie application      |                            15 seconds |
| Initial verification            |                            45 seconds |
| Single action                   |                            15 seconds |
| Navigation action               |                            45 seconds |
| Observe                         |                            10 seconds |
| Page script                     | 5 seconds default, 15 seconds maximum |
| Graceful stop                   |                             5 seconds |
| Forced kill after graceful stop |                  2 additional seconds |
| Worker heartbeat                |                       every 5 seconds |
| Unresponsive threshold          |        3 missed heartbeats/15 seconds |
| Manual-login handoff            |     10 minutes, explicitly extendable |
| Provider resolution attempt     |      120 seconds maximum, one attempt |

On unexpected exit, pending requests reject with `worker_exited`, the module
releases its lease, and the renderer receives one sanitized failure event.

### 8.5 Supervisor and crash containment

`ManagedBrowserSupervisor` owns all live `ManagedBrowserWorkerClient`
instances. The worker is disposable: one utility process serves one browser
session and is never reused for another account. Puppeteer launches Chrome from
that utility process, so browser automation, DOM processing, page scripts, and
Chrome event handling cannot block or crash the Electron main-process event
loop.

The worker reports this bounded identity after Chrome launch:

```ts
interface ManagedBrowserProcessIdentity {
  readonly sessionId: string;
  readonly sessionNonce: string;
  readonly workerPid: number;
  readonly browserPid: number;
  readonly executableSha256: string;
  readonly executableVersion: string;
  readonly launchedAtEpochMs: number;
}
```

The main compares executable identity with the descriptor it supplied. Process
identity is held only in memory. PID alone is never enough for orphan cleanup
because operating systems reuse PIDs.

The worker sends `WORKER_HEARTBEAT` every five seconds from a timer independent
of page navigation and handoff. It contains only session ID, monotonic sequence,
runtime state, event-loop lag bucket, and timestamp. Three missed heartbeats
transition the session to `failed/unresponsive` and invoke cleanup. A delayed
heartbeat that arrives after cleanup begins cannot revive the session.

All terminal signals call the same memoized `cleanup(sessionId, cause)` promise:

```text
explicit stop | cancellation | worker error/exit | Chrome disconnected
protocol violation | missed heartbeat | startup failure | app before-quit
                               |
                               v
reject new commands and mark current effect known/unknown
cancel ToolJobRegistry work and pending provider request
request refreshed cookies only when worker/Chrome are healthy and time remains
send STOP_SESSION and wait up to 5 seconds
kill utility process after 2 additional seconds
verify process identity before any descendant/orphan termination
release account/global leases in finally
publish exactly one terminal chat/status event
```

Electron `before-quit` calls `ManagedBrowserSupervisor.shutdownAll()` after
async tool jobs are signalled and within a single global deadline. It does not
wait indefinitely for login, provider work, cookie capture, or page scripts.

Automatic restart is prohibited after a crash when the last action was
consequential or its effect is unknown. A fresh session requires re-observation
and, where applicable, a new user approval.

## 9. Runtime State Machine

```text
created
  -> starting
  -> validating_fingerprint
  -> applying_session
  -> verifying_login
       -> ready
       -> login_required -> user_login_in_progress
              -> verifying_manual_login -> ready
              -> user_login_in_progress (verification failed)
       -> handoff -----------------------------------+
  ready -> running -> ready           |
  ready/running -> awaiting_approval  |
  awaiting_approval -> running/ready  |
  ready/running -> challenge_detected
       -> challenge_resolving -> verifying_login/ready
       -> handoff
  handoff -> verifying_login <-----------------------+
  any live state -> stopping -> stopped
  any live state -> failed -> stopping -> stopped
```

State guards:

- Only `START_SESSION` is valid after `WORKER_READY` and before a session.
- Observe is allowed in `ready`, `running`, `awaiting_approval`, and `handoff`.
- Actions are allowed only in `ready` or `running` and when AI control is not
  paused.
- Scripts are allowed only after main-side approval and in `ready`.
- During login, challenge resolution, or handoff, LLM actions are rejected with
  `user_has_control` or `challenge_in_progress`.
- Stop is valid and idempotent in every state.
- A request with the wrong session ID or a stale sequence is rejected.

The worker emits state changes, but the main process is the authoritative
source for renderer-visible session state because it also knows approval and
worker lifecycle state.

## 10. Browser Executable Resolution

### 10.1 Resolution order

`BrowserExecutableResolver` returns a descriptor, not just a path:

1. An administrator-configured executable that passes validation.
2. AiFetchly's managed Chrome for Testing cache at the pinned revision.
3. A supported system Chrome discovered through platform-specific known paths.
4. A typed `browser_dependency_missing` diagnostic.

No download occurs inside `start()`. Installation/update is a separate,
user-visible system-dependency operation using the existing diagnostics and
installer architecture. The managed browser should add a catalog entry such as
`chrome-for-testing-managed` rather than teach `BrowserManager` to download on
demand.

### 10.2 Version policy

- Pin a tested Chrome for Testing build in a JSON dependency catalog shipped
  with the app.
- Store expected SHA-256, platform, architecture, archive type, and executable
  relative path.
- Verify checksum before extraction and executable version after extraction.
- Maintain a tested compatibility tuple of AiFetchly, Puppeteer, Chrome major,
  and stealth-plugin version.
- Permit system Chrome only if launch and self-test succeed with the packaged
  Puppeteer version.
- Cache the last validated descriptor for one app run, invalidated by file
  metadata or version changes.
- Updates are staged, tested, and atomically promoted. Keep one last-known-good
  managed build for rollback.

### 10.3 Path safety

The main resolves canonical paths and rejects directories, symlinks escaping a
managed install root, non-executable files, and unexpected product strings.
The worker independently verifies that the passed path exists and reports the
version actually launched.

## 11. Launch and Fingerprint Policy

### 11.1 Launch policy

```ts
interface BrowserLaunchPolicy {
  readonly headless: false;
  readonly locale: string | null;
  readonly timezoneId: string | null;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly windowSize: { readonly width: number; readonly height: number };
  readonly userAgentOverride: string | null;
  readonly enabledStealthEvasions: readonly string[];
  readonly extraArgs: readonly string[];
}
```

Defaults:

- `headless: false`;
- native user agent;
- native platform, GPU, plugins, hardware concurrency, device memory, touch,
  and WebGL values;
- app-selected locale only when it is a valid configured locale;
- no timezone override unless the account/proxy has a user-confirmed IANA
  timezone;
- 1365x768 viewport inside a 1400x900 window, clamped to the active display;
- no randomization between starts for the same task;
- stealth evasions limited to a reviewed allowlist.

Unsafe Chromium flags are denied after all launch arguments are composed. An
allowlist is preferable to substring removal. Platform-required arguments must
be reviewed and tested on each OS.

### 11.2 Self-test algorithm

The worker opens `about:blank`, before any platform URL, and collects:

```ts
interface FingerprintSelfTestEvidence {
  readonly browserVersion: string;
  readonly browserMajor: number;
  readonly userAgent: string;
  readonly userAgentMajor: number | null;
  readonly platform: string;
  readonly language: string;
  readonly languages: readonly string[];
  readonly timezone: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly screen: { readonly width: number; readonly height: number };
  readonly webdriver: boolean | null;
}
```

Validation fails before navigation when:

- product is not the permitted Chrome product;
- an override's Chrome major differs from the executable major;
- locale values contradict an explicit policy;
- timezone differs from an explicit verified timezone;
- viewport exceeds the visible window/screen bounds;
- a denied launch flag is active;
- the worker launched a different executable/version than the main resolved.

The safe result exposes only pass/fail and bounded reason codes. Full evidence
may be stored in local debug diagnostics with no account or cookie data.

### 11.3 Stealth policy

Stealth is defense-in-depth compatibility, not a goal of bypassing platform
protections. The managed path must not:

- set a hard-coded Windows GPU or platform on macOS/Linux;
- replace `Object.prototype` or broad browser prototypes;
- randomize UA independently of Chrome;
- fabricate plugin/language/hardware values that contradict native values;
- hide or automate login/security CAPTCHA or MFA challenges through stealth
  behavior; the separately authorized provider path in §18.3 is not a stealth
  evasion;
- alter TLS behavior or ignore certificate errors.

Every enabled evasion requires a fixture test and an owner. A plugin upgrade is
treated as a browser-compatibility change and passes the same rollout gates.

## 12. Proxy and Network Policy

### 12.1 Proxy contract

```ts
type WorkerProxyConfig =
  | { readonly mode: "direct" }
  | {
      readonly mode: "http" | "https";
      readonly host: string;
      readonly port: number;
      readonly username?: string;
      readonly password?: string;
    };
```

Proxy credentials are secret main-to-worker fields. They follow the same
no-log rule as cookies. P0 does not support authenticated SOCKS because Chrome
authentication behavior and DNS-leak guarantees require a separate design.

The proxy is fixed at browser launch. A failed proxy returns
`proxy_unavailable`; it does not fall back to direct access unless the user
approves a new session. The worker runs a controlled connectivity check before
platform navigation. CI uses a local proxy fixture; production does not depend
on a third-party IP-check service.

### 12.2 Navigation policy

`NavigationPolicy` evaluates every explicit navigation, popup, redirect chain,
and script-requested destination:

- allow `https:` and limited `http:` only for loopback test fixtures in
  development/test mode;
- reject `file:`, `data:`, `javascript:`, `blob:` top-level navigation,
  `chrome:`, `devtools:`, extension URLs, and custom schemes;
- resolve DNS through `PuppeteerSsrfGuard`-equivalent logic and block loopback,
  link-local, private, multicast, metadata, and rebinding targets;
- allow login/SSO origins declared by the platform adapter;
- pause on an unexpected cross-origin popup or redirect and request a policy
  decision;
- revalidate the final URL after navigation.

Page subresources are governed by normal Chrome policy in P0. A later strict
request interceptor may block known dangerous destinations, but must not break
the platform's authenticated flows without adapter tests.

## 13. Cookie Handoff and Refresh

### 13.1 Storage-to-Puppeteer conversion

The main reads `NormalizedCookie[]`, re-applies the platform domain matcher,
and sends only accepted cookies. The worker maps them to Puppeteer cookie data:

| Normalized field                              | Puppeteer behavior                                                                       |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `name`, `value`, `path`, `secure`, `httpOnly` | Preserve                                                                                 |
| `domain`                                      | Preserve normalized host; omit only for a host-only cookie when a URL can be constructed |
| `expirationDate`                              | Map to `expires`; omit for a session cookie                                              |
| `sameSite: no_restriction`                    | Map to `None`                                                                            |
| `sameSite: lax/strict`                        | Map to `Lax`/`Strict`                                                                    |
| `sameSite: unspecified`                       | Omit and let Chrome use native behavior                                                  |
| `hostOnly`                                    | Construct an origin URL and avoid converting it to a domain cookie                       |

Cookies are applied to the isolated browser context before the first platform
navigation. Each cookie is attempted independently. The worker reports only
`appliedCount`, `rejectedCount`, and safe reject-reason tallies.

### 13.2 Authentication verification

After cookie application, the worker navigates to the adapter's verification
URL. The adapter returns:

```ts
type AuthenticationAssessment =
  | {
      readonly state: "authenticated";
      readonly evidenceCodes: readonly string[];
    }
  | {
      readonly state: "unauthenticated";
      readonly evidenceCodes: readonly string[];
    }
  | { readonly state: "challenge"; readonly challenge: ChallengeKind }
  | { readonly state: "unknown"; readonly reasonCode: string };
```

Evidence codes describe stable UI/URL signals without copying private page
text. For YouTube, the adapter may use account/avatar controls and absence of a
sign-in call-to-action, plus Google login redirect detection. One signal alone
must not declare authentication if it is ambiguous.

An unauthenticated assessment caused by missing, invalid, expired, or rejected
cookies enters `login_required`; it does not stop the worker. The user completes
login in the existing visible Chrome context so cookies, local storage,
IndexedDB, service workers, and device-bound in-memory state created during
login remain attached to the page the LLM will later operate.

The worker observes only navigation, origin, challenge, and adapter
authentication signals during login. It does not capture input values or send
page screenshots. When the user clicks **I've finished logging in**, main sends
`VERIFY_MANUAL_LOGIN`. The worker increments the page revision, checks final
origin, runs the adapter assessment, and returns one of:

```ts
type ManualLoginVerificationResult =
  | { readonly state: "verified"; readonly evidenceCodes: readonly string[] }
  | { readonly state: "not_verified"; readonly reasonCode: string }
  | { readonly state: "challenge"; readonly challengeKind: ChallengeKind }
  | { readonly state: "wrong_account"; readonly reasonCode: string };
```

`verified` triggers refreshed-cookie capture and persistence before AI resume.
If capture or persistence fails, the current browser may remain usable, but the
chat notice explicitly reports `sessionSaved: false`. `not_verified`,
`challenge`, and `wrong_account` keep user control. The system never binds an
ambiguous account silently.

The worker may detect strong login-completion evidence before the click, but it
only enables/prompts the completion control. Explicit verification still owns
the state transition. Manual-login handoff expires after ten minutes, with a
warning and explicit extension option; expiry stops the local session without
holding a remote model stream.

### 13.3 Refreshed-cookie persistence

Capture occurs after successful verification, after a meaningful navigation
that may renew authentication, and during graceful stop. It is debounced so no
more than one refresh is sent per 30 seconds.

Flow:

1. Worker calls the Puppeteer context cookie API.
2. Worker filters domains against its immutable platform definition.
3. Worker sends `REFRESHED_COOKIES` privately.
4. Main validates schema and re-filters domains.
5. Main calls `AccountSessionService.persistSnapshot()` with source
   `worker_refresh` and the account's existing partition identifier.
6. Main acknowledges only success/counts or a safe error code.

Empty snapshots, validation failures, key failure, or persistence failure leave
the previous encrypted snapshot unchanged. Cookie objects are discarded after
acknowledgement. JavaScript cannot guarantee memory zeroization, so the design
minimizes lifetime and references instead of claiming perfect erasure.

### 13.4 Storage separation

Persistent caching changes the original incognito-context plan. P0 launches one
Chrome instance per session with a unique temporary `userDataDir` and uses its
default context. Because one disposable utility process and account lease own
that Chrome instance, the default context remains account-isolated while
allowing Chrome's external disk-cache directory to work predictably.

```text
OS temporary directory
  aifetchly-managed-browser/<sessionId-random>/profile/
    cookies, local storage, IndexedDB, service workers, history, permissions
    -> deleted after worker/Chrome shutdown

Electron application cache directory
  managed-browser-cache/v1/<opaqueAccountScope>/<cacheNamespace>/http-cache/
    eligible Chrome HTTP resource cache only
    -> retained, bounded, versioned, and user-clearable
```

The managed browser never points Chrome at the Electron partition, the user's
external Chrome profile, or a persistent per-account profile. Downloads use a
third separately approved directory and are not part of either cache clear.

`WorkerBrowserStoragePolicy` contains main-derived absolute paths but never
crosses to renderer or LLM:

```ts
interface WorkerBrowserStoragePolicy {
  readonly temporaryProfilePath: string;
  readonly persistentCache:
    | { readonly enabled: false; readonly reasonCode: string }
    | {
        readonly enabled: true;
        readonly cachePath: string;
        readonly scopeToken: string;
        readonly namespace: string;
      };
}
```

The worker verifies both paths against main-supplied roots before launch. It
passes the temporary profile as Puppeteer's `userDataDir` and the persistent
cache through the reviewed Chrome disk-cache launch option. It must not add
flags that persist credentials, autofill, passwords, or permissions.

### 13.5 Cache root and opaque account scope

`ManagedBrowserCacheScopeService` runs in the main process. It obtains an
application cache root from an injected Electron cache-path resolver and
creates only this subtree:

```text
<app-cache>/aifetchly/managed-browser-cache/v1/
```

The stable account directory name is an HMAC of
`managed-browser-cache:v1:<accountId>` using an installation/user secret already
available to the main process, truncated to a filesystem-safe opaque token. A
raw account ID, email address, platform username, or account display name never
appears in the path. If the key is unavailable, persistent cache fails off for
that session; it does not fall back to a readable identifier.

The cache namespace includes Chrome major version, platform, architecture, and
an AiFetchly cache-schema version, for example:

```text
chrome-136-linux-x64-schema-1
```

An incompatible browser or schema selects a fresh namespace. Old inactive
namespaces become eviction candidates and are never silently reused.

Path validation occurs in both main and maintenance worker:

1. resolve the configured cache root to a canonical absolute path;
2. reject an empty, filesystem-root, home, user-data, workspace, or temporary
   profile root;
3. accept only generated opaque scope and namespace segments;
4. reject `..`, separators inside segments, alternate data streams, device
   paths, and embedded nulls;
5. inspect every existing path component and reject symbolic links or other
   link-like redirections;
6. confirm the final canonical parent remains inside the exact managed root;
7. never follow a caller-provided glob or recursively delete the root itself.

### 13.6 Cache ownership and locking

`ManagedBrowserCacheModule` holds an in-memory active-scope registry tied to
the account lease. Exactly one Chrome process may open an account/namespace
cache path. Maintenance operations receive a snapshot of active scope tokens
and must skip them.

The worker reports `CACHE_OPENED` only after Chrome launches with the expected
path and `CACHE_RELEASED` after Chrome exits and file handles are closed. Main
does not consider a scope inactive merely because a page closed. Worker crash
cleanup waits for verified Chrome termination before releasing the cache lock.

At startup, stale in-memory locks do not survive. AiFetchly checks its managed
process registry and directory metadata; it never kills or unlocks a process
based on a cache path alone.

### 13.7 Cache metadata and limits

Each namespace has a small atomic metadata file containing only:

```ts
interface ManagedBrowserCacheMetadata {
  readonly schemaVersion: 1;
  readonly namespace: string;
  readonly approximateBytes: number;
  readonly lastUsedAtEpochMs: number;
  readonly lastClearedAtEpochMs: number | null;
  readonly lastChromeMajor: number;
}
```

It contains no account ID, URL, hostname, cookie, header, response identifier,
or filename inventory. Metadata is advisory: the maintenance worker computes a
bounded size scan when accurate status is required and writes updates
atomically.

Defaults:

- cache enabled: true;
- global maximum: 500 MiB, user range 100-2048 MiB;
- per-account target: 200 MiB;
- inactive retention target: 30 days;
- automatic maintenance: app startup after the UI is ready, then at most once
  per 24 hours;
- eviction: least-recently-used inactive account/version namespaces first;
- active scopes: never evicted;
- maintenance concurrency: one worker and one deletion at a time.

Chrome's own cache-control behavior remains authoritative. AiFetchly does not
intercept and store response bodies itself, does not override `no-store`, and
does not create an application-level authenticated-response cache.

### 13.8 Clear-cache orchestration

Renderer/UI schemas accept only:

```ts
type ClearManagedBrowserCacheInput =
  | {
      readonly scope: "account";
      readonly accountId: number;
      readonly activeSessionDecision: "stop_and_clear" | "defer" | "cancel";
      readonly confirmationId: string;
    }
  | {
      readonly scope: "all";
      readonly activeSessionDecision:
        | "stop_and_clear"
        | "skip_active"
        | "cancel";
      readonly confirmationId: string;
    };
```

The AI tool is narrower: it may request only its current session's account
scope and requires local-data-deletion confirmation. It cannot request `all`.

Clear flow:

1. Main validates confirmation, scope, account authority, and current settings.
2. `ManagedBrowserCacheModule` derives the trusted path; it ignores/rejects any
   unknown input field or path.
3. If active, follow the explicit decision: normal stop then clear, record a
   pending clear after close, skip active for all-scope, or cancel.
4. After Chrome exits, acquire an exclusive maintenance lock.
5. Revalidate the source directory and atomically rename it inside the managed
   root to `deleting/<random-operation-id>`.
6. Recreate an empty account namespace only when needed by a later session.
7. Send the exact managed root and deletion-queue entry to the dedicated cache
   maintenance utility process.
8. The worker independently validates containment and removes only that entry.
9. Return approximate deleted bytes and `savedLoginSessionPreserved: true`.

Cancellation is accepted until step 5. After the atomic rename, the user-facing
operation is logically complete and physical deletion continues in the
maintenance worker. A crash during deletion leaves a recognizable deletion
queue entry that the next maintenance pass resumes. Repeating clear on an empty
scope returns `empty` with zero bytes.

`Clear selected account cache`, `Clear all managed-browser caches`,
`Clear saved login session`, and `Clear all browser data` are distinct commands.
Only the latter two may call account-session clearing, and they require their
own stronger confirmation.

When clear-on-exit is enabled, `before-quit` first closes managed Chrome
sessions, then atomically moves eligible cache namespaces into the deletion
queue. The maintenance worker deletes until the global shutdown deadline.
Entries remaining after that deadline stay quarantined and are deleted at the
next startup before they can be selected for reuse.

Tool Account removal calls `ManagedBrowserCacheModule.queueAccountRemoval()`
only after the account/session deletion transaction succeeds. Cache deletion is
best effort and retryable; it cannot roll back, restore, or corrupt the removed
account. A missing key/scope mapping is handled by bounded orphan-namespace
retention and later eviction rather than a broad directory delete.

### 13.9 Cache maintenance worker protocol

The cache worker lives under `src/childprocess/managed-browser-cache/`, has no
database imports, and receives a strict Zod union:

```text
SCAN_SCOPE
SCAN_ALL
DELETE_QUEUED_SCOPE
PLAN_EVICTION
CANCEL_BEFORE_DELETE
SHUTDOWN
```

Results contain byte/file counts, duration buckets, scope tokens, and safe
error codes only. They never contain filenames or URLs. Scans have entry,
depth, byte-counter, wall-time, and message-size limits. The worker refuses to
delete an active scope list supplied by main and performs its own link and root
validation.

The main process never performs a large recursive scan or deletion itself. If
the maintenance worker crashes, browser operation continues with cache
temporarily unavailable for maintenance; the supervisor returns a retryable
error and preserves the deletion queue.

### 13.10 Performance and containment release gate

Persistent cache is enabled for a platform/browser/OS tuple only after an
integration fixture proves:

1. a repeat page load obtains cache hits or a documented load-time/byte
   improvement;
2. disabling cache produces the expected cold behavior;
3. two accounts never share a cached resource;
4. cookies, local storage, IndexedDB, service workers, history, permissions,
   autofill, and credential state remain in the temporary profile;
5. shutdown deletes the temporary profile after Chrome exits;
6. clearing cache preserves the encrypted cookie snapshot and next login state;
7. a cache-version change selects a different namespace;
8. symlink, path traversal, active-lock, crash, and interrupted-deletion tests
   fail safely.

If containment fails, the effective cache setting becomes disabled with a safe
compatibility reason for that tuple, while the user's stored preference remains
unchanged.

## 14. Observation Model

### 14.1 Safe observation result

```ts
interface BrowserObservation {
  readonly sessionId: string;
  readonly pageRevision: number;
  readonly url: string; // query and fragment redacted when sensitive
  readonly origin: string;
  readonly title: string;
  readonly state: "ready" | "loading" | "dialog" | "handoff";
  readonly elements: readonly BrowserElementSummary[];
  readonly visibleText: string;
  readonly notices: readonly BrowserNotice[];
  readonly truncated: boolean;
}

interface BrowserElementSummary {
  readonly ref: string;
  readonly role: string;
  readonly name: string;
  readonly valueSummary?: string;
  readonly disabled: boolean;
  readonly checked?: boolean;
  readonly selected?: boolean;
  readonly hrefOrigin?: string;
}
```

Default budgets:

- 120 interactive elements;
- 12,000 characters of visible text;
- 200 characters per accessible name;
- 100 characters per safe value summary;
- 64 KiB serialized result;
- password, token, hidden, cookie, authorization, and suspected secret values
  are replaced by a type marker rather than returned.

Raw HTML is not part of routine observation. The service prefers accessibility
roles, labels, names, current state, and visible text. Page content is prefixed
in the AI result as untrusted external content.

### 14.2 Page revision

The worker maintains an integer `pageRevision`, starting at 1. It increments on:

- main-frame navigation or history state that changes document identity;
- main-frame reload;
- controlled tab replacement;
- user handoff completion;
- a material DOM invalidation detected after an action program step;
- any explicit registry reset.

Element references are valid only for the revision that produced them.

### 14.3 Reference registry

`PageReferenceRegistry` stores `ref -> ElementHandle` only inside the worker.
Refs are opaque random identifiers such as `e_7q3m2k`, not selectors. Each entry
stores revision, role/name fingerprint, frame identity, creation time, and weak
geometry. The registry:

- clears and disposes handles on revision change;
- caps entries at 200;
- expires after 60 seconds;
- rejects detached nodes;
- compares role/name before action to reduce wrong-target clicks;
- never returns CSS/XPath as a stable promise.

An action supplies both `ref` and `pageRevision`. Mismatch returns
`stale_page_reference` and includes a fresh compact observation.

## 15. Browser Tool Surface

The tools are deferred built-ins in `skillsRegistry.ts` with permission
category `automation` and explicit runtime risk checks.

| Tool                           | Purpose                                  | Default execution             |
| ------------------------------ | ---------------------------------------- | ----------------------------- |
| `browser_start_session`        | Start/attach to an account-bound session | async startup                 |
| `browser_get_status`           | Read safe status                         | synchronous                   |
| `browser_observe`              | Obtain semantic page state               | browser timeout               |
| `browser_run_actions`          | Execute a bounded typed program          | async when multi-step         |
| `browser_capture_screenshot`   | Local preview or approved AI attachment  | browser timeout               |
| `browser_execute_page_script`  | Privileged page-context logic            | always confirm                |
| `browser_request_handoff`      | Pause AI and give user control           | synchronous control           |
| `browser_resume_after_handoff` | Re-verify and resume                     | browser timeout               |
| `browser_clear_cache`          | Clear current account resource cache     | always confirm/local deletion |
| `browser_stop_session`         | Capture refresh and close                | browser timeout               |

Every tool requires `session_id` after start. Account IDs cannot be switched
inside an active session.

`browser_clear_cache` is restricted to the account already bound to the
session, displays approximate size and saved-login preservation, and cannot
select `all` or accept a path. Approval expires when session/account/cache
status changes.

### 15.1 Action schema

P0 actions:

```text
navigate(url)
click(ref, page_revision)
fill(ref, page_revision, value)
select(ref, page_revision, values[])
press_key(key)
scroll(direction, amount)
wait_for(condition, timeout_ms)
extract(refs[])
```

P1 adds:

```text
if(condition, then[], else[])
repeat(max_iterations, until, actions[])
handle_dialog(decision)
switch_tab(tab_ref)
close_tab(tab_ref)
```

Limits:

| Limit                       |                 P0/P1 value |
| --------------------------- | --------------------------: |
| Actions per program         |                          25 |
| Nested depth                |                           3 |
| Repeat iterations           | 20 default, 50 hard maximum |
| Total executed steps        |                         100 |
| Program wall time           |                 240 seconds |
| Extracted items             |                         200 |
| Extracted serialized output |                     256 KiB |
| Consecutive failures        |                Stop after 3 |

Programs are not general JavaScript. Conditions may inspect only safe
observation fields, URL/origin, element presence/state, and prior bounded
action results.

### 15.2 Action execution rules

- Revalidate session state, page revision, element, and risk before each step.
- Scroll the target into view and check visibility/interactability.
- Prefer trusted Puppeteer input events. DOM `.click()` fallback is disabled
  for consequential actions.
- `fill` clears safely, types with Puppeteer, and never echoes sensitive input.
- Password, one-time-code, card, secret, and recovery fields force handoff.
- Navigation waits use bounded `domcontentloaded` plus adapter readiness; they
  do not wait forever for network idle.
- Dialogs and popups pause the current program unless the approved program
  includes a matching safe handler.
- Downloads require an approved destination and separate file policy; P0 pauses
  rather than accepting downloads.

## 16. Page-Context Script Execution

### 16.1 Security reality

`page.evaluate()` is not a complete sandbox. Even without Node.js, a script
running with an authenticated page can read most DOM-visible data, make
same-origin authenticated requests, submit forms, navigate, and potentially
access web storage. Static source filtering can be bypassed and must never be
the primary control.

Therefore page scripts are a privileged capability governed by user approval,
origin scope, exact source hashing, runtime isolation, network/action
monitoring, and output controls. Product copy must not claim that page context
alone prevents access to all account data.

### 16.2 Script request

```ts
interface ExecutePageScriptInput {
  readonly sessionId: string;
  readonly pageRevision: number;
  readonly purpose: string;
  readonly source: string;
  readonly arguments: Readonly<Record<string, JsonValue>>;
  readonly timeoutMs: number;
  readonly expectedOutput: string;
}
```

Limits: 16 KiB source, 32 KiB arguments, five-second default, fifteen-second
hard timeout, 256 KiB result, JSON-only result, depth 10, 5,000 aggregate keys
or array entries.

### 16.3 Approval and execution

The approval dialog shows:

- account and platform;
- current origin and page revision;
- purpose and expected output;
- complete source with syntax highlighting;
- timeout;
- classifier warnings;
- exact SHA-256 source hash.

Approval is bound to session, task, origin, revision, and source hash. Any edit,
navigation, or revision change invalidates it. P0 approvals are once-only;
there is no “always allow scripts” option.

The worker executes in an isolated JavaScript world when Puppeteer/CDP support
is reliable. This prevents collisions with page globals but does not remove the
page's authenticated authority. The wrapper provides only JSON arguments and a
result callback; it does not provide Puppeteer, CDP, Node, Electron, filesystem,
shell, process, require, or environment APIs.

Defense-in-depth source analysis rejects obvious references to cookies,
storage, IndexedDB, Cache API, service workers, credential APIs, WebSocket,
`sendBeacon`, dynamic code construction, and unapproved navigation. This is a
policy aid, not a security proof.

### 16.4 Runtime monitoring and result sanitization

Before execution, the worker snapshots origin, URL, revision, and form state.
During execution it monitors main-frame navigation, dialogs, popup creation,
downloads, and unexpected requests. A classified write effect or navigation
not covered by the approval aborts and enters handoff/approval state.

The result sanitizer:

- accepts only null, booleans, finite numbers, strings, arrays, and plain
  objects;
- rejects cycles, accessors, DOM nodes, handles, functions, symbols, binary
  blobs, and prototypes other than plain object/array;
- redacts strings matching secret/token/cookie/auth patterns;
- removes keys such as `cookie`, `authorization`, `token`, `password`,
  `session`, `credential`, and variants;
- enforces depth, entry, string, and serialized-byte budgets.

On timeout, the worker stops the CDP execution where possible and replaces the
controlled page because an in-page promise cannot be trusted to have stopped.
The replacement increments revision and re-verifies authentication.

## 17. Risk Classification and Approval

### 17.1 Host-side classifier

`BrowserActionRiskClassifier` is deterministic host code. It consumes the
platform adapter's action descriptors, current origin, element semantics,
action type, nearby safe text, and navigation destination. LLM assertions do
not lower risk.

| Class               | Examples                                                   | Approval                                                                     |
| ------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Read                | Observe, extract public/authorized visible content, scroll | Existing session consent; no per-step prompt                                 |
| Reversible write    | Type a draft, change a filter, open a composer             | Task-level consent; adapter may elevate                                      |
| Consequential write | Publish, send, reply, follow, like, upload, delete, submit | Always just-in-time confirm                                                  |
| Credential/security | Password, MFA, account settings, recovery, permissions     | User handoff; automation blocked                                             |
| Local data delete   | Clear selected-account managed-browser resource cache      | Explicit scope/size confirmation; saved login remains                        |
| Privileged script   | Every page script                                          | Always exact-source confirm; writes receive additional consequential preview |

`full_access` may suppress prompts only for low-risk actions. It cannot bypass
consequential, credential/security, external-origin, download/upload, or script
rules.

### 17.2 Approval preview

A consequential preview contains target account, platform, origin, action,
recipient/target when safely known, content summary, irreversible effects, and
expiry. It never contains cookie values or hidden fields. Approval expires
after 60 seconds, on revision/origin change, or when the target fingerprint
changes.

Approval records reuse the existing tool audit system where possible and add
safe browser metadata: session ID, request ID, risk class, tool name, origin,
platform ID, decision, and source hash. Page text and entered values are not
stored by default.

## 18. User Handoff

Handoff is required for login, login/security CAPTCHA, MFA, passwords,
passkeys, recovery, consent that cannot be safely classified, security
settings, and ambiguous platform state. A non-login CAPTCHA may first follow
the provider policy in §18.3; every ineligible or failed provider path returns
to handoff.

### 18.1 Handoff lifecycle

Flow:

1. Worker emits `HANDOFF_REQUIRED` with a bounded reason code.
2. Main cancels/pause current AI browser request and marks user control.
3. UI explains that the visible Chrome window is now under user control.
4. Worker continues lifecycle monitoring but executes no LLM action.
5. User clicks **I've finished logging in**, **Continue task**, or **Resume AI**
   in Electron, depending on the reason.
6. Main publishes a user-action receipt and sends
   `VERIFY_MANUAL_LOGIN` or `RESUME_HANDOFF`.
7. Worker increments page revision, verifies origin and authentication, captures
   refreshed cookies, creates a new observation, and returns ready or handoff.

The worker never attempts to detect or record typed credentials. Screenshots
are disabled while a known sensitive field is focused.

### 18.2 Chat notice publisher

`BrowserChatNoticePublisher` converts authoritative main-process transitions
into safe conversation events. The worker cannot write chat messages directly.
The publisher uses the existing AI Chat persistence/event pipeline rather than
accessing the database itself.

```ts
interface BrowserChatNoticeInput {
  readonly sessionId: string;
  readonly conversationId: string;
  readonly type: BrowserChatNoticeType;
  readonly transitionNonce: string;
  readonly messageArgs: Readonly<Record<string, string | number | boolean>>;
  readonly requiresUserAction: boolean;
}
```

Allowed arguments are safe account/platform display labels, cookie counts,
`sessionSaved`, retryability, and bounded reason codes. URLs are reduced to
origin. Page text, entered values, OAuth parameters, provider data, cookies,
and secrets are rejected.

The deduplication key is
`conversationId/sessionId/type/transitionNonce`. Replayed worker events or
redirect storms therefore produce one visible notice. The publisher persists a
safe structured payload so reload reconstructs the same notice without
rerunning browser work.

Manual-login notice order is deterministic:

```text
login_required
user action receipt: "I've finished logging in"
login_verifying
login_verified(sessionSaved=true|false) -> task_resuming
or login_verification_failed -> user_login_in_progress
```

If the worker or Chrome crashes, the publisher emits exactly one
`browser_crashed` notice stating that AiFetchly remains open, the saved session
was not overwritten, and a fresh browser session may be started. It does not
surface stack traces, PIDs, executable paths, or cookie details.

### 18.3 CAPTCHA resolution architecture

Challenge resolution is split so page detection, policy, provider secrets, and
browser application do not collapse into one privileged component:

```text
Worker ChallengeDetector
  -> CHALLENGE_DETECTED (safe descriptor + challengeId)
Main CaptchaResolutionPolicy
  -> manual_handoff | provider | blocked
Main CaptchaProviderService (provider branch only)
  -> request-scoped external call using main-held token
  -> private APPLY_CHALLENGE_RESPONSE
Worker applies response in current page
  -> re-check challenge, origin, authentication, page revision
  -> fresh observation or manual handoff
```

#### Policy input and decision

```ts
interface CaptchaResolutionContext {
  readonly sessionId: string;
  readonly challengeId: string;
  readonly origin: string;
  readonly platformId: number;
  readonly challengeType: CaptchaChallengeType;
  readonly flow:
    | "login"
    | "security"
    | "payment"
    | "content_action"
    | "read_navigation"
    | "unknown";
  readonly currentActionRisk: BrowserRiskClass;
  readonly providerInputAvailable: boolean;
}

type CaptchaResolutionDecision =
  | { readonly mode: "manual_handoff"; readonly reasonCode: string }
  | {
      readonly mode: "provider";
      readonly provider: "2captcha";
      readonly authorizationId: string;
      readonly attempt: 1;
    }
  | { readonly mode: "blocked"; readonly reasonCode: string };
```

The deterministic main-process policy checks:

1. flow is not login, security, recovery, MFA, payment, or unknown;
2. current origin matches a suffix-exact authorized-domain entry;
3. platform policy explicitly allows the challenge type; social platforms are
   denied by default;
4. existing `2captcha-enabled` is on and `2captcha-token` is non-empty;
5. the user accepted the current external-provider disclosure version;
6. the authorization is active for this domain and account/workspace scope;
7. this challenge ID has no previous provider attempt;
8. required provider input can be produced without cookies, authorization
   headers, credentials, surrounding private HTML, or an unredacted private
   URL;
9. no cancellation or session-state transition is pending.

Page content and LLM arguments cannot set any of these values. Configuration
is retrieved through `SystemSettingGroupModule` or a dedicated Module, never a
repository call from IPC.

#### Provider secret and request handling

The existing repository pattern of copying `TWOCAPTCHA_TOKEN` into a worker
environment must not be used by the managed browser. `CaptchaProviderService`
runs in the main process, obtains the token only when an authorized request is
created, invokes a typed provider adapter, and releases the token reference
after completion. The token never enters renderer IPC, LLM tools/results,
generic worker environment variables, progress, chat notices, or audit data.

The provider request contains only the minimum method-specific challenge
descriptor approved during implementation review. It has a stable internal
request ID, 120-second hard deadline, abort signal, one-attempt budget, bounded
polling/backoff, and terminal state. Provider balance/errors are mapped to safe
codes. Raw provider responses and challenge solutions are not persisted.

`APPLY_CHALLENGE_RESPONSE` carries the ephemeral response over private,
validated main-to-worker IPC. After applying it, the worker does not assume
success: it waits for the challenge to disappear, validates final origin,
reassesses authentication, increments `pageRevision`, and returns a fresh
observation.

Provider failure, timeout, unsupported challenge, changed origin, duplicate
challenge ID, or unsuccessful application emits a safe notice and enters
manual handoff. There is no second automatic provider attempt.

If a challenge appeared after a publish/send/delete/upload/follow/purchase or
another consequential action, mark the action `effect_unknown`. After the
challenge clears, re-observe and request a fresh approval when necessary; never
replay the action automatically.

#### Settings additions

Keep the existing enabled/token settings for compatibility and add:

```text
2captcha-disclosure-version-accepted: string
2captcha-authorized-domains: encrypted/validated domain-policy collection
2captcha-allow-non-login-browser-challenges: boolean (default false)
```

The UI explains the external data recipient, data categories, manual fallback,
domain scope, and revocation. Removing authorization or disabling the provider
cancels pending work and prevents new requests. Tokens are displayed masked and
never returned through normal settings-read IPC.

## 19. Screenshots and Artifacts

Screenshots have two destinations:

1. **Local preview**: worker captures a bounded PNG/JPEG and returns it through
   the dedicated 8 MiB message. Main exposes an ephemeral data URL to the
   renderer and discards it when the card/session closes.
2. **AI vision input**: main passes the image through the existing image
   normalization/attachment disclosure path. The user must have requested or
   approved visual analysis. The image is not silently added to a remote model
   request.

Defaults are viewport-only JPEG, quality 75, maximum 1600x1200 after scaling,
and 2 MiB decoded. Full-page screenshots, password/challenge pages, and
cross-session persistence are disabled in P0. Before capture, known sensitive
inputs are blurred using adapter and semantic-field detection. The UI still
warns that a screenshot can contain private page content.

## 20. Async Jobs, Progress, and Cancellation

`browser_run_actions` resolves asynchronously when it has multiple steps,
loops, navigation, handoff potential, or expected duration above the browser
timeout. `ToolJobRegistry` stores only safe progress/result data, never cookies,
screenshots, script source, or entered values.

Progress events:

```ts
interface SafeBrowserProgress {
  readonly sessionId: string;
  readonly requestId: string;
  readonly phase:
    | "starting"
    | "observing"
    | "acting"
    | "waiting"
    | "handoff"
    | "stopping";
  readonly completedSteps: number;
  readonly totalSteps: number | null;
  readonly messageCode: string;
}
```

Cancellation propagates:

```text
UI Stop / AI abort
  -> ToolJobRegistry abort signal
  -> ManagedBrowserModule
  -> ManagedBrowserWorkerClient CANCEL_REQUEST
  -> current Puppeteer operation abort
  -> STOP_SESSION when session-level stop was requested
  -> browser.close()
  -> forced utilityProcess.kill() if deadline expires
  -> lease release
```

Action cancellation may leave a page in an intermediate remote state; the
result says `effect_unknown` when completion cannot be proven. The assistant
must observe before retrying and must not blindly repeat a consequential action.

## 21. Platform Adapter Contract

```ts
export interface PlatformBrowserAdapter {
  readonly platformId: number;
  readonly key: string;
  readonly allowedOrigins: readonly string[];
  readonly loginOrigins: readonly string[];
  readonly verificationUrl: string;

  assessAuthentication(page: Page): Promise<AuthenticationAssessment>;
  detectChallenge(page: Page): Promise<ChallengeKind | null>;
  classifyAction(context: AdapterActionContext): Promise<AdapterRiskEvidence>;
  identifySensitiveFields(page: Page): Promise<readonly ElementHandle[]>;
  readiness(page: Page): Promise<AdapterReadiness>;
}
```

Adapters contain platform facts, not account secrets. They may use stable URL,
role, label, and presence signals. They must not persist private content or rely
on translated visible text as the only authentication signal.

### 21.1 YouTube pilot

Allowed origins include YouTube and the minimum Google account/login origins
required by `PlatformSessionManifest`. The pilot fixtures cover:

- authenticated YouTube home;
- signed-out redirect/sign-in state;
- Google reauthentication;
- challenge/handoff;
- comment draft and simulated reply publish;
- popup and stale-DOM behavior.

Live selectors belong in the adapter with fixture tests. CI never logs into
Google or YouTube and never publishes content.

## 22. Renderer and IPC Contracts

### 22.1 IPC channels

```text
managed-browser:list-eligible-accounts
managed-browser:start
managed-browser:status
managed-browser:handoff
managed-browser:verify-manual-login
managed-browser:resume
managed-browser:stop
managed-browser:approve
managed-browser:extend-handoff
managed-browser:get-effective-settings
managed-browser:get-cache-status
managed-browser:clear-cache
managed-browser:on-status-changed
managed-browser:on-progress
managed-browser:on-approval-required
managed-browser:on-chat-notice
managed-browser:on-cache-progress
```

All request/response/event payloads have strict schemas under
`src/schemas/ipc/managedBrowser.ts`. The preload exposes named methods, never a
generic `send(channel, payload)` function. Event subscription returns an
unsubscribe callback.

AI handlers perform the mandatory `Token`/`USER_AI_ENABLED` check before input
parsing. IPC validates the sender web contents and calls
`ManagedBrowserModule`; it contains no database operations.

### 22.2 UI components

`ManagedBrowserSessionCard` displays:

- selected account and platform;
- starting/ready/running/approval/handoff/stopping/failure state;
- current safe origin and page title;
- AI control indicator;
- Pause AI, Take over, Resume AI, and Stop controls;
- **I've finished logging in**, **Continue task**, **Extend time**, and
  **Cancel task** controls when relevant;
- safe progress and actionable failure messages.

System Settings adds a `ManagedBrowserSettingsPanel` containing the browser and
cache toggles, validated cache maximum, clear-on-exit toggle, approximate size,
last-clear time, selected-account/all-cache actions, and active-session choice.
Cache status is loaded through the narrow managed-browser API, not by exposing
filesystem paths or generic settings rows.

The clear confirmation shows scope, approximate size, saved-login preservation,
active-session effect, and expected cold-load impact. The completion notice
states the approximate bytes removed and repeats that the saved login session
was preserved.

Approval and handoff are modal only when user action is required. Keyboard
focus is trapped appropriately, every control has an accessible label, and no
status relies on color alone.

All new user-facing strings must be added with identical keys to
`en.ts`, `zh.ts`, `es.ts`, `fr.ts`, `de.ts`, and `ja.ts`. Component changes and
their tests are committed together.

## 23. Errors and Recovery

```ts
export type ManagedBrowserErrorCode =
  | "ai_disabled"
  | "managed_browser_disabled"
  | "account_not_found"
  | "account_in_use"
  | "session_cookie_missing"
  | "browser_dependency_missing"
  | "browser_incompatible"
  | "fingerprint_mismatch"
  | "proxy_unavailable"
  | "navigation_blocked"
  | "authentication_required"
  | "challenge_requires_handoff"
  | "challenge_provider_not_authorized"
  | "challenge_provider_unavailable"
  | "challenge_provider_timeout"
  | "challenge_resolution_failed"
  | "stale_page_reference"
  | "action_not_allowed"
  | "approval_required"
  | "approval_expired"
  | "script_rejected"
  | "script_timeout"
  | "result_too_large"
  | "worker_protocol_violation"
  | "worker_start_timeout"
  | "worker_unresponsive"
  | "chrome_disconnected"
  | "worker_exited"
  | "cancelled"
  | "stop_timeout"
  | "cookie_refresh_failed"
  | "cache_disabled"
  | "cache_incompatible"
  | "cache_scope_active"
  | "cache_clear_deferred"
  | "cache_path_invalid"
  | "cache_maintenance_failed"
  | "cache_limit_invalid"
  | "internal_error";
```

Errors returned to renderer/LLM contain code, localized message key, retryable
boolean, safe recovery action, session ID when applicable, and no raw stack or
secret. Full local diagnostic stacks may be logged after redaction.

Recovery policy:

- Missing cookies -> handoff or existing import/login flow.
- Fingerprint/browser incompatibility -> stop before navigation and open
  dependency diagnostics.
- Stale ref -> fresh observation, no automatic repeat of consequential action.
- Worker crash -> release lease; user may start a fresh ephemeral session.
- Missed heartbeat/Chrome disconnect -> run the same cleanup path as worker
  exit and report any in-flight action effect as unknown.
- Refresh failure -> retain old snapshot and tell user login may need renewal
  next time.
- Stop timeout -> kill worker, release lease, emit cleanup diagnostic.
- Provider unavailable/timeout/failure -> make no second automatic attempt;
  preserve the page and request manual handoff.
- Browser preference disabled -> do not touch cookies or workers; return the
  System Settings route.
- Cache disabled/incompatible -> start with a disposable profile and no
  persistent cache; do not alter the stored preference.
- Active cache scope -> defer, skip, cancel, or stop through the user's explicit
  choice; never delete live files.
- Cache maintenance failure -> preserve the deletion queue, release locks, and
  return a retryable safe status without blocking browser work.

## 24. Logging, Audit, and Privacy

Allowed operational fields:

- session/request/job IDs;
- platform ID and numeric account ID;
- state transition and duration;
- browser source/version major;
- action type and risk class;
- origin, with query and fragment removed;
- counts and bounded reason codes;
- approval decision and source hash;
- heartbeat health buckets, disconnect cause, and verified cleanup outcome;
- CAPTCHA decision mode and bounded reason code, without challenge/provider
  payload;
- cache enabled/effective reason, operation type, approximate byte bucket,
  duration bucket, and safe terminal code;

Forbidden fields:

- cookie names or values;
- proxy username/password;
- CAPTCHA provider token, raw challenge descriptor, raw response, or solution;
- authorization headers;
- form input values;
- password/OTP/passkey data;
- raw HTML or accessibility trees;
- screenshots/base64;
- complete script result;
- full URLs with tokens/query/fragment;
- decrypted storage payloads;
- cache root/path, opaque account scope, cached URLs, response headers/bodies,
  filenames, and directory listings.

A centralized `ManagedBrowserLogSanitizer` should redact recursively and limit
depth/string length before calling the repository logger. Tests plant unique
canary secrets in cookies, proxy credentials, DOM, form inputs, errors, and
script output, then scan logs, events, jobs, audits, and tool results.

Operational session state is in memory. P0 adds no browser-session database
entity. Existing encrypted account-cookie records remain the only durable
authentication store.

## 25. Configuration and Feature Flags

`src/config/managedBrowser.ts` centralizes:

- `MANAGED_BROWSER_ENABLED`;
- pilot platform allowlist;
- protocol version and message limits;
- global session concurrency;
- startup/action/script/stop timeouts;
- observation/action/result budgets;
- managed Chrome dependency ID and compatibility tuple;
- denied launch flags and enabled stealth evasions;
- screenshot policy;
- proxy mode allowlist;
- heartbeat interval/miss threshold and global shutdown deadline;
- handoff duration/extension limit;
- CAPTCHA-provider feature flag, disclosure version, authorized-domain policy,
  supported non-sensitive challenge types, one-attempt budget, and timeout;
- `managed-browser-enabled` user setting, default true;
- `managed-browser-cache-enabled`, default true;
- cache global maximum 500 MiB, accepted range 100-2048 MiB;
- per-account target, inactive retention, maintenance cadence, cache-schema
  version, and clear-on-exit preference.

Security limits are code defaults with safe upper bounds. Environment or token
settings may reduce limits, but cannot raise hard maxima or disable
always-confirm rules in production.

## 26. Test Design

### 26.1 Local fixture server

Create a deterministic local HTTPS fixture used only in tests. It simulates:

- cookie-authenticated and signed-out states;
- cookie renewal;
- semantic controls and dynamic DOM replacement;
- history navigation and full navigation;
- safe draft and simulated publish actions;
- password, OTP, CAPTCHA, and passkey-like handoff controls;
- popup, dialog, download, and cross-origin navigation attempts;
- delayed actions and never-resolving scripts;
- missing/invalid cookie login, failed and successful manual verification, and
  session refresh persistence failure;
- eligible and ineligible CAPTCHA flows, duplicate challenge detection,
  provider success/failure/timeout, and manual fallback;
- worker heartbeat loss, worker crash, Chrome disconnect, PID reuse, and app
  shutdown;
- repeat resource loads with cache enabled/disabled, two account scopes,
  version changes, and authenticated `no-store` responses;
- cache size/retention pressure, active-scope clear, interrupted deletion, and
  clear-on-exit;
- prompt-injection text asking the agent to reveal cookies or ignore policy;
- large/cyclic/secret-bearing script results.

It uses synthetic cookies and no third-party account.

### 26.2 Unit tests

Under `test/vitest/utilitycode/managedBrowser/` test:

- all worker and IPC schemas, strictness, size bounds, and malformed messages;
- executable version parsing and resolution precedence;
- fingerprint matching, native-UA default, locale/timezone/viewport checks, and
  denied flags;
- cookie conversion including host-only, prefix, SameSite, expiry, domain, and
  independent rejection cases;
- lease collision and idempotent release;
- chat notice state mapping, safe arguments, persistence, and deduplication;
- CAPTCHA flow sensitivity, suffix-exact domain authorization, disclosure
  version, provider enable/token state, and single-attempt policy;
- heartbeat sequencing, three-miss threshold, late-heartbeat rejection, and
  process identity validation;
- effective browser/cache setting defaults and release-flag precedence;
- opaque HMAC scope generation and key-unavailable fail-off behavior;
- cache root/segment/canonical-path validation, symlink and traversal rejection;
- size scan bounds, eviction ordering, active-scope exclusion, atomic
  deletion-queue transition, restart recovery, and idempotent empty clear;
- account-removal queueing and clear-on-exit quarantine before reuse;
- revision and reference expiry;
- action limits, branching, repeats, failures, and cancellation;
- risk classifier invariants;
- script hash, approval binding, source defense checks, result sanitizer, and
  timeout invalidation;
- log redaction and secret canaries.

### 26.3 Main-process tests

Under `test/vitest/main/managedBrowser/` verify:

- AI enable is checked before parsing and work;
- IPC calls the Module and never database repositories;
- correct start ordering and cleanup on every failed stage;
- cookie payload is routed only through the private worker path;
- refresh calls `AccountSessionService.persistSnapshot(worker_refresh)`;
- empty/failed refresh preserves prior data;
- crash and timeout release account/global leases;
- async jobs remain conversation scoped and cancellable;
- always-confirm actions remain blocked under `full_access`;
- renderer events contain no secrets;
- missing cookies start handoff instead of failing the worker;
- **I've finished logging in** publishes verifying/terminal notices and resumes
  only after adapter verification;
- settings are read through a Module, provider secrets remain main-only, and
  provider policy cannot be overridden by worker/page/LLM data;
- every terminal trigger joins the same supervisor cleanup promise;
- `before-quit` stops managed browsers within its global deadline.
- disabled browser preference rejects before account-cookie reads and worker
  creation;
- cache settings are read/written through Modules and validated independently
  of renderer values;
- clear-cache IPC never accepts a path and never calls account-session clearing;
- active scope decisions coordinate with the supervisor before maintenance;
- cache worker failure returns a retryable result and leaves deletion state
  recoverable.

### 26.4 Worker integration tests

Against the fixture and a real compatible local Chrome:

- headed launch and ready handshake;
- fingerprint self-test before fixture navigation;
- cookies applied before first request;
- authentication verification and refresh;
- observation/ref/action round trip;
- stale ref after DOM/navigation change;
- handoff disables actions and resume re-verifies;
- script execution, rejection, result limits, and page replacement on timeout;
- proxy routing and direct-fallback prohibition;
- graceful close, cancel, crash, and orphan cleanup;
- heartbeat during navigation and user handoff;
- manual-login same-context session continuity and refreshed-cookie capture;
- private challenge response application, post-resolution re-verification, and
  manual fallback using a local fake provider.
- cache-enabled repeat load, cache-disabled cold load, and cross-account
  isolation;
- temporary-profile containment and deletion after graceful/crash cleanup;
- cache clear preserves login cookies and creates a cold next load;
- cache-version migration and active-scope exclusion.

Browser integration tests may be tagged and excluded where no display server is
available; Linux CI should run them under the repository's supported virtual
display configuration.

### 26.5 UI and E2E tests

Component tests cover all visual states, approval content, controls, keyboard
behavior, long account names, narrow layouts, and translation keys. Run:

```bash
yarn test:components
```

Playwright Electron E2E covers start, safe status, structured actions,
consequential approval, handoff/resume, stop, cookie refresh reuse, and
fingerprint rejection using fixtures. It also covers the complete login/chat
notice sequence, eligible-provider/manual-fallback paths, and simulated
worker/Chrome failure while the main window remains interactive. Live social
platforms and the real 2Captcha network are manual rollout tests only.
It also covers browser-setting disable/re-enable, cache preference persistence,
selected/all clear confirmations, active-session choices, preserved login, and
localized clear completion.

### 26.6 Packaging tests

- Worker bundle exists for every target.
- Packaged path resolver finds it.
- Puppeteer and stealth dependencies resolve inside the worker bundle.
- Managed/system Chrome diagnostics work on Windows, macOS, and Linux.
- No remote-debugging listener is externally reachable.
- Packaged logs/source maps contain no planted canary secrets.
- Cache paths resolve only beneath the packaged application's managed cache
  root on Windows, macOS, and Linux.
- The cache-maintenance worker bundle exists, validates messages, and resumes
  deletion-queue cleanup after a simulated interruption.

## 27. Implementation Plan

### Phase A: contracts and diagnostics

1. Add shared types, worker/IPC/tool schemas, safe error codes, and tests.
2. Add centralized configuration and launch-flag validation.
3. Implement executable resolver and dependency diagnostics.
4. Implement fingerprint policy/self-test against a local blank page.
5. Register the worker build without enabling account sessions.

Exit: compatible Chrome launches visibly and passes/fails deterministic
fingerprint fixtures before external navigation.

### Phase B: authenticated session runtime

1. Add default-enabled browser/cache system settings and release-flag
   precedence.
2. Add lease service and worker client.
3. Add runtime state machine, navigation policy, and cleanup.
4. Add cookie conversion/application and safe counts.
5. Add YouTube adapter and handoff.
6. Add refreshed-cookie private routing and persistence.
7. Add disposable profile and account/version cache scope resolution.
8. Add cache-maintenance worker, clear/eviction orchestration, and settings UI.
9. Add safe status IPC/UI with six-language translations and component tests.
10. Add same-context missing/invalid-cookie login, completion verification, and
    structured chat notices.
11. Add supervisor heartbeat, Chrome disconnect handling, verified process-tree
    cleanup, and `before-quit` integration.

Exit: a synthetic fixture and authorized pilot account can reuse, renew, and
persist a session without secret exposure.

### Phase C: structured LLM control

1. Implement compact observation and page-reference registry.
2. Implement P0 actions and program limits.
3. Add risk classifier and approval integration.
4. Register deferred built-in tools and capabilities prompt.
5. Integrate async jobs, progress, cancellation, screenshots, and E2E tests.

Exit: the pilot workflow completes under visible control with required
approvals and reliable cleanup.

### Phase C.5: policy-gated CAPTCHA provider

1. Add challenge detector output and stable challenge correlation.
2. Add `CaptchaResolutionPolicy`, domain authorization, and versioned
   disclosure consent.
3. Add request-scoped main-process provider service and a fake provider for
   deterministic tests.
4. Add private response application, post-resolution re-verification,
   single-attempt enforcement, safe chat notices, and manual fallback.
5. Keep all social-platform policies denied until separately reviewed and
   signed off.

Exit: sensitive/ineligible challenges always hand off, eligible fixture
challenges complete or fall back without secret leakage, loops, or action
replay.

### Phase D: privileged scripts

1. Add exact-source approval UI and source hashing.
2. Add isolated-world wrapper and runtime monitoring.
3. Add result sanitizer and page replacement on timeout.
4. Add adversarial script, prompt-injection, secret, and effect tests.

Exit: approved complex page logic works within defined limits, and the product
accurately communicates its authenticated-page authority.

### Phase E: platform expansion

Each platform requires manifest review, adapter, authentication fixtures,
challenge rules, consequential-action map, rate policy, cookie refresh test,
fingerprint matrix, and authorized manual QA sign-off. Do not enable a platform
merely because its pages happen to work with generic actions.

## 28. File-Level Change Matrix

| File/area                                               | Change                                            | Verification                      |
| ------------------------------------------------------- | ------------------------------------------------- | --------------------------------- |
| `src/schemas/worker/managedBrowser.ts`                  | Strict protocol unions                            | Schema fuzz/unit tests            |
| `src/entityTypes/managedBrowserTypes.ts`                | Shared safe contracts                             | Type check                        |
| `src/childprocess/managed-browser/*`                    | Browser-only runtime                              | Worker integration tests          |
| `src/service/ManagedBrowserWorkerClient.ts`             | Lifecycle/correlation/cancel                      | Main unit tests                   |
| `src/service/ManagedBrowserLeaseService.ts`             | Account/global leases                             | Concurrency/crash tests           |
| `src/service/ManagedBrowserSupervisor.ts`               | Heartbeat, process identity, cleanup              | Hang/crash/shutdown tests         |
| `src/service/BrowserChatNoticePublisher.ts`             | Safe deduplicated chat transitions                | Notice/persistence tests          |
| `src/service/CaptchaResolutionPolicy.ts`                | Sensitive/domain/provider eligibility             | Policy matrix tests               |
| `src/service/CaptchaProviderService.ts`                 | Main-only request-scoped provider call            | Fake-provider/secret tests        |
| `src/modules/ManagedBrowserSettingsModule.ts`           | Effective browser/cache preferences               | Settings/gating tests             |
| `src/modules/ManagedBrowserCacheModule.ts`              | Scope locks, status, clear orchestration          | Path/active/clear tests           |
| `src/service/ManagedBrowserCacheScopeService.ts`        | Opaque scope and trusted path derivation          | Path/security tests               |
| `src/childprocess/managed-browser-cache/*`              | Bounded scan, eviction, deletion                  | Worker/interrupt tests            |
| `src/modules/ManagedBrowserModule.ts`                   | Orchestration and cookie bridge                   | Main tests with injected services |
| `src/modules/AccountSessionService.ts`                  | Only small adapter additions if needed            | Existing + refresh tests          |
| `src/config/skillsRegistry.ts`                          | Deferred browser tools                            | Tool catalog tests                |
| `src/service/BuiltInToolCapabilitiesPromptSection.ts`   | Browser capability guidance                       | Prompt snapshot tests             |
| `src/service/ToolTimeoutPolicy.ts`                      | Browser/async classification if needed            | Timeout tests                     |
| `src/main-process/communication/managed-browser-ipc.ts` | Validated IPC and AI gate                         | IPC ordering tests                |
| `src/preload.ts`                                        | Narrow contextBridge API                          | Renderer API tests                |
| `src/views/components/aiChatV2/*`                       | Status/approval/handoff UI                        | Component + E2E tests             |
| `src/config/settinggroupInit.ts` and settings Modules   | Browser/cache defaults and provider authorization | Settings/security tests           |
| `src/views/lang/*.ts`                                   | Six-language strings                              | Key parity test                   |
| `forge.config.js`, Vite worker config                   | Packaged worker entry                             | Build/package tests               |

Each logical implementation unit follows repository rules: no incomplete
commits, UI and component tests together, and worker entry/specific code only
under `src/childprocess/`.

## 29. Rollout and Operations

Feature gates are layered:

1. global managed-browser flag;
2. default-enabled user managed-browser setting;
3. supported executable/fingerprint gate;
4. pilot platform allowlist;
5. account eligibility and session availability;
6. default-enabled user cache setting plus platform/browser/OS containment
   compatibility;
7. structured-actions flag;
8. privileged-script flag;
9. CAPTCHA-provider global flag;
10. versioned disclosure consent and domain/platform allowlist.

Rollout order: internal fixtures, internal authorized account, small opt-in
pilot, then platform-by-platform expansion. Metrics include ready/handoff rate,
authenticated reuse rate, action completion, approvals, cancellation latency,
orphan processes, refresh success, fingerprint failures, and secret-canary
violations. CAPTCHA metrics are limited to decision mode, safe reason code,
duration bucket, and terminal outcome. Metrics contain no page content,
challenge payload, provider response, token, or account secret.
Cache metrics are limited to enabled state, cache-hit/load improvement buckets,
approximate size buckets, eviction/clear outcome, and compatibility reason. They
contain no paths, scope tokens, URLs, filenames, headers, or response data.

Rollback disables new starts, allows active sessions to stop, and retains the
last-known-good browser dependency. Existing Electron login windows and legacy
scrapers remain available throughout rollout.

## 30. Alternatives Rejected

### Electron `BrowserWindow` as the automation browser

Rejected for the new general automation runtime. Electron is still the right
application shell, but its runtime identity is Electron-specific and its
automation surface is less aligned with the existing Puppeteer ecosystem.

### Shared external Chrome profile

Rejected for P0/P1 due to lock contention, corruption risk, broad secret
copying, cross-account leakage, and incompatibility between Electron partition
storage and Chrome profiles.

### One persistent Chrome profile per account for caching

Rejected for P0/P1 because it would make cache inseparable from cookies, local
storage, IndexedDB, history, permissions, autofill, and service workers. The
selected design keeps the session profile disposable and persists only the
separate Chrome resource-cache directory after containment tests pass.

### Arbitrary model-generated Puppeteer or Node scripts

Rejected because it creates local code execution with filesystem, process,
environment, and unrestricted network access.

### Random user-agent and fingerprint rotation

Rejected because independent randomization creates contradictions and does not
provide a defensible security or reliability property.

### Screenshot-streamed browser embedded inside Electron

Rejected due to latency, input synchronization, accessibility, focus, IME,
clipboard, and window-management complexity. The Chrome window remains visibly
separate; Electron provides control and status.

## 31. Definition of Done

The first production pilot is complete only when:

1. One headed Chrome utility-process session is account-bound and globally
   bounded.
2. Stored cookies are applied before navigation and refreshed cookies are
   persisted only through `AccountSessionService`.
3. Renderer, LLM, logs, jobs, events, and audits pass planted-secret scanning.
4. Native UA and executable identity pass self-test; deliberate mismatches fail
   before platform navigation.
5. Unsafe launch flags are absent.
6. Observation and revision-bound actions work against deterministic fixtures.
7. Consequential actions and scripts cannot bypass approval in `full_access`.
8. Missing/invalid-cookie login stays in the same Chrome context, produces the
   complete chat notice sequence, verifies before resume, and safely reports
   cookie-persistence failure.
9. Login/security challenges always hand control to the user. Provider use for
   an eligible non-login fixture requires every policy gate, is single-attempt,
   and falls back to handoff.
10. Stop, cancel, timeout, missed heartbeat, worker/Chrome crash, and app
    shutdown leave no verified managed Chrome or account lease behind within
    the documented deadlines while Electron remains responsive.
11. Main, worker, component, E2E, type, build, and packaging gates pass.
12. All UI text exists in all six supported languages.
13. The pilot platform has an adapter, authorized manual QA sign-off, rollback
    procedure, and no claim that stealth makes automation undetectable.
14. The browser and cache user settings default to enabled, release-flag and AI
    gates take precedence, and disabling rejects before cookies or workers.
15. Account/version cache isolation, disposable-profile containment, cache
    limits, eviction, and performance gates pass on every supported platform.
16. Selected/all cache clear preserves saved login cookies, rejects external
    paths and live scopes, survives interruption, and never removes files
    outside the managed cache root.
