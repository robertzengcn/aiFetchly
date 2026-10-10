import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatV2ModelSelector from "@/views/components/aiChatV2/AiChatV2ModelSelector.vue";
import type { OpenAIModel } from "@/api/aiChatApi";

/**
 * PRD §13.4/§18 (Definition of Done item 14): the model selector
 * distinguishes BOUNDED loading from a completed empty model list. Loading
 * shows the loading placeholder and no action; a settled empty list shows a
 * disabled selector with an accessible explanation and an inline
 * provider-settings action that does not change the toolbar row height.
 */

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      aiChatV2: {
        model_selector_label: "Model",
        model_loading: "Loading models…",
        model_none_available: "No models available",
        model_none_hint: "No usable model is configured.",
        model_open_settings: "Open provider settings",
        model_auto: "Auto",
      },
    },
  },
});

const models: OpenAIModel[] = [
  { id: "provider/gpt-x", context_size: 128_000 } as OpenAIModel,
];

function mountSelector(props: {
  items: OpenAIModel[];
  loading?: boolean;
  noModels?: boolean;
}) {
  return mount(AiChatV2ModelSelector, {
    props: { modelValue: undefined, ...props },
    global: {
      plugins: [i18n],
      stubs: {
        VSelect: {
          props: [
            "modelValue",
            "placeholder",
            "disabled",
            "loading",
            "ariaLabel",
          ],
          template:
            '<div class="stub-select" :data-disabled="disabled !== undefined && disabled !== false ? \'\' : undefined">{{ modelValue ?? placeholder }}</div>',
        },
        VBtn: {
          props: ["ariaLabel", "title"],
          emits: ["click"],
          template:
            '<button class="stub-btn" :aria-label="ariaLabel" :title="title" @click="$emit(\'click\', $event)" />',
        },
        VIcon: true,
        VListItem: true,
        VListItemSubtitle: true,
        VChip: true,
      },
    },
  });
}

describe("AiChatV2ModelSelector no-model action state (PRD §13.4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the loading placeholder and no settings action while loading", () => {
    const wrapper = mountSelector({ items: [], loading: true });
    expect(wrapper.text()).toContain("Loading models…");
    expect(wrapper.find('[data-testid="model-open-settings"]').exists()).toBe(
      false
    );
  });

  it("shows a disabled selector with an explanation and settings action once loading completes empty", async () => {
    const wrapper = mountSelector({ items: [], noModels: true });
    expect(wrapper.text()).toContain("No models available");
    // Accessible explanation lives on the wrapper (title + aria-label).
    expect(wrapper.attributes("title")).toContain(
      "No usable model is configured."
    );
    expect(wrapper.attributes("aria-label")).toContain(
      "No usable model is configured."
    );

    const action = wrapper.get('[data-testid="model-open-settings"]');
    expect(action.attributes("aria-label")).toBe("Open provider settings");
    await action.trigger("click");
    expect(wrapper.emitted("open-settings")).toHaveLength(1);
  });

  it("hides the settings action when models exist", () => {
    const wrapper = mountSelector({ items: models });
    wrapper.setProps({ modelValue: models[0].id });
    return flushPromises().then(() => {
      expect(
        wrapper.find('[data-testid="model-open-settings"]').exists()
      ).toBe(false);
      expect(wrapper.attributes("title")).toBeUndefined();
      expect(wrapper.text()).not.toContain("No models available");
    });
  });
});
