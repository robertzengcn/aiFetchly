'use strict';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DiagnosticRetentionService } from '@/modules/diagnostics/DiagnosticRetentionService';
import { __setDiagnosticsDirForTests } from '@/modules/diagnostics/DiagnosticPaths';

describe('DiagnosticRetentionService', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ret-'));
    __setDiagnosticsDirForTests(tmp);
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    __setDiagnosticsDirForTests('');
  });

  test('deletes old log files older than 14 days', () => {
    const old = path.join(tmp, 'app.log');
    fs.writeFileSync(old, 'x');
    const oldTime = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    fs.utimesSync(old, oldTime, oldTime);
    new DiagnosticRetentionService({ budgetBytes: 200 * 1024 * 1024 }).runOnce();
    expect(fs.existsSync(old)).toBe(false);
  });

  test('enforces total budget by deleting oldest first', () => {
    const a = path.join(tmp, 'a.log');
    const b = path.join(tmp, 'b.log');
    const c = path.join(tmp, 'c.log');
    fs.writeFileSync(a, 'aaaa');
    fs.writeFileSync(b, 'bbbb');
    fs.writeFileSync(c, 'cccc');
    const t0 = new Date(Date.now() - 30 * 86400 * 1000);
    const t1 = new Date(Date.now() - 20 * 86400 * 1000);
    const t2 = new Date(Date.now() - 1 * 86400 * 1000);
    fs.utimesSync(a, t0, t0);
    fs.utimesSync(b, t1, t1);
    fs.utimesSync(c, t2, t2);
    new DiagnosticRetentionService({ budgetBytes: 8 }).runOnce();
    expect(fs.existsSync(a)).toBe(false);
    expect(fs.existsSync(c)).toBe(true);
  });

  test('prunes crash.jsonl records older than 30 days', () => {
    const f = path.join(tmp, 'crash.jsonl');
    const oldTs = new Date(Date.now() - 40 * 86400 * 1000).toISOString();
    const newTs = new Date().toISOString();
    const oldRec = JSON.stringify({ schemaVersion: 1, timestamp: oldTs, crashId: 'old', sessionId: 's', installId: 'i', appVersion: '1', platform: 'linux', arch: 'x64', processType: 'main', crashType: 'uncaught-exception', message: 'old', breadcrumbs: [] });
    const newRec = JSON.stringify({ schemaVersion: 1, timestamp: newTs, crashId: 'new', sessionId: 's', installId: 'i', appVersion: '1', platform: 'linux', arch: 'x64', processType: 'main', crashType: 'uncaught-exception', message: 'new', breadcrumbs: [] });
    fs.writeFileSync(f, `${oldRec}\n${newRec}\n`);
    new DiagnosticRetentionService({ budgetBytes: 200 * 1024 * 1024 }).runOnce();
    const content = fs.readFileSync(f, 'utf8');
    expect(content).toContain('"crashId":"new"');
    expect(content).not.toContain('"crashId":"old"');
  });

  test('never throws on missing dir', () => {
    expect(() => new DiagnosticRetentionService().runOnce()).not.toThrow();
  });
});
