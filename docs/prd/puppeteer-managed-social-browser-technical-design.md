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

| Topic          | Decision                                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pilot          | YouTube/Google is the default pilot, subject to an authorized QA account. Its adapter verifies both Google login and YouTube identity.                       |
| Browser source | Support a managed, pinned Chrome for Testing build and a validated system Chrome fallback. Never silently download during a browser task.                    |
| Runtime        | Headed Chrome controlled through Puppeteer 25.x from a dedicated utility process.                                                                            |
| Profile        | Ephemeral incognito browser context for P0/P1; no shared or persistent `userDataDir`.                                                                        |
| Tabs           | One controlled tab in P0. Popups pause for policy handling. Multi-tab control is P1.                                                                         |
| User agent     | Native browser user agent by default. An override is exceptional and must match the actual Chrome major version.                                             |
| Stealth        | `puppeteer-extra-plugin-stealth` is a reviewed compatibility layer, not a promise of invisibility. Evasions that contradict native values are disabled.      |
| Cookies        | Main decrypts; worker applies; worker returns refreshed cookies; main normalizes, filters, encrypts, and persists.                                           |
| LLM API        | Small typed tools plus a bounded action-program DSL. Raw Puppeteer, CDP, Node.js, and Electron APIs are not exposed.                                         |
| Scripts        | Page-context scripts are privileged, exact-source approved, origin scoped, time bounded, and result sanitized. They are not described as a security sandbox. |
| Approval       | Publish/send/delete/security changes and every page script are always-confirm, even in `full_access`.                                                        |
| Long work      | Browser sessions are resources; long action programs run as `ToolJobRegistry` jobs with progress and cancellation.                                           |
| Screenshots    | Local UI preview is allowed. Sending a screenshot to a remote AI provider requires the existing image disclosure/attachment path and explicit task intent.   |
| Proxy          | One proxy configuration is fixed for the lifetime of an authenticated session. Direct fallback is never silent. P0 supports direct and HTTP(S) proxy modes.  |

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
9. CAPTCHA, MFA, passkeys, passwords, account recovery, and platform challenges
   always enter user handoff.
10. Stop, crash, timeout, and app shutdown close Chrome and release leases.

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
Headed Chrome, isolated context, one controlled page
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
    adapters/
      PlatformBrowserAdapter.ts
      YouTubeBrowserAdapter.ts
  config/
    managedBrowser.ts
    skillsRegistry.ts                         # register deferred AI tools
  entityTypes/
    managedBrowserTypes.ts                    # shared non-secret contracts
  modules/
    ManagedBrowserModule.ts
  schemas/
    aiTools/managedBrowser.ts
    ipc/managedBrowser.ts
    worker/managedBrowser.ts
  service/
    ManagedBrowserWorkerClient.ts
    ManagedBrowserLeaseService.ts
    ManagedBrowserAiToolService.ts
    BrowserActionRiskClassifier.ts
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
```

`forge.config.js` must register `src/childprocess/managed-browser/index.ts` as a
separate Vite build entry. Shared files used by both main and worker must remain
free of DB and renderer imports.

## 6. Shared Domain Types

`src/entityTypes/managedBrowserTypes.ts` contains transport-independent types.
It must contain no cookie-bearing renderer result type.

```ts
export type ManagedBrowserSessionState =
  | "starting"
  | "validating_fingerprint"
  | "applying_session"
  | "verifying_login"
  | "ready"
  | "running"
  | "awaiting_approval"
  | "handoff"
  | "stopping"
  | "stopped"
  | "failed";

export type BrowserRiskClass =
  | "read"
  | "reversible_write"
  | "consequential_write"
  | "credential_or_security"
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
```

Account display labels are resolved separately for renderer display. They are
never accepted from the LLM as account authority.

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
}
```

Start order is fixed:

1. Validate input and resolve the account through `SocialAccountModule`.
2. Resolve platform manifest and configured proxy reference.
3. Acquire an account lease.
4. Resolve a compatible browser executable in the main process.
5. Start a dedicated worker and wait for `WORKER_READY`.
6. Call `AccountSessionService.getDecryptedSnapshot(accountId)`.
7. Revalidate cookie domains against `PlatformSessionManifest`.
8. Send `START_SESSION` with executable, non-secret policy, proxy, and cookie
   snapshot.
9. Zero/release the local cookie array reference after the send completes.
10. Wait for `SESSION_READY`, `HANDOFF_REQUIRED`, or a typed failure.
11. Return a safe status without cookie details.

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

### 7.3 AI enable gate

Every AI-facing IPC handler must begin by reading `USER_AI_ENABLED` through
`Token`, before parsing request data or starting work. UI-only account login or
manual browser management may use separate non-AI channels. The built-in AI
tool path must perform the same entitlement check inside
`ManagedBrowserAiToolService`, because tool execution does not necessarily pass
through renderer IPC.

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
CAPTURE_SCREENSHOT
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
SESSION_STATE_CHANGED
SESSION_READY
OBSERVATION_RESULT
ACTION_PROGRESS
ACTION_RESULT
SCRIPT_RESULT
SCREENSHOT_RESULT
HANDOFF_REQUIRED
REFRESHED_COOKIES
REQUEST_CANCELLED
SESSION_STOPPED
WORKER_ERROR
```

`REFRESHED_COOKIES` is the only outbound message that may carry cookie values.
The client routes it directly to a private handler; it is not stored in a
generic event list and is never forwarded to the renderer.

### 8.4 Worker client lifecycle

Unlike `SkillWorkerClient`, each managed-browser session gets its own
`ManagedBrowserWorkerClient`. It maintains:

- one utility-process handle;
- pending requests keyed by request ID;
- an `AbortController` per request;
- last accepted sequence number;
- startup, graceful-stop, and forced-kill timers;
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

On unexpected exit, pending requests reject with `worker_exited`, the module
releases its lease, and the renderer receives one sanitized failure event.

## 9. Runtime State Machine

```text
created
  -> starting
  -> validating_fingerprint
  -> applying_session
  -> verifying_login
       -> ready
       -> handoff --------------------+
  ready -> running -> ready           |
  ready/running -> awaiting_approval  |
  awaiting_approval -> running/ready  |
  handoff -> verifying_login <--------+
  any live state -> stopping -> stopped
  any live state -> failed -> stopping -> stopped
```

State guards:

- Only `START_SESSION` is valid after `WORKER_READY` and before a session.
- Observe is allowed in `ready`, `running`, `awaiting_approval`, and `handoff`.
- Actions are allowed only in `ready` or `running` and when AI control is not
  paused.
- Scripts are allowed only after main-side approval and in `ready`.
- During handoff, LLM actions are rejected with `user_has_control`.
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
- hide or automate CAPTCHA/MFA challenges;
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

Unauthenticated, challenge, and unknown states enter handoff. The user completes
login in the visible Chrome window; the worker observes only navigation and
adapter signals, not credentials.

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

| Tool                           | Purpose                                  | Default execution     |
| ------------------------------ | ---------------------------------------- | --------------------- |
| `browser_start_session`        | Start/attach to an account-bound session | async startup         |
| `browser_get_status`           | Read safe status                         | synchronous           |
| `browser_observe`              | Obtain semantic page state               | browser timeout       |
| `browser_run_actions`          | Execute a bounded typed program          | async when multi-step |
| `browser_capture_screenshot`   | Local preview or approved AI attachment  | browser timeout       |
| `browser_execute_page_script`  | Privileged page-context logic            | always confirm        |
| `browser_request_handoff`      | Pause AI and give user control           | synchronous control   |
| `browser_resume_after_handoff` | Re-verify and resume                     | browser timeout       |
| `browser_stop_session`         | Capture refresh and close                | browser timeout       |

Every tool requires `session_id` after start. Account IDs cannot be switched
inside an active session.

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

Handoff is required for login, CAPTCHA, MFA, passwords, passkeys, consent that
cannot be safely classified, security settings, and ambiguous platform state.

Flow:

1. Worker emits `HANDOFF_REQUIRED` with a bounded reason code.
2. Main cancels/pause current AI browser request and marks user control.
3. UI explains that the visible Chrome window is now under user control.
4. Worker continues lifecycle monitoring but executes no LLM action.
5. User clicks Resume in Electron.
6. Main sends `RESUME_HANDOFF`.
7. Worker increments page revision, verifies origin and authentication, captures
   refreshed cookies, creates a new observation, and returns ready or handoff.

The worker never attempts to detect or record typed credentials. Screenshots
are disabled while a known sensitive field is focused.

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
managed-browser:resume
managed-browser:stop
managed-browser:approve
managed-browser:on-status-changed
managed-browser:on-progress
managed-browser:on-approval-required
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
- safe progress and actionable failure messages.

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
  | "stale_page_reference"
  | "action_not_allowed"
  | "approval_required"
  | "approval_expired"
  | "script_rejected"
  | "script_timeout"
  | "result_too_large"
  | "worker_protocol_violation"
  | "worker_start_timeout"
  | "worker_exited"
  | "cancelled"
  | "stop_timeout"
  | "cookie_refresh_failed"
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
- Refresh failure -> retain old snapshot and tell user login may need renewal
  next time.
- Stop timeout -> kill worker, release lease, emit cleanup diagnostic.

## 24. Logging, Audit, and Privacy

Allowed operational fields:

- session/request/job IDs;
- platform ID and numeric account ID;
- state transition and duration;
- browser source/version major;
- action type and risk class;
- origin, with query and fragment removed;
- counts and bounded reason codes;
- approval decision and source hash.

Forbidden fields:

- cookie names or values;
- proxy username/password;
- authorization headers;
- form input values;
- password/OTP/passkey data;
- raw HTML or accessibility trees;
- screenshots/base64;
- complete script result;
- full URLs with tokens/query/fragment;
- decrypted storage payloads.

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
- proxy mode allowlist.

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
- renderer events contain no secrets.

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
- graceful close, cancel, crash, and orphan cleanup.

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
fingerprint rejection using fixtures. Live social platforms are manual rollout
tests only.

### 26.6 Packaging tests

- Worker bundle exists for every target.
- Packaged path resolver finds it.
- Puppeteer and stealth dependencies resolve inside the worker bundle.
- Managed/system Chrome diagnostics work on Windows, macOS, and Linux.
- No remote-debugging listener is externally reachable.
- Packaged logs/source maps contain no planted canary secrets.

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

1. Add lease service and worker client.
2. Add runtime state machine, navigation policy, and cleanup.
3. Add cookie conversion/application and safe counts.
4. Add YouTube adapter and handoff.
5. Add refreshed-cookie private routing and persistence.
6. Add safe status IPC/UI with six-language translations and component tests.

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

| File/area                                               | Change                                 | Verification                      |
| ------------------------------------------------------- | -------------------------------------- | --------------------------------- |
| `src/schemas/worker/managedBrowser.ts`                  | Strict protocol unions                 | Schema fuzz/unit tests            |
| `src/entityTypes/managedBrowserTypes.ts`                | Shared safe contracts                  | Type check                        |
| `src/childprocess/managed-browser/*`                    | Browser-only runtime                   | Worker integration tests          |
| `src/service/ManagedBrowserWorkerClient.ts`             | Lifecycle/correlation/cancel           | Main unit tests                   |
| `src/service/ManagedBrowserLeaseService.ts`             | Account/global leases                  | Concurrency/crash tests           |
| `src/modules/ManagedBrowserModule.ts`                   | Orchestration and cookie bridge        | Main tests with injected services |
| `src/modules/AccountSessionService.ts`                  | Only small adapter additions if needed | Existing + refresh tests          |
| `src/config/skillsRegistry.ts`                          | Deferred browser tools                 | Tool catalog tests                |
| `src/service/BuiltInToolCapabilitiesPromptSection.ts`   | Browser capability guidance            | Prompt snapshot tests             |
| `src/service/ToolTimeoutPolicy.ts`                      | Browser/async classification if needed | Timeout tests                     |
| `src/main-process/communication/managed-browser-ipc.ts` | Validated IPC and AI gate              | IPC ordering tests                |
| `src/preload.ts`                                        | Narrow contextBridge API               | Renderer API tests                |
| `src/views/components/aiChatV2/*`                       | Status/approval/handoff UI             | Component + E2E tests             |
| `src/views/lang/*.ts`                                   | Six-language strings                   | Key parity test                   |
| `forge.config.js`, Vite worker config                   | Packaged worker entry                  | Build/package tests               |

Each logical implementation unit follows repository rules: no incomplete
commits, UI and component tests together, and worker entry/specific code only
under `src/childprocess/`.

## 29. Rollout and Operations

Feature gates are layered:

1. global managed-browser flag;
2. supported executable/fingerprint gate;
3. pilot platform allowlist;
4. account eligibility and session availability;
5. structured-actions flag;
6. privileged-script flag.

Rollout order: internal fixtures, internal authorized account, small opt-in
pilot, then platform-by-platform expansion. Metrics include ready/handoff rate,
authenticated reuse rate, action completion, approvals, cancellation latency,
orphan processes, refresh success, fingerprint failures, and secret-canary
violations. Metrics contain no page content or account secret.

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
8. Login/challenge/security flows always hand control to the user.
9. Stop, cancel, timeout, worker crash, and app shutdown leave no managed Chrome
   or account lease behind within the documented deadlines.
10. Main, worker, component, E2E, type, build, and packaging gates pass.
11. All UI text exists in all six supported languages.
12. The pilot platform has an adapter, authorized manual QA sign-off, rollback
    procedure, and no claim that stealth makes automation undetectable.
