"use strict";
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { ErrorLogSink } from "@/modules/diagnostics/ErrorLogSink";
import { __setDiagnosticsDirForTests } from "@/modules/diagnostics/DiagnosticPaths";
import type { ErrorRecord } from "@/modules/diagnostics/DiagnosticSchemas";

describe("ErrorLogSink", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "err-"));
    __setDiagnosticsDirForTests(tmp);
    (ErrorLogSink as unknown as { resetForTests(): void }).resetForTests();
  });

  afterEach(() => {
    (ErrorLogSink as unknown as { resetForTests(): void }).resetForTests();
    fs.rmSync(tmp, { recursive: true, force: true });
    __setDiagnosticsDirForTests("");
  });

  test("appends a JSON line with password redacted", async () => {
    const rec: ErrorRecord = {
      schemaVersion: 1,
      timestamp: "2026-07-03T00:00:00.000Z",
      errorId: "e1",
      sessionId: "s1",
      level: "error",
      processType: "main",
      message: "boom password=supersecret",
      metadata: { password: "p" },
    };
    await ErrorLogSink.write(rec);
    const file = path.join(tmp, "error.jsonl");
    const content = fs.readFileSync(file, "utf8").trim();
    expect(content).toContain('"password":"[REDACTED]"');
    expect(content).not.toContain("supersecret");
  });

  test("appends valid JSON that can be parsed back", async () => {
    const rec: ErrorRecord = {
      schemaVersion: 1,
      timestamp: "2026-07-03T00:00:00.000Z",
      errorId: "e2",
      sessionId: "s1",
      level: "warn",
      processType: "main",
      message: "something happened",
    };
    await ErrorLogSink.write(rec);
    const file = path.join(tmp, "error.jsonl");
    const content = fs.readFileSync(file, "utf8").trim();
    const parsed = JSON.parse(content) as ErrorRecord;
    expect(parsed.errorId).toBe("e2");
    expect(parsed.message).toBe("something happened");
  });

  test("does not throw on write failure", async () => {
    // Point to a path that cannot be created (under a file, not a directory).
    const blocker = path.join(tmp, "blocker");
    fs.writeFileSync(blocker, "x");
    __setDiagnosticsDirForTests(path.join(blocker, "sub"));
    const rec: ErrorRecord = {
      schemaVersion: 1,
      timestamp: "2026-07-03T00:00:00.000Z",
      errorId: "e3",
      sessionId: "s1",
      level: "error",
      processType: "main",
      message: "no throw",
    };
    await expect(ErrorLogSink.write(rec)).resolves.toBeUndefined();
  });

  test("redacts authorization tokens in message", async () => {
    const rec: ErrorRecord = {
      schemaVersion: 1,
      timestamp: "2026-07-03T00:00:00.000Z",
      errorId: "e4",
      sessionId: "s1",
      level: "error",
      processType: "main",
      message: "Authorization: Bearer my-secret-token",
    };
    await ErrorLogSink.write(rec);
    const file = path.join(tmp, "error.jsonl");
    const content = fs.readFileSync(file, "utf8").trim();
    expect(content).not.toContain("my-secret-token");
    expect(content).toContain("[REDACTED]");
  });
});
