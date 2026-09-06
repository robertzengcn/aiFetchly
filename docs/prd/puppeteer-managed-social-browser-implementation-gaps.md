# Puppeteer-Managed Social Browser: Remaining Implementation Gaps

## Document information

- **Status:** Open — implementation is not accepted against the PRD or technical design
- **Audit date:** 2026-09-06
- **Audited branch:** `worktree-managed-social-browser` at `4f3e6ff5`
- **Source requirements:**
  - [Puppeteer-Managed Social Browser PRD](./puppeteer-managed-social-browser-prd.md)
  - [Puppeteer-Managed Social Browser Technical Design](./puppeteer-managed-social-browser-technical-design.md)

## Purpose

This document is the closure checklist for requirements that are absent, only
partially implemented, incorrectly wired, or not supported by the verification
required by the PRD. A class, schema, test fixture, or renderer API is not
considered complete when no production caller connects it to the user flow.

The branch already contains a substantial foundation: strict protocols, one
utility process per session, account leases, cookie handoff and refresh,
fingerprint policy, bounded observations and actions, a YouTube adapter,
settings, cache scope isolation, IPC bridges, AI tools, translations, and unit
and component tests. Those implemented areas do not close the gaps below.

## Status definitions

- **Not implemented:** The required behavior or infrastructure is absent.
- **Partial:** Some required code exists, but the complete production behavior
  is missing or violates an invariant.
- **Verification gap:** The apparent implementation has not passed the test or
  manual evidence required for acceptance.
- **Deferred:** The PRD assigns the item to a later phase. It remains incomplete
  when assessing the entire PRD, but it does not block a deliberately scoped P0
  pilot unless the P0 acceptance criteria depend on it.

## Release blockers and incomplete P0 requirements

### MSB-GAP-01: Enforce consequential-action approval using the resolved target

- **Status:** Partial
- **Priority:** Blocker
- **Requirements:** PRD goal 9, FR-P0-009, FR-P1-004, section 11, acceptance
  criterion 12; technical design sections 15 and 17, Definition of Done item 7
- **Current evidence:** `ManagedBrowserAiToolService.runActions()` classifies
  each action using only its type and navigation URL. It does not provide the
  referenced element's role, accessible name, platform action descriptor, or
  intended effect to `BrowserActionRiskClassifier`. The source explicitly notes
  this gap. When a caller has `skipPermissionCheck`, an opaque click classified
  as `reversible_write` can execute without a new consequential-action prompt.
- **Reason it remains open:** A model can reference a Publish, Send, Delete,
  Follow, Upload, or Submit control without the main process recognizing that
  the target is consequential. A session/full-access grant must never bypass
  just-in-time approval for such an action.
- **Completion task:** Resolve every reference to a sanitized, revision-bound
  action descriptor before execution. Have the worker return or attest the
  target role/name and platform adapter effect code, classify that descriptor
  in the trusted host, and require a single-use approval containing account,
  origin, action, target, content summary, and effect. Revalidate the descriptor
  after approval and immediately before execution.
- **Required tests:** Publish/send/delete fixtures must require approval under
  every permission mode, including `full_access`; denial must cause no page
  effect; a target changed after preview must invalidate the approval.

### MSB-GAP-02: Correct observation-record and element-handle pairing

- **Status:** Partial
- **Priority:** Blocker
- **Requirements:** FR-TOOL-001 through FR-TOOL-004; acceptance criterion 12;
  technical design sections 14.2, 14.3, and 15.2
- **Current evidence:** `BrowserObservationService` filters collected records to
  visible elements, but pairs them by index with the unfiltered handle array.
  A hidden element before a visible element shifts the arrays and can bind the
  visible summary to the wrong handle.
- **Reason it remains open:** The tool can click or fill an element other than
  the element described to the model and user. This is both a correctness and
  consequential-action safety failure.
- **Completion task:** Produce records and handles from one stable identity
  pass. Prefer assigning an ephemeral DOM identity during one evaluated
  collection and resolving handles from that identity. Never filter only one
  side of a positional pairing.
- **Required tests:** Include hidden, detached, reordered, duplicate-name, and
  shadow/frame-adjacent elements before and between visible controls; assert
  that every returned reference operates on exactly its described element.

### MSB-GAP-03: Invalidate references on navigation and material DOM changes

- **Status:** Partial
- **Priority:** Blocker
- **Requirements:** FR-TOOL-001 through FR-TOOL-003; technical design sections
  14.2, 14.3, and 15.2
- **Current evidence:** Explicit action-driven navigation resets the registry,
  but no page listeners were found for reload, redirect, frame replacement,
  popup replacement, or material DOM change. Although `PageReferenceRegistry`
  accepts an expected role/name fingerprint, action execution calls `lookup()`
  without that fingerprint.
- **Reason it remains open:** Old references can survive page mutations or
  renderer-driven navigations and operate on detached or repurposed elements.
- **Completion task:** Advance the page revision on main-frame navigation,
  reload, relevant frame replacement, challenge resolution, and material DOM
  change. Recheck the stored role/name/DOM identity before every action and
  return a fresh observation on a stale-reference rejection.
- **Required tests:** Exercise client-side route changes, HTTP redirects,
  reloads, frame replacement, and target mutation between observe and action.

### MSB-GAP-04: Sanitize the complete observation payload

- **Status:** Partial
- **Priority:** Blocker
- **Requirements:** PRD non-goals 3-4, FR-COOKIE-006, FR-COOKIE-007, section
  10.2, section 14.3, acceptance criterion 3; technical design sections 14,
  19, and 24, Definition of Done item 3
- **Current evidence:** Element input summaries use secret checks, but the
  observation returns truncated `document.body.innerText` directly as
  `visibleText`. The standalone `redactSecrets()` function is not applied to
  that field or to the complete observation before it reaches the LLM.
- **Reason it remains open:** A page can visibly render a cookie, bearer token,
  API key, planted canary, password, or other secret and have it copied into the
  LLM tool result and conversation record.
- **Completion task:** Apply a single final sanitizer to all worker output that
  can reach renderer, LLM, logs, jobs, events, or audits. Redact secret-shaped
  content in visible text, titles, accessible names, values, errors, and URLs;
  keep sensitive-field notices without returning sensitive values.
- **Required tests:** Plant unique secrets in body text, title, labels, values,
  URL credentials/query, errors, screenshots metadata, action results, notices,
  logs, and job snapshots. Scan every renderer/LLM/audit/log output and prove
  that none contains the canary.

### MSB-GAP-05: Wire continuous challenge detection and the resolution policy

- **Status:** Partial
- **Priority:** Blocker
- **Requirements:** FR-HANDOFF-001 through FR-HANDOFF-005, FR-CAPTCHA-001,
  FR-CAPTCHA-002, FR-CAPTCHA-003, FR-CAPTCHA-007, FR-CAPTCHA-008, FR-P0-013,
  FR-P0-014, FR-P0-016; technical design section 18
- **Current evidence:** `ChallengeDetector`, adapter `detectChallenge()`, and
  `CaptchaResolutionPolicy` exist, but the runtime does not call adapter
  challenge detection after navigation or actions, and the main orchestration
  does not call `CaptchaResolutionPolicy`. Initial startup only handles a
  challenge when `assessAuthentication()` happens to return that state.
- **Reason it remains open:** CAPTCHA or robot verification appearing after an
  ordinary action may not stop the LLM. Stable challenge correlation,
  deduplication, main-process policy selection, revision advancement, and
  mandatory re-observation are not in the production path.
- **Completion task:** Detect challenges after every navigation and relevant
  action, assign a stable correlation ID, stop further actions, send the
  sanitized detection to the main process, invoke the policy there, and enter
  same-context handoff by default. After resolution, increment revision,
  validate origin and authentication, and force a new observation without
  replaying the prior action.
- **Required tests:** Deterministic login, MFA, recovery, payment, ambiguous,
  and non-login fixtures; redirect storms must emit one challenge and one chat
  notice; no consequential action may be replayed.

### MSB-GAP-06: Complete unexpected-exit and orphan-Chrome containment

- **Status:** Partial
- **Priority:** Blocker
- **Requirements:** FR-RUNTIME-007, FR-RUNTIME-010 through FR-RUNTIME-015;
  acceptance criteria 13, 14, and 19; technical design section 8.5 and
  Definition of Done item 10
- **Current evidence:** Unexpected worker exit calls
  `ManagedBrowserSupervisor.handleTerminal()`, which unregisters the session
  and releases the lease without attempting verified orphan-Chrome cleanup.
  Orphan cleanup is currently invoked only for heartbeat failure and shutdown.
  No Chrome `disconnected` event path was found. Process identity comparison
  checks IDs, nonce, executable identity, worker PID, and browser PID, but not
  the required launch time.
- **Reason it remains open:** A worker or Chrome crash can leave an authenticated
  Chrome process running. The documented process identity is not fully checked,
  and crash cleanup does not converge through the claimed path.
- **Completion task:** Preserve the expected identity through terminal cleanup,
  handle worker exit/error and Chrome disconnect explicitly, verify PID,
  executable identity, nonce, and launch-time window, then perform bounded
  process-tree cleanup before discarding the session record. Fail affected async
  jobs and emit exactly one sanitized terminal notice.
- **Required tests:** Real-process or faithful integration tests for worker
  crash, Chrome crash, hang, late heartbeat, PID reuse/mismatch, shutdown, and
  cancellation, with assertions for no orphan process and released lease.

### MSB-GAP-07: Build the saved-account selection and start flow

- **Status:** Partial
- **Priority:** High
- **Requirements:** PRD user stories 1 and 8, sections 8.1-8.3, FR-P0-001,
  FR-P0-002, acceptance criterion 1; technical design section 22.2
- **Current evidence:** Renderer API functions for eligible-account listing and
  session start exist, but no Vue component consumes them. The current session
  card only discovers an already active session.
- **Reason it remains open:** A user cannot select a saved Tool Account and
  start a managed browser through the specified product flow. An AI tool that
  accepts a numeric account ID is not a replacement for the required user
  selection and confirmation experience.
- **Completion task:** Add an account selector showing safe account/platform
  labels, purpose and optional start URL, eligibility/active-session states,
  and explicit start confirmation. Do not expose cookie data.
- **Required tests:** Component and E2E coverage for eligible selection, empty
  state, account already active, unsupported platform, setting/release gate,
  successful start, and manual-login transition.

### MSB-GAP-08: Connect chat notices, approval requests, progress, and screenshots

- **Status:** Partial
- **Priority:** High
- **Requirements:** FR-HANDOFF-005, FR-P0-009, FR-P0-013, FR-P0-014;
  acceptance criteria 10, 12, 17-19; technical design sections 18.2, 19, 20,
  and 22.2
- **Current evidence:** Main IPC emits status, approval, progress, chat-notice,
  and cache-progress events. The renderer API exposes subscriptions, but AI Chat
  does not consume the approval or chat-notice subscription. The session card
  consumes status only. It does not present the latest screenshot, elapsed
  time, current action/progress, proxy badge, or a distinct Pause AI control.
- **Reason it remains open:** Required transitions are not visible in the
  conversation, approval requests have no managed-browser UI, and the user
  cannot inspect all required live state.
- **Completion task:** Wire structured notices into the active conversation,
  add a just-in-time approval dialog, render rate-limited progress, retain only
  bounded ephemeral screenshot data for a latest-thumbnail view, and complete
  the session header/control specification.
- **Required tests:** Component and E2E tests for notice deduplication and
  localization, approval/deny, progress updates, screenshot display and cleanup,
  handoff, resume, stop, and crash.

### MSB-GAP-09: Enforce active-session behavior when settings change

- **Status:** Partial
- **Priority:** High
- **Requirements:** FR-SETTING-003 and FR-SETTING-004; acceptance criteria 21
  and 22; technical design sections 7.4 and 22.2
- **Current evidence:** New starts correctly check effective settings before
  worker creation and cookie decryption. The settings panel writes a disabled
  preference immediately and does not inspect active sessions or show the
  required stop-or-finish decision.
- **Reason it remains open:** Disabling during handoff or an in-flight action can
  silently change policy without the explicit active-session choice mandated by
  the PRD.
- **Completion task:** Before disabling, query active sessions and present
  Finish current session, Stop now, or Cancel. Preserve the current preference
  when the user cancels. Never silently terminate a handoff or consequential
  action.
- **Required tests:** Active ready, running, awaiting-approval, and handoff
  states; verify each user decision and gate ordering.

### MSB-GAP-10: Finish cache eviction, account removal, and selected-account UI

- **Status:** Partial
- **Priority:** High
- **Requirements:** FR-CACHE-001 through FR-CACHE-014, FR-P0-018,
  FR-P0-019; acceptance criteria 23-26; technical design sections 13.5-13.10
  and Definition of Done items 15-16
- **Current evidence:** Scope derivation, path validation, active locks, clear
  orchestration, deletion queue recovery, maintenance worker, and eviction
  planner exist. No production caller invokes `planEviction()`, so the 500 MB
  global limit, 200 MB per-account target, 30-day retention, and LRU policy are
  not enforced. `queueAccountRemoval()` exists but is never called by account
  deletion. The settings UI only clears all caches; it does not inspect or clear
  a selected account. Cache progress subscription currently has an empty body.
- **Reason it remains open:** Several cache requirements exist only as isolated
  services or tests. Real cache growth, account deletion, selected clearing,
  progress, cancellation, and performance containment are incomplete.
- **Completion task:** Schedule startup and at-most-daily eviction, enforce the
  configured maximum, connect successful account deletion to queued cache
  removal, add per-account status/clear controls and active-session choices,
  render progress, and preserve cancellation until deletion begins.
- **Required tests:** Repeat-load improvement, cache-disabled behavior,
  global/per-account eviction, retention, account deletion, active deferral,
  interruption recovery, symlink/path escape, selected/all clear, and packaged
  paths on Windows, macOS, and Linux.

### MSB-GAP-11: Honor the requested start URL and configured proxy

- **Status:** Partial
- **Priority:** High
- **Requirements:** PRD sections 8.3, 12.4, 14.1, and 16; FR-FP-007 through
  FR-FP-010; technical design sections 7.1, 12, and 21
- **Current evidence:** `requestedStartUrl` is accepted by IPC and tool schemas
  and passed into `ManagedBrowserModule.start()`, but it is not used. The start
  payload always sends `{ mode: "direct" }`; account or configured HTTP(S)
  proxy selection is not resolved for the managed session.
- **Reason it remains open:** The API promises a start target it ignores, and
  the P0 technical design's fixed-lifetime HTTP(S) proxy path is unavailable.
  DNS/WebRTC leak behavior has no release verification.
- **Completion task:** Validate the requested URL through navigation policy and
  navigate after authentication verification. Resolve the selected account's
  proxy in the main process, transfer credentials through the private typed
  channel, keep the proxy immutable for the session, and fail rather than
  silently falling back to direct mode.
- **Required tests:** Requested URL allow/deny matrix; direct and authenticated
  HTTP(S) proxy integration; no credentials in argv/logs; DNS/WebRTC leak and
  locale/timezone consistency fixtures.

## P1 requirements not implemented or incomplete

### MSB-GAP-12: Implement the privileged page-context script tool

- **Status:** Not implemented
- **Priority:** P1 blocker
- **Requirements:** FR-SCRIPT-001 through FR-SCRIPT-010, FR-P1-001; PRD section
  10.5 and P1 script acceptance criteria; technical design section 16 and
  implementation Phase D
- **Reason it remains open:** There is no `browser_evaluate_script` tool,
  request schema, exact-source approval UI, source hash, isolated execution
  wrapper, timeout/page invalidation mechanism, script audit handling, or
  adversarial script test suite.
- **Completion task:** Implement the complete technical-design contract. Do not
  execute model-generated Node.js, Puppeteer, Electron, shell, or filesystem
  code. Approval must show the complete script, account, origin, purpose,
  timeout, expected output, and write risk, and must be task/origin scoped.
- **Required tests:** Stale revision, timeout, page replacement, oversized and
  cyclic results, storage/cookie/token attempts, network and write effects,
  Node/Electron/filesystem unavailability, approval scope, and audit redaction.

### MSB-GAP-13: Add conditional/repeat actions and browser-created state handling

- **Status:** Not implemented
- **Priority:** P1
- **Requirements:** FR-P1-002, FR-P1-003, and FR-P1-005; technical design
  sections 15.1, 15.2, and implementation Phase C/D
- **Reason it remains open:** The action executor supports only the P0 flat
  action set. There are no bounded `if`/`repeat` program nodes, controlled tabs,
  popup policy flow, JavaScript-dialog handling, download policy, or
  file-chooser handling.
- **Completion task:** Add schema-bounded conditional/repeat nodes with total
  step/depth/wall-time limits. Add explicit states and user policy for popups,
  dialogs, downloads, file choosers, and multiple controlled tabs without
  exposing raw Puppeteer/CDP capability.
- **Required tests:** Limit exhaustion, cancellation inside loops, popup and tab
  origin enforcement, dialog pause/resume, download denial/approval, and file
  chooser handoff.

### MSB-GAP-14: Complete asynchronous continuation and cancellation integration

- **Status:** Partial
- **Priority:** P1
- **Requirements:** FR-P1-006, PRD sections 3.5 and 13.4; technical design
  section 20 and implementation Phase C
- **Current evidence:** Large action programs are marked asynchronous by the
  tool registry and emit coarse progress. No end-to-end evidence proves that
  cancelling a `ToolJobRegistry` job propagates to the active worker action,
  closes or safely pauses the browser, preserves effect-unknown state, and
  updates the browser session/chat consistently.
- **Reason it remains open:** Registry-level async execution alone does not
  satisfy the specified cancellation and local-continuation lifecycle.
- **Completion task:** Bind job cancellation and conversation teardown to the
  session request's cancellation token. Persist only sanitized bounded job
  state, mark uncertain effects, and allow status polling without retaining a
  remote model stream.
- **Required tests:** Cancel queued/running/finalizing jobs, app restart or chat
  teardown behavior, progress rate limiting, uncertain effect, and worker crash.

### MSB-GAP-15: Implement the policy-gated CAPTCHA provider adapter

- **Status:** Not implemented
- **Priority:** P1
- **Requirements:** FR-CAPTCHA-004 through FR-CAPTCHA-008 and FR-P1-008;
  acceptance criteria 11 and 20; technical design section 18.3 and Phase C.5
- **Reason it remains open:** The pure decision policy has no provider service,
  secure token retrieval, disclosure-consent setting, authorized-domain
  management, request-scoped call, fake provider, response application,
  timeout/cancellation, or single-attempt state.
- **Completion task:** Add a main-process-only provider service and keep all
  social/login/security domains denied until separately authorized. Provider
  failure must preserve the same browser for manual handoff.
- **Required tests:** Every policy gate, suffix-exact domain authorization,
  credential secrecy, request deduplication, one-attempt enforcement, timeout,
  cancellation, successful re-verification, and manual fallback.

## Deferred P2 requirements

### MSB-GAP-16: Complete the explicitly deferred durability and scale work

- **Status:** Deferred
- **Priority:** P2
- **Requirements:** FR-P2-001 through FR-P2-004; PRD sections 9.5 and 18
- **Incomplete work:** Separate security evaluation for opt-in persistent Chrome
  profiles; configurable resource budget and bounded multi-account concurrency;
  adapter/plugin extensibility without private browser internals; richer replay
  fixtures and deterministic job simulation.
- **Reason it remains open:** The current release deliberately fixes global
  concurrency at one, uses disposable authentication profiles, pilots YouTube,
  and provides unit-level fakes rather than a complete replay system.
- **Completion condition:** Each item receives its required security/design
  review and independent rollout gate. P2 must not be enabled merely to close a
  checklist.

## Test and acceptance gaps

### MSB-GAP-17: Add the mandatory integration, E2E, packaging, and manual gates

- **Status:** Verification gap
- **Priority:** Blocker for production pilot
- **Requirements:** PRD section 23, acceptance criteria 15, 25, and 26;
  technical design section 26 and Definition of Done items 3, 10, 11, 13,
  15, and 16
- **Current evidence:** Unit, main-process, utility, component, type, and
  renderer-build checks pass. No managed-browser Playwright spec, real
  worker/Chrome integration suite, packaged-worker verification, supported-OS
  cache/path matrix, performance gate, planted-secret end-to-end scan, or
  authorized YouTube manual-QA sign-off was found.
- **Reason it remains open:** Mock-based green tests do not prove that Electron
  can launch, supervise, package, and clean up real Chrome, or that cookies and
  cache remain contained across supported operating systems.
- **Completion task:** Implement the local fixture server and deterministic
  browser E2E harness described in technical design section 26. Exercise the
  packaged utility-process bundles and record authorized pilot QA and rollback
  evidence.
- **Required acceptance sequence:**
  1. Select a fixture Tool Account and launch visible headed Chrome.
  2. Verify fingerprint before any platform request.
  3. Apply fixture cookies, verify authentication, and refresh persistence.
  4. Observe and execute revision-bound actions with approval where required.
  5. Exercise same-context login and every challenge class.
  6. Stop, cancel, hang, crash the worker, and crash Chrome; verify no orphan or
     lease remains.
  7. Exercise cache reuse, disablement, eviction, selected/all clear, active
     deferral, interruption, and symlink containment.
  8. Scan renderer, conversation, tool jobs, events, logs, audits, and cache
     results for planted secrets.
  9. Package and run on Windows, macOS, and Linux.

## Verification already passing

The following checks passed during the 2026-09-06 audit:

| Command | Result |
| --- | --- |
| `yarn test:components` | 52 files, 333 tests passed |
| Managed-browser tests with `vite.main.config.mjs` | 17 files, 203 tests passed |
| Managed-browser tests with `vite.utilityCode.config.mjs` | 7 files, 124 tests passed |
| `yarn typecheck` | Passed |
| `yarn build` | Passed |

These checks establish a useful baseline but do not waive any missing test in
MSB-GAP-17.

## Recommended closure order

1. Fix consequential-action approval and reference-to-element correctness
   (MSB-GAP-01 through MSB-GAP-03).
2. Close observation secret leakage and add planted-secret scans (MSB-GAP-04).
3. Wire challenge detection/manual handoff and crash containment
   (MSB-GAP-05 and MSB-GAP-06).
4. Complete the P0 renderer and settings flows (MSB-GAP-07 through MSB-GAP-09).
5. Complete cache lifecycle and start/proxy behavior (MSB-GAP-10 and
   MSB-GAP-11).
6. Build the real worker/Chrome, E2E, packaging, cross-platform, and manual QA
   gates for the P0 pilot (MSB-GAP-17).
7. Implement and separately accept P1 scripts, advanced actions, async jobs,
   and optional CAPTCHA provider support (MSB-GAP-12 through MSB-GAP-15).
8. Address P2 only after its dedicated design and security gates
   (MSB-GAP-16).

The P0 pilot must not be marked complete until every P0 blocker and
MSB-GAP-17 is closed. The entire PRD must not be marked complete until the P1
and P2 items are either implemented and accepted or the source PRD is formally
re-scoped.
