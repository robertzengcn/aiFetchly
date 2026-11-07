import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createI18n } from "vue-i18n";

vi.mock("@/views/api/aiProvider", () => ({
  getAIProviderSettings: vi.fn().mockResolvedValue({
    mode: "hosted",
    hostedAIEnabled: true,
    localAIEnabled: false,
    localProvider: null,
    autoChatTitlesEnabled: true,
  }),
  saveAIProviderSettings: vi.fn(),
  refreshLocalAIModels: vi.fn(),
  testLocalAIProvider: vi.fn(),
  clearApiKey: vi.fn(),
}));

vi.mock("@/views/components/settings/AIProviderSettingsPanel.vue", () => ({
  default: { template: '<div data-testid="panel-stub" />' },
}));
vi.mock("@/views/components/settings/AiChatVoiceSettingsPanel.vue", () => ({
  default: { template: "<div />" },
}));
vi.mock("@/views/components/settings/LocalAiComponentsPanel.vue", () => ({
  default: { template: "<div />" },
}));
vi.mock("@/views/components/pageTemplates/AppPageShell.vue", () => ({
  default: { template: '<div><slot /></div>' },
}));
vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ path: "/", name: "System_Settings" }),
}));

import AiProviderPage from "@/views/pages/systemsetting/ai_provider.vue";
import { getAIProviderSettings } from "@/views/api/aiProvider";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      aiProvider: {
        chatTitles: {
          section: "Chat titles",
          description: "desc",
          autoToggle: "Automatically name new chats",
          hostedModelHint: "hosted hint",
          customModelLabel: "Title model",
          customModelHint: "custom hint",
        },
        show_reasoning_process: "Show reasoning process",
      },
    },
  },
});

function mountPage() {
  return mount(AiProviderPage, {
    global: { plugins: [i18n] },
    attachTo: document.createElement("div"),
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

describe("ai_provider settings page — titles F13 listener lifecycle", () => {
  it("unmount removes the settings-changed listener (no fetch after unmount)", async () => {
    vi.mocked(getAIProviderSettings).mockClear();
    const wrapper = mountPage();
    // Initial hydration happened.
    expect(vi.mocked(getAIProviderSettings).mock.calls.length).toBeGreaterThanOrEqual(1);

    wrapper.unmount();

    const callsAfterUnmount = vi.mocked(getAIProviderSettings).mock.calls.length;
    // Dispatching the settings event after unmount must NOT fetch (the
    // listener is removed by the in-setup onUnmounted hook).
    window.dispatchEvent(new Event("aifetchly:ai-provider-settings-changed"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(vi.mocked(getAIProviderSettings).mock.calls.length).toBe(
      callsAfterUnmount
    );
  });

  it("a mounted page re-hydrates exactly once per settings-changed event", async () => {
    const wrapper = mountPage();
    vi.mocked(getAIProviderSettings).mockClear();
    window.dispatchEvent(new Event("aifetchly:ai-provider-settings-changed"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(vi.mocked(getAIProviderSettings).mock.calls.length).toBe(1);
    window.dispatchEvent(new Event("aifetchly:ai-provider-settings-changed"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(vi.mocked(getAIProviderSettings).mock.calls.length).toBe(2);
    wrapper.unmount();
  });
});
