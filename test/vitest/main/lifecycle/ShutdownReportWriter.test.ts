import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { appendShutdownReport } from "@/main-process/lifecycle/ShutdownReportWriter";
import type { ShutdownReport } from "@/main-process/lifecycle/ShutdownCoordinator";
import { __setDiagnosticsDirForTests } from "@/modules/diagnostics/DiagnosticPaths";

/** Report-writer tests (FR-09/AC-15): JSONL persistence + bounded retention. */

function sampleReport(clean: boolean): ShutdownReport {
  return {
    attemptId: `att-${Math.random().toString(36).slice(2, 8)}`,
    reason: "tray",
    intent: "quit",
    totalDurationMs: 123,
    phaseTimings: [],
    participantOutcomes: [],
    forcedTerminationCount: 0,
    verificationFailures: [],
    deadlineExpired: !clean,
    clean,
  };
}

describe("appendShutdownReport", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-shutdown-report-"));
    __setDiagnosticsDirForTests(dir);
  });

  afterEach(() => {
    __setDiagnosticsDirForTests("");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("appends one JSON line per report", () => {
    appendShutdownReport(sampleReport(true));
    appendShutdownReport(sampleReport(false));
    const file = path.join(dir, "shutdown-reports.jsonl");
    const lines = fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(2);
    const parsed = JSON.parse(lines[1]!) as ShutdownReport & {
      recordedAt: string;
    };
    expect(parsed.clean).toBe(false);
    expect(typeof parsed.recordedAt).toBe("string");
  });

  it("trims to the newest 200 reports", () => {
    for (let i = 0; i < 205; i += 1) {
      appendShutdownReport(sampleReport(true));
    }
    const file = path.join(dir, "shutdown-reports.jsonl");
    const lines = fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0);
    expect(lines.length).toBe(200);
  });

  it("never throws when the diagnostics dir is unwritable", () => {
    __setDiagnosticsDirForTests(path.join(dir, "no", "such", "deep", "path"));
    // mkdirSync recursive creates it — point INSIDE a FILE instead.
    const blocker = path.join(dir, "blocker");
    fs.writeFileSync(blocker, "x");
    __setDiagnosticsDirForTests(path.join(blocker, "child"));
    expect(() => appendShutdownReport(sampleReport(true))).not.toThrow();
  });
});
