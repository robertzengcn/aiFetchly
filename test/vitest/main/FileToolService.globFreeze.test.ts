/**
 * Regression tests for the Always Allow → glob_files UI freeze.
 *
 * After permission grant, glob/grep discovery runs on the Electron main
 * process. These tests pin the scan-cap and early-stop behaviour that keeps
 * the event loop responsive for broad patterns.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

vi.mock("@/config/fileToolConfig", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/config/fileToolConfig")
  >();
  return {
    ...actual,
    FILE_TOOL_SIZE_LIMITS: {
      ...actual.FILE_TOOL_SIZE_LIMITS,
      // Small ceiling so we can assert the hard scan cap without creating
      // thousands of files.
      maxGlobScanEntries: 8,
      defaultHeadLimit: 100,
    },
  };
});

import { FileToolService } from "@/service/FileToolService";
import { FilePathGuard } from "@/service/FilePathGuard";
import { FILE_TOOL_SIZE_LIMITS } from "@/config/fileToolConfig";

describe("FileToolService glob freeze guards", () => {
  let service: FileToolService;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "fts-freeze-"))
    );
    service = new FileToolService([tmpDir]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("exposes a finite maxGlobScanEntries ceiling", () => {
    expect(FILE_TOOL_SIZE_LIMITS.maxGlobScanEntries).toBe(8);
  });

  it("caps glob discovery when more files exist than maxGlobScanEntries", async () => {
    for (let i = 0; i < 25; i++) {
      fs.writeFileSync(path.join(tmpDir, `cap${i}.txt`), "");
    }

    // head_limit above the scan cap so early-stop does not hide the hard cap.
    const result = await service.execute("glob_files", {
      pattern: "**/*.txt",
      head_limit: 100,
    });

    expect(result.success).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.total).toBeLessThanOrEqual(
      FILE_TOOL_SIZE_LIMITS.maxGlobScanEntries
    );
    expect((result.matches as string[]).length).toBe(result.total);
  });

  it("caps grep discovery with the same scan ceiling", async () => {
    for (let i = 0; i < 20; i++) {
      fs.writeFileSync(path.join(tmpDir, `g${i}.txt`), `needle-${i}\n`);
    }

    const validateSpy = vi.spyOn(FilePathGuard.prototype, "validate");
    try {
      const result = await service.execute("grep_files", {
        pattern: "needle-",
        output_mode: "files_with_matches",
        head_limit: 100,
      });

      expect(result.success).toBe(true);
      // Discovery validates at most maxGlobScanEntries candidates.
      expect(validateSpy.mock.calls.length).toBeLessThanOrEqual(
        FILE_TOOL_SIZE_LIMITS.maxGlobScanEntries
      );
      expect((result.matches as string[]).length).toBeLessThanOrEqual(
        FILE_TOOL_SIZE_LIMITS.maxGlobScanEntries
      );
    } finally {
      validateSpy.mockRestore();
    }
  });
});

describe("FilePathGuard root realpath (macOS /var jail)", () => {
  it("accepts existing files when root is the non-realpathed tmp path", () => {
    // On macOS, mkdtemp under os.tmpdir() is often /var/... while realpath is
    // /private/var/.... Roots must be canonicalized or every existing file
    // looks outside the workspace after realpathSync in validate().
    const rawTmp = fs.mkdtempSync(path.join(os.tmpdir(), "fpg-raw-"));
    try {
      const guard = new FilePathGuard([rawTmp]);
      const filePath = path.join(rawTmp, "alive.txt");
      fs.writeFileSync(filePath, "ok");

      const result = guard.validate(filePath);
      expect(result.safe).toBe(true);
      expect(result.resolvedPath).toBe(fs.realpathSync(filePath));
    } finally {
      fs.rmSync(rawTmp, { recursive: true, force: true });
    }
  });
});
