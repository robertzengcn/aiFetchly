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
