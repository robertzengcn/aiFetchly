"use strict";
import { describe, test, expect, vi, beforeEach } from "vitest";

// Mock ToolExecutor before importing modules that depend on it
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

// Mock Token (used by SkillPermissionService) — shared store across instances
const tokenStore: Record<string, string> = {};
vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: vi.fn((key: string) => tokenStore[key] || ""),
    setValue: vi.fn((key: string, value: string) => {
      tokenStore[key] = value;
    }),
  })),
}));

import { SkillExecutor } from "@/service/SkillExecutor";
import { ToolExecutor } from "@/service/ToolExecutor";
import { SkillPermissionService } from "@/service/SkillPermissionService";
import type { SkillExecutionContext } from "@/entityTypes/skillTypes";

const mockContext: SkillExecutionContext = {
  conversationId: "test-conv-123",
  toolCallId: "test-tool-call-456",
};

describe("SkillExecutor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear token store for permission tests
    for (const key of Object.keys(tokenStore)) {
      delete tokenStore[key];
    }
  });

  describe("execute - valid registered skill", () => {
    test("should auto-execute pure skills without permission", async () => {
      const result = await SkillExecutor.execute(
        "generate_keywords",
        { seed_keywords: ["test"] },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.tool_call_id).toBe("test-tool-call-456");
      expect(result.tool_name).toBe("generate_keywords");
      expect(result.execution_time_ms).toBeGreaterThanOrEqual(0);
    });

    test("should require permission for network skills", async () => {
      // No permission stored — should return needsPermissionPrompt
      const result = await SkillExecutor.execute(
        "scrape_urls_from_google",
        { query: "test", num_results: 5 },
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.result).toHaveProperty("needsPermissionPrompt", true);
    });

    test("should execute network skill after permission granted", async () => {
      // Grant permission first
      SkillPermissionService.grantPermission("scrape_urls_from_google", true);

      const result = await SkillExecutor.execute(
        "scrape_urls_from_google",
        { query: "test" },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(ToolExecutor.execute).toHaveBeenCalledWith(
        "scrape_urls_from_google",
        { query: "test" },
        "test-conv-123"
      );
    });
  });

  describe("execute - unknown skill", () => {
    test("should return error result for unknown skill", async () => {
      const result = await SkillExecutor.execute(
        "nonexistent_tool",
        {},
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.result).toHaveProperty("error");
      expect((result.result as { error: string }).error).toContain(
        "Unknown tool"
      );
    });
  });

  describe("execute - MCP tool fallback", () => {
    test("should delegate mcp_ prefixed tools to ToolExecutor", async () => {
      const result = await SkillExecutor.execute(
        "mcp_server1_some_tool",
        { param: "value" },
        mockContext
      );

      expect(ToolExecutor.execute).toHaveBeenCalledWith(
        "mcp_server1_some_tool",
        { param: "value" },
        "test-conv-123"
      );
      expect(result.success).toBe(true);
    });

    test("should return error when MCP tool execution fails", async () => {
      vi.mocked(ToolExecutor.execute).mockRejectedValueOnce(
        new Error("MCP connection failed")
      );

      const result = await SkillExecutor.execute(
        "mcp_server1_failing_tool",
        {},
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.result).toHaveProperty("error", "MCP connection failed");
    });
  });

  describe("execute - input sanitization", () => {
    test("should reject arguments containing API key patterns", async () => {
      const result = await SkillExecutor.execute(
        "generate_keywords",
        { seed_keywords: ["sk-1234567890abcdefghijklmnopqrstuv"] },
        mockContext
      );

      expect(result.success).toBe(false);
      expect((result.result as { error: string }).error).toContain(
        "sensitive value"
      );
    });

    test("should accept normal arguments", async () => {
      const result = await SkillExecutor.execute(
        "generate_keywords",
        { seed_keywords: ["cloud storage", "file sharing"] },
        mockContext
      );

      expect(result.success).toBe(true);
    });
  });

  describe("execute - error handling", () => {
    test("should catch ToolExecutor exceptions and return error result", async () => {
      SkillPermissionService.grantPermission("scrape_urls_from_google", true);
      vi.mocked(ToolExecutor.execute).mockRejectedValueOnce(
        new Error("Network timeout")
      );

      const result = await SkillExecutor.execute(
        "scrape_urls_from_google",
        { query: "test" },
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.result).toHaveProperty("error", "Network timeout");
    });
  });

  describe("isKnown", () => {
    test("should return true for registered built-in skill", () => {
      expect(SkillExecutor.isKnown("scrape_urls_from_google")).toBe(true);
    });

    test("should return true for MCP-prefixed tool", () => {
      expect(SkillExecutor.isKnown("mcp_server1_tool")).toBe(true);
    });

    test("should return false for unknown tool", () => {
      expect(SkillExecutor.isKnown("nonexistent_tool")).toBe(false);
    });
  });

  describe("validateArgs", () => {
    test("should reject sk- prefixed API keys", () => {
      const result = SkillExecutor.validateArgs({
        key: "sk-1234567890abcdefghijklmnopqrstuv",
      });
      expect(result.valid).toBe(false);
    });

    test("should reject password patterns", () => {
      const result = SkillExecutor.validateArgs({
        config: "password=secret123",
      });
      expect(result.valid).toBe(false);
    });

    test("should accept clean arguments", () => {
      const result = SkillExecutor.validateArgs({
        query: "test search",
        num_results: 10,
      });
      expect(result.valid).toBe(true);
    });
  });
});
