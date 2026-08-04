'use strict';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CrashLogSink } from '@/modules/diagnostics/CrashLogSink';
import { __setDiagnosticsDirForTests } from '@/modules/diagnostics/DiagnosticPaths';
import type { CrashRecord } from '@/modules/diagnostics/DiagnosticSchemas';

const baseCrash: CrashRecord = {
  schemaVersion: 1,
  timestamp: '2026-07-03T00:00:00.000Z',
  crashId: 'c1',
  sessionId: 's1',
  installId: 'i1',
  appVersion: '1.0.0',
  platform: 'linux',
  arch: 'x64',
  processType: 'main',
  crashType: 'uncaught-exception',
  message: 'boom',
  breadcrumbs: [],
};

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
      ...baseCrash,
      message: 'Authorization: Bearer leak-token',
    };
    CrashLogSink.write(rec);
    const file = path.join(tmp, 'crash.jsonl');
    const content = fs.readFileSync(file, 'utf8').trim();
    expect(content).toContain('crashId');
    expect(content).not.toContain('leak-token');
    expect(content).toContain('[REDACTED]');
  });

  test('writes valid JSON line with trailing newline', () => {
    CrashLogSink.write(baseCrash);
    const file = path.join(tmp, 'crash.jsonl');
    const raw = fs.readFileSync(file, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    const line = raw.trim();
    const parsed = JSON.parse(line) as CrashRecord;
    expect(parsed.crashId).toBe('c1');
    expect(parsed.processType).toBe('main');
  });

  test('appends multiple records', () => {
    CrashLogSink.write(baseCrash);
    CrashLogSink.write({ ...baseCrash, crashId: 'c2' });
    const file = path.join(tmp, 'crash.jsonl');
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    expect(lines.length).toBe(2);
  });

  test('does not throw on write failure', () => {
    const blocker = path.join(tmp, 'blocker');
    fs.writeFileSync(blocker, 'x');
    __setDiagnosticsDirForTests(path.join(blocker, 'sub'));
    expect(() => CrashLogSink.write(baseCrash)).not.toThrow();
  });

  test('readAll returns records newest-first', () => {
    CrashLogSink.write(baseCrash);
    CrashLogSink.write({ ...baseCrash, crashId: 'c2' });
    const all = CrashLogSink.readAll();
    expect(all.length).toBe(2);
    expect(all[0].crashId).toBe('c2');
    expect(all[1].crashId).toBe('c1');
  });

  test('readAll returns empty when no file', () => {
    expect(CrashLogSink.readAll()).toEqual([]);
  });

  test('readAll caps at 50 records', () => {
    for (let i = 0; i < 60; i++) {
      CrashLogSink.write({ ...baseCrash, crashId: `c${i}` });
    }
    expect(CrashLogSink.readAll().length).toBe(50);
  });
});
