"use strict";
import { describe, test, expect, vi, afterEach } from "vitest";

// Mock ToolExecutor before importing the registry (it's used at module load time)
vi.mock("@/service/ToolExecutor", () => ({
  ToolExecutor: {
    execute: vi.fn().mockResolvedValue({ results: [] }),
  },
}));

vi.mock("@/service/MCPToolService", () => ({
  MCPToolService: class {
    getEnabledMCPToolsAsFunctions = vi.fn().mockResolvedValue([]);
  },
}));

// The tool-result rollout flags are read live from the Token store. Mock the
// store so the catalog-honesty tests below can force the flags off without
// touching real user settings.
const toolResultFlagStore: Record<string, string> = {};

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(name: string) {
      return toolResultFlagStore[name] ?? "";
    }
    setValue(name: string, value: string) {
      toolResultFlagStore[name] = value;
    }
  },
}));

import { SkillRegistry } from "@/config/skillsRegistry";

// Wipe the flag store between tests so each starts from the default (flags
// on, no values) and no test's opt-out leaks into the next.
afterEach(() => {
  for (const key of Object.keys(toolResultFlagStore)) {
    delete toolResultFlagStore[key];
  }
});

describe("SkillRegistry", () => {
  describe("isRegistered", () => {
    test("should return true for unified search scrape built-in skill", () => {
      expect(SkillRegistry.isRegistered("scrape_urls_from_search_engine")).toBe(
        true
      );
    });

    test("should return true for extract_emails_from_urls", () => {
      expect(SkillRegistry.isRegistered("extract_emails_from_urls")).toBe(true);
    });

    test("should return false for unknown skill", () => {
      expect(SkillRegistry.isRegistered("nonexistent_tool")).toBe(false);
    });

    test("should return false for MCP-prefixed tool", () => {
      expect(SkillRegistry.isRegistered("mcp_some_tool")).toBe(false);
    });

    test("should return true for conversation_tool_history", () => {
      expect(SkillRegistry.isRegistered("conversation_tool_history")).toBe(
        true
      );
    });

    test("conversation_tool_history is a confirmation-free pure lookup", () => {
      const skill = SkillRegistry.getSkill("conversation_tool_history");
      expect(skill).not.toBeNull();
      expect(skill!.permissionCategory).toBe("pure");
      expect(skill!.requiresConfirmation).toBe(false);
      expect(skill!.timeoutClass).toBe("fast");
    });

    test("should return true for search_maps_businesses", () => {
      expect(SkillRegistry.isRegistered("search_maps_businesses")).toBe(true);
    });

    test("should return true for AI message task tools", () => {
      expect(SkillRegistry.isRegistered("list_ai_message_tasks")).toBe(true);
      expect(SkillRegistry.isRegistered("get_ai_message_task")).toBe(true);
      expect(SkillRegistry.isRegistered("create_ai_message_task")).toBe(true);
      expect(SkillRegistry.isRegistered("update_ai_message_task")).toBe(true);
    });
  });

  describe("getSkill", () => {
    test("should return skill definition for registered skill", () => {
      const skill = SkillRegistry.getSkill("scrape_urls_from_search_engine");
      expect(skill).not.toBeNull();
      expect(skill!.name).toBe("scrape_urls_from_search_engine");
      expect(skill!.tier).toBe("main");
      expect(skill!.source).toBe("built-in");
      expect(skill!.parameters).toBeDefined();
      expect(typeof skill!.execute).toBe("function");
    });

    test("should return null for unknown skill", () => {
      const skill = SkillRegistry.getSkill("nonexistent_tool");
      expect(skill).toBeNull();
    });

    test("should return skill with pure permission for keyword generation", () => {
      const skill = SkillRegistry.getSkill("generate_keywords");
      expect(skill!.permissionCategory).toBe("pure");
    });

    test("should return skill with network permission for search tools", () => {
      const skill = SkillRegistry.getSkill("scrape_urls_from_search_engine");
      expect(skill!.permissionCategory).toBe("network");
    });

    test("should return Maps skill with automation permission", () => {
      const skill = SkillRegistry.getSkill("search_maps_businesses");
      expect(skill).not.toBeNull();
      expect(skill!.permissionCategory).toBe("automation");
      expect(skill!.tier).toBe("main");
      expect(skill!.source).toBe("built-in");
    });

    test("AI message task list is a confirmation-free pure lookup", () => {
      const skill = SkillRegistry.getSkill("list_ai_message_tasks");
      expect(skill).not.toBeNull();
      expect(skill!.permissionCategory).toBe("automation");
      expect(skill!.requiresConfirmation).toBe(false);
      expect(skill!.tier).toBe("main");
      expect(skill!.source).toBe("built-in");
    });

    test("AI message task get returns the full message without confirmation", () => {
      const skill = SkillRegistry.getSkill("get_ai_message_task");
      expect(skill).not.toBeNull();
      expect(skill!.requiresConfirmation).toBe(false);
      expect(skill!.description).toContain("full message");
      expect(skill!.parameters).toMatchObject({
        required: ["task_id"],
      });
    });

    test("AI message task create requires confirmation", () => {
      const skill = SkillRegistry.getSkill("create_ai_message_task");
      expect(skill).not.toBeNull();
      expect(skill!.permissionCategory).toBe("automation");
      expect(skill!.requiresConfirmation).toBe(true);
      expect(skill!.tier).toBe("main");
      expect(skill!.source).toBe("built-in");
    });

    test("AI message task update requires confirmation and can edit the message", () => {
      const skill = SkillRegistry.getSkill("update_ai_message_task");
      expect(skill).not.toBeNull();
      expect(skill!.requiresConfirmation).toBe(true);
      expect(skill!.description).toContain("message_find");
      const params = skill!.parameters as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      expect(params.required).toEqual(["task_id"]);
      expect(params.properties).toHaveProperty("message");
      expect(params.properties).toHaveProperty("message_find");
      expect(params.properties).toHaveProperty("message_replace");
      expect(params.properties).toHaveProperty("allowed_tools");
    });

    test("update_schedule directs message edits to the AI message task tools", () => {
      const skill = SkillRegistry.getSkill("update_schedule");
      expect(skill).not.toBeNull();
      expect(skill!.description).toContain("get_ai_message_task");
      expect(skill!.description).toContain("update_ai_message_task");
    });
  });

  describe("getAllToolFunctions", () => {
    test("should return array of ToolFunction objects", async () => {
      const tools = await SkillRegistry.getAllToolFunctions();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    test("should include all built-in tools", async () => {
      const tools = await SkillRegistry.getAllToolFunctions();
      const names = tools.map((t) => t.name);

      expect(names).toContain("scrape_urls_from_search_engine");
      expect(names).not.toContain("scrape_urls_from_google");
      expect(names).not.toContain("scrape_urls_from_bing");
      expect(names).toContain("extract_emails_from_urls");
      expect(names).toContain("generate_keywords");
      expect(names).toContain("extract_contact_info");
      expect(names).toContain("search_maps_businesses");
      expect(names).toContain("conversation_tool_history");
      expect(names).toContain("list_ai_message_tasks");
      expect(names).toContain("get_ai_message_task");
      expect(names).toContain("create_ai_message_task");
      expect(names).toContain("update_ai_message_task");
    });

    test("should return ToolFunction with correct shape", async () => {
      const tools = await SkillRegistry.getAllToolFunctions();
      const searchTool = tools.find(
        (t) => t.name === "scrape_urls_from_search_engine"
      );

      expect(searchTool).toBeDefined();
      expect(searchTool!.type).toBe("function");
      expect(searchTool!.name).toBe("scrape_urls_from_search_engine");
      expect(searchTool!.description).toBeDefined();
      expect(searchTool!.parameters).toBeDefined();
      expect(typeof searchTool!.description).toBe("string");
    });

    test("schedule tools only allow the ai_message task type", async () => {
      // AI-created schedules are restricted to ai_message tasks. The registry
      // schema is what the model actually sees, so it must not advertise the
      // legacy task types (search, buck_email, ...).
      const tools = await SkillRegistry.getAllToolFunctions();

      for (const toolName of ["create_schedule", "update_schedule"]) {
        const tool = tools.find((t) => t.name === toolName);
        expect(tool, `${toolName} should be registered`).toBeDefined();

        const params = tool!.parameters as {
          properties?: { task_type?: { enum?: string[] } };
        };
        expect(params.properties?.task_type?.enum).toEqual(["ai_message"]);
      }
    });

    test("tool_result retrieval tools are advertised when the rollout flags are on", async () => {
      // Default state (mocked Token store has no values) = flags on.
      const tools = await SkillRegistry.getAllToolFunctions();
      const names = tools.map((t) => t.name);
      expect(names).toContain("tool_result_read");
      expect(names).toContain("tool_result_search");
    });

    test("tool_result retrieval tools are NOT advertised when both rollout flags are off", async () => {
      // Catalog honesty (TD §13.4 rollback semantics): with capture AND
      // modelRefs off, the gate would deny every call, so advertising the
      // tools only invites guaranteed-failing calls. The tools must
      // disappear from the model-facing catalog instead of being callable
      // into a dead end.
      toolResultFlagStore["ai_tool_output_capture_enabled"] = "false";
      toolResultFlagStore["ai_tool_output_model_refs_enabled"] = "false";

      const tools = await SkillRegistry.getAllToolFunctions();
      const names = tools.map((t) => t.name);
      expect(names).not.toContain("tool_result_read");
      expect(names).not.toContain("tool_result_search");
    });

    test("tool_result retrieval tools stay advertised when only capture is off", async () => {
      // modelRefs alone still delivers references, so the tools remain.
      toolResultFlagStore["ai_tool_output_capture_enabled"] = "false";

      const tools = await SkillRegistry.getAllToolFunctions();
      const names = tools.map((t) => t.name);
      expect(names).toContain("tool_result_read");
      expect(names).toContain("tool_result_search");
    });
  });

  describe("registerSkill / unregisterSkill", () => {
    const testSkillName = "test_custom_skill_vitest";

    afterEach(() => {
      try {
        SkillRegistry.unregisterSkill(testSkillName);
      } catch {
        // Ignore if not registered
      }
    });

    test("should register a new skill", () => {
      SkillRegistry.registerSkill({
        name: testSkillName,
        description: "Test skill",
        parameters: { type: "object", properties: {} },
        tier: "main",
        requiresConfirmation: false,
        permissionCategory: "pure",
        execute: vi.fn(),
        source: "user",
      });

      expect(SkillRegistry.isRegistered(testSkillName)).toBe(true);
      const skill = SkillRegistry.getSkill(testSkillName);
      expect(skill!.name).toBe(testSkillName);
    });

    test("should throw when registering duplicate name", () => {
      SkillRegistry.registerSkill({
        name: testSkillName,
        description: "First",
        parameters: { type: "object", properties: {} },
        tier: "main",
        requiresConfirmation: false,
        permissionCategory: "pure",
        execute: vi.fn(),
        source: "user",
      });

      expect(() => {
        SkillRegistry.registerSkill({
          name: testSkillName,
          description: "Duplicate",
          parameters: { type: "object", properties: {} },
          tier: "main",
          requiresConfirmation: false,
          permissionCategory: "pure",
          execute: vi.fn(),
          source: "user",
        });
      }).toThrow(/already registered/);
    });

    test("should unregister a skill", () => {
      SkillRegistry.registerSkill({
        name: testSkillName,
        description: "To remove",
        parameters: { type: "object", properties: {} },
        tier: "main",
        requiresConfirmation: false,
        permissionCategory: "pure",
        execute: vi.fn(),
        source: "user",
      });

      expect(SkillRegistry.isRegistered(testSkillName)).toBe(true);
      SkillRegistry.unregisterSkill(testSkillName);
      expect(SkillRegistry.isRegistered(testSkillName)).toBe(false);
    });

    test("unregisterSkill should not throw for unknown names", () => {
      expect(() => {
        SkillRegistry.unregisterSkill("definitely_not_registered");
      }).not.toThrow();
    });
  });

  describe("findSkillForFileExtension", () => {
    const docSkillName = "test_doc_skill_pdf_route";
    const noTypesName = "test_doc_skill_no_types";

    afterEach(() => {
      for (const n of [docSkillName, noTypesName]) {
        try {
          SkillRegistry.unregisterSkill(n);
        } catch {
          // ignore
        }
      }
    });

    test("returns documentation-only user skill when extension matches", async () => {
      SkillRegistry.registerSkill({
        name: docSkillName,
        description: "Doc-only PDF guidance",
        parameters: { type: "object", properties: {} },
        tier: "sandboxed",
        requiresConfirmation: false,
        permissionCategory: "pure",
        execute: vi.fn(),
        source: "user",
        documentationOnly: true,
        supportedFileTypes: [".pdf"],
      });

      const hit = await SkillRegistry.findSkillForFileExtension(".pdf");
      expect(hit).not.toBeNull();
      expect(hit!.name).toBe(docSkillName);
    });

    test("returns null when user skill has no supportedFileTypes", async () => {
      SkillRegistry.registerSkill({
        name: noTypesName,
        description: "No types",
        parameters: { type: "object", properties: {} },
        tier: "sandboxed",
        requiresConfirmation: false,
        permissionCategory: "pure",
        execute: vi.fn(),
        source: "user",
        documentationOnly: true,
      });

      expect(await SkillRegistry.findSkillForFileExtension(".pdf")).toBeNull();
    });
  });
});
