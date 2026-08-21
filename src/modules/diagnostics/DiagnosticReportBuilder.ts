"use strict";
import { CrashLogSink } from "./CrashLogSink";
import { redactMetadata } from "./DiagnosticRedactor";
import { readMainLogTail } from "./MainLogTailReader";
import type {
  ErrorRecord,
  DiagnosticBreadcrumb,
  DiagnosticReportPackage,
} from "./DiagnosticSchemas";

const DEFAULT_MAX_BYTES = 200 * 1024;
const EXTENDED_MAX_BYTES = 1024 * 1024;

export interface ReportBuilderConfig {
  appVersion: string;
  platform: string;
  arch: string;
  installId: string;
  sessionId: string;
  breadcrumbs: DiagnosticBreadcrumb[];
  recentErrors: ErrorRecord[];
}

export class DiagnosticReportBuilder {
  constructor(private readonly cfg: ReportBuilderConfig) {}

  buildUploadPackage(
    crashId: string,
    opts: { extended?: boolean } = {}
  ): DiagnosticReportPackage | null {
    const crash = CrashLogSink.readAll().find((c) => c.crashId === crashId);
    if (!crash) return null;
    const max = opts.extended ? EXTENDED_MAX_BYTES : DEFAULT_MAX_BYTES;

    let pkg: DiagnosticReportPackage = {
      schemaVersion: 1,
      appVersion: this.cfg.appVersion,
      platform: this.cfg.platform,
      arch: this.cfg.arch,
      installId: this.cfg.installId,
      sessionId: this.cfg.sessionId,
      crash,
      recentErrors: this.cfg.recentErrors.slice(-100),
      breadcrumbs: this.cfg.breadcrumbs.slice(-200),
    };

    // Attach the bounded, redacted main.log tail before the trim loop so the
    // size budget accounts for it (FR-3.1). Omitted when unavailable.
    const mainLogTail = readMainLogTail();
    if (mainLogTail !== undefined) {
      pkg = { ...pkg, mainLogTail };
    }

    // Trim until under budget. Drop breadcrumbs/errors first, then the log
    // tail, then truncate crash fields. Halving goes all the way to empty —
    // a floor of 1 would stall the loop (1 -> 1 forever) and let an
    // oversized package slip through the budget.
    let iterations = 0;
    while (Buffer.byteLength(JSON.stringify(pkg)) > max && iterations < 20) {
      iterations++;
      if (pkg.breadcrumbs.length > 0) {
        pkg = {
          ...pkg,
          breadcrumbs: pkg.breadcrumbs.slice(
            0,
            Math.floor(pkg.breadcrumbs.length / 2)
          ),
        };
        continue;
      }
      if (pkg.recentErrors.length > 0) {
        pkg = {
          ...pkg,
          recentErrors: pkg.recentErrors.slice(
            0,
            Math.floor(pkg.recentErrors.length / 2)
          ),
        };
        continue;
      }
      // Prefer keeping the crash message over the (already size-bounded) log
      // tail when both cannot fit.
      if (pkg.mainLogTail !== undefined) {
        pkg = { ...pkg, mainLogTail: undefined };
        continue;
      }
      const trimmed = pkg.crash.message.slice(
        0,
        Math.max(64, Math.floor(pkg.crash.message.length / 2))
      );
      pkg = { ...pkg, crash: { ...pkg.crash, message: trimmed } };
    }

    // Final redaction of metadata (defence-in-depth)
    pkg = {
      ...pkg,
      recentErrors: pkg.recentErrors.map((e) => ({
        ...e,
        metadata: e.metadata
          ? (redactMetadata(e.metadata) as ErrorRecord["metadata"])
          : undefined,
      })),
    };
    return pkg;
  }
}
