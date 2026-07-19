'use strict';
import * as fs from 'fs';
import * as path from 'path';
import {
  getDiagnosticsDir,
  getCrashLogPath,
  getErrorLogPath,
  getNativeDumpsDir,
} from './DiagnosticPaths';

/**
 * Configuration options for the diagnostic retention service.
 * All values are optional; omitted values fall back to DEFAULTS.
 */
export interface RetentionConfig {
  /** Retention period in days for app.log/debug.log and the legacy logs/ dir. */
  logRetentionDays?: number;
  /** Retention period in days for individual records inside crash.jsonl/error.jsonl. */
  crashRetentionDays?: number;
  /** Retention period in days for files inside native-dumps/. */
  nativeDumpRetentionDays?: number;
  /** Maximum total size in bytes allowed across the diagnostics directory. */
  budgetBytes?: number;
  /**
   * Minimum fraction of records that must be pruned before a JSONL file is rewritten.
   * Avoids rewriting large files for negligible pruning. Default 0.2 (20%).
   */
  pruneThresholdFraction?: number;
}

const DEFAULTS: Required<RetentionConfig> = {
  logRetentionDays: 14,
  crashRetentionDays: 30,
  nativeDumpRetentionDays: 14,
  budgetBytes: 200 * 1024 * 1024,
  pruneThresholdFraction: 0.2,
};

interface FileEntry {
  path: string;
  size: number;
  mtimeMs: number;
}

/**
 * DiagnosticRetentionService keeps the diagnostics directory within a configured
 * size budget and removes stale files/records according to retention policy:
 *
 * - 14-day cleanup for app.log, debug.log and the legacy logs/ dir
 * - 30-day record-level pruning for crash.jsonl/error.jsonl
 * - 14-day cleanup for native-dumps/
 * - 200 MB total budget enforced by deleting oldest files first
 *
 * All operations are best-effort and never throw to the caller.
 */
export class DiagnosticRetentionService {
  private readonly cfg: Required<RetentionConfig>;
  private timer: NodeJS.Timeout | null = null;

  constructor(cfg: RetentionConfig = {}) {
    this.cfg = { ...DEFAULTS, ...cfg };
  }

  /**
   * Schedule periodic cleanup: an initial run 5 s after start, then every 24 h.
   * Safe to call multiple times; only one interval is active at a time.
   */
  schedule(): void {
    setTimeout(() => this.runOnce(), 5000);
    this.timer = setInterval(() => this.runOnce(), 24 * 60 * 60 * 1000);
  }

  /** Stop the periodic cleanup scheduled by {@link schedule}. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Run a single cleanup pass. Never throws: any filesystem error is caught
   * and logged to console.warn so the caller (often a timer callback) is safe.
   */
  runOnce(): void {
    try {
      this.pruneOldFiles();
      this.pruneJsonlByRecordAge(getCrashLogPath(), this.cfg.crashRetentionDays);
      this.pruneJsonlByRecordAge(getErrorLogPath(), this.cfg.crashRetentionDays);
      this.enforceBudget();
    } catch (err) {
      console.warn('[DiagnosticRetentionService] cleanup failed', err);
    }
  }

  /**
   * Remove stale top-level log files and the entire native-dumps/ and
   * dated logs/ directories when their mtime exceeds the retention cutoff.
   */
  private pruneOldFiles(): void {
    const dir = getDiagnosticsDir();
    if (!fs.existsSync(dir)) return;

    const now = Date.now();
    const cutoffLog = now - this.cfg.logRetentionDays * 86400_000;
    const cutoffDump = now - this.cfg.nativeDumpRetentionDays * 86400_000;

    // Top-level rotating log files (app.log, debug.log).
    for (const name of ['app.log', 'debug.log']) {
      const p = path.join(dir, name);
      this.maybeDeleteIfOlder(p, cutoffLog);
    }

    // Native crash dumps.
    const nd = getNativeDumpsDir();
    if (fs.existsSync(nd)) {
      for (const entry of fs.readdirSync(nd)) {
        this.maybeDeleteIfOlder(path.join(nd, entry), cutoffDump);
      }
    }

    // Legacy <userData>/logs/YYYY-MM-DD directories written by the old logger.
    const logsRoot = path.join(dir, '..', 'logs');
    if (fs.existsSync(logsRoot)) {
      for (const entry of fs.readdirSync(logsRoot)) {
        const p = path.join(logsRoot, entry);
        const stat = fs.statSync(p);
        if (stat.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry)) {
          if (stat.mtimeMs < cutoffLog) {
            fs.rmSync(p, { recursive: true, force: true });
          }
        }
      }
    }
  }

  private maybeDeleteIfOlder(p: string, cutoff: number): void {
    try {
      const stat = fs.statSync(p);
      if (stat.mtimeMs < cutoff) {
        fs.rmSync(p, { recursive: true, force: true });
      }
    } catch {
      // File may have been removed concurrently; ignore.
    }
  }

  /**
   * Prune individual records from a JSONL file whose `timestamp` field
   * is older than `days`. The file is only rewritten when the fraction of
   * pruned lines exceeds {@link RetentionConfig.pruneThresholdFraction},
   * to avoid expensive rewrites for negligible gains.
   *
   * Unparseable lines and lines without a valid timestamp are preserved.
   */
  private pruneJsonlByRecordAge(file: string, days: number): void {
    try {
      if (!fs.existsSync(file)) return;
      const cutoff = Date.now() - days * 86400_000;
      const raw = fs.readFileSync(file, 'utf8');
      const lines = raw.split('\n').filter((line) => line.length > 0);
      const kept: string[] = [];
      let pruned = 0;
      for (const line of lines) {
        try {
          const r = JSON.parse(line) as { timestamp?: string };
          const t = r.timestamp ? Date.parse(r.timestamp) : NaN;
          if (Number.isFinite(t) && t < cutoff) {
            pruned++;
            continue;
          }
        } catch {
          // Keep unparseable lines rather than dropping diagnostic data.
        }
        kept.push(line);
      }
      if (pruned / Math.max(lines.length, 1) > this.cfg.pruneThresholdFraction) {
        fs.writeFileSync(file, kept.join('\n') + (kept.length > 0 ? '\n' : ''));
      }
    } catch {
      // File may have been removed concurrently; ignore.
    }
  }

  /**
   * Enforce the total size budget by deleting files oldest-first until the
   * directory is at or below the configured byte budget.
   */
  private enforceBudget(): void {
    const dir = getDiagnosticsDir();
    if (!fs.existsSync(dir)) return;

    const entries = this.collectWithMtime(dir);
    const total = entries.reduce((sum, e) => sum + e.size, 0);
    if (total <= this.cfg.budgetBytes) return;

    entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
    let remaining = total;
    for (const e of entries) {
      if (remaining <= this.cfg.budgetBytes) break;
      try {
        fs.rmSync(e.path, { recursive: true, force: true });
      } catch {
        // Ignore individual deletion failures and continue.
      }
      remaining -= e.size;
    }
  }

  /**
   * Walk the directory tree rooted at `root` and return one entry per regular
   * file with its size and mtime. Symlinks and missing files are ignored.
   */
  private collectWithMtime(root: string): FileEntry[] {
    const out: FileEntry[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        try {
          const stat = fs.statSync(full);
          out.push({ path: full, size: stat.size, mtimeMs: stat.mtimeMs });
        } catch {
          // File may have been removed concurrently; ignore.
        }
      }
    };
    walk(root);
    return out;
  }
}
