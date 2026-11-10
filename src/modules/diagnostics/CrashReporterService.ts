"use strict";
import { randomUUID } from "crypto";
import type {
  CrashRecord,
  DiagnosticBreadcrumb,
  ErrorRecord,
} from "./DiagnosticSchemas";
import { CrashLogSink } from "./CrashLogSink";
import { ErrorLogSink } from "./ErrorLogSink";
import { DiagnosticBreadcrumbBuffer } from "./DiagnosticBreadcrumbBuffer";
import { redactString } from "./DiagnosticRedactor";

export interface CrashReporterServiceConfig {
  sessionId: string;
  installId: string;
  appVersion: string;
  platform: string;
  arch: string;
}

export interface WorkerExitInfo {
  workerType: string;
  taskId?: string;
  pid?: number;
  code: number | null;
  signal: string | null;
}

/**
 * Structural type for the subset of Electron's `App` we use here. Declared
 * inline (rather than `import('electron').App`) so this module type-checks
 * cleanly against the test mock in tsconfig.json too.
 */
export interface ElectronAppLike {
  on(
    event: "render-process-gone",
    listener: (
      e: unknown,
      wc: unknown,
      details: { reason?: string; exitCode?: number }
    ) => void
  ): unknown;
  on(
    event: "child-process-gone",
    listener: (
      e: unknown,
      details: { reason?: string; exitCode?: number; name?: string }
    ) => void
  ): unknown;
  on(
    event: "gpu-process-crashed",
    listener: (e: unknown, killed: boolean) => void
  ): unknown;
}

/**
 * CrashReporterService is the central recorder for process-level failures in
 * the Electron main process. It owns a breadcrumb ring buffer, persists crash
 * records synchronously via CrashLogSink (so data reaches disk before any
 * abnormal exit), and installs handlers on `process` and Electron `app`.
 *
 * A single instance is created in background.ts and exposed on globalThis as
 * `__aifetchlyCrashReporter` for IPC handlers and worker bridges to consume.
 */
export class CrashReporterService {
  private buffer = new DiagnosticBreadcrumbBuffer(200, 100);

  constructor(private readonly cfg: CrashReporterServiceConfig) {}

  addBreadcrumb(b: DiagnosticBreadcrumb): void {
    this.buffer.addBreadcrumb(b);
  }
  getBreadcrumbs(): DiagnosticBreadcrumb[] {
    return this.buffer.getBreadcrumbs();
  }
  getRecentErrors() {
    return this.buffer.getRecentErrors();
  }
  /**
   * Push a pre-redacted, pre-truncated ErrorRecord into the in-memory error
   * ring buffer so it appears in the next crash upload's `recentErrors`.
   * Does not write to disk — the caller (ErrorLogSink or the Logger bridge)
   * owns persistence. Best-effort: never throws.
   */
  pushError(rec: ErrorRecord): void {
    try {
      this.buffer.addError(rec);
    } catch {
      // ignore — best-effort
    }
  }
  /** Expose config sessionId for IPC handlers — read-only. */
  get sessionId(): string {
    return this.cfg.sessionId;
  }

  recordUncaughtException(error: Error, feature?: string): void {
    this.write({
      processType: "main",
      crashType: "uncaught-exception",
      message: error.message || "uncaught exception",
      stack: error.stack,
      feature,
    });
  }

  recordUnhandledRejection(reason: unknown): void {
    if (!(reason instanceof Error)) return;
    this.write({
      processType: "main",
      crashType: "unhandled-rejection",
      message: reason.message || "unhandled rejection",
      stack: reason.stack,
    });
  }

  recordRenderProcessGone(details: {
    reason?: string;
    exitCode?: number;
  }): void {
    this.write({
      processType: "renderer",
      crashType: "render-process-gone",
      message: `renderer gone: ${details.reason ?? "unknown"}`,
      reason: details.reason,
      exitCode: details.exitCode ?? undefined,
    });
  }

  recordChildProcessGone(details: {
    reason?: string;
    exitCode?: number;
    name?: string;
  }): void {
    this.write({
      processType: "unknown",
      crashType: "child-process-gone",
      message: `child-process gone: ${details.name ?? ""} ${
        details.reason ?? "unknown"
      }`.trim(),
      reason: details.reason,
      exitCode: details.exitCode ?? undefined,
    });
  }

  recordGpuProcessCrashed(killed: boolean): void {
    this.write({
      processType: "gpu",
      crashType: "gpu-process-crashed",
      message: `gpu-process-crashed (killed=${killed})`,
    });
  }

  recordWorkerExit(info: WorkerExitInfo): void {
    this.write({
      processType: "worker",
      crashType: "worker-exit",
      message: `worker ${info.workerType} exited code=${
        info.code ?? "null"
      } signal=${info.signal ?? "null"}`,
      workerType: info.workerType,
      taskId: info.taskId,
      exitCode: info.code ?? undefined,
      signal: info.signal ?? undefined,
    });
  }

  recordUncleanShutdown(previousSessionId?: string): string {
    return this.write({
      processType: "main",
      crashType: "unclean-shutdown",
      message: previousSessionId
        ? `unclean shutdown of session ${previousSessionId}`
        : "unclean shutdown detected",
    });
  }

  installProcessHandlers(proc: NodeJS.Process): void {
    proc.on("uncaughtException", (err: Error) =>
      this.recordUncaughtException(err)
    );
    proc.on("unhandledRejection", (reason: unknown) =>
      this.recordUnhandledRejection(reason)
    );
  }

  installAppHandlers(app: ElectronAppLike | undefined): void {
    if (!app) return;
    app.on("render-process-gone", (_e, _wc, details) =>
      this.recordRenderProcessGone(details)
    );
    app.on("child-process-gone", (_e, details) =>
      this.recordChildProcessGone(details)
    );
    app.on("gpu-process-crashed", (_e, killed) =>
      this.recordGpuProcessCrashed(killed)
    );
  }

  private write(partial: {
    processType: CrashRecord["processType"];
    crashType: CrashRecord["crashType"];
    message: string;
    stack?: string;
    reason?: string;
    exitCode?: number;
    signal?: string;
    feature?: string;
    taskId?: string;
    workerType?: string;
  }): string {
    const rec: CrashRecord = {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      crashId: randomUUID(),
      sessionId: this.cfg.sessionId,
      installId: this.cfg.installId,
      appVersion: this.cfg.appVersion,
      platform: this.cfg.platform as CrashRecord["platform"],
      arch: this.cfg.arch,
      breadcrumbs: this.buffer.getBreadcrumbs(),
      ...partial,
    };
    CrashLogSink.write(rec);
    // Redact the breadcrumb message so tokens don't leak via the breadcrumb
    // buffer into the upload package (CrashLogSink already redacts on disk,
    // but breadcrumbs are embedded verbatim by DiagnosticReportBuilder).
    const redactedMsg = redactString(
      `${rec.crashType}: ${rec.message.slice(0, 200)}`
    );
    this.buffer.addBreadcrumb({
      timestamp: rec.timestamp,
      category: "crash",
      message: redactedMsg,
      level: "error",
    });
    return rec.crashId;
  }
}

/**
 * Renderer-error path: validate then persist as Error or Crash.
 * Called from the renderer-error IPC handler (Task 9) so renderer-side
 * uncaught exceptions and fatal errors reach the same sinks.
 */
export function recordRendererErrorPayload(
  svc: CrashReporterService,
  payload: {
    message: string;
    stack?: string;
    feature?: string;
    level?: "warn" | "error";
    fatal?: boolean;
  }
): void {
  if (payload.fatal) {
    svc.recordUncaughtException(new Error(payload.message), payload.feature);
  } else {
    void ErrorLogSink.write({
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      errorId: randomUUID(),
      sessionId: svc.sessionId,
      level: payload.level ?? "error",
      processType: "renderer",
      feature: payload.feature,
      message: payload.message,
      stack: payload.stack,
    });
  }
}
