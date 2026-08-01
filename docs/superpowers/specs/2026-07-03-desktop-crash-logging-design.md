# Desktop Crash Logging and Diagnostics — Implementation Design

| Field | Value |
|------|-------|
| Document version | v1.0 |
| Created date | 2026-07-03 |
| Status | Approved |
| Product PRD | `docs/prd/desktop-crash-logging-prd.md` |
| Technical design | `docs/prd/desktop-crash-logging-technical-design.md` |
| Backend companion | `/home/robertzeng/project/marketing/doc/crash-report-ingestion-prd.md` |

## 1. Summary

Replace AiFetchly desktop's "log every console call to disk" behavior with a bounded diagnostics system: separate sinks for normal logs, structured errors, structured crashes, and optional debug output. Capture fatal events from the main process, renderer, Electron child processes, GPU process, and worker processes. Sanitize, retain locally, and (with user consent) submit crash reports to the backend `POST /api/crash-reports` endpoint.

## 2. Resolved Open Questions (PRD §15)

| # | Question | Resolution |
|---|----------|-----------|
| 1 | Anonymous upload default | **Manual only.** Each upload requires an explicit click. A one-time consent setting (`diagnostics.consentSendReports`) gates the action; no auto-upload. |
| 2 | Diagnostics directory budget | **200 MB** total (per PRD recommendation). |
| 3 | Native crash dumps upload | **Local only.** Dumps stored in `userData/diagnostics/native-dumps/`, included only when user clicks "Export diagnostic report". Never auto-uploaded. |
| 4 | Debug logging auto-disable | **Auto-disable after 24 hours.** Stored as an ISO expiry timestamp in `SystemSetting`. |
| 5 | Diagnostics UI host | **Existing settings page.** Add a `DiagnosticsSection.vue` component to the existing settings page found in `src/views/pages/`. |

## 3. Scope

All four PRD phases are implemented in this pass:

- **Phase 1** — Log sink separation, console-capture removal, redaction utility, retention controls.
- **Phase 2** — Local crash records (`crash.jsonl`), structured errors (`error.jsonl`), main/renderer/worker/Electron-app crash event wiring.
- **Phase 3** — Diagnostic report builder, IPC + renderer API, settings UI, backend upload integration.
- **Phase 4** — Unclean shutdown detection, repeated-crash prompt, Electron native `crashReporter`.

## 4. Module Layout

```
src/modules/diagnostics/
├── DiagnosticSchemas.ts              # Zod schemas + TS types
├── DiagnosticPaths.ts                # resolves userData/diagnostics/, ensures dirs
├── DiagnosticIdentity.ts             # sessionId (per-process), installId (persisted)
├── DiagnosticRedactor.ts             # regex + structured redaction
├── DiagnosticSerializer.ts           # truncation + JSONL line formatting
├── DiagnosticBreadcrumbBuffer.ts     # in-memory ring buffers (breadcrumbs + errors)
├── ErrorLogSink.ts                   # async append JSONL writer
├── CrashLogSink.ts                   # synchronous flush JSONL writer
├── DiagnosticRetentionService.ts     # 14/30-day policy + 200 MB budget
├── DiagnosticReportBuilder.ts        # sanitized package assembly
├── DiagnosticUploadClient.ts         # POST to backend (main-only)
└── CrashReporterService.ts           # facade: record* methods + Electron app event wiring

src/schemas/ipc/diagnostics.ts        # Zod schemas for renderer→main IPC payloads
src/main-process/communication/diagnostics-ipc.ts
src/views/api/diagnostics.ts          # renderer wrapper
src/preload.ts                        # new window.diagnostics surface
src/views/components/settings/DiagnosticsSection.vue
```

The redactor is a **new, standalone** module — `pluginSourceRedact.ts` is plugin-specific and intentionally not reused to keep the two subsystems decoupled.

## 5. Data Contracts

### 5.1 Crash Record (local file shape)

```typescript
interface CrashRecord {
  schemaVersion: 1;
  timestamp: string;          // RFC3339
  crashId: string;            // uuid v4
  sessionId: string;
  installId: string;
  appVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  processType: 'main' | 'renderer' | 'worker' | 'utility' | 'gpu' | 'unknown';
  crashType:
    | 'uncaught-exception'
    | 'unhandled-rejection'
    | 'render-process-gone'
    | 'child-process-gone'
    | 'gpu-process-crashed'
    | 'worker-exit'
    | 'unclean-shutdown';
  feature?: string;
  taskId?: string;
  workerType?: string;
  message: string;
  stack?: string;
  reason?: string;
  exitCode?: number;
  signal?: string;
  breadcrumbs: DiagnosticBreadcrumb[];
}
```

### 5.2 Error Record

```typescript
interface ErrorRecord {
  schemaVersion: 1;
  timestamp: string;
  errorId: string;
  sessionId: string;
  level: 'warn' | 'error';
  processType: 'main' | 'renderer' | 'worker';
  feature?: string;
  message: string;
  stack?: string;
  metadata?: Record<string, string | number | boolean | null>;
}
```

### 5.3 Breadcrumb

```typescript
interface DiagnosticBreadcrumb {
  timestamp: string;
  category: string;            // e.g. 'nav', 'ipc', 'worker', 'lifecycle'
  message: string;
  level?: 'info' | 'warn' | 'error';
}
```

### 5.4 Upload Package (matches backend `CrashReportRequest`)

```typescript
interface DiagnosticReportPackage {
  schemaVersion: 1;
  appVersion: string;
  platform: string;
  arch: string;
  installId: string;
  sessionId: string;
  crash: CrashRecord;
  recentErrors: ErrorRecord[];
  breadcrumbs: DiagnosticBreadcrumb[];
}
```

The backend (`services/crashreport/schema.go`) validates: `schemaVersion=1`, RFC3339 `crash.timestamp`, allowed `processType`, `crashType` lower-snake-case, length caps on message/stack/breadcrumbs/recentErrors. Desktop serializer must produce values inside these caps **before** upload.

## 6. Logger Changes (`src/modules/Logger.ts`)

### 6.1 Removed in production

- `console.*` monkey-patching (current lines 201-231) — gated behind `isDevelopment` only.
- Startup "Log directory created/verified at:" writes (lines 154-155) and `verifyLogFile()` test writes (lines 233-243).
- File-level `debug` default (line 137) → `warn` (or `debug` only when debug mode enabled).

### 6.2 New transport config

```typescript
const debugEnabled = isDebugLoggingEnabled();  // env AIFETCHLY_DEBUG_LOGS, or SystemSetting expiry
file.level = debugEnabled ? 'debug' : 'warn';
console.level = isDevelopment ? 'debug' : false;  // electron-log console transport off in prod
```

### 6.3 Backward compatibility

`log.info/warn/error/debug` API stays identical. The 100+ existing call sites continue to work unchanged. Worker stub (`createWorkerLogProxy`) stays unchanged.

The existing daily-date-folder structure (`logs/YYYY-MM-DD/main.log`) is preserved. The new `userData/diagnostics/` directory is separate; both are managed by `DiagnosticRetentionService`.

## 7. Crash Capture Wiring

### 7.1 Main process (`background.ts`)

```typescript
// After diagnostics init, before app.whenReady
crashReporterService.installProcessHandlers(process);
crashReporterService.installAppHandlers(app);
```

- `uncaughtException` writes a crash record, then defers to existing behavior (no swallowing). The existing `dialog.showErrorBox` call stays.
- `unhandledRejection` records only when value is an `Error` or explicitly flagged fatal (FR-3.2). Other rejections remain warnings.
- `app.on('render-process-gone')` maps `details` into `exitCode` / `reason`.
- `app.on('child-process-gone')` maps Electron child-process exits.
- `app.on('gpu-process-crashed')` and `webContents` unresponsive/responsive transitions are recorded (P1).
- Handlers persist records and breadcrumbs, never pretend the process is healthy.

### 7.2 Renderer (`src/main.ts` after `createApp`)

```typescript
window.addEventListener('error', e => reportRendererError(toRendererErrorPayload(e)));
window.addEventListener('unhandledrejection', e => reportRendererError(toUnhandledRejectionPayload(e.reason)));
```

- Payloads Zod-validated in main before write (FR-4.4).
- Rate-limited in main (max 10 renderer-error IPC per webContents per minute) to prevent renderer-side loops from spamming.
- Renderer strips `event.error.stack` length and obvious token patterns before IPC as defense-in-depth; main redactor is authoritative.

### 7.3 Worker processes (`src/childprocess/**`, `src/modules/ChildProcessManager.ts`)

Extended worker message contract:

```typescript
type WorkerDiagnosticMessage =
  | { type: 'worker-log'; level: 'info' | 'warn' | 'error' | 'debug'; args: unknown[] }
  | { type: 'worker-error'; feature?: string; message: string; stack?: string }
  | { type: 'worker-crash-context'; breadcrumbs: DiagnosticBreadcrumb[] };
```

`ChildProcessManager` listens for `exit`. On non-zero exit code or signal, calls:

```typescript
crashReporterService.recordWorkerExit({ pid, taskId, workerType, code, signal });
```

Worker entries send a final `worker-crash-context` breadcrumb on graceful shutdown for diagnostic context. Workers never write to disk or call Electron APIs directly.

### 7.4 Unclean shutdown detection (FR-8)

- On `app.whenReady`: check `userData/diagnostics/.startup-marker`. If present → write `unclean-shutdown` crash record referencing the prior `sessionId` stored in the marker.
- Write the marker immediately after the check. Marker contents: launch timestamp + sessionId.
- On `app.on('before-quit')` (clean shutdown): delete the marker.

### 7.5 Native crash dumps (FR-3.7)

```typescript
crashReporter.start({
  uploadToServer: false,    // never auto-upload
  compress: true,
  submitURL: '',            // unused
});
```

Started in main after diagnostics init. Dumps land in `userData/diagnostics/native-dumps/`. Local-only; included in export packages but never in upload packages.

## 8. Redaction (`DiagnosticRedactor.ts`)

### 8.1 Patterns

- `Authorization: Bearer ...` → `Authorization: [REDACTED]`
- Access tokens, refresh tokens, API keys, passwords (field-name based)
- Cookies (`Cookie:` header values)
- Query parameters: `token`, `access_token`, `refresh_token`, `code`, `state`, `api_key`
- Long text bodies in metadata (any value > 1 KB is truncated with a `…[truncated N chars]` marker)

### 8.2 Traversal bounds

- Max depth: 5
- Max properties per object: 100
- Allowed leaf types: `string | number | boolean | null`. Any other type is coerced to its `String()` form and length-capped.

### 8.3 Application points

1. **Before disk write** — inside `ErrorLogSink` and `CrashLogSink`.
2. **Before upload** — inside `DiagnosticReportBuilder`.

Both apply the same redactor instance for consistency.

## 9. Truncation (`DiagnosticSerializer.ts`)

Per-field limits enforced before `JSON.stringify`:

| Field | Max |
|-------|-----|
| `message` | 8 KB |
| `stack` | 16 KB |
| `reason` | 1 KB |
| metadata values | 1 KB |
| breadcrumb `message` | 1 KB |

Each JSONL line is hard-capped at 64 KB (the serialized line itself is truncated if necessary).

- `CrashLogSink` uses `fs.appendFileSync` (synchronous) so records survive process termination.
- `ErrorLogSink` uses `fs.createWriteStream` in append mode (async, buffered).

## 10. File Storage

```
userData/diagnostics/
├── app.log                       # important operational events (warn+)
├── error.jsonl                   # structured handled errors
├── crash.jsonl                   # structured crash records
├── debug.log                     # only when debug mode enabled
├── native-dumps/                 # Electron crashReporter minidumps
├── .startup-marker               # unclean-shutdown sentinel
└── install-id.txt                # persisted install id

userData/logs/
└── YYYY-MM-DD/main.log           # legacy electron-log output (retention-managed)
```

JSONL write rules: one JSON object per line, append mode, crash writes synchronous.

## 11. Retention (`DiagnosticRetentionService.ts`)

### 11.1 Schedule

- 5 seconds after startup.
- Every 24 hours via `setInterval`.
- On demand before building an upload package if directory is over budget.

### 11.2 Policy

| Target | Policy |
|--------|--------|
| `app.log`, `debug.log`, `logs/YYYY-MM-DD/` | Delete files older than 14 days |
| `crash.jsonl`, `error.jsonl` | Prune records older than 30 days (rewrite file if >20% pruned) |
| `native-dumps/` | Delete dumps older than 14 days unless marked exported |
| Total budget 200 MB | If exceeded after time-based prune, delete oldest files first across the whole `diagnostics/` + `logs/` tree |

Cleanup failures log a warning and never throw or block startup (FR-6.6).

## 12. Report Export and Upload

### 12.1 Export (`DiagnosticReportBuilder.buildExportPackage`)

- Includes: latest crash, recent errors (last 100), breadcrumbs (last 200), native dump metadata (paths only).
- Optionally includes native dump binary if user opts in.
- Saved to user-chosen path via `dialog.showSaveDialog`.
- No size cap (user-initiated).

### 12.2 Upload (`DiagnosticUploadClient.upload`)

- Endpoint: `POST /api/crash-reports`
- Headers: `Content-Type: application/json`. If logged in: `Authorization: Bearer <token>`. Otherwise anonymous with `installId` only.
- Pre-flight: redact → assemble package → check size ≤ 200 KB (default) or 1 MB (when user opts to include extra diagnostics). Truncate fields if over.
- Expected response: `{ status: true, reportId: string }`.
- Error handling: 429 rate-limited (surface friendly message), 413 too large (truncate and retry once), 4xx/5xx (log and surface to user). Never retry automatically.

## 13. IPC Layer

### 13.1 Channels (added to `src/config/channellist.ts`)

```
DIAGNOSTICS_RENDERER_ERROR          // renderer → main
DIAGNOSTICS_EXPORT_REPORT
DIAGNOSTICS_UPLOAD_REPORT
DIAGNOSTICS_OPEN_FOLDER
DIAGNOSTICS_GET_STATUS              // storage usage, debug-enabled, last crash
DIAGNOSTICS_SET_DEBUG               // enable/disable with 24h auto-expiry
DIAGNOSTICS_CLEAR_LOCAL
DIAGNOSTICS_LIST_CRASHES            // last N crash records for picker UI
```

All inputs validated via Zod schemas in `src/schemas/ipc/diagnostics.ts`. Handlers route through Modules; no direct database access (per CLAUDE.md IPC rule).

### 13.2 Preload surface (`src/preload.ts`)

```typescript
contextBridge.exposeInMainWorld('diagnostics', {
  reportRendererError: (payload) => ipcRenderer.invoke(DIAGNOSTICS_RENDERER_ERROR, payload),
  exportReport: () => ipcRenderer.invoke(DIAGNOSTICS_EXPORT_REPORT),
  uploadReport: (crashId, opts) => ipcRenderer.invoke(DIAGNOSTICS_UPLOAD_REPORT, { crashId, opts }),
  openFolder: () => ipcRenderer.invoke(DIAGNOSTICS_OPEN_FOLDER),
  getStatus: () => ipcRenderer.invoke(DIAGNOSTICS_GET_STATUS),
  setDebug: (enabled) => ipcRenderer.invoke(DIAGNOSTICS_SET_DEBUG, { enabled }),
  clearLocal: () => ipcRenderer.invoke(DIAGNOSTICS_CLEAR_LOCAL),
  listCrashes: () => ipcRenderer.invoke(DIAGNOSTICS_LIST_CRASHES),
});
```

Whitelisted separately from the existing `window.api` surface.

## 14. UI

### 14.1 Diagnostics settings section (`DiagnosticsSection.vue`)

Added to the existing settings page (located in `src/views/pages/`):

```
Diagnostics
├── Storage usage: 23.4 MB / 200 MB   [refresh]
├── [ ] Enable debug logging (auto-disables in 24h)
├── [ ] Allow crash report uploads (manual send only)
├── [ Open diagnostics folder ]
├── [ Export diagnostic report ]   → save dialog
├── [ Send crash report ]           → opens picker showing last 10 crashes
└── [ Clear local diagnostics ]
```

Each control maps to its IPC channel.

### 14.2 Crash prompt (FR-8.4)

On next launch after an `unclean-shutdown`:

- Non-blocking dialog: "The app closed unexpectedly last time. Send diagnostics?"
- Buttons: **Send report** / **Export report** / **Dismiss**
- No raw stack traces shown by default
- If `diagnostics.consentSendReports === 'false'`, "Send" first asks for one-time consent
- Throttled: only shown when there is a new unread crash (compared against `diagnostics.lastPromptedCrashId`)
- Translated across all 6 languages

## 15. Settings Storage

Reuses existing `SYSTEM_SETTING_UPDATE` / `SYSTEM_SETTING_LIST` IPC channels and the `SystemSetting` entity. No new table.

| Key | Type | Default |
|------|------|---------|
| `diagnostics.debugLogExpiry` | ISO timestamp `\| null` | `null` |
| `diagnostics.consentSendReports` | `'true' \| 'false'` | `'false'` |
| `diagnostics.lastPromptedCrashId` | string `\| null` | `null` |

Install ID is **not** a user setting — persisted in `userData/diagnostics/install-id.txt` written once on first launch. Session ID is a per-process uuid regenerated on each launch.

## 16. Internationalization

New `diagnostics.*` i18n key tree added to all six language files in `src/views/lang/`:

- `en.ts` — source of truth
- `zh.ts`, `es.ts`, `fr.ts`, `de.ts`, `ja.ts` — translated

Keys cover: section title, storage label, debug toggle, consent toggle, open/export/send/clear buttons, crash picker labels, crash prompt title/body/buttons, success/error toasts.

## 17. Testing Strategy

### 17.1 Unit tests (`test/vitest/main/service/`)

| File | Coverage |
|------|----------|
| `DiagnosticRedactor.test.ts` | every token pattern, depth limit, property-count limit |
| `DiagnosticSerializer.test.ts` | per-field truncation, JSONL line cap, unicode boundaries |
| `DiagnosticSchemas.test.ts` | Zod parse/reject cases, RFC3339 enforcement |
| `DiagnosticBreadcrumbBuffer.test.ts` | ring buffer eviction, max-size enforcement |
| `ErrorLogSink.test.ts` | append + redaction-before-write |
| `CrashLogSink.test.ts` | synchronous flush, redaction-before-write |
| `DiagnosticRetentionService.test.ts` | 14/30-day pruning, 200 MB budget, oldest-first, no-throw |
| `DiagnosticReportBuilder.test.ts` | package shape, 200 KB / 1 MB limits, allowed fields only |
| `DiagnosticUploadClient.test.ts` | mocked axios: success/429/413/5xx, redacted payload, anon vs authed |
| `CrashReporterService.test.ts` | each `record*` method produces a well-formed CrashRecord |

### 17.2 Integration tests (`test/vitest/main/`)

| File | Coverage |
|------|----------|
| `diagnostics-ipc.integration.test.ts` | invoke each IPC channel via mocked ipcMain, verify files on disk |
| `renderer-error-payload.integration.test.ts` | Zod-validated payload through main handler |
| `worker-exit.integration.test.ts` | simulated non-zero worker exit creates crash record |

### 17.3 Acceptance criteria coverage (PRD §14)

1. Production startup no debug writes → check `app.log` after fresh prod-mode launch.
2. `console.log` doesn't write to `app.log` in production → integration test.
3. Simulated uncaught exception → `crash.jsonl` record exists.
4. Simulated renderer crash → `crash.jsonl` record exists.
5. Simulated worker abnormal exit → `crash.jsonl` record exists.
6. Export excludes tokens → inject known tokens, verify `[REDACTED]` in export.
7. Cleanup deletes old files and respects budget → seed old files, run retention, verify.
8. Tests cover redaction/truncation/retention/schema/report building → covered above.

## 18. Rollout Plan

Commits land one per logical unit (per CLAUDE.md auto-commit rule). Each commit compiles and passes its tests in isolation.

| # | Commit | Verifies |
|---|--------|----------|
| 1 | `feat: add DiagnosticSchemas and types` | Zod schemas compile, unit tests pass |
| 2 | `feat: add DiagnosticPaths and DiagnosticIdentity` | paths resolve, installId persists |
| 3 | `feat: add DiagnosticRedactor` | all token patterns tested |
| 4 | `feat: add DiagnosticSerializer and JSONL sinks` | ErrorLogSink + CrashLogSink |
| 5 | `feat: add DiagnosticBreadcrumbBuffer` | ring buffers work |
| 6 | `feat: add DiagnosticRetentionService` | 14/30-day + 200 MB budget |
| 7 | `refactor: stop production console capture in Logger` | acceptance #1, #2 |
| 8 | `feat: add CrashReporterService and wire background.ts handlers` | acceptance #3 |
| 9 | `feat: add renderer error IPC + preload diagnostics surface` | acceptance #4 |
| 10 | `feat: add worker abnormal exit reporting` | acceptance #5 |
| 11 | `feat: add DiagnosticReportBuilder` | acceptance #6 |
| 12 | `feat: add DiagnosticUploadClient` | upload path, redaction-before-upload |
| 13 | `feat: add diagnostics IPC handlers` | channels registered |
| 14 | `feat: add Diagnostics settings UI section` | UI controls work |
| 15 | `feat: add unclean shutdown detection` | FR-8 |
| 16 | `feat: start Electron crashReporter for native dumps` | FR-3.7 |
| 17 | `feat: add crash prompt dialog` | FR-8.4 |
| 18 | `feat: add i18n translations for diagnostics` | 6 languages |
| 19 | `test: integration tests for crash pipeline` | acceptance #8 |

## 19. Risks

| Risk | Mitigation |
|------|------------|
| Crash handler fails before write | Crash write path is minimal, synchronous, and has no async dependencies. |
| Reports include secrets | Redact at two points (disk write + upload); test known token patterns. |
| Debug logs reintroduce disk growth | Opt-in + 24h auto-expiry timestamp. |
| Renderer loops spam IPC | Rate-limit renderer-error IPC in main (10/min/webContents). |
| Worker messages malformed | Zod-validate before recording; ignore invalid messages with a single warning. |
| Backend endpoint unavailable | Upload client handles 5xx and 503 with friendly user message; local export remains available. |
| Marker file left behind by crash on marker-write | Marker contains timestamp + sessionId; stale marker → unclean-shutdown record; idempotent. |
