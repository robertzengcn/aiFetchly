/**
 * Unit tests for FileToolService — core execution logic for AI file tools.
 *
 * Covers file_read, glob_files, and grep_files (US1 read tools).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { FileToolService } from "@/service/FileToolService";

describe("FileToolService", () => {
  let service: FileToolService;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fts-test-"));
    // Create service with overridden workspace root to our tmpDir
    service = new FileToolService([tmpDir]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // file_read (T007)
  // ---------------------------------------------------------------------------

  describe("file_read", () => {
    it("reads text content with line numbers", async () => {
      const filePath = path.join(tmpDir, "hello.txt");
      fs.writeFileSync(filePath, "line1\nline2\nline3");

      const result = await service.execute("file_read", {
        path: "hello.txt",
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain("1: line1");
      expect(result.content).toContain("2: line2");
      expect(result.content).toContain("3: line3");
      expect(result.totalLines).toBe(3);
      expect(result.truncated).toBe(false);
    });

    it("respects offset and limit parameters", async () => {
      const filePath = path.join(tmpDir, "multi.txt");
      fs.writeFileSync(filePath, "a\nb\nc\nd\ne");

      const result = await service.execute("file_read", {
        path: "multi.txt",
        offset: 2,
        limit: 2,
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain("2: b");
      expect(result.content).toContain("3: c");
      expect(result.content).not.toContain("1: a");
      expect(result.content).not.toContain("4: d");
    });

    it("returns truncated=true when reading partial file", async () => {
      const filePath = path.join(tmpDir, "long.txt");
      const lines = Array.from({ length: 100 }, (_, i) => `line${i + 1}`);
      fs.writeFileSync(filePath, lines.join("\n"));

      const result = await service.execute("file_read", {
        path: "long.txt",
        limit: 10,
      });

      expect(result.success).toBe(true);
      expect(result.truncated).toBe(true);
      expect(result.linesShown).toBe(10);
      expect(result.totalLines).toBe(100);
    });

    it("detects binary files and returns metadata", async () => {
      // Write a small binary file (PNG header)
      const filePath = path.join(tmpDir, "image.png");
      const pngHeader = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
      ]);
      fs.writeFileSync(filePath, pngHeader);

      const result = await service.execute("file_read", {
        path: "image.png",
      });

      expect(result.success).toBe(true);
      expect(result.isBinary).toBe(true);
      expect(
        (result.binaryMetadata as Record<string, unknown> | undefined)?.size
      ).toBe(pngHeader.length);
    });

    it("returns error for non-existent file", async () => {
      const result = await service.execute("file_read", {
        path: "nonexistent.txt",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("rejects path traversal attempts", async () => {
      const result = await service.execute("file_read", {
        path: "../../etc/passwd",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("rejects deny-listed paths (.env)", async () => {
      const result = await service.execute("file_read", {
        path: ".env",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("denied");
    });

    it("handles offset beyond file length gracefully", async () => {
      const filePath = path.join(tmpDir, "short.txt");
      fs.writeFileSync(filePath, "only line");

      const result = await service.execute("file_read", {
        path: "short.txt",
        offset: 999,
      });

      expect(result.success).toBe(true);
      expect(result.content).toBe("");
      expect(result.linesShown).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // glob_files (T008)
  // ---------------------------------------------------------------------------

  describe("glob_files", () => {
    it("finds files matching a pattern", async () => {
      fs.writeFileSync(path.join(tmpDir, "a.ts"), "");
      fs.writeFileSync(path.join(tmpDir, "b.ts"), "");
      fs.writeFileSync(path.join(tmpDir, "c.js"), "");

      const result = await service.execute("glob_files", {
        pattern: "**/*.ts",
      });

      expect(result.success).toBe(true);
      expect(result.matches).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it("applies default ignore patterns", async () => {
      const nodeModules = path.join(tmpDir, "node_modules", "pkg");
      fs.mkdirSync(nodeModules, { recursive: true });
      fs.writeFileSync(path.join(nodeModules, "index.js"), "");
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "main.ts"), "");

      const result = await service.execute("glob_files", {
        pattern: "**/*",
      });

      expect(result.success).toBe(true);
      const matches = result.matches as string[];
      // node_modules should be ignored
      expect(matches.every((m: string) => !m.includes("node_modules"))).toBe(
        true
      );
    });

    it("respects head_limit and sets truncated flag", async () => {
      // Create more files than head_limit
      for (let i = 0; i < 10; i++) {
        fs.writeFileSync(path.join(tmpDir, `file${i}.txt`), "");
      }

      const result = await service.execute("glob_files", {
        pattern: "**/*.txt",
        head_limit: 3,
      });

      expect(result.success).toBe(true);
      expect((result.matches as string[]).length).toBeLessThanOrEqual(3);
      expect(result.total).toBe(10);
      expect(result.truncated).toBe(true);
    });

    it("supports cwd option", async () => {
      const subDir = path.join(tmpDir, "subproject");
      fs.mkdirSync(subDir);
      fs.writeFileSync(path.join(subDir, "readme.md"), "");

      const result = await service.execute("glob_files", {
        pattern: "*.md",
        cwd: "subproject",
      });

      expect(result.success).toBe(true);
      expect(result.matches).toHaveLength(1);
    });

    it("returns empty matches for non-matching pattern", async () => {
      fs.writeFileSync(path.join(tmpDir, "real.txt"), "");

      const result = await service.execute("glob_files", {
        pattern: "**/*.xyz",
      });

      expect(result.success).toBe(true);
      expect(result.matches).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it("rejects cwd outside workspace root", async () => {
      const result = await service.execute("glob_files", {
        pattern: "**/*",
        cwd: "/etc",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // grep_files (T009)
  // ---------------------------------------------------------------------------

  describe("grep_files", () => {
    it("returns content matches with line numbers", async () => {
      fs.writeFileSync(
        path.join(tmpDir, "code.ts"),
        "const x = 1;\nconst y = 2;\nconst z = x + y;"
      );

      const result = await service.execute("grep_files", {
        pattern: "const",
      });

      expect(result.success).toBe(true);
      expect(result.outputMode).toBe("content");
      const matches = result.matches as Array<{
        file: string;
        line: number;
        content: string;
      }>;
      expect(matches.length).toBeGreaterThanOrEqual(3);
      // Verify line numbers are correct
      expect(matches[0]?.line).toBe(1);
      expect(matches[1]?.line).toBe(2);
      expect(matches[2]?.line).toBe(3);
    });

    it("supports files_with_matches output mode", async () => {
      fs.writeFileSync(path.join(tmpDir, "a.ts"), "import React from 'react';");
      fs.writeFileSync(path.join(tmpDir, "b.ts"), "import Vue from 'vue';");

      const result = await service.execute("grep_files", {
        pattern: "React",
        output_mode: "files_with_matches",
      });

      expect(result.success).toBe(true);
      const fileMatches = result.matches as string[];
      expect(fileMatches).toContain("a.ts");
      expect(fileMatches).not.toContain("b.ts");
    });

    it("supports count output mode", async () => {
      fs.writeFileSync(path.join(tmpDir, "count.txt"), "foo\nbar\nfoo\nfoo");

      const result = await service.execute("grep_files", {
        pattern: "foo",
        output_mode: "count",
      });

      expect(result.success).toBe(true);
      const countEntries = result.matches as Array<{
        file: string;
        count: number;
      }>;
      expect(countEntries).toHaveLength(1);
      expect(countEntries[0]?.count).toBe(3);
    });

    it("provides context lines when requested", async () => {
      fs.writeFileSync(
        path.join(tmpDir, "ctx.txt"),
        "line1\nline2\nTARGET\nline4\nline5"
      );

      const result = await service.execute("grep_files", {
        pattern: "TARGET",
        context_before: 1,
        context_after: 1,
      });

      expect(result.success).toBe(true);
      const matches = result.matches as Array<{
        file: string;
        line: number;
        content: string;
        contextBefore?: string[];
        contextAfter?: string[];
      }>;
      expect(matches).toHaveLength(1);
      expect(matches[0]?.contextBefore).toEqual(["line2"]);
      expect(matches[0]?.contextAfter).toEqual(["line4"]);
    });

    it("supports case-insensitive search", async () => {
      fs.writeFileSync(path.join(tmpDir, "case.txt"), "Hello World");

      const result = await service.execute("grep_files", {
        pattern: "hello",
        case_insensitive: true,
      });

      expect(result.success).toBe(true);
      const matches = result.matches as Array<{ content: string }>;
      expect(matches).toHaveLength(1);
      expect(matches[0]?.content).toContain("Hello World");
    });

    it("returns error for invalid regex", async () => {
      const result = await service.execute("grep_files", {
        pattern: "[invalid",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid regex");
    });

    it("respects head_limit truncation", async () => {
      // Create a file with many matches
      const lines = Array.from({ length: 20 }, (_, i) => `match line ${i}`);
      fs.writeFileSync(path.join(tmpDir, "many.txt"), lines.join("\n"));

      const result = await service.execute("grep_files", {
        pattern: "match",
        head_limit: 5,
      });

      expect(result.success).toBe(true);
      expect(result.truncated).toBe(true);
      expect(result.total).toBe(20);
      const matches = result.matches as unknown[];
      expect(matches.length).toBeLessThanOrEqual(5);
    });

    it("rejects path outside workspace root", async () => {
      const result = await service.execute("grep_files", {
        pattern: "something",
        path: "/etc",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("skips binary files", async () => {
      // Write a binary file
      fs.writeFileSync(
        path.join(tmpDir, "data.bin"),
        Buffer.from([0x00, 0x01, 0x02])
      );
      fs.writeFileSync(path.join(tmpDir, "text.txt"), "findme here");

      const result = await service.execute("grep_files", {
        pattern: "findme",
      });

      expect(result.success).toBe(true);
      const matches = result.matches as Array<{ file: string }>;
      // Should only find in text.txt, not in binary
      const fileNames = matches.map((m) => m.file);
      expect(fileNames).toContain("text.txt");
      expect(fileNames).not.toContain("data.bin");
    });
  });

  // ---------------------------------------------------------------------------
  // Unknown tool dispatch
  // ---------------------------------------------------------------------------

  describe("dispatch", () => {
    it("returns error for unknown tool name", async () => {
      const result = await service.execute("unknown_tool", {});

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown file tool");
    });
  });
});
