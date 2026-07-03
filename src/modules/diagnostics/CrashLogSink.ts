'use strict';
import * as fs from 'fs';
import { getCrashLogPath, ensureDiagnosticsDirs } from './DiagnosticPaths';
import { truncateCrashRecord, serializeJsonlLine } from './DiagnosticSerializer';
import { redactString } from './DiagnosticRedactor';
import type { CrashRecord } from './DiagnosticSchemas';

/** Maximum number of crash records returned from {@link CrashLogSink.readAll}. */
const MAX_READ = 50;

/**
 * Apply redaction patterns to free-text fields of a {@link CrashRecord},
 * returning a new record. The input is not mutated. Breadcrumbs get their
 * message text redacted too.
 */
function redactCrashRecord(rec: CrashRecord): CrashRecord {
  return {
    ...rec,
    message: redactString(rec.message),
    stack: rec.stack !== undefined ? redactString(rec.stack) : undefined,
    reason: rec.reason !== undefined ? redactString(rec.reason) : undefined,
    feature: rec.feature !== undefined ? redactString(rec.feature) : undefined,
    taskId: rec.taskId !== undefined ? redactString(rec.taskId) : undefined,
    workerType: rec.workerType !== undefined ? redactString(rec.workerType) : undefined,
    breadcrumbs: rec.breadcrumbs.map((b) => ({
      ...b,
      message: redactString(b.message),
      category: redactString(b.category),
    })),
  };
}

export const CrashLogSink = {
  /**
   * Append a single {@link CrashRecord} to `crash.jsonl` synchronously.
   * Synchronous I/O is intentional here — crashes must reach disk before the
   * process exits. The record is first redacted, then length-truncated, then
   * serialised. Never throws.
   */
  write(rec: CrashRecord): void {
    try {
      ensureDiagnosticsDirs();
      const redacted = redactCrashRecord(rec);
      const truncated = truncateCrashRecord(redacted);
      fs.appendFileSync(getCrashLogPath(), serializeJsonlLine(truncated));
    } catch {
      // Never throw from crash logging — we're already in a failure path.
    }
  },

  /**
   * Read crash records from `crash.jsonl`, newest-first. Best-effort: malformed
   * lines are skipped silently. Capped at {@link MAX_READ} records.
   */
  readAll(): CrashRecord[] {
    try {
      const p = getCrashLogPath();
      if (!fs.existsSync(p)) return [];
      const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
      const out: CrashRecord[] = [];
      // newest-first: walk lines from the end
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          out.push(JSON.parse(lines[i]) as CrashRecord);
        } catch {
          // skip malformed line
        }
        if (out.length >= MAX_READ) break;
      }
      return out;
    } catch {
      return [];
    }
  },
};
