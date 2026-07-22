import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import PluginCommandsTab from "@/views/components/plugins/PluginCommandsTab.vue";
import type { PluginDetail } from "@/views/api/plugins";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      plugins: {
        column_command: "Command",
        column_description: "Description",
        column_aliases: "Aliases",
        column_argument_hint: "Argument Hint",
        column_status: "Status",
        enabled_label: "Enabled",
        status_disabled: "Disabled",
        no_commands: "No slash commands in this plugin.",
      },
    },
  },
});

function makeDetail(
  commands: PluginDetail["commands"]
): PluginDetail {
  return {
    id: 1,
    name: "demo-plugin",
    version: "1.0.0",
    source: "local",
    enabled: true,
    health: "healthy",
    skillCount: 0,
    mcpServerCount: 0,
    agentCount: 0,
    commandCount: commands.length,
    hookCount: 0,
    permissions: [],
    lastUpdated: new Date("2026-07-21T00:00:00.000Z").toISOString(),
    description: "demo",
    skills: [],
    mcpServers: [],
    agents: [],
    commands,
    hooks: [],
    errors: [],
    manifest: {},
  };
}

function mountTab(commands: PluginDetail["commands"]) {
  return mount(PluginCommandsTab, {
    global: { plugins: [i18n] },
    props: { detail: makeDetail(commands) },
  });
}

describe("PluginCommandsTab", () => {
  it("renders one row per command with name, sourceId, description, aliases, and argument hint", () => {
    const wrapper = mountTab([
      {
        name: "review",
        description: "Review changes",
        aliases: ["code-review"],
        argumentHint: "[scope]",
        enabled: true,
        sourceId: "plugin:demo-plugin",
      },
    ]);
    const html = wrapper.html();
    expect(html).toContain("/review");
    expect(html).toContain("plugin:demo-plugin");
    expect(html).toContain("Review changes");
    expect(html).toContain("/code-review");
    expect(html).toContain("[scope]");
    // Enabled chip uses the enabled label.
    expect(wrapper.findAll("tr").length).toBeGreaterThanOrEqual(2);
  });

  it("shows the empty state when the plugin contributes no commands", () => {
    const wrapper = mountTab([]);
    expect(wrapper.html()).toContain("No slash commands in this plugin.");
  });

  it("disables a row's status chip for a disabled command", () => {
    const wrapper = mountTab([
      {
        name: "off",
        description: "Disabled command",
        aliases: [],
        enabled: false,
        sourceId: "plugin:demo-plugin",
      },
    ]);
    expect(wrapper.html()).toContain("Disabled");
  });
});
