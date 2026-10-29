import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { describe, expect, it, vi } from "vitest";
import PluginsPage from "@/views/pages/systemsetting/plugins.vue";
import SkillInstallManager from "@/views/components/aiChatV2/SkillInstallManager.vue";

vi.mock("@/views/api/skillInstallation", () => ({
  listSkillInstallations: vi.fn().mockResolvedValue([]),
  updateSkillInstall: vi.fn(),
  repairSkillInstall: vi.fn(),
  disableSkillInstall: vi.fn(),
  enableSkillInstall: vi.fn(),
  uninstallSkillInstall: vi.fn(),
  revealSkillInstallSource: vi.fn(),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  missingWarn: false,
  fallbackWarn: false,
  messages: { en: {} },
});

describe("PluginsPage layout", () => {
  it("uses full content width so the grid grows with the window", () => {
    const wrapper = mount(PluginsPage, {
      global: {
        plugins: [i18n],
        stubs: {
          PluginManager: {
            name: "PluginManager",
            template: '<div data-testid="plugin-manager-stub" />',
          },
          SkillInstallManager: {
            name: "SkillInstallManager",
            template: '<div data-testid="skill-install-manager-stub" />',
          },
        },
      },
    });
    const shell = wrapper.find('[data-testid="app-page-shell"]');
    expect(shell.exists()).toBe(true);
    // width-full carries no max-width cap (wide is capped at 1080px).
    expect(shell.classes()).toContain("width-full");
    expect(shell.classes()).not.toContain("width-wide");
    expect(wrapper.find('[data-testid="plugin-manager-stub"]').exists()).toBe(
      true
    );
  });

  it("mounts the skill installation manager (FR-SKL-006)", async () => {
    const wrapper = mount(PluginsPage, {
      global: {
        plugins: [i18n],
        stubs: { PluginManager: true },
      },
    });
    await flushPromises();
    // Installation management stays reachable from the existing Plugins
    // settings page — the real SkillInstallManager lists installed prompt
    // skills with their lifecycle actions (PRD §22.3).
    expect(wrapper.findComponent(SkillInstallManager).exists()).toBe(true);
    expect(wrapper.find('[data-testid="skill-install-manager"]').exists()).toBe(
      true
    );
  });
});
