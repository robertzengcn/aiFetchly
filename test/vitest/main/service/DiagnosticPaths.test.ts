"use strict";
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  getDiagnosticsDir,
  ensureDiagnosticsDirs,
  getStartupMarkerPath,
  __setDiagnosticsDirForTests,
} from "@/modules/diagnostics/DiagnosticPaths";

describe("DiagnosticPaths", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "diag-"));
    process.env.AIFETCHLY_DIAGNOSTICS_DIR = tmp;
    __setDiagnosticsDirForTests("");
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    delete process.env.AIFETCHLY_DIAGNOSTICS_DIR;
  });

  test("getDiagnosticsDir honours override env", () => {
    expect(getDiagnosticsDir()).toBe(tmp);
  });

  test("ensureDiagnosticsDirs creates subdirs", () => {
    ensureDiagnosticsDirs();
    expect(fs.existsSync(path.join(tmp, "native-dumps"))).toBe(true);
  });

  test("getStartupMarkerPath lives under diagnostics dir", () => {
    expect(getStartupMarkerPath()).toBe(path.join(tmp, ".startup-marker"));
  });
});
