'use strict';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { readMainLogTail } from '@/modules/diagnostics/MainLogTailReader';

/**
 * Tests for the bounded, redacted main.log tail reader (FR-3): last 200
 * lines, redacted per line, truncated to 32 KB keeping the most recent
 * bytes, undefined on missing / unreadable / empty files.
 */

function todayFolder(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function writeMainLog(logDir: string, content: string): string {
  const dir = path.join(logDir, todayFolder());
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'main.log');
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

describe('MainLogTailReader (FR-3)', () => {
  let logDir: string;

  beforeEach(() => {
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mainlog-tail-'));
  });

  afterEach(() => {
    fs.rmSync(logDir, { recursive: true, force: true });
  });

  test('returns the last 200 lines of a longer file (FR-3.1/3.2)', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `line-${i}`);
    writeMainLog(logDir, lines.join('\n'));

    const tail = readMainLogTail({ logDir });
    expect(tail).toBeDefined();
    const tailLines = tail!.split('\n');
    expect(tailLines).toHaveLength(200);
    expect(tailLines[0]).toBe('line-100');
    expect(tailLines[199]).toBe('line-299');
  });

  test('shorter files are returned in full', () => {
    writeMainLog(logDir, 'only-line-a\nonly-line-b\n');

    const tail = readMainLogTail({ logDir });
    expect(tail).toContain('only-line-a');
    expect(tail).toContain('only-line-b');
  });

  test('missing file returns undefined (FR-3.4)', () => {
    expect(readMainLogTail({ logDir })).toBeUndefined();
  });

  test('empty file returns undefined (FR-3.4)', () => {
    writeMainLog(logDir, '');
    expect(readMainLogTail({ logDir })).toBeUndefined();
  });

  test('whitespace-only file returns undefined', () => {
    writeMainLog(logDir, '\n\n  \n');
    expect(readMainLogTail({ logDir })).toBeUndefined();
  });

  test('bearer tokens in the tail are redacted (FR-3.3)', () => {
    writeMainLog(
      logDir,
      'before crash Authorization: Bearer tail-secret-token\nlast line\n'
    );

    const tail = readMainLogTail({ logDir });
    expect(tail).toContain('[REDACTED]');
    expect(tail).not.toContain('tail-secret-token');
    expect(tail).toContain('last line');
  });

  test('oversized file is truncated to 32 KB keeping the most recent bytes (FR-3.2)', () => {
    const filler = 'x'.repeat(500);
    const lines = Array.from({ length: 1000 }, (_, i) => `entry-${i} ${filler}`);
    writeMainLog(logDir, lines.join('\n'));

    const tail = readMainLogTail({ logDir });
    expect(tail).toBeDefined();
    expect(tail!.length).toBeLessThanOrEqual(32 * 1024);
    // Most recent content survives; oldest content is dropped.
    expect(tail).toContain('entry-999');
    expect(tail).not.toContain('entry-0\n');
  });

  test('custom maxLines/maxBytes are respected', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `row-${i}`);
    writeMainLog(logDir, lines.join('\n'));

    const tail = readMainLogTail({ logDir, maxLines: 5, maxBytes: 1024 });
    const tailLines = tail!.split('\n');
    expect(tailLines).toHaveLength(5);
    expect(tailLines[0]).toBe('row-45');
  });
});
