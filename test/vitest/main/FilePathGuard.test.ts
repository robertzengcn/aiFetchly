/**
 * Unit tests for FilePathGuard — the centralized safety enforcement
 * for all AI file tools.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { FilePathGuard } from "@/service/FilePathGuard";

describe("FilePathGuard", () => {
  let guard: FilePathGuard;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fpg-test-"));
    guard = new FilePathGuard([tmpDir]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Valid path resolution
  // -------------------------------------------------------------------------

  describe("valid path resolution", () => {
    it("resolves a simple relative path inside workspace root", () => {
      const result = guard.validate("src/config/app.ts");
      expect(result.safe).toBe(true);
      expect(result.resolvedPath).toContain(tmpDir);
    });

    it("resolves a nested relative path", () => {
      const result = guard.validate("a/b/c/file.txt");
      expect(result.safe).toBe(true);
      expect(result.resolvedPath).toContain(tmpDir);
    });

    it("resolves an absolute path inside workspace root", () => {
      const absPath = path.join(tmpDir, "test.txt");
      const result = guard.validate(absPath);
      expect(result.safe).toBe(true);
      expect(result.resolvedPath).toBe(path.resolve(absPath));
    });
  });

  // -------------------------------------------------------------------------
  // Path traversal rejection
  // -------------------------------------------------------------------------

  describe("path traversal rejection", () => {
    it("rejects ../ traversal", () => {
      const result = guard.validate("../../etc/passwd");
      expect(result.safe).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("rejects multiple ../ segments", () => {
      const result = guard.validate("../../../tmp/evil");
      expect(result.safe).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("rejects mixed traversal", () => {
      const result = guard.validate("foo/../../bar/../../etc/shadow");
      expect(result.safe).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Absolute path outside root rejection
  // -------------------------------------------------------------------------

  describe("absolute path outside root rejection", () => {
    it("rejects /etc/passwd", () => {
      const result = guard.validate("/etc/passwd");
      expect(result.safe).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("rejects absolute path to a different root", () => {
      const result = guard.validate("/tmp/completely/outside");
      expect(result.safe).toBe(false);
    });

    it("rejects Windows-style absolute path (only on Windows)", () => {
      // On Linux, C:\... is treated as a relative path (valid filename),
      // so this test only asserts on Windows where it would be absolute.
      const result = guard.validate("C:\\Windows\\System32\\config");
      if (process.platform === "win32") {
        expect(result.safe).toBe(false);
      } else {
        // On non-Windows, the path resolves inside the workspace root
        // (it's just a weird relative path), so it passes root jail.
        expect(result.safe).toBe(true);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Null byte and malformed character rejection
  // -------------------------------------------------------------------------

  describe("null byte and malformed character rejection", () => {
    it("rejects null bytes in path", () => {
      const result = guard.validate("file\0.txt");
      expect(result.safe).toBe(false);
      expect(result.error).toContain("null");
    });

    it("rejects null bytes in the middle", () => {
      const result = guard.validate("safe/path\0/../../etc/passwd");
      expect(result.safe).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Symlink escape rejection
  // -------------------------------------------------------------------------

  describe("symlink escape rejection", () => {
    it("rejects symlink pointing outside root", () => {
      const linkPath = path.join(tmpDir, "escape-link");
      fs.symlinkSync(os.tmpdir(), linkPath);

      const result = guard.validate("escape-link");
      expect(result.safe).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("allows symlink pointing inside root", () => {
      const targetDir = path.join(tmpDir, "target");
      fs.mkdirSync(targetDir);
      const linkPath = path.join(tmpDir, "inner-link");
      fs.symlinkSync(targetDir, linkPath);

      const result = guard.validate("inner-link/file.txt");
      expect(result.safe).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Deny-list enforcement
  // -------------------------------------------------------------------------

  describe("deny-list enforcement", () => {
    it("rejects .git/config", () => {
      const result = guard.validate(".git/config");
      expect(result.safe).toBe(false);
      expect(result.error).toContain("denied");
    });

    it("rejects nested .git path", () => {
      const result = guard.validate("project/.git/HEAD");
      expect(result.safe).toBe(false);
    });

    it("rejects .pem files", () => {
      const result = guard.validate("certs/server.pem");
      expect(result.safe).toBe(false);
    });

    it("rejects .key files", () => {
      const result = guard.validate("ssh/id_rsa.key");
      expect(result.safe).toBe(false);
    });

    it("rejects .env files", () => {
      const result = guard.validate(".env");
      expect(result.safe).toBe(false);
    });

    it("rejects .env.production", () => {
      const result = guard.validate(".env.production");
      expect(result.safe).toBe(false);
    });

    it("rejects credentials files", () => {
      const result = guard.validate("credentials.json");
      expect(result.safe).toBe(false);
    });

    it("allows normal source files", () => {
      const result = guard.validate("src/config/app.ts");
      expect(result.safe).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Multiple workspace roots
  // -------------------------------------------------------------------------

  describe("multiple workspace roots", () => {
    it("accepts paths in any configured root", () => {
      const secondTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fpg-test2-"));
      try {
        const multiGuard = new FilePathGuard([tmpDir, secondTmpDir]);

        const result1 = multiGuard.validate("file.txt");
        const absPath2 = path.join(secondTmpDir, "other.txt");
        const result2 = multiGuard.validate(absPath2);

        // Both should be safe (resolved to respective roots)
        expect(result1.safe).toBe(true);
        expect(result2.safe).toBe(true);
      } finally {
        fs.rmSync(secondTmpDir, { recursive: true, force: true });
      }
    });

    it("rejects paths outside all roots", () => {
      const multiGuard = new FilePathGuard([tmpDir]);
      const result = multiGuard.validate("/completely/outside/path.txt");
      expect(result.safe).toBe(false);
    });
  });
});
