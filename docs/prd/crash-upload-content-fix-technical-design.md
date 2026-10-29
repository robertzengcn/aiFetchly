# Crash Upload Content Fix Technical Design

| Field | Value |
|------|-------|
| Document version | v1.0 |
| Created date | 2026-08-18 |
| Status | Draft |
| Product PRD | `docs/prd/crash-upload-content-fix-prd.md` |
| Parent design | `docs/prd/desktop-crash-logging-technical-design.md` |
| Backend contract | `/home/robertzeng/project/marketing/doc/crash-report-ingestion-prd.md` |

## 1. Purpose and scope

This design fixes the crash-upload content gaps identified in the companion PRD: `recentErrors` is always empty, `breadcrumbs` contain only the crash event itself, and `main.log` content never reaches the backend. It specifies the exact module changes, function signatures, data flow, schema additions, and tests required to make a submitted crash report carry useful pre-crash context.

In scope:

- Wrap `Logger.ts` `error`/`warn` to feed the diagnostics buffers in the main process.
- Mirror `ErrorLogSink.write()` into the in-memory error ring buffer.
- Add a bounded, redacted `mainLogTail` field to the upload package.
- Extend the internal and wire schemas to carry `mainLogTail`.
- Tests for all three changes.

Out of scope:

- Backend `MainLogTail` schema field implementation (coordinated separately; desktop must gate the field until backend ships).
- Changes to the upload IPC handler flow (`DIAGNOSTICS_UPLOAD_REPORT`) beyond reading the new field.
- `log.info`/`log.debug` breadcrumb enrichment (PRD open question 3; deferred).
- Any UI changes.

## 2. Existing integration points

### 2.1 Logger

`src/modules/Logger.ts` exports a singleton `log` object (either the `electron-log` module or a worker proxy) and a `logger` wrapper exposing `getLogDir()`, `getLogger()`, `scheduleLogCleanup()`, `stopLogCleanup()`.

Key facts relevant to this design:

- `isWorker` (`src/modules/Logger.ts:6`) is true when `process.env.WORKER_TYPE` is set and `process.send` is a function. The bridge must be inactive in this branch.
- `isDevelopment` (`src/modules/Logger.ts:12`) gates the console-override path only; the bridge must run in **both** development and production because diagnostics is needed in production.
- The non-worker branch resolves `log` and `logger` at module load time (`src/modules/Logger.ts:357-377`). The bridge wraps the already-resolved `log` object; it does not re-resolve `electron-log`.
- `Logger.getLogDir()` returns `<userData>/logs`; daily subfolder is `<YYYY-MM-DD>/main.log`.

### 2.2 CrashReporterService

`src/modules/diagnostics/CrashReporterService.ts` owns the `DiagnosticBreadcrumbBuffer` (200 breadcrumbs, 100 errors) and exposes `addBreadcrumb`, `getBreadcrumbs`, `getRecentErrors`, `sessionId`. A singleton is installed on `globalThis.__aifetchlyCrashReporter` in `src/background.ts:178`. `getCrashReporterFromGlobal()` (`src/modules/diagnostics/index.ts:37`) returns it or `undefined` when not yet initialised.

The buffer's `addError(e: ErrorRecord)` (`src/modules/diagnostics/DiagnosticBreadcrumbBuffer.ts:20`) is the intended entry point for error records but is **never called** today. This design wires it up.

### 2.3 ErrorLogSink

`src/modules/diagnostics/ErrorLogSink.ts` writes `ErrorRecord`s to `error.jsonl` via an append stream. It is called from exactly one site: `recordRendererErrorPayload` in `CrashReporterService.ts:242`, which is invoked by the `DIAGNOSTICS_RENDERER_ERROR` IPC handler. `ErrorLogSink.write()` does **not** push to the in-memory buffer today.

### 2.4 DiagnosticReportBuilder

`src/modules/diagnostics/DiagnosticReportBuilder.ts` assembles the upload package from a `crashId` by reading `CrashLogSink.readAll()`, `cfg.breadcrumbs`, and `cfg.recentErrors`. The trim loop drops breadcrumbs first, then errors, then truncates the crash message to stay under 200 KB (1 MB extended). It does not read `main.log`.

### 2.5 CrashReportWireSchema

`src/modules/diagnostics/CrashReportWireSchema.ts` defines `crashReportWireSchema` (the strict backend contract) and `projectToWirePayload(pkg)` which slices `recentErrors` to 50 and `breadcrumbs` to 100 before posting. The backend uses `json.Decoder.DisallowUnknownFields()`, so adding `mainLogTail` to the wire payload **requires** the backend to add the field first or the upload will 400.

### 2.6 Backend contract

`/home/robertzeng/project/marketing/doc/crash-report-ingestion-prd.md` specifies:

- Default body limit 256 KB; extended mode 1 MB for authenticated users with consent.
- `breadcrumbs` capped at 100 entries, `recentErrors` at 50, message 4 KB, stack 32 KB, single breadcrumb message 1 KB.
- Strict schema; unknown fields rejected with 400.

The 256 KB default body limit bounds the total upload: 50 errors × (4 KB message + 32 KB stack) + 100 breadcrumbs × 1 KB + 32 KB `mainLogTail` + crash fields ≈ well under 256 KB when stacks are bounded (in practice stacks are 2-8 KB; the theoretical max is 50 × 36 KB = 1.8 MB which exceeds the limit, but the builder's trim loop already truncates to 200 KB before projection).

## 3. Target architecture

```text
                         main process
┌──────────────────────────────────────────────────────────────┐
│ Logger.ts                                                    │
│  log.error(msg)  ─┐                                          │
│  log.warn(msg)  ──┤                                          │
│                   v                                          │
│           [bridge wrapper]                                  │
│             │                                               │
│             ├─► electron-log → main.log  (existing)         │
│             │                                               │
│             └─► getCrashReporterFromGlobal()                │
│                  │                                          │
│                  ├─► reporter.addBreadcrumb({category:'log'})│
│                  └─► reporter.pushError(ErrorRecord)        │
│                                                     │        │
│ ErrorLogSink.write(rec)                            │        │
│  ├─► error.jsonl  (existing)                       │        │
│  └─► reporter.pushError(rec) ─────────────────────┘        │
│                                                             │
│ DiagnosticReportBuilder.buildUploadPackage(crashId)         │
│  ├─► crash  = CrashLogSink.readAll().find(...)              │
│  ├─► recentErrors  = reporter.getRecentErrors()  (now full) │
│  ├─► breadcrumbs   = reporter.getBreadcrumbs()   (now full)│
│  └─► mainLogTail   = readMainLogTail()           (new)      │
│         │                                                  │
│         v                                                  │
│  projectToWirePayload(pkg)                                 │
│   └─► POST /apis/api/crash-reports                          │
└──────────────────────────────────────────────────────────────┘

worker process (unchanged)
  log.* ─► process.send({type:'worker-log'}) ─► main process
```

### 3.1 Ownership boundaries

- `Logger.ts` owns the bridge; it imports `getCrashReporterFromGlobal` and `redactString` from `@/modules/diagnostics`. The bridge is a thin wrapper, not a new module.
- `CrashReporterService` gains a `pushError(rec: ErrorRecord): void` method that calls `this.buffer.addError(rec)`. It does not redact (callers redact before calling).
- `ErrorLogSink` owns the disk write and the buffer mirror; it imports `getCrashReporterFromGlobal`.
- `MainLogTailReader.ts` is a new pure-function module; it imports `Logger.getLogDir`, `redactString`, and `DiagnosticPaths` helpers. No side effects on the buffer.
- `DiagnosticReportBuilder` owns reading `mainLogTail` and attaching it to the package.
- `CrashReportWireSchema` owns the wire projection of `mainLogTail`.

### 3.2 Why a `pushError` method and not direct buffer access

`DiagnosticBreadcrumbBuffer` is a private field of `CrashReporterService`. Exposing it would break the single-facade invariant. A `pushError` method matches the existing `addBreadcrumb` public API and keeps redaction/truncation responsibility at the caller, consistent with how `addBreadcrumb` is used today (callers pass already-redacted strings).

## 4. Data contracts

### 4.1 Internal `DiagnosticReportPackage`

Add `mainLogTail` to `diagnosticReportPackageSchema` in `src/modules/diagnostics/DiagnosticSchemas.ts`:

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

### 4.2 Wire payload

Add `mainLogTail` to `crashReportWireSchema` and to the `projectToWirePayload` output in `src/modules/diagnostics/CrashReportWireSchema.ts`:

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

In `projectToWirePayload`, add after the `breadcrumbs` block:

```typescript
mainLogTail: pkg.mainLogTail ? cap(pkg.mainLogTail, 32 * 1024) : undefined,
```

### 4.3 `ErrorRecord` (no schema change)

`ErrorRecord` in `src/modules/diagnostics/DiagnosticSchemas.ts:50` already supports `level: 'warn' | 'error'`, `processType: 'main' | 'renderer' | 'worker'`, `feature`, `message`, `stack`, `metadata`. The bridge constructs records matching this shape; no schema change needed.

### 4.4 `mainLogTail` field contract

| Property | Value |
|----------|-------|
| Type | `string \| undefined` |
| Max length | 32 KB after redaction |
| Max lines | 200 |
| Source | today's `<userData>/logs/<YYYY-MM-DD>/main.log` |
| Redaction | `redactString()` applied to the full tail |
| Encoding | UTF-8, joined with `\n` |
| When omitted | file missing, unreadable, empty, or backend feature flag off |

## 5. Module designs

### 5.1 Logger bridge (`src/modules/Logger.ts`)

#### 5.1.1 Placement

The bridge wraps the `log` object in the **non-worker** branch at `src/modules/Logger.ts:357-377`, after `logger = Logger.getInstance()` and before `export { log, logger }`. The worker branch is untouched.

#### 5.1.2 Signature

No new exported function. The bridge is an IIFE that replaces the `log` binding in module scope. Internal helper:

```typescript
function bridgeLogLevel(
  original: (...args: unknown[]) => void,
  level: 'warn' | 'error',
): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    original(...args);
    try {
      const reporter = getCrashReporterFromGlobal();
      if (!reporter) return;  // not yet initialised
      const message = args.map(argToString).join(' ');
      const redacted = redactString(message);
      reporter.addBreadcrumb({
        timestamp: new Date().toISOString(),
        category: 'log',
        message: redacted.slice(0, 1024),   // breadcrumb message cap
        level,
      });
      // ErrorRecord push is handled by ErrorLogSink mirror for renderer path;
      // for main-process log.* there is no ErrorLogSink call, so push directly.
      const rec: ErrorRecord = {
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        errorId: randomUUID(),
        sessionId: reporter.sessionId,
        level,
        processType: 'main',
        message: redacted.slice(0, 8 * 1024),
        stack: undefined,
      };
      reporter.pushError(rec);
    } catch {
      // never throw from diagnostics
    }
  };
}
```

`argToString` is a local helper:

```typescript
function argToString(a: unknown): string {
  if (typeof a === 'string') return a;
  if (a instanceof Error) return a.stack ?? a.message;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}
```

#### 5.1.3 Imports

Add to `src/modules/Logger.ts`:

```typescript
import { getCrashReporterFromGlobal } from '@/modules/diagnostics';
import { redactString } from '@/modules/diagnostics/DiagnosticRedactor';
import { randomUUID } from 'crypto';
import type { ErrorRecord } from '@/modules/diagnostics/DiagnosticSchemas';
```

These imports are lazy-resolved by the bridge at call time (the bridge body runs per `log.*` call, not at module load), so there is no circular-dependency risk at load time. `getCrashReporterFromGlobal` reads `globalThis.__aifetchlyCrashReporter` which is set in `background.ts:178`, after `Logger` loads — so the first few `log.*` calls during early startup will see `undefined` and no-op, which is correct (no buffer exists yet).

#### 5.1.4 Wrapping

```typescript
if (isWorker) {
  // ... existing worker branch unchanged ...
} else {
  // ... existing electron-log resolution and Logger.getInstance() ...
  log = Logger.getInstance().getLogger();  // existing
  logger = Logger.getInstance();            // existing
  // NEW: wrap error/warn with the diagnostics bridge
  const bridged = { ...log };
  bridged.error = bridgeLogLevel(log.error, 'error');
  bridged.warn = bridgeLogLevel(log.warn, 'warn');
  log = bridged;
}
```

`log.info` and `log.debug` are not bridged (PRD open question 3).

#### 5.1.5 Avoiding double-feed on the renderer path

`recordRendererErrorPayload` (`CrashReporterService.ts:229`) calls `ErrorLogSink.write` directly — it does **not** call `log.error`. So the renderer path flows: IPC → `recordRendererErrorPayload` → `ErrorLogSink.write` → (new) `reporter.pushError`. The Logger bridge is not involved. No double-feed.

### 5.2 `CrashReporterService.pushError` (`src/modules/diagnostics/CrashReporterService.ts`)

Add a public method:

```typescript
/**
 * Push a pre-redacted, pre-truncated ErrorRecord into the in-memory ring
 * buffer so it appears in the next crash upload's `recentErrors`. Does not
 * write to disk (the caller — ErrorLogSink or the Logger bridge — owns the
 * disk write). Best-effort: never throws.
 */
pushError(rec: ErrorRecord): void {
  try {
    this.buffer.addError(rec);
  } catch {
    // ignore — best-effort
  }
}
```

`buffer.addError` already caps at `maxErrors` (100). `pushError` does not redact; callers redact before calling (Logger bridge calls `redactString` on the message; ErrorLogSink already redacts via `redactErrorRecord`).

### 5.3 ErrorLogSink mirror (`src/modules/diagnostics/ErrorLogSink.ts`)

Modify `write` to push the redacted+truncated record into the buffer after the disk write succeeds:

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
      reporter?.pushError(truncated);
    } catch {
      // best-effort — disk write already succeeded
    }
  } catch {
    // never throw from the logging path
  }
}
```

New import:

```typescript
import { getCrashReporterFromGlobal } from './index';
```

Wait — `index.ts` re-exports `getCrashReporterFromGlobal`, and `ErrorLogSink.ts` is in the same directory. Importing from `./index` creates a circular import (`index.ts` re-exports from `ErrorLogSink.ts`). To avoid the cycle, import directly from the concrete module:

```typescript
import { getCrashReporterFromGlobal } from './CrashReporterService';
```

But `getCrashReporterFromGlobal` is defined in `index.ts`, not `CrashReporterService.ts`. Move `getCrashReporterFromGlobal` into `CrashReporterService.ts` (it's a one-liner reading `globalThis`) and re-export from `index.ts`. This breaks the cycle cleanly.

#### 5.3.1 Move `getCrashReporterFromGlobal`

From `src/modules/diagnostics/index.ts:37-44` → `src/modules/diagnostics/CrashReporterService.ts` (add at bottom):

```typescript
export function getCrashReporterFromGlobal():
  | CrashReporterService
  | undefined {
  return (
    globalThis as unknown as {
      __aifetchlyCrashReporter?: CrashReporterService;
    }
  ).__aifetchlyCrashReporter;
}
```

`index.ts` keeps its existing re-export (`export { getCrashReporterFromGlobal } from './CrashReporterService'`), updating the source. All existing callers (`diagnostics-ipc.ts`, `Logger.ts` bridge) are unaffected.

### 5.4 `MainLogTailReader` (`src/modules/diagnostics/MainLogTailReader.ts`)

New module. Pure function, no class, no side effects.

```typescript
'use strict';
import * as fs from 'fs';
import * as path from 'path';
import { redactString } from './DiagnosticRedactor';
import { Logger } from '@/modules/Logger';

export interface MainLogTailOptions {
  maxLines?: number;   // default 200
  maxBytes?: number;   // default 32 * 1024
}

/**
 * Read the last N lines of today's main.log, redact sensitive patterns,
 * and truncate to maxBytes. Returns undefined when the file is missing,
 * unreadable, or empty. Never throws.
 *
 * The path is resolved via Logger.getLogDir() + today's date folder,
 * matching the electron-log resolvePathFn in Logger.ts.
 */
export function readMainLogTail(
  opts: MainLogTailOptions = {}
): string | undefined {
  const maxLines = opts.maxLines ?? 200;
  const maxBytes = opts.maxBytes ?? 32 * 1024;
  try {
    const logDir = Logger.getInstance().getLogDir();
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const filePath = path.join(logDir, `${y}-${m}-${d}`, 'main.log');
    if (!fs.existsSync(filePath)) return undefined;
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content) return undefined;
    const lines = content.split('\n');
    const tail = lines.slice(-maxLines).join('\n');
    const redacted = redactString(tail);
    if (redacted.length <= maxBytes) return redacted;
    // Keep the most recent bytes (end of the string) for recency.
    return redacted.slice(redacted.length - maxBytes);
  } catch {
    return undefined;
  }
}
```

#### 5.4.1 Path resolution

`Logger.getLogDir()` returns `<userData>/logs`. The daily subfolder `<YYYY-MM-DD>/main.log` matches `resolvePathFn` at `src/modules/Logger.ts:222-237`. Reading today's file is correct because a crash is uploaded in the same session that produced the logs.

#### 5.4.2 Edge cases

- **File missing**: returns `undefined`; builder omits the field.
- **File empty**: returns `undefined`.
- **File larger than memory**: 200 lines × ~500 bytes/line ≈ 100 KB; `readFileSync` loads it all. Acceptable for a single-shot upload-time read. If this becomes a concern, switch to a reverse-iterator stream read; not needed for v1.
- **Redaction expands string**: `redactString` replaces tokens with `[REDACTED]` (shorter) and truncates overlong values, so output ≤ input + small overhead.
- **`Logger.getInstance()` throws in worker**: `MainLogTailReader` is only called from `DiagnosticReportBuilder` in the main process; the worker branch never reaches it.

### 5.5 `DiagnosticReportBuilder` change (`src/modules/diagnostics/DiagnosticReportBuilder.ts`)

Add the `mainLogTail` read in `buildUploadPackage`, before the trim loop:

```typescript
import { readMainLogTail } from './MainLogTailReader';

// ... inside buildUploadPackage, after assembling `pkg`:
const mainLogTail = readMainLogTail();
if (mainLogTail) {
  pkg = { ...pkg, mainLogTail };
}
```

The existing trim loop (`DiagnosticReportBuilder.ts:48-76`) drops breadcrumbs and errors first, then truncates the crash message. `mainLogTail` is already ≤ 32 KB, so it only matters for the total-size check; the loop should not trim it. If the package is still over budget with `mainLogTail` present, the loop's final `crash.message` trim handles it. Add a guard so the loop never touches `mainLogTail`:

```typescript
// In the trim loop, after breadcrumbs and errors are dropped, if still
// over budget, drop mainLogTail before truncating crash.message.
if (pkg.mainLogTail && Buffer.byteLength(JSON.stringify(pkg)) > max) {
  pkg = { ...pkg, mainLogTail: undefined };
  continue;
}
```

Insert this branch **before** the `crash.message` truncation branch so we prefer keeping the crash message over the log tail when both cannot fit.

### 5.6 `CrashReportWireSchema` change (`src/modules/diagnostics/CrashReportWireSchema.ts`)

#### 5.6.1 Feature flag for backend rollout

The backend's `DisallowUnknownFields` will reject `mainLogTail` until `marketing/services/crashreport/schema.go` adds it. Gate desktop-side inclusion on a capability check:

```typescript
// In projectToWirePayload, after building `built`:
const includeMainLogTail = shouldSendMainLogTail();
return crashReportWireSchema.parse(
  includeMainLogTail ? built : { ...built, mainLogTail: undefined }
);
```

`shouldSendMainLogTail()` reads a setting (env var `AIFETCHLY_SEND_MAIN_LOG_TAIL` or a `Token` value). Default: **off** until the backend ships the field. This avoids a coordinated deploy dance — the desktop ships the reader and schema now, and flips the flag when the backend is ready.

```typescript
function shouldSendMainLogTail(): boolean {
  return process.env.AIFETCHLY_SEND_MAIN_LOG_TAIL === 'true';
}
```

When off, `projectToWirePayload` omits the field entirely (set to `undefined` and `z.string().optional()` allows that). When on, it sends.

#### 5.6.2 Cap constant

Add near the existing `MAX_*` constants:

```typescript
export const MAX_MAIN_LOG_TAIL = 32 * 1024;
```

Use it in the schema and the projection.

## 6. Data flow

### 6.1 Normal `log.error` call in main process

1. Caller invokes `log.error("scheduler failed", err)`.
2. `bridgeLogLevel` runs `original(...args)` → electron-log writes to `main.log`.
3. Bridge resolves `reporter = getCrashReporterFromGlobal()`.
4. If `reporter` is `undefined` (early startup): return. No buffer, no throw.
5. Bridge builds a breadcrumb `{ category: 'log', level: 'error', message: redacted }` and calls `reporter.addBreadcrumb`.
6. Bridge builds an `ErrorRecord` and calls `reporter.pushError`.
7. Buffer now contains the breadcrumb and the error record.

### 6.2 Renderer error via IPC

1. Renderer `window.onerror` → preload → `DIAGNOSTICS_RENDERER_ERROR` IPC.
2. `diagnostics-ipc.ts:327` validates payload, calls `recordRendererErrorPayload(svc, parsed)`.
3. `recordRendererErrorPayload` calls `ErrorLogSink.write({ ... })`.
4. `ErrorLogSink.write` writes to `error.jsonl`, then calls `reporter.pushError(truncated)`.
5. Buffer contains the renderer error. Logger bridge was **not** involved (no `log.error` call), so no double-feed.

### 6.3 Crash upload

1. User clicks "Send crash report" → `DIAGNOSTICS_UPLOAD_REPORT` IPC.
2. `diagnostics-ipc.ts:378` builds package via `makeBuilder().buildUploadPackage(crashId)`.
3. `buildUploadPackage` reads `crash` from `CrashLogSink`, `recentErrors` from `reporter.getRecentErrors()` (now populated), `breadcrumbs` from `reporter.getBreadcrumbs()` (now populated), `mainLogTail` from `readMainLogTail()`.
4. Trim loop ensures ≤ 200 KB (or 1 MB extended).
5. `projectToWirePayload` slices to backend caps (50 errors, 100 breadcrumbs) and conditionally includes `mainLogTail`.
6. `DiagnosticUploadClient.upload(pkg)` POSTs to `/apis/api/crash-reports`.

## 7. Verification design

### 7.1 Logger bridge test (`test/vitest/main/diagnostics/logger-bridge.test.ts`)

- **Setup**: mock `globalThis.__aifetchlyCrashReporter` with a stub `{ addBreadcrumb, pushError, sessionId }` capturing calls.
- **Case 1**: `log.error("test")` calls `addBreadcrumb` with `category: 'log'`, `level: 'error'`, and `pushError` with `level: 'error'`, `processType: 'main'`, message containing `"test"`.
- **Case 2**: `log.warn("test")` produces a breadcrumb with `level: 'warn'` and an error record with `level: 'warn'`.
- **Case 3**: `log.error("Authorization: Bearer abc123")` produces a breadcrumb whose message contains `[REDACTED]` and not `abc123`.
- **Case 4**: with `__aifetchlyCrashReporter` unset, `log.error("test")` does not throw and writes to the original logger.
- **Case 5**: `log.error` with a non-string arg (`log.error(new Error("x"))`) produces a breadcrumb with a string message (not `"[object Object]"`).
- **Case 6**: in a simulated worker (`process.env.WORKER_TYPE` set), the bridge is inactive; `log.error` does not call `addBreadcrumb`.

### 7.2 ErrorLogSink mirror test (`test/vitest/main/diagnostics/errorlog-mirror.test.ts`)

- **Case 1**: `ErrorLogSink.write(rec)` with a mocked reporter calls `reporter.pushError` with the truncated record.
- **Case 2**: with no reporter, `ErrorLogSink.write` still writes to disk (temp dir) and does not throw.
- **Case 3**: the pushed record is redacted (feed a record with `Authorization: Bearer secret`, assert the pushed message contains `[REDACTED]`).

### 7.3 MainLogTail test (`test/vitest/main/diagnostics/mainlog-tail.test.ts`)

- **Case 1**: write a temp `main.log` with 300 lines, assert `readMainLogTail()` returns the last 200.
- **Case 2**: file missing → returns `undefined`.
- **Case 3**: file with a `Bearer abc123` token → returned string contains `[REDACTED]`, not `abc123`.
- **Case 4**: file with 500 KB of lines → returned string ≤ 32 KB and ends with the most recent lines.
- **Case 5**: empty file → returns `undefined`.

### 7.4 Integration test (`test/vitest/main/diagnostics/upload-content.test.ts`)

- **Setup**: stub `globalThis.__aifetchlyCrashReporter` with a real `CrashReporterService`, stub `DiagnosticUploadClient` with a capturing `HttpClientLike`, write a temp `main.log`.
- **Case 1**: after `log.error("pre-crash")` and `log.warn("pre-crash-2")`, trigger a crash record, build and "upload" the package, assert the captured POST body has `recentErrors.length >= 2`, `breadcrumbs.length >= 2`, and `mainLogTail` contains `"pre-crash"`.
- **Case 2**: with `AIFETCHLY_SEND_MAIN_LOG_TAIL` unset, the POST body has `mainLogTail === undefined`.
- **Case 3**: total POST body size < 256 KB.

## 8. Failure handling and recovery

| Failure | Behavior |
|---------|----------|
| `getCrashReporterFromGlobal()` returns `undefined` | Bridge no-ops; `ErrorLogSink` skips mirror; `mainLogTail` still read. |
| `redactString` throws | Caught in bridge; original `log.*` already ran. |
| `reporter.addBreadcrumb` throws | Caught in bridge; original `log.*` already ran. |
| `readMainLogTail` throws | Caught; returns `undefined`; builder omits field. |
| `main.log` missing | `readMainLogTail` returns `undefined`. |
| Backend rejects `mainLogTail` with 400 | Only when feature flag is on; mitigate by keeping flag off until backend ships. |
| `projectToWirePayload` throws on parse | `DiagnosticUploadClient.upload` catches and returns `{ reportId: null, error }`. |

The invariant is: **a diagnostics failure must never break logging or crash the app**. Every new code path wraps in try/catch and degrades to a no-op.

## 9. Performance

- **Logger bridge overhead**: one `getCrashReporterFromGlobal` (object property read), one `redactString` (regex chain over a short string), one `buffer.push` (amortized O(1)). Target: < 1 ms per `log.*` call. `redactString` regexes are anchored and short; the `argToString` JSON.stringify is the main cost and only runs on the actual log call, not additional work.
- **`mainLogTail` read**: one `readFileSync` of a file ≤ ~500 KB (200 lines × ~500 bytes). At upload time only — not per log call. Target: < 50 ms.
- **Buffer memory**: 100 `ErrorRecord`s × ~8 KB message + 16 KB stack ≈ 2.4 MB worst case. Acceptable; the existing 200-breadcrumb buffer is similar.

## 10. Internationalization

No user-facing text is added by this change. The bridge, mirror, and tail reader produce structured data only. The existing "Send crash report" / "Export diagnostic report" UI strings (already translated per the parent PRD) are unchanged.

## 11. Tests

Run with `yarn test:components` (Vue component tests) is not applicable; these are main-process Vitest tests. Run with `yarn testmain` or the vitest main runner.

| Test file | Covers |
|-----------|--------|
| `test/vitest/main/diagnostics/logger-bridge.test.ts` | FR-1.1–1.7 |
| `test/vitest/main/diagnostics/errorlog-mirror.test.ts` | FR-2.1–2.3 |
| `test/vitest/main/diagnostics/mainlog-tail.test.ts` | FR-3.1–3.5 |
| `test/vitest/main/diagnostics/upload-content.test.ts` | AC 1–8 (integration) |

All tests must pass under `yarn testmain`. The integration test must assert the 256 KB body limit.

## 12. Implementation sequence

1. **Move `getCrashReporterFromGlobal`** from `index.ts` to `CrashReporterService.ts`; update `index.ts` re-export. No behavior change. Run existing tests; all pass.
2. **Add `CrashReporterService.pushError`** + tests for the method. No callers yet; tests pass.
3. **Add `ErrorLogSink` mirror** + tests. Renderer errors now populate the buffer.
4. **Add `MainLogTailReader`** + tests. Standalone; no callers yet.
5. **Extend `DiagnosticSchemas`** with `mainLogTail` field. No callers yet.
6. **Extend `CrashReportWireSchema`** with `mainLogTail` + `shouldSendMainLogTail` flag + projection. Flag defaults off.
7. **Wire `readMainLogTail` into `DiagnosticReportBuilder`** + the trim-loop guard. Integration test for `mainLogTail` presence when flag is on.
8. **Add the Logger bridge** in `Logger.ts` + bridge tests. This is last because it depends on `pushError` and `getCrashReporterFromGlobal` being in place.
9. **End-to-end integration test** (`upload-content.test.ts`) covering the full flow.
10. **Run `yarn tsc`** and `yarn testmain`; fix any type errors.

Each step is independently committable (per AGENTS.md auto-commit rule). Steps 1–4 are additive and cannot break existing behavior. Step 6 adds a schema field that is optional and flag-gated, so it cannot break uploads. Step 8 is the only step that changes runtime behavior of `log.*` calls.

## 13. Deferred decisions

1. **`log.info` / `log.debug` breadcrumbs** — deferred per PRD open question 3. The bridge only wraps `error` and `warn`. If breadcrumb density is too low in production, extend the bridge to `info` in a follow-up.
2. **`mainLogTail` rolling in-memory tail** — deferred per PRD open question 4. Read-at-upload-time is simpler and sufficient; a rolling tail would reduce upload-time latency but add steady-state memory.
3. **Backend `MainLogTail` field** — the desktop ships the schema and reader now, gated by `AIFETCHLY_SEND_MAIN_LOG_TAIL`. The backend PRD update is a separate coordinated change.
4. **`mainLogTail` in local export** — the `DIAGNOSTICS_EXPORT_REPORT` path also uses `DiagnosticReportBuilder`, so local JSON exports will include `mainLogTail` when the flag is on. This is desirable but not explicitly required by the PRD; leaving it on by default for export is acceptable.

## 14. Risks

| Risk | Mitigation |
|------|------------|
| Bridge adds latency to hot `log.*` paths | < 1 ms target; regex + buffer push only. Measure in integration test. |
| `mainLogTail` leaks sensitive data | `redactString` applies the same patterns used for all other diagnostic fields; test asserts redaction. |
| Circular import (`Logger` ↔ `diagnostics`) | `getCrashReporterFromGlobal` moved to `CrashReporterService.ts`; `Logger` imports it from there, not from `index.ts`. `CrashReporterService` does not import `Logger`. |
| Backend 400 on `mainLogTail` | Feature flag defaults off; flip only after backend ships. |
| Buffer overflow under high error rate | `DiagnosticBreadcrumbBuffer` caps at 100 errors / 200 breadcrumbs; oldest dropped. |
| `randomUUID` in bridge slows hot path | `crypto.randomUUID` is ~microseconds; acceptable. If needed, lazy-import `crypto`. |

## 15. Related documents

- PRD: `docs/prd/crash-upload-content-fix-prd.md`
- Parent PRD: `docs/prd/desktop-crash-logging-prd.md`
- Parent technical design: `docs/prd/desktop-crash-logging-technical-design.md`
- Backend contract: `/home/robertzeng/project/marketing/doc/crash-report-ingestion-prd.md`
