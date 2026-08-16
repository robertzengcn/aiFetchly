# Playwright UI Testing — Resolved Decisions & Verification

Companion to `playwright_for_uitest.md` (PRD) and `playwright-ui-testing-technical-design.md`.
Records the resolution of the PRD §17 open decisions plus the test-independence
and locator-audit verification (TODOs 9, 11, 12).

## 1. Resolved open decisions (PRD §17)

| Decision | Resolution |
| --- | --- |
| Protected branches requiring the E2E check | `dev`, `test`, `master` (PRD F-12). The `electron-e2e` job triggers on `pull_request` to these branches + every `push`. Add it as a required status check under GitHub branch protection (repo setting). |
| Exact source-build command + artifact paths | `yarn build:e2e` → `.vite/e2e/build/e2e-main.js` (E2E bootstrap) + `preload.js` (production preload source). No full installer build needed. |
| AI substitution boundary | Loopback OpenAI-compatible HTTP/SSE server (`FakeOpenAI`) + the production `OpenAICompatibleProviderClient` (selected when provider mode = `local`). NOT dependency-injected IPC. Boundary = the outbound transport, preserving real preload/IPC/modules. |
| Initial CI worker count | 1 (`workers: process.env.CI ? 1 : undefined`). Raise only after measuring memory + SQLite under parallel Electron instances. |
| Lowest-risk first approval-flow tool | `file_read` (filesystem, workspace-contained, no network). Workspace trust is set up via `AI_WORKSPACE_SET` + `AI_WORKSPACE_APPROVE` for the conversation. |

## 2. Test independence & parallel safety (TODO 9 / NF-05, NF-06)

- Every Electron instance gets a unique validated temporary root under
  `${tmpdir}/aifetchly-e2e/<run-id>/worker-<n>/<test-id>-<suffix>/` containing
  isolated `user-data/database/workspace/downloads/logs`. No test reads or
  writes outside its root.
- The FakeOpenAI server is worker-scoped (one per worker, ephemeral port, random
  control token); scenarios are reset before each test.
- CI runs `workers: 1`. Local multi-worker runs passed during development.
- **Verification commands:**
  - Each spec individually: `xvfb-run -a yarn playwright test <spec-name>`
  - Full suite repeatedly: `scripts/e2e-reliability-baseline.sh 5`
  - Repeated single spec: `for i in $(seq 1 5); do xvfb-run -a yarn playwright test aiChat; done`
  - No `test.serial` is used; every spec is independently runnable.

## 3. Locator & accessibility audit (TODO 11 / §10, §14)

Current selector strategy:
- `data-testid` for dynamic/repeated/translated AI-chat controls: `ai-chat-root`,
  `ai-chat-composer`, `ai-chat-send`, `ai-chat-stop`, `ai-chat-toggle`,
  `ai-chat-conversation-item`, `ai-chat-permission-card`,
  `ai-chat-permission-{allow-once,always-allow,deny}`. These are intent-based
  (describe user action, not DOM/style) and not translated.
- `#app` for the mount landmark; `window.api` for the preload bridge.
- No selector depends on Vuetify-generated class names or visible translated text.

Audit result: the AI-chat selectors are the correct kind (intent-based test IDs on
dynamic controls). The renderer-only UI layer (TODO 2) will add accessibility-
locator coverage (roles + accessible names) for non-dynamic controls.

## 4. Failure artifacts (TODO 6 / F-11, §13.3)

On failure, Playwright retains (config): trace, screenshot, video, HTML + JSON
report. The harness captures main-process stdout/stderr + renderer console/page
errors in memory. Redaction is unit-tested (`test/e2e/support/redact.ts` +
`test/vitest/main/e2e/ArtifactRedaction.test.ts`): auth/cookie headers, API
keys/tokens/passwords, base64 payloads, and external paths are stripped before
diagnostics reach the output directory.

## 5. Cancellation transport-abort (TODO 4 / T-06)

The app's Stop propagates to the stream consumer: `stopActiveTurn` →
`abortController.abort()` → the fetch `AbortSignal` fires → `OpenAIStreamParser`
stops reading → the UI stops rendering + the composer returns to actionable. This
user-visible cancellation is asserted in T-06.

The fake server does NOT observe a socket-level disconnect within the test window:
Node's undici (the `fetch` implementation) aborts the request body reader but does
not promptly reset the underlying TCP connection on a keep-alive SSE stream, so
the server's `req.on('close')` does not fire in time. The fake server's
disconnect-detection machinery (clientGone promise + req `close`/`aborted` + res
`close` listeners) is in place and would record the disconnect if the socket
closed.

To make the server observe the abort, `OpenAICompatibleProviderClient.stream`
would need to explicitly destroy the response body / underlying socket on abort
(e.g. `response.body.cancel()` or a socket-level destroy). That is a production
client change, deferred as separate scope. T-06 asserts the guaranteed contract
(UI cancel + composer actionable + the request reached the provider).
