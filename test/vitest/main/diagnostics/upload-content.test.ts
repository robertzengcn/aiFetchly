"use strict";
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { log, Logger } from "@/modules/Logger";
import { CrashLogSink } from "@/modules/diagnostics/CrashLogSink";
import { ErrorLogSink } from "@/modules/diagnostics/ErrorLogSink";
import { __setDiagnosticsDirForTests } from "@/modules/diagnostics/DiagnosticPaths";
import { DiagnosticReportBuilder } from "@/modules/diagnostics/DiagnosticReportBuilder";
import { CrashReporterService } from "@/modules/diagnostics/CrashReporterService";
import { DiagnosticUploadClient } from "@/modules/diagnostics/DiagnosticUploadClient";
import type { HttpClientLike } from "@/modules/diagnostics/DiagnosticUploadClient";
import type { CrashReportWirePayload } from "@/modules/diagnostics/CrashReportWireSchema";
import type {
  DiagnosticBreadcrumb,
  ErrorRecord,
} from "@/modules/diagnostics/DiagnosticSchemas";

/**
 * End-to-end integration tests for the enriched crash upload (PRD acceptance
 * criteria 1-8): log.warn/log.error feed the buffers via the bridge, the
 * builder attaches a redacted main.log tail, and the upload client posts a
 * wire payload with non-empty recentErrors / breadcrumbs / mainLogTail while
 * staying under the backend's 256 KB body limit.
 */

interface CapturedRequest {
  url: string;
  body: unknown;
  config: { headers: Record<string, string>; timeout: number };
}

function todayFolder(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Append deterministic marker lines to today's real main.log location. */
function appendMainLogMarkers(lines: string[]): void {
  const logDir = Logger.getInstance().getLogDir();
  const dir = path.join(logDir, todayFolder());
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(
    path.join(dir, "main.log"),
    lines.join("\n") + "\n",
    "utf8"
  );
}

function rfc3339Now(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

describe("crash upload content (integration, AC 1-8)", () => {
  let tmp: string;
  let svc: CrashReporterService;
  let requests: CapturedRequest[];
  let http: HttpClientLike;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "diag-upload-"));
    __setDiagnosticsDirForTests(tmp);
    (ErrorLogSink as unknown as { resetForTests(): void }).resetForTests();

    svc = new CrashReporterService({
      sessionId: "sess-upload",
      installId: "inst-upload",
      appVersion: "1.0.0",
      platform: "linux",
      arch: "x64",
    });
    (
      globalThis as unknown as {
        __aifetchlyCrashReporter?: CrashReporterService;
      }
    ).__aifetchlyCrashReporter = svc;

    requests = [];
    http = {
      post: async (url, body, config) => {
        requests.push({ url, body, config });
        return {
          status: 200,
          data: { status: true, reportId: `rep-${requests.length}` },
        };
      },
    };
  });

  afterEach(() => {
    delete (
      globalThis as unknown as {
        __aifetchlyCrashReporter?: CrashReporterService;
      }
    ).__aifetchlyCrashReporter;
    (ErrorLogSink as unknown as { resetForTests(): void }).resetForTests();
    fs.rmSync(tmp, { recursive: true, force: true });
    __setDiagnosticsDirForTests("");
    delete process.env.AIFETCHLY_SEND_MAIN_LOG_TAIL;
  });

  function makeBuilder(): DiagnosticReportBuilder {
    return new DiagnosticReportBuilder({
      appVersion: "1.0.0",
      platform: "linux",
      arch: "x64",
      installId: "inst-upload",
      sessionId: "sess-upload",
      breadcrumbs: svc.getBreadcrumbs(),
      recentErrors: svc.getRecentErrors(),
    });
  }

  async function uploadLatestCrash(): Promise<CrashReportWirePayload> {
    const crash = CrashLogSink.readAll().at(-1);
    expect(crash).toBeDefined();
    const pkg = makeBuilder().buildUploadPackage(crash!.crashId);
    expect(pkg).not.toBeNull();
    const client = new DiagnosticUploadClient({
      endpoint: "https://backend.invalid/apis/api/crash-reports",
      http,
    });
    const result = await client.upload(pkg!);
    expect(result.reportId).not.toBeNull();
    return requests.at(-1)!.body as CrashReportWirePayload;
  }

  test("upload carries recentErrors, breadcrumbs, and mainLogTail (AC 1-4)", async () => {
    process.env.AIFETCHLY_SEND_MAIN_LOG_TAIL = "true";
    appendMainLogMarkers([
      "[error] mainlog-marker-error pre-crash context",
      "[warn] mainlog-marker-warn retrying",
    ]);

    // These flow through the Logger bridge into the real reporter buffers.
    log.error("upload-pre-crash-error");
    log.warn("upload-pre-crash-warn");

    svc.recordUncaughtException(new Error("upload integration crash"));
    const body = await uploadLatestCrash();

    // AC 1/3: recentErrors non-empty and contains the logged error.
    expect(body.recentErrors.length).toBeGreaterThanOrEqual(2);
    expect(
      body.recentErrors.some((e) =>
        e.message.includes("upload-pre-crash-error")
      )
    ).toBe(true);
    expect(
      body.recentErrors.some((e) => e.message.includes("upload-pre-crash-warn"))
    ).toBe(true);

    // AC 2/3: breadcrumbs non-empty with category "log" at both levels.
    expect(body.breadcrumbs.length).toBeGreaterThanOrEqual(2);
    expect(
      body.breadcrumbs.some((b) => b.category === "log" && b.level === "error")
    ).toBe(true);
    expect(
      body.breadcrumbs.some((b) => b.category === "log" && b.level === "warn")
    ).toBe(true);

    // AC 4: mainLogTail present with today's tail content.
    expect(body.mainLogTail).toBeDefined();
    expect(body.mainLogTail).toContain("mainlog-marker-error");
    expect(body.mainLogTail).toContain("mainlog-marker-warn");
    expect(body.mainLogTail!.length).toBeLessThanOrEqual(32 * 1024);

    // AC 8: total body stays under the backend's 256 KB default limit.
    expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(256 * 1024);
  });

  test("mainLogTail is omitted from the wire when the flag is off", async () => {
    delete process.env.AIFETCHLY_SEND_MAIN_LOG_TAIL;
    appendMainLogMarkers(["[error] flag-off-marker"]);

    log.error("flag-off-pre-crash");
    svc.recordUncaughtException(new Error("flag off crash"));
    const body = await uploadLatestCrash();

    expect(body.recentErrors.length).toBeGreaterThanOrEqual(1);
    expect(body.breadcrumbs.length).toBeGreaterThanOrEqual(1);
    expect(body.mainLogTail).toBeUndefined();
    // The key must not appear on the wire at all (DisallowUnknownFields).
    expect(JSON.stringify(body)).not.toContain("mainLogTail");
  });

  test("redaction survives the full pipeline (AC 5)", async () => {
    process.env.AIFETCHLY_SEND_MAIN_LOG_TAIL = "true";
    appendMainLogMarkers([
      "[error] leak-check Authorization: Bearer pipeline-secret",
    ]);

    log.error("failure Authorization: Bearer inline-secret-token");
    svc.recordUncaughtException(
      new Error("crash Authorization: Bearer crash-secret-token")
    );
    const body = await uploadLatestCrash();

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("inline-secret-token");
    expect(serialized).not.toContain("crash-secret-token");
    expect(serialized).not.toContain("pipeline-secret");
    expect(serialized).toContain("[REDACTED]");
  });

  test("AC-8 scenario: 50 errors + 100 breadcrumbs + 32 KB tail stays under 256 KB", async () => {
    process.env.AIFETCHLY_SEND_MAIN_LOG_TAIL = "true";

    // Realistic field sizes for the AC-8 scenario.
    const errors: ErrorRecord[] = Array.from({ length: 50 }, (_, i) => ({
      schemaVersion: 1 as const,
      timestamp: rfc3339Now(-i * 1000),
      errorId: `ac8-err-${i}`,
      sessionId: "sess-upload",
      level: "error" as const,
      processType: "main" as const,
      message: `ac8 error ${i} `.repeat(40),
      stack: "at frame\n".repeat(40),
    }));
    const crumbs: DiagnosticBreadcrumb[] = Array.from(
      { length: 100 },
      (_, i) => ({
        timestamp: rfc3339Now(-i * 500),
        category: "log",
        message: `ac8 breadcrumb ${i} `.repeat(20),
        level: "warn" as const,
      })
    );
    const filler = "y".repeat(160);
    appendMainLogMarkers(
      Array.from({ length: 200 }, (_, i) => `ac8-log-${i} ${filler}`)
    );

    svc.recordUncaughtException(new Error("ac8 crash"));
    const crash = CrashLogSink.readAll().at(-1)!;
    const pkg = new DiagnosticReportBuilder({
      appVersion: "1.0.0",
      platform: "linux",
      arch: "x64",
      installId: "inst-upload",
      sessionId: "sess-upload",
      breadcrumbs: crumbs,
      recentErrors: errors,
    }).buildUploadPackage(crash.crashId, { extended: false });
    expect(pkg).not.toBeNull();

    const client = new DiagnosticUploadClient({
      endpoint: "https://backend.invalid/apis/api/crash-reports",
      http,
    });
    const result = await client.upload(pkg!);
    expect(result.reportId).not.toBeNull();

    const body = requests.at(-1)!.body as CrashReportWirePayload;
    expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(256 * 1024);
    // The full scenario fits without trimming any dimension away.
    expect(body.recentErrors).toHaveLength(50);
    expect(body.breadcrumbs).toHaveLength(100);
    expect(body.mainLogTail).toBeDefined();
  });

  test("pathological package converges under 256 KB (trim loop reaches errors)", async () => {
    process.env.AIFETCHLY_SEND_MAIN_LOG_TAIL = "true";

    // 60 fat error records (~6 KB each) + 250 breadcrumbs (~1 KB each):
    // far above the wire caps and the 200 KB builder budget. The trim loop
    // must converge (drop all breadcrumbs, then halve errors) rather than
    // stalling on a floor of one breadcrumb.
    const fatErrors: ErrorRecord[] = Array.from({ length: 60 }, (_, i) => ({
      schemaVersion: 1 as const,
      timestamp: rfc3339Now(-i * 1000),
      errorId: `stress-err-${i}`,
      sessionId: "sess-upload",
      level: "error" as const,
      processType: "main" as const,
      message: "stress error ".repeat(300),
      stack: "at frame\n".repeat(300),
    }));
    const fatCrumbs: DiagnosticBreadcrumb[] = Array.from(
      { length: 250 },
      (_, i) => ({
        timestamp: rfc3339Now(-i * 500),
        category: "log",
        message: `stress breadcrumb ${i} `.repeat(40),
        level: "error" as const,
      })
    );

    svc.recordUncaughtException(new Error("stress crash"));
    const crash = CrashLogSink.readAll().at(-1)!;
    const pkg = new DiagnosticReportBuilder({
      appVersion: "1.0.0",
      platform: "linux",
      arch: "x64",
      installId: "inst-upload",
      sessionId: "sess-upload",
      breadcrumbs: fatCrumbs,
      recentErrors: fatErrors,
    }).buildUploadPackage(crash.crashId, { extended: false });
    expect(pkg).not.toBeNull();

    const client = new DiagnosticUploadClient({
      endpoint: "https://backend.invalid/apis/api/crash-reports",
      http,
    });
    const result = await client.upload(pkg!);
    expect(result.reportId).not.toBeNull();

    const body = requests.at(-1)!.body as CrashReportWirePayload;
    expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(256 * 1024);
    // Breadcrumbs are dropped first by design; the highest-signal field
    // (recentErrors) must survive rather than being starved by a stalled loop.
    expect(body.recentErrors.length).toBeGreaterThan(0);
  });
});
