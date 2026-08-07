# AiFetchly Desktop Crash Logging and Diagnostics Technical Design

| Field | Value |
|------|-------|
| Document version | v1.0 |
| Created date | 2026-07-03 |
| Status | Draft |
| Product PRD | `docs/prd/desktop-crash-logging-prd.md` |
| Backend companion | `/home/robertzeng/project/marketing/doc/crash-report-ingestion-prd.md` |

## 1. Overview

This design replaces the current "write every console call to the log file" behavior with a bounded diagnostics system:

- normal app logs for important operational events
- structured error JSONL for handled failures
- structured crash JSONL for fatal or process-level failures
- optional debug logs enabled explicitly
- sanitized diagnostic export and upload

The existing `src/modules/Logger.ts` remains the public logger entry point, but its responsibilities should shrink. It should configure transports and retention, not monkey-patch global console methods in production.

## 2. Current State

Important current files:

- `src/modules/Logger.ts`
- `src/background.ts`
- `src/preload.ts`
- `src/main-process/communication/contactExtraction-ipc.ts`
- `src/modules/ChildProcessManager.ts`

Known issues:

- `Logger.ts` sets file level to `debug`.
- `Logger.ts` overrides `console.log`, `console.info`, `console.debug`, `console.warn`, and `console.error`.
- `background.ts` logs `uncaughtException` and `unhandledRejection`, but does not write dedicated crash records.
- Renderer errors are not captured through a structured renderer-to-main IPC path.
- Worker abnormal exits are logged as text, not durable crash records.
- Log retention is date-count based, not total-size-budget based.

## 3. Target Architecture

```text
Renderer
  window.onerror / unhandledrejection
  diagnostics API through preload
        |
        v
Main process IPC
  validates renderer diagnostic payloads
        |
        v
Diagnostics module
  Redactor -> ErrorLogSink / CrashLogSink -> RetentionService
        |
        v
Local diagnostics directory
  app.log
  error.jsonl
  crash.jsonl
  debug.log
  native-dumps/
```

Worker processes keep forwarding diagnostics to the main process over existing process IPC. Workers must not write diagnostics directly to the database or access TypeORM.

## 4. Module Layout

```text
src/modules/diagnostics/
├── DiagnosticSchemas.ts
├── DiagnosticRedactor.ts
├── DiagnosticSerializer.ts
├── DiagnosticPaths.ts
├── ErrorLogSink.ts
├── CrashLogSink.ts
├── DiagnosticBreadcrumbBuffer.ts
├── DiagnosticRetentionService.ts
├── DiagnosticReportBuilder.ts
└── CrashReporterService.ts
```

IPC and renderer API:

```text
src/main-process/communication/diagnostics-ipc.ts
src/views/api/diagnostics.ts
src/preload.ts
```

## 5. Data Contracts

All diagnostic IPC payloads should be schema validated. Use the existing Zod pattern in `src/schemas/` if available for the target channel.

### 5.1 Crash Record

```typescript
export interface CrashRecord {
  schemaVersion: 1;
  timestamp: string;
  crashId: string;
  sessionId: string;
  installId: string;
  appVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  processType: "main" | "renderer" | "worker" | "utility" | "gpu" | "unknown";
  crashType:
    | "uncaught-exception"
    | "unhandled-rejection"
    | "render-process-gone"
    | "child-process-gone"
    | "gpu-process-crashed"
    | "worker-exit"
    | "unclean-shutdown";
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
export interface ErrorRecord {
  schemaVersion: 1;
  timestamp: string;
  errorId: string;
  sessionId: string;
  level: "warn" | "error";
  processType: "main" | "renderer" | "worker";
  feature?: string;
  message: string;
  stack?: string;
  metadata?: Record<string, string | number | boolean | null>;
}
```

### 5.3 Upload Package

```typescript
export interface DiagnosticReportPackage {
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

## 6. Logger Changes

### 6.1 `Logger.ts`

Change responsibilities:

- configure `electron-log` transport paths
- expose `log.info`, `log.warn`, `log.error`, `log.debug`
- schedule retention cleanup
- expose diagnostics directory path

Remove or gate:

- production console monkey-patching
- startup "test log" writes
- debug file level by default

Recommended production levels:

```typescript
file.level = debugEnabled ? "debug" : "warn";
console.level = isDevelopment ? "debug" : false;
```

`debugEnabled` can come from:

- env var such as `AIFETCHLY_DEBUG_LOGS=true`
- user setting
- support mode with expiration

## 7. Crash Capture Wiring

### 7.1 Main Process

Register in `background.ts` after diagnostics initialization:

```typescript
process.on("uncaughtException", (error: Error) => {
  crashReporterService.recordUncaughtException(error);
});

process.on("unhandledRejection", (reason: unknown) => {
  crashReporterService.recordUnhandledRejection(reason);
});

app.on("render-process-gone", (_event, webContents, details) => {
  crashReporterService.recordRenderProcessGone(webContents, details);
});

app.on("child-process-gone", (_event, details) => {
  crashReporterService.recordChildProcessGone(details);
});

app.on("gpu-process-crashed", (_event, killed) => {
  crashReporterService.recordGpuProcessCrashed(killed);
});
```

Do not swallow fatal exceptions silently. The handlers are for persistence and cleanup, not for pretending the process is healthy.

### 7.2 Renderer

Add preload-safe API:

```typescript
contextBridge.exposeInMainWorld("diagnostics", {
  reportRendererError: (payload: RendererErrorPayload) =>
    ipcRenderer.invoke("diagnostics:renderer-error", payload),
});
```

Renderer boot code should attach:

```typescript
window.addEventListener("error", (event) => {
  window.diagnostics.reportRendererError(toRendererErrorPayload(event));
});

window.addEventListener("unhandledrejection", (event) => {
  window.diagnostics.reportRendererError(toUnhandledRejectionPayload(event.reason));
});
```

### 7.3 Worker Processes

Extend worker message contracts:

```typescript
type WorkerDiagnosticMessage =
  | { type: "worker-log"; level: "info" | "warn" | "error" | "debug"; args: unknown[] }
  | { type: "worker-error"; feature?: string; message: string; stack?: string }
  | { type: "worker-crash-context"; breadcrumbs: DiagnosticBreadcrumb[] };
```

`ChildProcessManager` should record abnormal exits:

```typescript
childProcess.on("exit", (code, signal) => {
  if (code !== 0 || signal) {
    crashReporterService.recordWorkerExit({ processId, taskId, code, signal });
  }
});
```

## 8. Redaction

`DiagnosticRedactor` must run before disk writes and upload.

Redact:

- `Authorization: Bearer ...`
- access tokens
- refresh tokens
- cookies
- passwords
- API keys
- query params like `token`, `access_token`, `refresh_token`, `code`, `state`
- long text bodies

Recommended output marker:

```text
[REDACTED]
```

The redactor should operate on strings and structured metadata. Avoid recursive unbounded traversal. Use max depth and max property count.

## 9. File Storage

Diagnostics directory:

```text
app.getPath("userData")/diagnostics/
├── app.log
├── error.jsonl
├── crash.jsonl
├── debug.log
└── native-dumps/
```

JSONL write rules:

- one JSON object per line
- truncate each serialized line to a hard maximum
- use append mode
- crash writes should flush synchronously when possible

Recommended limits:

| File | Max size |
|------|----------|
| `app.log` | 5 MB |
| `error.jsonl` | 10 MB |
| `crash.jsonl` | 10 MB |
| `debug.log` | 20 MB |
| Total diagnostics directory | 200 MB |

## 10. Retention

`DiagnosticRetentionService` should run:

- on startup after a short delay
- every 24 hours
- before building a report package if directory is over budget

Policy:

- normal logs: 14 days
- crash records: 30 days
- native dumps: 14 days unless explicitly exported
- delete oldest files first when over total budget

Cleanup failures should be logged as warnings only.

## 11. Report Upload Flow

```text
User clicks Send crash report
  -> renderer calls diagnostics API
  -> main builds sanitized report package
  -> main sends through existing backend HTTP client
  -> backend returns reportId
  -> renderer shows success/failure
```

The renderer must not call the backend crash endpoint directly. Main process owns auth headers, app metadata, and diagnostic file access.

## 12. Testing Strategy

### Unit Tests

- redaction patterns
- truncation
- JSONL serialization
- crash schema validation
- report package builder
- retention file selection

### Integration Tests

- simulated renderer error through IPC
- simulated worker non-zero exit
- simulated uncaught exception record writer
- report upload request body shape

### Manual QA

- production mode does not write `console.log` into file
- debug mode writes debug logs
- diagnostics export contains no tokens
- diagnostics folder cleanup respects max size

## 13. Migration Steps

1. Add diagnostics module and tests.
2. Change `Logger.ts` to stop production console capture.
3. Wire crash handlers in `background.ts`.
4. Add renderer error IPC.
5. Add worker abnormal exit reporting.
6. Add diagnostic export.
7. Add backend upload integration.
8. Add settings UI and translations.

## 14. Risks

| Risk | Mitigation |
|------|------------|
| Crash handler fails before writing record | Keep crash write path minimal and synchronous. |
| Reports include secrets | Redact before disk and before upload; test known token patterns. |
| Debug logs reintroduce disk growth | Make debug mode opt-in and time-boxed. |
| Renderer reports spam IPC | Rate limit renderer diagnostic IPC in main process. |
| Worker messages are malformed | Validate worker messages before writing diagnostics. |

