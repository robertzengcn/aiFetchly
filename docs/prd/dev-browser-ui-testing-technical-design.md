# AiFetchly Dev Browser UI Testing Technical Design

| Field | Value |
|------|-------|
| Document version | v1.0 |
| Created date | 2026-07-11 |
| Status | Draft |
| Product PRD | `docs/prd/dev-browser-ui-testing-prd.md` |

## 1. Overview

This design adds a development-only browser bridge for testing the existing Vue renderer in Chrome while the Electron main process is running under VS Code debug mode.

The desktop app keeps its current preload IPC path:

```text
Electron renderer -> window.api -> ipcRenderer -> ipcMain handlers
```

Browser testing mode adds a dev-only alternate path:

```text
Chrome renderer -> browser transport adapter -> localhost bridge -> ipcMain-compatible dispatcher
```

The bridge is not a production web backend. It exists only to let a normal browser drive the local development app.

## 2. Current Architecture

Relevant files:

- `.vscode/launch.json` starts `electron-forge start --inspect-electron`.
- `forge.config.js` registers the Vite main, preload, worker, and renderer entries.
- `src/background.ts` creates the Electron `BrowserWindow` and loads the Vite dev server URL in development.
- `src/preload.ts` exposes `window.api` with whitelisted `send`, `receive`, `removeListener`, `removeAllListeners`, and `invoke`.
- `src/views/utils/apirequest.ts` wraps renderer API calls around `window.api`.
- `src/main-process/communication/index.ts` registers all main-process IPC handlers.

The browser blocker is `src/views/utils/apirequest.ts`: it expects `window.api` to exist. Chrome does not have preload, so browser mode needs a transport fallback.

## 3. Target Architecture

```text
                          development only
                                |
                                v
VS Code launch env ----> Electron main process
                                |
                                +--> BrowserWindow loads Vite as today
                                |
                                +--> DevBrowserBridge on 127.0.0.1
                                          |
                                          +--> HTTP invoke endpoint
                                          +--> WebSocket event endpoint

Chrome / browser test
  Vite renderer
    |
    +--> RendererIpcTransport
           |
           +--> ElectronPreloadTransport when window.api exists
           +--> DevBrowserBridgeTransport when bridge config exists
```

## 4. Activation Rules

The bridge should start only when all conditions are true:

1. `app.isPackaged === false`
2. `process.env.AIFETCHLY_DEV_BROWSER_BRIDGE === "1"`
3. host resolves to loopback, default `127.0.0.1`

Recommended env variables:

```text
AIFETCHLY_DEV_BROWSER_BRIDGE=1
AIFETCHLY_DEV_BROWSER_BRIDGE_HOST=127.0.0.1
AIFETCHLY_DEV_BROWSER_BRIDGE_PORT=37621
AIFETCHLY_DEV_BROWSER_BRIDGE_ALLOWED_ORIGIN=http://localhost:5173
```

The implementation should ignore or reject non-loopback hosts unless a future explicit override is added.

## 5. VS Code Launch Design

The existing launch configuration can be extended with bridge env values:

```json
{
  "type": "node",
  "request": "launch",
  "name": "Electron Main",
  "runtimeExecutable": "${workspaceFolder}/node_modules/.bin/electron-forge",
  "runtimeArgs": [
    "start",
    "--inspect-electron",
    "--",
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--no-sandbox"
  ],
  "cwd": "${workspaceFolder}",
  "env": {
    "DISPLAY": ":0",
    "AICHAT_DEBUG_REQUEST": "0",
    "CHOKIDAR_USEPOLLING": "1",
    "CHOKIDAR_INTERVAL": "1000",
    "AIFETCHLY_DEV_BROWSER_BRIDGE": "1",
    "AIFETCHLY_DEV_BROWSER_BRIDGE_HOST": "127.0.0.1",
    "AIFETCHLY_DEV_BROWSER_BRIDGE_PORT": "37621"
  }
}
```

A follow-up configuration can use `pwa-chrome` to open the Vite renderer URL once the dev server is ready:

```json
{
  "type": "pwa-chrome",
  "request": "launch",
  "name": "Chrome Renderer",
  "url": "http://localhost:5173",
  "webRoot": "${workspaceFolder}/src/views"
}
```

If the Vite renderer port is not stable today, set a fixed port in `vite.render.config.mjs` before relying on a Chrome launch config.

## 6. Main Process Bridge Module

Suggested file:

```text
src/main-process/devtools/DevBrowserBridge.ts
```

Responsibilities:

1. Start and stop the local HTTP/WebSocket server.
2. Generate a per-session token.
3. Validate host, origin, token, method, payload size, and channel allowlist.
4. Dispatch supported request/response calls to the existing main-process behavior.
5. Relay selected main-to-renderer events to connected browser clients.

Suggested public API:

```typescript
export interface DevBrowserBridgeConfig {
  host: "127.0.0.1" | "localhost";
  port: number;
  allowedOrigin: string;
}

export interface DevBrowserBridgeInfo {
  baseUrl: string;
  token: string;
  allowedOrigin: string;
}

export class DevBrowserBridge {
  constructor(config: DevBrowserBridgeConfig);
  start(): Promise<DevBrowserBridgeInfo>;
  stop(): Promise<void>;
}
```

Avoid exposing the token to arbitrary renderer pages. Prefer printing it to the dev terminal and serving a dev-only config endpoint that requires origin validation.

## 7. Request/Response Contract

HTTP endpoint:

```text
POST /__aifetchly_dev_bridge/invoke
Authorization: Bearer <session-token>
Origin: http://localhost:5173
Content-Type: application/json
```

Request body:

```typescript
interface BridgeInvokeRequest {
  channel: string;
  data?: unknown;
  requestId: string;
}
```

Response body:

```typescript
interface BridgeInvokeResponse<T = unknown> {
  status: boolean;
  msg: string;
  data: T | null;
  requestId: string;
}
```

The response shape mirrors the existing IPC result pattern used by `windowInvoke`.

## 8. Event Contract

WebSocket endpoint:

```text
GET /__aifetchly_dev_bridge/events?token=<session-token>
Origin: http://localhost:5173
```

Client message:

```typescript
type BridgeClientEvent =
  | { type: "subscribe"; channel: string; subscriptionId: string }
  | { type: "unsubscribe"; subscriptionId: string };
```

Server message:

```typescript
type BridgeServerEvent =
  | {
      type: "event";
      channel: string;
      subscriptionId: string;
      payload: unknown;
    }
  | {
      type: "error";
      subscriptionId?: string;
      msg: string;
    };
```

The bridge should use the same event channel allowlist as preload where possible, but start with a smaller reviewed set.

## 9. Dispatch Strategy

There are two viable dispatch approaches.

### Option A: Extract Shared Handler Registry

Create an internal registry that both Electron IPC and the dev bridge can call:

```typescript
interface IpcRequestContext {
  source: "electron-renderer" | "dev-browser";
}

type IpcRequestHandler = (
  data: unknown,
  context: IpcRequestContext
) => Promise<CommonMessage<unknown>>;
```

Benefits:

- Cleanest long-term architecture.
- Avoids faking Electron IPC events.
- Makes channel allowlists easier to test.

Cost:

- Requires refactoring registered IPC handlers over time.

### Option B: Bridge-Specific Adapter for Selected Channels

Implement explicit handlers for the browser bridge that call the same modules/controllers as IPC handlers.

Benefits:

- Smaller MVP.
- Lower risk for high-volume existing IPC files.
- Allows a strict first allowlist.

Cost:

- Some duplication until shared registry exists.

Recommendation: start with Option B for the MVP, then extract a shared registry if browser testing becomes a permanent workflow.

## 10. Renderer Transport Adapter

Suggested files:

```text
src/views/utils/ipcTransport.ts
src/views/utils/apirequest.ts
```

Transport interface:

```typescript
export interface RendererIpcTransport {
  invoke(channel: string, data?: unknown): Promise<unknown>;
  send(channel: string, data?: unknown): void;
  sendBinary(channel: string, data?: unknown): void;
  receive<T = unknown>(channel: string, cb: (value: T) => void): void;
  removeListener(channel: string, cb: (value: unknown) => void): void;
  removeAllListeners(channel: string): void;
}
```

Resolution order:

1. If `window.api` exists, use Electron preload transport.
2. Else if `import.meta.env.DEV` and bridge config exists, use dev browser bridge transport.
3. Else throw a clear error: `AiFetchly renderer API is unavailable outside Electron unless dev browser bridge is enabled.`

Keep `windowInvoke`, `windowSend`, and `windowReceive` as public helpers so feature API files do not all need to change at once.

## 11. Browser Bridge Config Delivery

Possible config sources:

1. Vite env variables, such as `VITE_AIFETCHLY_DEV_BRIDGE_URL`.
2. A dev-only well-known endpoint, such as `GET /__aifetchly_dev_bridge/config`.
3. A generated local file read by the Vite dev server.

Recommendation:

- Use env for stable host/port.
- Use per-session token from the bridge startup log or a dev-only config endpoint protected by origin validation.

Do not bake a static token into committed config.

## 12. Security Model

Required controls:

1. Loopback binding only.
2. Per-session bearer token.
3. Strict origin check.
4. Channel allowlist.
5. Payload size limit.
6. JSON schema validation for bridge requests.
7. Dev-only startup gate with `!app.isPackaged`.

High-risk channel categories should stay blocked until reviewed:

- local file reads/writes
- file dialog and path exposure
- plugin import/install/uninstall
- system dependency install
- credential, cookie, and login flows
- task execution that launches automation
- AI file tools and shell-like operations

## 13. Testing Plan

### Unit Tests

1. Bridge activation returns disabled when packaged.
2. Bridge activation returns disabled without env flag.
3. Invalid origin is rejected.
4. Invalid token is rejected.
5. Unsupported channel returns `{ status: false }`.
6. Supported channel preserves `{ status, msg, data }` response shape.

### Integration Tests

1. Start Electron in debug mode with bridge enabled.
2. Open Chrome to the Vite renderer URL.
3. Verify `window.api` is absent but renderer API calls succeed through bridge.
4. Verify blocked channels fail safely.
5. Verify event subscription receives a test event.

### Manual QA

1. Launch `Electron Main` from VS Code.
2. Open Chrome renderer debug config or manually open Vite URL.
3. Navigate through supported pages.
4. Confirm no production bridge starts from packaged app.

## 14. Implementation Phases

### Phase 1: Read-Only MVP

1. Add dev bridge startup gate in main process.
2. Add bridge server with token, origin checks, and invoke endpoint.
3. Add renderer transport abstraction.
4. Add VS Code env flags.
5. Support a small read-only channel allowlist.

### Phase 2: Event Support

1. Add WebSocket event endpoint.
2. Support subscribe/unsubscribe.
3. Relay selected progress channels.
4. Add integration tests for streaming events.

### Phase 3: Expanded QA Coverage

1. Expand channel allowlist based on smoke-test needs.
2. Add browser automation tests.
3. Add a VS Code compound config for Electron plus Chrome.
4. Document supported and blocked channels.

## 15. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Local malicious page calls bridge APIs | Require bearer token, strict origin, loopback binding, and allowlist. |
| Bridge accidentally ships in production | Gate with both env flag and `!app.isPackaged`; add test coverage. |
| Duplicate IPC logic diverges | Keep MVP allowlist small; extract shared handler registry if usage grows. |
| Browser tests depend on dynamic Vite port | Configure a stable dev port before adding Chrome launch automation. |
| High-risk channels leak filesystem or credential access | Block by default and review channel categories before enabling. |

## 16. Acceptance Criteria

1. With VS Code debug env enabled, Electron starts a local bridge on `127.0.0.1`.
2. Chrome can open the Vite renderer and execute supported API calls without Electron preload.
3. Unsupported channels fail safely with a clear message.
4. Packaged production builds do not listen on the bridge port.
5. Existing Electron renderer IPC behavior remains unchanged.
