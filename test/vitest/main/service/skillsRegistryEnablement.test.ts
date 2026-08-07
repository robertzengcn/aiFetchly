import { afterEach, describe, expect, test, vi } from "vitest";

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
  MCPToolService: vi.fn().mockImplementation(() => ({
    getEnabledMCPToolsAsFunctions: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock("@/modules/PluginManagementModule", () => ({
  PluginManagementModule: vi.fn().mockImplementation(() => ({
    listEnabledPlugins: vi.fn(async () => runtimeState.enabledPlugins),
  })),
}));

vi.mock("@/modules/SkillManagementModule", () => ({
  SkillManagementModule: vi.fn().mockImplementation(() => ({
    listInstalledSkills: vi.fn(async () => runtimeState.installedSkills),
    listEnabledSkills: vi.fn(async () =>
      runtimeState.installedSkills.filter((skill) => skill.enabled === 1)
    ),
    getSkillByName: vi.fn(async (name: string) =>
      runtimeState.installedSkills.find((skill) => skill.name === name) ?? null
    ),
    ensureConnection: vi.fn(async () => undefined),
  })),
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
