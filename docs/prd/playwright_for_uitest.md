# PRD: Automated Electron UI Testing Pipeline

Technical design: `docs/prd/playwright-ui-testing-technical-design.md`

## 1. Objective

Establish a reliable automated end-to-end (E2E) testing pipeline for the
AiFetchly Electron desktop application. The pipeline will use Playwright to
validate critical user workflows across the Vue renderer, preload bridge,
Electron main process, IPC handlers, and local persistence.

The initial pipeline will run on Linux in GitHub Actions and will use
deterministic substitutes for external AI services. It must not use developer
data, production credentials, or live LLM requests.

## 2. Background

AiFetchly currently relies heavily on manual UI testing. The application now
contains workflows that span several runtime boundaries:

```text
Vue renderer -> contextBridge/preload -> Electron IPC -> modules/models
                                                |             |
                                                |             +-> SQLite
                                                +-> AI and other external services
```

Regressions can therefore occur even when renderer and service unit tests pass.
Examples include mismatched preload contracts, incorrectly registered IPC
handlers, AI stream events that the UI cannot render, invalid persistent state,
and packaged applications that cannot locate their renderer assets.

The project already uses Mocha and Vitest for unit and integration tests. The
Playwright suite will complement those tests rather than replace them.

## 3. Goals

- Detect regressions in critical user workflows before merge.
- Exercise the real preload bridge and IPC handlers in Electron integration
  tests.
- Make AI workflows deterministic without contacting a live LLM.
- Give developers enough artifacts to diagnose a CI failure quickly.
- Keep the required pull-request suite fast enough for normal development.
- Ensure tests never read or modify a developer's or CI user's real AiFetchly
  data.

## 4. Non-Goals

- Calling live OpenAI, Anthropic, or other paid AI APIs in required CI tests.
- Replacing existing Mocha or Vitest unit and service tests.
- Full cross-platform E2E coverage in the initial release.
- Exhaustively testing every third-party website or scraper through its live
  network interface.
- Testing OS installer flows. Packaging and installer verification remain
  separate concerns.
- Using E2E-only switches as a production feature or general-purpose debug API.

## 5. Test Architecture

The solution will use three test levels. Each level has a different purpose and
must not be described collectively as a single kind of "UI test."

### 5.1 Renderer UI Tests

Renderer UI tests exercise Vue components or pages with a typed replacement for
the `window.api` preload contract.

Use these tests for:

- Rendering and interaction behavior that does not require Electron.
- Empty, loading, success, error, and permission states.
- Fast coverage of many AI stream and tool-result variants.
- Accessibility and stable locator verification.

These tests do not prove that preload or main-process IPC wiring works.

### 5.2 Electron Integration Tests

Electron integration tests launch the application with Playwright's Electron
support and exercise this path:

```text
real renderer -> real preload -> real IPC handler -> real module/model
                                              |
                                              +-> deterministic test dependency
```

These tests are the primary E2E suite for pull requests. They use the real
contextBridge API, IPC handler registration, and an isolated SQLite database.
Only nondeterministic external dependencies, such as the LLM transport, are
substituted.

Tests must not replace the renderer-to-main IPC layer when their purpose is to
validate IPC integration. Mocking the IPC handler itself is allowed only in a
test explicitly categorized as a renderer UI test.

### 5.3 Packaged Application Smoke Tests

Packaged smoke tests launch the packaged Linux executable and verify that:

- The application starts successfully.
- The primary renderer window loads.
- The preload bridge is available.
- A small critical workflow completes.

The packaged suite must remain small. Building a complete package for every UI
test would conflict with the pull-request runtime target and duplicate the
existing package verification pipeline.

## 6. Functional Requirements

| ID | Requirement | Priority | Description |
| --- | --- | --- | --- |
| F-01 | Application launch | High | Playwright must launch built AiFetchly Electron artifacts and obtain the primary renderer window. |
| F-02 | UI interaction | High | Tests must locate controls, enter input, activate commands, and assert visible application state. |
| F-03 | Preload contract | High | Electron integration tests must use the real contextBridge/preload API with `nodeIntegration` disabled and `contextIsolation` enabled. |
| F-04 | IPC integration | High | At least one test per critical workflow must exercise the real renderer-to-main IPC path. |
| F-05 | Deterministic AI | High | AI workflows must use a deterministic fake LLM transport or local fake server, not mocked IPC handlers. |
| F-06 | AI enablement | High | Fixtures must explicitly configure AI access, including coverage of the disabled state and the existing `USER_AI_ENABLED` gate where applicable. |
| F-07 | State isolation | High | Every test worker must use unique temporary user-data, database, workspace, and download directories. |
| F-08 | Network isolation | High | Required CI tests must block or fail unexpected external network requests. |
| F-09 | Native dialogs | Medium | Tests must cover success and cancellation behavior for required native dialogs through a controlled main-process test dependency. |
| F-10 | Persistent state | Medium | Selected tests must verify expected state after closing and restarting the application with the same isolated fixture directory. |
| F-11 | Failure artifacts | High | Failed tests must retain a Playwright trace, screenshot, renderer console output, main-process logs, and video where useful. |
| F-12 | CI execution | High | The required suite must run for pull requests targeting the repository's protected integration branch or branches, currently selected from `dev`, `test`, and `master`. |
| F-13 | Packaged smoke | Medium | The existing Linux packaging job must run the minimal packaged application smoke suite after package verification. |

## 7. Non-Functional Requirements

| ID | Requirement | Priority | Description |
| --- | --- | --- | --- |
| NF-01 | Performance | High | The required Electron E2E pull-request suite should complete in under 5 minutes and must complete in under 10 minutes, excluding packaging. |
| NF-02 | Reliability | High | The first-attempt pass rate must be at least 99% on the protected branch over a rolling 30-day period. |
| NF-03 | Flake visibility | High | Retries may collect diagnostics but must not hide first-attempt failures from flake reporting. |
| NF-04 | Headless Linux | High | CI must run Electron under `xvfb-run` or an equivalent virtual display on the pinned Ubuntu runner. |
| NF-05 | Test independence | High | Tests must pass individually, in the full suite, and in any execution order. |
| NF-06 | Parallel safety | High | Parallel workers must not share mutable files, ports, databases, Electron stores, or workspaces. |
| NF-07 | Security | High | Test-only dependency selection must require an explicit E2E environment flag and must fail closed in packaged production builds. |
| NF-08 | Maintainability | Medium | Fixtures, selectors, and scenario payloads must be typed TypeScript with no `any` usage. |

## 8. Deterministic Dependency Strategy

### 8.1 AI Transport

The preferred substitution boundary is the outbound AI transport, not Electron
IPC. Production IPC handlers and AI orchestration should remain active during
Electron integration tests.

The implementation may use either:

1. A dependency-injected fake implementation selected before IPC registration.
2. A local HTTP/SSE fixture server configured as the AI service endpoint.

The fake must support reusable, typed scenarios for:

- A normal streamed text response.
- Multiple stream chunks with controlled timing.
- A tool call and tool result.
- A tool call that requires user approval.
- An AI service error.
- A malformed stream event.
- User cancellation during streaming.
- Delayed output for loading and stop-button assertions.

The suite must fail if a required test attempts to reach an unapproved external
host.

### 8.2 Database And Application State

Before launching Electron, the test fixture must create a unique temporary root
containing:

```text
<temp-root>/
├── user-data/
├── database/
├── workspace/
├── downloads/
└── logs/
```

The main process must set Electron's `userData` path before services that use it
are initialized. The database path must continue to flow through `Token` and
`USERSDBPATH`; tests must not introduce direct database access in IPC handlers
or worker processes.

Fixtures may seed state through Model and Module APIs, a dedicated fixture
builder, or an initialized fixture database copied before launch. Direct ad hoc
SQL in individual test files is not allowed.

### 8.3 Authentication And AI Access

Required E2E tests must not depend on a remote login service. Fixtures must
provide deterministic authenticated, unauthenticated, AI-enabled, and
AI-disabled states without production tokens.

Fake tokens and settings must be stored only inside the temporary test root.

### 8.4 Native Dialogs

Native open/save dialogs cannot be automated reliably through DOM interaction.
The main process should accept a narrowly scoped dialog dependency that returns
configured test paths or cancellation results when E2E mode is enabled.

Tests should still activate the real renderer command and IPC handler. They
should replace only the native OS interaction.

## 9. Testability And Security Rules

- E2E mode must be enabled explicitly, for example with `AIFETCHLY_E2E=1`.
- Test dependency configuration must be validated before the main window and
  IPC handlers are created.
- Production packages must reject or ignore E2E dependency overrides.
- The renderer must not receive a generic method for replacing IPC handlers or
  executing main-process JavaScript.
- Fixture APIs must expose only the minimum capabilities needed by tests.
- Test logs and artifacts must redact tokens, credentials, and user content.
- Worker processes must continue to send persistence requests to the main
  process and must not receive direct database access for E2E convenience.

## 10. Selectors And UI Test Conventions

- Prefer Playwright locators based on role and accessible name.
- Use `data-testid` for dynamic, repeated, virtualized, or translated controls
  where an accessible locator is not stable enough.
- Do not use CSS implementation details such as Vuetify-generated class names.
- Do not use visible translated strings as the only locator for critical
  controls.
- Test IDs are part of the test contract and should describe user intent, for
  example `ai-chat-send`, not styling or DOM position.
- Wait for observable states or events rather than fixed sleeps.
- Every Electron test must close the application in teardown, including after
  failure.

## 11. Initial Critical-Path Test Matrix

| ID | Level | Scenario | Expected Result |
| --- | --- | --- | --- |
| T-01 | Electron | Launch application | Primary window renders and no unexpected startup error is logged. |
| T-02 | Electron | Inspect renderer security boundary | Preload API is available; direct Node.js APIs are unavailable. |
| T-03 | Electron | Navigate to AI chat | Chat composer and model state render through the real preload/IPC path. |
| T-04 | Electron | AI disabled | The request is rejected by the AI access gate and no AI transport call occurs. |
| T-05 | Electron | Stream deterministic response | User message and all assistant chunks render in order; completion state is reached. |
| T-06 | Electron | Stop active response | Streaming stops and the composer returns to an actionable state. |
| T-07 | Electron | Tool approval required | The tool does not execute before approval and the approval UI contains the expected operation. |
| T-08 | Electron | Approve tool | The permitted tool executes and its result appears in the conversation. |
| T-09 | Electron | Reject tool | The tool does not execute and the rejection state is visible. |
| T-10 | Electron | AI transport failure | A recoverable, user-safe error is shown and the next message can be submitted. |
| T-11 | Electron | Native dialog cancellation | Cancellation leaves the UI and persisted state unchanged. |
| T-12 | Electron | Restart with isolated state | Expected conversation or setting persists after a controlled restart. |
| T-13 | Packaged | Launch packaged executable | Renderer HTML and preload load successfully in the packaged layout. |

Renderer UI tests should provide broader coverage of message types, tool-result
variants, empty states, and layout behavior without duplicating every scenario
at the Electron level.

## 12. Proposed Repository Layout

```text
test/
└── e2e/
    ├── fixtures/
    │   ├── electronApp.ts
    │   ├── testState.ts
    │   └── fakeAiServer.ts
    ├── scenarios/
    │   └── aiChatScenarios.ts
    ├── specs/
    │   ├── appLaunch.test.ts
    │   ├── aiChat.test.ts
    │   ├── toolApproval.test.ts
    │   └── persistence.test.ts
    └── support/
        ├── logCollector.ts
        └── networkGuard.ts
playwright.config.ts
```

Suggested package scripts:

```json
{
  "test:e2e": "playwright test",
  "test:e2e:headed": "playwright test --headed",
  "test:e2e:debug": "playwright test --debug",
  "test:e2e:report": "playwright show-report"
}
```

The final build command must be established by the Phase 1 spike. It must build
the renderer, preload, and main-process artifacts required by
`_electron.launch()` without requiring a full installer build.

## 13. CI Design

### 13.1 Pull-Request Job

Add a dedicated Electron E2E job to the existing CI workflow or a separate
workflow with equivalent branch protection. It should:

1. Check out the repository.
2. Use the same pinned Node.js and Python versions as the existing CI workflow.
3. Install dependencies with `yarn install --frozen-lockfile`.
4. Install required Playwright/Electron Linux system dependencies.
5. Build the main process, preload, and renderer E2E artifacts.
6. Run the suite with `xvfb-run`.
7. Upload reports and diagnostics with `if: always()`.

The job must run for pull requests to the selected protected branch or branches.
The repository currently uses `dev`, `test`, and `master`; implementation must
confirm which of these are protected before adding the workflow trigger.

### 13.2 Packaged Smoke Job

The existing Linux package-smoke job should invoke T-13 after its package layout
verification. The Playwright test must reuse the package output rather than
building another package.

### 13.3 Artifact Policy

On failure, upload:

- Playwright HTML report.
- Playwright trace archive.
- Screenshots.
- Relevant videos.
- Renderer console and page errors.
- Main-process stdout/stderr and application logs.
- Fake AI server request log with sensitive values redacted.

Artifacts should use a short retention period appropriate for pull-request
diagnostics.

## 14. Implementation Plan

### Phase 1: Launch And Isolation Spike

1. Add `@playwright/test` and `playwright.config.ts`.
2. Establish the source-build command for main, preload, and renderer artifacts.
3. Launch the built app with `_electron.launch()`.
4. Add an E2E-only isolated `userData` path before application initialization.
5. Implement T-01 and T-02.
6. Verify repeatability across at least 20 consecutive local runs.

Exit criteria:

- The app launches without the Forge development server controlling the
  Electron process.
- No real user state is read or written.
- Startup and shutdown are reliable with no orphaned Electron processes.

### Phase 2: Deterministic AI Boundary

1. Introduce the testable AI transport boundary.
2. Add the fake AI scenarios and outbound network guard.
3. Add deterministic authentication and AI-access fixtures.
4. Implement T-03 through T-10.
5. Add stable selectors only where accessible locators are insufficient.

Exit criteria:

- Tests use real preload and IPC handlers.
- No live AI or login requests occur.
- Tool execution is asserted before and after approval decisions.

### Phase 3: Persistence And Native Behavior

1. Add controlled native dialog dependencies.
2. Add typed state builders and database initialization.
3. Implement T-11 and T-12.
4. Validate parallel execution with isolated directories.

Exit criteria:

- Tests pass individually, in random order, and with the configured worker
  count.
- Restart tests retain only their own intended state.

### Phase 4: CI And Packaged Smoke

1. Add the pull-request E2E job and correct protected-branch trigger.
2. Configure `xvfb-run`, timeouts, caching, and failure artifacts.
3. Implement T-13 against the existing package-smoke output.
4. Intentionally introduce representative failures to verify report quality.
5. Record duration and first-attempt reliability for the initial baseline.

Exit criteria:

- The required source-build suite completes in under 10 minutes.
- A failed run produces enough evidence to identify renderer, IPC, main-process,
  or fake-service failures without rerunning locally.

### Phase 5: Expansion

After the initial suite is stable, add workflows according to product risk and
usage rather than raw test count. Candidates include workspace trust, file
tools, email template generation, scheduled AI loops, plugin management, and
contact extraction progress.

Cross-platform packaged smoke coverage may be added later for Windows and macOS
after the Linux suite meets its reliability target.

## 15. Success Metrics

- **First-attempt pass rate:** At least 99% on the protected branch over a
  rolling 30-day period.
- **Flake rate:** Less than 1%, tracked separately from product regressions.
- **Required suite duration:** Target under 5 minutes and maximum 10 minutes,
  excluding packaging.
- **Critical workflow coverage:** Every workflow in the initial test matrix is
  implemented and required in CI.
- **AI event coverage:** Every supported AI event category has deterministic
  coverage at the renderer or Electron level.
- **Diagnostic quality:** Every failed Electron test contains trace, screenshot,
  renderer error output, and main-process logs.
- **State safety:** No E2E run reads or modifies data outside its temporary test
  root.

## 16. Risks And Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Experimental Playwright Electron API changes | Launch code may require maintenance. | Pin Playwright, isolate launch logic in one fixture, and upgrade deliberately. |
| Native module ABI mismatch | Electron may fail before tests start. | Reuse the existing Electron rebuild process and add an explicit startup diagnostic. |
| Full packaging exceeds runtime target | Slow pull-request feedback. | Use source-built artifacts for the required suite and keep packaged tests minimal. |
| Shared Electron store or SQLite data | Order-dependent failures or user-data corruption. | Assign a unique temporary root per worker and validate resolved paths during setup. |
| Hidden external network traffic | Flaky tests, cost, or credential exposure. | Default-deny network guard with an explicit local allowlist. |
| Over-mocking | Tests pass while production integration is broken. | Mock only external dependencies; retain real preload, IPC, modules, and models in Electron tests. |
| Localization breaks selectors | Tests fail when language changes. | Prefer roles, accessible names, and stable intent-based test IDs. |
| Retries conceal flaky behavior | Misleading green CI status. | Report first-attempt failures and treat repeated flakes as defects. |

## 17. Open Decisions Before Implementation

The Phase 1 spike must resolve and document these decisions:

1. Which branch or branches are protected and require the E2E status check.
2. The exact source-build command and artifact paths used by
   `_electron.launch()`.
3. Whether the deterministic AI boundary uses dependency injection or a local
   HTTP/SSE server.
4. The initial CI worker count after measuring memory and database behavior.
5. Which existing AI tool provides the lowest-risk first approval-flow test.

These decisions affect implementation details but do not change the required
isolation, security, and real-IPC principles in this PRD.
