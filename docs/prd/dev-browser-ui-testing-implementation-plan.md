# AiFetchly Dev Browser UI Testing — Implementation Plan

| Field | Value |
|------|-------|
| Document version | v1.0 |
| Created date | 2026-07-12 |
| Status | Implemented (Phase 1 + Phase 2) |
| Product PRD | `docs/prd/dev-browser-ui-testing-prd.md` |
| Technical design | `docs/prd/dev-browser-ui-testing-technical-design.md` |

## 1. Status

Phase 1 (Read-Only MVP) and Phase 2 (Event Support) from the technical design
are implemented and covered by automated tests. All P0 requirements are met.
Phase 3 (expanded channel coverage, Playwright browser automation) is deferred.

## 2. Architecture

```
VS Code launch env  ---->  Electron main process (src/background.ts)
                                |
                                +--> BrowserWindow loads Vite as today
                                |
                                +--> DevBrowserBridge on 127.0.0.1:37621 (dev only)
                                          |
                                          +--> POST /__aifetchly_dev_bridge/invoke
                                          +--> GET  /__aifetchly_dev_bridge/config
                                          +--> WS   /__aifetchly_dev_bridge/events

Chrome / browser test  (Vite renderer at http://localhost:5173)
   src/views/utils/apirequest.ts
        |
        +--> getIpcTransport() (src/views/utils/ipcTransport.ts)
               +--> ElectronPreloadTransport   (window.api present)
               +--> DevBrowserBridgeTransport  (browser + DEV)
               +--> UnavailableIpcTransport    (clear failure, FR-3.3)
```

Main-process modules live in `src/main-process/devtools/`:

| File | Responsibility |
|------|----------------|
| `devBrowserChannels.ts` | Frozen invoke + event allowlists |
| `DevBrowserActivation.ts` | Pure activation gate (env + `!isPackaged` + loopback + origin) |
| `DevBrowserDispatcher.ts` | Channel → module/controller handler map (Option B) |
| `DevBrowserSecurity.ts` | Origin / token / payload-size checks |
| `DevBrowserSchemas.ts` | Zod v4 wire schemas |
| `DevBrowserBridge.ts` | HTTP server + pure request handler |
| `DevBrowserEventRelay.ts` | WebSocket relay + `webContents.send` tap |

## 3. How to use

1. Open the Run and Debug panel in VS Code.
2. Choose **Electron + Chrome (Dev Browser)** and start it.
   - The Electron app starts with `AIFETCHLY_DEV_BROWSER_BRIDGE=1`.
   - The bridge comes up on `http://127.0.0.1:37621`.
   - Chrome opens the renderer at `http://localhost:5173`.
3. Watch the integrated terminal for:
   ```
   [dev-browser] bridge listening on http://127.0.0.1:37621 (allowed origin: http://localhost:5173)
   [dev-browser] per-session token: <hex>
   ```
   The renderer fetches its token itself from `/config`; you do not need to
   copy it.
4. Browser devtools work; supported API calls reach the real main process.

## 4. Supported channels (MVP allowlist)

Invoke (request/response):

- `GET_APP_INFO` (`app:info`) — app metadata
- `QUERY_USER_INFO` (`user:info`) — local user profile

Events (main → renderer):

- `SYSTEM_MESSAGE` (`system:message`)
- `LOGIN_STATUS` (`login:status`)

## 5. Blocked channel categories

Blocked until separately reviewed (PRD FR-6.4, design §12):

- File dialogs / filesystem access (`SHOW_OPEN_DIALOG`, `OPENDIRECTORY`, …)
- Plugin import / install (`PLUGIN_IMPORT`, `PLUGIN_INSTALL_FROM_SOURCE`, …)
- System dependency install (`SYSTEM_DEPENDENCY_INSTALL`)
- Credentials / cookies / login flows (`GET_LOGIN_URL`, `*_LOGIN_UPLOADCOOKIES`, …)
- Task execution that launches automation (`task:run`, `START_CONTACT_EXTRACTION`, …)
- AI file tools / shell-like operations (`AI_FILE_OPEN`, `AI_FILE_OPERATION`)

Unsupported channels return HTTP 200 with `{ status: false }` (FR-4.3). Browser
`send` / `sendBinary` are not supported in browser mode and warn clearly.

## 6. Security model

1. **Dev-only**: gate on `!app.isPackaged` AND `AIFETCHLY_DEV_BROWSER_BRIDGE=1`.
   Bridge modules are loaded via dynamic import only when the gate passes, so
   packaged builds never load bridge code (NFR-1).
2. **Loopback binding** (`127.0.0.1` / `localhost` / `::1`) only.
3. **Per-session bearer token** (32 random bytes), constant-time compared.
4. **Strict Origin** exact match (scheme + host + port, no path).
5. **Channel allowlist** — every channel is a deliberate, reviewed decision.
6. **Payload size cap** (256 KiB) and **Zod v4** validation on every request.
7. The bridge calls the same module/controller layer as IPC handlers — never
   raw repositories or direct DB access (FR-6.5, NFR-3).

## 7. How to add a supported channel

1. Confirm the channel is read-only / safe for a browser context.
2. Add the channel constant to `DEV_BROWSER_INVOKE_ALLOWLIST` (or
   `DEV_BROWSER_EVENT_ALLOWLIST`) in `devBrowserChannels.ts`.
3. Add a handler in `createDefaultHandlers()` in `DevBrowserDispatcher.ts` that
   calls the same module/controller the `ipcMain.handle` registration uses.
4. Add/extend tests in `test/vitest/main/devtools/`.

## 8. Open questions (resolved)

1. **Read-only vs mutation?** Read-only for the MVP (matches Suggested MVP Scope
   and the P0 security posture).
2. **Token delivery?** Dev-only, origin-validated `GET /config` endpoint returns
   the per-session token. No baked-in static token, no manual copy.
3. **Chrome launch?** A `chrome` config + compound in `.vscode/launch.json`.
4. **MVP allowlist pages?** `GET_APP_INFO` + `QUERY_USER_INFO` (PRD-named).

## 9. Test coverage

Tests live in `test/vitest/main/devtools/` (run via `yarn testmain`) and
`test/vitest/utilitycode/ipcTransport.test.ts` (run via
`yarn vitest-puppeteer`).

- Activation gate, loopback rejection, origin derivation, port fallbacks.
- Allowlist membership + high-risk omissions.
- Dispatcher routing, safe-failure on blocked channels, error isolation,
  result normalization, allowlist/handler agreement.
- Zod schema accept/reject; origin/token/size boundaries.
- Pure HTTP handler (CORS, config, invoke auth/origin/size/schema, routing).
- Real HTTP server integration (config, invoke, blocked channel, preflight).
- WebSocket relay (subscribe/broadcast, unsubscribe, cleanup, allowlist,
  malformed input) + real-WS integration (token/origin rejection, relay).
- Renderer transport resolution order, unavailable clear-failure, and a fetch
  round-trip against a minimal wire-contract server.

The TS type-check gate (`tsc --noEmit` via the vitest globalSetup) stays at
zero errors. The bridge wiring in `background.ts` is thin glue over
already-tested modules and is verified via the manual QA workflow in §3.
