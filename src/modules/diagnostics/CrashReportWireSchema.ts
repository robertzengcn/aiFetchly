'use strict';
import { z } from 'zod/v4';
import type {
  DiagnosticReportPackage,
  ErrorRecord,
  DiagnosticBreadcrumb,
} from './DiagnosticSchemas';

/**
 * Wire contract for POST /api/crash-reports.
 *
 * This mirrors the marketing backend's `CrashReportRequest` /
 * `CrashPayload` / `ErrorPayload` / `Breadcrumb` structs in
 * marketing/services/crashreport/schema.go. The backend decodes the body with
 * `json.Decoder.DisallowUnknownFields()` and runs a strict `Validate()`, so any
 * field not modelled here is rejected with HTTP 400
 * "Crash report could not be accepted".
 *
 * The desktop diagnostics module keeps a richer internal `DiagnosticReportPackage`
 * (for local crash.jsonl logging and local export). {@link projectToWirePayload}
 * projects that rich package down to this slim wire shape before upload.
 */

// Server-side limits (marketing/services/crashreport/schema.go).
export const MAX_MESSAGE = 4096;
export const MAX_STACK = 32 * 1024;
export const MAX_BREADCRUMB_ENTRIES = 100;
export const MAX_RECENT_ERROR_ENTRIES = 50;
export const MAX_BREADCRUMB_MESSAGE = 1024;
export const MAX_BREADCRUMB_CATEGORY = 64;

const rfc3339 = z.string().regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
  { message: 'timestamp must be RFC3339' },
);

// validPlatforms (schema.go): darwin, win32, linux, mas.
const platformWire = z.enum(['darwin', 'win32', 'linux', 'mas']);

// validProcessType (schema.go): main, renderer, worker, utility, gpu.
const processTypeWire = z.enum(['main', 'renderer', 'worker', 'utility', 'gpu']);

// validSeverity (schema.go): info, warning, error, fatal.
const severityWire = z.enum(['info', 'warning', 'error', 'fatal']);

export const crashPayloadWireSchema = z.object({
  timestamp: rfc3339,
  processType: processTypeWire,
  // crashType: allow-list OR any lowercase snake/kebab string (max 64). Modelled
  // as a bounded string so forward-compat values still pass.
  crashType: z.string().min(1).max(64),
  message: z.string().max(MAX_MESSAGE),
  stack: z.string().max(MAX_STACK).optional(),
  reason: z.string().optional(),
  severity: severityWire.optional(),
});

export const errorPayloadWireSchema = z.object({
  timestamp: rfc3339,
  name: z.string(),
  message: z.string().max(MAX_MESSAGE),
  stack: z.string().max(MAX_STACK).optional(),
});

export const breadcrumbWireSchema = z.object({
  timestamp: rfc3339,
  category: z.string().max(MAX_BREADCRUMB_CATEGORY),
  message: z.string().max(MAX_BREADCRUMB_MESSAGE),
  level: z.string().optional(),
});

export const crashReportWireSchema = z.object({
  schemaVersion: z.literal(1),
  appVersion: z.string().min(1).max(64),
  platform: platformWire,
  arch: z.string().max(32),
  installId: z.string().min(1).max(128),
  sessionId: z.string().max(128),
  crash: crashPayloadWireSchema,
  recentErrors: z.array(errorPayloadWireSchema).max(MAX_RECENT_ERROR_ENTRIES),
  breadcrumbs: z.array(breadcrumbWireSchema).max(MAX_BREADCRUMB_ENTRIES),
});

export type CrashReportWirePayload = z.infer<typeof crashReportWireSchema>;

/** Slice a string to at most `max` chars; preserve `undefined`. Never mutates input. */
function cap(s: string | undefined, max: number): string | undefined {
  if (s === undefined) return undefined;
  return s.length <= max ? s : s.slice(0, max);
}

/**
 * Map the internal CrashRecord processType to a server-valid value. The client
 * schema permits `"unknown"` (e.g. child-process-gone, see CrashReporterService),
 * which the backend rejects. Unknown values are coerced to `"main"` — the
 * observing/recording process — which is always a safe, valid default.
 */
function toWireProcessType(
  pt: string,
): 'main' | 'renderer' | 'worker' | 'utility' | 'gpu' {
  switch (pt) {
    case 'renderer':
    case 'worker':
    case 'utility':
    case 'gpu':
      return pt;
    default:
      return 'main';
  }
}

/**
 * Project the rich internal {@link DiagnosticReportPackage} down to the backend
 * wire contract. Pure and non-mutating. Runs the result through
 * {@link crashReportWireSchema} so any drift (extra fields, blown limits, bad
 * enums) throws here rather than surfacing as an opaque HTTP 400.
 */
export function projectToWirePayload(
  pkg: DiagnosticReportPackage,
): CrashReportWirePayload {
  const crash = {
    timestamp: pkg.crash.timestamp,
    processType: toWireProcessType(pkg.crash.processType),
    crashType: pkg.crash.crashType,
    message: cap(pkg.crash.message, MAX_MESSAGE) ?? '',
    stack: cap(pkg.crash.stack, MAX_STACK),
    reason: pkg.crash.reason,
    // severity intentionally omitted: the internal CrashRecord carries no severity.
  };

  const recentErrors = pkg.recentErrors
    .slice(-MAX_RECENT_ERROR_ENTRIES)
    .map((e: ErrorRecord) => ({
      timestamp: e.timestamp,
      name: e.feature ?? '',
      message: cap(e.message, MAX_MESSAGE) ?? '',
      stack: cap(e.stack, MAX_STACK),
    }));

  const breadcrumbs = pkg.breadcrumbs
    .slice(-MAX_BREADCRUMB_ENTRIES)
    .map((b: DiagnosticBreadcrumb) => ({
      timestamp: b.timestamp,
      category: cap(b.category, MAX_BREADCRUMB_CATEGORY) ?? '',
      message: cap(b.message, MAX_BREADCRUMB_MESSAGE) ?? '',
      level: b.level,
    }));

  const built = {
    schemaVersion: 1 as const,
    appVersion: pkg.appVersion,
    platform: pkg.platform,
    arch: pkg.arch,
    installId: pkg.installId,
    sessionId: pkg.sessionId,
    crash,
    recentErrors,
    breadcrumbs,
  };

  return crashReportWireSchema.parse(built);
}
