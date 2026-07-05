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
