'use strict';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CrashLogSink } from '@/modules/diagnostics/CrashLogSink';
import { ErrorLogSink } from '@/modules/diagnostics/ErrorLogSink';
import { __setDiagnosticsDirForTests } from '@/modules/diagnostics/DiagnosticPaths';
import { DiagnosticReportBuilder } from '@/modules/diagnostics/DiagnosticReportBuilder';
import { CrashReporterService } from '@/modules/diagnostics/CrashReporterService';
import type { ErrorRecord } from '@/modules/diagnostics/DiagnosticSchemas';

/**
 * Integration tests that exercise the full crash pipeline end-to-end:
 *   exception -> CrashReporterService -> CrashLogSink (crash.jsonl)
 *   -> DiagnosticReportBuilder -> sanitized upload package
 *
 * Also covers the renderer-error pipeline (error.jsonl) and worker-exit path.
 *
 * NOTE: ErrorLogSink caches a write stream at the module level. We must call
 * `resetForTests()` whenever we change the diagnostics dir, otherwise the
 * second test that uses ErrorLogSink will write to a deleted temp dir.
 */
describe('diagnostics crash pipeline (integration)', () => {
  let tmp: string;
  let svc: CrashReporterService;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-int-'));
    __setDiagnosticsDirForTests(tmp);
    // Reset the cached ErrorLogSink stream so it re-opens under the new tmp.
    (
      ErrorLogSink as unknown as { resetForTests(): void }
    ).resetForTests();
    svc = new CrashReporterService({
      sessionId: 'sess-int',
      installId: 'inst-int',
      appVersion: '1.0.0',
      platform: 'linux',
      arch: 'x64',
    });
  });

  afterEach(() => {
    // Reset stream before deleting the dir so no write races occur.
    (
      ErrorLogSink as unknown as { resetForTests(): void }
    ).resetForTests();
    fs.rmSync(tmp, { recursive: true, force: true });
    __setDiagnosticsDirForTests('');
  });

  test('end-to-end: exception -> crash.jsonl -> upload package redacted', () => {
    svc.recordUncaughtException(
      new Error('Authorization: Bearer secret-token')
    );
    const records = CrashLogSink.readAll();
    expect(records).toHaveLength(1);

    const pkg = new DiagnosticReportBuilder({
      appVersion: '1.0.0',
      platform: 'linux',
      arch: 'x64',
      installId: 'inst-int',
      sessionId: 'sess-int',
      breadcrumbs: svc.getBreadcrumbs(),
      recentErrors: svc.getRecentErrors(),
    }).buildUploadPackage(records[0].crashId);

    expect(pkg).not.toBeNull();
    const serialized = JSON.stringify(pkg);
    expect(serialized).not.toContain('secret-token');
    expect(serialized).toContain('[REDACTED]');
  });

  test('end-to-end: renderer error -> error.jsonl', async () => {
    const rec: ErrorRecord = {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      errorId: 'e1',
      sessionId: 'sess-int',
      level: 'error',
      processType: 'renderer',
      feature: 'renderer',
      message: 'boom',
      metadata: { password: 'p' },
    };
    await ErrorLogSink.write(rec);

    const file = path.join(tmp, 'error.jsonl');
    const content = fs.readFileSync(file, 'utf8');
    expect(content).toContain('[REDACTED]');
    expect(content).not.toContain('"password":"p"');
  });

  test('worker exit -> crash.jsonl', () => {
    svc.recordWorkerExit({
      workerType: 'contact-extraction',
      taskId: 't1',
      pid: 99,
      code: 1,
      signal: null,
    });
    const records = CrashLogSink.readAll();
    expect(records).toHaveLength(1);
    expect(records[0].crashType).toBe('worker-exit');
    expect(records[0].workerType).toBe('contact-extraction');
    expect(records[0].exitCode).toBe(1);
  });

  test('acceptance #6: export excludes tokens', () => {
    svc.recordUncaughtException(
      new Error('Authorization: Bearer abc.def.ghi')
    );
    const rec = CrashLogSink.readAll()[0];

    const pkg = new DiagnosticReportBuilder({
      appVersion: '1.0.0',
      platform: 'linux',
      arch: 'x64',
      installId: 'inst-int',
      sessionId: 'sess-int',
      breadcrumbs: [],
      recentErrors: [],
    }).buildUploadPackage(rec.crashId);

    const serialized = JSON.stringify(pkg);
    expect(serialized).not.toContain('abc.def.ghi');
    expect(serialized).not.toContain('Bearer ');
  });
});
