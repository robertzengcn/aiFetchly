"use strict";
import { describe, test, expect, vi } from "vitest";

// Mock Token (used by SkillPermissionService which may be imported transitively)
vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: vi.fn(() => ""),
    setValue: vi.fn(),
  })),
}));

// Mock ToolExecutor (used by skillsRegistry at module load time)
vi.mock("@/service/ToolExecutor", () => ({
  ToolExecutor: {
    execute: vi.fn().mockResolvedValue({ results: [] }),
  },
}));

vi.mock("@/service/MCPToolService", () => ({
  MCPToolService: vi.fn().mockImplementation(() => ({
    getEnabledMCPToolsAsFunctions: vi.fn().mockResolvedValue([]),
  })),
}));

import { SandboxedSkillExecutor } from "@/service/SandboxedSkillExecutor";

const mockContext = {
  conversationId: "test-conv",
  toolCallId: "test-call",
};

describe("SandboxedSkillExecutor", () => {
  describe("basic execution", () => {
    test("should execute simple code and return result", async () => {
      const result = await SandboxedSkillExecutor.execute(
        `setResult({ answer: args.x + args.y })`,
        { x: 3, y: 4 },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.result.answer).toBe(7);
    });

    test("should pass args correctly", async () => {
      const result = await SandboxedSkillExecutor.execute(
        `setResult({ name: args.name })`,
        { name: "test" },
        mockContext
      );

      expect(result.result.name).toBe("test");
    });

    test("should capture logs", async () => {
      const result = await SandboxedSkillExecutor.execute(
        `log("hello"); log("world"); setResult({ done: true })`,
        {},
        mockContext
      );

      expect(result.logs).toContain("hello");
      expect(result.logs).toContain("world");
      expect(result.success).toBe(true);
    });
  });

  describe("security - blocked APIs", () => {
    test("should block process access", async () => {
      const result = await SandboxedSkillExecutor.execute(
        `setResult({ env: process.env })`,
        {},
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.result).toHaveProperty("error");
    });

    test("should block require access", async () => {
      const result = await SandboxedSkillExecutor.execute(
        `setResult({ fs: require('fs') })`,
        {},
        mockContext
      );

      expect(result.success).toBe(false);
    });

    test("should not have access to Node.js globals", async () => {
      const result = await SandboxedSkillExecutor.execute(
        `setResult({ hasProcess: typeof process, hasRequire: typeof require, hasBuffer: typeof Buffer })`,
        {},
        mockContext
      );

      // All Node.js globals should be undefined inside the sandbox
      expect(result.result.hasProcess).toBe("undefined");
      expect(result.result.hasRequire).toBe("undefined");
      expect(result.result.hasBuffer).toBe("undefined");
    });

    test("should handle code that throws", async () => {
      const result = await SandboxedSkillExecutor.execute(
        `throw new Error("intentional error")`,
        {},
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.result).toHaveProperty("error");
      expect((result.result as { error: string }).error).toContain(
        "intentional error"
      );
    });
  });

  describe("error handling", () => {
    test("should handle missing setResult call gracefully", async () => {
      const result = await SandboxedSkillExecutor.execute(
        `// does nothing`,
        {},
        mockContext
      );

      // Should timeout and return error
      expect(result.success).toBe(false);
    }, 35_000);

    test("should handle syntax errors", async () => {
      const result = await SandboxedSkillExecutor.execute(
        `this is not valid javascript {{{`,
        {},
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.result).toHaveProperty("error");
    });

    test("should return structured error from setResult call", async () => {
      const result = await SandboxedSkillExecutor.execute(
        `setResult({ success: false, error: "custom error" })`,
        {},
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.result.error).toBe("custom error");
    });
  });

  describe("data isolation", () => {
    test("should not allow args mutation to affect original", async () => {
      const originalArgs = { data: [1, 2, 3] };
      await SandboxedSkillExecutor.execute(
        `args.data.push(4); setResult({ done: true })`,
        originalArgs,
        mockContext
      );

      // Original should be unchanged
      expect(originalArgs.data).toEqual([1, 2, 3]);
    });
  });
});
