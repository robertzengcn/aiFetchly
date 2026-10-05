import { afterEach, describe, expect, test, vi } from "vitest";
import type { SkillExecutionResult } from "@/entityTypes/skillTypes";
import { AI_CHAT_RECOVERABLE_FLAGS } from "@/service/AIChatRecoverableDefaults";
import {
  CONVERSATION_HISTORY_SEARCH_TOOL_NAME,
  CONVERSATION_HISTORY_READ_TOOL_NAME,
} from "@/entityTypes/conversationToolHistoryTypes";

const historyState = vi.hoisted((): {
  flags: Record<string, string>;
  unreadable: boolean;
} => ({ flags: {}, unreadable: false }));

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(name: string): string {
      if (historyState.unreadable) throw new Error("Token store unavailable");
      return historyState.flags[name] ?? "";
    }
  },
}));

vi.mock("@/service/agentTools/conversationHistorySearchTool", () => ({
  handleConversationHistorySearch: vi.fn(async (): Promise<SkillExecutionResult> => ({
    success: true,
    result: { records: [] },
  })),
}));

vi.mock("@/service/agentTools/conversationHistoryReadTool", () => ({
  handleConversationHistoryRead: vi.fn(async (): Promise<SkillExecutionResult> => ({
    success: true,
    result: { records: [] },
  })),
}));

const runtimeState = vi.hoisted(
  (): {
    installedSkills: Array<{
      name: string;
      enabled: number;
      pluginName?: string | null;
    }>;
    enabledPlugins: Array<{ name: string }>;
  } => ({
    installedSkills: [],
    enabledPlugins: [],
  })
);

vi.mock("@/service/ToolExecutor", () => ({
  ToolExecutor: {
    execute: vi.fn().mockResolvedValue({ results: [] }),
  },
}));

vi.mock("@/service/MCPToolService", () => ({
  MCPToolService: class {
    getEnabledMCPToolsAsFunctions = vi.fn().mockResolvedValue([
      {
        type: "function",
        name: "mcp_unrelated_lookup",
        description: "Unrelated MCP lookup",
        parameters: { type: "object", properties: {} },
      },
    ]);
  },
}));

vi.mock("@/modules/PluginManagementModule", () => ({
  PluginManagementModule: class {
    async listEnabledPlugins(): Promise<typeof runtimeState.enabledPlugins> {
      return runtimeState.enabledPlugins;
    }
  },
}));

vi.mock("@/modules/SkillManagementModule", () => ({
  SkillManagementModule: class {
    async listInstalledSkills(): Promise<typeof runtimeState.installedSkills> {
      return runtimeState.installedSkills;
    }
    async listEnabledSkills(): Promise<typeof runtimeState.installedSkills> {
      return runtimeState.installedSkills.filter((skill): boolean => skill.enabled === 1);
    }
    async getSkillByName(name: string): Promise<(typeof runtimeState.installedSkills)[number] | null> {
      return runtimeState.installedSkills.find((skill): boolean => skill.name === name) ?? null;
    }
    async ensureConnection(): Promise<void> {}
  },
}));

import { SkillRegistry } from "@/config/skillsRegistry";

function registerUserSkill(
  name: string,
  options?: {
    readonly pluginOwner?: string;
    readonly supportedFileTypes?: readonly string[];
  }
): void {
  SkillRegistry.registerSkill({
    name,
    description: `${name} description`,
    parameters: { type: "object", properties: {} },
    tier: "sandboxed",
    requiresConfirmation: false,
    permissionCategory: "pure",
    execute: vi.fn(),
    source: "user",
    documentationOnly: options?.supportedFileTypes !== undefined,
    supportedFileTypes: options?.supportedFileTypes,
    pluginOwner: options?.pluginOwner,
  });
}

describe("SkillRegistry runtime enablement", () => {
  const registeredNames = new Set<string>();

  afterEach(() => {
    for (const name of registeredNames) {
      SkillRegistry.unregisterSkill(name);
    }
    registeredNames.clear();
    runtimeState.installedSkills = [];
    runtimeState.enabledPlugins = [];
    for (const key of Object.keys(historyState.flags)) {
      delete historyState.flags[key];
    }
    historyState.unreadable = false;
  });

  test("hides disabled installed skills from the LLM tool catalog", async () => {
    const name = "test_disabled_installed_skill";
    registerUserSkill(name);
    registeredNames.add(name);
    runtimeState.installedSkills = [{ name, enabled: 0, pluginName: null }];

    const tools = await SkillRegistry.getAllToolFunctions();

    expect(tools.map((tool) => tool.name)).not.toContain(name);
    expect(await SkillRegistry.isSkillEnabledForRuntime(name)).toBe(false);
  });

  test("hides plugin-owned skills using persisted ownership when registry metadata is stale", async () => {
    const name = "test_plugin_owned_stale_skill";
    registerUserSkill(name);
    registeredNames.add(name);
    runtimeState.installedSkills = [
      { name, enabled: 1, pluginName: "disabled-plugin" },
    ];
    runtimeState.enabledPlugins = [];

    const tools = await SkillRegistry.getAllToolFunctions();

    expect(tools.map((tool) => tool.name)).not.toContain(name);
  });

  test("returns enabled plugin-owned skills when the owning plugin is enabled", async () => {
    const name = "test_plugin_owned_enabled_skill";
    registerUserSkill(name);
    registeredNames.add(name);
    runtimeState.installedSkills = [
      { name, enabled: 1, pluginName: "enabled-plugin" },
    ];
    runtimeState.enabledPlugins = [{ name: "enabled-plugin" }];

    const tools = await SkillRegistry.getAllToolFunctions();

    expect(tools.map((tool) => tool.name)).toContain(name);
  });

  test("does not route attachments to disabled documentation skills", async () => {
    const name = "test_disabled_doc_skill";
    registerUserSkill(name, { supportedFileTypes: [".pdf"] });
    registeredNames.add(name);
    runtimeState.installedSkills = [{ name, enabled: 0, pluginName: null }];

    const skill = await SkillRegistry.findSkillForFileExtension(".pdf");

    expect(skill).toBeNull();
  });
});

describe("history tool rollout-flag gating", () => {
  afterEach(() => {
    for (const key of Object.keys(historyState.flags)) {
      delete historyState.flags[key];
    }
    historyState.unreadable = false;
  });

  test("hides both history tools when rollout flags are default OFF", async () => {
    const tools = await SkillRegistry.getAllToolFunctions();

    expect(tools.map((tool) => tool.name)).not.toContain(
      CONVERSATION_HISTORY_SEARCH_TOOL_NAME
    );
    expect(tools.map((tool) => tool.name)).not.toContain(
      CONVERSATION_HISTORY_READ_TOOL_NAME
    );
    expect(
      await SkillRegistry.isSkillEnabledForRuntime(
        CONVERSATION_HISTORY_SEARCH_TOOL_NAME
      )
    ).toBe(false);
    expect(
      await SkillRegistry.isSkillEnabledForRuntime(
        CONVERSATION_HISTORY_READ_TOOL_NAME
      )
    ).toBe(false);
  });

  test.each([
    AI_CHAT_RECOVERABLE_FLAGS.historyTools,
    AI_CHAT_RECOVERABLE_FLAGS.archiveReads,
  ])("hides both history tools when only %s is enabled", async (flag): Promise<void> => {
    historyState.flags[flag] = "true";

    const tools = await SkillRegistry.getAllToolFunctions();

    expect(tools.map((tool) => tool.name)).not.toContain(
      CONVERSATION_HISTORY_SEARCH_TOOL_NAME
    );
    expect(tools.map((tool) => tool.name)).not.toContain(
      CONVERSATION_HISTORY_READ_TOOL_NAME
    );
  });

  test("exposes history tools only when both rollout flags are enabled", async () => {
    historyState.flags[AI_CHAT_RECOVERABLE_FLAGS.historyTools] = "true";
    historyState.flags[AI_CHAT_RECOVERABLE_FLAGS.archiveReads] = "true";

    const tools = await SkillRegistry.getAllToolFunctions();
    const names = tools.map((tool) => tool.name);

    expect(names).toContain(CONVERSATION_HISTORY_SEARCH_TOOL_NAME);
    expect(names).toContain(CONVERSATION_HISTORY_READ_TOOL_NAME);
    expect(
      await SkillRegistry.isSkillEnabledForRuntime(
        CONVERSATION_HISTORY_SEARCH_TOOL_NAME
      )
    ).toBe(true);
  });

  test("re-reads rollout flags live so a runtime disable takes effect", async () => {
    historyState.flags[AI_CHAT_RECOVERABLE_FLAGS.historyTools] = "true";
    historyState.flags[AI_CHAT_RECOVERABLE_FLAGS.archiveReads] = "true";

    expect(
      await SkillRegistry.isSkillEnabledForRuntime(
        CONVERSATION_HISTORY_SEARCH_TOOL_NAME
      )
    ).toBe(true);

    historyState.flags[AI_CHAT_RECOVERABLE_FLAGS.historyTools] = "false";

    expect(
      await SkillRegistry.isSkillEnabledForRuntime(
        CONVERSATION_HISTORY_SEARCH_TOOL_NAME
      )
    ).toBe(false);
  });

  test("keeps unrelated MCP tools and other built-ins exposed when flags are off", async () => {
    const tools = await SkillRegistry.getAllToolFunctions();
    const names = tools.map((tool) => tool.name);

    expect(names).toContain("mcp_unrelated_lookup");
    expect(names).toContain("scrape_urls_from_search_engine");
    expect(names).toContain("conversation_tool_history");
  });

  test.each([
    AI_CHAT_RECOVERABLE_FLAGS.historyTools,
    AI_CHAT_RECOVERABLE_FLAGS.archiveReads,
  ])("refuses cached execution after disabling %s", async (flag): Promise<void> => {
    historyState.flags[AI_CHAT_RECOVERABLE_FLAGS.historyTools] = "true";
    historyState.flags[AI_CHAT_RECOVERABLE_FLAGS.archiveReads] = "true";

    const searchDefinition = SkillRegistry.getSkill(
      CONVERSATION_HISTORY_SEARCH_TOOL_NAME
    );
    const readDefinition = SkillRegistry.getSkill(
      CONVERSATION_HISTORY_READ_TOOL_NAME
    );
    expect(searchDefinition).not.toBeNull();
    expect(readDefinition).not.toBeNull();

    const context = {
      conversationId: "conv-flag-gate",
      toolCallId: "call-flag-gate",
    };

    expect((await searchDefinition!.execute({ query: "needle" }, context)).success).toBe(true);
    expect((await readDefinition!.execute({ source_id: "src-1" }, context)).success).toBe(true);

    historyState.flags[flag] = "false";

    const searchResult = await searchDefinition!.execute(
      { query: "needle" },
      context
    );
    const readResult = await readDefinition!.execute(
      { source_id: "src-1" },
      context
    );

    expect(searchResult.success).toBe(false);
    expect(readResult.success).toBe(false);
  });
});
