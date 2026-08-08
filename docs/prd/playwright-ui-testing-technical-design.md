# Playwright Electron UI Testing Technical Design

| Field | Value |
| --- | --- |
| Document version | v1.0 |
| Created date | 2026-08-08 |
| Status | Draft |
| Product PRD | `docs/prd/playwright_for_uitest.md` |
| Initial platform | Linux x64 |
| Test runner | `@playwright/test` |

## 1. Overview

This document defines the technical implementation for automated UI and
end-to-end testing of the AiFetchly Electron application.

The implementation preserves the production runtime path for Electron tests:

```text
Vue renderer
  -> window.api
  -> contextBridge preload
  -> ipcRenderer
  -> ipcMain handler
  -> Module / Model / service
  -> isolated SQLite or controlled external dependency
```

The test system replaces only boundaries that cannot be deterministic in CI:

- Live AI services are replaced by a loopback OpenAI-compatible HTTP/SSE
  server.
- Native dialogs are replaced by a narrow main-process dialog adapter.
- User data, tokens, database files, workspaces, downloads, and logs are
  redirected into a per-test temporary root.
- Background network services and scheduled work are disabled by an explicit
  E2E startup policy.

The renderer-to-main IPC path is not mocked in Electron integration tests.
Renderer-only tests may provide a typed `window.api` fake when their scope is
limited to Vue behavior.

## 2. Design Decisions

| Decision | Choice | Reason |
| --- | --- | --- |
| Electron test target | Source-built main/preload with Vite renderer server | Faster than packaging all Forge worker targets for every test run. |
| AI substitution | Loopback OpenAI-compatible HTTP/SSE server | Reuses the existing local-provider implementation and exercises request building, SSE parsing, query orchestration, IPC, and UI rendering. |
| E2E boot path | Separate E2E main entry that dynamically imports `background.ts` | Establishes isolated paths and test settings before normal application modules initialize. |
| Test state | Unique temporary root per Electron application | Prevents test order dependence and access to real user data. |
| Background services | Explicit startup policy | `IS_TEST` currently suppresses DevTools only and does not stop schedulers, WebSocket startup, protocol registration, or other side effects. |
| Parallelism | One Playwright worker initially in CI | Establishes a stable baseline before increasing memory and process concurrency. |
| Network policy | Default deny with loopback allowlist | Prevents flaky network behavior, cost, and accidental credential use. |
| Packaged coverage | One minimal smoke project using existing package output | Verifies package layout without duplicating the expensive packaging step. |

## 3. Current Architecture

### 3.1 Electron Startup

Relevant files:

- `package.json` declares `.vite/build/background.js` as the Electron main
  entry.
- `forge.config.js` registers the main entry, preload entry, renderer, and all
  worker builds with `@electron-forge/plugin-vite`.
- `src/background.ts` creates the `BrowserWindow`, sets the preload path,
  registers all IPC handlers, initializes application services, and loads
  either the Vite server or packaged renderer HTML.
- `src/main-process/communication/index.ts` registers the complete IPC surface.
- `src/preload.ts` exposes the whitelisted `window.api` bridge.

The production `BrowserWindow` already has the required security properties:

```typescript
webPreferences: {
  nodeIntegration: false,
  contextIsolation: true,
  preload: path.join(__dirname, "preload.js"),
}
```

Electron E2E tests must use these settings unchanged.

### 3.2 Renderer IPC

The renderer does not call Electron directly. It uses:

```text
src/views/api/*
  -> src/views/utils/apirequest.ts
  -> src/views/utils/ipcTransport.ts
  -> window.api
```

AiChatV2 streaming uses two main-to-renderer channels:

- `AI_CHAT_V2_STREAM_CHUNK`
- `AI_CHAT_V2_STREAM_COMPLETE`

The renderer installs listeners before sending `AI_CHAT_V2_STREAM`, then
removes them after completion. Tests must assert both stream behavior and
listener cleanup indirectly by sending consecutive messages and verifying that
chunks are not duplicated.

### 3.3 AI Chat

`src/main-process/communication/ai-chat-v2-ipc.ts` performs the following flow:

1. Resolve AI availability before parsing the request.
2. Validate and normalize the request.
3. Submit it to `AIChatQueryEngine`.
4. Convert query-engine events to renderer stream events.
5. Persist conversation state through existing modules and models.

The existing local-provider path is suitable for E2E substitution:

```text
AIProviderResolver
  -> OpenAICompatibleProviderClient
  -> GET  /v1/models
  -> POST /v1/chat/completions
  -> OpenAI SSE stream parser
```

This path is preferable to replacing `ipcMain` handlers because it exercises
all application-owned integration layers.

### 3.4 Persistent Settings

`Token` stores encrypted values through `ElectronStoreService`.
`ElectronStoreService` already honors `ELECTRON_USER_DATA_PATH`, including in
process types where Electron cannot resolve `app.getPath("userData")`.

The main process also reads `app.getPath("userData")` directly for temporary
database and diagnostics paths. E2E startup must therefore set both:

```text
ELECTRON_USER_DATA_PATH=<test-root>/user-data
app.setPath("userData", <test-root>/user-data)
```

## 4. Target Architecture

```text
Playwright worker
  |
  +-- worker-scoped Vite renderer server on 127.0.0.1:5173
  |
  +-- worker-scoped FakeOpenAI server on 127.0.0.1:<dynamic-port>
  |
  +-- test-scoped temporary root
  |     +-- user-data/
  |     +-- database/
  |     +-- workspace/
  |     +-- downloads/
  |     +-- logs/
  |     +-- state.json
  |     +-- network-violations.jsonl
  |     +-- main.stdout.log
  |     +-- main.stderr.log
  |
  +-- Playwright _electron.launch()
        |
        +-- .vite/e2e/build/e2e-main.js
              |
              +-- validate E2E environment
              +-- set Electron userData path
              +-- install network guard
              +-- seed Token/provider settings
              +-- install E2E startup policy
              +-- dynamic import normal background entry
                    |
                    +-- normal BrowserWindow
                    +-- normal preload
                    +-- normal IPC registration
                    +-- normal Modules/Models
                    +-- isolated SQLite
                    +-- loopback FakeOpenAI server
```

## 5. Proposed Files

```text
playwright.config.ts
scripts/
└── build-electron-e2e.mjs
src/
├── main-process/
│   ├── e2e/
│   │   ├── E2EMain.ts
│   │   ├── E2EEnvironment.ts
│   │   ├── E2ENetworkGuard.ts
│   │   └── E2EStateSeeder.ts
│   └── startup/
│       └── AppStartupPolicy.ts
├── service/
│   └── dialogs/
│       ├── NativeDialogService.ts
│       └── ElectronNativeDialogService.ts
vite.e2e.main.config.mjs
vite.e2e.preload.config.mjs
test/
└── e2e/
    ├── fixtures/
    │   ├── electronApp.ts
    │   ├── fakeOpenAiServer.ts
    │   ├── temporaryState.ts
    │   └── types.ts
    ├── scenarios/
    │   ├── aiChatScenarios.ts
    │   └── openAiProtocol.ts
    ├── specs/
    │   ├── appLaunch.test.ts
    │   ├── aiChatStreaming.test.ts
    │   ├── aiChatPermission.test.ts
    │   ├── aiChatFailure.test.ts
    │   ├── nativeDialog.test.ts
    │   └── persistence.test.ts
    └── support/
        ├── artifactCollector.ts
        ├── assertions.ts
        └── processCleanup.ts
```

Files under `src/main-process/e2e/` are main-process code, not child-process
workers. They must not be placed under `src/childprocess/`.

## 6. Build And Launch Design

### 6.1 Why Electron Forge Start Is Not The Test Driver

`electron-forge start` owns the Electron process. Playwright needs to own that
process through `_electron.launch()` to obtain an `ElectronApplication`, access
the first `Page`, evaluate in the main process, collect process output, and
close the app reliably.

The E2E build therefore compiles only:

1. The E2E main entry and its imported production code.
2. The production preload entry.
3. The Vue renderer served by the existing Vite renderer server.

It does not build unrelated worker entry points unless a test explicitly needs
one.

### 6.2 E2E Main Entry

Proposed `src/main-process/e2e/E2EMain.ts`:

```typescript
import { app } from "electron";
import { loadE2EEnvironment } from "./E2EEnvironment";
import { installE2ENetworkGuard } from "./E2ENetworkGuard";
import { seedE2EState } from "./E2EStateSeeder";

async function start(): Promise<void> {
  const environment = loadE2EEnvironment(process.env);

  if (app.isPackaged) {
    throw new Error("The E2E source bootstrap cannot run in a packaged app");
  }

  app.setPath("userData", environment.userDataPath);
  process.env.ELECTRON_USER_DATA_PATH = environment.userDataPath;
  process.env.IS_TEST = "1";

  installE2ENetworkGuard(environment);
  seedE2EState(environment);

  await import("../../background");
}

void start();
```

The dynamic import is required. A static import of `background.ts` would allow
its dependency graph to initialize before paths and policies are established.

### 6.3 Environment Contract

The bootstrap accepts only an explicit, validated contract:

```typescript
export interface E2EEnvironment {
  readonly rootPath: string;
  readonly userDataPath: string;
  readonly databasePath: string;
  readonly workspacePath: string;
  readonly downloadsPath: string;
  readonly logsPath: string;
  readonly fakeAiBaseUrl: string;
  readonly allowedOrigins: readonly string[];
  readonly stateFilePath: string;
}
```

Required environment variables:

```text
AIFETCHLY_E2E=1
AIFETCHLY_E2E_ROOT=/absolute/test/root
AIFETCHLY_E2E_STATE_FILE=/absolute/test/root/state.json
AIFETCHLY_E2E_AI_BASE_URL=http://127.0.0.1:<port>/v1
AIFETCHLY_E2E_ALLOWED_ORIGINS=http://127.0.0.1:5173,http://127.0.0.1:<port>
ELECTRON_USER_DATA_PATH=/absolute/test/root/user-data
IS_TEST=1
NODE_ENV=test
```

Validation rules:

- `AIFETCHLY_E2E` must equal `1` exactly.
- All filesystem paths must be absolute and contained by `AIFETCHLY_E2E_ROOT`.
- The root must include a generated run identifier and must not equal a home,
  project, or filesystem root directory.
- AI and renderer URLs must use `http` and a loopback hostname.
- Unknown keys in `state.json` must be rejected.
- Invalid configuration must terminate before importing `background.ts`.

### 6.4 Vite Main Build

`vite.e2e.main.config.mjs` should reuse the production main configuration and
override only the entry, output directory, and Forge-injected constants:

```javascript
build: {
  outDir: ".vite/e2e/build",
  emptyOutDir: true,
  lib: {
    entry: "src/main-process/e2e/E2EMain.ts",
    formats: ["cjs"],
    fileName: () => "e2e-main.js",
  },
},
define: {
  MAIN_WINDOW_VITE_DEV_SERVER_URL: JSON.stringify("http://127.0.0.1:5173"),
  MAIN_WINDOW_VITE_NAME: JSON.stringify("main_window"),
}
```

The implementation should extract reusable production Vite configuration into
a shared factory rather than copy the long external and alias lists. This keeps
native module and TypeORM bundling behavior aligned with `vite.main.config.mjs`.

### 6.5 Preload Build

The preload must be emitted as:

```text
.vite/e2e/build/preload.js
```

This matches the existing `path.join(__dirname, "preload.js")` lookup in
`background.ts`. The E2E build must use the production preload source without a
test-specific bridge.

### 6.6 Renderer Server

Playwright should start the existing renderer with its `webServer` setting:

```typescript
webServer: {
  command: "yarn dev:renderer --host 127.0.0.1",
  url: "http://127.0.0.1:5173",
  reuseExistingServer: !process.env.CI,
  timeout: 120_000,
}
```

The existing Vite configuration already fixes port `5173` with `strictPort`.
CI must fail when the port is unavailable rather than silently switching ports.

### 6.7 Build Script

`scripts/build-electron-e2e.mjs` should:

1. Remove only `.vite/e2e`.
2. Build the E2E main bundle.
3. Build the production preload into `.vite/e2e/build` without removing the
   main bundle.
4. Copy required main-process runtime assets, including the platform
   `sqlite-vec` extension and application icon.
5. Verify that `e2e-main.js` and `preload.js` exist.
6. Scan generated runtime `require()` calls using the same packaging dependency
   rules where applicable.

Suggested scripts:

```json
{
  "build:e2e": "node scripts/build-electron-e2e.mjs",
  "test:e2e": "yarn build:e2e && playwright test",
  "test:e2e:headed": "yarn build:e2e && playwright test --headed",
  "test:e2e:debug": "yarn build:e2e && playwright test --debug",
  "test:e2e:report": "playwright show-report"
}
```

## 7. Startup Policy

### 7.1 Problem

The current `IS_TEST` check prevents Vue DevTools from opening, but normal
startup may still:

- Register the application protocol.
- Acquire the production single-instance lock.
- Initialize update behavior.
- Scan global plugin or skill directories.
- Start schedulers and boot tasks.
- Inspect previous scraper processes.
- Connect the marketing WebSocket.
- Start token refresh.
- Start the development browser bridge.

These side effects introduce nondeterminism and can access state outside the
test root.

### 7.2 Policy Interface

Add a pure policy resolver in
`src/main-process/startup/AppStartupPolicy.ts`:

```typescript
export interface AppStartupPolicy {
  readonly registerProtocol: boolean;
  readonly acquireSingleInstanceLock: boolean;
  readonly initializeUpdates: boolean;
  readonly installDevTools: boolean;
  readonly startSchedulers: boolean;
  readonly inspectOrphanedTasks: boolean;
  readonly connectMarketingWebSocket: boolean;
  readonly startTokenRefresh: boolean;
  readonly startDevBrowserBridge: boolean;
  readonly scanGlobalExtensions: boolean;
}

export function resolveAppStartupPolicy(
  environment: NodeJS.ProcessEnv,
  isPackaged: boolean
): AppStartupPolicy;
```

Production and normal development behavior must remain unchanged. When
`AIFETCHLY_E2E=1`, all listed side effects are disabled unless a future test
explicitly opts into one through a typed test capability.

This policy does not disable:

- BrowserWindow creation.
- CSP and security configuration.
- Preload loading.
- IPC registration.
- Module and Model behavior invoked by the UI.
- SQLite initialization.
- Application logs inside the isolated root.

Unit tests must prove both production defaults and E2E values.

## 8. Test State And Database Isolation

### 8.1 Temporary Root Lifecycle

Each test that launches Electron receives a unique root:

```text
${os.tmpdir()}/aifetchly-e2e/<run-id>/<worker-index>/<test-id>/
```

The fixture creates all child directories before launch. Test IDs must be
sanitized and combined with a random suffix to avoid collisions.

On successful completion, the fixture removes the root. On failure, it retains
the root until artifacts are copied into Playwright's test output directory.
The fixture must never call recursive deletion unless containment validation
confirms the target is below the generated run root.

### 8.2 State Manifest

Playwright writes a typed `state.json` before launch:

```typescript
export interface E2EStateManifest {
  readonly schemaVersion: 1;
  readonly authState: "authenticated" | "unauthenticated";
  readonly aiState: "hosted-disabled" | "local-enabled";
  readonly locale: "en";
  readonly fakeAiBaseUrl: string;
  readonly workspacePath: string;
  readonly dialogResponses?: Readonly<Record<string, E2EDialogResponse>>;
}
```

The initial suite fixes locale to English for assertions. Separate i18n tests
should verify other languages without multiplying the Electron matrix.

### 8.3 State Seeding

`E2EStateSeeder` runs in the Electron main process after paths are established
and before importing normal startup code.

For `local-enabled`, it must use production services:

1. Set `USERSDBPATH` to `<root>/database` through `Token`.
2. Save the loopback provider with `AIProviderSettingsService`.
3. Set mode to `local`.
4. Set provider capabilities to support models, chat, streaming, and tools.
5. Seed fake user metadata through `Token` only when required by the UI.

Example provider input:

```typescript
{
  preset: "custom",
  name: "AiFetchly E2E Provider",
  baseUrl: environment.fakeAiBaseUrl,
  defaultModel: "aifetchly-e2e-model",
  capabilities: {
    modelsEndpoint: "supported",
    chat: "supported",
    streaming: "supported",
    tools: "supported",
    vision: "unsupported",
  },
}
```

For `hosted-disabled`, the seeder must set provider mode to `hosted` and
`USER_AI_ENABLED` to `false`. The fake server request log must remain empty,
proving that the entitlement gate ran before request parsing or transport use.

### 8.4 Database Initialization

The application continues to create and access SQLite through `SqliteDb`,
Models, and Modules. Individual E2E tests must not open TypeORM repositories or
execute SQL directly.

If a test needs pre-existing entities, add a typed fixture builder that calls
Module methods before the BrowserWindow becomes interactive, or copy a
versioned baseline database created through application initialization.

Preferred initial approach:

- Let the application lazily initialize an empty database.
- Create state through real UI and IPC workflows.
- Add fixture builders only when setup time becomes material.

## 9. Fake OpenAI-Compatible Server

### 9.1 Scope

The fake server is test code under `test/e2e/fixtures/`. It listens only on an
ephemeral loopback port and implements:

```text
GET  /v1/models
POST /v1/chat/completions
GET  /__e2e/requests
POST /__e2e/scenario
POST /__e2e/reset
```

Control endpoints must use a random worker-scoped token and must never be
configured as the application's provider base URL.

### 9.2 Scenario Selection

Tests select a named scenario before submitting UI input:

```typescript
type FakeAiScenarioName =
  | "stream-text"
  | "stream-delayed"
  | "tool-requires-permission"
  | "tool-success-followup"
  | "http-500"
  | "malformed-sse"
  | "disconnect-mid-stream";
```

Scenario state is worker scoped and reset before every test. Each Electron app
includes a generated test-instance header or request marker where supported so
request logs can be attributed correctly if parallelism is enabled later.

### 9.3 Models Response

```json
{
  "object": "list",
  "data": [
    {
      "id": "aifetchly-e2e-model",
      "object": "model",
      "created": 0,
      "owned_by": "aifetchly-e2e"
    }
  ]
}
```

### 9.4 SSE Response

The server emits valid OpenAI-compatible events:

```text
data: {"id":"chatcmpl-e2e","object":"chat.completion.chunk","created":0,"model":"aifetchly-e2e-model","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-e2e","object":"chat.completion.chunk","created":0,"model":"aifetchly-e2e-model","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}

data: {"id":"chatcmpl-e2e","object":"chat.completion.chunk","created":0,"model":"aifetchly-e2e-model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]

```

Tool scenarios must emit the exact streaming `tool_calls` delta shape accepted
by the existing `OpenAIStreamParser`. Scenario payloads should be verified by
unit tests against that parser before they are used in Electron tests.

### 9.5 Deterministic Timing

Scenario delays are explicit and bounded:

```typescript
interface FakeAiChunk {
  readonly delayMs: number;
  readonly payload: string;
}
```

- Normal streams use zero or near-zero delay.
- Cancellation tests use a controlled barrier rather than a long sleep.
- The fake server exposes a promise/event when the request is connected and
  another when it observes client disconnect or abort.
- No scenario delay may exceed the test timeout budget.

### 9.6 Request Assertions

The server records redacted request metadata:

- Method and path.
- Model.
- Number and roles of messages.
- Whether `stream` is true.
- Advertised tool names.
- Abort/disconnect observation.

It must not write full prompts, attachment contents, authorization headers, or
reasoning text into CI artifacts.

## 10. Network Isolation

### 10.1 Main Process

The E2E bootstrap installs a default-deny guard before importing production
code. It must cover at minimum:

- `globalThis.fetch`.
- `node:http` request/get.
- `node:https` request/get.

Only configured loopback origins are allowed. A blocked request must:

1. Append a redacted violation record to
   `network-violations.jsonl`.
2. Reject immediately with an error containing the target origin.
3. Cause test teardown to fail even if production code catches the rejection.

The startup policy disables marketing WebSocket, updater, and background tasks
before they can create other network clients.

### 10.2 Renderer

The Playwright fixture installs routing before application interaction:

```typescript
await page.route("**/*", async (route): Promise<void> => {
  const url = new URL(route.request().url());
  if (allowedRendererOrigins.has(url.origin)) {
    await route.continue();
    return;
  }
  await route.abort("blockedbyclient");
  rendererViolations.push(url.origin);
});
```

The renderer allowlist initially contains only the Vite origin. The fake AI
origin is main-process only and should not be contacted by the renderer.

## 11. Native Dialog Abstraction

### 11.1 Interface

Introduce a narrow application service rather than exposing Electron's entire
`dialog` object:

```typescript
export interface NativeDialogService {
  showOpenDialog(options: OpenDialogOptions): Promise<OpenDialogReturnValue>;
  showSaveDialog(options: SaveDialogOptions): Promise<SaveDialogReturnValue>;
  showMessageBox(options: MessageBoxOptions): Promise<MessageBoxReturnValue>;
}
```

Production uses `ElectronNativeDialogService`. IPC handlers depend on the
interface through a small provider or constructor injection consistent with
their current module boundary.

### 11.2 E2E Adapter

`E2ENativeDialogService` reads only predefined responses from the validated
state manifest. Returned paths must remain inside the E2E root. Missing dialog
responses fail rather than opening a real OS dialog.

This substitution applies only to handlers covered by E2E tests. It should be
introduced incrementally instead of refactoring every dialog call in one
change.

## 12. Playwright Configuration

Proposed baseline:

```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e/specs",
  fullyParallel: false,
  workers: process.env.CI ? 1 : undefined,
  timeout: 45_000,
  expect: { timeout: 7_500 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["line"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["json", { outputFile: "test-results/results.json" }],
  ],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  outputDir: "test-results/playwright",
  webServer: {
    command: "yarn dev:renderer --host 127.0.0.1",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

A retry that passes must remain visible as flaky in the JSON/HTML report. CI
metrics must use first-attempt results, not only the final workflow conclusion.

## 13. Electron Fixture

### 13.1 Fixture Types

```typescript
export interface AiFetchlyElectronFixtures {
  readonly electronApp: ElectronApplication;
  readonly mainWindow: Page;
  readonly testRoot: E2ETemporaryRoot;
  readonly fakeAi: FakeOpenAiController;
  readonly mainLogs: MainProcessLogCollector;
}
```

### 13.2 Launch

```typescript
const electronApp = await electron.launch({
  args: [path.resolve(".vite/e2e/build/e2e-main.js")],
  cwd: projectRoot,
  env: {
    ...sanitizedProcessEnvironment,
    AIFETCHLY_E2E: "1",
    AIFETCHLY_E2E_ROOT: testRoot.path,
    AIFETCHLY_E2E_STATE_FILE: testRoot.stateFilePath,
    AIFETCHLY_E2E_AI_BASE_URL: fakeAi.providerBaseUrl,
    AIFETCHLY_E2E_ALLOWED_ORIGINS: allowedOrigins.join(","),
    ELECTRON_USER_DATA_PATH: testRoot.userDataPath,
    IS_TEST: "1",
    NODE_ENV: "test",
  },
});
```

The fixture must construct an explicit environment allowlist rather than pass
all developer environment variables. It may preserve required values such as
`PATH`, platform library paths, and CI metadata, but must remove API keys,
tokens, proxy credentials, and production service URLs.

### 13.3 Readiness

Readiness requires all of the following:

1. `electronApp.firstWindow()` resolves.
2. The page URL has the expected Vite origin.
3. `#app` is mounted.
4. The preload bridge exists.
5. A stable application landmark is visible.
6. No fatal main-process or renderer error was recorded.

The fixture must not use a fixed startup sleep.

### 13.4 Teardown

Teardown order:

1. Capture page errors, console messages, URL, screenshot, and trace state.
2. Query fake server request records.
3. Close the Electron application with a bounded timeout.
4. If still running, terminate only the recorded Electron process tree.
5. Stop the fake server when its worker fixture ends.
6. Fail on network violations, unexpected console errors, or leaked child
   processes.
7. Copy diagnostics to Playwright output.
8. Remove successful test roots after containment validation.

The test harness must track process IDs it created. It must not use broad
commands such as `pkill electron`.

## 14. Locator Contract

Use Playwright's accessibility-first locators:

```typescript
page.getByRole("textbox", { name: /send a message/i });
page.getByRole("button", { name: /send/i });
```

Add `data-testid` only when localization, virtualization, repeated messages, or
Vuetify internals make roles insufficient. Proposed initial IDs:

```text
ai-chat-root
ai-chat-composer
ai-chat-send
ai-chat-stop
ai-chat-message-user
ai-chat-message-assistant
ai-chat-streaming-indicator
ai-chat-permission-card
ai-chat-permission-allow-once
ai-chat-permission-always-allow
ai-chat-permission-deny
ai-chat-error
```

Test IDs must not encode list position or styling. Repeated message IDs may use
the application message ID as a separate attribute when exact correlation is
required.

Any newly added user-facing accessibility label must be translated in all six
supported language files. `data-testid` values are internal and are not
translated.

## 15. Initial Test Specifications

### 15.1 Application Launch

Steps:

1. Start with an empty test root.
2. Launch Electron.
3. Wait for the application landmark.
4. Assert exactly one primary window.
5. Assert `window.api` exists.
6. Assert `window.require`, `process`, and direct Node access are unavailable.
7. Assert no unexpected console, page, network, or main-process startup error.

### 15.2 AI Disabled

Steps:

1. Seed `hosted-disabled` state.
2. Open AI chat.
3. Submit a message.
4. Assert a user-safe entitlement error.
5. Assert fake provider request count is zero.
6. Assert the composer becomes actionable again.

### 15.3 Streamed Text

Steps:

1. Select `stream-text`.
2. Submit a uniquely generated message.
3. Assert the user message appears once.
4. Assert the streaming indicator appears.
5. Assert assistant deltas are rendered in order.
6. Assert the terminal content is exact.
7. Assert the streaming indicator disappears.
8. Submit a second message and assert no duplicate chunks, proving old listeners
   were detached.

### 15.4 Cancellation

Steps:

1. Select `stream-delayed`.
2. Submit a message.
3. Wait for the fake server connection barrier.
4. Wait for the first visible chunk.
5. Activate Stop.
6. Assert no further content is added.
7. Assert the fake server observes disconnect or abort.
8. Assert a new message can be submitted.

### 15.5 Tool Permission

Use one existing, deterministic built-in tool whose execution has no external
network dependency and whose effects remain inside the test workspace.

Steps:

1. Set approval mode to `ask_for_approval`.
2. Select `tool-requires-permission`.
3. Submit the user request.
4. Assert the permission card identifies the expected tool and impact.
5. Assert the tool effect has not occurred.
6. Grant permission once.
7. Assert the real permission IPC and resume path run.
8. Assert the tool effect occurs inside the test workspace.
9. Assert the follow-up AI response completes.

The deny test repeats steps 1-5, denies permission, and proves the effect never
occurs.

### 15.6 Transport Failure

Run separate cases for HTTP 500, malformed SSE, and mid-stream disconnect.
Each must show a user-safe recoverable state, record no sensitive response
content, and allow a subsequent successful message.

### 15.7 Persistence

Steps:

1. Complete a streamed conversation.
2. Record its visible conversation identifier or unique title.
3. Close Electron cleanly.
4. Relaunch with the same test root and fake provider.
5. Assert the conversation and messages load through real history IPC.
6. Launch a separate test root and prove the conversation is absent.

## 16. Error And Log Policy

### 16.1 Expected Errors

Each test may declare expected renderer or main-process error patterns for the
specific scenario. All other occurrences of the following fail the test:

- `pageerror`.
- Unhandled rejection.
- Main process uncaught exception.
- Renderer console `error`.
- Network violation.
- Missing preload bridge.
- Electron process exit before teardown.

Console warnings should be collected initially. After a baseline allowlist is
established, new warnings should also fail CI.

### 16.2 Redaction

Artifact collection must redact:

- Authorization and cookie headers.
- Values of token and API-key environment variables.
- Full user prompts and AI reasoning.
- File contents and attachment base64.
- Paths outside the E2E root.

Logs may retain event type, content length, model, tool name, status, timing,
and test-relative paths.

## 17. CI Integration

### 17.1 Pull-Request Job

Add an `electron-e2e` job after type checking and unit tests. The exact branch
trigger must be confirmed before implementation because the repository uses
`dev`, `test`, and `master`, not `main`.

Illustrative job:

```yaml
electron-e2e:
  name: Electron E2E
  needs: lint-and-test
  runs-on: ubuntu-latest
  timeout-minutes: 15
  env:
    CI: "true"
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 22.19.0
        cache: yarn
    - uses: actions/setup-python@v6
      with:
        python-version: "3.11"
    - name: Install Linux dependencies
      run: |
        sudo apt-get update
        sudo apt-get install -y libsecret-1-dev xvfb
    - name: Install packages
      run: yarn install --frozen-lockfile
    - name: Rebuild Electron native modules
      run: yarn rebuild-better-sqlite
    - name: Build E2E Electron artifacts
      run: yarn build:e2e
    - name: Run Electron E2E
      run: xvfb-run --auto-servernum --server-args="-screen 0 1280x960x24" yarn playwright test
    - name: Upload E2E diagnostics
      if: always()
      uses: actions/upload-artifact@v4
      with:
        name: electron-e2e-${{ github.run_id }}
        path: |
          playwright-report
          test-results
        if-no-files-found: warn
        retention-days: 7
```

Playwright Electron tests use the project's installed Electron binary. Installing
Playwright's Chromium browser is unnecessary unless renderer-only browser
projects are added to the same configuration. Linux shared-library installation
must be pinned and validated against the Electron version used by the project.

### 17.2 Packaged Smoke

The existing `package-smoke` job already produces and validates a Linux package.
After `yarn verify-packaged-app`, it should:

1. Resolve the unpacked executable path deterministically.
2. Launch it with a fresh isolated user-data directory.
3. Verify the first window, renderer HTML, and preload bridge.
4. Close it cleanly.

The packaged app must not accept the source E2E bootstrap or fake dependency
flags. Packaged smoke should avoid AI transport and validate only startup and a
local non-destructive IPC call.

## 18. Unit And Integration Coverage For The Harness

The harness itself requires tests:

| Component | Required coverage |
| --- | --- |
| `E2EEnvironment` | Reject relative paths, unsafe roots, non-loopback URLs, missing variables, and unknown manifest versions. |
| `AppStartupPolicy` | Preserve normal production/development defaults and disable all external side effects in E2E mode. |
| `E2ENetworkGuard` | Allow configured loopback traffic, block external fetch/http/https, and persist violation records. |
| `E2EStateSeeder` | Set database/provider/auth state only below the E2E root. |
| Fake OpenAI server | Model response, text SSE, tool-call SSE, delay barrier, abort detection, HTTP error, and reset isolation. |
| Artifact redaction | Remove headers, tokens, prompt bodies, base64 data, and external absolute paths. |
| Process cleanup | Terminate only recorded descendants and handle already-exited processes. |

Main-process harness tests belong in `test/vitest/main/`. Pure utility tests
belong in `test/vitest/utilitycode/`. Fake server protocol tests may live next
to E2E fixtures if Playwright can run them without Electron, or in Vitest when
that provides faster feedback.

## 19. Implementation Sequence

### Step 1: Build Proof

- Add Playwright dependency and scripts.
- Extract reusable Vite main configuration.
- Add E2E main/preload builds.
- Prove `_electron.launch()` reaches the renderer server.
- Do not add AI tests yet.

### Step 2: Isolation Foundation

- Add `E2EEnvironment` validation.
- Add temporary-root fixture.
- Add startup policy.
- Add main and renderer network guards.
- Add process and log collection.
- Implement application launch and security tests.

### Step 3: Local Provider Fixture

- Add fake OpenAI-compatible server.
- Add provider state seeding through existing services.
- Unit-test every fake protocol scenario against production parsers.
- Implement AI-disabled and streamed-text tests.

### Step 4: Lifecycle And Failure Cases

- Add cancellation barriers.
- Add HTTP/SSE/disconnect failures.
- Add second-message listener-cleanup assertion.
- Add restart persistence test.

### Step 5: Permission And Native Boundaries

- Select a deterministic, workspace-contained tool.
- Add stable permission-card selectors.
- Implement allow-once and deny flows.
- Introduce native dialog abstraction for the first covered dialog workflow.

### Step 6: CI And Packaged Smoke

- Add the protected-branch pull-request job.
- Establish runtime and first-attempt reliability baselines.
- Add packaged startup smoke to the existing package job.
- Make the E2E status required only after the baseline is stable.

Each step is a separate logical commit and must leave type checking and existing
tests passing.

## 20. Acceptance Criteria

The initial implementation is complete when:

1. `yarn test:e2e` builds and runs locally without Electron Forge owning the
   Electron process.
2. Electron integration tests use the production preload and IPC handlers.
3. Every app instance uses a unique validated temporary root.
4. Tests cannot contact non-loopback hosts.
5. Hosted-disabled coverage proves the AI gate runs before the fake transport.
6. Text streaming, cancellation, permission allow/deny, failure recovery, and
   persistence tests pass.
7. Consecutive chat turns do not duplicate stream events.
8. Failure artifacts include trace, screenshot, renderer errors, main logs, and
   redacted fake-server request metadata.
9. The suite passes 20 consecutive local runs before becoming a required CI
   check.
10. The required CI suite completes in under 10 minutes, with a target below 5
    minutes.
11. The packaged smoke test reuses the existing package output.
12. No production package exposes the E2E bootstrap, state manifest, network
    override, or native-dialog fixture interface.

## 21. Deferred Work

- Windows and macOS Electron E2E matrices.
- Installer UI automation.
- Live-provider canary tests with real credentials.
- Visual regression baselines across every route.
- Accessibility scanning of the entire application.
- Parallel CI workers beyond the measured stable limit.
- Browser-only renderer projects sharing the same Playwright configuration.
- E2E coverage of real scraping targets and third-party social platforms.

These items should be added only after the Linux critical-path suite meets its
runtime and reliability targets.
