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
    vi.resetAllMocks();
  });

  test('returns reportId on 200', async () => {
    const fakeHttp = { post: vi.fn().mockResolvedValue({ status: 200, data: { status: true, reportId: 'r1' } }) };
    const c = new DiagnosticUploadClient({
      endpoint: 'https://x/api/crash-reports',
      http: fakeHttp,
    });
    const res = await c.upload(basePkg);
    expect(res.reportId).toBe('r1');
    expect(fakeHttp.post).toHaveBeenCalledWith(
      'https://x/api/crash-reports',
      basePkg,
      expect.objectContaining({ headers: expect.objectContaining({ 'Content-Type': 'application/json' }) }),
    );
  });

  test('surfaces 429 as rate-limit error', async () => {
    const c = new DiagnosticUploadClient({
      endpoint: 'https://x/api/crash-reports',
      http: { post: vi.fn().mockResolvedValue({ status: 429, data: { status: false, msg: 'slow down' } }) },
    });
    const res = await c.upload(basePkg);
    expect(res.reportId).toBeNull();
    expect(res.error).toMatch(/rate/i);
  });

  test('surfaces 413 as too-large error', async () => {
    const c = new DiagnosticUploadClient({
      endpoint: 'https://x/api/crash-reports',
      http: { post: vi.fn().mockResolvedValue({ status: 413, data: { status: false, msg: 'too big' } }) },
    });
    const res = await c.upload(basePkg);
    expect(res.error).toMatch(/large/i);
  });

  test('network error returns generic error', async () => {
    const c = new DiagnosticUploadClient({
      endpoint: 'https://x/api/crash-reports',
      http: { post: vi.fn().mockRejectedValue(new Error('econnrefused')) },
    });
    const res = await c.upload(basePkg);
    expect(res.reportId).toBeNull();
    expect(res.error).toBeDefined();
  });

  test('attaches Authorization header when token provided', async () => {
    const fakeHttp = { post: vi.fn().mockResolvedValue({ status: 200, data: { status: true, reportId: 'r1' } }) };
    const c = new DiagnosticUploadClient({
      endpoint: 'https://x/api/crash-reports',
      http: fakeHttp,
      authToken: 'Bearer abc',
    });
    await c.upload(basePkg);
    expect(fakeHttp.post).toHaveBeenCalledWith(
      expect.any(String), expect.anything(),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer abc' }) }),
    );
  });
});
