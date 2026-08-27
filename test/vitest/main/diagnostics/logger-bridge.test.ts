'use strict';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { log } from '@/modules/Logger';
import type { CrashReporterService } from '@/modules/diagnostics/CrashReporterService';
import type {
  DiagnosticBreadcrumb,
  ErrorRecord,
} from '@/modules/diagnostics/DiagnosticSchemas';

/**
 * Tests for the Logger -> diagnostics bridge (FR-1): every main-process
 * log.error / log.warn call must feed the crash reporter's breadcrumb buffer
 * and recent-error ring, be redacted, and never throw — including when the
 * reporter is not initialised. The bridge must be inactive in worker
 * processes (worker logging forwards via process.send).
 */

interface ReporterStub {
  sessionId: string;
  addBreadcrumb(b: DiagnosticBreadcrumb): void;
  pushError(e: ErrorRecord): void;
}

interface Captured {
  breadcrumbs: DiagnosticBreadcrumb[];
  errors: ErrorRecord[];
}

const RFC3339 =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function installStubReporter(): Captured {
  const captured: Captured = { breadcrumbs: [], errors: [] };
  const stub: ReporterStub = {
    sessionId: 'bridge-test-session',
    addBreadcrumb: (b) => {
      captured.breadcrumbs.push(b);
    },
    pushError: (e) => {
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

describe('Logger diagnostics bridge (FR-1)', () => {
  let captured: Captured;

  beforeEach(() => {
    captured = installStubReporter();
  });

  afterEach(() => {
    clearStubReporter();
  });

  test('log.error feeds breadcrumb + recent-error buffers', () => {
    log.error('bridge error test');

    expect(captured.breadcrumbs).toHaveLength(1);
    const crumb = captured.breadcrumbs[0];
    expect(crumb.category).toBe('log');
    expect(crumb.level).toBe('error');
    expect(crumb.message).toContain('bridge error test');
    expect(crumb.timestamp).toMatch(RFC3339);

    expect(captured.errors).toHaveLength(1);
    const rec = captured.errors[0];
    expect(rec.level).toBe('error');
    expect(rec.processType).toBe('main');
    expect(rec.sessionId).toBe('bridge-test-session');
    expect(rec.schemaVersion).toBe(1);
    expect(rec.errorId).toBeTruthy();
    expect(rec.message).toContain('bridge error test');
  });

  test('log.warn feeds buffers with level warn', () => {
    log.warn('bridge warn test');

    expect(captured.breadcrumbs).toHaveLength(1);
    expect(captured.breadcrumbs[0].category).toBe('log');
    expect(captured.breadcrumbs[0].level).toBe('warn');

    expect(captured.errors).toHaveLength(1);
    expect(captured.errors[0].level).toBe('warn');
    expect(captured.errors[0].message).toContain('bridge warn test');
  });

  test('log.info and log.debug do not feed the buffers', () => {
    log.info('bridge info test');
    log.debug('bridge debug test');

    expect(captured.breadcrumbs).toHaveLength(0);
    expect(captured.errors).toHaveLength(0);
  });

  test('bearer tokens are redacted in breadcrumb and error record', () => {
    log.error('request failed Authorization: Bearer abc123secret');

    expect(captured.breadcrumbs[0].message).toContain('[REDACTED]');
    expect(captured.breadcrumbs[0].message).not.toContain('abc123secret');
    expect(captured.errors[0].message).toContain('[REDACTED]');
    expect(captured.errors[0].message).not.toContain('abc123secret');
  });

  test('does not throw when the reporter is not initialised (FR-1.6)', () => {
    clearStubReporter();
    expect(() => log.error('no reporter yet')).not.toThrow();
    expect(() => log.warn('no reporter yet')).not.toThrow();
    // Buffers were untouched — nothing to assert beyond not throwing.
  });

  test('non-string args render as meaningful strings', () => {
    log.error(new Error('object arg test'));

    const message = captured.errors[0].message;
    expect(typeof message).toBe('string');
    expect(message).not.toBe('[object Object]');
    expect(message).toContain('object arg test');

    log.warn({ structured: 'value' });
    expect(captured.errors[1].message).toContain('structured');
  });

  test('multiple args are joined into one message', () => {
    log.error('part-one', 'part-two', 42);

    expect(captured.errors[0].message).toContain('part-one');
    expect(captured.errors[0].message).toContain('part-two');
    expect(captured.errors[0].message).toContain('42');
  });

  test('bridge is inactive in worker processes (FR-1.5)', async () => {
    // Must run last in this file: vi.resetModules + dynamic import swap the
    // module registry into worker mode for the remainder of the run.
    const originalSend = process.send;
    const sendMock = vi.fn();
    (process as unknown as { send?: unknown }).send = sendMock;
    process.env.WORKER_TYPE = 'bridge-test-worker';
    try {
      vi.resetModules();
      const mod = await import('@/modules/Logger');

      mod.log.error('worker bridge test');

      // Worker proxy forwards to the main process via process.send…
      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(sendMock).toHaveBeenCalledWith({
        type: 'worker-log',
        level: 'error',
        args: ['worker bridge test'],
      });
      // …and never touches the diagnostics buffers.
      expect(captured.breadcrumbs).toHaveLength(0);
      expect(captured.errors).toHaveLength(0);
    } finally {
      delete process.env.WORKER_TYPE;
      (process as unknown as { send?: unknown }).send = originalSend;
    }
  });
});
