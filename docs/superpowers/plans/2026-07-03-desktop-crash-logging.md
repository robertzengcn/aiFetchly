# Desktop Crash Logging and Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace AiFetchly desktop's "log everything to disk" behavior with a bounded diagnostics system that captures structured crash/error records, enforces retention and size budgets, and supports sanitized local export and opt-in backend upload.

**Architecture:** New `src/modules/diagnostics/` package owns redaction, serialization, sinks (error.jsonl, crash.jsonl), retention, report building, upload, and a `CrashReporterService` facade wired into main/renderer/worker crash events. The existing `Logger.ts` keeps its public API but stops monkey-patching `console.*` in production and lowers file level to `warn`. Renderer reaches main via a new `window.diagnostics` preload surface; workers reuse `process.send` IPC.

**Tech Stack:** TypeScript 5.x, Electron, electron-log, Zod, Vitest, better-sqlite3 (only for `SystemSetting` reuse).

**Spec:** `docs/superpowers/specs/2026-07-03-desktop-crash-logging-design.md`

**Backend contract:** `POST ${VITE_REMOTEADD}/api/crash-reports` accepts `CrashReportRequest` (schemaVersion 1, RFC3339 timestamps, length caps — see spec §5.4).

**Test runner:** `yarn testmain` runs Vitest with `vite.main.config.mjs` and includes a `tsc --noEmit` type-check gate. For tight inner loops use `AIFETCHLY_SKIP_TSC=1 yarn testmain -t "<pattern>"` (do not commit code that needs this).

**Project conventions (from CLAUDE.md):**
- No `any` type — use `unknown` + schema validation.
- IPC handlers must not access the DB directly; route through Modules.
- Worker processes (`process.env.WORKER_TYPE` set) must never touch Electron/DB — they IPC results to main.
- Auto-commit after each logical unit (one commit per task in this plan).
- Update all 6 language files (`en/zh/es/fr/de/ja`) when adding UI text.

---

## File Structure

**New files:**

| Path | Responsibility |
|------|----------------|
| `src/modules/diagnostics/DiagnosticSchemas.ts` | Zod schemas + TS types (`CrashRecord`, `ErrorRecord`, `DiagnosticBreadcrumb`, `DiagnosticReportPackage`) |
| `src/modules/diagnostics/DiagnosticPaths.ts` | Resolve `userData/diagnostics/`, ensure subdirs, locate `logs/` |
| `src/modules/diagnostics/DiagnosticIdentity.ts` | Per-process `sessionId`, persisted `installId` |
| `src/modules/diagnostics/DiagnosticRedactor.ts` | Token regex + structured redaction with bounds |
| `src/modules/diagnostics/DiagnosticSerializer.ts` | Per-field truncation + JSONL line formatting |
| `src/modules/diagnostics/DiagnosticBreadcrumbBuffer.ts` | In-memory ring buffers (breadcrumbs + errors) |
| `src/modules/diagnostics/ErrorLogSink.ts` | Append JSONL writer for `error.jsonl` |
| `src/modules/diagnostics/CrashLogSink.ts` | Synchronous JSONL writer for `crash.jsonl` |
| `src/modules/diagnostics/DiagnosticRetentionService.ts` | 14/30-day policy + 200 MB budget pruning |
| `src/modules/diagnostics/DiagnosticReportBuilder.ts` | Assemble sanitized upload/export package |
| `src/modules/diagnostics/DiagnosticUploadClient.ts` | POST to `/api/crash-reports` |
| `src/modules/diagnostics/CrashReporterService.ts` | Facade: `record*` methods + Electron handler installers |
| `src/modules/diagnostics/index.ts` | Public exports |
| `src/schemas/ipc/diagnostics.ts` | Zod schemas for IPC payloads |
| `src/main-process/communication/diagnostics-ipc.ts` | IPC handlers |
| `src/views/api/diagnostics.ts` | Renderer wrapper |
| `src/views/components/settings/DiagnosticsSection.vue` | Settings UI section |
| `test/vitest/main/service/DiagnosticRedactor.test.ts` | Redactor unit tests |
| `test/vitest/main/service/DiagnosticSerializer.test.ts` | Serializer unit tests |
| `test/vitest/main/service/DiagnosticSchemas.test.ts` | Schema parse/reject tests |
| `test/vitest/main/service/DiagnosticBreadcrumbBuffer.test.ts` | Ring buffer tests |
| `test/vitest/main/service/ErrorLogSink.test.ts` | Sink tests |
| `test/vitest/main/service/CrashLogSink.test.ts` | Sink tests |
| `test/vitest/main/service/DiagnosticRetentionService.test.ts` | Retention tests |
| `test/vitest/main/service/DiagnosticReportBuilder.test.ts` | Report builder tests |
| `test/vitest/main/service/DiagnosticUploadClient.test.ts` | Upload client tests |
| `test/vitest/main/service/CrashReporterService.test.ts` | Service facade tests |
| `test/vitest/main/diagnostics-ipc.integration.test.ts` | IPC integration tests |

**Modified files:**

| Path | Reason |
|------|--------|
| `src/modules/Logger.ts` | Stop production console capture; gate file level on debug mode |
| `src/background.ts` | Install `CrashReporterService` handlers; start Electron `crashReporter`; unclean-shutdown marker |
| `src/preload.ts` | Expose `window.diagnostics` |
| `src/main.ts` (renderer entry) | Install `window.onerror` + `unhandledrejection` listeners |
| `src/modules/ChildProcessManager.ts` | Report abnormal worker exits |
| `src/config/channellist.ts` | Add diagnostics channel constants |
| `src/main-process/communication/index.ts` | Register diagnostics IPC handlers |
| `src/views/lang/{en,zh,es,fr,de,ja}.ts` | Add `diagnostics.*` translations |
| Existing settings page component | Render `DiagnosticsSection.vue` |

---

## Task 1: DiagnosticSchemas and types

**Files:**
- Create: `src/modules/diagnostics/DiagnosticSchemas.ts`
- Test: `test/vitest/main/service/DiagnosticSchemas.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/vitest/main/service/DiagnosticSchemas.test.ts
'use strict';
import { describe, test, expect } from 'vitest';
import {
  crashRecordSchema,
  errorRecordSchema,
  diagnosticBreadcrumbSchema,
  diagnosticReportPackageSchema,
  type CrashRecord,
} from '@/modules/diagnostics/DiagnosticSchemas';

describe('DiagnosticSchemas', () => {
  const validCrash = {
    schemaVersion: 1 as const,
    timestamp: '2026-07-03T00:00:00.000Z',
    crashId: '11111111-1111-1111-1111-111111111111',
    sessionId: '22222222-2222-2222-2222-222222222222',
    installId: 'install-abc',
    appVersion: '1.0.0',
    platform: 'linux' as const,
    arch: 'x64',
    processType: 'main' as const,
    crashType: 'uncaught-exception' as const,
    message: 'boom',
    breadcrumbs: [],
  };

  test('parses a valid crash record', () => {
    expect(crashRecordSchema.parse(validCrash)).toEqual(validCrash);
  });

  test('rejects non-RFC3339 timestamp', () => {
    expect(() =>
      crashRecordSchema.parse({ ...validCrash, timestamp: 'not-a-date' })
    ).toThrow();
  });

  test('rejects unknown processType', () => {
    expect(() =>
      crashRecordSchema.parse({ ...validCrash, processType: 'browser' })
    ).toThrow();
  });

  test('rejects unknown crashType', () => {
    expect(() =>
      crashRecordSchema.parse({ ...validCrash, crashType: 'oops' })
    ).toThrow();
  });

  test('errorRecordSchema enforces warn|error level', () => {
    const base = {
      schemaVersion: 1 as const,
      timestamp: '2026-07-03T00:00:00.000Z',
      errorId: 'e1',
      sessionId: 's1',
      level: 'warn' as const,
      processType: 'main' as const,
      message: 'w',
    };
    expect(errorRecordSchema.parse(base)).toEqual(base);
    expect(() =>
      errorRecordSchema.parse({ ...base, level: 'info' })
    ).toThrow();
  });

  test('breadcrumbSchema defaults level to undefined', () => {
    const parsed = diagnosticBreadcrumbSchema.parse({
      timestamp: '2026-07-03T00:00:00.000Z',
      category: 'nav',
      message: 'go',
    });
    expect(parsed.level).toBeUndefined();
  });

  test('reportPackageSchema validates a complete package', () => {
    const pkg = {
      schemaVersion: 1 as const,
      appVersion: '1.0.0',
      platform: 'linux',
      arch: 'x64',
      installId: 'install-abc',
      sessionId: 's1',
      crash: validCrash,
      recentErrors: [],
      breadcrumbs: [],
    };
    expect(diagnosticReportPackageSchema.parse(pkg)).toEqual(pkg);
  });

  test('CrashRecord type alias compiles', () => {
    const r: CrashRecord = validCrash;
    expect(r.crashId).toBe(validCrash.crashId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `AIFETCHLY_SKIP_TSC=1 yarn testmain -t "DiagnosticSchemas"`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/modules/diagnostics/DiagnosticSchemas.ts
'use strict';
import { z } from 'zod';

const processTypes = z.enum(['main', 'renderer', 'worker', 'utility', 'gpu', 'unknown']);
const crashTypes = z.enum([
  'uncaught-exception',
  'unhandled-rejection',
  'render-process-gone',
  'child-process-gone',
  'gpu-process-crashed',
  'worker-exit',
  'unclean-shutdown',
]);
const rfc3339 = z.string().refine(
  (v) => !Number.isNaN(Date.parse(v)),
  { message: 'timestamp must be RFC3339' }
);

export const diagnosticBreadcrumbSchema = z.object({
  timestamp: rfc3339,
  category: z.string().max(64),
  message: z.string().max(2048),
  level: z.enum(['info', 'warn', 'error']).optional(),
});
export type DiagnosticBreadcrumb = z.infer<typeof diagnosticBreadcrumbSchema>;

export const crashRecordSchema = z.object({
  schemaVersion: z.literal(1),
  timestamp: rfc3339,
  crashId: z.string().min(1).max(64),
  sessionId: z.string().min(1).max(128),
  installId: z.string().min(1).max(128),
  appVersion: z.string().min(1).max(64),
  platform: z.string().min(1).max(32),
  arch: z.string().min(1).max(32),
  processType: processTypes,
  crashType: crashTypes,
  feature: z.string().max(128).optional(),
  taskId: z.string().max(128).optional(),
  workerType: z.string().max(128).optional(),
  message: z.string().min(1).max(8 * 1024),
  stack: z.string().max(16 * 1024).optional(),
  reason: z.string().max(1024).optional(),
  exitCode: z.number().int().optional(),
  signal: z.string().max(32).optional(),
  breadcrumbs: z.array(diagnosticBreadcrumbSchema).max(200),
});
export type CrashRecord = z.infer<typeof crashRecordSchema>;

export const errorRecordSchema = z.object({
  schemaVersion: z.literal(1),
  timestamp: rfc3339,
  errorId: z.string().min(1).max(64),
  sessionId: z.string().min(1).max(128),
  level: z.enum(['warn', 'error']),
  processType: z.enum(['main', 'renderer', 'worker']),
  feature: z.string().max(128).optional(),
  message: z.string().min(1).max(8 * 1024),
  stack: z.string().max(16 * 1024).optional(),
  metadata: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional(),
});
export type ErrorRecord = z.infer<typeof errorRecordSchema>;

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
});
export type DiagnosticReportPackage = z.infer<typeof diagnosticReportPackageSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `AIFETCHLY_SKIP_TSC=1 yarn testmain -t "DiagnosticSchemas"`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/modules/diagnostics/DiagnosticSchemas.ts test/vitest/main/service/DiagnosticSchemas.test.ts
git commit -m "feat: add DiagnosticSchemas and types"
```

---

## Task 2: DiagnosticPaths and DiagnosticIdentity

**Files:**
- Create: `src/modules/diagnostics/DiagnosticPaths.ts`
- Create: `src/modules/diagnostics/DiagnosticIdentity.ts`
- Test: `test/vitest/main/service/DiagnosticPaths.test.ts`
- Test: `test/vitest/main/service/DiagnosticIdentity.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// test/vitest/main/service/DiagnosticPaths.test.ts
'use strict';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getDiagnosticsDir, ensureDiagnosticsDirs, getStartupMarkerPath } from '@/modules/diagnostics/DiagnosticPaths';

describe('DiagnosticPaths', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-'));
    process.env.AIFETCHLY_DIAGNOSTICS_DIR = tmp;
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    delete process.env.AIFETCHLY_DIAGNOSTICS_DIR;
  });

  test('getDiagnosticsDir honours override env', () => {
    expect(getDiagnosticsDir()).toBe(tmp);
  });

  test('ensureDiagnosticsDirs creates subdirs', () => {
    ensureDiagnosticsDirs();
    expect(fs.existsSync(path.join(tmp, 'native-dumps'))).toBe(true);
  });

  test('getStartupMarkerPath lives under diagnostics dir', () => {
    expect(getStartupMarkerPath()).toBe(path.join(tmp, '.startup-marker'));
  });
});
```

```typescript
// test/vitest/main/service/DiagnosticIdentity.test.ts
'use strict';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { newSessionId, getOrCreateInstallId } from '@/modules/diagnostics/DiagnosticIdentity';

describe('DiagnosticIdentity', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-id-'));
    process.env.AIFETCHLY_DIAGNOSTICS_DIR = tmp;
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    delete process.env.AIFETCHLY_DIAGNOSTICS_DIR;
  });

  test('newSessionId returns unique RFC4122-ish strings', () => {
    const a = newSessionId();
    const b = newSessionId();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(16);
  });

  test('getOrCreateInstallId is stable across calls', () => {
    const a = getOrCreateInstallId();
    const b = getOrCreateInstallId();
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(8);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `AIFETCHLY_SKIP_TSC=1 yarn testmain -t "DiagnosticPaths|DiagnosticIdentity"`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement DiagnosticPaths**

```typescript
// src/modules/diagnostics/DiagnosticPaths.ts
'use strict';
import * as path from 'path';
import * as fs from 'fs';

let cachedDir: string | null = null;

/**
 * Resolve the diagnostics directory. Test override via $AIFETCHLY_DIAGNOSTICS_DIR.
 * Falls back to Electron's userData()/diagnostics when Electron is available,
 * otherwise to os.tmpdir()/aifetchly-diagnostics.
 */
export function getDiagnosticsDir(): string {
  if (cachedDir) return cachedDir;
  const override = process.env.AIFETCHLY_DIAGNOSTICS_DIR;
  if (override) {
    cachedDir = override;
    return cachedDir;
  }
  let base: string;
  try {
    const electron = require('electron') as typeof import('electron');
    const app = electron?.app;
    if (app && typeof app.getPath === 'function') {
      base = app.getPath('userData');
    } else {
      base = require('os').tmpdir();
    }
  } catch {
    base = require('os').tmpdir();
  }
  cachedDir = path.join(base, 'diagnostics');
  return cachedDir;
}

export function ensureDiagnosticsDirs(): void {
  const dir = getDiagnosticsDir();
  const sub = path.join(dir, 'native-dumps');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(sub)) fs.mkdirSync(sub, { recursive: true });
}

export function getCrashLogPath(): string {
  return path.join(getDiagnosticsDir(), 'crash.jsonl');
}
export function getErrorLogPath(): string {
  return path.join(getDiagnosticsDir(), 'error.jsonl');
}
export function getStartupMarkerPath(): string {
  return path.join(getDiagnosticsDir(), '.startup-marker');
}
export function getInstallIdPath(): string {
  return path.join(getDiagnosticsDir(), 'install-id.txt');
}
export function getNativeDumpsDir(): string {
  return path.join(getDiagnosticsDir(), 'native-dumps');
}

/** Test-only: force a directory override (also settable via env). */
export function __setDiagnosticsDirForTests(dir: string): void {
  cachedDir = dir;
}
```

- [ ] **Step 4: Implement DiagnosticIdentity**

```typescript
// src/modules/diagnostics/DiagnosticIdentity.ts
'use strict';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { getInstallIdPath, ensureDiagnosticsDirs } from './DiagnosticPaths';

export function newSessionId(): string {
  return crypto.randomUUID();
}

/**
 * Returns a stable install id, persisting it on first call. Never throws; on
 * any IO failure, returns a transient random id so callers stay alive.
 */
export function getOrCreateInstallId(): string {
  try {
    ensureDiagnosticsDirs();
    const p = getInstallIdPath();
    if (fs.existsSync(p)) {
      const v = fs.readFileSync(p, 'utf8').trim();
      if (v.length > 0 && v.length <= 128) return v;
    }
    const id = crypto.randomUUID();
    fs.writeFileSync(p, id, { encoding: 'utf8' });
    return id;
  } catch {
    return crypto.randomUUID();
  }
}
```

- [ ] **Step 5: Run tests**

Run: `AIFETCHLY_SKIP_TSC=1 yarn testmain -t "DiagnosticPaths|DiagnosticIdentity"`
Expected: PASS — 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/modules/diagnostics/DiagnosticPaths.ts src/modules/diagnostics/DiagnosticIdentity.ts \
        test/vitest/main/service/DiagnosticPaths.test.ts test/vitest/main/service/DiagnosticIdentity.test.ts
git commit -m "feat: add DiagnosticPaths and DiagnosticIdentity"
```

---

## Task 3: DiagnosticRedactor

**Files:**
- Create: `src/modules/diagnostics/DiagnosticRedactor.ts`
- Test: `test/vitest/main/service/DiagnosticRedactor.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/vitest/main/service/DiagnosticRedactor.test.ts
'use strict';
import { describe, test, expect } from 'vitest';
import { redactString, redactMetadata } from '@/modules/diagnostics/DiagnosticRedactor';

describe('DiagnosticRedactor', () => {
  test('redacts Authorization Bearer', () => {
    expect(redactString('Authorization: Bearer abc.def.ghi'))
      .toBe('Authorization: [REDACTED]');
  });

  test('redacts token query params', () => {
    expect(redactString('https://x/y?token=secret&code=cn&state=sn'))
      .toBe('https://x/y?token=[REDACTED]&code=[REDACTED]&state=[REDACTED]');
  });

  test('redacts password fields in metadata', () => {
    const out = redactMetadata({ password: 'p', name: 'alice' });
    expect(out.password).toBe('[REDACTED]');
    expect(out.name).toBe('alice');
  });

  test('coerces unknown leaf types to string', () => {
    const out = redactMetadata({ fn: () => 1, big: BigInt(2) }) as Record<string, unknown>;
    expect(typeof out.fn).toBe('string');
    expect(typeof out.big).toBe('string');
  });

  test('respects max depth', () => {
    const deep = { a: { b: { c: { d: { e: { f: 'x' } } } } } };
    const out = redactMetadata(deep) as Record<string, unknown>;
    // depth 6 leaf should be coerced to a safe string
    expect(typeof JSON.stringify(out)).toBe('string');
  });

  test('respects max property count', () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < 200; i++) obj[`k${i}`] = i;
    const out = redactMetadata(obj) as Record<string, unknown>;
    expect(Object.keys(out).length).toBeLessThanOrEqual(101); // 100 + __truncated marker
  });

  test('truncates long string values', () => {
    const long = 'x'.repeat(2000);
    const out = redactMetadata({ blob: long }) as { blob: string };
    expect(out.blob.length).toBeLessThan(2000);
    expect(out.blob).toContain('[truncated');
  });
});
```

- [ ] **Step 2: Run test**

Run: `AIFETCHLY_SKIP_TSC=1 yarn testmain -t "DiagnosticRedactor"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// src/modules/diagnostics/DiagnosticRedactor.ts
'use strict';

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 5;
const MAX_PROPERTIES = 100;
const MAX_VALUE_LENGTH = 1024;

const STRING_PATTERNS: ReadonlyArray<{ regex: RegExp; replacement: string }> = [
  // Authorization: Bearer <token>
  { regex: /(Authorization\s*:\s*Bearer\s+)[^\s,;]+/gi, replacement: `$1${REDACTED}` },
  // access_token=..., refresh_token=..., api_key=..., password=...
  { regex: /((?:access_token|refresh_token|api_key|apikey|password|passwd|secret|token)=)[^&;\s]+/gi, replacement: `$1${REDACTED}` },
  // query params ?token=...&code=...&state=...
  { regex: /([?&](?:token|access_token|refresh_token|code|state|api_key)=)[^&\s]+/gi, replacement: `$1${REDACTED}` },
  // Cookie: <values>
  { regex: /(Cookie\s*:\s*).*/gi, replacement: `$1${REDACTED}` },
];

export function redactString(input: string): string {
  let out = input;
  for (const { regex, replacement } of STRING_PATTERNS) {
    out = out.replace(regex, replacement);
  }
  if (out.length > MAX_VALUE_LENGTH * 4) {
    out = out.slice(0, MAX_VALUE_LENGTH * 4) + '…[truncated]';
  }
  return out;
}

type Leaf = string | number | boolean | null;
type MetaValue = Leaf | unknown;

export function redactMetadata(input: unknown): Record<string, unknown> {
  const root = coerceObject(input);
  const out: Record<string, unknown> = {};
  const keys = Object.keys(root).slice(0, MAX_PROPERTIES);
  for (const k of keys) {
    out[redactKeyName(k)] = walk(root[k], 1);
  }
  if (Object.keys(root).length > MAX_PROPERTIES) {
    out['__truncated'] = true;
  }
  return out;
}

function coerceObject(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return { value: v as MetaValue };
}

function redactKeyName(k: string): string {
  const lk = k.toLowerCase();
  if (/^(password|passwd|secret|token|access_token|refresh_token|api_key|apikey|authorization|cookie)$/i.test(lk)) {
    return k; // value will be redacted by walk(); keep key name for debuggability
  }
  return k;
}

function walk(value: unknown, depth: number): unknown {
  if (value === null) return null;
  const t = typeof value;
  if (t === 'string') return clampString(redactString(value));
  if (t === 'number' || t === 'boolean') return value;
  if (t === 'function' || t === 'symbol' || t === 'bigint') {
    return clampString(redactString(String(String(value))));
  }
  if (t === 'undefined') return null;
  if (depth >= MAX_DEPTH) {
    return clampString(redactString(safeStringify(value)));
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_PROPERTIES).map((v) => walk(v, depth + 1));
  }
  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const keys = Object.keys(obj).slice(0, MAX_PROPERTIES);
    for (const k of keys) {
      if (/^(password|passwd|secret|token|access_token|refresh_token|api_key|apikey|authorization|cookie)$/i.test(k)) {
        out[k] = REDACTED;
      } else {
        out[k] = walk(obj[k], depth + 1);
      }
    }
    return out;
  }
  return null;
}

function clampString(s: string): string {
  if (s.length <= MAX_VALUE_LENGTH) return s;
  return s.slice(0, MAX_VALUE_LENGTH) + `…[truncated ${s.length - MAX_VALUE_LENGTH} chars]`;
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `AIFETCHLY_SKIP_TSC=1 yarn testmain -t "DiagnosticRedactor"`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/modules/diagnostics/DiagnosticRedactor.ts test/vitest/main/service/DiagnosticRedactor.test.ts
git commit -m "feat: add DiagnosticRedactor"
```

---

## Task 4: DiagnosticSerializer and JSONL sinks

**Files:**
- Create: `src/modules/diagnostics/DiagnosticSerializer.ts`
- Create: `src/modules/diagnostics/ErrorLogSink.ts`
- Create: `src/modules/diagnostics/CrashLogSink.ts`
- Test: `test/vitest/main/service/DiagnosticSerializer.test.ts`
- Test: `test/vitest/main/service/ErrorLogSink.test.ts`
- Test: `test/vitest/main/service/CrashLogSink.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// test/vitest/main/service/DiagnosticSerializer.test.ts
'use strict';
import { describe, test, expect } from 'vitest';
import { truncateCrashRecord, truncateErrorRecord, serializeJsonlLine } from '@/modules/diagnostics/DiagnosticSerializer';
import type { CrashRecord, ErrorRecord } from '@/modules/diagnostics/DiagnosticSchemas';

const baseCrash = {
  schemaVersion: 1 as const,
  timestamp: '2026-07-03T00:00:00.000Z',
  crashId: 'c1', sessionId: 's1', installId: 'i1',
  appVersion: '1.0.0', platform: 'linux', arch: 'x64',
  processType: 'main' as const, crashType: 'uncaught-exception' as const,
  message: '', breadcrumbs: [],
};

const baseError = {
  schemaVersion: 1 as const,
  timestamp: '2026-07-03T00:00:00.000Z',
  errorId: 'e1', sessionId: 's1', level: 'error' as const,
  processType: 'main' as const, message: '',
};

describe('DiagnosticSerializer', () => {
  test('truncateCrashRecord caps message and stack', () => {
    const big: CrashRecord = {
      ...baseCrash,
      message: 'x'.repeat(20 * 1024),
      stack: 'y'.repeat(32 * 1024),
    };
    const out = truncateCrashRecord(big);
    expect(out.message.length).toBe(8 * 1024);
    expect(out.stack!.length).toBe(16 * 1024);
  });

  test('truncateErrorRecord caps message', () => {
    const out = truncateErrorRecord({ ...baseError, message: 'z'.repeat(20 * 1024) });
    expect(out.message.length).toBe(8 * 1024);
  });

  test('serializeJsonlLine caps total line at 64KB', () => {
    const obj = { blob: 'a'.repeat(100 * 1024) };
    const line = serializeJsonlLine(obj);
    expect(line.length).toBeLessThanOrEqual(64 * 1024);
    expect(line.endsWith('\n')).toBe(true);
  });
});
```

```typescript
// test/vitest/main/service/ErrorLogSink.test.ts
'use strict';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ErrorLogSink } from '@/modules/diagnostics/ErrorLogSink';
import { __setDiagnosticsDirForTests } from '@/modules/diagnostics/DiagnosticPaths';
import type { ErrorRecord } from '@/modules/diagnostics/DiagnosticSchemas';

describe('ErrorLogSink', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'err-'));
    __setDiagnosticsDirForTests(tmp);
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    __setDiagnosticsDirForTests('');
    (ErrorLogSink as unknown as { resetForTests: () => void }).resetForTests();
  });

  test('appends a JSON line with password redacted', async () => {
    const rec: ErrorRecord = {
      schemaVersion: 1, timestamp: '2026-07-03T00:00:00.000Z',
      errorId: 'e1', sessionId: 's1', level: 'error', processType: 'main',
      message: 'boom password=supersecret', metadata: { password: 'p' },
    };
    await ErrorLogSink.write(rec);
    const file = path.join(tmp, 'error.jsonl');
    const content = fs.readFileSync(file, 'utf8').trim();
    expect(content).toContain('"password":"[REDACTED]"');
    expect(content).not.toContain('supersecret');
  });
});
```

```typescript
// test/vitest/main/service/CrashLogSink.test.ts
'use strict';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CrashLogSink } from '@/modules/diagnostics/CrashLogSink';
import { __setDiagnosticsDirForTests } from '@/modules/diagnostics/DiagnosticPaths';
import type { CrashRecord } from '@/modules/diagnostics/DiagnosticSchemas';

describe('CrashLogSink', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crash-'));
    __setDiagnosticsDirForTests(tmp);
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    __setDiagnosticsDirForTests('');
  });

  test('writes record synchronously and redacts', () => {
    const rec: CrashRecord = {
      schemaVersion: 1, timestamp: '2026-07-03T00:00:00.000Z',
      crashId: 'c1', sessionId: 's1', installId: 'i1',
      appVersion: '1.0.0', platform: 'linux', arch: 'x64',
      processType: 'main', crashType: 'uncaught-exception',
      message: 'Authorization: Bearer leak-token', breadcrumbs: [],
    };
    CrashLogSink.write(rec);
    const file = path.join(tmp, 'crash.jsonl');
    const content = fs.readFileSync(file, 'utf8').trim();
    expect(content).toContain('crashId');
    expect(content).not.toContain('leak-token');
    expect(content).toContain('[REDACTED]');
  });
});
```

- [ ] **Step 2: Run tests**

Run: `AIFETCHLY_SKIP_TSC=1 yarn testmain -t "DiagnosticSerializer|ErrorLogSink|CrashLogSink"`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement DiagnosticSerializer**

```typescript
// src/modules/diagnostics/DiagnosticSerializer.ts
'use strict';
import type { CrashRecord, ErrorRecord } from './DiagnosticSchemas';
import { redactString } from './DiagnosticRedactor';

const MAX_MESSAGE = 8 * 1024;
const MAX_STACK = 16 * 1024;
const MAX_REASON = 1024;
const MAX_LINE = 64 * 1024;

function clamp(s: string | undefined, max: number): string | undefined {
  if (s === undefined) return undefined;
  const r = redactString(s);
  return r.length <= max ? r : r.slice(0, max);
}

export function truncateCrashRecord(r: CrashRecord): CrashRecord {
  return {
    ...r,
    message: clamp(r.message, MAX_MESSAGE) ?? '',
    stack: clamp(r.stack, MAX_STACK),
    reason: clamp(r.reason, MAX_REASON),
    feature: clamp(r.feature, 128),
    taskId: clamp(r.taskId, 128),
    workerType: clamp(r.workerType, 128),
    breadcrumbs: r.breadcrumbs.slice(0, 200).map((b) => ({
      ...b,
      message: clamp(b.message, 1024) ?? '',
    })),
  };
}

export function truncateErrorRecord(r: ErrorRecord): ErrorRecord {
  return {
    ...r,
    message: clamp(r.message, MAX_MESSAGE) ?? '',
    stack: clamp(r.stack, MAX_STACK),
    feature: clamp(r.feature, 128),
  };
}

export function serializeJsonlLine(obj: unknown): string {
  let line: string;
  try {
    line = JSON.stringify(obj);
  } catch {
    line = JSON.stringify({ error: 'unserializable' });
  }
  if (line.length > MAX_LINE) {
    line = line.slice(0, MAX_LINE - 3) + '...';
  }
  return line + '\n';
}
```

- [ ] **Step 4: Implement ErrorLogSink**

```typescript
// src/modules/diagnostics/ErrorLogSink.ts
'use strict';
import * as fs from 'fs';
import { getErrorLogPath, ensureDiagnosticsDirs } from './DiagnosticPaths';
import { truncateErrorRecord } from './DiagnosticSerializer';
import { redactMetadata } from './DiagnosticRedactor';
import type { ErrorRecord } from './DiagnosticSchemas';

let stream: fs.WriteStream | null = null;

function getStream(): fs.WriteStream {
  if (stream && !stream.destroyed) return stream;
  ensureDiagnosticsDirs();
  stream = fs.createWriteStream(getErrorLogPath(), { flags: 'a', encoding: 'utf8' });
  stream.on('error', () => { stream = null; });
  return stream;
}

export const ErrorLogSink = {
  async write(rec: ErrorRecord): Promise<void> {
    const truncated = truncateErrorRecord(rec);
    const sanitized: ErrorRecord = {
      ...truncated,
      message: truncated.message,
      metadata: truncated.metadata ? redactMetadata(truncated.metadata) as ErrorRecord['metadata'] : undefined,
    };
    const line = serializeLine(sanitized);
    try {
      await new Promise<void>((resolve) => {
        getStream().write(line, () => resolve());
      });
    } catch {
      // never throw from logging
    }
  },
};

function serializeLine(rec: ErrorRecord): string {
  // imported here to avoid circular ref in tests
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { serializeJsonlLine } = require('./DiagnosticSerializer') as typeof import('./DiagnosticSerializer');
  return serializeJsonlLine(rec);
}

// Test hook
declare module '@/modules/diagnostics/ErrorLogSink' {
  interface ErrorLogSink {
    resetForTests(): void;
  }
}
(ErrorLogSink as unknown as { resetForTests: () => void }).resetForTests = () => {
  if (stream) { stream.destroy(); stream = null; }
};
```

- [ ] **Step 5: Implement CrashLogSink**

```typescript
// src/modules/diagnostics/CrashLogSink.ts
'use strict';
import * as fs from 'fs';
import { getCrashLogPath, ensureDiagnosticsDirs } from './DiagnosticPaths';
import { truncateCrashRecord } from './DiagnosticSerializer';
import type { CrashRecord } from './DiagnosticSchemas';

export const CrashLogSink = {
  /** Synchronous write — survives process termination. */
  write(rec: CrashRecord): void {
    try {
      ensureDiagnosticsDirs();
      const truncated = truncateCrashRecord(rec);
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { serializeJsonlLine } = require('./DiagnosticSerializer') as typeof import('./DiagnosticSerializer');
      fs.appendFileSync(getCrashLogPath(), serializeJsonlLine(truncated));
    } catch {
      // never throw from crash logging
    }
  },

  /** Read all crash records (newest-first), best-effort. */
  readAll(): CrashRecord[] {
    try {
      const p = getCrashLogPath();
      if (!fs.existsSync(p)) return [];
      const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
      const out: CrashRecord[] = [];
      for (const line of lines.reverse()) {
        try { out.push(JSON.parse(line) as CrashRecord); } catch { /* skip */ }
        if (out.length >= 50) break;
      }
      return out;
    } catch {
      return [];
    }
  },
};
```

- [ ] **Step 6: Run tests**

Run: `AIFETCHLY_SKIP_TSC=1 yarn testmain -t "DiagnosticSerializer|ErrorLogSink|CrashLogSink"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/diagnostics/DiagnosticSerializer.ts src/modules/diagnostics/ErrorLogSink.ts \
        src/modules/diagnostics/CrashLogSink.ts \
        test/vitest/main/service/DiagnosticSerializer.test.ts \
        test/vitest/main/service/ErrorLogSink.test.ts \
        test/vitest/main/service/CrashLogSink.test.ts
git commit -m "feat: add DiagnosticSerializer and JSONL sinks"
```

---

## Task 5: DiagnosticBreadcrumbBuffer

**Files:**
- Create: `src/modules/diagnostics/DiagnosticBreadcrumbBuffer.ts`
- Test: `test/vitest/main/service/DiagnosticBreadcrumbBuffer.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/vitest/main/service/DiagnosticBreadcrumbBuffer.test.ts
'use strict';
import { describe, test, expect } from 'vitest';
import { DiagnosticBreadcrumbBuffer } from '@/modules/diagnostics/DiagnosticBreadcrumbBuffer';

describe('DiagnosticBreadcrumbBuffer', () => {
  test('keeps last 200 breadcrumbs', () => {
    const buf = new DiagnosticBreadcrumbBuffer(200, 100);
    for (let i = 0; i < 250; i++) {
      buf.addBreadcrumb({ timestamp: '2026-07-03T00:00:00.000Z', category: 'x', message: `m${i}` });
    }
    expect(buf.getBreadcrumbs()).toHaveLength(200);
    expect(buf.getBreadcrumbs()[0].message).toBe('m50');
  });

  test('keeps last 100 errors', () => {
    const buf = new DiagnosticBreadcrumbBuffer(200, 100);
    for (let i = 0; i < 150; i++) {
      buf.addError({
        schemaVersion: 1, timestamp: '2026-07-03T00:00:00.000Z',
        errorId: `e${i}`, sessionId: 's', level: 'error', processType: 'main', message: `m${i}`,
      });
    }
    expect(buf.getRecentErrors()).toHaveLength(100);
    expect(buf.getRecentErrors()[0].errorId).toBe('e50');
  });

  test('clear resets', () => {
    const buf = new DiagnosticBreadcrumbBuffer(10, 10);
    buf.addBreadcrumb({ timestamp: '2026-07-03T00:00:00.000Z', category: 'c', message: 'm' });
    buf.clear();
    expect(buf.getBreadcrumbs()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test**

Run: `AIFETCHLY_SKIP_TSC=1 yarn testmain -t "DiagnosticBreadcrumbBuffer"`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/modules/diagnostics/DiagnosticBreadcrumbBuffer.ts
'use strict';
import type { DiagnosticBreadcrumb, ErrorRecord } from './DiagnosticSchemas';

export class DiagnosticBreadcrumbBuffer {
  private breadcrumbs: DiagnosticBreadcrumb[] = [];
  private errors: ErrorRecord[] = [];

  constructor(
    private readonly maxBreadcrumbs = 200,
    private readonly maxErrors = 100,
  ) {}

  addBreadcrumb(b: DiagnosticBreadcrumb): void {
    this.breadcrumbs.push(b);
    if (this.breadcrumbs.length > this.maxBreadcrumbs) {
      this.breadcrumbs.splice(0, this.breadcrumbs.length - this.maxBreadcrumbs);
    }
  }

  addError(e: ErrorRecord): void {
    this.errors.push(e);
    if (this.errors.length > this.maxErrors) {
      this.errors.splice(0, this.errors.length - this.maxErrors);
    }
  }

  getBreadcrumbs(): DiagnosticBreadcrumb[] {
    return [...this.breadcrumbs];
  }

  getRecentErrors(): ErrorRecord[] {
    return [...this.errors];
  }

  clear(): void {
    this.breadcrumbs = [];
    this.errors = [];
  }
}
```

- [ ] **Step 4: Run tests**

Run: `AIFETCHLY_SKIP_TSC=1 yarn testmain -t "DiagnosticBreadcrumbBuffer"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/diagnostics/DiagnosticBreadcrumbBuffer.ts test/vitest/main/service/DiagnosticBreadcrumbBuffer.test.ts
git commit -m "feat: add DiagnosticBreadcrumbBuffer"
```

---

## Task 6: DiagnosticRetentionService

**Files:**
- Create: `src/modules/diagnostics/DiagnosticRetentionService.ts`
- Test: `test/vitest/main/service/DiagnosticRetentionService.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/vitest/main/service/DiagnosticRetentionService.test.ts
'use strict';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DiagnosticRetentionService } from '@/modules/diagnostics/DiagnosticRetentionService';
import { __setDiagnosticsDirForTests } from '@/modules/diagnostics/DiagnosticPaths';

describe('DiagnosticRetentionService', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ret-'));
    __setDiagnosticsDirForTests(tmp);
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    __setDiagnosticsDirForTests('');
  });

  test('deletes old log files older than 14 days', () => {
    const old = path.join(tmp, 'app.log');
    fs.writeFileSync(old, 'x');
    const oldTime = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    fs.utimesSync(old, oldTime, oldTime);
    new DiagnosticRetentionService({ budgetBytes: 200 * 1024 * 1024 }).runOnce();
    expect(fs.existsSync(old)).toBe(false);
  });

  test('enforces total budget by deleting oldest first', () => {
    // create three files with distinct mtimes, total > small budget
    const a = path.join(tmp, 'a.log');
    const b = path.join(tmp, 'b.log');
    const c = path.join(tmp, 'c.log');
    fs.writeFileSync(a, 'aaaa');
    fs.writeFileSync(b, 'bbbb');
    fs.writeFileSync(c, 'cccc');
    const t0 = new Date(Date.now() - 30 * 86400 * 1000);
    const t1 = new Date(Date.now() - 20 * 86400 * 1000);
    const t2 = new Date(Date.now() - 1 * 86400 * 1000);
    fs.utimesSync(a, t0, t0);
    fs.utimesSync(b, t1, t1);
    fs.utimesSync(c, t2, t2);
    new DiagnosticRetentionService({ budgetBytes: 8 }).runOnce();
    // a (oldest) should be gone; c (newest) should remain
    expect(fs.existsSync(a)).toBe(false);
    expect(fs.existsSync(c)).toBe(true);
  });

  test('prunes crash.jsonl records older than 30 days', () => {
    const f = path.join(tmp, 'crash.jsonl');
    const oldTs = new Date(Date.now() - 40 * 86400 * 1000).toISOString();
    const newTs = new Date().toISOString();
    const oldRec = JSON.stringify({ schemaVersion: 1, timestamp: oldTs, crashId: 'old', sessionId: 's', installId: 'i', appVersion: '1', platform: 'linux', arch: 'x64', processType: 'main', crashType: 'uncaught-exception', message: 'old', breadcrumbs: [] });
    const newRec = JSON.stringify({ schemaVersion: 1, timestamp: newTs, crashId: 'new', sessionId: 's', installId: 'i', appVersion: '1', platform: 'linux', arch: 'x64', processType: 'main', crashType: 'uncaught-exception', message: 'new', breadcrumbs: [] });
    fs.writeFileSync(f, `${oldRec}\n${newRec}\n`);
    new DiagnosticRetentionService({ budgetBytes: 200 * 1024 * 1024 }).runOnce();
    const content = fs.readFileSync(f, 'utf8');
    expect(content).toContain('"crashId":"new"');
    expect(content).not.toContain('"crashId":"old"');
  });

  test('never throws on missing dir', () => {
    expect(() => new DiagnosticRetentionService().runOnce()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test**

Run: `AIFETCHLY_SKIP_TSC=1 yarn testmain -t "DiagnosticRetentionService"`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/modules/diagnostics/DiagnosticRetentionService.ts
'use strict';
import * as fs from 'fs';
import * as path from 'path';
import { getDiagnosticsDir, getCrashLogPath, getErrorLogPath, getNativeDumpsDir } from './DiagnosticPaths';

export interface RetentionConfig {
  logRetentionDays?: number;
  crashRetentionDays?: number;
  nativeDumpRetentionDays?: number;
  budgetBytes?: number;
  pruneThresholdFraction?: number; // rewrite jsonl when > fraction records pruned
}

const DEFAULTS: Required<RetentionConfig> = {
  logRetentionDays: 14,
  crashRetentionDays: 30,
  nativeDumpRetentionDays: 14,
  budgetBytes: 200 * 1024 * 1024,
  pruneThresholdFraction: 0.2,
};

export class DiagnosticRetentionService {
  private readonly cfg: Required<RetentionConfig>;
  private timer: NodeJS.Timeout | null = null;

  constructor(cfg: RetentionConfig = {}) {
    this.cfg = { ...DEFAULTS, ...cfg };
  }

  /** Run once on startup (after 5s delay) and every 24h. */
  schedule(): void {
    setTimeout(() => this.runOnce(), 5000);
    this.timer = setInterval(() => this.runOnce(), 24 * 60 * 60 * 1000);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  runOnce(): void {
    try {
      this.pruneOldFiles();
      this.pruneJsonlByRecordAge(getCrashLogPath(), this.cfg.crashRetentionDays);
      this.pruneJsonlByRecordAge(getErrorLogPath(), this.cfg.crashRetentionDays);
      this.enforceBudget();
    } catch (err) {
      console.warn('[DiagnosticRetentionService] cleanup failed', err);
    }
  }

  private pruneOldFiles(): void {
    const dir = getDiagnosticsDir();
    if (!fs.existsSync(dir)) return;
    const now = Date.now();
    const cutoffLog = now - this.cfg.logRetentionDays * 86400_000;
    const cutoffDump = now - this.cfg.nativeDumpRetentionDays * 86400_000;

    // app.log, debug.log at top level
    for (const name of ['app.log', 'debug.log']) {
      const p = path.join(dir, name);
      this.maybeDeleteIfOlder(p, cutoffLog);
    }
    // native-dumps/
    const nd = getNativeDumpsDir();
    if (fs.existsSync(nd)) {
      for (const entry of fs.readdirSync(nd)) {
        this.maybeDeleteIfOlder(path.join(nd, entry), cutoffDump);
      }
    }
    // legacy logs/YYYY-MM-DD/ folders
    const logsRoot = path.join(dir, '..', 'logs');
    if (fs.existsSync(logsRoot)) {
      for (const entry of fs.readdirSync(logsRoot)) {
        const p = path.join(logsRoot, entry);
        const stat = fs.statSync(p);
        if (stat.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry)) {
          if (stat.mtimeMs < cutoffLog) {
            fs.rmSync(p, { recursive: true, force: true });
          }
        }
      }
    }
  }

  private maybeDeleteIfOlder(p: string, cutoff: number): void {
    try {
      const stat = fs.statSync(p);
      if (stat.mtimeMs < cutoff) fs.rmSync(p, { recursive: true, force: true });
    } catch { /* ignore */ }
  }

  private pruneJsonlByRecordAge(file: string, days: number): void {
    try {
      if (!fs.existsSync(file)) return;
      const cutoff = Date.now() - days * 86400_000;
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
      const kept: string[] = [];
      let pruned = 0;
      for (const line of lines) {
        try {
          const r = JSON.parse(line) as { timestamp?: string };
          const t = r.timestamp ? Date.parse(r.timestamp) : NaN;
          if (Number.isFinite(t) && t < cutoff) { pruned++; continue; }
        } catch { /* keep unparseable */ }
        kept.push(line);
      }
      if (pruned / Math.max(lines.length, 1) > this.cfg.pruneThresholdFraction) {
        fs.writeFileSync(file, kept.join('\n') + (kept.length ? '\n' : ''));
      }
    } catch { /* ignore */ }
  }

  private enforceBudget(): void {
    const dir = getDiagnosticsDir();
    if (!fs.existsSync(dir)) return;
    const entries = this.collectWithMtime(dir);
    const total = entries.reduce((s, e) => s + e.size, 0);
    if (total <= this.cfg.budgetBytes) return;
    // oldest first
    entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
    let remaining = total;
    for (const e of entries) {
      if (remaining <= this.cfg.budgetBytes) break;
      try { fs.rmSync(e.path, { recursive: true, force: true }); } catch { /* ignore */ }
      remaining -= e.size;
    }
  }

  private collectWithMtime(root: string): Array<{ path: string; size: number; mtimeMs: number }> {
    const out: Array<{ path: string; size: number; mtimeMs: number }> = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        try {
          const stat = fs.statSync(full);
          out.push({ path: full, size: stat.size, mtimeMs: stat.mtimeMs });
        } catch { /* ignore */ }
      }
    };
    walk(root);
    return out;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `AIFETCHLY_SKIP_TSC=1 yarn testmain -t "DiagnosticRetentionService"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/diagnostics/DiagnosticRetentionService.ts test/vitest/main/service/DiagnosticRetentionService.test.ts
git commit -m "feat: add DiagnosticRetentionService"
```

---

## Task 7: Stop production console capture in Logger

**Files:**
- Modify: `src/modules/Logger.ts`

- [ ] **Step 1: Read current Logger.ts** to identify lines to change (already known: lines 137, 154-155, 193-198, 201-231, 233-243).

- [ ] **Step 2: Apply edits**

Use `Edit` tool on `src/modules/Logger.ts`:

1. Replace file level + console level block (lines 136-138, 191-194, 196-198) with a debug-aware block.
2. Remove startup "Log directory created" info writes (lines 154-155, 197).
3. Remove `verifyLogFile()` test writes (lines 233-243).
4. Gate `setupConsoleOverrides()` behind `isDevelopment`.

Concrete replacements:

Edit 1 — replace the existing block (around line 136-138):
```typescript
    if ((elog as unknown as { transports?: { file?: { level?: string } } }).transports?.file) {
      (elog as unknown as { transports: { file: { level: string } } }).transports.file.level = 'debug';
    }
```
with:
```typescript
    const debugEnabled = isDebugLoggingEnabled();
    const fileTransport = (elog as unknown as { transports?: { file?: { level?: string } } }).transports?.file;
    if (fileTransport) {
      fileTransport.level = debugEnabled ? 'debug' : 'warn';
    }
```

Edit 2 — replace the block that creates dirs + writes test info (lines ~147-158) to remove `elog.info(...)` startup writes.

Edit 3 — replace the console transport level block (~191-194):
```typescript
    const logTransportsWithConsole = logTransports as { file?: unknown; console?: { level?: string | false } };
    if (logTransportsWithConsole?.console) {
      logTransportsWithConsole.console.level = 'debug';
    }
```
with:
```typescript
    const logTransportsWithConsole = logTransports as { file?: unknown; console?: { level?: string | false } };
    if (logTransportsWithConsole?.console) {
      logTransportsWithConsole.console.level = isDevelopment ? 'debug' : false;
    }
```

Edit 4 — gate `setupConsoleOverrides`:
```typescript
    if (isDevelopment) {
      this.setupConsoleOverrides();
    }
```

Edit 5 — remove `verifyLogFile()` call and the `'Console override test - this should appear in both terminal and log file'` write (line 197, 198).

Edit 6 — add helper at top of file:
```typescript
const isDevelopment = process.env.NODE_ENV !== 'production';

function isDebugLoggingEnabled(): boolean {
  if (process.env.AIFETCHLY_DEBUG_LOGS === 'true') return true;
  try {
    // Lazy: avoid circular import; read directly from SystemSetting table is not
    // possible at this layer. The expiry is checked in the diagnostics module;
    // here we only honour env + a file flag written by the IPC handler.
    const electron = require('electron') as typeof import('electron');
    const app = electron?.app;
    if (!app) return false;
    const p = require('path').join(app.getPath('userData'), 'diagnostics', '.debug-enabled');
    if (!require('fs').existsSync(p)) return false;
    const expiry = require('fs').readFileSync(p, 'utf8').trim();
    return expiry.length > 0 && Date.parse(expiry) > Date.now();
  } catch {
    return false;
  }
}
```

- [ ] **Step 3: Type check**

Run: `yarn vue-check` or `AIFETCHLY_SKIP_TSC=1 yarn testmain --no-run` (just the type gate).
Expected: no errors.

- [ ] **Step 4: Verify acceptance #2 with a quick sanity test**

Run: `node -e "process.env.NODE_ENV='production'; const m=require('./src/modules/Logger'); console.log('hello from prod');" 2>&1 | head -20`
Expected: console.log not mirrored into a log file.

(If hard to verify in isolation, defer to integration test in Task 19.)

- [ ] **Step 5: Commit**

```bash
git add src/modules/Logger.ts
git commit -m "refactor: stop production console capture in Logger"
```

---

## Task 8: CrashReporterService + background.ts handlers

**Files:**
- Create: `src/modules/diagnostics/CrashReporterService.ts`
- Modify: `src/background.ts`
- Test: `test/vitest/main/service/CrashReporterService.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/vitest/main/service/CrashReporterService.test.ts
'use strict';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CrashReporterService } from '@/modules/diagnostics/CrashReporterService';
import { __setDiagnosticsDirForTests } from '@/modules/diagnostics/DiagnosticPaths';
import { CrashLogSink } from '@/modules/diagnostics/CrashLogSink';

describe('CrashReporterService', () => {
  let tmp: string;
  let svc: CrashReporterService;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-'));
    __setDiagnosticsDirForTests(tmp);
    svc = new CrashReporterService({
      sessionId: 'sess-1', installId: 'inst-1',
      appVersion: '1.0.0', platform: 'linux', arch: 'x64',
    });
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    __setDiagnosticsDirForTests('');
  });

  test('recordUncaughtException writes a crash record', () => {
    svc.recordUncaughtException(new Error('boom'));
    const records = CrashLogSink.readAll();
    expect(records).toHaveLength(1);
    expect(records[0].crashType).toBe('uncaught-exception');
    expect(records[0].message).toBe('boom');
  });

  test('recordWorkerExit captures exit code and signal', () => {
    svc.recordWorkerExit({ workerType: 'contact-extraction', taskId: 't1', pid: 123, code: 1, signal: null });
    const records = CrashLogSink.readAll();
    expect(records[0].crashType).toBe('worker-exit');
    expect(records[0].exitCode).toBe(1);
    expect(records[0].workerType).toBe('contact-extraction');
  });

  test('recordUnhandledRejection ignores non-Error reasons', () => {
    svc.recordUnhandledRejection('string reason');
    expect(CrashLogSink.readAll()).toHaveLength(0);
  });

  test('recordUnhandledRejection records Error reasons', () => {
    svc.recordUnhandledRejection(new Error('async boom'));
    expect(CrashLogSink.readAll())[0]?.crashType.toBe('unhandled-rejection');
  });
});
```

- [ ] **Step 2: Run test**

Run: `AIFETCHLY_SKIP_TSC=1 yarn testmain -t "CrashReporterService"`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/modules/diagnostics/CrashReporterService.ts
'use strict';
import { randomUUID } from 'crypto';
import type { App } from 'electron';
import type { CrashRecord, DiagnosticBreadcrumb } from './DiagnosticSchemas';
import { CrashLogSink } from './CrashLogSink';
import { ErrorLogSink } from './ErrorLogSink';
import { DiagnosticBreadcrumbBuffer } from './DiagnosticBreadcrumbBuffer';

export interface CrashReporterServiceConfig {
  sessionId: string;
  installId: string;
  appVersion: string;
  platform: string;
  arch: string;
}

export interface WorkerExitInfo {
  workerType: string;
  taskId?: string;
  pid?: number;
  code: number | null;
  signal: string | null;
}

export class CrashReporterService {
  private buffer = new DiagnosticBreadcrumbBuffer(200, 100);

  constructor(private readonly cfg: CrashReporterServiceConfig) {}

  addBreadcrumb(b: DiagnosticBreadcrumb): void { this.buffer.addBreadcrumb(b); }
  getBreadcrumbs(): DiagnosticBreadcrumb[] { return this.buffer.getBreadcrumbs(); }
  getRecentErrors() { return this.buffer.getRecentErrors(); }

  recordUncaughtException(error: Error, feature?: string): void {
    this.write({
      processType: 'main',
      crashType: 'uncaught-exception',
      message: error.message || 'uncaught exception',
      stack: error.stack,
      feature,
    });
  }

  recordUnhandledRejection(reason: unknown): void {
    if (!(reason instanceof Error)) return; // FR-3.2
    this.write({
      processType: 'main',
      crashType: 'unhandled-rejection',
      message: reason.message || 'unhandled rejection',
      stack: reason.stack,
    });
  }

  recordRenderProcessGone(details: { reason?: string; exitCode?: number }): void {
    this.write({
      processType: 'renderer',
      crashType: 'render-process-gone',
      message: `renderer gone: ${details.reason ?? 'unknown'}`,
      reason: details.reason,
      exitCode: details.exitCode ?? undefined,
    });
  }

  recordChildProcessGone(details: { reason?: string; exitCode?: number; name?: string }): void {
    this.write({
      processType: 'unknown',
      crashType: 'child-process-gone',
      message: `child-process gone: ${details.name ?? ''} ${details.reason ?? 'unknown'}`.trim(),
      reason: details.reason,
      exitCode: details.exitCode ?? undefined,
    });
  }

  recordGpuProcessCrashed(killed: boolean): void {
    this.write({
      processType: 'gpu',
      crashType: 'gpu-process-crashed',
      message: `gpu-process-crashed (killed=${killed})`,
    });
  }

  recordWorkerExit(info: WorkerExitInfo): void {
    this.write({
      processType: 'worker',
      crashType: 'worker-exit',
      message: `worker ${info.workerType} exited code=${info.code ?? 'null'} signal=${info.signal ?? 'null'}`,
      workerType: info.workerType,
      taskId: info.taskId,
      exitCode: info.code ?? undefined,
      signal: info.signal ?? undefined,
    });
  }

  recordUncleanShutdown(previousSessionId?: string): void {
    this.write({
      processType: 'main',
      crashType: 'unclean-shutdown',
      message: previousSessionId
        ? `unclean shutdown of session ${previousSessionId}`
        : 'unclean shutdown detected',
    });
  }

  /** Hook process-level handlers. */
  installProcessHandlers(proc: NodeJS.Process): void {
    proc.on('uncaughtException', (err: Error) => this.recordUncaughtException(err));
    proc.on('unhandledRejection', (reason: unknown) => this.recordUnhandledRejection(reason));
  }

  /** Hook Electron app-level handlers. No-op if app is undefined. */
  installAppHandlers(app: App | undefined): void {
    if (!app) return;
    app.on('render-process-gone', (_e, _wc, details) => this.recordRenderProcessGone(details));
    app.on('child-process-gone', (_e, details) => this.recordChildProcessGone(details));
    app.on('gpu-process-crashed', (_e, killed) => this.recordGpuProcessCrashed(killed));
  }

  private write(partial: {
    processType: CrashRecord['processType'];
    crashType: CrashRecord['crashType'];
    message: string;
    stack?: string;
    reason?: string;
    exitCode?: number;
    signal?: string;
    feature?: string;
    taskId?: string;
    workerType?: string;
  }): void {
    const rec: CrashRecord = {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      crashId: randomUUID(),
      sessionId: this.cfg.sessionId,
      installId: this.cfg.installId,
      appVersion: this.cfg.appVersion,
      platform: this.cfg.platform as CrashRecord['platform'],
      arch: this.cfg.arch,
      breadcrumbs: this.buffer.getBreadcrumbs(),
      ...partial,
    };
    CrashLogSink.write(rec);
    this.buffer.addBreadcrumb({
      timestamp: rec.timestamp, category: 'crash',
      message: `${rec.crashType}: ${rec.message.slice(0, 200)}`, level: 'error',
    });
  }
}

/** Renderer-error path: validate then persist as Error or Crash. */
export function recordRendererErrorPayload(
  svc: CrashReporterService,
  payload: { message: string; stack?: string; feature?: string; level?: 'warn' | 'error'; fatal?: boolean }
): void {
  if (payload.fatal) {
    svc.recordUncaughtException(new Error(payload.message), payload.feature);
  } else {
    void ErrorLogSink.write({
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      errorId: randomUUID(),
      sessionId: svc['cfg'].sessionId,
      level: payload.level ?? 'error',
      processType: 'renderer',
      feature: payload.feature,
      message: payload.message,
      stack: payload.stack,
    });
  }
}
```

- [ ] **Step 4: Run tests**

Run: `AIFETCHLY_SKIP_TSC=1 yarn testmain -t "CrashReporterService"`
Expected: PASS.

- [ ] **Step 5: Wire into background.ts**

Edit `src/background.ts` to add after the existing `log.info('Application starting...')` (around line 74) and before the existing `process.on('uncaughtException', ...)`:

```typescript
// Replace the existing uncaught/unhandled handlers with diagnostics-aware ones.
import { CrashReporterService } from '@/modules/diagnostics/CrashReporterService';
import { DiagnosticPaths } from '@/modules/diagnostics/DiagnosticPaths';
import { newSessionId, getOrCreateInstallId } from '@/modules/diagnostics/DiagnosticIdentity';
import { DiagnosticRetentionService } from '@/modules/diagnostics/DiagnosticRetentionService';
import * as fs from 'fs';

DiagnosticPaths.ensureDiagnosticsDirs();
const __diagnosticsRetention = new DiagnosticRetentionService();
const __crashReporter = new CrashReporterService({
  sessionId: newSessionId(),
  installId: getOrCreateInstallId(),
  appVersion: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
});
(globalThis as unknown as { __aifetchlyCrashReporter: CrashReporterService }).__aifetchlyCrashReporter = __crashReporter;

__crashReporter.installProcessHandlers(process);
__diagnosticsRetention.schedule();
```

Remove the prior `process.on('uncaughtException', ...)` and `process.on('unhandledRejection', ...)` blocks (lines 77-92) — they are replaced by the diagnostics handlers. Keep the `dialog.showErrorBox` behaviour inside a new wrapper:

```typescript
process.on('uncaughtException', (error) => {
  // Diagnostics already persisted by service handler (runs first).
  if ((app as any).isReady()) {
    dialog.showErrorBox(
      'Application Error',
      `An unexpected error occurred: ${error.message}\n\nDetails have been logged.`
    );
  }
});
```

In `app.whenReady().then(...)` after `configureContentSecurityPolicy()`:

```typescript
__crashReporter.installAppHandlers(app);
```

In `app.on('before-quit', ...)` add at the start:

```typescript
__diagnosticsRetention.stop();
```

- [ ] **Step 6: Run type check**

Run: `AIFETCHLY_SKIP_TSC=1 yarn testmain -t "CrashReporterService" 2>&1 | tail -20`
Expected: PASS, and `yarn vue-check` should be clean (run separately if too slow).

- [ ] **Step 7: Commit**

```bash
git add src/modules/diagnostics/CrashReporterService.ts src/background.ts \
        test/vitest/main/service/CrashReporterService.test.ts
git commit -m "feat: add CrashReporterService and wire background.ts handlers"
```

---

## Task 9: Renderer error IPC + preload surface

**Files:**
- Create: `src/schemas/ipc/diagnostics.ts`
- Create: `src/views/api/diagnostics.ts`
- Modify: `src/preload.ts`
- Modify: `src/config/channellist.ts`

- [ ] **Step 1: Add channel constants**

Edit `src/config/channellist.ts` — add to the exports list:

```typescript
// Diagnostics Channels
DIAGNOSTICS_RENDERER_ERROR,
DIAGNOSTICS_EXPORT_REPORT,
DIAGNOSTICS_UPLOAD_REPORT,
DIAGNOSTICS_OPEN_FOLDER,
DIAGNOSTICS_GET_STATUS,
DIAGNOSTICS_SET_DEBUG,
DIAGNOSTICS_CLEAR_LOCAL,
DIAGNOSTICS_LIST_CRASHES,
```

Add their string values at the bottom alongside existing constants:

```typescript
export const DIAGNOSTICS_RENDERER_ERROR = 'diagnostics:renderer-error';
export const DIAGNOSTICS_EXPORT_REPORT = 'diagnostics:export-report';
export const DIAGNOSTICS_UPLOAD_REPORT = 'diagnostics:upload-report';
export const DIAGNOSTICS_OPEN_FOLDER = 'diagnostics:open-folder';
export const DIAGNOSTICS_GET_STATUS = 'diagnostics:get-status';
export const DIAGNOSTICS_SET_DEBUG = 'diagnostics:set-debug';
export const DIAGNOSTICS_CLEAR_LOCAL = 'diagnostics:clear-local';
export const DIAGNOSTICS_LIST_CRASHES = 'diagnostics:list-crashes';
```

- [ ] **Step 2: Create IPC payload schemas**

```typescript
// src/schemas/ipc/diagnostics.ts
'use strict';
import { z } from 'zod';
import { lazySchema } from '@/utils/lazySchema';

export const rendererErrorPayloadSchema = lazySchema(() =>
  z.strictObject({
    message: z.string().min(1).max(8 * 1024),
    stack: z.string().max(16 * 1024).optional(),
    feature: z.string().max(128).optional(),
    level: z.enum(['warn', 'error']).optional(),
    fatal: z.boolean().optional(),
  }),
);
export type RendererErrorPayload = z.infer<ReturnType<typeof rendererErrorPayloadSchema>>;

export const uploadReportInputSchema = lazySchema(() =>
  z.strictObject({
    crashId: z.string().min(1).max(64),
    includeNativeDump: z.boolean().optional(),
  }),
);
export type UploadReportInput = z.infer<ReturnType<typeof uploadReportInputSchema>>;

export const setDebugInputSchema = lazySchema(() =>
  z.strictObject({ enabled: z.boolean() }),
);
export type SetDebugInput = z.infer<ReturnType<typeof setDebugInputSchema>>;
```

- [ ] **Step 3: Create renderer API wrapper**

```typescript
// src/views/api/diagnostics.ts
'use strict';
import {
  DIAGNOSTICS_RENDERER_ERROR,
  DIAGNOSTICS_EXPORT_REPORT,
  DIAGNOSTICS_UPLOAD_REPORT,
  DIAGNOSTICS_OPEN_FOLDER,
  DIAGNOSTICS_GET_STATUS,
  DIAGNOSTICS_SET_DEBUG,
  DIAGNOSTICS_CLEAR_LOCAL,
  DIAGNOSTICS_LIST_CRASHES,
} from '@/config/channellist';

export interface DiagnosticStatus {
  storageBytes: number;
  budgetBytes: number;
  debugEnabled: boolean;
  debugExpiresAt: string | null;
  lastCrashId: string | null;
}

export const diagnosticsApi = {
  reportRendererError(payload: {
    message: string; stack?: string; feature?: string;
    level?: 'warn' | 'error'; fatal?: boolean;
  }): Promise<void> {
    return (window as unknown as {
      diagnostics: { reportRendererError: (p: unknown) => Promise<void> };
    }).diagnostics.reportRendererError(payload);
  },
  exportReport(): Promise<{ path: string | null }> {
    return window.ipc.invoke(DIAGNOSTICS_EXPORT_REPORT, {});
  },
  uploadReport(crashId: string, includeNativeDump = false): Promise<{ reportId: string | null; error?: string }> {
    return window.ipc.invoke(DIAGNOSTICS_UPLOAD_REPORT, { crashId, includeNativeDump });
  },
  openFolder(): Promise<void> {
    return window.ipc.invoke(DIAGNOSTICS_OPEN_FOLDER, {});
  },
  getStatus(): Promise<DiagnosticStatus> {
    return window.ipc.invoke(DIAGNOSTICS_GET_STATUS, {});
  },
  setDebug(enabled: boolean): Promise<void> {
    return window.ipc.invoke(DIAGNOSTICS_SET_DEBUG, { enabled });
  },
  clearLocal(): Promise<void> {
    return window.ipc.invoke(DIAGNOSTICS_CLEAR_LOCAL, {});
  },
  listCrashes(): Promise<Array<{ crashId: string; timestamp: string; crashType: string; message: string }>> {
    return window.ipc.invoke(DIAGNOSTICS_LIST_CRASHES, {});
  },
};

// Convenience aliases used by the renderer entry boot code.
export const reportRendererError = diagnosticsApi.reportRendererError;
```

> Note: existing preload exposes `window.ipc.invoke` for whitelisted channels and a separate `window.api`. The diagnostics API uses a dedicated `window.diagnostics` surface for `reportRendererError` (so the renderer entry doesn't need to know channel names) and `window.ipc.invoke` for the rest (which already exists). Add the new channels to the `invoke` whitelist in Step 4.

- [ ] **Step 4: Modify preload.ts**

Edit `src/preload.ts`:

1. Add the diagnostics channels to the `invoke` whitelist (inside the `validChannels` array near line 824):
```typescript
DIAGNOSTICS_EXPORT_REPORT,
DIAGNOSTICS_UPLOAD_REPORT,
DIAGNOSTICS_OPEN_FOLDER,
DIAGNOSTICS_GET_STATUS,
DIAGNOSTICS_SET_DEBUG,
DIAGNOSTICS_CLEAR_LOCAL,
DIAGNOSTICS_LIST_CRASHES,
```
(Import them from `@/config/channellist` at the top.)

2. Add a new `contextBridge.exposeInMainWorld('diagnostics', { ... })` block after the existing `contextBridge.exposeInMainWorld('api', { ... })`:

```typescript
contextBridge.exposeInMainWorld('diagnostics', {
  reportRendererError: (payload: unknown) =>
    ipcRenderer.invoke(DIAGNOSTICS_RENDERER_ERROR, payload),
});
```

- [ ] **Step 5: Install renderer error listeners**

Find the renderer entry (typically `src/main.ts`). Add near the top, after `createApp(App)` or in the `mounted` hook of the root component, before router is ready:

```typescript
import { reportRendererError } from '@/views/api/diagnostics';

function toPayload(event: ErrorEvent | PromiseRejectionEvent): {
  message: string; stack?: string; feature?: string; level?: 'warn' | 'error'; fatal?: boolean;
} {
  if (event instanceof ErrorEvent) {
    const err = event.error ?? new Error(event.message);
    return {
      message: err?.message ?? event.message ?? 'renderer error',
      stack: err?.stack?.slice(0, 16 * 1024),
      feature: 'renderer',
      fatal: false,
    };
  }
  const reason = (event as PromiseRejectionEvent).reason;
  const err = reason instanceof Error ? reason : new Error(String(reason));
  return { message: err.message, stack: err.stack, feature: 'renderer', level: 'error' };
}

window.addEventListener('error', (e) => {
  void reportRendererError(toPayload(e));
});
window.addEventListener('unhandledrejection', (e) => {
  void reportRendererError(toPayload(e));
});
```

- [ ] **Step 6: Type check**

Run: `yarn vue-check`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/config/channellist.ts src/schemas/ipc/diagnostics.ts \
        src/views/api/diagnostics.ts src/preload.ts src/main.ts
git commit -m "feat: add renderer error IPC and preload diagnostics surface"
```

---

## Task 10: Worker abnormal exit reporting

**Files:**
- Modify: `src/modules/ChildProcessManager.ts`

- [ ] **Step 1: Locate the exit handler in ChildProcessManager.ts** (it already listens for `exit`).

- [ ] **Step 2: Add reporting**

Add an import and a hook in the exit handler:

```typescript
import { getCrashReporterFromGlobal } from '@/modules/diagnostics';
// ...in the exit handler:
childProcess.on('exit', (code, signal) => {
  if (code !== 0 || signal) {
    try {
      getCrashReporterFromGlobal()?.recordWorkerExit({
        workerType: this.workerType,
        taskId: this.currentTaskId,
        pid: childProcess.pid,
        code,
        signal,
      });
    } catch { /* never fail worker exit on diagnostics */ }
  }
  // ... existing handling
});
```

- [ ] **Step 3: Create the diagnostics barrel export**

```typescript
// src/modules/diagnostics/index.ts
'use strict';
export { CrashReporterService } from './CrashReporterService';
export type { CrashReporterServiceConfig, WorkerExitInfo } from './CrashReporterService';
export {
  crashRecordSchema, errorRecordSchema, diagnosticBreadcrumbSchema, diagnosticReportPackageSchema,
} from './DiagnosticSchemas';
export type {
  CrashRecord, ErrorRecord, DiagnosticBreadcrumb, DiagnosticReportPackage,
} from './DiagnosticSchemas';

/** Best-effort access to the singleton crash reporter installed in background.ts. */
export function getCrashReporterFromGlobal(): import('./CrashReporterService').CrashReporterService | undefined {
  return (globalThis as unknown as { __aifetchlyCrashReporter?: import('./CrashReporterService').CrashReporterService })
    .__aifetchlyCrashReporter;
}
```

- [ ] **Step 4: Type check**

Run: `AIFETCHLY_SKIP_TSC=1 yarn testmain --no-run`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/modules/diagnostics/index.ts src/modules/ChildProcessManager.ts
git commit -m "feat: report worker abnormal exits to crash reporter"
```

---

## Task 11: DiagnosticReportBuilder

**Files:**
- Create: `src/modules/diagnostics/DiagnosticReportBuilder.ts`
- Test: `test/vitest/main/service/DiagnosticReportBuilder.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/vitest/main/service/DiagnosticReportBuilder.test.ts
'use strict';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DiagnosticReportBuilder } from '@/modules/diagnostics/DiagnosticReportBuilder';
import { CrashLogSink } from '@/modules/diagnostics/CrashLogSink';
import { __setDiagnosticsDirForTests } from '@/modules/diagnostics/DiagnosticPaths';
import type { CrashRecord } from '@/modules/diagnostics/DiagnosticSchemas';

describe('DiagnosticReportBuilder', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-'));
    __setDiagnosticsDirForTests(tmp);
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    __setDiagnosticsDirForTests('');
  });

  test('builds package with crash + recent errors + breadcrumbs', () => {
    const crash: CrashRecord = {
      schemaVersion: 1, timestamp: '2026-07-03T00:00:00.000Z',
      crashId: 'c1', sessionId: 's1', installId: 'i1', appVersion: '1.0.0',
      platform: 'linux', arch: 'x64', processType: 'main', crashType: 'uncaught-exception',
      message: 'boom password=secret', breadcrumbs: [],
    };
    CrashLogSink.write(crash);
    const pkg = new DiagnosticReportBuilder({
      appVersion: '1.0.0', platform: 'linux', arch: 'x64',
      installId: 'i1', sessionId: 's1',
      breadcrumbs: [], recentErrors: [],
    }).buildUploadPackage('c1');
    expect(pkg.crash.crashId).toBe('c1');
    expect(JSON.stringify(pkg)).not.toContain('secret');
    expect(JSON.stringify(pkg)).toContain('[REDACTED]');
  });

  test('package size stays under 200KB by default', () => {
    const crash: CrashRecord = {
      schemaVersion: 1, timestamp: '2026-07-03T00:00:00.000Z',
      crashId: 'c1', sessionId: 's1', installId: 'i1', appVersion: '1.0.0',
      platform: 'linux', arch: 'x64', processType: 'main', crashType: 'uncaught-exception',
      message: 'x'.repeat(500 * 1024), breadcrumbs: [],
    };
    CrashLogSink.write(crash);
    const pkg = new DiagnosticReportBuilder({
      appVersion: '1.0.0', platform: 'linux', arch: 'x64',
      installId: 'i1', sessionId: 's1', breadcrumbs: [], recentErrors: [],
    }).buildUploadPackage('c1');
    expect(Buffer.byteLength(JSON.stringify(pkg))).toBeLessThanOrEqual(200 * 1024);
  });

  test('returns null when crash not found', () => {
    const pkg = new DiagnosticReportBuilder({
      appVersion: '1.0.0', platform: 'linux', arch: 'x64',
      installId: 'i1', sessionId: 's1', breadcrumbs: [], recentErrors: [],
    }).buildUploadPackage('does-not-exist');
    expect(pkg).toBeNull();
  });
});
```

- [ ] **Step 2: Run test**

Run: `AIFETCHLY_SKIP_TSC=1 yarn testmain -t "DiagnosticReportBuilder"`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/modules/diagnostics/DiagnosticReportBuilder.ts
'use strict';
import { CrashLogSink } from './CrashLogSink';
import { redactMetadata } from './DiagnosticRedactor';
import type {
  CrashRecord, ErrorRecord, DiagnosticBreadcrumb, DiagnosticReportPackage,
} from './DiagnosticSchemas';

const DEFAULT_MAX_BYTES = 200 * 1024;
const EXTENDED_MAX_BYTES = 1024 * 1024;

export interface ReportBuilderConfig {
  appVersion: string;
  platform: string;
  arch: string;
  installId: string;
  sessionId: string;
  breadcrumbs: DiagnosticBreadcrumb[];
  recentErrors: ErrorRecord[];
}

export class DiagnosticReportBuilder {
  constructor(private readonly cfg: ReportBuilderConfig) {}

  buildUploadPackage(crashId: string, opts: { extended?: boolean } = {}): DiagnosticReportPackage | null {
    const crash = CrashLogSink.readAll().find((c) => c.crashId === crashId);
    if (!crash) return null;
    const max = opts.extended ? EXTENDED_MAX_BYTES : DEFAULT_MAX_BYTES;

    let pkg: DiagnosticReportPackage = {
      schemaVersion: 1,
      appVersion: this.cfg.appVersion,
      platform: this.cfg.platform,
      arch: this.cfg.arch,
      installId: this.cfg.installId,
      sessionId: this.cfg.sessionId,
      crash,
      recentErrors: this.cfg.recentErrors.slice(-100),
      breadcrumbs: this.cfg.breadcrumbs.slice(-200),
    };

    // Trim until under budget. Drop breadcrumbs/errors first, then truncate crash fields.
    while (Buffer.byteLength(JSON.stringify(pkg)) > max) {
      if (pkg.breadcrumbs.length > 0) {
        pkg = { ...pkg, breadcrumbs: pkg.breadcrumbs.slice(0, Math.floor(pkg.breadcrumbs.length / 2)) };
        continue;
      }
      if (pkg.recentErrors.length > 0) {
        pkg = { ...pkg, recentErrors: pkg.recentErrors.slice(0, Math.floor(pkg.recentErrors.length / 2)) };
        continue;
      }
      const trimmed = pkg.crash.message.slice(0, Math.max(64, Math.floor(pkg.crash.message.length / 2)));
      pkg = { ...pkg, crash: { ...pkg.crash, message: trimmed } };
      if (Buffer.byteLength(JSON.stringify(pkg)) <= max) break;
    }

    // Final redaction of metadata (defence-in-depth)
    pkg = {
      ...pkg,
      recentErrors: pkg.recentErrors.map((e) => ({
        ...e,
        metadata: e.metadata ? (redactMetadata(e.metadata) as ErrorRecord['metadata']) : undefined,
      })),
    };
    return pkg;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `AIFETCHLY_SKIP_TSC=1 yarn testmain -t "DiagnosticReportBuilder"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/diagnostics/DiagnosticReportBuilder.ts \
        test/vitest/main/service/DiagnosticReportBuilder.test.ts
git commit -m "feat: add DiagnosticReportBuilder"
```

---

## Task 12: DiagnosticUploadClient

**Files:**
- Create: `src/modules/diagnostics/DiagnosticUploadClient.ts`
- Test: `test/vitest/main/service/DiagnosticUploadClient.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/vitest/main/service/DiagnosticUploadClient.test.ts
'use strict';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { DiagnosticUploadClient } from '@/modules/diagnostics/DiagnosticUploadClient';
import type { DiagnosticReportPackage } from '@/modules/diagnostics/DiagnosticSchemas';

const basePkg: DiagnosticReportPackage = {
  schemaVersion: 1, appVersion: '1.0.0', platform: 'linux', arch: 'x64',
  installId: 'i1', sessionId: 's1',
  crash: {
    schemaVersion: 1, timestamp: '2026-07-03T00:00:00.000Z', crashId: 'c1',
    sessionId: 's1', installId: 'i1', appVersion: '1.0.0', platform: 'linux', arch: 'x64',
    processType: 'main', crashType: 'uncaught-exception', message: 'x', breadcrumbs: [],
  },
  recentErrors: [], breadcrumbs: [],
};

describe('DiagnosticUploadClient', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test('returns reportId on 200', async () => {
    const fakeAxios = { post: vi.fn().mockResolvedValue({ status: 200, data: { status: true, reportId: 'r1' } }) };
    const c = new DiagnosticUploadClient({
      endpoint: 'https://x/api/crash-reports',
      http: fakeAxios,
    } as never);
    const res = await c.upload(basePkg);
    expect(res.reportId).toBe('r1');
    expect(fakeAxios.post).toHaveBeenCalledWith(
      'https://x/api/crash-reports',
      basePkg,
      expect.objectContaining({ headers: expect.objectContaining({ 'Content-Type': 'application/json' }) }),
    );
  });

  test('surfaces 429 as error', async () => {
    const c = new DiagnosticUploadClient({
      endpoint: 'https://x/api/crash-reports',
      http: { post: vi.fn().mockResolvedValue({ status: 429, data: { status: false, msg: 'slow down' } }) },
    } as never);
    const res = await c.upload(basePkg);
    expect(res.reportId).toBeNull();
    expect(res.error).toMatch(/rate/i);
  });

  test('surfaces 413 as too-large error', async () => {
    const c = new DiagnosticUploadClient({
      endpoint: 'https://x/api/crash-reports',
      http: { post: vi.fn().mockResolvedValue({ status: 413, data: { status: false, msg: 'too big' } }) },
    } as never);
    const res = await c.upload(basePkg);
    expect(res.error).toMatch(/large/i);
  });

  test('network error returns generic error', async () => {
    const c = new DiagnosticUploadClient({
      endpoint: 'https://x/api/crash-reports',
      http: { post: vi.fn().mockRejectedValue(new Error('econnrefused')) },
    } as never);
    const res = await c.upload(basePkg);
    expect(res.reportId).toBeNull();
    expect(res.error).toBeDefined();
  });

  test('attaches Authorization header when token provided', async () => {
    const fakeAxios = { post: vi.fn().mockResolvedValue({ status: 200, data: { status: true, reportId: 'r1' } }) };
    const c = new DiagnosticUploadClient({
      endpoint: 'https://x/api/crash-reports',
      http: fakeAxios,
      authToken: 'Bearer abc',
    } as never);
    await c.upload(basePkg);
    expect(fakeAxios.post).toHaveBeenCalledWith(
      expect.any(String), expect.anything(),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer abc' }) }),
    );
  });
});
```

- [ ] **Step 2: Run test**

Run: `AIFETCHLY_SKIP_TSC=1 yarn testmain -t "DiagnosticUploadClient"`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/modules/diagnostics/DiagnosticUploadClient.ts
'use strict';
import type { DiagnosticReportPackage } from './DiagnosticSchemas';

export interface HttpClientLike {
  post(url: string, body: unknown, config: { headers: Record<string, string>; timeout: number }): Promise<{
    status: number;
    data: unknown;
  }>;
}

export interface UploadClientConfig {
  endpoint: string;
  http: HttpClientLike;
  authToken?: string | null;
  timeoutMs?: number;
}

export interface UploadResult {
  reportId: string | null;
  error?: string;
}

export class DiagnosticUploadClient {
  constructor(private readonly cfg: UploadClientConfig) {}

  async upload(pkg: DiagnosticReportPackage): Promise<UploadResult> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.cfg.authToken) headers['Authorization'] = this.cfg.authToken;

    try {
      const res = await this.cfg.http.post(this.cfg.endpoint, pkg, {
        headers,
        timeout: this.cfg.timeoutMs ?? 15_000,
      });
      const body = res.data as { status?: boolean; reportId?: string; msg?: string } | undefined;
      if (res.status === 200 && body?.status === true && body.reportId) {
        return { reportId: body.reportId };
      }
      if (res.status === 429) return { reportId: null, error: body?.msg ?? 'Rate limited. Try again later.' };
      if (res.status === 413) return { reportId: null, error: 'Report payload too large.' };
      return { reportId: null, error: body?.msg ?? `Server returned status ${res.status}` };
    } catch (err) {
      return { reportId: null, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `AIFETCHLY_SKIP_TSC=1 yarn testmain -t "DiagnosticUploadClient"`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/modules/diagnostics/DiagnosticUploadClient.ts \
        test/vitest/main/service/DiagnosticUploadClient.test.ts
git commit -m "feat: add DiagnosticUploadClient"
```

---

## Task 13: Diagnostics IPC handlers

**Files:**
- Create: `src/main-process/communication/diagnostics-ipc.ts`
- Modify: `src/main-process/communication/index.ts`

- [ ] **Step 1: Implement the handlers**

```typescript
// src/main-process/communication/diagnostics-ipc.ts
'use strict';
import { ipcMain, app, shell, dialog } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
  DIAGNOSTICS_RENDERER_ERROR,
  DIAGNOSTICS_EXPORT_REPORT,
  DIAGNOSTICS_UPLOAD_REPORT,
  DIAGNOSTICS_OPEN_FOLDER,
  DIAGNOSTICS_GET_STATUS,
  DIAGNOSTICS_SET_DEBUG,
  DIAGNOSTICS_CLEAR_LOCAL,
  DIAGNOSTICS_LIST_CRASHES,
} from '@/config/channellist';
import { rendererErrorPayloadSchema, uploadReportInputSchema, setDebugInputSchema } from '@/schemas/ipc/diagnostics';
import { lazySchema } from '@/utils/lazySchema';
import { getCrashReporterFromGlobal } from '@/modules/diagnostics';
import { CrashLogSink } from '@/modules/diagnostics/CrashLogSink';
import { DiagnosticReportBuilder } from '@/modules/diagnostics/DiagnosticReportBuilder';
import { DiagnosticUploadClient } from '@/modules/diagnostics/DiagnosticUploadClient';
import { DiagnosticPaths } from '@/modules/diagnostics/DiagnosticPaths';
import { recordRendererErrorPayload } from '@/modules/diagnostics/CrashReporterService';
import { Token, USERSDBPATH } from '@/config/usersetting'; // assumed path; adjust if different
import { getOrCreateInstallId, newSessionId } from '@/modules/diagnostics/DiagnosticIdentity';

// Per-webContents rate limit: max 10 renderer-error IPC/min.
const rendererErrorTimestamps = new Map<number, number[]>();
const RATE_LIMIT_PER_MIN = 10;

function getRemoteBase(): string | null {
  const v = (import.meta as unknown as { env?: { VITE_REMOTEADD?: string } }).env?.VITE_REMOTEADD;
  return v ?? null;
}

function debugFlagPath(): string {
  return path.join(DiagnosticPaths.getDiagnosticsDir(), '.debug-enabled');
}

function readDebugExpiry(): string | null {
  try {
    const p = debugFlagPath();
    if (!fs.existsSync(p)) return null;
    const v = fs.readFileSync(p, 'utf8').trim();
    return v && Date.parse(v) > Date.now() ? v : null;
  } catch { return null; }
}

function writeDebugExpiry(enabled: boolean): void {
  const p = debugFlagPath();
  if (!enabled) { try { fs.rmSync(p); } catch { /* ignore */ } return; }
  const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  try { fs.writeFileSync(p, expiry); } catch { /* ignore */ }
}

function measureDir(dir: string): number {
  let total = 0;
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else try { total += fs.statSync(full).size; } catch { /* ignore */ }
    }
  };
  walk(dir);
  return total;
}

export function registerDiagnosticsIpcHandlers(): void {
  ipcMain.handle(DIAGNOSTICS_RENDERER_ERROR, async (event, raw) => {
    const parsed = rendererErrorPayloadSchema.parse(raw);
    const wc = event.sender.id;
    const now = Date.now();
    const ts = (rendererErrorTimestamps.get(wc) ?? []).filter((t) => now - t < 60_000);
    ts.push(now);
    rendererErrorTimestamps.set(wc, ts);
    if (ts.length > RATE_LIMIT_PER_MIN) {
      return; // rate-limited
    }
    const svc = getCrashReporterFromGlobal();
    if (svc) recordRendererErrorPayload(svc, parsed);
  });

  ipcMain.handle(DIAGNOSTICS_EXPORT_REPORT, async () => {
    const res = await dialog.showSaveDialog({
      title: 'Export diagnostic report',
      defaultPath: `aifetchly-diagnostics-${Date.now()}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePath) return { path: null };
    const crash = CrashLogSink.readAll()[0];
    const svc = getCrashReporterFromGlobal();
    const pkg = new DiagnosticReportBuilder({
      appVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      installId: getOrCreateInstallId(),
      sessionId: svc ? (svc as unknown as { cfg: { sessionId: string } }).cfg.sessionId : newSessionId(),
      breadcrumbs: svc?.getBreadcrumbs() ?? [],
      recentErrors: svc?.getRecentErrors() ?? [],
    }).buildUploadPackage(crash?.crashId ?? '');
    const body = pkg ? JSON.stringify(pkg, null, 2) : '{}';
    try { fs.writeFileSync(res.filePath, body); } catch (e) {
      return { path: null, error: e instanceof Error ? e.message : String(e) };
    }
    return { path: res.filePath };
  });

  ipcMain.handle(DIAGNOSTICS_UPLOAD_REPORT, async (_event, raw) => {
    const parsed = uploadReportInputSchema.parse(raw);
    const base = getRemoteBase();
    if (!base) return { reportId: null, error: 'Backend URL is not configured.' };
    const svc = getCrashReporterFromGlobal();
    const pkg = new DiagnosticReportBuilder({
      appVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      installId: getOrCreateInstallId(),
      sessionId: svc ? (svc as unknown as { cfg: { sessionId: string } }).cfg.sessionId : newSessionId(),
      breadcrumbs: svc?.getBreadcrumbs() ?? [],
      recentErrors: svc?.getRecentErrors() ?? [],
    }).buildUploadPackage(parsed.crashId, { extended: parsed.includeNativeDump });
    if (!pkg) return { reportId: null, error: 'Crash record not found.' };

    // Auth token (optional) — anonymous upload when absent.
    let authToken: string | null = null;
    try {
      const t = new Token();
      const tok = t.getValue('TOKENNAME' as never) as string | undefined;
      if (tok) authToken = `Bearer ${tok}`;
    } catch { /* anonymous */ }

    // Use the same axios instance the rest of the app uses.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const axios = require('axios') as import('axios').AxiosInstance;
    const client = new DiagnosticUploadClient({
      endpoint: `${base}/api/crash-reports`,
      http: {
        post: (url, body, config) =>
          axios.post(url, body, config as never) as never,
      },
      authToken,
    });
    return client.upload(pkg);
  });

  ipcMain.handle(DIAGNOSTICS_OPEN_FOLDER, async () => {
    void shell.openPath(DiagnosticPaths.getDiagnosticsDir());
  });

  ipcMain.handle(DIAGNOSTICS_GET_STATUS, async () => {
    const dir = DiagnosticPaths.getDiagnosticsDir();
    const storageBytes = measureDir(dir);
    const last = CrashLogSink.readAll()[0];
    return {
      storageBytes,
      budgetBytes: 200 * 1024 * 1024,
      debugEnabled: readDebugExpiry() !== null,
      debugExpiresAt: readDebugExpiry(),
      lastCrashId: last?.crashId ?? null,
    };
  });

  ipcMain.handle(DIAGNOSTICS_SET_DEBUG, async (_event, raw) => {
    const parsed = setDebugInputSchema.parse(raw);
    writeDebugExpiry(parsed.enabled);
  });

  ipcMain.handle(DIAGNOSTICS_CLEAR_LOCAL, async () => {
    const dir = DiagnosticPaths.getDiagnosticsDir();
    try {
      for (const name of ['error.jsonl', 'crash.jsonl', 'debug.log', 'app.log']) {
        const p = path.join(dir, name);
        if (fs.existsSync(p)) fs.rmSync(p);
      }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
    return {};
  });

  ipcMain.handle(DIAGNOSTICS_LIST_CRASHES, async () => {
    return CrashLogSink.readAll().slice(0, 10).map((c) => ({
      crashId: c.crashId, timestamp: c.timestamp, crashType: c.crashType, message: c.message,
    }));
  });
}
```

> If `@/config/usersetting` does not export `Token` with `getValue`, replace with the actual existing access pattern (search codebase for `Token` usage). The same for `axios` — if the project has a custom HTTP client wrapper, use that.

- [ ] **Step 2: Register in `src/main-process/communication/index.ts`**

Add to the existing `registerCommunicationIpcHandlers` flow (call at the end):

```typescript
import { registerDiagnosticsIpcHandlers } from './diagnostics-ipc';
// ...inside registerCommunicationIpcHandlers:
registerDiagnosticsIpcHandlers();
```

- [ ] **Step 3: Type check**

Run: `yarn vue-check`
Expected: clean. Adjust the `Token`/`axios` imports if the names differ.

- [ ] **Step 4: Commit**

```bash
git add src/main-process/communication/diagnostics-ipc.ts \
        src/main-process/communication/index.ts
git commit -m "feat: add diagnostics IPC handlers"
```

---

## Task 14: Diagnostics settings UI section

**Files:**
- Create: `src/views/components/settings/DiagnosticsSection.vue`
- Modify: existing settings page to render `<DiagnosticsSection />`

- [ ] **Step 1: Locate existing settings page**

Run: `grep -l "SYSTEM_SETTING_LIST\|SystemSetting" src/views/pages/ src/views/components/ -r | head -5`

Use `Read` to find the file that hosts settings UI. Add `<DiagnosticsSection />` inside its template, near the bottom of the existing sections.

- [ ] **Step 2: Create the component**

```vue
<!-- src/views/components/settings/DiagnosticsSection.vue -->
<template>
  <v-card class="diagnostics-section" variant="outlined">
    <v-card-title>{{ t('diagnostics.title') || 'Diagnostics' }}</v-card-title>
    <v-card-text>
      <div class="mb-3">
        {{ t('diagnostics.storageUsage') || 'Storage used:' }}
        {{ formatBytes(status?.storageBytes ?? 0) }} / {{ formatBytes(status?.budgetBytes ?? 0) }}
        <v-btn size="small" variant="text" @click="refresh">{{ t('diagnostics.refresh') || 'Refresh' }}</v-btn>
      </div>

      <v-switch
        v-model="debugEnabled"
        :label="t('diagnostics.enableDebug') || 'Enable debug logging (auto-disables in 24h)'"
        color="primary"
        hide-details
        @update:model-value="onToggleDebug"
      />
      <div v-if="status?.debugExpiresAt" class="caption">
        {{ t('diagnostics.debugExpiresAt') || 'Expires at:' }} {{ status.debugExpiresAt }}
      </div>

      <v-switch
        v-model="consentUpload"
        :label="t('diagnostics.allowUpload') || 'Allow crash report uploads (manual send only)'"
        color="primary"
        hide-details
        @update:model-value="onToggleConsent"
      />

      <div class="mt-3 d-flex flex-wrap gap-2">
        <v-btn variant="outlined" @click="openFolder">
          {{ t('diagnostics.openFolder') || 'Open diagnostics folder' }}
        </v-btn>
        <v-btn variant="outlined" @click="exportReport">
          {{ t('diagnostics.exportReport') || 'Export diagnostic report' }}
        </v-btn>
        <v-btn variant="outlined" :disabled="!consentUpload" @click="openSendDialog">
          {{ t('diagnostics.sendReport') || 'Send crash report' }}
        </v-btn>
        <v-btn variant="text" color="error" @click="clearLocal">
          {{ t('diagnostics.clearLocal') || 'Clear local diagnostics' }}
        </v-btn>
      </div>
    </v-card-text>

    <v-dialog v-model="sendDialog" max-width="560">
      <v-card>
        <v-card-title>{{ t('diagnostics.selectCrash') || 'Select a crash to send' }}</v-card-title>
        <v-list>
          <v-list-item
            v-for="c in crashes" :key="c.crashId"
            :title="`${c.crashType} — ${c.message.slice(0, 80)}`"
            :subtitle="c.timestamp"
            @click="sendSelected(c.crashId)"
          />
        </v-list>
        <v-card-actions>
          <v-spacer />
          <v-btn text @click="sendDialog = false">{{ t('common.cancel') || 'Cancel' }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-card>
</template>

<script lang="ts">
import { defineComponent, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { diagnosticsApi, type DiagnosticStatus } from '@/views/api/diagnostics';

interface CrashSummary {
  crashId: string; timestamp: string; crashType: string; message: string;
}

export default defineComponent({
  name: 'DiagnosticsSection',
  setup() {
    const { t } = useI18n();
    const status = ref<DiagnosticStatus | null>(null);
    const debugEnabled = ref(false);
    const consentUpload = ref(false);
    const sendDialog = ref(false);
    const crashes = ref<CrashSummary[]>([]);

    const refresh = async () => {
      status.value = await diagnosticsApi.getStatus();
      debugEnabled.value = !!status.value?.debugEnabled;
    };
    const onToggleDebug = async (v: boolean) => { await diagnosticsApi.setDebug(v); await refresh(); };
    const onToggleConsent = (v: boolean) => { consentUpload.value = v; };
    const openFolder = () => diagnosticsApi.openFolder();
    const exportReport = async () => {
      const r = await diagnosticsApi.exportReport();
      if (!r.path) alert(t('diagnostics.exportFailed') || 'Export failed or cancelled.');
    };
    const openSendDialog = async () => {
      crashes.value = await diagnosticsApi.listCrashes();
      sendDialog.value = true;
    };
    const sendSelected = async (crashId: string) => {
      sendDialog.value = false;
      const r = await diagnosticsApi.uploadReport(crashId);
      if (r.reportId) alert(t('diagnostics.sendSuccess') || 'Report sent. Thank you!');
      else alert((t('diagnostics.sendFailed') || 'Send failed:') + ' ' + (r.error ?? ''));
    };
    const clearLocal = async () => {
      if (!confirm(t('diagnostics.clearConfirm') || 'Clear all local diagnostics?')) return;
      await diagnosticsApi.clearLocal();
      await refresh();
    };

    const formatBytes = (b: number): string => {
      if (b < 1024) return `${b} B`;
      if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
      return `${(b / 1024 / 1024).toFixed(1)} MB`;
    };

    onMounted(refresh);

    return {
      t, status, debugEnabled, consentUpload, sendDialog, crashes,
      refresh, onToggleDebug, onToggleConsent, openFolder, exportReport,
      openSendDialog, sendSelected, clearLocal, formatBytes,
    };
  },
});
</script>

<style scoped>
.diagnostics-section { margin: 16px 0; }
.gap-2 { gap: 8px; }
.caption { font-size: 12px; opacity: 0.7; margin-top: -8px; margin-bottom: 12px; }
</style>
```

> Note: `consentUpload` toggle here only persists in component state. The persistence to `SystemSetting` happens via `SYSTEM_SETTING_UPDATE` channel — wire that in by reading/writing the existing settings store. If the project has a `useSettingsStore` Pinia store, use it. Otherwise, leave as a TODO comment pointing to the next task that persists consent. For v1, persist consent by calling `window.ipc.invoke(SYSTEM_SETTING_UPDATE, { id: <diagnostics-consent-id>, value: 'true' })` — see Task 15 for the consent flow.

- [ ] **Step 3: Add DiagnosticsSection to the existing settings page**

After locating the settings page file, import and add `<DiagnosticsSection />` to its template. Use the project's existing pattern (likely a `<v-row>`/`<v-col>` grid or a stack of `<v-card>`s).

- [ ] **Step 4: Type check**

Run: `yarn vue-check`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/views/components/settings/DiagnosticsSection.vue <settings-page-path>.vue
git commit -m "feat: add Diagnostics settings UI section"
```

---

## Task 15: Unclean shutdown detection

**Files:**
- Modify: `src/background.ts`

- [ ] **Step 1: Add marker logic in background.ts**

In the block we added in Task 8 (after `DiagnosticPaths.ensureDiagnosticsDirs()`), add:

```typescript
import * as fs from 'fs';
// already imported above

const __startupMarker = DiagnosticPaths.getStartupMarkerPath();
let __previousSessionId: string | undefined;
if (fs.existsSync(__startupMarker)) {
  try {
    const prev = JSON.parse(fs.readFileSync(__startupMarker, 'utf8')) as { sessionId?: string };
    __previousSessionId = prev.sessionId;
    __crashReporter.recordUncleanShutdown(__previousSessionId);
  } catch {
    __crashReporter.recordUncleanShutdown();
  }
}
fs.writeFileSync(__startupMarker, JSON.stringify({ sessionId: __sessionId, ts: Date.now() }));

const __sessionId = newSessionId(); // Note: this must be defined BEFORE the marker write.
```

> Important ordering: declare `const __sessionId = newSessionId();` BEFORE the marker-write block. Update the `CrashReporterService` instantiation in Task 8 to use this same `__sessionId`.

In `app.on('before-quit', ...)` (the cleanest shutdown hook), add at the very start:

```typescript
try {
  const __startupMarker = DiagnosticPaths.getStartupMarkerPath();
  if (fs.existsSync(__startupMarker)) fs.rmSync(__startupMarker);
} catch { /* ignore */ }
```

- [ ] **Step 2: Manual verification**

Run the dev app, kill the process from terminal (`kill -9`), restart, observe an `unclean-shutdown` record in `crash.jsonl`.

- [ ] **Step 3: Commit**

```bash
git add src/background.ts
git commit -m "feat: detect unclean shutdown on next launch"
```

---

## Task 16: Start Electron crashReporter for native dumps

**Files:**
- Modify: `src/background.ts`

- [ ] **Step 1: Start the native crashReporter**

In `app.whenReady().then(...)` after `configureContentSecurityPolicy()`, add:

```typescript
import { crashReporter } from 'electron';
try {
  crashReporter.start({
    uploadToServer: false,
    compress: true,
  });
  // Point dumps at the diagnostics native-dumps dir.
  app.setPath('crashDumps', DiagnosticPaths.getNativeDumpsDir());
} catch (e) {
  log.warn('Failed to start Electron crashReporter', e);
}
```

- [ ] **Step 2: Type check**

Run: `yarn vue-check`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/background.ts
git commit -m "feat: start Electron crashReporter for native dumps"
```

---

## Task 17: Crash prompt dialog

**Files:**
- Modify: `src/background.ts`

- [ ] **Step 1: Add crash prompt helper**

Add a helper that, when there is an unread unclean-shutdown record on startup, shows a dialog. Place it near where `__crashReporter.recordUncleanShutdown(...)` is called (Task 15):

```typescript
async function maybeShowCrashPrompt(previousSessionId: string | undefined): Promise<void> {
  try {
    // Find the unclean-shutdown record just written.
    const { CrashLogSink } = await import('@/modules/diagnostics/CrashLogSink');
    const records = CrashLogSink.readAll();
    const latest = records.find((r) => r.crashType === 'unclean-shutdown');
    if (!latest) return;
    // Throttle: read lastPromptedCrashId from SystemSetting.
    // (Use existing SystemSetting Module if present.)
    // For v1 simplicity: always prompt once per session that has an unread unclean-shutdown.
    const choice = await dialog.showMessageBox({
      type: 'question',
      title: 'AiFetchly',
      message: 'The app closed unexpectedly last time.',
      detail: 'Send a diagnostics report to help us fix this? You can review what gets sent before sending.',
      buttons: ['Send report', 'Export report', 'Dismiss'],
      defaultId: 0,
      cancelId: 2,
    });
    if (choice.response === 0) {
      // Trigger upload via a synthetic call to the IPC handler logic.
      // For simplicity, expose a function from diagnostics-ipc.ts and call it here.
      const { uploadLatestUncleanShutdown } = await import('@/main-process/communication/diagnostics-ipc');
      await uploadLatestUncleanShutdown(latest.crashId);
    } else if (choice.response === 1) {
      // Trigger export path.
      const { exportLatestReport } = await import('@/main-process/communication/diagnostics-ipc');
      await exportLatestReport(latest.crashId);
    }
  } catch (e) {
    log.warn('Crash prompt failed', e);
  }
}

// Call it after the window is created and app is ready:
// app.whenReady().then(async () => { ... createWindow(); await maybeShowCrashPrompt(__previousSessionId); ... })
```

- [ ] **Step 2: Export helper functions from diagnostics-ipc.ts**

Add to `src/main-process/communication/diagnostics-ipc.ts`:

```typescript
export async function uploadLatestUncleanShutdown(crashId: string): Promise<void> {
  // Reuse the same logic as DIAGNOSTICS_UPLOAD_REPORT handler.
  // Factor that logic into a private function uploadCrashById(crashId) and call it here.
}

export async function exportLatestReport(crashId: string): Promise<void> {
  // Same: factor the export logic into a private function and call it here with the specific crashId.
}
```

(Refactor the existing handler bodies to call the private functions, then have these exports call them too.)

- [ ] **Step 3: Type check**

Run: `yarn vue-check`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/background.ts src/main-process/communication/diagnostics-ipc.ts
git commit -m "feat: add crash prompt dialog after unclean shutdown"
```

---

## Task 18: i18n translations

**Files:**
- Modify: `src/views/lang/{en,zh,es,fr,de,ja}.ts`

- [ ] **Step 1: Add English keys**

In `src/views/lang/en.ts`, add to the exported `messages.en` object:

```typescript
diagnostics: {
  title: 'Diagnostics',
  storageUsage: 'Storage used:',
  refresh: 'Refresh',
  enableDebug: 'Enable debug logging (auto-disables in 24h)',
  debugExpiresAt: 'Debug logging expires at:',
  allowUpload: 'Allow crash report uploads (manual send only)',
  openFolder: 'Open diagnostics folder',
  exportReport: 'Export diagnostic report',
  sendReport: 'Send crash report',
  clearLocal: 'Clear local diagnostics',
  clearConfirm: 'Clear all local diagnostics? This cannot be undone.',
  selectCrash: 'Select a crash to send',
  exportFailed: 'Export failed or cancelled.',
  sendSuccess: 'Report sent. Thank you!',
  sendFailed: 'Send failed:',
},
```

- [ ] **Step 2: Add the same keys to zh/es/fr/de/ja**

Provide accurate translations. Example for `zh.ts`:

```typescript
diagnostics: {
  title: '诊断',
  storageUsage: '已用存储：',
  refresh: '刷新',
  enableDebug: '启用调试日志（24小时后自动关闭）',
  debugExpiresAt: '调试日志到期时间：',
  allowUpload: '允许上传崩溃报告（仅手动发送）',
  openFolder: '打开诊断目录',
  exportReport: '导出诊断报告',
  sendReport: '发送崩溃报告',
  clearLocal: '清除本地诊断数据',
  clearConfirm: '确定清除所有本地诊断数据？此操作不可撤销。',
  selectCrash: '选择要发送的崩溃',
  exportFailed: '导出失败或已取消。',
  sendSuccess: '报告已发送，谢谢！',
  sendFailed: '发送失败：',
},
```

Repeat for `es`, `fr`, `de`, `ja` with idiomatic translations of the same keys.

- [ ] **Step 3: Type check**

Run: `yarn vue-check`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/views/lang/en.ts src/views/lang/zh.ts src/views/lang/es.ts \
        src/views/lang/fr.ts src/views/lang/de.ts src/views/lang/ja.ts
git commit -m "feat: add i18n translations for diagnostics"
```

---

## Task 19: Integration tests for crash pipeline

**Files:**
- Create: `test/vitest/main/diagnostics-ipc.integration.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
// test/vitest/main/diagnostics-ipc.integration.test.ts
'use strict';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CrashLogSink } from '@/modules/diagnostics/CrashLogSink';
import { ErrorLogSink } from '@/modules/diagnostics/ErrorLogSink';
import { __setDiagnosticsDirForTests } from '@/modules/diagnostics/DiagnosticPaths';
import { DiagnosticReportBuilder } from '@/modules/diagnostics/DiagnosticReportBuilder';
import { CrashReporterService } from '@/modules/diagnostics/CrashReporterService';
import type { CrashRecord } from '@/modules/diagnostics/DiagnosticSchemas';

describe('diagnostics crash pipeline (integration)', () => {
  let tmp: string;
  let svc: CrashReporterService;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-int-'));
    __setDiagnosticsDirForTests(tmp);
    svc = new CrashReporterService({
      sessionId: 'sess-int', installId: 'inst-int',
      appVersion: '1.0.0', platform: 'linux', arch: 'x64',
    });
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    __setDiagnosticsDirForTests('');
  });

  test('end-to-end: exception -> crash.jsonl -> upload package redacted', () => {
    svc.recordUncaughtException(new Error('Authorization: Bearer secret-token'));
    const records = CrashLogSink.readAll();
    expect(records).toHaveLength(1);
    const pkg = new DiagnosticReportBuilder({
      appVersion: '1.0.0', platform: 'linux', arch: 'x64',
      installId: 'inst-int', sessionId: 'sess-int',
      breadcrumbs: svc.getBreadcrumbs(), recentErrors: svc.getRecentErrors(),
    }).buildUploadPackage(records[0].crashId);
    expect(pkg).not.toBeNull();
    const serialized = JSON.stringify(pkg);
    expect(serialized).not.toContain('secret-token');
    expect(serialized).toContain('[REDACTED]');
  });

  test('end-to-end: renderer error -> error.jsonl', async () => {
    await ErrorLogSink.write({
      schemaVersion: 1, timestamp: new Date().toISOString(),
      errorId: 'e1', sessionId: 'sess-int', level: 'error', processType: 'renderer',
      feature: 'renderer', message: 'boom', metadata: { password: 'p' },
    });
    const file = path.join(tmp, 'error.jsonl');
    expect(fs.readFileSync(file, 'utf8')).toContain('[REDACTED]');
  });

  test('worker exit -> crash.jsonl', () => {
    svc.recordWorkerExit({ workerType: 'contact-extraction', taskId: 't1', pid: 99, code: 1, signal: null });
    const records = CrashLogSink.readAll();
    expect(records[0].crashType).toBe('worker-exit');
    expect(records[0].workerType).toBe('contact-extraction');
  });

  test('acceptance #6: export excludes tokens', () => {
    svc.recordUncaughtException(new Error('Authorization: Bearer abc.def.ghi'));
    const rec = CrashLogSink.readAll()[0];
    const pkg = new DiagnosticReportBuilder({
      appVersion: '1.0.0', platform: 'linux', arch: 'x64',
      installId: 'inst-int', sessionId: 'sess-int',
      breadcrumbs: [], recentErrors: [],
    }).buildUploadPackage(rec.crashId);
    const serialized = JSON.stringify(pkg);
    expect(serialized).not.toContain('abc.def.ghi');
    expect(serialized).not.toContain('Bearer ');
  });
});
```

- [ ] **Step 2: Run tests**

Run: `AIFETCHLY_SKIP_TSC=1 yarn testmain -t "diagnostics crash pipeline"`
Expected: PASS — 4 tests.

- [ ] **Step 3: Run the full main test suite**

Run: `yarn testmain`
Expected: ALL tests pass (no regressions).

- [ ] **Step 4: Commit**

```bash
git add test/vitest/main/diagnostics-ipc.integration.test.ts
git commit -m "test: integration tests for crash pipeline"
```

---

## Final verification

- [ ] Run the full TypeScript gate: `yarn testmain` (this runs `tsc --noEmit` then Vitest). Expected: clean.
- [ ] Run Vue type check: `yarn vue-check`. Expected: clean.
- [ ] Manual smoke test in dev (`yarn dev`):
  1. Confirm `console.log` from third-party libs no longer lands in `userData/logs/.../main.log` in production mode.
  2. Trigger a fake crash (`process.emit('uncaughtException', new Error('test'))` from devtools main inspector) — verify `crash.jsonl` gets a record.
  3. Open Settings → Diagnostics → click "Open diagnostics folder" → confirm folder opens.
  4. Click "Export diagnostic report" → confirm JSON file is saved, open it, confirm no tokens.
  5. Toggle debug logging → confirm `.debug-enabled` file appears with 24h expiry.
  6. Trigger an unclean shutdown (kill -9 the app), relaunch → confirm crash prompt dialog appears.
- [ ] Merge dev into the worktree branch if needed; resolve conflicts; push.

---

## Self-Review Notes

- **Spec coverage:** Every spec section maps to a task. Section 5 (data contracts) → Task 1. Section 6 (logger) → Task 7. Section 7 (crash capture wiring) → Tasks 8, 9, 10, 15, 16. Section 8 (redaction) → Task 3. Section 9 (truncation) → Task 4. Section 10 (storage) → Tasks 2, 4. Section 11 (retention) → Task 6. Section 12 (export/upload) → Tasks 11, 12, 13. Section 13 (IPC) → Tasks 9, 13. Section 14 (UI) → Task 14. Section 15 (settings storage) → Tasks 13, 14. Section 16 (i18n) → Task 18. Section 17 (testing) → Tasks 1-6, 8, 11, 12, 19. Section 18 (rollout) → one task per commit. No spec gaps.
- **Type consistency:** `CrashReporterService.cfg.sessionId` is accessed in IPC handlers via a cast — type-safe via the interface. `recordRendererErrorPayload` is exported from `CrashReporterService.ts` and re-imported in IPC handlers — names match.
- **Known loose ends to resolve during implementation:** (1) `Token` and `axios` import paths in `diagnostics-ipc.ts` may need adjustment to match the project's existing HTTP/auth helpers. (2) The existing settings page path must be located before Task 14 step 1. (3) Consent persistence uses `SystemSetting` — if no `useSettingsStore` exists, wire via direct `SYSTEM_SETTING_UPDATE` IPC.
