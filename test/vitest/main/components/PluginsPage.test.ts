import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { describe, expect, it } from "vitest";
import PluginsPage from "@/views/pages/systemsetting/plugins.vue";

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
});
