'use strict';
import { describe, test, expect } from 'vitest';
import {
  truncateCrashRecord,
  truncateErrorRecord,
  serializeJsonlLine,
} from '@/modules/diagnostics/DiagnosticSerializer';
import type { CrashRecord, ErrorRecord } from '@/modules/diagnostics/DiagnosticSchemas';

const baseCrash = {
  schemaVersion: 1 as const,
  timestamp: '2026-07-03T00:00:00.000Z',
  crashId: 'c1',
  sessionId: 's1',
  installId: 'i1',
  appVersion: '1.0.0',
  platform: 'linux',
  arch: 'x64',
  processType: 'main' as const,
  crashType: 'uncaught-exception' as const,
  message: '',
  breadcrumbs: [],
};

const baseError = {
  schemaVersion: 1 as const,
  timestamp: '2026-07-03T00:00:00.000Z',
  errorId: 'e1',
  sessionId: 's1',
  level: 'error' as const,
  processType: 'main' as const,
  message: '',
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

  test('truncateCrashRecord preserves fields when under caps', () => {
    const rec: CrashRecord = {
      ...baseCrash,
      message: 'short message',
      stack: 'short stack',
      reason: 'a reason',
      feature: 'feature-a',
    };
    const out = truncateCrashRecord(rec);
    expect(out.message).toBe('short message');
    expect(out.stack).toBe('short stack');
    expect(out.reason).toBe('a reason');
    expect(out.feature).toBe('feature-a');
  });

  test('truncateCrashRecord caps breadcrumbs count and message', () => {
    const rec: CrashRecord = {
      ...baseCrash,
      message: 'ok',
      breadcrumbs: Array.from({ length: 250 }, (_, i) => ({
        timestamp: '2026-07-03T00:00:00.000Z',
        category: 'cat',
        message: 'b'.repeat(2048),
      })),
    };
    const out = truncateCrashRecord(rec);
    expect(out.breadcrumbs.length).toBe(200);
    expect(out.breadcrumbs[0].message.length).toBe(1024);
  });

  test('truncateErrorRecord caps message', () => {
    const out = truncateErrorRecord({
      ...baseError,
      message: 'z'.repeat(20 * 1024),
    });
    expect(out.message.length).toBe(8 * 1024);
  });

  test('truncateErrorRecord caps stack', () => {
    const out = truncateErrorRecord({
      ...baseError,
      message: 'ok',
      stack: 's'.repeat(32 * 1024),
    });
    expect(out.stack!.length).toBe(16 * 1024);
  });

  test('serializeJsonlLine caps total line at 64KB', () => {
    const obj = { blob: 'a'.repeat(100 * 1024) };
    const line = serializeJsonlLine(obj);
    expect(line.length).toBeLessThanOrEqual(64 * 1024);
    expect(line.endsWith('\n')).toBe(true);
  });

  test('serializeJsonlLine appends trailing newline', () => {
    const line = serializeJsonlLine({ hello: 'world' });
    expect(line.endsWith('\n')).toBe(true);
    expect(line).toBe(JSON.stringify({ hello: 'world' }) + '\n');
  });

  test('serializeJsonlLine handles unserializable values', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const line = serializeJsonlLine(circular);
    expect(line.endsWith('\n')).toBe(true);
    expect(line).toContain('unserializable');
  });
});
