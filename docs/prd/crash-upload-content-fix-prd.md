# Crash Upload Content Fix PRD

| Field | Value |
|------|-------|
| Document version | v1.0 |
| Created date | 2026-08-18 |
| Status | Draft |
| Product area | Electron desktop app / diagnostics |
| Parent PRD | `/home/robertzeng/project/aiFetchly/docs/prd/desktop-crash-logging-prd.md` |
| Backend contract | `/home/robertzeng/project/marketing/doc/crash-report-ingestion-prd.md` |

## 1. Summary

The crash-report upload pipeline is wired end to end (`CrashReporterService` → `CrashLogSink` → `DiagnosticReportBuilder` → `DiagnosticUploadClient` → backend), but the package that actually reaches the server is nearly empty in practice. This PRD fixes the three gaps that starve the upload of useful context so a submitted crash report carries enough information for support and engineering to diagnose the failure without manually collecting `main.log`.

## 2. Background

The parent PRD (`desktop-crash-logging-prd.md`) shipped the diagnostics module under `src/modules/diagnostics/` and the IPC handler at `src/main-process/communication/diagnostics-ipc.ts`. A crash upload today sends three payloads:

- `crash` — the crash record itself (message, stack, type, identity). This works.
- `recentErrors` — the in-memory error ring buffer. This is always `[]`.
- `breadcrumbs` — the in-memory breadcrumb ring buffer. This contains only post-crash entries.

The result is that a backend operator receiving a crash report sees the crash message and stack, but no preceding error context and no operational breadcrumbs leading up to the crash. The warn/error log lines that `electron-log` writes to `main.log` — the richest pre-crash signal the app already produces — never reach the diagnostics system at all.

## 3. Root Cause Analysis

### 3.1 `recentErrors` is always empty

`DiagnosticBreadcrumbBuffer.addError()` is defined at `src/modules/diagnostics/DiagnosticBreadcrumbBuffer.ts:20` but is never called from anywhere in the codebase. `ErrorLogSink.write()` (`src/modules/diagnostics/ErrorLogSink.ts:56`) appends to `error.jsonl` on disk but does not push the record into the in-memory ring buffer. `DiagnosticReportBuilder.buildUploadPackage()` reads `cfg.recentErrors` (sourced from `CrashReporterService.getRecentErrors()` → `buffer.getRecentErrors()`), which is always `[]`.

The only writer to `ErrorLogSink` today is `recordRendererErrorPayload()` (`src/modules/diagnostics/CrashReporterService.ts:229`), and even that path does not call `buffer.addError()`.

### 3.2 `breadcrumbs` contain only crash events

`CrashReporterService.addBreadcrumb()` is called from exactly one site: `CrashReporterService.write()` at `src/modules/diagnostics/CrashReporterService.ts:214`, which runs after a crash is already recorded. Normal app operation — module initialization, IPC handler failures, worker spawns, scheduler ticks — never adds breadcrumbs. So the breadcrumb trail uploaded with a crash contains one entry: the crash itself.

### 3.3 `main.log` content is never sent

`Logger.ts` configures `electron-log` to write `warn` and `error` level lines to `main.log` (file transport level is `"warn"` in production, `src/modules/Logger.ts:186`). These lines are the most useful pre-crash signal — they include IPC handler failures, scheduler errors, worker spawn failures, database connection problems, and shutdown errors — but they are invisible to the diagnostics upload pipeline. The report builder has no mechanism to read or include `main.log` tail content.

### 3.4 What is NOT broken

- The wire projection (`projectToWirePayload` in `CrashReportWireSchema.ts:118`) correctly slices `recentErrors` to 50 and `breadcrumbs` to 100 entries, matching the backend caps in `crash-report-ingestion-prd.md`. The backend will not 413 on entry count.
- The redaction utilities (`DiagnosticRedactor.ts`) exist and are applied by both sinks before disk write.
- The upload client (`DiagnosticUploadClient.ts`) correctly posts to `/apis/api/crash-reports` with optional bearer auth and handles 200/429/413.
- Crash capture itself works — `uncaughtException`, `unhandledRejection`, `render-process-gone`, `child-process-gone`, `gpu-process-crashed`, worker exit, and unclean shutdown all flow into `CrashLogSink`.

## 4. Goals

1. Make every main-process `log.warn` and `log.error` call appear in the crash upload's `recentErrors` and `breadcrumbs` without requiring new call sites across the codebase.
2. Make every renderer error reported via the `DIAGNOSTICS_RENDERER_ERROR` IPC appear in `recentErrors`.
3. Include a bounded, redacted tail of `main.log` in the crash upload so the server receives the warn/error log lines surrounding the crash.
4. Keep the upload package within the backend's 256 KB default body limit.
5. Redact all sensitive patterns before upload (tokens, cookies, authorization headers, query-param tokens).
6. Never let a diagnostics feed failure break logging or crash the app.

## 5. Non-Goals

1. Do not change the backend ingestion endpoint or schema beyond what the existing wire contract already supports.
2. Do not send `debug.log` content in crash uploads by default (it may contain scraped page content or AI prompt bodies per parent PRD FR-5.3).
3. Do not rewrite existing `console.*` or `log.*` call sites across the codebase.
4. Do not add a new top-level UI for this fix; the existing "Send crash report" entry point is the trigger.
5. Do not upload `main.log` automatically outside of an explicit user-initiated crash report submission.

## 6. Product Requirements

### FR-1 Logger → Diagnostics Bridge

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.1 | Wrap `Logger.ts`'s `error` and `warn` methods so each call also feeds the diagnostics buffers when running in the main process (not worker). | P0 |
| FR-1.2 | Each `log.error` call must push an `ErrorRecord` (level `"error"`) into the breadcrumb buffer via `buffer.addError()` and add a breadcrumb (category `"log"`, level `"error"`). | P0 |
| FR-1.3 | Each `log.warn` call must push an `ErrorRecord` (level `"warn"`) and add a breadcrumb (category `"log"`, level `"warn"`). | P0 |
| FR-1.4 | The bridge must be best-effort: wrapped in try/catch so a diagnostics failure never breaks logging. | P0 |
| FR-1.5 | The bridge must be inactive in worker processes (worker logging already forwards via `process.send`). | P0 |
| FR-1.6 | The bridge must degrade gracefully when `getCrashReporterFromGlobal()` returns `undefined` (reporter not yet initialized). | P0 |
| FR-1.7 | The bridge must not double-feed when `recordRendererErrorPayload` writes to `ErrorLogSink` (renderer errors arrive via IPC, not via `log.*`). | P1 |

### FR-2 ErrorLogSink → Buffer Mirror

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-2.1 | `ErrorLogSink.write()` must also push the redacted, truncated record into the breadcrumb buffer's error ring via `buffer.addError()`. | P0 |
| FR-2.2 | The buffer reference must be resolved via `getCrashReporterFromGlobal()` at write time, not at module load time (the reporter may not exist yet). | P0 |
| FR-2.3 | When no reporter is available, `ErrorLogSink.write()` must still write to disk and return normally. | P0 |

### FR-3 `main.log` Tail in Upload

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-3.1 | `DiagnosticReportBuilder` must read the last N lines of today's `main.log` and include them as a `mainLogTail` field in the upload package. | P0 |
| FR-3.2 | `main.log` tail must be capped at 200 lines and 32 KB after redaction. | P0 |
| FR-3.3 | The tail must be redacted via `redactString()` before inclusion. | P0 |
| FR-3.4 | When `main.log` does not exist or is unreadable, `mainLogTail` must be omitted (not an empty string, not an error). | P0 |
| FR-3.5 | Only `main.log` (warn-level and above) must be tailed; `debug.log` must never be included by default. | P0 |
| FR-3.6 | The `mainLogTail` field must be added to `DiagnosticReportPackage` (internal schema) and to the wire payload (`CrashReportWireSchema.ts`). | P0 |
| FR-3.7 | The wire schema field must be optional and capped at 32 KB so older backends that do not expect it reject cleanly via `DisallowUnknownFields` rather than crashing. | P1 |

### FR-4 Breadcrumb Enrichment

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-4.1 | Add breadcrumbs for module-level lifecycle events where a single `log.warn`/`log.error` already exists: scheduler init failure, WebSocket shutdown failure, database path creation failure, hook subsystem load failure. | P1 |
| FR-4.2 | Breadcrumbs from `log.*` must use category `"log"` and level matching the log level. | P0 |
| FR-4.3 | Crash breadcrumbs (from `CrashReporterService.write`) must keep category `"crash"` and level `"error"`. | P0 |

### FR-5 Ring Buffer Sizing

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-5.1 | The breadcrumb ring buffer must retain at least 100 entries (the backend cap) so the projection in `projectToWirePayload` has data to slice. | P0 |
| FR-5.2 | The error ring buffer must retain at least 50 entries (the backend cap). | P0 |
| FR-5.3 | `DiagnosticBreadcrumbBuffer` constructor defaults (200 breadcrumbs, 100 errors) already satisfy this; do not reduce them. | P1 |

## 7. Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | The Logger bridge must add less than 1 ms of overhead per `log.error`/`log.warn` call in the common case (buffer push + breadcrumb push). |
| NFR-2 | `main.log` tail reading must be synchronous and bounded; reading must not block the upload IPC for more than 100 ms. |
| NFR-3 | All new TypeScript must use `unknown` plus schema validation, never `any`. |
| NFR-4 | No new IPC handler may access the database directly. |
| NFR-5 | The `mainLogTail` wire field must be optional so the backend can reject it with a clear 400 if the field is unexpected, rather than silently dropping it. |
| NFR-6 | Tests must cover: Logger bridge feeding buffers, ErrorLogSink mirror, main.log tail redaction + truncation, and the full upload package containing non-empty `recentErrors`, `breadcrumbs`, and `mainLogTail`. |

## 8. Suggested File Ownership

```
src/
├── modules/
│   ├── Logger.ts                           # MODIFY: wrap error/warn with diagnostics bridge
│   └── diagnostics/
│       ├── DiagnosticBreadcrumbBuffer.ts   # no change (addError already exists)
│       ├── DiagnosticReportBuilder.ts      # MODIFY: add mainLogTail reader
│       ├── DiagnosticSchemas.ts            # MODIFY: add mainLogTail to DiagnosticReportPackage
│       ├── CrashReportWireSchema.ts        # MODIFY: add mainLogTail to wire payload + projection
│       ├── ErrorLogSink.ts                 # MODIFY: mirror writes into buffer via global reporter
│       └── MainLogTailReader.ts            # NEW: bounded, redacted main.log tail reader
└── test/
    └── vitest/
        └── main/
            └── diagnostics/
                ├── logger-bridge.test.ts    # NEW
                ├── errorlog-mirror.test.ts # NEW
                └── mainlog-tail.test.ts     # NEW
```

## 9. Schema Changes

### 9.1 Internal `DiagnosticReportPackage`

Add an optional `mainLogTail` field:

```typescript
export const diagnosticReportPackageSchema = z.object({
  schemaVersion: z.literal(1),
  appVersion: z.string().min(1).max(64),
  platform: z.string().min(1).max(32),
  arch: z.string().min(1).max(32),
  installId: z.string().min(1).max(128),
  sessionId: z.string().min(1).max(128),
  crash: crashRecordSchema,
  recentErrors: z.array(errorRecordSchema).max(100),
  breadcrumbs: z.array(diagnosticBreadcrumbSchema).max(200),
  mainLogTail: z.string().max(32 * 1024).optional(),   // NEW
});
```

### 9.2 Wire payload (`CrashReportWireSchema.ts`)

Add an optional `mainLogTail` field to `crashReportWireSchema` and include it in `projectToWirePayload`:

```typescript
export const crashReportWireSchema = z.object({
  schemaVersion: z.literal(1),
  appVersion: z.string().min(1).max(64),
  platform: platformWire,
  arch: z.string().max(32),
  installId: z.string().min(1).max(128),
  sessionId: z.string().max(128),
  crash: crashPayloadWireSchema,
  recentErrors: z.array(errorPayloadWireSchema).max(MAX_RECENT_ERROR_ENTRIES),
  breadcrumbs: z.array(breadcrumbWireSchema).max(MAX_BREADCRUMB_ENTRIES),
  mainLogTail: z.string().max(32 * 1024).optional(),   // NEW
});
```

> **Backend coordination required**: the backend's `CrashReportRequest` struct in `marketing/services/crashreport/schema.go` must add a matching `MainLogTail *string \`json:"mainLogTail,omitempty"\`` field. Until the backend ships this, the desktop `projectToWirePayload` must omit the field so `DisallowUnknownFields` does not 400 the upload. Gate the field inclusion behind a feature flag or a backend capability check.

## 10. Implementation Details

### 10.1 Logger Bridge (`src/modules/Logger.ts`)

In the non-worker branch (after `logger = Logger.getInstance()`), wrap the `log` object's `error` and `warn` methods:

```typescript
// Pseudocode — not final code
const originalLog = log;
log = {
  ...originalLog,
  error: (...args: unknown[]) => {
    originalLog.error(...args);
    try {
      const reporter = getCrashReporterFromGlobal();
      if (!reporter) return;
      const message = args.map(a => typeof a === 'string' ? a : safeStringify(a)).join(' ');
      const redacted = redactString(message);
      reporter.addBreadcrumb({ timestamp: new Date().toISOString(), category: 'log', message: redacted, level: 'error' });
      // ErrorRecord push handled by ErrorLogSink mirror (FR-2) or directly here
    } catch { /* never throw from diagnostics */ }
  },
  warn: (...args: unknown[]) => {
    originalLog.warn(...args);
    try {
      const reporter = getCrashReporterFromGlobal();
      if (!reporter) return;
      const message = args.map(a => typeof a === 'string' ? a : safeStringify(a)).join(' ');
      const redacted = redactString(message);
      reporter.addBreadcrumb({ timestamp: new Date().toISOString(), category: 'log', message: redacted, level: 'warn' });
    } catch { /* never throw */ }
  },
};
```

`getCrashReporterFromGlobal` and `redactString` are imported from `@/modules/diagnostics`. The bridge is active only when `!isWorker`.

### 10.2 ErrorLogSink Mirror (`src/modules/diagnostics/ErrorLogSink.ts`)

After the successful disk write in `ErrorLogSink.write()`, resolve the global reporter and push the redacted record into its buffer:

```typescript
async write(rec: ErrorRecord): Promise<void> {
  try {
    const redacted = redactErrorRecord(rec);
    const truncated = truncateErrorRecord(redacted);
    const line = serializeJsonlLine(truncated);
    await new Promise<void>((resolve) => {
      const s = getStream();
      s.write(line, 'utf8', () => resolve());
    });
    // NEW: mirror into the in-memory error ring buffer
    try {
      const reporter = getCrashReporterFromGlobal();
      // DiagnosticBreadcrumbBuffer.addError accepts the ErrorRecord shape
      // Access the buffer via a new method on CrashReporterService or
      // add a pushError passthrough.
      reporter?.pushError(truncated);
    } catch { /* best-effort */ }
  } catch { /* never throw */ }
}
```

Add a `pushError(rec: ErrorRecord): void` method to `CrashReporterService` that calls `this.buffer.addError(rec)`. This avoids exporting the buffer directly and keeps the reporter as the single facade.

### 10.3 MainLogTailReader (`src/modules/diagnostics/MainLogTailReader.ts`)

A pure function that reads the last N lines of today's `main.log`, redacts, and truncates to a byte budget:

```typescript
export interface MainLogTailOptions {
  maxLines?: number;   // default 200
  maxBytes?: number;   // default 32 * 1024
}

export function readMainLogTail(opts: MainLogTailOptions = {}): string | undefined {
  // 1. Resolve today's main.log path via Logger.getLogDir() + date folder
  // 2. Read the file (fs.readFileSync or a bounded tail read)
  // 3. Split into lines, take the last maxLines
  // 4. Join, redactString() the whole tail
  // 5. Truncate to maxBytes (slice from the end to keep the most recent lines)
  // 6. Return undefined if file missing/unreadable
}
```

`DiagnosticReportBuilder.buildUploadPackage()` calls `readMainLogTail()` and sets `pkg.mainLogTail` before the size-budget trim loop.

### 10.4 DiagnosticReportBuilder change

In `buildUploadPackage`, after assembling `pkg`, before the trim loop:

```typescript
const mainLogTail = readMainLogTail();
if (mainLogTail) {
  pkg = { ...pkg, mainLogTail };
}
```

The existing trim loop should prefer dropping breadcrumbs and errors before touching `mainLogTail`, since `mainLogTail` is already size-bounded at 32 KB and is the highest-signal field for diagnosis.

## 11. Rollout Plan

### Phase 1: Logger → Diagnostics Bridge (FR-1, FR-2)

- Wrap `log.error`/`log.warn` in `Logger.ts` with best-effort diagnostics feed.
- Add `pushError` to `CrashReporterService`.
- Mirror `ErrorLogSink.write()` into the buffer.
- Tests: `logger-bridge.test.ts`, `errorlog-mirror.test.ts`.
- Verify: after a `log.error("test")` call, `getRecentErrors()` returns a record with that message.

### Phase 2: `main.log` Tail (FR-3)

- Create `MainLogTailReader.ts`.
- Add `mainLogTail` to `DiagnosticReportPackage` and `CrashReportWireSchema`.
- Wire into `DiagnosticReportBuilder`.
- Tests: `mainlog-tail.test.ts` (redaction, truncation, missing file).
- **Backend coordination**: add `MainLogTail` to `marketing/services/crashreport/schema.go`. Gate desktop-side inclusion until backend ships.

### Phase 3: Breadcrumb Enrichment (FR-4)

- Audit `background.ts` `log.warn`/`log.error` call sites; confirm each now produces a breadcrumb via the bridge.
- No new call sites needed — the bridge covers all existing `log.*` calls automatically.
- Verify breadcrumb diversity in a test crash upload.

### Phase 4: Verification

- End-to-end test: trigger a crash, upload, assert the backend receives non-empty `recentErrors`, `breadcrumbs`, and `mainLogTail`.
- Confirm upload package size stays under 256 KB.
- Confirm no token patterns leak (redaction test with a synthetic Bearer token in a `log.error` call).

## 12. Acceptance Criteria

1. After calling `log.error("scheduler failed")` in the main process, `CrashReporterService.getRecentErrors()` returns an array containing a record with message `"scheduler failed"`.
2. After calling `log.warn("retrying")` in the main process, `CrashReporterService.getBreadcrumbs()` returns an array containing a breadcrumb with category `"log"` and level `"warn"`.
3. A crash upload triggered after `log.error` and `log.warn` calls contains non-empty `recentErrors` and `breadcrumbs` arrays.
4. A crash upload includes a `mainLogTail` field containing the last 200 lines (or fewer) of today's `main.log`, redacted and under 32 KB.
5. A `log.error` call with a message containing `Authorization: Bearer abc123` produces a breadcrumb and error record where the token is replaced with `[REDACTED]`.
6. When the crash reporter is not yet initialized (`getCrashReporterFromGlobal()` returns `undefined`), `log.error` and `log.warn` still write to `main.log` and do not throw.
7. A worker process `log.error` call does not attempt to access the diagnostics buffer (the bridge is inactive in workers).
8. The total upload package size for a crash with 50 recent errors, 100 breadcrumbs, and a 32 KB `mainLogTail` is under 256 KB.

## 13. Open Questions

1. Should `mainLogTail` be sent by default on every crash upload, or only when the user explicitly opts in via the "Send crash report" dialog? (Current proposal: default-on for the "Send crash report" flow, since the user has already consented to sending diagnostics.)
2. Should the backend `MainLogTail` field be required or optional in the wire schema? (Current proposal: optional, so the backend can roll out support independently.)
3. Should `log.info` and `log.debug` calls also produce breadcrumbs, or only `warn` and `error`? (Current proposal: only `warn` and `error`, to keep the breadcrumb buffer focused on failure-adjacent context and avoid noise.)
4. Should the `mainLogTail` reader be invoked at upload time (fresh read) or maintained as a rolling in-memory tail? (Current proposal: read at upload time — simpler, no ongoing memory cost, and the file is already on disk.)
5. Should the Logger bridge be feature-flagged so it can be disabled without a code change if it causes performance issues in production? (Current proposal: no flag; the bridge is best-effort and < 1 ms per call.)
