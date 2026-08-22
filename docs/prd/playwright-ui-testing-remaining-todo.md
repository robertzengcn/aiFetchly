# Playwright UI Testing Remaining TODO

Source requirements:

- `docs/prd/playwright_for_uitest.md`
- `docs/prd/playwright-ui-testing-technical-design.md`

Audit basis:

- `yarn build:e2e` passes.
- `xvfb-run --auto-servernum --server-args='-screen 0 1280x960x24' yarn playwright test` passes: 12/12.
- The current implementation covers most Electron integration scenarios, but the items below are still missing or only partially implemented.

## Completion Target

The Playwright UI testing implementation is complete when all high-priority PRD requirements, initial test matrix items T-01 through T-13, and technical-design acceptance criteria are implemented, verified locally, and wired into the required CI path.

## TODO Items

### 1. Run Electron E2E on pull requests

Requirement coverage:

- PRD F-12: CI execution.
- Technical design §13.1 and §17.1: pull-request Electron E2E job.

Current state:

- `.github/workflows/ci.yml` contains an `electron-e2e` job.
- The workflow currently runs on `push` and `workflow_dispatch`, not `pull_request`.

TODO:

- Add the correct `pull_request` trigger for the selected protected branches.
- Confirm whether the protected branches are `dev`, `test`, `master`, or a smaller set.
- Ensure the Electron E2E job is part of the required PR status checks.
- Keep `xvfb-run` execution and artifact upload enabled for PR runs.

Acceptance:

- Opening a PR to every protected target branch runs the Electron E2E job.
- The job result is visible as a required branch-protection check.

### 2. Add renderer-only UI test layer

Requirement coverage:

- PRD §5.1: Renderer UI Tests.
- PRD test architecture requirement that renderer tests are distinct from Electron integration tests.
- Technical design deferred/baseline renderer test guidance.

Current state:

- Electron integration tests exist.
- Packaged smoke exists.
- No renderer-only test layer with a typed `window.api` fake was found.

TODO:

- Add a renderer UI test setup for Vue pages/components that does not launch Electron.
- Provide a typed fake for the preload `window.api` contract.
- Cover fast UI states that do not require real IPC:
  - empty state;
  - loading state;
  - success state;
  - error state;
  - AI permission / entitlement state;
  - message variants and tool-result variants.
- Keep renderer UI tests clearly separated from Electron integration tests in docs, filenames, and CI reporting.

Acceptance:

- Renderer UI tests run without Electron.
- Tests do not mock IPC in files categorized as Electron integration tests.
- TypeScript uses explicit types and no `any`.

### 3. Complete Electron transport-failure coverage

Requirement coverage:

- PRD T-10: AI transport failure.
- Technical design §15.6: separate cases for HTTP 500, malformed SSE, and mid-stream disconnect.
- PRD §8.1 deterministic AI scenarios.

Current state:

- HTTP 500 is covered at Electron level.
- `malformed-sse` and `disconnect-mid-stream` scenarios exist in fake server/unit coverage, but not as Electron recovery tests.

TODO:

- Add Electron integration test for `malformed-sse`.
- Add Electron integration test for `disconnect-mid-stream`.
- For each failure mode, assert:
  - a user-safe recoverable error or terminal state is shown;
  - no sensitive response content is rendered or logged;
  - the composer becomes actionable again;
  - a subsequent healthy message can be submitted successfully.

Acceptance:

- T-10 has three Electron cases: HTTP 500, malformed SSE, and mid-stream disconnect.
- All three use the real renderer → preload → IPC → provider → fake server path.

### 4. Strengthen cancellation transport assertions

Requirement coverage:

- PRD T-06: Stop active response.
- Technical design §9.5 and §15.4: cancellation barrier and fake server abort/disconnect observation.

Current state:

- The cancellation test asserts the UI stops rendering and the composer becomes actionable.
- The test does not require the fake server to observe client abort/disconnect.

TODO:

- Add fake-server synchronization for:
  - request connected;
  - client abort/disconnect observed.
- Propagate cancellation from renderer/main process to the fetch/SSE transport if not already guaranteed.
- Update the Electron test to assert abort/disconnect observation, not just UI cancellation.

Acceptance:

- T-06 proves the app stops the stream and aborts or disconnects the underlying fake provider request.
- No fixed sleep is used as the cancellation barrier.

### 5. Enforce configured loopback origin allowlist

Requirement coverage:

- PRD F-08: Network isolation.
- PRD NF-07: Security.
- Technical design §6.3 and §10: configured default-deny network policy.

Current state:

- Main-process and renderer network guards block external hosts.
- They allow all loopback hosts, not only configured allowed origins.

TODO:

- Change the main-process guard to allow only `AIFETCHLY_E2E_ALLOWED_ORIGINS`.
- Change the renderer guard to allow only the renderer origin, unless a specific test capability adds another origin.
- Keep control endpoints and fake AI provider origin scoped so the renderer cannot contact fake AI directly unless explicitly intended.
- Add tests proving:
  - configured loopback origin is allowed;
  - unconfigured loopback origin is blocked;
  - external origin is blocked;
  - violations are recorded.

Acceptance:

- Unexpected traffic to `127.0.0.1:<unapproved-port>` fails the test.
- Allowed origins are explicit per launched app.

### 6. Complete failure artifact collection and redaction

Requirement coverage:

- PRD F-11: Failure artifacts.
- PRD §13.3 artifact policy.
- Technical design §13.4 and §16: teardown diagnostics and redaction.
- Technical design §18: artifact redaction tests.

Current state:

- Playwright trace, screenshot, video, HTML report, and JSON report are configured.
- Main-process stdout/stderr are captured in memory.
- Full artifact collection/copying for main logs, renderer console output, fake AI request log, network violations, and redacted diagnostics is incomplete.

TODO:

- Add an artifact collector that attaches or copies on failure:
  - Playwright trace;
  - screenshot;
  - video where available;
  - renderer console messages;
  - renderer page errors;
  - main-process stdout/stderr;
  - application logs under the isolated root;
  - fake AI redacted request log;
  - network violation JSONL;
  - test root manifest, with sensitive fields redacted.
- Add redaction for:
  - Authorization and cookie headers;
  - API keys, tokens, passwords, proxy credentials;
  - full prompts and reasoning text;
  - file contents and base64 payloads;
  - paths outside the E2E root.
- Add unit tests for artifact redaction.

Acceptance:

- A deliberately failing Electron E2E test produces enough diagnostics to identify renderer, IPC, main-process, provider, or network-guard failures without rerunning locally.
- Artifacts do not expose secrets or full user content.

### 7. Expand packaged smoke to the full T-13 contract

Requirement coverage:

- PRD F-13: Packaged smoke.
- PRD T-13: launch packaged executable.
- Technical design §17.2.
- Technical design acceptance criterion 12.

Current state:

- `scripts/packaged-smoke.mjs` launches the packaged app and verifies the first window and preload bridge.
- The script comments mention rejecting E2E bootstrap flags, but the script does not actively verify that behavior.
- The smoke test does not appear to execute a small critical local IPC workflow.

TODO:

- Add an assertion that packaged app behavior is not affected by source E2E bootstrap flags.
- Add one non-destructive local IPC workflow through the real preload bridge.
- Keep AI/fake-provider dependencies out of packaged smoke.
- Ensure the smoke test reuses the existing package output and does not build another package.

Acceptance:

- Packaged smoke proves renderer HTML loads, preload bridge exists, and one local IPC call succeeds.
- Production packages do not expose E2E bootstrap, state manifest, network override, or native-dialog fixture interfaces.

### 8. Add harness coverage for missing internal components

Requirement coverage:

- Technical design §18: Unit and integration coverage for the harness.

Current state:

- Unit tests exist for:
  - `E2EEnvironment`;
  - `AppStartupPolicy`;
  - `E2ENetworkGuard`;
  - `E2ENativeDialogService`;
  - fake OpenAI scenarios.
- No dedicated tests were found for:
  - `E2EStateSeeder`;
  - artifact collector/redaction;
  - process cleanup descendant handling.

TODO:

- Add `E2EStateSeeder` tests proving:
  - database/provider/auth state is only seeded under the E2E root;
  - hosted-disabled sets `USER_AI_ENABLED=false`;
  - local-enabled uses the loopback provider and no production token.
- Add artifact redaction tests.
- Add process cleanup tests proving only recorded processes/descendants are terminated.

Acceptance:

- Every harness component listed in technical design §18 has explicit test coverage.

### 9. Validate test independence and parallel safety

Requirement coverage:

- PRD F-07: State isolation.
- PRD NF-05: Test independence.
- PRD NF-06: Parallel safety.
- Technical design §8.1 and §13.4.

Current state:

- Per-test temporary roots exist.
- Local run passed with multiple workers.
- CI intentionally uses one worker.
- Random-order / individual-test / repeated-run validation is not documented.

TODO:

- Add a documented verification command or script for:
  - running each spec individually;
  - running the full suite repeatedly;
  - running with randomized order if supported;
  - running with the intended CI worker count.
- Record whether any tests require serial execution and why.
- Verify no shared mutable ports, files, stores, databases, workspaces, or Electron state.

Acceptance:

- Tests pass individually, as a full suite, and in arbitrary order.
- Parallel execution does not share mutable state.

### 10. Establish reliability and runtime baseline

Requirement coverage:

- PRD NF-01: Performance.
- PRD NF-02: Reliability.
- PRD NF-03: Flake visibility.
- PRD success metrics.
- Technical design acceptance criteria 9 and 10.

Current state:

- One local `xvfb-run` run passed in about 50 seconds.
- No 20-run local baseline or rolling CI reliability metric was found.

TODO:

- Add a repeat-run script or documented command for 20 consecutive local runs.
- Record initial runtime baseline.
- Ensure CI reporting preserves first-attempt failures even when retry passes.
- Add or document flake tracking for protected branches.

Acceptance:

- 20 consecutive local runs pass before requiring the CI status.
- Required CI suite completes under 10 minutes, target under 5 minutes.
- First-attempt pass rate and flakes are visible separately from final retried status.

### 11. Tighten locator and accessibility contract

Requirement coverage:

- PRD §10: selectors and UI test conventions.
- Technical design §14.

Current state:

- Stable `data-testid` values exist for AI chat and permission controls.
- Some tests use test IDs heavily, which is acceptable for dynamic/translated AI chat UI.
- Renderer-only accessibility coverage is not yet present.

TODO:

- Audit all E2E selectors:
  - prefer role/accessibility locators where stable;
  - keep `data-testid` for dynamic, repeated, virtualized, or translated controls;
  - avoid CSS implementation details.
- Add or verify accessible names for controls used by role locators.
- If adding user-facing accessibility text, update all six language files.

Acceptance:

- Critical controls are addressable by stable role/name or intent-based `data-testid`.
- No critical E2E selector depends on Vuetify-generated classes or translated visible text alone.

### 12. Document resolved open decisions

Requirement coverage:

- PRD §17: Open decisions before implementation.
- Technical design §19 implementation sequence.

Current state:

- Some decisions are effectively implemented but not documented as resolved.

TODO:

- Document:
  - protected branch targets for required E2E;
  - exact source-build command and artifact paths;
  - chosen AI substitution boundary;
  - initial CI worker count;
  - selected deterministic tool approval workflow.

Acceptance:

- The PRD/design docs or a companion decision note make each formerly open decision explicit.

## Suggested Implementation Order

1. Fix CI PR trigger and protected-branch decision.
2. Add missing Electron failure cases: malformed SSE and mid-stream disconnect.
3. Strengthen cancellation abort assertion.
4. Enforce configured origin allowlist.
5. Complete artifact collector and redaction tests.
6. Expand packaged smoke.
7. Add missing harness unit tests.
8. Add renderer-only UI test layer.
9. Run and record 20-run reliability baseline.
10. Update implementation notes/open decisions.

