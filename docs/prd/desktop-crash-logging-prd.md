# AiFetchly Desktop Crash Logging and Diagnostics PRD

| Field | Value |
|------|-------|
| Document version | v1.0 |
| Created date | 2026-07-03 |
| Status | Draft |
| Product area | Electron desktop app |
| Related backend PRD | `/home/robertzeng/project/marketing/doc/crash-report-ingestion-prd.md` |
| Reference | `/home/robertzeng/project/github/claude-code/docs/CRASH-LOGS.md` |

## 1. Summary

AiFetchly desktop currently writes too much application output into log files and does not preserve crash data in a structured, uploadable format. The logging system should be changed from "capture everything" to "capture the right events", with separate sinks for normal logs, errors, crash reports, and optional debug diagnostics.

The first release should reduce local log volume, reliably record fatal events from the main process, renderer, Electron child processes, and worker processes, then allow users to export or submit a sanitized crash report to the backend service.

## 2. Background

The current desktop logger is centered on `src/modules/Logger.ts`. It configures `electron-log`, sets file logging to `debug`, and overrides `console.log`, `console.info`, `console.debug`, `console.warn`, and `console.error` so console output is mirrored into the log file.

That design creates two product problems:

- Normal development/debug output becomes production log data.
- Crash-worthy events are not isolated from noisy logs, so support cannot reliably collect the right data.

The app already has basic handlers in `src/background.ts` for `uncaughtException` and `unhandledRejection`, and worker log forwarding exists through `process.send({ type: "worker-log", ... })`. These are useful starting points, but they do not provide durable crash reports, native crash dumps, renderer crash capture, retention controls, or upload flow.

Claude Code's crash log approach provides a useful pattern:

- global process handlers for fatal errors
- structured error sink
- crash recovery pointer or durable session marker
- optional crash/debug behavior
- retention-limited JSONL storage

AiFetchly should use the same principles while fitting Electron, Vue, TypeScript, worker processes, and the existing IPC architecture.

## 3. Goals

1. Reduce production log noise by default.
2. Stop writing all `console.*` output into persistent log files.
3. Persist structured crash records for main process, renderer, Electron child process, GPU process, and worker failures.
4. Capture enough context to diagnose crashes without storing sensitive user data.
5. Allow users to export diagnostics locally.
6. Allow users to submit crash reports to the backend with consent.
7. Enforce local retention, file size limits, and report size limits.
8. Keep worker processes free of direct database access.

## 4. Non-Goals

1. Do not build a full observability platform inside the desktop app.
2. Do not upload complete application logs automatically.
3. Do not store scraped page content, email bodies, cookies, access tokens, or refresh tokens in crash reports.
4. Do not require login before local crash reports are recorded.
5. Do not rewrite all existing `console.*` usage in one release.
6. Do not change backend logging behavior in this PRD. Backend ingestion is covered by the companion backend PRD.

## 5. Users

### 5.1 End Users

Users need the app to remain usable and not consume disk space with noisy logs. If the app crashes, they need a simple way to send useful diagnostics without exposing private campaign data.

### 5.2 Support Operators

Support needs a compact report that identifies the app version, OS, crash reason, stack trace, recent app breadcrumbs, and task context.

### 5.3 Developers

Developers need structured crash data and optional debug logs that can be enabled temporarily without making all users pay the disk and privacy cost.

## 6. Product Requirements

### FR-1 Log Sink Separation

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.1 | Create separate local files for `app.log`, `error.jsonl`, `crash.jsonl`, and optional `debug.log`. | P0 |
| FR-1.2 | Default production file level must be `warn` or `error`, not `debug`. | P0 |
| FR-1.3 | `debug.log` must be disabled by default and enabled only through user setting, env var, or debug support flow. | P0 |
| FR-1.4 | Remove automatic persistent capture of all `console.*` calls. | P0 |
| FR-1.5 | Keep console output visible in development without writing it all to disk. | P1 |

### FR-2 Structured Error Sink

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-2.1 | Add an `ErrorLogSink` that writes JSONL records for handled errors. | P0 |
| FR-2.2 | Normalize `unknown`, `Error`, HTTP errors, IPC errors, and worker errors into a shared schema. | P0 |
| FR-2.3 | Include timestamp, level, process type, feature, message, stack, app version, platform, arch, session id, and install id. | P0 |
| FR-2.4 | Truncate long message, stack, request body, response body, and metadata values. | P0 |
| FR-2.5 | Maintain an in-memory ring buffer of the last 100 error records for crash report bundling. | P1 |

### FR-3 Crash Capture

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-3.1 | Record `process.on("uncaughtException")` into `crash.jsonl`. | P0 |
| FR-3.2 | Record `process.on("unhandledRejection")` into `crash.jsonl` when it is fatal or app-stability relevant. | P0 |
| FR-3.3 | Record `app.on("render-process-gone")` into `crash.jsonl`. | P0 |
| FR-3.4 | Record `app.on("child-process-gone")` into `crash.jsonl`. | P0 |
| FR-3.5 | Record `app.on("gpu-process-crashed")` into `crash.jsonl`. | P1 |
| FR-3.6 | Record `webContents` unresponsive and responsive transitions as breadcrumbs. | P1 |
| FR-3.7 | Start Electron `crashReporter` to collect native crash dumps where supported. | P1 |
| FR-3.8 | On abnormal worker exit, record worker type, task id, pid, exit code, signal, and last safe breadcrumbs. | P0 |

### FR-4 Renderer Error Reporting

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-4.1 | Add preload-safe API for renderer error reporting to main process. | P0 |
| FR-4.2 | Capture `window.onerror` and `window.onunhandledrejection`. | P0 |
| FR-4.3 | Sanitize renderer error payload before sending to main. | P0 |
| FR-4.4 | Main process must schema-validate renderer error IPC payloads before writing. | P0 |

### FR-5 Privacy and Redaction

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-5.1 | Redact access tokens, refresh tokens, cookies, API keys, authorization headers, and passwords. | P0 |
| FR-5.2 | Redact URL query parameters known to carry tokens. | P0 |
| FR-5.3 | Do not include scraped page HTML, email content, contact lists, uploaded files, or AI prompt bodies by default. | P0 |
| FR-5.4 | Provide a redaction utility used by all log and crash sinks. | P0 |
| FR-5.5 | Redaction must run before disk write and before upload. | P0 |

### FR-6 Local Retention and Disk Controls

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-6.1 | Keep normal logs for a maximum of 14 days by default. | P0 |
| FR-6.2 | Keep crash reports for a maximum of 30 days by default. | P0 |
| FR-6.3 | Enforce per-file max size. Recommended: `app.log` 5 MB, `error.jsonl` 10 MB, `crash.jsonl` 10 MB, `debug.log` 20 MB. | P0 |
| FR-6.4 | Enforce total diagnostics directory max size. Recommended: 200 MB default. | P0 |
| FR-6.5 | Delete oldest diagnostics first when over size budget. | P0 |
| FR-6.6 | Never block app startup because cleanup failed. | P0 |

### FR-7 Crash Report Export and Upload

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-7.1 | Add an IPC handler to build a sanitized crash report package. | P0 |
| FR-7.2 | Add a UI entry point for "Export diagnostic report". | P1 |
| FR-7.3 | Add a UI entry point for "Send crash report" when backend ingestion is available. | P1 |
| FR-7.4 | Upload only structured crash data and recent error records, not full logs by default. | P0 |
| FR-7.5 | If the user is logged in, attach authenticated user context through the existing auth flow. | P1 |
| FR-7.6 | If the user is not logged in, allow anonymous report upload with install id and app version only. | P1 |

### FR-8 Crash Detection on Next Startup

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-8.1 | Write a startup marker when app launches. | P1 |
| FR-8.2 | Clear the marker on clean shutdown. | P1 |
| FR-8.3 | On next launch, if the marker remains, create an `unclean-shutdown` crash record. | P1 |
| FR-8.4 | Prompt the user to send diagnostics after repeated crashes, subject to product copy and i18n. | P2 |

## 7. Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | Crash write path should be synchronous or flush-safe enough to survive process termination where possible. |
| NFR-2 | Normal logging must not materially slow scraping or AI streaming workflows. |
| NFR-3 | New TypeScript must not use `any`; use `unknown` plus schema validation. |
| NFR-4 | New IPC handlers must not access database directly. Use modules if persistence is needed. |
| NFR-5 | User-facing text must be translated in English, Chinese, Spanish, French, German, and Japanese. |
| NFR-6 | Crash report packaging must be deterministic and testable. |

## 8. Suggested File Ownership

```
src/
├── modules/
│   ├── Logger.ts                         # revise existing logger config
│   ├── diagnostics/
│   │   ├── ErrorLogSink.ts               # new
│   │   ├── CrashLogSink.ts               # new
│   │   ├── DiagnosticRedactor.ts         # new
│   │   ├── DiagnosticRetentionService.ts # new
│   │   ├── DiagnosticReportBuilder.ts    # new
│   │   └── DiagnosticSchemas.ts          # new
├── main-process/
│   └── communication/
│       └── diagnostics-ipc.ts            # new
├── preload.ts                            # expose renderer-safe reporting API
└── views/
    └── api/
        └── diagnostics.ts                # new renderer API wrapper
```

## 9. Crash Record Schema

```typescript
interface CrashRecord {
  schemaVersion: 1;
  timestamp: string;
  crashId: string;
  sessionId: string;
  installId: string;
  appVersion: string;
  platform: string;
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

## 10. UX Requirements

### 10.1 Diagnostics Settings

Users should be able to:

- open diagnostics folder
- export diagnostic report
- enable debug logging temporarily
- see current diagnostics storage usage
- clear local diagnostics

### 10.2 Crash Prompt

After a crash or repeated unclean shutdown:

- explain that the app detected a crash
- show what will be sent at a high level
- offer "Send report", "Export report", and "Dismiss"
- do not show raw stack traces by default

## 11. Backend Contract

The desktop app should send crash reports to the backend endpoint defined in the companion backend PRD.

Minimum request fields:

```json
{
  "schemaVersion": 1,
  "appVersion": "x.y.z",
  "platform": "linux",
  "arch": "x64",
  "installId": "uuid",
  "sessionId": "uuid",
  "crash": {},
  "recentErrors": [],
  "breadcrumbs": []
}
```

Maximum request size should be below the backend limit. Recommended desktop package limit: 200 KB for normal reports and 1 MB only when the user explicitly includes extra diagnostics.

## 12. Rollout Plan

### Phase 1: Local Logging Cleanup

- Stop persistent console capture.
- Lower production file logging level.
- Add retention and directory size budget.
- Add redaction utility.

### Phase 2: Local Crash Records

- Add `CrashLogSink` and `ErrorLogSink`.
- Wire main, renderer, app, webContents, and worker crash events.
- Add tests for schema validation, redaction, truncation, and retention.

### Phase 3: Export and Upload

- Add diagnostic report builder.
- Add IPC and renderer API.
- Add settings UI.
- Integrate backend upload endpoint.

### Phase 4: Crash Prompt and Native Dumps

- Add unclean shutdown detection.
- Add repeated-crash prompt.
- Enable Electron native crash reporter if privacy and storage constraints are satisfied.

## 13. Success Metrics

| Metric | Target |
|--------|--------|
| Median daily local log volume | Reduced by at least 80 percent |
| Crash report availability after fatal crash | At least 95 percent in test scenarios |
| Crash report upload request size | Less than 200 KB by default |
| Reports containing known token patterns | 0 |
| Diagnostics directory exceeding size budget | 0 after cleanup job runs |
| Support tickets requiring manual full-log collection | Reduced by at least 50 percent |

## 14. Acceptance Criteria

1. Production startup no longer writes debug/test logger messages into persistent logs.
2. Calling `console.log` does not write to `app.log` in production.
3. A simulated uncaught exception creates a `crash.jsonl` record.
4. A simulated renderer crash creates a `crash.jsonl` record.
5. A simulated worker abnormal exit creates a `crash.jsonl` record.
6. A diagnostic export excludes tokens and oversized fields.
7. Diagnostics cleanup deletes old files and respects total size budget.
8. Tests cover redaction, truncation, retention, crash schema validation, and report building.

## 15. Open Questions

1. Should anonymous crash upload be enabled by default after user consent, or only through manual action?
2. What is the exact diagnostics directory size budget for packaged desktop builds?
3. Should native crash dumps be uploaded, or only stored locally for explicit export?
4. Should debug logging auto-disable after a fixed time window?
5. Which app settings page should host diagnostics controls?
