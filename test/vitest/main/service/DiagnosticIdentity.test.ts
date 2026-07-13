"use strict";
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  newSessionId,
  getOrCreateInstallId,
} from "@/modules/diagnostics/DiagnosticIdentity";
import { __setDiagnosticsDirForTests } from "@/modules/diagnostics/DiagnosticPaths";

describe("DiagnosticIdentity", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "diag-id-"));
    process.env.AIFETCHLY_DIAGNOSTICS_DIR = tmp;
    __setDiagnosticsDirForTests("");
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    delete process.env.AIFETCHLY_DIAGNOSTICS_DIR;
  });

  test("newSessionId returns unique RFC4122-ish strings", () => {
    const a = newSessionId();
    const b = newSessionId();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(16);
  });

  test("getOrCreateInstallId is stable across calls", () => {
    const a = getOrCreateInstallId();
    const b = getOrCreateInstallId();
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(8);
  });
});
