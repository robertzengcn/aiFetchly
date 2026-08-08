"use strict";
import * as fs from "fs";
import { getErrorLogPath, ensureDiagnosticsDirs } from "./DiagnosticPaths";
import {
  truncateErrorRecord,
  serializeJsonlLine,
} from "./DiagnosticSerializer";
import { redactString, redactMetadata } from "./DiagnosticRedactor";
import type { ErrorRecord } from "./DiagnosticSchemas";

/** Lazily-created append stream for the error log. */
let stream: fs.WriteStream | null = null;

/**
 * Get (or create) the shared write stream for the error log.
 * The stream is opened in append mode so concurrent writers append safely.
 */
function getStream(): fs.WriteStream {
  if (stream && !stream.destroyed) return stream;
  ensureDiagnosticsDirs();
  stream = fs.createWriteStream(getErrorLogPath(), {
    flags: "a",
    encoding: "utf8",
  });
  stream.on("error", () => {
    stream = null;
  });
  return stream;
}

/**
 * Apply redaction patterns to free-text fields of an {@link ErrorRecord}
 * and run `redactMetadata` over the structured `metadata` bag, returning a
 * new record. The input is not mutated.
 */
function redactErrorRecord(rec: ErrorRecord): ErrorRecord {
  const redacted: ErrorRecord = {
    ...rec,
    message: redactString(rec.message),
    stack: rec.stack !== undefined ? redactString(rec.stack) : undefined,
    feature: rec.feature !== undefined ? redactString(rec.feature) : undefined,
  };
  if (rec.metadata !== undefined) {
    redacted.metadata = redactMetadata(rec.metadata) as ErrorRecord["metadata"];
  }
  return redacted;
}

export const ErrorLogSink = {
  /**
   * Append a single {@link ErrorRecord} to `error.jsonl` as one JSONL line.
   * The record is first redacted (free-text fields + metadata), then
   * length-truncated, then serialised. Never throws — logging failures are
   * swallowed to avoid masking the original error being logged.
   */
  async write(rec: ErrorRecord): Promise<void> {
    try {
      const redacted = redactErrorRecord(rec);
      const truncated = truncateErrorRecord(redacted);
      const line = serializeJsonlLine(truncated);
      await new Promise<void>((resolve) => {
        const s = getStream();
        // Use the write callback so we only resolve once the data is flushed.
        s.write(line, "utf8", () => resolve());
      });
    } catch {
      // Never throw from the logging path.
    }
  },
};

// Test-only helper: reset the cached stream so the next write re-opens a file
// under the (possibly overridden) diagnostics directory. Cast at the call site.
type ErrorLogSinkWithTests = typeof ErrorLogSink & { resetForTests(): void };
(ErrorLogSink as ErrorLogSinkWithTests).resetForTests = (): void => {
  if (stream) {
    stream.destroy();
    stream = null;
  }
};
