/**
 * Integration tests for AI file tools — full pipeline validation.
 *
 * Tests the SkillRegistry → ToolExecutor → FileToolService dispatch chain
 * to verify the complete integration works end-to-end.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ToolExecutor } from "@/service/ToolExecutor";
import { SkillRegistry } from "@/config/skillsRegistry";

const CONVERSATION_ID = "test-conv-001";

describe("File Tool Integration", () => {
  let tmpDir: string;

  beforeEach(() => {
    // Use a temp dir under process.cwd() so it's within the default
    // workspace root used by FileToolService in test environments.
    tmpDir = fs.mkdtempSync(path.join(process.cwd(), ".fts-integ-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // ToolExecutor dispatch chain
  // ---------------------------------------------------------------------------

  describe("ToolExecutor → FileToolService dispatch", () => {
    it("file_read returns file content through ToolExecutor", async () => {
      fs.writeFileSync(path.join(tmpDir, "test.txt"), "hello integration");

      const result = await ToolExecutor.execute(
        "file_read",
        { path: path.join(tmpDir, "test.txt") },
        CONVERSATION_ID
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("hello integration");
    });

    it("glob_files finds files through ToolExecutor", async () => {
      fs.writeFileSync(path.join(tmpDir, "a.ts"), "");
      fs.writeFileSync(path.join(tmpDir, "b.ts"), "");

      const result = await ToolExecutor.execute(
        "glob_files",
        { pattern: "**/*.ts", cwd: tmpDir },
        CONVERSATION_ID
      );

      expect(result.success).toBe(true);
      expect(result.total).toBe(2);
    });

    it("grep_files searches content through ToolExecutor", async () => {
      fs.writeFileSync(path.join(tmpDir, "search.txt"), "findme\nother");

      const result = await ToolExecutor.execute(
        "grep_files",
        { pattern: "findme", path: tmpDir },
        CONVERSATION_ID
      );

      expect(result.success).toBe(true);
      expect(result.total).toBe(1);
    });

    it("file_edit replaces content through ToolExecutor", async () => {
      const filePath = path.join(tmpDir, "edit.txt");
      fs.writeFileSync(filePath, "old text");

      const result = await ToolExecutor.execute(
        "file_edit",
        { path: filePath, old_string: "old text", new_string: "new text" },
        CONVERSATION_ID
      );

      expect(result.success).toBe(true);
      expect(result.replacements).toBe(1);
      expect(fs.readFileSync(filePath, "utf-8")).toBe("new text");
    });

    it("file_write creates file through ToolExecutor", async () => {
      const filePath = path.join(tmpDir, "created.txt");

      const result = await ToolExecutor.execute(
        "file_write",
        { path: filePath, content: "created content", mode: "create" },
        CONVERSATION_ID
      );

      expect(result.success).toBe(true);
      expect(fs.readFileSync(filePath, "utf-8")).toBe("created content");
    });
  });

  // ---------------------------------------------------------------------------
  // SkillRegistry integration
  // ---------------------------------------------------------------------------

  describe("SkillRegistry contains all file tools", () => {
    const fileTools = [
      "file_read",
      "file_write",
      "file_edit",
      "glob_files",
      "grep_files",
    ];

    it("all file tools are discoverable in registry", () => {
      for (const name of fileTools) {
        expect(SkillRegistry.isRegistered(name)).toBe(true);
      }
    });

    it("file tools are included in getAllToolFunctions output", async () => {
      const functions = await SkillRegistry.getAllToolFunctions();
      const names = functions.map((f) => f.name);

      for (const name of fileTools) {
        expect(names).toContain(name);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Rate limiting
  // ---------------------------------------------------------------------------

  describe("Rate limiting is configured", () => {
    it("file tools do not crash on rapid sequential execution", async () => {
      // Execute multiple reads rapidly
      const filePath = path.join(tmpDir, "rapid.txt");
      fs.writeFileSync(filePath, "rapid content");

      const results = await Promise.all([
        ToolExecutor.execute("file_read", { path: filePath }, CONVERSATION_ID),
        ToolExecutor.execute("file_read", { path: filePath }, CONVERSATION_ID),
        ToolExecutor.execute("file_read", { path: filePath }, CONVERSATION_ID),
      ]);

      for (const result of results) {
        expect(result.success).toBe(true);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Error handling across pipeline
  // ---------------------------------------------------------------------------

  describe("Error handling across pipeline", () => {
    it("unknown file tool returns error through ToolExecutor", async () => {
      const result = await ToolExecutor.execute(
        "file_unknown",
        {},
        CONVERSATION_ID
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown");
    });

    it("file_read returns error for non-existent file", async () => {
      const result = await ToolExecutor.execute(
        "file_read",
        { path: path.join(tmpDir, "nonexistent.txt") },
        CONVERSATION_ID
      );

      expect(result.success).toBe(false);
    });
  });
});
