import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatVoiceOutputToggle from "@/views/components/aiChatV2/AiChatVoiceOutputToggle.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      aiChatV2: {
        voice: {
          enable_spoken_responses: "Enable spoken responses",
          disable_spoken_responses: "Disable spoken responses",
        },
      },
    },
  },
});

function mountToggle(props: Record<string, unknown> = {}) {
  return mount(AiChatVoiceOutputToggle, {
    global: { plugins: [i18n] },
    props,
  });
}

describe("AiChatVoiceOutputToggle (chat-first shell design §11.3)", () => {
  it("exposes a pressed, labelled toggle control", () => {
    const wrapper = mountToggle({ enabled: true });
    const button = wrapper.get('[data-testid="spoken-response-toggle"]');
    expect(button.attributes("aria-pressed")).toBe("true");
    expect(button.attributes("aria-label")).toBe("Disable spoken responses");
  });

  it("shows the unpressed state with the enable label", () => {
    const wrapper = mountToggle({ enabled: false });
    const button = wrapper.get('[data-testid="spoken-response-toggle"]');
    expect(button.attributes("aria-pressed")).toBe("false");
    expect(button.attributes("aria-label")).toBe("Enable spoken responses");
  });

  it("emits toggle on click", async () => {
    const wrapper = mountToggle({ enabled: false });
    await wrapper.get('[data-testid="spoken-response-toggle"]').trigger("click");
    expect(wrapper.emitted("toggle")).toHaveLength(1);
    expect(wrapper.emitted("open-settings")).toBeUndefined();
  });

  it("routes to settings when enabling while unavailable", async () => {
    const wrapper = mountToggle({ enabled: false, unavailable: true });
    await wrapper.get('[data-testid="spoken-response-toggle"]').trigger("click");
    expect(wrapper.emitted("toggle")).toBeUndefined();
    expect(wrapper.emitted("open-settings")).toHaveLength(1);
  });

  it("still toggles when unavailable but already enabled", async () => {
    const wrapper = mountToggle({ enabled: true, unavailable: true });
    await wrapper.get('[data-testid="spoken-response-toggle"]').trigger("click");
    expect(wrapper.emitted("toggle")).toHaveLength(1);
  });
});
