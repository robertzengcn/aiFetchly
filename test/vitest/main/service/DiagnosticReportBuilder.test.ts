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
    expect(pkg).not.toBeNull();
    expect(pkg!.crash.crashId).toBe('c1');
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
    expect(pkg).not.toBeNull();
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
