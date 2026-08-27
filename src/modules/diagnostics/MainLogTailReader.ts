"use strict";
import * as fs from "fs";
import * as path from "path";
import { redactString } from "./DiagnosticRedactor";
import { Logger } from "@/modules/Logger";

/** Default maximum number of main.log lines included in a crash upload. */
export const DEFAULT_MAIN_LOG_TAIL_MAX_LINES = 200;
/** Default maximum string length of the tail after redaction (32 KB). */
export const DEFAULT_MAIN_LOG_TAIL_MAX_BYTES = 32 * 1024;

export interface MainLogTailOptions {
  /**
   * Log root directory. Defaults to `Logger.getInstance().getLogDir()`
   * (`<userData>/logs`). Exposed for tests and callers with a custom dir.
   */
  logDir?: string;
  /** Maximum number of lines to include. Default 200. */
  maxLines?: number;
  /** Maximum string length after redaction. Default 32 KB. */
  maxBytes?: number;
}

/**
 * Read the last N lines of today's `main.log`, redact sensitive patterns,
 * and truncate to `maxBytes` (keeping the most recent bytes). Returns
 * `undefined` when the file is missing, unreadable, or empty. Never throws.
 *
 * The path is resolved as `<logDir>/<YYYY-MM-DD>/main.log`, matching the
 * electron-log `resolvePathFn` in Logger.ts. Only today's file is tailed
 * because a crash is uploaded in the same session that produced the logs.
 *
 * Redaction runs per line: `redactString` clamps any single input to ~4 KB,
 * so redacting the whole tail at once would silently shrink the 32 KB budget
 * to one clamped slice. Per-line redaction applies every pattern while
 * preserving the full line budget.
 */
export function readMainLogTail(
  opts: MainLogTailOptions = {}
): string | undefined {
  const maxLines = opts.maxLines ?? DEFAULT_MAIN_LOG_TAIL_MAX_LINES;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAIN_LOG_TAIL_MAX_BYTES;
  try {
    const logDir = opts.logDir ?? Logger.getInstance().getLogDir();
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const filePath = path.join(logDir, `${y}-${m}-${d}`, "main.log");
    if (!fs.existsSync(filePath)) return undefined;
    const content = fs.readFileSync(filePath, "utf8");
    if (!content) return undefined;
    const tail = content
      .split("\n")
      .slice(-maxLines)
      .map((line) => redactString(line))
      .join("\n");
    if (!tail.trim()) return undefined;
    if (tail.length <= maxBytes) return tail;
    // Keep the most recent bytes (end of the string) for recency.
    return tail.slice(tail.length - maxBytes);
  } catch {
    return undefined;
  }
}
