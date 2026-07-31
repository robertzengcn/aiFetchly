"use strict";
import type { CrashRecord, ErrorRecord } from "./DiagnosticSchemas";

/** Maximum length for message fields (8 KB). */
const MAX_MESSAGE = 8 * 1024;
/** Maximum length for stack-trace fields (16 KB). */
const MAX_STACK = 16 * 1024;
/** Maximum length for reason fields (1 KB). */
const MAX_REASON = 1024;
/** Maximum length for short identifier fields like feature / taskId / workerType. */
const MAX_SHORT_ID = 128;
/** Maximum length for breadcrumb message text. */
const MAX_BREADCRUMB_MESSAGE = 1024;
/** Maximum number of breadcrumbs retained on a crash record. */
const MAX_BREADCRUMBS = 200;
/** Maximum total JSONL line size (64 KB). */
const MAX_LINE = 64 * 1024;

/**
 * Slice a string to at most `max` characters.
 * Returns `undefined` when the input is `undefined` so optional fields stay absent.
 * Does NOT mutate the input.
 */
function cap(s: string | undefined, max: number): string | undefined {
  if (s === undefined) return undefined;
  return s.length <= max ? s : s.slice(0, max);
}

/**
 * Truncate a {@link CrashRecord} so every field respects its schema maximum,
 * without mutating the original record. Length enforcement only — redaction
 * is the responsibility of the calling sink (see {@link ErrorLogSink} /
 * {@link CrashLogSink}) which applies `redactString` to free-text fields and
 * `redactMetadata` to structured metadata before serialising.
 */
export function truncateCrashRecord(r: CrashRecord): CrashRecord {
  return {
    ...r,
    message: cap(r.message, MAX_MESSAGE) ?? "",
    stack: cap(r.stack, MAX_STACK),
    reason: cap(r.reason, MAX_REASON),
    feature: cap(r.feature, MAX_SHORT_ID),
    taskId: cap(r.taskId, MAX_SHORT_ID),
    workerType: cap(r.workerType, MAX_SHORT_ID),
    breadcrumbs: r.breadcrumbs.slice(0, MAX_BREADCRUMBS).map((b) => ({
      ...b,
      message: cap(b.message, MAX_BREADCRUMB_MESSAGE) ?? "",
    })),
  };
}

/**
 * Truncate an {@link ErrorRecord} so every field respects its schema maximum,
 * without mutating the original record. Length enforcement only.
 */
export function truncateErrorRecord(r: ErrorRecord): ErrorRecord {
  return {
    ...r,
    message: cap(r.message, MAX_MESSAGE) ?? "",
    stack: cap(r.stack, MAX_STACK),
    feature: cap(r.feature, MAX_SHORT_ID),
  };
}

/**
 * Serialise an object as a single JSONL line (JSON + `\n`).
 * If the serialised form exceeds 64 KB it is hard-truncated so a single log
 * record can never blow past the 64 KB line budget. Unserialisable values
 * (e.g. objects with cycles) produce a safe placeholder line instead of
 * throwing.
 */
export function serializeJsonlLine(obj: unknown): string {
  let line: string;
  try {
    line = JSON.stringify(obj);
  } catch {
    line = JSON.stringify({ error: "unserializable" });
  }
  // Reserve 1 char for the trailing '\n' so the full serialised line (with
  // newline) fits within MAX_LINE.
  const cap = MAX_LINE - 1;
  if (line.length > cap) {
    line = line.slice(0, cap - 3) + "...";
  }
  return line + "\n";
}
