"use strict";
export { CrashReporterService } from "./CrashReporterService";
export type {
  CrashReporterServiceConfig,
  WorkerExitInfo,
} from "./CrashReporterService";
export { DiagnosticUploadClient } from "./DiagnosticUploadClient";
export type {
  HttpClientLike,
  UploadClientConfig,
  UploadResult,
} from "./DiagnosticUploadClient";
export {
  crashReportWireSchema,
  projectToWirePayload,
} from "./CrashReportWireSchema";
export type { CrashReportWirePayload } from "./CrashReportWireSchema";
export {
  crashRecordSchema,
  errorRecordSchema,
  diagnosticBreadcrumbSchema,
  diagnosticReportPackageSchema,
} from "./DiagnosticSchemas";
export type {
  CrashRecord,
  ErrorRecord,
  DiagnosticBreadcrumb,
  DiagnosticReportPackage,
} from "./DiagnosticSchemas";

/**
 * Best-effort access to the singleton crash reporter installed in background.ts.
 * Returns undefined when background.ts has not yet initialized the reporter
 * (e.g. during unit tests or very early in main-process startup). Callers must
 * use optional chaining / null guards.
 */
export function getCrashReporterFromGlobal():
  | import("./CrashReporterService").CrashReporterService
  | undefined {
  return (
    globalThis as unknown as {
      __aifetchlyCrashReporter?: import("./CrashReporterService").CrashReporterService;
    }
  ).__aifetchlyCrashReporter;
}
