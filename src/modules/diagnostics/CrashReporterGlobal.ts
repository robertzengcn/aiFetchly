"use strict";
import type { CrashReporterService } from "./CrashReporterService";

/**
 * Best-effort access to the singleton crash reporter installed in background.ts.
 * Returns undefined when background.ts has not yet initialized the reporter
 * (e.g. during unit tests or very early in main-process startup). Callers must
 * use optional chaining / null guards.
 *
 * Lives in its own module with a *type-only* import of CrashReporterService so
 * sibling modules inside the diagnostics package (e.g. ErrorLogSink, Logger)
 * can resolve the reporter at call time without creating a runtime import
 * cycle — CrashReporterService itself imports ErrorLogSink.
 */
export function getCrashReporterFromGlobal():
  | CrashReporterService
  | undefined {
  return (
    globalThis as unknown as {
      __aifetchlyCrashReporter?: CrashReporterService;
    }
  ).__aifetchlyCrashReporter;
}
