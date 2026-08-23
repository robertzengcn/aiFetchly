'use strict';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ErrorLogSink } from '@/modules/diagnostics/ErrorLogSink';
import { __setDiagnosticsDirForTests } from '@/modules/diagnostics/DiagnosticPaths';
import { getErrorLogPath } from '@/modules/diagnostics/DiagnosticPaths';
import type { CrashReporterService } from '@/modules/diagnostics/CrashReporterService';
import type { ErrorRecord } from '@/modules/diagnostics/DiagnosticSchemas';

/**
 * Tests for the ErrorLogSink -> buffer mirror (FR-2): every record written to
 * error.jsonl is also pushed into the in-memory recent-error ring via the
 * global crash reporter, resolved at write time. Writing still succeeds when
 * no reporter exists.
 */

interface Captured {
  errors: ErrorRecord[];
}

function makeRecord(overrides: Partial<ErrorRecord> = {}): ErrorRecord {
  return {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    errorId: `err-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: 'mirror-test-session',
    level: 'error',
    processType: 'renderer',
    message: 'renderer error body',
    ...overrides,
  };
}

function installStubReporter(): Captured {
  const captured: Captured = { errors: [] };
  const stub = {
    sessionId: 'mirror-test-session',
    addBreadcrumb: (): void => undefined,
    pushError: (e: ErrorRecord): void => {
      captured.errors.push(e);
    },
  };
  (globalThis as unknown as { __aifetchlyCrashReporter?: CrashReporterService })
    .__aifetchlyCrashReporter = stub as unknown as CrashReporterService;
  return captured;
}

function clearStubReporter(): void {
  delete (
    globalThis as unknown as { __aifetchlyCrashReporter?: CrashReporterService }
  ).__aifetchlyCrashReporter;
}

describe('ErrorLogSink buffer mirror (FR-2)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-mirror-'));
    __setDiagnosticsDirForTests(tmp);
    (
      ErrorLogSink as unknown as { resetForTests(): void }
    ).resetForTests();
  });

  afterEach(() => {
    (
      ErrorLogSink as unknown as { resetForTests(): void }
    ).resetForTests();
    fs.rmSync(tmp, { recursive: true, force: true });
    __setDiagnosticsDirForTests('');
    clearStubReporter();
  });

  test('write mirrors the truncated record into the buffer (FR-2.1)', async () => {
    const captured = installStubReporter();
    const rec = makeRecord({ message: 'mirror me' });

    await ErrorLogSink.write(rec);

    expect(captured.errors).toHaveLength(1);
    expect(captured.errors[0].message).toBe('mirror me');
    expect(captured.errors[0].processType).toBe('renderer');
    expect(captured.errors[0].errorId).toBe(rec.errorId);
  });

  test('mirrored record is redacted before pushing (FR-3 pattern parity)', async () => {
    const captured = installStubReporter();
    const rec = makeRecord({
      message: 'failed Authorization: Bearer mirror-secret-token',
    });

    await ErrorLogSink.write(rec);

    expect(captured.errors[0].message).toContain('[REDACTED]');
    expect(captured.errors[0].message).not.toContain('mirror-secret-token');
  });

  test('disk write still succeeds with no reporter and does not throw (FR-2.3)', async () => {
    clearStubReporter();
    const rec = makeRecord({ message: 'no reporter write' });

    await expect(ErrorLogSink.write(rec)).resolves.toBeUndefined();

    const onDisk = fs.readFileSync(getErrorLogPath(), 'utf8');
    expect(onDisk).toContain('no reporter write');
    expect(onDisk).not.toContain('undefined');
  });

  test('both disk write and mirror receive the record together', async () => {
    const captured = installStubReporter();
    const rec = makeRecord({ message: 'dual write check' });

    await ErrorLogSink.write(rec);

    const onDisk = fs.readFileSync(getErrorLogPath(), 'utf8');
    expect(onDisk).toContain('dual write check');
    expect(captured.errors).toHaveLength(1);
    expect(captured.errors[0].message).toBe('dual write check');
  });
});
