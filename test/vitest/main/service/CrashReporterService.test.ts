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
    const records = CrashLogSink.readAll();
    expect(records[0].crashType).toBe('unhandled-rejection');
  });
});
