import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import PluginInstalledTab from "@/views/components/plugins/PluginInstalledTab.vue";
import type { PluginSummary } from "@/views/api/plugins";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    en: {
      plugins: {
        reload_button: "Reload",
        import_button: "Import",
        install_source: { button: "Install from Source" },
        empty_state: "Empty",
        column_plugin: "Plugin",
        column_version: "Version",
        column_source: "Source",
        column_source_path: "Imported From",
        column_sub_agent: "SubAgent",
        column_skills: "Skills",
        column_hooks: "Hooks",
        column_mcp_servers: "MCP Servers",
        column_status: "Status",
        column_actions: "Actions",
        source_builtin: "Built-in",
        source_marketplace: "Marketplace",
        source_local: "Local",
        source_path_unknown: "Unknown",
        source_path_imported_from: "Imported from",
        source_path_installed_at: "Installed at",
        status_disabled: "Disabled",
        status_healthy: "Healthy",
        status_partial_load: "Partial Load",
        uninstall_button: "Uninstall",
      },
    },
  },
});

function makePlugin(over: Partial<PluginSummary> & { name: string }): PluginSummary {
  return {
    id: 1,
    version: "1.0.0",
    source: "local",
    enabled: true,
    health: "healthy",
    skillCount: 0,
    mcpServerCount: 0,
    agentCount: 0,
    commandCount: 0,
    hookCount: 0,
    permissions: [],
    lastUpdated: new Date().toISOString(),
    ...over,
  };
}

function mountTab(plugins: PluginSummary[]) {
  return mount(PluginInstalledTab, {
    global: { plugins: [i18n] },
    props: { plugins, isLoading: false, reloading: false },
  });
}

describe("PluginInstalledTab Imported From column (no tooltip)", () => {
  it("renders path text with no tooltip in the path cell", () => {
    const w = mountTab([
      makePlugin({
        name: "demo",
        sourceUri: "https://github.com/o/r",
        installPath: "/tmp/plugins/demo",
      }),
    ]);
    const cell = w.find(".plugin-path-cell");
    expect(cell.exists()).toBe(true);
    expect(cell.text()).toContain("https://github.com/o/r");
    expect(cell.find("v-tooltip").exists()).toBe(false);
  });

  it("prefers sourceUri over installPath", () => {
    const w = mountTab([
      makePlugin({
        name: "both",
        sourceUri: "https://github.com/o/r",
        installPath: "/data/plugins/both",
      }),
    ]);
    expect(w.find(".plugin-path-cell").text()).toContain("https://github.com/o/r");
    expect(w.find(".plugin-path-cell v-tooltip").exists()).toBe(false);
  });

  it("falls back to installPath when sourceUri is missing", () => {
    const w = mountTab([makePlugin({ name: "local", installPath: "/data/p" })]);
    expect(w.find(".plugin-path-cell").text()).toContain("/data/p");
    expect(w.find(".plugin-path-cell v-tooltip").exists()).toBe(false);
  });

  it("shows Unknown with no tooltip when both paths are missing or blank", () => {
    const w = mountTab([
      makePlugin({ name: "none" }),
      makePlugin({ name: "blank", sourceUri: "   ", installPath: "  " }),
    ]);
    const cells = w.findAll(".plugin-path-cell");
    expect(cells[0].text()).toContain("Unknown");
    expect(cells[0].find("v-tooltip").exists()).toBe(false);
    expect(cells[1].text()).toContain("Unknown");
    expect(cells[1].find("v-tooltip").exists()).toBe(false);
  });
});
