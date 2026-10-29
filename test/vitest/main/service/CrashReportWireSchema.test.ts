"use strict";
import { describe, test, expect } from "vitest";
import {
  projectToWirePayload,
  crashReportWireSchema,
} from "@/modules/diagnostics/CrashReportWireSchema";
import type { DiagnosticReportPackage } from "@/modules/diagnostics/DiagnosticSchemas";

/**
 * The marketing backend (marketing/services/crashreport/schema.go) decodes the
 * crash-report body with json.DisallowUnknownFields() and a strict Validate().
 * These tests guard the client-side projection that maps the rich internal
 * DiagnosticReportPackage down to that slim wire contract.
 */
function richPkg(): DiagnosticReportPackage {
  return {
    schemaVersion: 1,
    appVersion: "1.0.0",
    platform: "linux",
    arch: "x64",
    installId: "i1",
    sessionId: "s1",
    crash: {
      schemaVersion: 1,
      timestamp: "2026-07-03T00:00:00.000Z",
      crashId: "c1",
      sessionId: "s1",
      installId: "i1",
      appVersion: "1.0.0",
      platform: "linux",
      arch: "x64",
      processType: "unknown",
      crashType: "child-process-gone",
      feature: "scraper",
      taskId: "t-123",
      workerType: "yellowPages",
      message: "boom",
      exitCode: 11,
      signal: "SIGSEGV",
      breadcrumbs: [],
    },
    recentErrors: Array.from({ length: 60 }, (_, i) => ({
      schemaVersion: 1 as const,
      timestamp: "2026-07-03T00:00:00.000Z",
      errorId: `e${i}`,
      sessionId: "s1",
      level: "error" as const,
      processType: "worker" as const,
      feature: "feat",
      message: `err ${i}`,
      metadata: { k: "v" },
    })),
    breadcrumbs: Array.from({ length: 150 }, (_, i) => ({
      timestamp: "2026-07-03T00:00:00.000Z",
      category: "cat",
      message: "b".repeat(2048) + `-${i}`,
      level: "info" as const,
    })),
  };
}

describe("projectToWirePayload", () => {
  test("crash carries no rich-only fields (server uses DisallowUnknownFields)", () => {
    const wire = projectToWirePayload(richPkg());
    const allowedCrash = new Set([
      "timestamp",
      "processType",
      "crashType",
      "message",
      "stack",
      "reason",
      "severity",
    ]);
    for (const k of Object.keys(wire.crash)) {
      expect(allowedCrash.has(k)).toBe(true);
    }
    // none of the rich-only CrashRecord fields may leak through
    for (const forbidden of [
      "schemaVersion",
      "crashId",
      "sessionId",
      "installId",
      "appVersion",
      "platform",
      "arch",
      "feature",
      "taskId",
      "workerType",
      "exitCode",
      "signal",
      "breadcrumbs",
    ]) {
      expect(wire.crash).not.toHaveProperty(forbidden);
    }
    // the always-required server fields are present
    expect(wire.crash.processType).toBe("main");
    expect(wire.crash.crashType).toBe("child-process-gone");
  });

  test("top-level package keeps only server-allowed keys", () => {
    const wire = projectToWirePayload(richPkg());
    expect(Object.keys(wire).sort()).toEqual(
      [
        "appVersion",
        "arch",
        "breadcrumbs",
        "crash",
        "installId",
        "platform",
        "recentErrors",
        "schemaVersion",
        "sessionId",
      ].sort()
    );
  });

  test("mainLogTail is key-absent when the flag is off, capped when on", () => {
    const pkg = { ...richPkg(), mainLogTail: "t".repeat(40 * 1024) };

    // Flag off (default): the key must not exist at all, so a backend
    // without the field sees a byte-identical contract.
    delete process.env.AIFETCHLY_SEND_MAIN_LOG_TAIL;
    const offWire = projectToWirePayload(pkg);
    expect(offWire).not.toHaveProperty("mainLogTail");
    expect(Object.keys(offWire)).not.toContain("mainLogTail");

    // Flag on: present and capped to MAX_MAIN_LOG_TAIL.
    process.env.AIFETCHLY_SEND_MAIN_LOG_TAIL = "true";
    try {
      const onWire = projectToWirePayload(pkg);
      expect(onWire.mainLogTail).toBe("t".repeat(32 * 1024));

      // Flag on but no tail in the package: still key-absent.
      const noTail = projectToWirePayload(richPkg());
      expect(noTail).not.toHaveProperty("mainLogTail");
    } finally {
      delete process.env.AIFETCHLY_SEND_MAIN_LOG_TAIL;
    }
  });

  test("recentErrors carry no rich-only fields and are capped to 50", () => {
    const wire = projectToWirePayload(richPkg());
    expect(wire.recentErrors.length).toBe(50); // capped to server MaxRecentErrorEntries
    const allowedErr = new Set(["timestamp", "name", "message", "stack"]);
    for (const e of wire.recentErrors) {
      for (const k of Object.keys(e)) {
        expect(allowedErr.has(k)).toBe(true);
      }
      expect(e).not.toHaveProperty("errorId");
      expect(e).not.toHaveProperty("sessionId");
      expect(e).not.toHaveProperty("level");
      expect(e).not.toHaveProperty("processType");
      expect(e).not.toHaveProperty("feature");
      expect(e).not.toHaveProperty("metadata");
    }
    // most recent 50 preserved (err 10..59)
    expect(wire.recentErrors[0].message).toBe("err 10");
    expect(wire.recentErrors[49].message).toBe("err 59");
  });

  test("breadcrumbs are capped to 100, messages capped to 1024, no rich-only fields", () => {
    const wire = projectToWirePayload(richPkg());
    expect(wire.breadcrumbs.length).toBe(100);
    const allowedBc = new Set(["timestamp", "category", "message", "level"]);
    for (const b of wire.breadcrumbs) {
      expect(b.message.length).toBeLessThanOrEqual(1024);
      for (const k of Object.keys(b)) {
        expect(allowedBc.has(k)).toBe(true);
      }
    }
  });

  test('processType "unknown" is mapped to a server-valid value', () => {
    const wire = projectToWirePayload(richPkg());
    expect(wire.crash.processType).toBe("main");
  });

  test("crash.message is capped to 4096", () => {
    const pkg = richPkg();
    pkg.crash.message = "x".repeat(8 * 1024);
    const wire = projectToWirePayload(pkg);
    expect(wire.crash.message.length).toBe(4096);
  });

  test("output passes the wire schema (parse does not throw)", () => {
    const wire = projectToWirePayload(richPkg());
    expect(() => crashReportWireSchema.parse(wire)).not.toThrow();
  });

  test("does not mutate the input package", () => {
    const pkg = richPkg();
    const snapshot = JSON.parse(JSON.stringify(pkg)) as DiagnosticReportPackage;
    projectToWirePayload(pkg);
    expect(pkg).toEqual(snapshot);
    expect(pkg.crash.processType).toBe("unknown"); // unchanged
    expect(pkg.breadcrumbs.length).toBe(150); // unchanged
  });
});
