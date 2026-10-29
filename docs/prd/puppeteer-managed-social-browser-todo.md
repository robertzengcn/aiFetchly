# Puppeteer-Managed Social Browser TODO

## Document status

- **Status:** Open
- **Created:** 2026-09-08
- **Audited branch:** `worktree-managed-social-browser`
- **Audited commit:** `2883352c`
- **Source:** [Puppeteer-Managed Social Browser PRD](./puppeteer-managed-social-browser-prd.md)

## Purpose

This checklist tracks PRD requirements that are not fully implemented or do
not yet have the verification required for acceptance. A task remains open
when code exists but the production flow is incomplete, when behavior differs
from the PRD, or when only mocked/unit coverage exists for a required real
browser or packaged-application path.

## P0 and release-blocking tasks

### TODO-MSB-001: Complete the real managed-browser E2E harness

- [ ] Seed a fixture Tool Account through the production Module layer.
- [ ] Start the real utility-process worker and headed Chrome through renderer
  IPC.
- [ ] Exercise cookie application/refresh, observation, actions, approval,
  handoff, cancellation, crash, cache, and cleanup paths.
- [ ] Remove the placeholder account setup and make the guarded test execute
  real assertions.
- [ ] Add packaged Windows, macOS, and Linux verification and record authorized
  YouTube pilot QA.
- **Reason incomplete:** `test/e2e/specs/managedBrowser.test.ts` is explicitly
  an environment-guarded scaffold. It currently returns a `null` account ID
  and asserts only fixture startup, window existence, and generic teardown.
  The file documents fingerprint, cookie persistence, challenge, crash, cache,
  packaging, cross-platform, and manual-QA paths as still open.
- **Requirements:** PRD sections 23.2, 23.5, 23.6; acceptance criteria 13-15,
  19, 25, and 26.
- **Done when:** The complete fixture flow runs without third-party services,
  all required crash/cleanup and planted-secret assertions pass, and packaged
  OS results are recorded.

### TODO-MSB-002: Make consequential approvals always-confirm and target-bound

- [ ] Enforce consequential approval even when generic permission mode sets
  `skipPermissionCheck` or grants `full_access`.
- [ ] Bind an approval to the exact session, request/program digest, account,
  origin, page revision, resolved targets, content/effect summary, and action
  count.
- [ ] Consume approval by its request/digest rather than consuming any fresh
  approval for the same session.
- [ ] Revalidate the target descriptor and revision immediately before the
  approved effect.
- [ ] Add publish/send/delete fixtures for allow, deny, full-access, target
  mutation, and revision mutation.
- **Reason incomplete:** `ManagedBrowserAiToolService.runActions()` only enters
  the consequential approval path when `skipPermissionCheck` is false, and
  `consumeApprovalForSession()` can authorize a later unrelated program in the
  same session.
- **Requirements:** PRD goal 9, section 11, FR-P0-009, FR-P1-004; acceptance
  criterion 12.
- **Done when:** No permission mode bypasses always-confirm actions and an
  approval cannot authorize a different target, revision, or program.

### TODO-MSB-003: Complete the browser session header and conversation UI

- [ ] Add a distinct **Pause AI** control in addition to **Take over** and
  **Stop browser**.
- [ ] Show proxy-active status and conversation ownership without credentials.
- [ ] Show elapsed time for the whole active session, not only after progress
  appears.
- [ ] Insert login, challenge, resume, crash, and terminal notices into the
  conversation as structured messages rather than only listing them in the
  session card.
- [ ] Show a bounded, ephemeral latest screenshot when allowed and clear it on
  handoff/termination.
- [ ] Add the Tool Account **Open managed browser** entry point.
- [ ] Add component and E2E tests for all states, controls, notices, screenshot
  retention, long labels, narrow layout, and keyboard operation.
- **Reason incomplete:** `SafeManagedBrowserStatus` has no proxy or
  conversation fields. `ManagedBrowserSessionCard.vue` has Take over and Stop
  but no distinct Pause control, nests notices in the card, and has no
  screenshot surface. No social-account page action starts the managed
  browser.
- **Requirements:** PRD sections 8.1, 8.2, 8.4, 8.6; FR-P0-009,
  FR-P0-013, FR-P0-014; acceptance criteria 10 and 17-19.
- **Done when:** Every required owner/state/control is visible and accessible,
  notices appear in the conversation lifecycle, and the complete UI flow is
  covered by component and E2E tests.

### TODO-MSB-004: Fix active-session disable semantics

- [ ] Make **Finish current session** preserve the running session and disable
  only new starts until it terminates naturally.
- [ ] Keep **Stop now** as the explicit immediate cancellation path.
- [ ] Preserve the setting and active session when the user cancels.
- [ ] Cover ready, running, awaiting-approval, and handoff states.
- **Reason incomplete:** Both `finish` and `stop` branches in
  `ManagedBrowserSettingsPanel.vue` call `stopManagedBrowser()` immediately;
  they differ only in the stop reason.
- **Requirements:** FR-SETTING-004; acceptance criterion 22.
- **Done when:** Finish, Stop, and Cancel have distinct PRD-defined behavior
  and never silently terminate handoff or an in-flight consequential action.

### TODO-MSB-005: Finish settings and selected-account cache controls

- [ ] Fix selected-account confirmation so its confirmation ID reaches
  `onConfirmClear()`.
- [ ] Present **Stop and clear now**, **Clear when this browser closes**, and
  **Cancel** when the selected scope is active.
- [ ] Add the editable maximum-cache setting with the validated 100-2048 MB
  range.
- [ ] Show selected-account approximate size in the confirmation, not the
  all-cache size.
- [ ] Add cancellation-before-deletion, empty, deferred, partial failure,
  retry, and success UI states.
- [ ] Update component tests so managed-browser API mocks include the selected
  account APIs and assert the real clear request.
- **Reason incomplete:** The selected-account flow assigns
  `pendingAccountConfirmation` but not `pendingConfirmationId`, so confirming
  returns without clearing. Active selected scopes are always deferred without
  offering the required choice. The maximum-cache preference exists in the
  backend but has no settings control.
- **Requirements:** PRD section 8.9; FR-CACHE-004, FR-CACHE-007,
  FR-P0-017, FR-P0-019; acceptance criteria 21, 22, and 24.
- **Done when:** Selected and all-cache clearing work through confirmed,
  user-selected policies and every configured setting is available in the UI.

### TODO-MSB-006: Add real cache and cleanup acceptance verification

- [ ] Demonstrate warm-load improvement and cache-disabled cold behavior.
- [ ] Verify global/per-account eviction, 30-day retention, LRU selection, and
  browser-version namespace changes with real cache artifacts.
- [ ] Verify active-session deferral, interrupted deletion recovery,
  clear-on-exit, and account removal end to end.
- [ ] Verify canonical path and symlink containment in packaged builds on every
  supported OS.
- [ ] Verify clearing never changes encrypted cookies, account records,
  downloads, or unrelated caches.
- **Reason incomplete:** Scheduler, eviction planner, worker, and queue unit
  tests exist, but the PRD requires repeat-load, crash, symlink, packaged-path,
  and cross-platform evidence that the current skipped E2E scaffold does not
  provide.
- **Requirements:** FR-CACHE-001 through FR-CACHE-014, FR-P0-018,
  FR-P0-019; acceptance criteria 23-26.
- **Done when:** Real and packaged cache tests pass on supported platforms and
  documented performance evidence supports enabling persistent cache.

### TODO-MSB-007: Finish crash, hang, and orphan-process verification

- [ ] Exercise real worker exit/error, protocol violation, missed heartbeat,
  Chrome disconnect, UI cancellation, and app shutdown.
- [ ] Test valid cleanup and refusal for PID reuse, nonce mismatch, executable
  mismatch, and launch-time mismatch.
- [ ] Assert that leases, active cache scopes, pending jobs, temporary profiles,
  the worker, and Chrome descendants all converge through one terminal path.
- [ ] Assert one sanitized crash notice and preservation of the last valid
  cookie snapshot.
- **Reason incomplete:** Supervision and cleanup code has unit coverage, but no
  real-process integration or E2E test proves that authenticated Chrome cannot
  be orphaned or that Electron remains responsive after every failure mode.
- **Requirements:** FR-RUNTIME-007, FR-RUNTIME-010 through FR-RUNTIME-015;
  acceptance criteria 13, 14, and 19.
- **Done when:** Every real failure path leaves no verified descendant process,
  no lease, and no blocked main application.

### TODO-MSB-008: Complete navigation and network policy enforcement

- [ ] Validate every redirect before committing navigation.
- [ ] Add supported request interception for subresources and block prohibited
  loopback/private/link-local/cloud-metadata destinations.
- [ ] Add DNS/WebRTC proxy-leak verification and immutable proxy tests.
- [ ] Add explicit policy/approval handling for a new registrable domain.
- [ ] Ensure proxy failure cannot fall back to direct mode in every startup and
  reconnect path.
- **Reason incomplete:** Explicit top-level navigation is validated, but
  `NavigationPolicy.ts` documents DNS rebinding/interception as a later item
  and the worker has no request-interception path for redirects or
  subresources.
- **Requirements:** PRD sections 12.4 and 14.1; FR-FP-007 through FR-FP-010.
- **Done when:** Controlled redirect, subresource, DNS, WebRTC, and proxy
  fixtures prove that no disallowed request or silent direct fallback occurs.

## P1 advanced-automation tasks

### TODO-MSB-009: Complete privileged page-context script execution

- [ ] Require a returning function body and add the required
  `expected_output` input.
- [ ] Pass and validate `page_revision` in the main process and worker before
  execution.
- [ ] Show account, origin, purpose, complete source, timeout, expected output,
  and write risk in the approval dialog.
- [ ] Make script approval always-confirm and bind it to the exact source hash,
  task, origin, session, and revision.
- [ ] Detect write-capable script behavior and apply consequential-action
  policy.
- [ ] Reject sensitive storage/cookie/token results rather than merely
  redacting a serialized value.
- [ ] Enforce serialization depth, cyclic-result, byte, and type limits.
- [ ] On timeout, terminate/invalidate or recreate the affected page so the
  script cannot continue running after a timeout result.
- [ ] Add adversarial worker integration and E2E tests.
- **Reason incomplete:** The schema omits `expected_output`; the parsed revision
  is not sent to `ManagedBrowserModule.evaluateScript()`; the managed-browser
  approval carries only a short summary; `skipPermissionCheck` can bypass the
  confirmation; and timeout is implemented with `Promise.race()` without
  stopping or invalidating the page.
- **Requirements:** FR-SCRIPT-001 through FR-SCRIPT-010, FR-P1-001; all P1
  script acceptance criteria.
- **Done when:** Every script acceptance case passes against a real page and no
  execution can outlive its deadline or escape page context.

### TODO-MSB-010: Complete the structured action contract

- [ ] Add structured observe and semantic find actions.
- [ ] Add hover, clear, back, forward, reload, screenshot, structured stop, and
  request-handoff actions.
- [ ] Apply risk classification and trusted target descriptors recursively to
  actions inside `if` and `repeat`, not only top-level actions.
- [ ] Report each action ID and the PRD-required before/after URL/title and
  resulting revision fields.
- [ ] Add cancellation and failure-threshold coverage inside nested programs.
- **Reason incomplete:** The shared schema currently supports navigate, click,
  fill, select, keypress, scroll, wait, extract, `if`, and `repeat`. The other
  action types required by PRD section 10.4 are absent, and main-process target
  augmentation/classification maps only the top-level array.
- **Requirements:** PRD section 10.4, FR-P0-008, FR-P1-002.
- **Done when:** The complete bounded action vocabulary shares one schema across
  AI and worker validation, including recursive risk and cancellation handling.

### TODO-MSB-011: Implement controlled browser-created states and tabs

- [ ] Replace unconditional dialog dismissal, popup closure, and download
  cancellation with explicit bounded states and safe status/notices.
- [ ] Add reviewed policies for dialog response, popup origin validation,
  downloads, permission prompts, protocol handlers, and file choosers.
- [ ] Add bounded multi-tab ownership inside one account context.
- [ ] Invalidate references and re-observe on controlled page/tab changes.
- **Reason incomplete:** The worker currently dismisses dialogs, closes popups,
  and cancels downloads without entering the explicit controlled states
  required by the PRD. File chooser and multi-tab support are absent.
- **Requirements:** FR-P1-003, FR-P1-005; PRD sections 10.4 and 14.1.
- **Done when:** Every browser-created state pauses or follows an explicit
  policy, is visible to the user, and is covered by worker and E2E tests.

### TODO-MSB-012: Add reviewed platform consequential-action descriptors

- [ ] Extend the platform adapter contract with stable effect descriptors,
  preview builders, maximum counts, and rate policies.
- [ ] Add YouTube descriptors for publish/comment/reply/delete/upload/subscribe
  and other pilot effects.
- [ ] Use adapter descriptors in trusted main-process classification and bind
  them to approval.
- [ ] Add sanitized fixture coverage for every enabled effect.
- **Reason incomplete:** `PlatformBrowserAdapter` currently provides login,
  challenge, readiness, origin, and sensitive-field facts only. Consequential
  classification relies primarily on generic role/name text matching.
- **Requirements:** FR-P1-004; PRD sections 11 and 15.
- **Done when:** Every consequential pilot action has a reviewed adapter-owned
  descriptor and cannot execute without its matching preview approval.

### TODO-MSB-013: Finish the optional CAPTCHA provider flow

- [ ] Extract a supported challenge type and site key without exposing private
  page content.
- [ ] Send eligible provider input to the main process through a strict private
  message.
- [ ] Apply a successful provider response in the worker without exposing the
  response to renderer, LLM, logs, analytics, or audit details.
- [ ] Increment revision, revalidate origin/authentication, and force a fresh
  observation after resolution.
- [ ] Never replay the triggering consequential action.
- [ ] Add success, failure, timeout, cancellation, deduplication, and manual
  fallback integration/E2E tests with a fake provider.
- **Reason incomplete:** `ManagedBrowserModule.runChallengePolicy()` passes an
  empty site key and explicitly states that the solved token is not applied.
  Worker challenge events currently report provider input as unavailable, so
  the provider cannot complete the production flow.
- **Requirements:** FR-CAPTCHA-004 through FR-CAPTCHA-008, FR-P1-008;
  acceptance criteria 11 and 20.
- **Done when:** One eligible, explicitly authorized non-login challenge can be
  solved end to end, while every ineligible/failing path stays in the same
  browser for manual handoff.

### TODO-MSB-014: Complete async job durability and conversation teardown

- [ ] Verify queued, running, handoff, finalizing, completed, failed, and
  cancelled job states end to end.
- [ ] Persist only bounded sanitized job state required for local continuation.
- [ ] Cancel or safely pause browser work when its conversation is deleted or
  the app restarts.
- [ ] Preserve and surface `effect: unknown` when cancellation races a
  consequential action.
- [ ] Verify progress rate limiting through the actual renderer and job
  registry pipeline.
- **Reason incomplete:** Large programs are registered as async and AbortSignal
  cancellation is wired, but the required restart, teardown, finalization,
  uncertain-effect, and real-worker lifecycle has only unit-level evidence.
- **Requirements:** FR-P1-006; PRD sections 3.5 and 13.4.
- **Done when:** Long jobs continue locally without a remote stream and every
  cancellation/teardown path reaches one correct terminal state.

### TODO-MSB-015: Resolve the screenshot tool contract mismatch

- [ ] Register the PRD tool name `browser_screenshot`, or formally update the
  PRD and all consumers to use `browser_capture_screenshot`.
- [ ] Supply the screenshot to the active conversation only when explicitly
  needed and approved, while retaining it ephemerally.
- [ ] Disable automated screenshots in sensitive handoff states.
- [ ] Add size, redaction, retention, handoff, and cleanup tests.
- **Reason incomplete:** The registry exposes `browser_capture_screenshot`
  instead of the required `browser_screenshot` and returns metadata only; no
  conversation screenshot surface or sensitive-state retention flow exists.
- **Requirements:** PRD sections 10.1, 14.3, and 19.4; FR-P0-008.
- **Done when:** The implemented name and behavior match the accepted contract
  and screenshot bytes cannot leak or persist outside the bounded UI flow.

## P2 deferred tasks

### TODO-MSB-016: Perform the persistent-profile security evaluation

- [ ] Produce a separate security design and threat review for an opt-in
  persistent Chrome profile.
- [ ] Keep disposable authentication profiles as the only implementation until
  that review is accepted.
- **Reason incomplete:** This is explicitly deferred by the PRD and no accepted
  evaluation or opt-in implementation exists.
- **Requirements:** FR-P2-001.

### TODO-MSB-017: Add configurable resource budgets and bounded concurrency

- [ ] Define measured CPU, memory, process, disk, and session limits.
- [ ] Replace the fixed global concurrency of one with a validated,
  configurable budget before allowing multi-account concurrency.
- [ ] Prove account/profile/cache isolation under concurrency.
- **Reason incomplete:** The current global session limit is fixed at one and
  no measured multi-account resource-budget implementation exists.
- **Requirements:** FR-P2-002.

### TODO-MSB-018: Add safe platform adapter/plugin extensibility

- [ ] Define a versioned adapter/plugin API exposing only reviewed platform
  facts and browser commands.
- [ ] Prevent plugins from accessing Puppeteer objects, worker internals,
  cookies, database services, and host secrets.
- [ ] Add compatibility, permission, and malicious-plugin tests.
- **Reason incomplete:** An internal TypeScript adapter interface exists, but
  there is no plugin lifecycle, compatibility contract, or sandboxed external
  extension surface.
- **Requirements:** FR-P2-003.

### TODO-MSB-019: Add deterministic browser-job replay and richer fixtures

- [ ] Record sanitized deterministic page/action/challenge fixtures.
- [ ] Add replay for navigation, actions, scripts, handoff, failures, and
  recovery without live third-party accounts.
- [ ] Add development tooling for repeatable job simulation.
- **Reason incomplete:** Current unit fakes and the loopback fixture server do
  not provide the richer deterministic replay system described by P2.
- **Requirements:** FR-P2-004.

## Cross-cutting acceptance work

### TODO-MSB-020: Complete security, privacy, performance, and audit gates

- [ ] Run planted-secret scans across worker messages, renderer payloads, LLM
  results, chat, jobs, logs, audits, screenshots, and packaged artifacts.
- [ ] Prove startup, observation, Stop, and cache-maintenance performance
  targets from PRD section 19.3.
- [ ] Verify safe operational audit events and forbidden-log exclusions.
- [ ] Verify browser title identification, non-color-only state, keyboard
  access, complete approval labels, and six-language behavior in the real UI.
- [ ] Record success-metric baselines for the pilot cohort.
- **Reason incomplete:** Unit tests and translation parity pass, but no complete
  E2E secret scan, performance report, packaged-log scan, accessibility audit,
  or pilot metrics evidence exists.
- **Requirements:** PRD sections 17, 19, 23, 24, and 25.
- **Done when:** Every non-functional and acceptance gate has repeatable test or
  recorded manual evidence and the P0/P1 release checklist is fully green.

## Verification baseline at creation

The following checks passed during the 2026-09-08 audit:

| Check | Result |
| --- | --- |
| `yarn typecheck` | Passed |
| `yarn build` | Passed |
| Managed-browser main Vitest suite | 19 files, 241 tests passed |
| Managed-browser utility Vitest suite | 7 files, 136 tests passed |
| `yarn test:components` | 53 files, 345 tests passed, with non-fatal mock/i18n warnings |
| Managed-browser Playwright E2E | Skipped scaffold; acceptance flow not implemented |

Passing unit, component, type, and build checks does not close a TODO whose
completion condition requires a real browser, packaged application, supported
OS matrix, security scan, performance evidence, or authorized manual QA.
