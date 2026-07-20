# AiFetchly Dev Browser UI Testing PRD

| Field | Value |
|------|-------|
| Document version | v1.0 |
| Created date | 2026-07-11 |
| Status | Draft |
| Product area | Developer experience, Electron renderer testing |
| Technical design | `docs/prd/dev-browser-ui-testing-technical-design.md` |

## 1. Summary

AiFetchly's Vue renderer is currently developed and tested primarily inside the Electron desktop shell. This makes automated UI testing harder because browser-first tools can open the Vite renderer, but real app flows fail once the UI calls Electron preload APIs such as `window.api.invoke`, `window.api.send`, or `window.api.receive`.

This feature adds a development-only browser testing mode. In VS Code debug sessions, the Electron main process can start a localhost bridge that exposes a restricted IPC-compatible transport to a normal browser. The same Vue UI can then run in Chrome for easier testing while still calling real main-process handlers during development.

## 2. Background

Current state:

- VS Code launches Electron through `electron-forge start --inspect-electron` in `.vscode/launch.json`.
- The renderer is built by Vite through `vite.render.config.mjs`.
- Electron loads the Vite dev server URL during development from `src/background.ts`.
- Renderer API wrappers call `window.api`, which is injected by `src/preload.ts`.
- A normal browser does not run Electron preload, so `window.api` is unavailable.

The team wants to test the app UI with browser automation tools without changing production behavior or converting AiFetchly into a hosted web app.

## 3. Goals

1. Allow the Vue renderer to run in a normal browser during local development.
2. Allow browser-based UI tests to exercise real main-process behavior where safe.
3. Keep the feature disabled in packaged production builds.
4. Integrate cleanly with the existing VS Code debug workflow.
5. Preserve Electron desktop behavior and existing IPC contracts.
6. Keep the bridge local, authenticated, and explicit.

## 4. Non-Goals

1. Do not convert AiFetchly into a production web application.
2. Do not expose the local SQLite database, filesystem, credentials, or automation controls to arbitrary browser pages.
3. Do not enable the bridge in packaged builds.
4. Do not bypass existing module/model architecture for database access.
5. Do not replace Electron preload for the desktop app.
6. Do not require all IPC channels to be supported in the first release.

## 5. Users

### 5.1 Developers

Developers need to run and debug the app from VS Code, open the UI in Chrome, inspect it with browser devtools, and run browser automation against real app workflows.

### 5.2 QA and Test Automation

QA needs a stable browser URL for repeatable UI tests, screenshots, visual checks, and flow validation without manually driving the Electron shell.

### 5.3 Product Maintainers

Maintainers need confidence that this dev-only path cannot leak into production or widen the attack surface for normal users.

## 6. Product Requirements

### FR-1 Dev-Only Activation

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.1 | The browser bridge must start only when the app is not packaged and an explicit env flag is enabled. | P0 |
| FR-1.2 | Packaged production builds must never start the bridge, even if the env flag is present. | P0 |
| FR-1.3 | The bridge must bind to `127.0.0.1` by default. | P0 |
| FR-1.4 | The app must log the bridge URL and browser test URL during dev startup. | P1 |

### FR-2 VS Code Debug Integration

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-2.1 | `.vscode/launch.json` must support enabling the bridge through environment variables. | P0 |
| FR-2.2 | A debug configuration or compound should make it easy to start Electron and open Chrome against the renderer URL. | P1 |
| FR-2.3 | The workflow must continue supporting main-process breakpoints through `--inspect-electron`. | P0 |
| FR-2.4 | The debug setup must not require production build steps. | P0 |

### FR-3 Renderer Transport Fallback

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-3.1 | The renderer API layer must use `window.api` when running inside Electron. | P0 |
| FR-3.2 | The renderer API layer must use the dev bridge when running in a browser and dev bridge config is present. | P0 |
| FR-3.3 | Browser mode must fail clearly when no bridge is available. | P0 |
| FR-3.4 | Existing Electron renderer behavior must remain unchanged. | P0 |

### FR-4 IPC-Compatible Request/Response

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-4.1 | The bridge must support request/response calls equivalent to `window.api.invoke(channel, data)`. | P0 |
| FR-4.2 | Responses must preserve the existing `{ status, msg, data }` contract. | P0 |
| FR-4.3 | Unsupported channels must return a safe failure response. | P0 |
| FR-4.4 | The first release should prioritize channels needed by common UI smoke tests. | P1 |

### FR-5 Event Streaming

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-5.1 | The bridge must support main-to-renderer events equivalent to `window.api.receive(channel, cb)`. | P0 |
| FR-5.2 | Event transport should use WebSocket or SSE. | P0 |
| FR-5.3 | Browser clients must be able to unsubscribe from event channels. | P1 |
| FR-5.4 | Streaming AI and scraper progress flows should be supported after the base request/response bridge is stable. | P1 |

### FR-6 Security Controls

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-6.1 | The bridge must require a per-session token. | P0 |
| FR-6.2 | The bridge must validate request origin against the renderer dev server origin. | P0 |
| FR-6.3 | The bridge must use an allowlist of supported channels. | P0 |
| FR-6.4 | High-risk channels such as file access, plugin install, dependency install, and credential operations must remain disabled until explicitly reviewed. | P0 |
| FR-6.5 | The bridge must not expose raw TypeORM repositories or direct database access. | P0 |

### FR-7 Testability

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-7.1 | Browser tests must be able to detect when bridge mode is active. | P1 |
| FR-7.2 | Browser tests must be able to run against a stable Vite port. | P1 |
| FR-7.3 | Failure messages should distinguish missing bridge, invalid token, blocked channel, and handler error. | P1 |

## 7. Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | Bridge code must be isolated from production startup paths. |
| NFR-2 | New TypeScript must avoid `any`; use explicit types or `unknown` with validation. |
| NFR-3 | IPC handlers remain communication-only and must call modules/controllers for business logic. |
| NFR-4 | Worker processes must not gain database access through this feature. |
| NFR-5 | The bridge should add minimal overhead to normal Electron dev mode when disabled. |
| NFR-6 | New user-facing UI text, if any, must update all supported i18n files. |

## 8. Suggested MVP Scope

The MVP should focus on browser access for layout, navigation, and core data screens:

1. Start dev bridge only from VS Code debug mode through env flags.
2. Add browser transport fallback in the renderer API helper.
3. Support request/response calls for low-risk read-only channels first.
4. Support event subscription for common progress/event channels after request/response works.
5. Add a Chrome debug configuration or compound in `.vscode/launch.json`.

Candidate first channels:

- `GET_APP_INFO`
- `QUERY_USER_INFO`
- list/detail read channels for dashboard, platform, task, language, and settings screens where safe

Channels requiring separate review:

- file dialogs and filesystem access
- plugin import/install
- system dependency install
- social account login and cookie operations
- task execution that launches automation
- AI tools that can read/write local files

## 9. Success Metrics

1. A developer can start one VS Code debug workflow and open the UI in Chrome.
2. Browser devtools show the renderer without `window.api is undefined` failures on supported pages.
3. Browser automation can complete at least one smoke flow against real main-process handlers.
4. Packaged production builds do not start a bridge port.
5. Blocked channels fail safely with a clear message.

## 10. Open Questions

1. Should the first release support only read-only channels, or include selected mutation channels needed for QA setup?
2. Should the bridge token be printed to the debug terminal, written to a dev-only file, or injected into the Vite renderer through env?
3. Should Chrome launch be handled by VS Code `pwa-chrome`, a task, or documented as a separate manual step?
4. Which smoke-test pages should define the MVP channel allowlist?
